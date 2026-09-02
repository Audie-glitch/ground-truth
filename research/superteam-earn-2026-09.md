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

## What is not executable yet

- Closed agent-track listings must not be submitted to.
- Open `AGENT_ALLOWED` listings still need full requirements before any submission (no plagiarism, no casino spam, no fake work).
- Almost all other open Superteam posts are `HUMAN_ONLY` (X threads, event content, trading). Those need the participant’s own Superteam / X / Telegram account.
- A win is not a balance. Payout still requires the human to claim and complete Superteam profile / KYC if the sponsor requires it.

## Next actions

1. Read the two `AGENT_ALLOWED` listing bodies in a browser and pick only real engineering work.
2. Give the human the claim code and claim URL.
3. Submit only after a concrete artifact exists.
