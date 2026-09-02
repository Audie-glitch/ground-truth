# Superteam Earn agent path (2 Sep 2026)

Legal no-capital payouts on Superteam Earn can go to a human claimant after an agent submits work. Agents do not hold a wallet. The human claims at `https://superteam.fun/earn/claim/` with a `claimCode`.

## What was verified from this VM

| Check | Result |
| --- | --- |
| Agent API base | `https://superteam.fun` (`POST /api/agents` returns 201) |
| `GET /api/agents/listings/live?take=20` | 9 listings, **all already have winners** (deadlines Feb–Jul 2026) |
| `GET /api/listings?take=50` | 29 currently open human listings |
| Open listings with `agentAccess=AGENT_ALLOWED` | `zns-sol` ($500 USDC, due 9 Sep) and `steve-agent-arena-launch-your-agent-and-win-500-usdc` ($500 USDC, due 16 Sep) |
| Agent details endpoint for those slugs | 404 |
| Listing HTML | JS-rendered; full requirements not extracted here |
| Firecrawl scrape | Rate-limited |

An agent named `elder-plinius-cursor` was registered. Credentials live only in `~/.superteam-earn/agent.json` (gitignored). The claim code is for the human operator, not for this VM.

## Open AGENT_ALLOWED listings — not executable from this VM

Pulled from `__NEXT_DATA__` on the listing pages (21:43 UTC 2 Sep 2026).

### Steve Agent Arena ($500 USDC, due 16 Sep)

Minimums: create a Steve agent at steve.oobeprotocol.ai; connect X and publish a public post tagging @SteveTheAgentAI and @OOBEonSol; reach 1,000 Arena XP; execute **5 Solana mainnet trades** (Adrena/Phoenix perps or Jupiter swaps of at least **10 USDC**). Wash trading is banned. Needs the participant’s X account and trading capital. Not a zero-capital engineering task.

### ZNS Solana Creator Challenge ($500 USDC, due 9 Sep)

Launch a token on [ZNS Launchpad](https://zns.bio/launchpad/create?chain=solana), then hit $500 organic volume, 5 holders, and 2 days of activity. That is a token-launch / volume contest. Do not farm it from this VM.

## What is not executable yet

- Closed agent-track listings must not be submitted to.
- Almost all other open Superteam posts are `HUMAN_ONLY` (X threads, event content, trading). Those need the participant’s own Superteam / X / Telegram account.
- A win is not a balance. Payout still requires the human to claim and complete Superteam profile / KYC if the sponsor requires it.

## Next actions

1. Keep the Superteam agent registration for if a real engineering `AGENT_ALLOWED` listing opens.
2. KeeperHub feature bounty remains the best no-capital engineering path (build window Sep 6).
3. Phantom agent wallet still needs a Portal `PHANTOM_APP_ID` or a Connect approval in the participant’s browser.
