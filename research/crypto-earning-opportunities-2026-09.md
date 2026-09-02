# Verified crypto earning opportunities

**Checked:** 2 September 2026 (rechecked Superteam, Code4rena, and ETHOnline at 22:39 UTC)  
**Scope:** Legitimate, no-capital developer work that can pay crypto or stablecoins. Competitive prizes are not guaranteed income.

## Ranked opportunities

| Rank | Opportunity | Reward and deadline | Effort and eligibility | Risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | [KeeperHub feature bounty](https://dorahacks.io/hackathon/agent-economy/detail) | $1,000 in stablecoins: two $500 winners; build window Sep 6–18 | Medium–high; software engineering; 18+, solo or team, sanctions restrictions | No capital risk; competition and time risk | Best direct-to-crypto route. Ship a mergeable feature to the open-source repository. Do not implement before Sep 6. |
| 2 | [ETHOnline 2026](https://ethglobal.com/events/ethonline2026) | Async remote hackathon Sep 4–16; ETHGlobal lists $100k+ partner prizes. Hedera published $15k including a $6k x402 agentic-payments track ($2k × 3). | High; public GitHub repo, demo video under 5 minutes, ETHGlobal application. Official prize page returned HTTP 500 from this VM at 22:39 UTC; Hedera split verified via [Genfinity 27 Aug 2026](https://genfinity.io/2026/08/27/hedera-15k-bounties-ethonline-2026-agentic-payments-tokenization/). | Prize rail not confirmed as on-chain USDC from the official page (Cloudflare/500). Competitive. | Next calendar opening (starts Sep 4). Do not start a submission until the participant has an ETHGlobal account and this VM can read the official prize rules. |
| 3 | [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) | $15,000 pool: $10k/$3k/$2k; deadline Sep 13, 23:59 ET | High; Attestcoin integration, testnet deploy, README, deck, video, plus each member’s legal name, email, and country. Rechecked 22:09 UTC 2 Sep: still open (11 days). | High execution risk; prize is USD-denominated, **not** confirmed as crypto | Not executable from this VM: no GitHub login, no DoraHacks account, and no participant identity. Do not start a CTC build until those exist. |
| 4 | [KeeperHub live-project integration](https://dorahacks.io/hackathon/agent-economy/detail) | $4,000 in stablecoins: $2k/$1.2k/$800; deadline Sep 18 | High; must integrate with a real, already-running project and show a KeeperHub transaction | High integration and judging risk | Attractive only with access to a qualifying live project; a generic wrapper does not qualify. |
| 5 | [Immunefi bug bounties](https://immunefi.com/bug-bounty/) | Official explorer: “Showing all 183 bounty programs,” metrics updated 2 Sep 2026 16:01 UTC. Visible maxima include Ethena $3M and DeXe $500k | Very high security expertise; program-specific KYC and proof-of-concept rules | Severe legal and operational risk outside published scope | Legitimate, but not quick. Stay strictly inside scope and safe-harbor terms. |
| 6 | Superteam `AGENT_ALLOWED` opens ([Steve Arena](https://earn.superteam.fun/listing/steve-agent-arena-launch-your-agent-and-win-500-usdc/), [ZNS](https://earn.superteam.fun/listing/zns-sol/)) | $500 USDC each | Steve: X + 5 mainnet trades (≥10 USDC). ZNS: launch a token and farm volume | Capital and social-account risk; ZNS is a volume contest | **Do not execute from this VM.** Agent registration is parked for a later engineering listing. |
| 7 | Superteam HUMAN_ONLY engineering-adjacent ([Mermail skill](https://earn.superteam.fun/listing/build-and-demo-a-mermail-agent-skill/), [T3N agent](https://earn.superteam.fun/listing/t3n-agent-build-challenge/)) | $500 / $290 USDC | Needs the participant’s GitHub, X, or Terminal 3 SSO. This VM cannot submit. T3N also needs Terminal 3 DID + a public Google Doc. | Submission-account risk only | Parked unless the participant opens those accounts and wants to submit themselves. |

## Dead ends checked

- [OnlyDust](https://app.onlydust.com/) has closed.
- Code4rena’s public audits list (22:38 UTC 2 Sep) shows no live 2026 contest; the newest listed window (Rujira) ended 16 Jan 2026. Cantina’s competitions page timed out / has no public JSON API.
- Gitcoin has no currently verified open application round.
- Bountycaster's current developer filter returned no open posts.
- Superteam search results that appeared active were historical pages marked completed.
- [Collaborators.build](https://collaborators.build/api/bounties) (22:35 UTC 2 Sep): one `ACTIVE` bounty (`andr-drgm/collaborators#40`, $100 README). The issue already has a pile of README PRs (#41–#63). Do not add another. This VM cannot open a GitHub PR on that repo anyway.
- [AgentHansa](https://www.agenthansa.com/api/alliance-war/quests) (22:36 UTC 2 Sep): 171 public quests, **all `settled`**. Onboarding USDC is paused. Remaining activity is social posts, red packets, referrals, and a perpetual/prediction desk (1024EX) — skip. Do not generate a FluxA/Solana keypair here to cash out later.
- [Clustly](https://www.clustly.ai/docs) (22:35 UTC 2 Sep): USDC-on-Solana escrow is real, but agent registration is an operator-console step (Privy managed wallet + `clk_` key). The old public `POST /api/v1/agent/register` path is 404. Not self-onboardable from this VM.
- Superteam HUMAN_ONLY rechecked from listing HTML at 22:34 UTC: Sana.run QA is manual testing of a trading terminal, perps, and a Visa card (needs the participant’s accounts). FairScale is an X quote-tweet campaign due 3 Sep. Mermail still needs a GitHub PR plus an X video.

## KeeperHub candidate queue

Repository state changes quickly. Recheck issues and pull requests before claiming anything.

| Candidate | Evidence on Sep 2 | Decision |
| --- | --- | --- |
| [#2105: OpenAPI workflow-call response examples](https://github.com/keeperhub/keeperhub/issues/2105) | Rechecked 22:09 UTC 2 Sep via GitHub API: still `open`, no `pull_request` field, search for PRs mentioning 2105 returned 0. Last issue update 2026-08-20. | Primary candidate after Sep 6: narrow, testable, useful, and likely mergeable. |
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
