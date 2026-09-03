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
| Inspect wallet access and balances | Rechecked 01:23 UTC 3 Sep 2026. Still no `session.json` / `addresses.json` / `user-provided.json`. First-client tokens valid until ~01:58 UTC. DCR2 Connect code reminted to `xc7DQseV` (10 min TTL). Client `b90d07cd-…` still a stub whitelist row. | **Not achieved** | Need a real Portal App ID with the device-code grant, Connect approval that actually returns a `walletId`, or a MetaMask address shared on `/connect`. |
| Execute a legal acquisition on a funded wallet | Rechecked 01:21 UTC 3 Sep. Still no address and no capital. GMTrade treasury+LP static review: no finding. Superteam still Steve/ZNS only. Agent Bounties still needs ~1.02 USDC + a distinct child solver. | **Not achieved** | Need a funded agent wallet, or a later ETHOnline/KeeperHub/Superteam submission that the participant claims. |
| Verify crypto assets gained | No transaction or payout exists | **Not achieved** | Require an onchain transfer or balance change at an address the participant controls. Never publish or take custody of wallet secrets. |

## Current blockers

1. KeeperHub's official build window begins on 6 September 2026; implementation before that may be ineligible.
2. The participant has not confirmed that they are 18+ or disclosed their physical residence for sanctions eligibility.
3. The participant has not confirmed access to GitHub, DoraHacks, a reachable email plus X/Discord handle, or their own EVM wallet address.
4. Product design approval is required before implementation under the repository workflow used for this project.

## Completion rule

Research, a patch, or a submitted entry does not prove crypto was gained. The goal remains active until every explicit requirement is supported by current evidence, including an official result and a payout transaction to an address controlled solely by the participant.
