import { describe, expect, it } from "vitest";
import { BLOCKS_PER_DAY, limitFactorFor, requestedLimit, scoreProfile, type VerifiedProfile } from "./scoring.js";

const base: VerifiedProfile = {
  datedVolume: 0n,
  undatedVolume: 0n,
  onTimeCount: 0,
  lateCount: 0,
  transferCount: 0,
  firstPaidBlock: 0,
  lastPaidBlock: 0,
};

describe("scoreProfile", () => {
  it("scores zero with no history and extends no credit", () => {
    const r = scoreProfile(base, 1_000);
    expect(r.score).toBe(0);
    expect(r.limitFactor).toBe(0);
    expect(r.factors[0]?.name).toBe("no-history");
  });

  it("rewards a perfect on-time record", () => {
    const r = scoreProfile(
      { ...base, datedVolume: 1_000_000_000n, onTimeCount: 4, firstPaidBlock: 1_000, lastPaidBlock: 1_000 + 3 * BLOCKS_PER_DAY },
      1_000 + 3 * BLOCKS_PER_DAY + 10,
    );
    // base 300 + behaviour 400 + depth 100 + tenure 30 + volume round(12.5*log10(1001)) = 38
    expect(r.score).toBe(868);
    expect(r.limitFactor).toBe(1);
  });

  it("penalises late payments below a mostly-late record", () => {
    const good = scoreProfile({ ...base, datedVolume: 100_000_000n, onTimeCount: 3, lateCount: 1 }, 10);
    const bad = scoreProfile({ ...base, datedVolume: 100_000_000n, onTimeCount: 1, lateCount: 3 }, 10);
    expect(good.score).toBeGreaterThan(bad.score);
    const behaviour = bad.factors.find((f) => f.name === "payment-behaviour");
    expect(behaviour?.points).toBe(0); // 400*0.25 - 120 < 0 clamps to zero
  });

  it("applies the recency penalty after 30 days", () => {
    const fresh = scoreProfile({ ...base, datedVolume: 1_000_000n, onTimeCount: 1, lastPaidBlock: 100 }, 200);
    const stale = scoreProfile({ ...base, datedVolume: 1_000_000n, onTimeCount: 1, lastPaidBlock: 100 }, 100 + 31 * BLOCKS_PER_DAY);
    expect(fresh.score - stale.score).toBe(50);
  });

  it("never leaves the 0..1000 range", () => {
    const r = scoreProfile(
      { ...base, datedVolume: 10n ** 30n, onTimeCount: 1_000, firstPaidBlock: 0, lastPaidBlock: 10_000_000 },
      10_000_000,
    );
    expect(r.score).toBeLessThanOrEqual(1000);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe("limits", () => {
  it("steps the limit factor by score band", () => {
    expect(limitFactorFor(800)).toBe(1);
    expect(limitFactorFor(600)).toBe(0.8);
    expect(limitFactorFor(450)).toBe(0.6);
    expect(limitFactorFor(300)).toBe(0.4);
    expect(limitFactorFor(0)).toBe(0);
  });

  it("requests a whole-unit share of the policy cap and never more", () => {
    expect(requestedLimit(150_000_000n, 0.8)).toBe(120_000_000n);
    expect(requestedLimit(150_000_000n, 1)).toBe(150_000_000n);
    expect(requestedLimit(1_234_567n, 0.6)).toBe(0n); // below one whole unit floors to zero
    expect(requestedLimit(150_000_000n, 0)).toBe(0n);
  });
});
