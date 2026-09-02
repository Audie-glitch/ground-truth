# Where crypto returns actually come from (research, September 2026)

Question researched: what produces "quick gains" in crypto, and what does the
data say about who captures them.

Short answer: nothing that is both quick and positive expected value is
available to a retail participant trading on public information. Every strategy
splits into one of two buckets:

- Positive expected value, slow, boring: staking, stablecoin lending,
  market-neutral basis trades, skill-based earning (security research). Returns
  of roughly 3-12% per year, with real but bounded risks.
- High variance, negative expected value for the median participant, fast:
  memecoins, leveraged perpetuals, sniping bots, most airdrop farming. The
  winners are a few percent of participants who have infrastructure,
  information, or capital that a home machine does not.

Anyone promising fast, guaranteed, or "AI-powered" returns is running a scam.
That category is covered at the end.

Companion note: [gaining-crypto-assets.md](gaining-crypto-assets.md) lists the
developer bounties and hackathons that were actually open as of 2 September
2026, with eligibility and required resources, plus regulator fraud data.

## Scorecard

| Strategy | Typical return | Who actually wins | Speed | Verdict |
| --- | --- | --- | --- | --- |
| Memecoin / launchpad trading | Median participant loses; 96% of Pump.fun wallets lost or made < $500 in March 2026 | Bundlers, insiders, sub-50ms bots | Fast | Lottery ticket |
| Leveraged perps | 65-80% of retail accounts net negative over 12 months | Market makers, disciplined minority (5-15%) | Fast | Negative EV without an edge |
| Sniping / MEV bots from a home machine | Most bot transactions fail to slippage, MEV, sandwiching | Co-located nodes, Jito bundles, private feeds | Fast | You are the liquidity |
| Airdrop farming | Zero after 6 months is a normal outcome; pros still profit | Operators with infra, capital, patience | Slow (months) | Not worth it for most |
| Volatile-pair LP | Only 28% of Uniswap LPs positive over 4 years; avg IL -3.8% per position | JIT liquidity (Wintermute, SCP, jaredfromsubway) | Slow | Negative EV passively |
| Stable-pair LP | Small positive, low single digits | Nearly everyone, barely | Slow | Fine, low yield |
| Basis / funding arbitrage | Mid-single to low-double digits net APR in calm markets; 20-40% in squeezes; ~0 or negative Feb-Jul 2026 | Anyone with capital on a perp venue and risk controls | Slow | Best risk-adjusted "trading" yield |
| Staking ETH / SOL | ETH 2.2-3.8%; SOL 5-7% nominal | Everyone, proportional to capital | Slow | Baseline, low risk |
| Stablecoin lending | 3-5% on Aave/Compound; spikes on utilization | Everyone | Slow | Baseline, low risk |
| Ethena sUSDe | 4-12% variable, ~3.7% in early 2026 | Holders while funding is positive | Slow | High risk vs cash-backed stables |
| Security research (bug bounties, audit contests) | Median payout $2k, median critical $20k, tail to $16M | Engineers who put in the hours | Weeks to first payout | The one skill-based path |

## 1. Memecoins and launchpads

On-chain data from a Dune dashboard covering ~1.4M wallets that traded
Pump.fun tokens in March 2026:

- 50.6% of wallets lost money.
- 45.4% made a profit under $500.
- Combined: ~96% of participants lost or made under $500.
- 671,376 wallets lost under $500; 9,160 lost $1k-$10k.
- Two wallets realized more than $1M. Two others lost $500k-$1M.

Token quality explains most of it. Solidus Labs found 98.6% of Pump.fun tokens
collapsed to under $1,000 of liquidity; of 7M+ tokens with at least five
trades, about 97,000 kept meaningful liquidity.

A study of 2,380 Solana tokens that reached a $250k market cap found 43.4%
ended as rugs, 11.6% dumped, 19.2% went sideways, and 25.9% doubled at some
point. Testing rule-based entry/exit strategies on public price data, the best
result was +0.3% per trade on 195 tokens, which the authors called statistically
inconclusive. Their conclusion: the real edges (sub-50ms RPC, Jito bundles,
copy-trading known wallets, same-block sniping) exist but are unavailable from
a normal machine on public data.

An estimated 70-80% of Pump.fun launches use bundled buys where the developer
acquires 20-50% of supply in the deployment block via Jito bundles, then sells
into retail. The average successful rug nets 50-200 SOL.

April 2026 dashboards showed profitable wallets rising to ~73%. Analysts
attribute this to survivorship: unprofitable retail left, not to the game
getting easier.

## 2. Leveraged perpetual futures

- 65-80% of retail perp accounts are net negative over rolling 12-month
  windows (Barber-Odean-style studies, CFTC/FCA retail disclosures, and
  exchange data).
- Aggregated 2026 exchange data: 5-15% of retail traders net profitable over
  12 months; futures-only traders at the low end (5-9%).
- One survey: 84% of retail crypto traders lose money in their first year; 58%
  lose nearly all of it.
- The Brazilian day-trader study: 1.1% of traders active 300+ days earned more
  than minimum wage.
- October 2025: ~$19B of leveraged positions wiped in roughly a day. February
  2026: $3.2B liquidated in 24 hours on a geopolitical headline. Traders with
  the right directional view still lost because leverage did not survive the
  path.
- 100x leverage is commonly available. A 1% move erases 100x margin; a 10%
  move erases 10x. 5-10% daily swings are routine.

Perps are a zero-sum game against market makers and funding. Without a
measurable edge, the expected value after fees, funding, and slippage is
negative, and the variance guarantees eventual ruin at high leverage.

## 3. Sniping, MEV, trading bots

The professional Solana memecoin subculture runs on low-latency Geyser feeds,
Jito bundles, and co-located nodes with research budgets behind them. From a
home machine on public RPC, the majority of bot transactions fail to slippage,
MEV, and sandwiching. Any bot sold on Telegram or marketed with "AI" is either
a scam or is selling you the privilege of being exit liquidity.

## 4. Airdrop farming

- Sybil farms still capture ~40% of airdrop pools in 2026 (down from ~50% at
  the 2022-2023 peak), but detection now runs at >90% accuracy via wallet
  clustering, funding-source tracing, and behavioral ML. Entire farms get
  zeroed.
- One entity claimed >60% of the aPriori airdrop with 14,000 wallets; the
  collateral damage was legitimate wallets flagged by aggressive clustering.
- Consensus from farming communities: "for most, not worth it; for
  professionals with infrastructure, capital, and time, still profitable with
  high risk." Farming six months and receiving nothing is a normal outcome.
- What still works: 2-5 wallets with 6+ months of organic history, real
  capital, real fees paid, on protocols you would use anyway (Hyperliquid,
  Polymarket, and Base are the commonly cited 2026 farms). Bear markets have
  historically paid farmers better (Arbitrum 2023, Hyperliquid HYPE) because
  fewer wallets split the pool.

This is a slow optionality play, not a quick gain.

## 5. Liquidity provision

- Uniswap v3 ETH-USDC 5bps pool: LPs incurred cumulative markout losses
  exceeding $30M from August 2021 to August 2025.
- Across LPs who provided $1 or more over four years, only 28% had positive
  cumulative PnL; ~10% exceeded $10; ~5% exceeded $100. Mean and median PnL
  are negative.
- Top performers are JIT (just-in-time) providers who inject liquidity in the
  same block as a swap and remove it after: jaredfromsubway.eth, SCP,
  Wintermute.
- Average realized impermanent loss is -3.8% per position versus holding;
  49.5% of positions had negative returns; over half landed between -1% and
  +1%.
- Narrow concentrated ranges amplify IL and go out of range in volatile
  markets; unmanaged positions end up one-sided in the depreciating asset.
- Stable pairs (DAI/USDC, 3pool) show nearly all LPs slightly positive, at
  3-7% APY.

Passive LP in volatile pairs is a negative-EV donation to arbitrageurs (LVR).

## 6. Basis and funding-rate arbitrage

The one trading strategy with a structural, non-directional source of return:
long spot, short an equal notional of the perpetual, collect funding paid by
longs.

- Calm markets on BTC/ETH: mid-single to low-double-digit net APR after fees.
- Squeeze regimes: 20-40% on majors, higher on mid-caps, typically lasting 1-4
  weeks before arbitrageurs compress it.
- February through July 2026: BTC funding was compressed or negative
  (Glassnode) as the market sold off from above $120k. The trade returned
  roughly nothing for half a year.
- As of late August 2026: BTC funding ~0.01% per 8h, annualizing to high single
  digits. Market makers are back in the trade.
- Fee math: a Bybit round trip costs ~0.22% of notional on the perp leg; held
  for 30 days over ~90 funding settlements, net APR sits close to gross.

Risks: funding flips negative (exit rule: two consecutive negative periods),
short-leg liquidation on a gap up if under-collateralized, basis divergence
during squeezes, and exchange counterparty risk (FTX). Requires capital held on
a CEX or perp DEX.

## 7. Staking and lending (the baseline)

Live rates observed in early September 2026:

| Venue | Asset | APY |
| --- | --- | --- |
| Lido | ETH | 2.22% |
| Rocket Pool | ETH | 2.18% |
| ETH solo staking (32 ETH) | ETH | 3.1-3.8% incl. MEV tips |
| Jito | SOL | 5.06% |
| Marinade | SOL | 6.05% |
| SOL native staking | SOL | 5.6-7.0% |
| Aave v3 | USDC | 3.2-5.2% (short spikes to 12%) |
| Aave v3 | USDT | 3.37% |
| Compound v3 | USDC | 4.79% |
| Sky (Maker) | USDS | 3.52% (SSR ~4.75%) |
| Morpho Blue | USDC | 4.1-6.8% |
| Ethena | sUSDe | ~3.7% early 2026, ~9.4% late April 2026 |

Notes:

- SOL staking yield is partly inflation; the dollar return depends on SOL
  price.
- Staking risk: slashing, validator downtime, liquid-staking smart-contract
  risk. Lending risk: smart-contract exploits, liquidity crunches, stablecoin
  depeg.
- Ethena sUSDe is not a cash-backed stablecoin. Its yield is the basis trade in
  Section 6 wrapped in a token. Reserve fund ~$61M against ~$5.6B supply
  (~1.1% of TVL). No third-party attestation, no direct retail redemption,
  collateral concentrated on a few exchanges, brief 50-100 bps depegs have
  occurred. Rated HIGH risk relative to USDC/USDP by independent reviewers.

## 8. Skill-based earning: security research

This is the one path where being a good engineer is the edge, and payouts are
in crypto or USDC.

- Immunefi: $110M+ paid to date; 45,000+ researchers; 650+ programs. H1 2026:
  $13.45M across 837 reports, median $2,000, mean $16,000. Across 593
  long-running programs, median confirmed critical is $20,000, mean $114,355.
- Sherlock: hosts the largest single bounty ($16M, Usual). Stake-to-submit
  model ($250 USDC per report, refunded if valid), 52% hit rate on impactful
  submissions.
- Cantina: Coinbase $5M bounty. Uniswap v4: $15.5M critical.
- Code4rena wound down in May 2026; Immunefi absorbed its programs. Audit
  contests now run on Immunefi, Sherlock, Cantina, Spearbit.
- Audit competitions are time-boxed with fixed pools (Base Azul upgrade:
  $250k, April-May 2026) and are explicitly open to all experience levels.
  Rewards are share-weighted: a solo critical earns ~12x the shares of a solo
  medium, so the incentive is depth over volume.

Realistic path: Foundry + Solidity or Anchor + Rust, work through public
vulnerable-contract exercises, read past contest reports, enter contests for
the feedback loop (bugs validated within 24h), then move to standing bounties.
First payouts typically take weeks of focused work, not days. The distribution
is fat-tailed, and the median is modest, but unlike every strategy above the
expected value is positive and it improves with practice.

## 9. The "quick gains" scam funnel

Searching for fast crypto returns puts you in the target audience for the
largest fraud category in finance.

- Pig butchering / synthetic brokerages: contact via dating apps, LinkedIn, a
  "wrong number" text, or a Telegram group; weeks of rapport; a trading
  platform with fabricated profits; withdrawals blocked behind "tax" or
  "release" fees. In 2026 the platforms and the relationship management are
  AI-generated at industrial scale. Median victim makes 4-7 escalating payments
  over 4-8 weeks. Global losses exceeded $75B from 2020 to 2024; average
  payment size grew 253% year-over-year into 2025.
- The SEC's NanoBit case (June 2026, $5.5M judgment): the platform never
  executed a single real trade.
- MLM "trading" schemes promising to double funds in 40-45 days (FQL, 2026).
- CertiK documented $370M in scam-related crypto losses in January 2026 alone.

Rules that filter nearly all of it: no one with a real edge sells signals or
bots to strangers; any counterparty that controls your withdrawal is not an
exchange; a displayed balance is not money until it is in a wallet you hold
keys to; and "guaranteed" plus "crypto" in the same sentence is a scam.

## 10. Expected value at $10,000 for 12 months

Illustrative, using the ranges above:

| Allocation | Expected outcome | Distribution |
| --- | --- | --- |
| Stablecoin lending @ 4% | +$400 | Tight; tail risk is protocol exploit |
| SOL staking @ 6% | +$600 in SOL | Dollar value tracks SOL price |
| Basis trade @ 8-12% | +$800 to +$1,200 | Near zero in negative-funding regimes; tail risk is venue failure |
| Perps, 10x, no edge | Negative | ~70% chance of net loss; meaningful chance of total loss |
| Memecoins | Negative | ~50% chance of loss; ~96% chance of < $500 gain; ~0.0001% chance of $1M |
| Bug bounties (time, not capital) | Positive, skill-dependent | Median $2k per valid report; fat tail |

The math for "quick" is simple: a strategy that could plausibly double $10k in
a month has a payoff distribution where the median outcome is a large loss.
Strategies with a positive median compound at 3-12% per year.

## Sources

Memecoins and launchpads

- https://www.mexc.co/news/992439
- https://memeblock.com/over-half-of-pump-fun-memecoin-traders-report-losses-in-march-2026/
- https://ourcryptotalk.com/news/pump-fun-96-percent-traders-losing-money
- https://cryptorank.io/news/feed/60ff8-pump-fun-traders-losses-profits-data
- https://id.tradingview.com/news/coinpedia:4b70a3c53094b:0-over-50-of-pump-fun-traders-lost-money-this-month-while-2-wallets-made-over-1m/
- https://swaphunt.dev/articles/solana-memecoin-null-result
- https://bullrank.io/learn/bundled-launch-developer-wallet-manipulation
- https://blog.bubblemaps.io/whats-the-difference-between-bundle-cluster-2/

Leveraged trading

- https://skrumble.com/learn/what-is-perpetual-futures/
- https://cryptobriefing.com/us-day-traders-crypto-perpetual-futures/
- https://cryptoemotions.com/percentage-of-traders-who-lose-money-in-crypto/
- https://cryptoprofitcalc.com/what-percentage-of-crypto-traders-make-a-profit-2026-data/
- https://earnifyhub.com/crypto-web3/crypto-futures-trading-leverage-liquidation-2026

Airdrops

- https://sndct.app/airdrop-farming-in-2026-does-multi-accounting-still-make-sense/
- https://airdropalert.com/blogs/is-airdrop-farming-still-safe-in-2026/
- https://airdropalert.com/blogs/airdrop-sybil-attack-apriori/
- https://airdropalert.com/blogs/wallet-sybil-filtered-crypto-airdrops/
- https://www.dextools.io/tutorials/what-is-airdrop-farming-in-crypto-guide-2026

Liquidity provision

- https://paragraph.com/@0xalphaist/who-wins-liquidity-provision-and-how-evidence-from-the-uniswap-protocol
- https://arxiv.org/pdf/2501.07828
- https://arxiv.org/pdf/2606.23070
- https://doi.org/10.48550/arxiv.2604.22069
- https://token-strategy.com/blog/concentrated-liquidity-active-management-impermanent-loss

Basis / funding arbitrage

- https://yieldo.me/blog/funding/spot-perp-arbitrage-guide
- https://www.coindesk.com/markets/2026/08/28/crypto-market-makers-are-cashing-in-on-bitcoin-s-rally-without-betting-on-direction
- https://hyperdash.com/learn/basis-trading-and-funding-rate-arbitrage-on-perps
- https://arbitragescanner.io/blog/crypto-funding-rate-arbitrage-strategy-guide

Staking, lending, synthetic dollars

- https://yieldo.me/defi
- https://www.spark.money/tools/crypto-yield-calculator
- https://www.stakingrewards.com/defi
- https://altcoininvestor.com/staking-vs-lending-crypto/
- https://stableregistry.com/research/usde-risk-assessment-2026/
- https://stablecoininsider.org/ethena-usde-q1-2026-report/
- https://eco.com/support/en/articles/15254002-ethena-usde-and-susde-2026-delta-neutral-yield

Security research

- https://sherlock.xyz/post/best-web3-bug-bounties-in-2026-the-highest-paying-programs-on-every-platform
- https://hoge.gg/bug-bounty-payouts-2026-sticker-price-receipt/
- https://immunefi.com/audit-competitions/
- https://immunefi.com/blog/all/base-immunefi-audit-competition/
- https://immunefi.com/blog/whitehat-spotlight/our-journey-with-immunefi-audit-competitions/

Scams

- https://www.trustsphere.ai/post/the-synthetic-brokerage-how-ai-generated-trading-platforms-have-industrialised-pig-butchering-inves
- https://www.techtimes.com/articles/319398/20260630/pig-butchering-ring-ordered-pay-55m-after-faking-crypto-profits-whatsapp.htm
- https://www.thehindu.com/news/cities/chennai/fql-scam-mlm-cum-cryptocurrency-trading-fraud-cases-transferred-to-economic-offences-wing/article71410572.ece
- https://www.fluxforce.ai/blog/pig-butchering-scam-detection
- https://www.elliptic.co/insights/the-behavioral-detection-of-pig-butchering-scams-on-blockchain-flagging-suspect-wallets-and-speeding-up-investigations/
