import { describe, expect, it } from "vitest";

import { defaultParams } from "./strategies";
import {
  paramCombinations,
  runWalkForward,
  sampleParamValues,
  splitTrainTest,
} from "./walk-forward";
import type { Candle } from "./types";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(count: number, mapper: (i: number) => number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    t: START + i * DAY,
    close: mapper(i),
  }));
}

describe("sampleParamValues", () => {
  it("always includes the declared default", () => {
    const values = sampleParamValues({
      key: "fast",
      label: "Fast",
      min: 2,
      max: 20,
      step: 1,
      default: 10,
      help: "",
    });
    expect(values).toContain(10);
    expect(values[0]).toBeGreaterThanOrEqual(2);
    expect(values[values.length - 1]).toBeLessThanOrEqual(20);
  });
});

describe("splitTrainTest", () => {
  it("requires enough bars in both halves", () => {
    const short = candles(50, (i) => 100 + i);
    expect(splitTrainTest(short, 0.65)).toBeNull();
    const long = candles(100, (i) => 100 + i);
    const split = splitTrainTest(long, 0.65);
    expect(split).not.toBeNull();
    expect(split!.train.length).toBeGreaterThanOrEqual(40);
    expect(split!.test.length).toBeGreaterThanOrEqual(30);
  });
});

describe("paramCombinations", () => {
  it("caps the search space for multi-parameter strategies", () => {
    const spec = {
      id: "dip_flip" as const,
      name: "Quick-flip scalper",
      tagline: "",
      description: "",
      family: "reactive" as const,
      params: [
        {
          key: "dipPct",
          label: "",
          min: 1,
          max: 30,
          step: 1,
          default: 5,
          help: "",
        },
        {
          key: "takeProfitPct",
          label: "",
          min: 1,
          max: 50,
          step: 1,
          default: 5,
          help: "",
        },
        {
          key: "stopLossPct",
          label: "",
          min: 2,
          max: 60,
          step: 1,
          default: 20,
          help: "",
        },
      ],
      plan: () => ({ mode: "exposure" as const, targets: [] }),
    };

    const combos = paramCombinations(spec, 64);
    expect(combos.length).toBeLessThanOrEqual(64);
    expect(combos.length).toBeGreaterThan(1);
  });
});

describe("runWalkForward", () => {
  it("optimizes on train and evaluates frozen params on test", () => {
    // Train: flat. Test: strong uptrend. A low dip threshold should buy early
    // in test if it was chosen on train noise; we mainly assert structure.
    const series = candles(120, (i) => (i < 78 ? 100 : 100 + (i - 78) * 2));
    const result = runWalkForward({
      candles: series,
      strategyId: "dip_flip",
      initialCapital: 10_000,
      feeBps: 0,
      slippageBps: 0,
      coinId: "test",
      coinLabel: "Test",
      trainRatio: 0.65,
      objective: "return",
    });

    expect(result.combinationsTried).toBeGreaterThan(0);
    expect(result.train.days).toBeGreaterThanOrEqual(40);
    expect(result.testOptimized.days).toBeGreaterThanOrEqual(30);
    expect(result.overfitGap).toBe(
      result.train.totalReturn - result.testOptimized.totalReturn,
    );
    expect(Number.isFinite(result.testDefault.totalReturn)).toBe(true);
  });

  it("uses defaults for parameter-free strategies", () => {
    const series = candles(100, (i) => 100 + Math.sin(i / 5) * 5);
    const result = runWalkForward({
      candles: series,
      strategyId: "buy_hold",
      initialCapital: 10_000,
      feeBps: 0,
      slippageBps: 0,
      coinId: "test",
      coinLabel: "Test",
    });

    expect(result.optimizedParams).toEqual(defaultParams("buy_hold"));
    expect(result.testOptimized.totalReturn).toBeCloseTo(
      result.testDefault.totalReturn,
      10,
    );
  });
});
