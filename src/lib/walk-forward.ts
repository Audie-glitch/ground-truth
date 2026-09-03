import { runBacktest } from "./backtest";
import { defaultParams, getStrategy } from "./strategies";
import type {
  Candle,
  ParamSpec,
  StrategyId,
  StrategySpec,
  WalkForwardObjective,
  WalkForwardPeriodMetrics,
  WalkForwardResult,
} from "./types";

const MIN_TRAIN_BARS = 40;
const MIN_TEST_BARS = 30;
const MAX_COMBINATIONS = 512;

export type WalkForwardInput = {
  candles: Candle[];
  strategyId: StrategyId;
  initialCapital: number;
  feeBps: number;
  slippageBps: number;
  coinId: string;
  coinLabel: string;
  trainRatio?: number;
  objective?: WalkForwardObjective;
};

/** Values sampled along each declared parameter range for grid search. */
export function sampleParamValues(spec: ParamSpec, maxValues = 5): number[] {
  const span = spec.max - spec.min;
  if (span <= 0) return [spec.default];

  const steps = Math.max(1, Math.round(span / spec.step));
  const count = Math.min(maxValues, steps + 1);
  const values = new Set<number>();

  for (let i = 0; i < count; i++) {
    const raw = spec.min + (span * i) / Math.max(1, count - 1);
    const snapped =
      Math.round(raw / spec.step) * spec.step;
    values.add(clamp(snapped, spec.min, spec.max));
  }
  values.add(spec.default);
  return [...values].sort((a, b) => a - b);
}

/** Cartesian product of parameter samples, capped so train search stays fast. */
export function paramCombinations(
  spec: StrategySpec,
  maxCombos = MAX_COMBINATIONS,
): Record<string, number>[] {
  if (spec.params.length === 0) return [{}];

  const axes = spec.params.map((p) => ({
    key: p.key,
    values: sampleParamValues(p),
  }));

  const all: Record<string, number>[] = [];

  const walk = (depth: number, current: Record<string, number>) => {
    if (depth === axes.length) {
      all.push({ ...current });
      return;
    }
    for (const value of axes[depth].values) {
      current[axes[depth].key] = value;
      walk(depth + 1, current);
    }
  };

  walk(0, {});

  const stride = Math.max(1, Math.ceil(all.length / maxCombos));
  return all.filter((_, i) => i % stride === 0).slice(0, maxCombos);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function splitTrainTest(
  candles: Candle[],
  trainRatio: number,
): { train: Candle[]; test: Candle[] } | null {
  const ratio = clamp(trainRatio, 0.5, 0.85);
  const trainSize = Math.floor(candles.length * ratio);

  if (
    trainSize < MIN_TRAIN_BARS ||
    candles.length - trainSize < MIN_TEST_BARS
  ) {
    return null;
  }

  return {
    train: candles.slice(0, trainSize),
    test: candles.slice(trainSize),
  };
}

function score(
  objective: WalkForwardObjective,
  totalReturn: number,
  sharpe: number,
): number {
  return objective === "sharpe" ? sharpe : totalReturn;
}

function toPeriodMetrics(
  candles: Candle[],
  result: ReturnType<typeof runBacktest>,
): WalkForwardPeriodMetrics {
  return {
    from: candles[0].t,
    to: candles[candles.length - 1].t,
    days: result.days,
    totalReturn: result.metrics.totalReturn,
    maxDrawdown: result.metrics.maxDrawdown,
    sharpe: result.metrics.sharpe,
    tradeCount: result.metrics.tradeCount,
    feesPaid: result.metrics.feesPaid,
    finalEquity: result.metrics.finalEquity,
  };
}

function runSlice(
  candles: Candle[],
  input: Omit<WalkForwardInput, "candles" | "trainRatio" | "objective">,
  params: Record<string, number>,
) {
  return runBacktest({
    candles,
    strategyId: input.strategyId,
    params,
    initialCapital: input.initialCapital,
    feeBps: input.feeBps,
    slippageBps: input.slippageBps,
    coinId: input.coinId,
    coinLabel: input.coinLabel,
  });
}

export function runWalkForward(input: WalkForwardInput): WalkForwardResult {
  const {
    candles,
    strategyId,
    initialCapital,
    feeBps,
    slippageBps,
    coinId,
    coinLabel,
    trainRatio = 0.65,
    objective = "return",
  } = input;

  const split = splitTrainTest(candles, trainRatio);
  if (!split) {
    throw new Error(
      `Need at least ${MIN_TRAIN_BARS + MIN_TEST_BARS} daily bars for a walk-forward split.`,
    );
  }

  const spec = getStrategy(strategyId);
  const defaults = defaultParams(strategyId);

  let bestParams = { ...defaults };
  let bestScore = -Infinity;
  let combinationsTried = 0;

  for (const params of paramCombinations(spec)) {
    combinationsTried++;
    const trainResult = runSlice(split.train, input, params);
    const s = score(
      objective,
      trainResult.metrics.totalReturn,
      trainResult.metrics.sharpe,
    );
    if (s > bestScore) {
      bestScore = s;
      bestParams = params;
    }
  }

  const trainOptimized = runSlice(split.train, input, bestParams);
  const testOptimized = runSlice(split.test, input, bestParams);
  const testDefault = runSlice(split.test, input, defaults);

  const trainMetrics = toPeriodMetrics(split.train, trainOptimized);
  const testOptMetrics = toPeriodMetrics(split.test, testOptimized);
  const testDefMetrics = toPeriodMetrics(split.test, testDefault);

  return {
    strategyId,
    strategyName: spec.name,
    coinId,
    coinLabel,
    initialCapital,
    feeBps,
    slippageBps,
    trainRatio: split.train.length / candles.length,
    objective,
    optimizedParams: bestParams,
    combinationsTried,
    train: {
      ...trainMetrics,
      params: bestParams,
      benchmarkReturn: trainOptimized.benchmark.totalReturn,
    },
    testOptimized: {
      ...testOptMetrics,
      benchmarkReturn: testOptimized.benchmark.totalReturn,
    },
    testDefault: {
      ...testDefMetrics,
      params: defaults,
      benchmarkReturn: testDefault.benchmark.totalReturn,
    },
    overfitGap: trainMetrics.totalReturn - testOptMetrics.totalReturn,
  };
}
