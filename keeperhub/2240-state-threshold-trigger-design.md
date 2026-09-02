# Design proposal for keeperhub/keeperhub #2240: threshold-over-state trigger

Paste the section below the line as a comment on
https://github.com/keeperhub/keeperhub/issues/2240 so maintainers can agree or
redirect before code lands. Implementation is planned for the Sep 6-18 build
window and will be submitted as a PR against `staging` referencing #2240, plus
a BUIDL for the Agent Economy hackathon feature bounty.

---

I'd like to take this one and want to settle the open questions before writing
code. Proposal below, grounded in the current `keeperhub-events/event-tracker`
layout (`ChainProviderManager` block subscription + `eth_getLogs` demux,
per-workflow `EventListener`, `DedupStore` keyed by `(workflowId, txHash)`,
`ListenerRegistry` reconciled by `configHash`).

## Where evaluation lives

Inside the event-tracker, as a second listener kind next to `EventListener`.
Reasons: the per-chain WSS connection, `newHeads` subscription, heartbeat,
fallback URL handling, reconnect logic, and health reporting already exist
there and are exactly what a per-block evaluator needs. The one-request-per-
second guard is specific to `eth_getLogs`; an `eth_call` per block per
subscription has a different shape, so it gets its own budget (below) rather
than sharing that limiter. A separate satellite only makes sense if measured
fan-out hurts the log path, and the subscription count on `ChainHealth` will
tell us.

Concretely: `ChainProviderManager.subscribeToBlocks({ chainId, wssUrl,
fallbackWssUrl, handler(blockNumber) })` alongside `subscribeToLogs`, sharing
the same `ChainEntry` and lifecycle (first subscriber starts the block
listener, last one stops it). No `eth_getLogs` is issued for these subscribers.

## What the user configures

One view call, one comparison, one number. Not a scripting surface.

| Field | Meaning |
| --- | --- |
| `chainId`, `contractAddress` | As for Event triggers |
| `functionSignature` | A single `view`/`pure` function ABI fragment, e.g. `getUserAccountData(address) returns (uint256,uint256,uint256,uint256,uint256,uint256)`; validated the way `validation.ts` validates event ABIs |
| `args` | Positional arguments, templated the same way other node inputs are |
| `outputIndex` | Which return value to compare (default 0) |
| `comparator` | `lt`, `lte`, `gt`, `gte`, `eq`, `neq` |
| `threshold` | Decimal string; optional `decimals` so the builder can show `1.05` while comparing `1050000000000000000` |
| `evaluateEvery` | Blocks between evaluations; default derived from chain block time so the cadence is never faster than ~2s |
| `rearm` | `{ mode: "hysteresis", band }`, `{ mode: "cooldown", blocks }`, or `{ mode: "manual" }` |

Non-`view` functions and functions with dynamic-array returns are rejected at
validation time.

## Semantics: a condition, not an event

Pure state machine per listener, in its own module so it can be tested
exhaustively without a provider:

- `armed = true` initially.
- On each evaluated block: `inCondition = compare(value, threshold)`.
- Fire only on `armed && inCondition && !previousInCondition` (rising edge). On
  fire, `armed = false`.
- Re-arm:
  - `hysteresis`: `armed = true` once the value has crossed back beyond
    `threshold ± band` on the opposite side (for `lt`, value `>= threshold +
    band`). A value oscillating inside the band produces exactly one execution.
  - `cooldown`: `armed = true` after `blocks` blocks since the fire, regardless
    of value. The next fire still requires a fresh rising edge.
  - `manual`: `armed = true` only when the workflow is disabled and re-enabled
    or its trigger config changes (a new `configHash` restarts the listener).
- Default is `hysteresis` with `band = 2%` of `threshold` for numeric
  comparators, `cooldown` of one block for `eq`/`neq`.

## Dedup identity

There is no `transactionHash`. Identity is
`keccak256(chainId, contractAddress, calldataHash, blockNumber)` and the
existing `DedupStore.isProcessed(workflowId, key)` / `markProcessed` interface
is reused unchanged (the key is opaque to it). This bounds the worst case to
one execution per block per workflow even if edge detection state is lost.

Edge-detection state (`armed`, `lastValue`, `lastBlock`) is persisted per
workflow in Redis with the same 24h TTL as dedup marks and reloaded on start,
so a pod restart does not re-fire on a condition that already fired. If Redis
is unavailable the listener starts armed and logs it, the same best-effort
posture `EventListener` takes.

## Payload

Mirrors `buildEventPayload` so existing template helpers work:

```json
{
  "type": "state_threshold",
  "chainId": 1,
  "contractAddress": "0x...",
  "function": "getUserAccountData(address)",
  "args": ["0x..."],
  "outputIndex": 5,
  "value": "1049123456789012345",
  "previousValue": "1061000000000000000",
  "threshold": "1050000000000000000",
  "comparator": "lt",
  "blockNumber": 21000123,
  "observedAt": "2026-09-10T12:00:00.000Z"
}
```

Dispatch goes through the same `createPhantomExecution` -> SQS ->
`markProcessed` path as `EventListener`, including plan refusal.

## Cost controls

- `evaluateEvery` per workflow, with a chain-derived floor.
- `eth_call`s for all threshold subscriptions on a chain in the same block are
  issued as one JSON-RPC batch (ethers batches same-tick requests on the shared
  provider), with a per-chain cap `MAX_STATE_CALLS_PER_BLOCK`; beyond the cap
  the remaining subscriptions evaluate on the next block, round-robin.
- Evaluations are never billed; only executions are, exactly as today.
- New `ChainHealth` fields: `stateSubscriberCount`, `stateCallsTotal`,
  `stateCallErrors`, so the scaling question is answered by data.

## Failure semantics

An `eth_call` error leaves the machine state unchanged and does not fire. N
consecutive errors on one listener mark it degraded in health output; the
chain-level connection handling is unchanged. A reorg is handled by
re-evaluation: state is a function of the current chain, not of past logs.

## Changes by file (planned)

- `keeperhub-events/event-tracker/src/chains/provider-manager.ts`: `subscribeToBlocks`, health counters.
- `keeperhub-events/event-tracker/src/listener/threshold-machine.ts`: pure edge/re-arm state machine.
- `keeperhub-events/event-tracker/src/listener/state-threshold-listener.ts`: listener, batching, persistence, dispatch.
- `keeperhub-events/event-tracker/src/listener/registry.ts`, `workflow-mapper.ts`: `WorkflowRegistration` becomes a discriminated union (`kind: "event" | "state-threshold"`); `hashRegistration` covers the new fields.
- `keeperhub-events/event-tracker/src/chains/validation.ts`: view-function fragment validation.
- Builder: a "Contract state threshold" trigger node in the web3 plugin with the fields above and an "Evaluate now" preview that runs the call once and shows the decoded value.
- Docs page for the new trigger.

Tests: exhaustive unit tests for the state machine (every comparator, every
re-arm mode, oscillation, restart-with-persisted-state), listener tests with a
fake provider returning a scripted sequence of values, mapper and registry
tests for the new kind coexisting with event listeners, validation tests.
Existing suites unchanged.

## Rollout

Behind `STATE_TRIGGERS_ENABLED` in the tracker and the same flag for the
builder node, default off, so the change is mergeable without a launch
decision. Solana, traces, and off-chain feeds stay out of scope per the issue.

## Questions before I start

1. One PR (tracker + builder node) or two (tracker first, node second)? I can
   do either; one keeps the feature bounty submission self-contained.
2. Is Redis persistence of edge-detection state acceptable, or do you want it
   in Postgres from day one alongside the Phase 5 dedup plan?
3. Any objection to `hysteresis` as the default re-arm mode?
4. Should plan gating apply to the number of threshold subscriptions per
   org, the way listener counts are gated today?
