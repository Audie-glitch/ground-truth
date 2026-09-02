import { describe, expect, it } from "vitest";

import { emptyAccount, PAPER_FEE_BPS, placeOrder } from "./paper";
import type { PaperAccount } from "./types";

const FEE_RATE = PAPER_FEE_BPS / 10_000;

function buy(account: PaperAccount, usd: number, price = 100) {
  return placeOrder(account, {
    coinId: "bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    side: "buy",
    amount: usd,
    price,
  });
}

function sell(account: PaperAccount, units: number, price = 100) {
  return placeOrder(account, {
    coinId: "bitcoin",
    symbol: "BTC",
    name: "Bitcoin",
    side: "sell",
    amount: units,
    price,
  });
}

describe("placing a buy", () => {
  it("debits exactly the amount requested, fee included", () => {
    const outcome = buy(emptyAccount(), 1_000);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.account.cash).toBeCloseTo(9_000, 8);
    const notional = 1_000 / (1 + FEE_RATE);
    expect(outcome.fill.fee).toBeCloseTo(notional * FEE_RATE, 10);
    expect(outcome.account.positions[0].units).toBeCloseTo(notional / 100, 10);
  });

  it("refuses to spend cash the account does not have", () => {
    const outcome = buy(emptyAccount(), 25_000);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/not enough/i);
  });

  it("rejects a non-positive amount", () => {
    expect(buy(emptyAccount(), 0).ok).toBe(false);
    expect(buy(emptyAccount(), -50).ok).toBe(false);
  });

  it("rejects an order with no live price", () => {
    const outcome = buy(emptyAccount(), 100, 0);
    expect(outcome.ok).toBe(false);
  });

  it("adds to an existing position rather than creating a second one", () => {
    const first = buy(emptyAccount(), 1_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = buy(first.account, 1_000);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.account.positions).toHaveLength(1);
    expect(second.account.cash).toBeCloseTo(8_000, 8);
  });
});

describe("placing a sell", () => {
  it("closes the position and removes it from the book", () => {
    const opened = buy(emptyAccount(), 1_000);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const units = opened.account.positions[0].units;
    const closed = sell(opened.account, units);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    expect(closed.account.positions).toHaveLength(0);
    // Round tripping at an unchanged price costs both fees and nothing else.
    expect(closed.account.cash).toBeLessThan(10_000);
    expect(closed.account.cash).toBeGreaterThan(9_990);
  });

  it("clamps an oversized sell to the units actually held", () => {
    const opened = buy(emptyAccount(), 1_000);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const held = opened.account.positions[0].units;
    const closed = sell(opened.account, held * 100);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    expect(closed.fill.units).toBeCloseTo(held, 12);
    expect(closed.account.positions).toHaveLength(0);
  });

  it("refuses to sell an asset that is not held", () => {
    const outcome = sell(emptyAccount(), 1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error).toMatch(/do not hold/i);
  });

  it("leaves a proportional cost basis behind on a partial sell", () => {
    const opened = buy(emptyAccount(), 1_000);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const basis = opened.account.positions[0].costBasis;
    const half = opened.account.positions[0].units / 2;
    const partial = sell(opened.account, half);
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;

    expect(partial.account.positions[0].costBasis).toBeCloseTo(basis / 2, 8);
    expect(partial.account.positions[0].units).toBeCloseTo(half, 12);
  });
});

describe("account integrity", () => {
  it("never lets a sequence of orders create value out of nothing", () => {
    let account = emptyAccount();
    for (let i = 0; i < 20; i++) {
      const bought = buy(account, 200, 100);
      if (bought.ok) account = bought.account;
      const held = account.positions[0]?.units ?? 0;
      const sold = sell(account, held / 3, 100);
      if (sold.ok) account = sold.account;
    }

    const holdings = account.positions.reduce((s, p) => s + p.units * 100, 0);
    // Every fill pays a fee at an unchanged price, so the account can only
    // shrink. Anything else would mean the ledger is leaking.
    expect(account.cash + holdings).toBeLessThan(10_000);
    expect(account.cash).toBeGreaterThanOrEqual(0);
  });
});
