import { describe, expect, it } from "vitest";

import { maxDrawdown, mean, rollingHigh, rsi, sma, stdev } from "./indicators";

describe("sma", () => {
  it("returns null until the window is full, then the rolling mean", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it("is aligned to the input length", () => {
    expect(sma([1, 2, 3], 10)).toEqual([null, null, null]);
  });
});

describe("rsi", () => {
  it("pins to 100 when every bar closes higher", () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + i);
    const out = rsi(values, 14);
    expect(out[39]).toBe(100);
  });

  it("pins to 0 when every bar closes lower", () => {
    const values = Array.from({ length: 40 }, (_, i) => 200 - i);
    const out = rsi(values, 14);
    expect(out[39]).toBeCloseTo(0, 6);
  });

  it("stays within 0 and 100 on a noisy series", () => {
    const values = Array.from(
      { length: 200 },
      (_, i) => 100 + Math.sin(i / 3) * 20 + Math.cos(i / 7) * 8,
    );
    for (const v of rsi(values, 14)) {
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe("rollingHigh", () => {
  it("excludes the current bar so a breakout can be detected on it", () => {
    // At index 3 the prior 3 bars are [1, 5, 2], so the high is 5 and the
    // close of 6 at index 3 counts as a breakout.
    expect(rollingHigh([1, 5, 2, 6], 3)[3]).toBe(5);
  });
});

describe("maxDrawdown", () => {
  it("measures peak to trough, not first to last", () => {
    expect(maxDrawdown([100, 50, 100])).toBeCloseTo(-0.5, 10);
  });

  it("is zero for a series that never falls", () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });

  it("uses the running peak rather than the global one", () => {
    expect(maxDrawdown([100, 200, 50, 220])).toBeCloseTo(-0.75, 10);
  });
});

describe("mean and stdev", () => {
  it("computes the sample standard deviation", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stdev([2, 4, 6])).toBeCloseTo(2, 10);
  });

  it("returns zero for degenerate inputs", () => {
    expect(stdev([5])).toBe(0);
    expect(mean([])).toBe(0);
  });
});
