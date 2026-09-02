# Goal evidence matrix

**Audited:** 2 September 2026  
**Goal:** Gain crypto assets through legitimate, legal, non-custodial earning opportunities.

| Requirement | Authoritative evidence | Status | Remaining proof |
| --- | --- | --- | --- |
| Research current bounties, grants, hackathons, and paid open-source work | Primary listings and dated results in [`crypto-earning-opportunities-2026-09.md`](crypto-earning-opportunities-2026-09.md) | Proven for the current shortlist | Recheck listings immediately before work because status changes. |
| Rank by speed, effort, payout, eligibility, and risk | Ranked comparison table in the earning-opportunities report | Proven | Update if a listing changes or a stronger opportunity appears. |
| Identify skills, accounts, wallet setup, and other resources | Resources and blockers section in the earning-opportunities report | Proven | Participant must confirm eligibility and provide their own account access; no secrets are required. |
| Avoid scams, guaranteed returns, and capital-at-risk speculation | [`gaining-crypto-assets.md`](gaining-crypto-assets.md) and [`crypto-returns-2026-09.md`](crypto-returns-2026-09.md) | Proven as research and policy | Continue refusing custody, leverage, wallet secrets, and guaranteed-return claims. |
| Select a feasible repository contribution | KeeperHub issue #2105 verified against current `staging`; accepted/confirmed; no competing PR found on Sep 2; frozen install, 27/27 focused tests, lint, and generated-registry type-check passed under Node 24 without tracked source changes | Provisionally proven | Recheck issue, comments, branch, and PR search when the build window opens. |
| Execute repository contribution | No production code or external claim has been made | **Not achieved** | Build window opens Sep 6. User design approval and eligibility confirmation remain unresolved. |
| Submit contribution to the earning program | No KeeperHub PR or DoraHacks BUIDL exists | **Not achieved** | Requires the participant's authenticated GitHub fork, DoraHacks account, contact details, and truthful eligibility. |
| Verify acceptance or judging result | No PR acceptance or official judging result exists | **Not achieved** | Inspect authoritative PR and DoraHacks state after submission. |
| Inspect wallet access and balances | Rechecked 22:28 UTC 2 Sep 2026. First-client KMS still `whitelist-disabled` for `4da950ac-…`. Hydra DCR `b90d07cd-…` still a stub whitelist row. No `session.json`, no `addresses.json`, no `user-provided.json`. `/connect` can now read a MetaMask-injected address and public ETH/USDC on Ethereum and Base. | **Not achieved** | Need Connect approval, a real Portal App ID with the device-code grant, or a MetaMask address shared on `/connect`. |
| Execute a legal acquisition on a funded wallet | No address and no capital. Superteam public API at 22:28 UTC: 28 open listings; only Steve/ZNS are `AGENT_ALLOWED`. KeeperHub #2105 still `open`, 0 PRs, last update 2026-08-20. Build window still Sep 6. | **Not achieved** | Need a funded agent wallet, or a later engineering Superteam/KeeperHub submission that the participant claims. |
| Verify crypto assets gained | No transaction or payout exists | **Not achieved** | Require an onchain transfer or balance change at an address the participant controls. Never publish or take custody of wallet secrets. |

## Current blockers

1. KeeperHub's official build window begins on 6 September 2026; implementation before that may be ineligible.
2. The participant has not confirmed that they are 18+ or disclosed their physical residence for sanctions eligibility.
3. The participant has not confirmed access to GitHub, DoraHacks, a reachable email plus X/Discord handle, or their own EVM wallet address.
4. Product design approval is required before implementation under the repository workflow used for this project.

## Completion rule

Research, a patch, or a submitted entry does not prove crypto was gained. The goal remains active until every explicit requirement is supported by current evidence, including an official result and a payout transaction to an address controlled solely by the participant.
