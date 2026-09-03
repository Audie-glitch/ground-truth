import { dailyReturns, mean } from "./indicators";
import { runBacktest } from "./backtest";
import { getStrategy } from "./strategies";
import type {
  Candle,
  MonteCarloDistribution,
  MonteCarloResult,
  StrategyId,
} from "./types";

export type MonteCarloInput = {
  candles: Candle[];
  strategyId: StrategyId;
  params: Record<string, number>;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  coinId: string;
  coinLabel: string;
  simulations?: number;
};

const DEFAULT_SIMULATIONS = 800;
const MAX_SIMULATIONS = 3_000;
const HISTOGRAM_BINS = 24;

/** Fisher–Yates shuffle (mutates copy). */
export function shuffleInPlace(values: number[], rand: () => number): void {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
}

export function compoundReturn(returns: number[]): number {
  let equity = 1;
  for (const r of returns) equity *= 1 + r;
  return equity - 1;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const weight = idx - lo;
  return sorted[lo] * (1 - weight) + sorted[hi] * weight;
}

export function summariseDistribution(
  returns: number[],
): MonteCarloDistribution {
  const sorted = [...returns].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const span = max - min || 1;
  const binWidth = span / HISTOGRAM_BINS;

  const histogram = Array.from({ length: HISTOGRAM_BINS }, (_, i) => ({
    binStart: min + i * binWidth,
    binEnd: min + (i + 1) * binWidth,
    count: 0,
  }));

  for (const r of returns) {
    let bin = Math.floor((r - min) / binWidth);
    if (bin >= HISTOGRAM_BINS) bin = HISTOGRAM_BINS - 1;
    if (bin < 0) bin = 0;
    histogram[bin].count++;
  }

  return {
    mean: mean(returns),
    p5: percentile(sorted, 0.05),
    p25: percentile(sorted, 0.25),
    p50: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    p95: percentile(sorted, 0.95),
    probPositive: returns.filter((r) => r > 0).length / Math.max(1, returns.length),
    histogram,
  };
}

/**
 * Shuffles the strategy's daily account returns while preserving their
 * empirical distribution. This breaks serial dependence and shows how much of
 * the observed result could have come from luck in the ordering of the same
 * daily moves.
 */
export function runMonteCarlo(
  input: MonteCarloInput,
  rand: () => number = Math.random,
): MonteCarloResult {
  const {
    candles,
    strategyId,
    params,
    initialCapital,
    feeBps,
    slippageBps,
    coinId,
    coinLabel,
    simulations = DEFAULT_SIMULATIONS,
  } = input;

  const sims = Math.min(MAX_SIMULATIONS, Math.max(100, Math.round(simulations)));

  const backtest = runBacktest({
    candles,
    strategyId,
    params,
    initialCapital,
    feeBps,
    slippageBps,
    coinId,
    coinLabel,
  });

  const strategyReturns = dailyReturns(
    backtest.equityCurve.map((p) => p.equity),
  );
  const benchmarkReturns = dailyReturns(
    backtest.equityCurve.map((p) => p.benchmark),
  );

  if (strategyReturns.length < 5) {
    throw new Error("Need at least six daily bars for a Monte Carlo shuffle.");
  }

  const strategyOutcomes: number[] = [];
  const benchmarkOutcomes: number[] = [];
  let beatBenchmark = 0;

  for (let i = 0; i < sims; i++) {
    const stratCopy = [...strategyReturns];
    shuffleInPlace(stratCopy, rand);
    const stratFinal = compoundReturn(stratCopy);
    strategyOutcomes.push(stratFinal);

    const benchCopy = [...benchmarkReturns];
    shuffleInPlace(benchCopy, rand);
    const benchFinal = compoundReturn(benchCopy);
    benchmarkOutcomes.push(benchFinal);

    if (stratFinal > benchFinal) beatBenchmark++;
  }

  const spec = getStrategy(strategyId);

  return {
    strategyId,
    strategyName: spec.name,
    coinId,
    coinLabel,
    days: backtest.days,
    initialCapital,
    simulations: sims,
    actual: {
      strategyReturn: backtest.metrics.totalReturn,
      benchmarkReturn: backtest.benchmark.totalReturn,
    },
    strategy: summariseDistribution(strategyOutcomes),
    benchmark: summariseDistribution(benchmarkOutcomes),
    probBeatBenchmark: beatBenchmark / sims,
  };
}
