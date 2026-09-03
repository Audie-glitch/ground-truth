# Goal evidence matrix

**Audited:** 3 September 2026 16:02 UTC  
**Goal:** Gain crypto assets through legitimate, legal, non-custodial earning opportunities.

| Requirement | Authoritative evidence | Status | Remaining proof |
| --- | --- | --- | --- |
| Research current bounties, grants, hackathons, and paid open-source work | Primary listings and dated results in [`crypto-earning-opportunities-2026-09.md`](crypto-earning-opportunities-2026-09.md) | Proven for the current shortlist | Recheck listings immediately before work because status changes. |
| Rank by speed, effort, payout, eligibility, and risk | Ranked comparison table in the earning-opportunities report | Proven | Update if a listing changes or a stronger opportunity appears. |
| Identify skills, accounts, wallet setup, and other resources | Resources and blockers section in the earning-opportunities report | Proven | Participant must confirm eligibility and provide their own account access; no secrets are required. |
| Avoid scams, guaranteed returns, and capital-at-risk speculation | [`gaining-crypto-assets.md`](gaining-crypto-assets.md) and [`crypto-returns-2026-09.md`](crypto-returns-2026-09.md) | Proven as research and policy | Continue refusing custody, leverage, wallet secrets, and guaranteed-return claims. |
| Select a feasible repository contribution | KeeperHub #2105 still open / unclaimed at 03:12 UTC 3 Sep (0 PRs, 0 comments). Patch spec written. Parallel CTC entry CreditPassport is built and proven against the live verifier; testnet deploy still needs faucet gas. | Provisionally proven | Recheck #2105 on 6 Sep. CreditPassport still needs a funded deployer and the participant's DoraHacks identity. |
| Execute repository contribution | No KeeperHub source change. CreditPassport is original Attestcoin work in-tree; it is not submitted and not deployed to testnet. T3N Vendor Receipts and Mermail skill are in-tree; both still need the participant to submit. | **Not achieved** | KeeperHub window opens Sep 6. CTC deploy + DoraHacks / Superteam / Devpost submit need the participant. |
| Submit contribution to the earning program | No KeeperHub PR or DoraHacks BUIDL exists | **Not achieved** | Requires the participant's authenticated GitHub fork, DoraHacks account, contact details, and truthful eligibility. |
| Verify acceptance or judging result | No PR acceptance or official judging result exists | **Not achieved** | Inspect authoritative PR and DoraHacks state after submission. |
| Inspect wallet access and balances | Rechecked 16:02 UTC 3 Sep 2026. Still no `session.json` / `addresses.json` / `user-provided.json`. First-client tokens ~50 min left. DCR2 Connect code `K7Kw6eej` live at http://127.0.0.1:43117/connect (~8 min TTL on this mint). Client `b90d07cd-…` still a stub whitelist row. | **Not achieved** | Need Connect approval, Portal App ID, or MetaMask/Base address on `/connect`. |
| Execute a legal acquisition on a funded wallet | Rechecked 16:00 UTC 3 Sep. `/tmp/funded-acquisition-status.json` still `no-address`. Agent Bounties parent `0x71b7…` needs ~1.1 USDC + Base gas on a distinct child solver. No on-chain tx executed. | **Not achieved** | Funded Base signer + Connect session, or user signs Agent Bounties from own MetaMask at https://agentbounties.app/earn.html . |
| Verify crypto assets gained | No transaction or payout exists | **Not achieved** | Require an onchain transfer or balance change at an address the participant controls. Never publish or take custody of wallet secrets. |

## Current blockers

1. KeeperHub's official build window begins on 6 September 2026; implementation before that may be ineligible.
2. The participant has not confirmed that they are 18+ or disclosed their physical residence for sanctions eligibility.
3. The participant has not confirmed access to GitHub, DoraHacks, a reachable email plus X/Discord handle, or their own EVM wallet address.
4. Product design approval is required before implementation under the repository workflow used for this project.

## Completion rule

Research, a patch, or a submitted entry does not prove crypto was gained. The goal remains active until every explicit requirement is supported by current evidence, including an official result and a payout transaction to an address controlled solely by the participant.
