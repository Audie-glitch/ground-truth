import { describe, expect, it } from "vitest";

import { runBacktest } from "./backtest";
import { defaultParams } from "./strategies";
import type { Candle, StrategyId } from "./types";

const DAY = 86_400_000;
const START = Date.UTC(2024, 0, 1);

function candles(prices: number[]): Candle[] {
  return prices.map((close, i) => ({ t: START + i * DAY, close }));
}

function run(
  prices: number[],
  strategyId: StrategyId,
  overrides: Partial<{
    params: Record<string, number>;
    initialCapital: number;
    feeBps: number;
    slippageBps: number;
  }> = {},
) {
  return runBacktest({
    candles: candles(prices),
    strategyId,
    params: overrides.params ?? defaultParams(strategyId),
    initialCapital: overrides.initialCapital ?? 10_000,
    feeBps: overrides.feeBps ?? 0,
    slippageBps: overrides.slippageBps ?? 0,
    coinId: "test-asset",
    coinLabel: "Test Asset",
  });
}

describe("buy and hold", () => {
  it("tracks the asset exactly when there are no trading costs", () => {
    const result = run([100, 150, 200], "buy_hold");
    expect(result.metrics.totalReturn).toBeCloseTo(1, 10);
    expect(result.metrics.finalEquity).toBeCloseTo(20_000, 6);
    expect(result.metrics.tradeCount).toBe(1);
    expect(result.metrics.feesPaid).toBe(0);
  });

  it("loses exactly the fee and the spread on entry", () => {
    const result = run([100, 200], "buy_hold", {
      feeBps: 10,
      slippageBps: 5,
    });

    // Independently re-derived: capital buys `notional` after the fee is
    // carved out, and fills one half-spread above the quoted price.
    const notional = 10_000 / 1.001;
    const units = notional / (100 * 1.0005);
    expect(result.metrics.finalEquity).toBeCloseTo(units * 200, 6);
    expect(result.metrics.feesPaid).toBeCloseTo(notional * 0.001, 8);
    expect(result.metrics.totalReturn).toBeLessThan(1);
  });

  it("reports a drawdown taken from the running peak", () => {
    const result = run([100, 200, 50, 220], "buy_hold");
    expect(result.metrics.maxDrawdown).toBeCloseTo(-0.75, 8);
  });

  it("is identical to the benchmark it is measured against", () => {
    const result = run([100, 130, 90, 160], "buy_hold", { feeBps: 10 });
    expect(result.metrics.totalReturn).toBeCloseTo(
      result.benchmark.totalReturn,
      12,
    );
    expect(result.metrics.finalEquity).toBeCloseTo(
      result.benchmark.finalEquity,
      8,
    );
  });
});

describe("staying in cash", () => {
  it("never trades when the entry condition is never met", () => {
    // A monotonically rising series holds RSI at 100, so mean reversion never
    // sees an oversold bar.
    const prices = Array.from({ length: 60 }, (_, i) => 100 + i);
    const result = run(prices, "rsi_reversion");

    expect(result.metrics.tradeCount).toBe(0);
    expect(result.metrics.totalReturn).toBe(0);
    expect(result.metrics.finalEquity).toBeCloseTo(10_000, 8);
    expect(result.metrics.timeInMarket).toBe(0);
    expect(result.metrics.winRate).toBeNull();
    // The benchmark still rides the whole move, which is the comparison the
    // whole tool exists to surface.
    expect(result.benchmark.totalReturn).toBeGreaterThan(0.5);
  });
});

describe("quick-flip scalper", () => {
  const params = { dipPct: 5, takeProfitPct: 5, stopLossPct: 20 };

  it("buys the dip and sells the bounce at that bar's close", () => {
    const result = run([100, 100, 94, 99, 100], "dip_flip", { params });

    expect(result.fills).toHaveLength(2);
    expect(result.fills[0]).toMatchObject({ side: "buy", price: 94 });
    expect(result.fills[1]).toMatchObject({ side: "sell", price: 99 });
    expect(result.metrics.totalReturn).toBeCloseTo(99 / 94 - 1, 10);
  });

  it("records a completed round trip with its realised return", () => {
    const result = run([100, 100, 94, 99, 100], "dip_flip", { params });

    expect(result.roundTrips).toHaveLength(1);
    expect(result.roundTrips[0].returnPct).toBeCloseTo(99 / 94 - 1, 10);
    expect(result.metrics.winRate).toBe(1);
  });

  it("can win most of its trades and still trail buy and hold", () => {
    // A grinding uptrend with shallow pullbacks: every flip is profitable, and
    // every flip also sells before the next leg up.
    const prices: number[] = [];
    let price = 100;
    for (let i = 0; i < 120; i++) {
      price *= i % 6 === 5 ? 0.94 : 1.03;
      prices.push(price);
    }
    const result = run(prices, "dip_flip", { params, feeBps: 10, slippageBps: 5 });

    expect(result.metrics.winRate).not.toBeNull();
    expect(result.metrics.winRate!).toBeGreaterThan(0.5);
    expect(result.metrics.totalReturn).toBeLessThan(
      result.benchmark.totalReturn,
    );
  });

  it("charges a fee on every order it places", () => {
    const flat = run([100, 100, 94, 99, 100], "dip_flip", {
      params,
      feeBps: 50,
    });
    expect(flat.metrics.feesPaid).toBeGreaterThan(0);
    expect(flat.metrics.tradeCount).toBe(2);
  });
});

describe("dollar-cost averaging", () => {
  it("deploys the full starting capital across its scheduled buys", () => {
    const prices = new Array(30).fill(100);
    const result = run(prices, "dca", {
      params: { intervalDays: 7, buys: 4 },
    });

    expect(result.fills).toHaveLength(4);
    expect(result.fills.every((f) => f.side === "buy")).toBe(true);
    // Flat prices and no costs mean the account should end exactly where it
    // started, which only holds if every slice was actually invested.
    expect(result.metrics.finalEquity).toBeCloseTo(10_000, 6);
    expect(result.metrics.timeInMarket).toBeGreaterThan(0.9);
  });

  it("never sells, so it reports no completed round trips", () => {
    const result = run(new Array(30).fill(100), "dca");
    expect(result.roundTrips).toHaveLength(0);
    expect(result.metrics.winRate).toBeNull();
  });
});

describe("moving-average crossover", () => {
  it("enters only after the fast average crosses above the slow one", () => {
    // Falls for 30 bars, then rallies. The cross cannot happen on bar 0.
    const prices = [
      ...Array.from({ length: 30 }, (_, i) => 200 - i * 2),
      ...Array.from({ length: 30 }, (_, i) => 140 + i * 4),
    ];
    const result = run(prices, "sma_cross", { params: { fast: 5, slow: 20 } });

    expect(result.fills.length).toBeGreaterThan(0);
    const firstBuy = result.fills.find((f) => f.side === "buy");
    expect(firstBuy).toBeDefined();
    expect(firstBuy!.t).toBeGreaterThan(START + 20 * DAY);
  });
});

describe("engine invariants", () => {
  const noisy = Array.from(
    { length: 200 },
    (_, i) => 100 * (1 + 0.3 * Math.sin(i / 11) + 0.1 * Math.cos(i / 3)),
  );
  const strategies: StrategyId[] = [
    "buy_hold",
    "dca",
    "sma_cross",
    "rsi_reversion",
    "breakout",
    "dip_flip",
  ];

  it("never lets equity go negative, whatever the costs", () => {
    for (const id of strategies) {
      const result = run(noisy, id, { feeBps: 100, slippageBps: 100 });
      for (const point of result.equityCurve) {
        expect(point.equity).toBeGreaterThan(0);
      }
    }
  });

  it("keeps exposure within zero and one", () => {
    for (const id of strategies) {
      const result = run(noisy, id);
      for (const point of result.equityCurve) {
        expect(point.exposure).toBeGreaterThanOrEqual(-1e-9);
        expect(point.exposure).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it("returns one equity point per candle", () => {
    for (const id of strategies) {
      const result = run(noisy, id);
      expect(result.equityCurve).toHaveLength(noisy.length);
    }
  });

  it("makes higher costs strictly worse for any strategy that trades", () => {
    for (const id of strategies) {
      const cheap = run(noisy, id, { feeBps: 0, slippageBps: 0 });
      if (cheap.metrics.tradeCount === 0) continue;
      const dear = run(noisy, id, { feeBps: 50, slippageBps: 50 });
      expect(dear.metrics.finalEquity).toBeLessThan(cheap.metrics.finalEquity);
    }
  });

  it("never fills at a price outside the candle series", () => {
    const prices = new Set(noisy);
    for (const id of strategies) {
      const result = run(noisy, id);
      for (const fill of result.fills) {
        expect(prices.has(fill.price)).toBe(true);
      }
    }
  });
});
