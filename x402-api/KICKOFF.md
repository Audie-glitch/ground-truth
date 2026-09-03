# ETHOnline 2026 kickoff (do not write project code before this)

Event window: **4–16 September 2026**. ETHGlobal Start Fresh: no
project-specific code before the official start. Rechecked 3 Sep 02:30 UTC:
`@x402/hono`, `@x402/fetch`, `@x402/hedera`, `@x402/core` are all **2.24.0**
on npm, matching `DESIGN.md`.

First commit is allowed from **16:00 UTC on 4 September 2026** after the
ETHGlobal schedule still says the hackathon has opened. If their kickoff is
later that day, wait for it. Small frequent commits inside the window.

## Minute-one scaffold (run only after the window is open)

Scaffold into a subdirectory, then move up, same as this repo's other apps:

```bash
cd /workspace
mkdir -p tmp-x402 && cd tmp-x402
# Hono + TS, not Next.js. Keep it a single service with a tiny web UI later.
npm init -y
npm install hono @hono/node-server @x402/hono@2.24.0 @x402/core@2.24.0
npm install -D typescript tsx vitest @types/node
# First commit: README + / health + /v1/probe stub + one synthetic PDF fixture.
```

Do **not** copy CreditPassport or SignLens source into this tree. Disclose
`@x402/*`, `pdfjs-dist` / `unpdf`, and any fixture generators as pre-existing
libraries in the ETHGlobal submission.

## Day-1 file list (from DESIGN.md)

| Path | Purpose |
| --- | --- |
| `src/server.ts` | Hono app: `GET /`, `POST /v1/probe` |
| `src/extract.ts` | `pdfjs-dist` text + positions |
| `src/reconcile.ts` | running-balance check |
| `test/fixtures/simple-3row.pdf` + expected CSV | first passing test |
| `README.md` | what it is, how to run, x402 terms |

x402 middleware and Hedera/Arc networks come on Sep 7+, not day 1. Route
prices stay static strings; page-bucket paths `/v1/parse/{s,m,l}` as in
`DESIGN.md`.

## Parallel Start Fresh app the same morning

1inch **Build an Aqua App** ($2,500 / $1,500 / $1,000): AquaFloor.
Design: [`../aqua-app/DESIGN.md`](../aqua-app/DESIGN.md). Kickoff:
[`../aqua-app/KICKOFF.md`](../aqua-app/KICKOFF.md). Separate
directory and commit history from this API. No Aqua source before
the window.

## Backup PRs if the API slips

- Hedera Harness: issue
  [#8](https://github.com/hedera-dev/hedera-harness/issues/8) (HOL Guard
  validator in ASSERT). Maintainer-authored, 0 comments, no linked PR as of
  3 Sep 02:41 UTC. File-level plan:
  [`research/ethonline-hedera-harness-8.md`](../research/ethonline-hedera-harness-8.md).
  Open PR is enough for that bounty.
- Uniswap Foundation: official issue
  [Uniswap/sdks#720](https://github.com/Uniswap/sdks/issues/720)
  (uniswapx-sdk DCA EIP-712 vs `DCALib.sol`, 0 PRs). File-level
  plan: [`research/ethonline-uniswap-sdks-720.md`](../research/ethonline-uniswap-sdks-720.md).
  After the PR: `FEEDBACK.md` + the Uniswap feedback form.

## Human blockers still open

- ETHGlobal hacker application + 0.01 ETH stake (refunded on submit).
- bazantic.com account (username).
- Hedera ECDSA testnet account + testnet USDC `0.0.429274` as secrets
  `HEDERA_ACCOUNT_ID` / `HEDERA_PRIVATE_KEY` (needed by Sep 7, not day 1).
