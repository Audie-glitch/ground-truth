# Superteam Earn agent path (2 Sep 2026)

Legal no-capital payouts on Superteam Earn can go to a human claimant after an agent submits work. Agents do not hold a wallet. The human claims at `https://superteam.fun/earn/claim/` with a `claimCode`.

## What was verified from this VM

| Check | Result |
| --- | --- |
| Agent API base | `https://superteam.fun` (`POST /api/agents` returns 201) |
| `GET /api/agents/listings/live?take=20` | Rechecked 22:56 UTC: still 9 listings, **all `isWinnersAnnounced: true`** (announced Feb–Jul 2026). Do not submit. |
| `GET /api/listings?take=50` | 28 currently open listings at 22:56 UTC 2 Sep 2026 |
| Open listings with `agentAccess=AGENT_ALLOWED` | Still only `zns-sol` ($500 USDC, due 9 Sep) and `steve-agent-arena-launch-your-agent-and-win-500-usdc` ($500 USDC, due 16 Sep). Agent details endpoint still 404 for those slugs. |
| Agent details endpoint for those slugs | 404 |
| Listing HTML | JS-rendered; `__NEXT_DATA__` plus a live browser pass confirmed full requirements at 21:53 UTC |

An agent named `elder-plinius-cursor` was registered. Credentials live only in `~/.superteam-earn/agent.json` (gitignored). The claim code is for the human operator, not for this VM.

## Open AGENT_ALLOWED listings — not executable from this VM

Pulled from `__NEXT_DATA__` on the listing pages (21:43 UTC) and rechecked in a live browser (21:53 UTC 2 Sep 2026). Both listings were still OPEN.

### Steve Agent Arena ($500 USDC, due 16 Sep)

Minimums during the 2-week window: create a Steve agent at steve.oobeprotocol.ai; connect X and publish a public post tagging @SteveTheAgentAI and @OOBEonSol; reach 1,000 Arena XP; execute **5 Solana mainnet trades** through the agent wallet (Adrena/Phoenix perps or Jupiter swaps of at least **10 USDC**). Wash trading is banned. Submission also needs the Steve handle, the X post, and a short strategy write-up. Needs the participant’s X account and trading capital. Not a zero-capital engineering task from this VM.

### ZNS Solana Creator Challenge ($500 USDC, due 9 Sep)

Launch a token on [ZNS Launchpad](https://zns.bio/launchpad/create?chain=solana), then hit $500 organic volume, 5 holders, and 2 days of activity. Ranking is primarily organic volume. That is a token-launch / volume contest. Do not farm it from this VM.

## Rechecked HUMAN_ONLY posts (22:00 UTC 2 Sep 2026)

None of these can be submitted by the registered Superteam agent.

| Slug | Why it is not executable here |
| --- | --- |
| `dollar1000-usdc-manic-bug-bounty` | Requires depositing USDC into Manic’s Polymarket integration (leveraged prediction markets). Capital + user Manic account. Skip. |
| `build-and-demo-a-mermail-agent-skill` | Real engineering, but `HUMAN_ONLY`. Rechecked 22:48 UTC 2 Sep: still OPEN, $500 USDC, due 23 Sep. PR target is [Nudgen-Marketing/mermail-skills](https://github.com/Nudgen-Marketing/mermail-skills). Also needs a 2–5 minute X demo tagging @Mermailapp that shows the skill using Mermail (not a code walkthrough). This VM has no GitHub login, no Mermail console account, and no X. |
| `t3n-agent-build-challenge` | Needs the participant’s Terminal 3 SSO, DID, email, and a public Google Doc. |

## What is not executable yet

- Closed agent-track listings must not be submitted to.
- Almost all other open Superteam posts are `HUMAN_ONLY` (X threads, event content, trading). Those need the participant’s own Superteam / X / Telegram account.
- A win is not a balance. Payout still requires the human to claim and complete Superteam profile / KYC if the sponsor requires it.

## Next actions

1. Keep the Superteam agent registration for if a real engineering `AGENT_ALLOWED` listing opens.
2. KeeperHub feature bounty remains the best no-capital engineering path (build window Sep 6).
3. Phantom agent wallet still needs a Portal `PHANTOM_APP_ID` or a Connect approval in the participant’s browser.
