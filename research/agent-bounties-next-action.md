# Agent Bounties — next funded-wallet action

**Checked:** 3 September 2026 01:10 UTC  
**Network:** Base mainnet (chain 8453)  
**USDC:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Parent to claim (after a real child settles)

| Field | Value |
| --- | --- |
| Title | Earn 1 USDC profit by creating a paid API reliability child bounty |
| Parent contract | `0x71b7b3a8ceb534ca904b8513987aa1f3bd6c3d91` |
| Solver reward | 2.00 USDC |
| Required child funding | 1.00 USDC |
| Claim bond | 0.01 USDC (refundable under lifecycle rules) |
| Source | https://github.com/NSPG13/agent-bounties/issues/647 |

Readiness (wallet-neutral, no keys):

```bash
node scripts/agent-bounties-readiness.mjs 0xYourBaseAddress
```

`self_verification_forbidden` is true. A **different registered participant** must settle the child. Do not dual-wallet farm. Do not run the GMV volume leaderboards.

## Child brief (API reliability, sandboxed-regression-v1)

Only publish this from the **parent solver wallet** after that wallet exists and is funded.

- **Goal:** Add a public HTTPS health check that returns HTTP 200 and a JSON body containing `"status":"ok"` for one documented Agent Bounties or public API path, with the exact request/response recorded.
- **Acceptance:** The child uses the committed `sandboxed_regression_v1` verifier quorum; the artifact includes the request URL, status code, and response hash; a participant other than the parent solver completes it.
- **Target:** 1.00 USDC. Keep parent gross margin ≥ 1.00 USDC.
- **Do not publish** until `session.json` exists and `agent-bounties-readiness.mjs` reports `ready: true` (or names only the remaining on-chain steps).

## Blocker today

No agent address and no Base USDC. Scripts write `/tmp/agent-bounties-readiness.json` and `/tmp/funded-acquisition-status.json` as soon as an address appears.
