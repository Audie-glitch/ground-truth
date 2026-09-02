import { describe, expect, it } from "vitest";

import {
  formatPct,
  formatPctMagnitude,
  formatPlainPct,
  formatUnits,
  formatUsd,
} from "./format";

describe("formatPct", () => {
  it("signs the value so gains and losses are never confused", () => {
    expect(formatPct(0.1234)).toBe("+12.3%");
    expect(formatPct(-0.1234)).toBe("-12.3%");
    expect(formatPct(0)).toBe("+0.0%");
  });
});

describe("formatPctMagnitude", () => {
  it("drops the sign for prose that already states the direction", () => {
    expect(formatPctMagnitude(-0.385)).toBe("38.5%");
    expect(formatPctMagnitude(0.385)).toBe("38.5%");
  });
});

describe("formatPlainPct", () => {
  it("renders an unsigned share", () => {
    expect(formatPlainPct(0.75, 0)).toBe("75%");
  });
});

describe("formatUsd", () => {
  it("keeps more precision as the value gets smaller", () => {
    expect(formatUsd(1234.5)).toBe("$1,235");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(0.001234)).toBe("$0.001234");
  });

  it("renders an empty balance as plain money, not six decimals", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });
});

describe("formatUnits", () => {
  it("trims trailing zeros rather than padding tiny holdings", () => {
    expect(formatUnits(0)).toBe("0");
    expect(formatUnits(1.5)).toBe("1.5");
    expect(formatUnits(0.123456)).toBe("0.123456");
  });
});
