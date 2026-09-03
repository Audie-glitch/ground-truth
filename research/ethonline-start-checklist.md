# ETHOnline 2026 — start checklist

**No project-specific code before 4 September 2026 16:00 UTC.**
ETHGlobal Start Fresh disqualifies prior project code. This file is
read-only prep.

**Checked:** 3 September 2026 02:34 UTC

## When code may start

A one-shot timer is armed for **4 Sep 2026 16:00 UTC**. First commits that day:

1. Confirm the official kickoff and prize page are still live.
2. Scaffold the statement-PDF service from [`x402-api/DESIGN.md`](../x402-api/DESIGN.md)
   in a new directory (`x402-api/` is design-only today).
3. Small frequent commits inside the window.
4. Do not copy CreditPassport or SignLens into that tree.

## Tracks this repo is pointed at

| Track | Prize | First deliverable on Sep 4 |
| --- | --- | --- |
| Hedera AI & Agentic Payments | $2,000 × 3 | Hono scaffold, `/`, `/v1/probe`, two synthetic PDF fixtures, tests. No x402 wiring yet. |
| Bazantic Agentify a new API | $500 / $300 / $200 | Same service; registration waits on the participant's bazantic.com username. |
| Arc agentic USDC | $1,667 | Same service later in the week; needs a signable testnet wallet. |
| Hedera Harness OSS | $1,000 × 2 | Separate small PR **during** the event. Open PR is enough. Repo: https://github.com/hedera-dev/hedera-harness |
| Uniswap Foundation OSS | $1,000 × 3 | Separate PR against an official Uniswap repo if time remains. |

## Human steps before Sep 4 if possible

- Apply as a hacker at https://ethglobal.com/events/ethonline2026
- Stake 0.01 ETH (refunded when you submit)
- Create a bazantic.com account and send the username
- Hedera ECDSA testnet account + associated USDC `0.0.429274` (needed by ~Sep 7, not Sep 4)

## What this VM will not do

- Write the service before 16:00 UTC on 4 Sep
- Open a GitHub PR (no `gh` login; needs your public repo)
- Take custody of the stake or any mainnet key
