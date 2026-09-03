# ETHOnline backup: Uniswap sdks #720 (DCA EIP-712)

Read-only prep. No SDK or UniswapX source edits and no PR
until the ETHOnline window is open (4 Sep 2026 16:00 UTC).
This is the Uniswap Foundation “Best Uniswap Stack
Contribution” path ($1,000 × 3 Start Fresh): an
improvement to an official Uniswap repo plus `FEEDBACK.md`
and the [hackathon feedback form](https://developers.uniswap.org/hackathon-feedback).

**Rechecked:** 3 September 2026 ~03:40 UTC

| Fact | Evidence |
| --- | --- |
| Issue | https://github.com/Uniswap/sdks/issues/720 — `open`, 0 comments, opened 2026-09-02 by `gomesalexandre`. No linked PR. GitHub search for `DCAIntent` / `hashDCAIntent` / `FeedInfo` in that repo returns only this issue. |
| Prize page | https://ethglobal.com/events/ethonline2026/prizes/uniswap-foundation (HTTP 200). Qualification: public GitHub repo, `FEEDBACK.md`, feedback form link. README must point at the changed files. Continuity-track $2k is a separate prize — do not enter this as Continuity. |
| SDK tree | local clone `/tmp/uniswap-sdks` at `35c4e35` (“chore(sdks): Version Packages (#719)”). |
| Contract tree | local clone `/tmp/uniswapx` at `fd60225`. Authoritative hasher is `src/v4/hooks/dca/DCALib.sol`. |
| Competing PR | 0. Recheck immediately before coding. |

Do not copy this note into either Uniswap repo.

## What is wrong (verified against the clones)

`sdks/uniswapx-sdk/src/order/v4/hashing.ts` hashes DCA
intents four ways that `DCALib.sol` does not. A signature
built with the published SDK will not be accepted by
`DCAHook`.

| Axis | Contract (`DCALib.sol`) | SDK (`hashing.ts`) |
| --- | --- | --- |
| `FeedInfo` shape | `FeedInfo(FeedTemplate feedTemplate, address feedAddress, string feedType)` plus nested `FeedTemplate` (`DCALib.sol:25-27`, `DCAStructs.sol:6-18`) | `FeedInfo(bytes32 feedId, address feed_address, string feedType)` (`hashing.ts:287-288`). `FeedTemplate` does not exist in the SDK. |
| Referenced-struct order in `DCA_INTENT_TYPE` | `FeedInfo`, `FeedTemplate`, `OutputAllocation`, `PrivateIntent` (`DCALib.sol:37-41`) | `OutputAllocation` then `PrivateIntent` (which already appends old `FeedInfo`) (`hashing.ts:407-426`) |
| `string feedType` | `keccak256(bytes(feeds[i].feedType))` (`DCALib.sol:78`) | `defaultAbiCoder.encode(..., "string", feed.feedType)` (`hashing.ts:317-323`) — encodes the string, not its hash |
| Struct-array hashing | `keccak256(abi.encodePacked(hashes))` (`DCALib.sol:81, 90`) | `defaultAbiCoder.encode(["bytes32[]"], [hashes])` (`hashing.ts:331-336, 397-402`) — adds offset + length words |

The same file already does the right thing elsewhere:
`hashHybridOutputs` / `hashPriceCurve` use
`ethers.utils.solidityPack` (`hashing.ts:196-214`).
`DCA_COSIGNER_DATA_TYPE` matches the contract
byte-for-byte (`hashing.ts:495-496` vs `DCALib.sol:44-45`).
Only the DCA intent path is stale (landed 2025-12-19 as
SDK PR #432 against the pre-#351 `FeedInfo`).

## File-level map — open these first on 4 Sep

### SDK (the PR)

| File | Why |
| --- | --- |
| `sdks/uniswapx-sdk/src/order/v4/types.ts` | Replace `FeedInfo` (`~198`) with `FeedTemplate` + `feedAddress` (camelCase, matching the contract). Keep `DCAIntent` / `PrivateIntent` / `OutputAllocation` field order. |
| `sdks/uniswapx-sdk/src/order/v4/hashing.ts` | Rewrite `FEED_INFO_TYPE`, add `FEED_TEMPLATE_TYPE`, fix `PRIVATE_INTENT_TYPE` and `DCA_INTENT_TYPE` suffix order (alphabetical referenced structs). Hash strings with `keccak256(toUtf8Bytes(...))`. Hash arrays with `solidityPack` of `bytes32` hashes, not `defaultAbiCoder.encode(["bytes32[]"])`. Export `hashFeedTemplate` if tests need it. Leave `hashDCACosignerData` alone. |
| `sdks/uniswapx-sdk/src/order/v4/index.ts` | Re-export any new types / hash helpers used by tests. |
| `sdks/uniswapx-sdk/src/order/v4/hashing.test.ts` (new) | There is **no** DCA hash test today (only `HybridOrder.test.ts`). Add fixtures that match `DCALib.hash` / `hashPrivateIntent` / `_hashFeedInfoArray`. Prefer Foundry FFI or a checked-in Solidity fixture if `FFISignDCAIntent.sol` is present on the UniswapX tip after a full clone; otherwise compute expected hashes with a tiny `forge` script against `DCALib` and paste them. Cover: empty arrays, one feed, two feeds, empty vs non-empty `feedType`, nested `FeedTemplate` string arrays. |
| `sdks/uniswapx-sdk/src/order/index.ts` | Only if the public barrel currently exports the old `FeedInfo` shape — update the export, do not silently break Hybrid types. |

Do not bump the published package version in this PR unless
maintainers ask. Do not change Hybrid hashing.

### Contract (read-only reference, do not PR unless a fixture is missing)

| File | Why |
| --- | --- |
| `src/v4/hooks/dca/DCALib.sol` | Source of truth for type strings and `_hashFeedTemplate` / `_hashFeedInfoArray` / `_hashOutputAllocations` / `hash` / `hashWithInnerHash`. |
| `src/v4/hooks/dca/DCAStructs.sol` | `FeedTemplate`, `FeedInfo`, `DCAIntent`, `PrivateIntent`. |
| `src/v4/hooks/dca/DCAHook.sol` | Confirm the hook calls `DCALib.hash` / `hashWithInnerHash` on the signed digest. Do not change it. |

## Acceptance

1. `hashDCAIntent` + `hashPrivateIntent` on a fixture equal
   `DCALib.hash` / `hashPrivateIntent` for the same struct.
2. Array hashing matches `abi.encodePacked` (empty array →
   `keccak256("")`).
3. Existing Hybrid tests still pass.
4. Issue #720 is referenced in the PR body.
5. After the window opens: commit in small steps, add
   `FEEDBACK.md` in the ETHOnline submission repo (not in
   Uniswap/sdks unless they want it), and file the Uniswap
   feedback form with that link.

## Human blockers

- ETHGlobal hacker application + 0.01 ETH stake.
- A GitHub account that can open a PR on a fork of
  `Uniswap/sdks`. Optional `GITHUB_FORK_TOKEN` so this
  agent can push the branch.
- Public repo for the ETHOnline submission that points at
  the Uniswap PR.

No UniswapX / sdks code before 4 Sep 16:00 UTC.
