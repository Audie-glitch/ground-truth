# Gaining crypto assets: a tool and the research behind it

Two things live here, both aimed at the same question — how to accumulate crypto
without trading for speed, surrendering custody, or trusting guaranteed-return
claims.

1. **Ground Truth**, a strategy backtester and paper-trading desk you can run
   locally. It replays trading rules against real historical prices with fees
   and slippage charged on every fill.
2. **Research notes** in [`research/`](research/), covering legitimate earning
   paths (bounties, grants, hackathons, paid open-source work) and what this
   environment can and cannot do.

The backtester is simulation only: it holds no keys and cannot move funds.
Agent wallet setup is a separate page at `/connect` — connect MetaMask to share
an address you already control, approve Phantom Connect for a dedicated agent
wallet, or paste a Portal App ID. Never paste a seed phrase. Nothing here is
financial advice.

---

# Ground Truth

Point it at a real asset, pick a trading rule, and it replays that rule against
real historical daily prices with exchange fees and slippage charged on every
fill — then shows the result next to the only benchmark that matters: buying
once and doing nothing.

## Why it exists

"How do I make quick gains?" is a question that mostly gets answered by people
selling something. This is the version of that question you can actually check:
run the strategy, pay the real costs, and compare it to the do-nothing baseline.
The usual answer is that the do-nothing baseline wins, and seeing that on your
own chosen asset is more convincing than being told.

The **Strategy shootout** tab is the fastest way to see this: it runs every
built-in strategy at its default settings over the same window and ranks them.

The **Walk-forward** tab goes one step further: it grid-searches parameters on
the first portion of the window (train), freezes the winner, and runs it on the
remaining unseen dates (test). A strategy that looks brilliant on train and
collapses on test was fitted to the past, not discovered in the market.

## Running it

```bash
npm install
npm run dev
```

Open http://localhost:43117.

No API keys and no environment variables are required. Market data comes from
CoinGecko's public endpoints, which are keyless but rate limited; responses are
cached in-process so that dragging a parameter slider does not hammer the API.
If you do get rate limited, the app says so and keeps working with cached data.

```bash
npm test      # unit tests for the simulation engine
npm run lint
npm run build
```

## The strategies

| Strategy | Rule |
| --- | --- |
| Buy & hold | Buy once on day one, hold to the end. The benchmark. |
| Dollar-cost average | Split the same capital into equal buys on a fixed schedule. |
| Moving-average crossover | Hold while a fast moving average is above a slow one. |
| RSI mean reversion | Buy when RSI is oversold, sell when it is overbought. |
| Breakout momentum | Buy N-day highs, exit on a trailing stop. |
| Quick-flip scalper | Buy any dip, take a small profit, repeat. |

The quick-flip scalper is included deliberately. It is the shape most "quick
gains" advice actually takes, and it is the clearest demonstration of how a
strategy can win the large majority of its individual trades while still losing
to buy-and-hold once fees and spread are paid on every one of them.

## How the simulation works

- **Data.** Daily closes from CoinGecko, up to 365 days (the keyless tier's
  limit). One point per UTC day.
- **Fills.** A strategy decides using data available at bar `i` and fills at
  that same bar's close. No rule may read a future bar.
- **Costs.** A fee (default 0.10%, a typical exchange taker fee) is charged on
  the notional of every fill, and slippage (default 0.05%) worsens the
  execution price on both sides. Both are adjustable.
- **Accounting.** Cash and units are tracked explicitly rather than as a return
  stream, so costs are charged against real notional the way an exchange would.
- **Metrics.** Total return, annualised return, max drawdown from the running
  peak, annualised volatility, Sharpe at a zero risk-free rate, order count,
  total fees, win rate over completed round trips, and time in market.

### What it deliberately does not model

These all make backtested results look better than reality, so treat every
number here as an optimistic upper bound:

- **Intraday movement.** With daily closes, a stop or take-profit triggers at
  the next daily close rather than the moment price crosses it.
- **Liquidity.** Slippage is a flat percentage. Real slippage grows with order
  size and explodes in thin markets, which is exactly where "quick gains"
  strategies tend to operate.
- **Survivorship.** The asset list is today's top coins by market cap. Coins
  that went to zero are not in it, so any conclusion drawn about "crypto"
  generally is biased upward.
- **Taxes**, funding rates, borrow costs, and exchange downtime.
- **Fitting.** Tuning parameters until a backtest looks good fits the rule to
  that window. A rule that wins on one asset over one window and loses on the
  next was fitted, not discovered.

## Project layout

```
src/lib/indicators.ts   SMA, Wilder's RSI, rolling high, drawdown, dispersion
src/lib/strategies.ts   Strategy definitions, parameters, and signal generation
src/lib/backtest.ts     The simulation engine and performance metrics
src/lib/coingecko.ts    Market data with in-process caching and retry
src/lib/paper.ts        Paper-trading order logic (pure, fully tested)
src/lib/paper-store.ts  localStorage persistence via useSyncExternalStore
src/app/api/            Route handlers for markets, backtest, and comparison
src/components/         The desk UI
```

The paper account lives entirely in your browser's `localStorage`. Clearing site
data resets it, and so does the Reset button.

---

# Earning pipeline (bounties and hackathons that pay in crypto)

The plan, verified opportunities, schedule, and the steps only a human can do
are in [`PIPELINE.md`](PIPELINE.md). Entries built in this repository:

| Directory | Entry | Event | Status |
| --- | --- | --- | --- |
| [`creditpassport/`](creditpassport/) | CreditPassport: Attestcoin-verified cross-chain payment history and policy-capped credit lines on Creditcoin (contracts, agent, web, deck) | BUIDL CTC 2026 Fall, deadline Sep 13 | Built and proven against the live verifier; awaiting a funded testnet key for deployment. See `creditpassport/SUBMISSION.md`. |
| [`signlens/`](signlens/) | SignLens: pre-signature inspector for wallet requests | 3rd-Web-Hack (Devpost), deadline Sep 27 | Built, tested, demo recorded. See `signlens/SUBMISSION.md`. |
| [`mermail-onchain-receipts/`](mermail-onchain-receipts/) | Mermail skill that files explorer links and `0x` payment hashes from the inbox | Superteam Earn, due 23 Sep | Official-format skill + `upstream.patch`. Needs your fork/PR, Mermail MCP, and an X demo. See `mermail-onchain-receipts/SUBMISSION.md`. |
| [`x402-api/`](x402-api/) | Statement PDFs to reconciled CSV, paid per page over x402 | ETHOnline 2026, Sep 4-16 | Design only until the window opens. |
| [`keeperhub/`](keeperhub/) | #2240 design, elizaOS main-track plan, and the #2105 OpenAPI examples patch spec | KeeperHub Agent Economy hackathon, Sep 6-18 | Designs ready; no KeeperHub source until Sep 6. |
| `/earn` | Dated window board for the live earning paths | This repo | Open windows ranked in code; not a payout. |

Bug-bounty target selection and review notes: [`research/bug-bounty-review-log.md`](research/bug-bounty-review-log.md).

# Research notes

- [`research/gaining-crypto-assets.md`](research/gaining-crypto-assets.md) — the
  plan: BTC as core, recurring buys from surplus income, hold through drawdowns.
  Includes what this Cloud Agent environment can and cannot do.
- [`research/crypto-returns-2026-09.md`](research/crypto-returns-2026-09.md) —
  strategy scorecard: what is slow and positive EV vs fast and negative EV for
  retail.
- [`research/crypto-earning-opportunities-2026-09.md`](research/crypto-earning-opportunities-2026-09.md)
  — verified bounties and hackathons, ranking, required resources, and the
  KeeperHub contribution queue.
- [`research/environment-capabilities-2026-09.md`](research/environment-capabilities-2026-09.md)
  — live audit of what this Cloud Agent VM can actually execute without taking
  user funds.
- [`research/goal-evidence-matrix.md`](research/goal-evidence-matrix.md) —
  requirement-by-requirement completion evidence and unresolved blockers.
- [`research/ethonline-start-checklist.md`](research/ethonline-start-checklist.md) —
  what may be built from 4 Sep 16:00 UTC, and what must wait.
- [`research/ethonline-hedera-harness-8.md`](research/ethonline-hedera-harness-8.md) —
  file-level plan for the Hedera Harness OSS backup (issue #8).
- [`research/phantom-wallet-blocker-2026-09.md`](research/phantom-wallet-blocker-2026-09.md) —
  device-code login succeeded; Phantom KMS still refuses the DCR app
  (`whitelist-disabled`). No agent address yet.

Ground Truth is the executable counterpart to the scorecard in those notes: the
research argues that fast trading is negative expected value for retail, and the
backtester lets you check that claim against whichever asset and window you
choose rather than taking it on faith.

## Not financial advice

Past performance of a rule on past data is not evidence that the rule works.
Nothing here is a recommendation to buy or sell anything.
