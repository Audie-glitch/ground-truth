import { describe, expect, it } from "vitest";

import {
  compoundReturn,
  runMonteCarlo,
  shuffleInPlace,
  summariseDistribution,
} from "./monte-carlo";
import type { Candle } from "./types";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(count: number, mapper: (i: number) => number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    t: START + i * DAY,
    close: mapper(i),
  }));
}

describe("shuffleInPlace", () => {
  it("preserves multiset of values", () => {
    const values = [1, 2, 3, 4, 5];
    const sorted = [...values].sort((a, b) => a - b);
    shuffleInPlace(values, () => 0.42);
    expect([...values].sort((a, b) => a - b)).toEqual(sorted);
  });
});

describe("compoundReturn", () => {
  it("compounds a return series", () => {
    expect(compoundReturn([0.1, -0.05])).toBeCloseTo(1.1 * 0.95 - 1, 10);
  });
});

describe("summariseDistribution", () => {
  it("computes percentiles", () => {
    const dist = summariseDistribution([-0.2, 0, 0.1, 0.2, 0.5]);
    expect(dist.p50).toBeCloseTo(0.1, 10);
    expect(dist.histogram.length).toBeGreaterThan(0);
  });
});

describe("runMonteCarlo", () => {
  it("returns a distribution with the actual path embedded", () => {
    const series = candles(120, (i) => 100 + Math.sin(i / 8) * 10);
    const result = runMonteCarlo(
      {
        candles: series,
        strategyId: "buy_hold",
        params: {},
        initialCapital: 10_000,
        feeBps: 0,
        slippageBps: 0,
        coinId: "test",
        coinLabel: "Test",
        simulations: 200,
      },
      () => 0.5,
    );

    expect(result.simulations).toBe(200);
    expect(result.actual.strategyReturn).toBeCloseTo(
      result.actual.benchmarkReturn,
      10,
    );
    expect(Number.isFinite(result.strategy.p50)).toBe(true);
    expect(result.probBeatBenchmark).toBeGreaterThanOrEqual(0);
    expect(result.probBeatBenchmark).toBeLessThanOrEqual(1);
  });
});
