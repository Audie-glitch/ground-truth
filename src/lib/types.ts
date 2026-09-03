export type Candle = {
  /** Unix ms timestamp of the daily close. */
  t: number;
  close: number;
};

export type CoinSummary = {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number;
  marketCap: number;
  volume24h: number;
  change24h: number;
  change7d: number | null;
  athChangePct: number | null;
};

export type StrategyId =
  | "buy_hold"
  | "dca"
  | "sma_cross"
  | "rsi_reversion"
  | "breakout"
  | "dip_flip";

export type ParamSpec = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  suffix?: string;
  help: string;
};

/**
 * `exposure` strategies declare the fraction of equity they want held in the
 * asset at each bar. `deploy` strategies declare a fraction of the *initial*
 * capital to spend at each bar, which is how dollar-cost averaging differs
 * from a lump sum on the same capital base.
 */
export type StrategyPlan =
  | { mode: "exposure"; targets: number[] }
  | { mode: "deploy"; deploy: number[] };

export type StrategySpec = {
  id: StrategyId;
  name: string;
  tagline: string;
  description: string;
  family: "benchmark" | "systematic" | "reactive";
  params: ParamSpec[];
  plan: (candles: Candle[], params: Record<string, number>) => StrategyPlan;
};

export type Fill = {
  t: number;
  side: "buy" | "sell";
  price: number;
  units: number;
  notional: number;
  fee: number;
};

export type RoundTrip = {
  openedAt: number;
  closedAt: number;
  entry: number;
  exit: number;
  returnPct: number;
  pnl: number;
};

export type EquityPoint = {
  t: number;
  equity: number;
  benchmark: number;
  price: number;
  exposure: number;
};

export type BacktestMetrics = {
  totalReturn: number;
  cagr: number;
  maxDrawdown: number;
  volatility: number;
  sharpe: number;
  tradeCount: number;
  feesPaid: number;
  winRate: number | null;
  timeInMarket: number;
  finalEquity: number;
};

export type BacktestResult = {
  strategyId: StrategyId;
  strategyName: string;
  params: Record<string, number>;
  coinId: string;
  coinLabel: string;
  days: number;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  equityCurve: EquityPoint[];
  fills: Fill[];
  roundTrips: RoundTrip[];
  metrics: BacktestMetrics;
  benchmark: BacktestMetrics;
};

export type PaperPosition = {
  coinId: string;
  symbol: string;
  name: string;
  units: number;
  costBasis: number;
};

export type PaperFill = {
  id: string;
  t: number;
  coinId: string;
  symbol: string;
  side: "buy" | "sell";
  units: number;
  price: number;
  notional: number;
  fee: number;
};

export type PaperAccount = {
  cash: number;
  startingCash: number;
  positions: PaperPosition[];
  fills: PaperFill[];
  openedAt: number;
};

export type WalkForwardObjective = "return" | "sharpe";

export type WalkForwardPeriodMetrics = {
  from: number;
  to: number;
  days: number;
  totalReturn: number;
  maxDrawdown: number;
  sharpe: number;
  tradeCount: number;
  feesPaid: number;
  finalEquity: number;
};

export type WalkForwardResult = {
  strategyId: StrategyId;
  strategyName: string;
  coinId: string;
  coinLabel: string;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  trainRatio: number;
  objective: WalkForwardObjective;
  /** Params chosen by grid search on the train window only. */
  optimizedParams: Record<string, number>;
  /** How many parameter combinations were evaluated on train. */
  combinationsTried: number;
  train: WalkForwardPeriodMetrics & {
    params: Record<string, number>;
    benchmarkReturn: number;
  };
  /** Out-of-sample with params frozen from train. */
  testOptimized: WalkForwardPeriodMetrics & {
    benchmarkReturn: number;
  };
  /** Out-of-sample with default params, never seeing test data. */
  testDefault: WalkForwardPeriodMetrics & {
    params: Record<string, number>;
    benchmarkReturn: number;
  };
  /** train.totalReturn − testOptimized.totalReturn. Large positive ⇒ overfit. */
  overfitGap: number;
};

export type WalkForwardFold = {
  fold: number;
  optimizedParams: Record<string, number>;
  overfitGap: number;
  train: WalkForwardPeriodMetrics & {
    params: Record<string, number>;
    benchmarkReturn: number;
  };
  testOptimized: WalkForwardPeriodMetrics & {
    benchmarkReturn: number;
  };
  testDefault: WalkForwardPeriodMetrics & {
    params: Record<string, number>;
    benchmarkReturn: number;
  };
};

export type RollingWalkForwardResult = {
  strategyId: StrategyId;
  strategyName: string;
  coinId: string;
  coinLabel: string;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  foldCount: number;
  objective: WalkForwardObjective;
  combinationsTriedPerFold: number;
  folds: WalkForwardFold[];
  aggregate: {
    meanOosReturn: number;
    medianOosReturn: number;
    meanOverfitGap: number;
    foldsBeatingHold: number;
    foldsBeatingDefault: number;
    /** Share of folds where optimised params beat defaults on test. */
    foldsOptimisationHelped: number;
  };
};

export type MonteCarloResult = {
  strategyId: StrategyId;
  strategyName: string;
  coinId: string;
  coinLabel: string;
  days: number;
  initialCapital: number;
  simulations: number;
  /** Actual historical path from the backtest. */
  actual: {
    strategyReturn: number;
    benchmarkReturn: number;
  };
  strategy: MonteCarloDistribution;
  benchmark: MonteCarloDistribution;
  /** Share of shuffled paths where strategy final return exceeded benchmark. */
  probBeatBenchmark: number;
};

export type MonteCarloDistribution = {
  mean: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  probPositive: number;
  histogram: { binStart: number; binEnd: number; count: number }[];
};
