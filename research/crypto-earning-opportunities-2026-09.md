# Verified crypto earning opportunities

**Checked:** 3 September 2026 01:09 UTC (Agent Bounties MCP feed + Superteam public listings + Sherlock page 1 + the402 health)  
**Scope:** Legitimate, no-capital developer work that can pay crypto or stablecoins. Competitive prizes are not guaranteed income.

## Ranked opportunities

| Rank | Opportunity | Reward and deadline | Effort and eligibility | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | [KeeperHub feature bounty](https://dorahacks.io/hackathon/agent-economy/detail) | $1,000 in stablecoins: two $500 winners; build window Sep 6–18 | Medium–high; software engineering; 18+, solo or team, sanctions restrictions | No capital risk; competition and time risk | Best direct-to-crypto route. Ship a mergeable feature to the open-source repository. Do not implement before Sep 6. |
| 2 | [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) | Async remote hackathon Sep 4–16. Official prize page now HTTP 200 (22:56 UTC). Partner totals on that page: The Graph $15k, Hedera $15k, Arc $10k, World $7k, 1inch $7k, ENS $5k, Uniswap Foundation $5k, Ledger $5k, Privy $5k, Bazantic $3k, Chainlink $2.5k. Hedera’s largest track is still $6k x402 agentic payments ($2k × 3). | High; public GitHub repo, demo video, ETHGlobal application. The Graph “Start Fresh” pool forbids project-specific prior code. | Competitive. Prize rails are sponsor-specific (not a guaranteed on-chain USDC payout from this VM). | Official rules are readable. Do **not** start project-specific code before Sep 4 (would burn Start Fresh). Still needs the participant’s ETHGlobal account and a public GitHub repo they control. See [`ethonline-2026-prizes.md`](ethonline-2026-prizes.md). |
| 3 | [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) | $15,000 pool: $10k/$3k/$2k; deadline Sep 13, 23:59 ET | High; Attestcoin integration, testnet deploy, README, deck, video, plus each member’s legal name, email, and country. Rechecked 22:09 UTC 2 Sep: still open (11 days). | High execution risk; prize is USD-denominated, **not** confirmed as crypto | Not executable from this VM: no GitHub login, no DoraHacks account, and no participant identity. Do not start a CTC build until those exist. |
| 4 | [KeeperHub live-project integration](https://dorahacks.io/hackathon/agent-economy/detail) | $4,000 in stablecoins: $2k/$1.2k/$800; deadline Sep 18 | High; must integrate with a real, already-running project and show a KeeperHub transaction | High integration and judging risk | Attractive only with access to a qualifying live project; a generic wrapper does not qualify. |
| 5 | [Immunefi bug bounties](https://immunefi.com/bug-bounty/) | Official explorer: “Showing all 183 bounty programs,” metrics updated 2 Sep 2026 16:01 UTC. Visible maxima include Ethena $3M and DeXe $500k | Very high security expertise; program-specific KYC and proof-of-concept rules | Severe legal and operational risk outside published scope | Legitimate, but not quick. Stay strictly inside scope and safe-harbor terms. |
| 6 | Superteam `AGENT_ALLOWED` opens ([Steve Arena](https://earn.superteam.fun/listing/steve-agent-arena-launch-your-agent-and-win-500-usdc/), [ZNS](https://earn.superteam.fun/listing/zns-sol/)) | $500 USDC each | Steve: X + 5 mainnet trades (≥10 USDC). ZNS: launch a token and farm volume | Capital and social-account risk; ZNS is a volume contest | **Do not execute from this VM.** Agent registration is parked for a later engineering listing. |
| 7 | Superteam HUMAN_ONLY engineering-adjacent ([Mermail skill](https://earn.superteam.fun/listing/build-and-demo-a-mermail-agent-skill/), [T3N agent](https://earn.superteam.fun/listing/t3n-agent-build-challenge/)) | $500 / $290 USDC | Mermail PR target is [Nudgen-Marketing/mermail-skills](https://github.com/Nudgen-Marketing/mermail-skills) plus a live X demo tagging @Mermailapp. Needs the participant’s GitHub, Mermail console, and X. T3N needs Terminal 3 SSO/DID and a public Google Doc. | Submission-account risk only | Parked. Do not draft a Mermail skill here until those accounts exist — the listing rejects a code walkthrough without a working Mermail demo. |
| 8 | [Agent Bounties](https://agentbounties.app/) standing meta-parents on Base | 2.00 USDC parent reward minus a 1.00 USDC funded child (gross ~1 USDC) plus a 0.01 USDC refundable claim bond; gas extra. Rechecked live via `list_autonomous_bounties` + `get_bounty_feed` at 01:08 UTC 3 Sep: **7 claimable** routed parents (API reliability, MCP, CLI, wallet UX, discovery, distribution). | Needs a **signable Base wallet**, ~1.02 USDC + gas, and a **different registered participant** to settle the child (`self_verification_forbidden`). Readiness: `POST https://api.agentbounties.app/v1/base/agent-wallet/readiness`. | Legal if the child is real work a stranger completes. Dual-wallet farming and GMV “highest volume” leaderboards are not an acquisition strategy. | **Next funded-wallet job**, not executable from this VM today. Syndicated “Binance Agent OS $60k Mini Hackathon” news had **no official binance.com submission page** — do not build against it. |

## Dead ends checked

- [OnlyDust](https://app.onlydust.com/) has closed.
- Code4rena’s public audits list (22:56 UTC 2 Sep): 25 audits, 24 `Completed`, one `Reporting` (Rujira, window ended 16 Jan 2026). No live contest. Cantina’s competitions page timed out / has no public JSON API.
- Gitcoin has no currently verified open application round.
- Bountycaster's current developer filter returned no open posts.
- Superteam search results that appeared active were historical pages marked completed.
- [Collaborators.build](https://collaborators.build/api/bounties) (22:56 UTC 2 Sep): still one `ACTIVE` bounty (README / “Enchance README”). Do not add another. This VM cannot open a GitHub PR on that repo anyway.
- [AgentHansa](https://www.agenthansa.com/api/alliance-war/quests) (22:56 UTC 2 Sep): public quest payload now 50 items, **all `settled`**. Onboarding USDC remains paused. Skip red packets / 1024EX perps. Do not generate a FluxA/Solana keypair here.
- [Clustly](https://www.clustly.ai/docs) (22:35 UTC 2 Sep): USDC-on-Solana escrow is real, but agent registration is an operator-console step (Privy managed wallet + `clk_` key). The old public `POST /api/v1/agent/register` path is 404. Not self-onboardable from this VM.
- [the402.ai](https://api.the402.ai/health) (22:56 UTC 2 Sep): still `status=paused` for “compliance review” since 2026-08-02. Escrow/subscription crons last succeeded 2 Aug.
- [BountyBook](https://www.bountybook.ai/) (22:52 UTC 2 Sep): early-beta x402 board on Base, **0 open** tasks. Auth is a wallet signature. Experimental; do not deposit funds. Not executable without a wallet and an open bounty.
- Superteam HUMAN_ONLY rechecked from listing HTML at 22:34 UTC: Sana.run QA is manual testing of a trading terminal, perps, and a Visa card (needs the participant’s accounts). FairScale is an X quote-tweet campaign due 3 Sep. Mermail still needs a GitHub PR plus an X video.
- Sherlock contests API (23:03 UTC 2 Sep): 50 contests across 5 pages, 49 `FINISHED`, 1 `SHERLOCK_JUDGING` (Tare). No live contest.
- [Drips Stellar Wave](https://www.drips.network/wave/stellar) (23:04 UTC): “There are no active or upcoming Waves at the moment.” Past waves 1–8 only. Needs GitHub + KYC + a Stellar wallet anyway.
- [SolFoundry](https://github.com/SolFoundry/solfoundry) open “issues” are a pile of PRs stuffing the same Solana address into titles. Not a credible payout path. Do not add another PR; this VM has no `gh` login.
- Daydreams TaskMarket / Agoragentic / Dework (gigs.sh, rechecked 23:03 UTC): docs or APIs exist, but each requires a funded Base/EVM wallet this VM does not have. Do not generate a deposit key here.
- Casper Agentic Buildathon 2026 and Eolas x Algo Agent Skills Hackathon are closed (Jul 2026 / Mar 2025).
- [Circle Agent Marketplace](https://developers.circle.com/agent-stack/agent-marketplace) (23:08 UTC 2 Sep): Discovery API reports **1036** live x402 services. Buying needs a funded USDC wallet. Selling needs a payable x402 endpoint, OpenAPI spec, and a **payout wallet address** on a manual intake form (sanctions-screened). No self-serve listing without an address.
- Encode Club’s 5–6 Sep event is IRL London and lists merchandise/pitch prizes, not a remote USDC bounty. Claw Earn’s public host is a `/lander` parking page.
- Skyfire public hosts 403/404 from this VM (23:13 UTC). Not self-onboardable here.
- CodeHawks `competitions.getCompetitions` (23:15 UTC): 45 contests, **0 live and 0 upcoming**. Newest window ended 16 Jul 2026 (BattleChain). Cantina `/api/competitions` is 404.

## KeeperHub candidate queue

Repository state changes quickly. Recheck issues and pull requests before claiming anything.

| Candidate | Evidence on Sep 2 | Decision |
| --- | --- | --- |
| [#2105: OpenAPI workflow-call response examples](https://github.com/keeperhub/keeperhub/issues/2105) | Rechecked 22:56 UTC 2 Sep via GitHub API: still `open`, no `pull_request` field, search for PRs mentioning 2105 returned 0. Last issue update 2026-08-20. | Primary candidate after Sep 6: narrow, testable, useful, and likely mergeable. |
| [#2097: protocol-action preflight and idempotency](https://github.com/keeperhub/keeperhub/issues/2097) | Accepted and confirmed; no linked or open PR found. | High safety value, but check overlap with #2004 and #2207 first. |
| [#2062: onboarding ID glossary and cross-links](https://github.com/keeperhub/keeperhub/issues/2062) | Accepted with maintainer-narrowed scope; no linked PR found. | Low-risk documentation fallback; weaker “feature” fit. |
| [#2247: trace-method provider survey](https://github.com/keeperhub/keeperhub/issues/2247) | Accepted, good-first-issue, help-wanted, apparently unclaimed. | Useful research, but the bounty asks for a feature. |
| [#2240: threshold-over-state trigger](https://github.com/keeperhub/keeperhub/issues/2240) | Accepted/help-wanted; unresolved design questions cover edge detection, re-arming, deduplication, and scaling. | Strong product value but too broad for quick work without maintainer decisions. |

Already have PRs — do not duplicate: #2208 (PR #2215), #2211 (PR #2217), #2206 (PR #2213), #2230 (PR #2228), #2196 (PR #2197). GitHub timeline check 2 Sep 2026.

## Contribution gate for candidate #2105

KeeperHub's contribution policy requires:

- Target the `staging` branch.
- Reference accepted issue #2105 in the title, for example `fix(openapi): #2105 add workflow response examples`, and use `Closes #2105` in the pull-request body.
- Use Node.js 24+ and pnpm.
- Follow test-first development with `pnpm exec vitest run tests/unit/openapi-route.test.ts`.
- Run `pnpm fix` and `pnpm type-check` before submission.
- Commit no credentials, private keys, API keys, or `.env` files.

The current source confirms the issue precisely: `app/api/openapi/route.ts` has separate hardcoded read and write success schemas with no whole-response examples, while `tests/unit/openapi-route.test.ts` is the focused verification surface. No dependency, database, wallet, or mainnet transaction is required.

The clone's default branch is `staging`, and its HEAD matched the freshly fetched `origin/staging` commit `d249519` during this check. GitHub search returned zero open pull requests referencing `2105`. OpenAPI 3.1 uses a bare `examples` array inside a Schema Object, while a Media Type Object uses either a singular `example` value or a named `examples` map. Because #2105 specifically asks for values on both hardcoded response schemas and KeeperHub already uses schema-level `examples` arrays, schema-level arrays are the most consistent implementation candidate. Recheck all of this after Sep 6.

Build feasibility was verified without changing KeeperHub source: the required Node.js 24 runtime and pnpm 10 were activated, the frozen lockfile installed successfully, and `pnpm exec vitest run tests/unit/openapi-route.test.ts` passed all **27 tests** on the Sep 2 `staging` commit. `pnpm check` also passed with one pre-existing oversized-fixture warning. A fresh-clone `pnpm type-check` initially failed because generated registries were absent; the documented `pnpm discover-plugins` step generated them, after which type-check passed with no tracked source changes. This is baseline evidence only; it is not submission code and does not satisfy the bounty.

## Resources and blockers

Needed from the participant:

- Confirmation that they are 18+ and physically located outside sanctions-restricted regions.
- An authenticated GitHub account and fork for opening the KeeperHub pull request.
- A DoraHacks account and event registration.
- A reachable email plus an X or Discord handle.
- A self-custody wallet address on the payout network selected by the organizer. The listing confirms stablecoin payouts but does **not** name the chain; confirm it with KeeperHub before creating or funding a wallet. Never share its seed phrase or private key.

Potentially needed later:

- Official faucet tokens for testnet-only integration work.
- A KeeperHub organization API key stored as a secret environment variable, never pasted into chat or committed.
- A demo video and, for the main integration track, a public testnet transaction link.

Not needed: investment capital, trading deposits, exchange API keys, seed phrases, or private keys.

## Execution order

1. Confirm participant eligibility.
2. Recheck #2105 and the open pull-request list when the build window opens Sep 6.
3. Comment to claim the issue before coding so contributors do not duplicate work.
4. Implement with a failing test first, then run the focused suite and required repository checks.
5. Open a pull request against `staging`.
6. Register and submit a separate BUIDL for the KeeperHub feature bounty with the source link and required evidence.
7. Treat an accepted PR and a submitted BUIDL as progress only. Earnings are verified only after an official winner result and an onchain payout to the participant's own wallet.
