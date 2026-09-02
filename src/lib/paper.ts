import type { PaperAccount, PaperFill, PaperPosition } from "./types";

export const PAPER_STORAGE_KEY = "ground-truth.paper.v1";
export const PAPER_STARTING_CASH = 10_000;
export const PAPER_FEE_BPS = 10;

export function emptyAccount(): PaperAccount {
  return {
    cash: PAPER_STARTING_CASH,
    startingCash: PAPER_STARTING_CASH,
    positions: [],
    fills: [],
    openedAt: Date.now(),
  };
}

export function loadAccount(): PaperAccount {
  if (typeof window === "undefined") return emptyAccount();
  try {
    const raw = window.localStorage.getItem(PAPER_STORAGE_KEY);
    if (!raw) return emptyAccount();
    const parsed = JSON.parse(raw) as Partial<PaperAccount>;
    if (
      typeof parsed.cash !== "number" ||
      !Array.isArray(parsed.positions) ||
      !Array.isArray(parsed.fills)
    ) {
      return emptyAccount();
    }
    return {
      cash: parsed.cash,
      startingCash: parsed.startingCash ?? PAPER_STARTING_CASH,
      positions: parsed.positions as PaperPosition[],
      fills: parsed.fills as PaperFill[],
      openedAt: parsed.openedAt ?? Date.now(),
    };
  } catch {
    return emptyAccount();
  }
}

export function saveAccount(account: PaperAccount): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(account));
  } catch {
    // A full or blocked storage quota should never break the desk itself.
  }
}

export type OrderRequest = {
  coinId: string;
  symbol: string;
  name: string;
  side: "buy" | "sell";
  /** USD notional for a buy, asset units for a sell. */
  amount: number;
  price: number;
};

export type OrderOutcome =
  | { ok: true; account: PaperAccount; fill: PaperFill }
  | { ok: false; error: string };

export function placeOrder(
  account: PaperAccount,
  order: OrderRequest,
): OrderOutcome {
  const feeRate = PAPER_FEE_BPS / 10_000;

  if (!Number.isFinite(order.amount) || order.amount <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }
  if (!Number.isFinite(order.price) || order.price <= 0) {
    return { ok: false, error: "No live price available for this asset." };
  }

  const positions = account.positions.map((p) => ({ ...p }));
  const existing = positions.find((p) => p.coinId === order.coinId);

  if (order.side === "buy") {
    const gross = order.amount;
    if (gross > account.cash + 1e-9) {
      return { ok: false, error: "Not enough simulated cash for that order." };
    }
    const notional = gross / (1 + feeRate);
    const fee = notional * feeRate;
    const units = notional / order.price;

    if (existing) {
      existing.units += units;
      existing.costBasis += notional + fee;
    } else {
      positions.push({
        coinId: order.coinId,
        symbol: order.symbol,
        name: order.name,
        units,
        costBasis: notional + fee,
      });
    }

    const fill = makeFill(order, units, notional, fee);
    return {
      ok: true,
      fill,
      account: {
        ...account,
        cash: account.cash - gross,
        positions,
        fills: [fill, ...account.fills].slice(0, 200),
      },
    };
  }

  if (!existing || existing.units <= 0) {
    return { ok: false, error: "You do not hold that asset." };
  }
  const units = Math.min(order.amount, existing.units);
  const proceeds = units * order.price;
  const fee = proceeds * feeRate;
  const share = units / existing.units;

  existing.costBasis -= existing.costBasis * share;
  existing.units -= units;

  const remaining = positions.filter((p) => p.units > 1e-12);
  const fill = makeFill(order, units, proceeds, fee);

  return {
    ok: true,
    fill,
    account: {
      ...account,
      cash: account.cash + proceeds - fee,
      positions: remaining,
      fills: [fill, ...account.fills].slice(0, 200),
    },
  };
}

function makeFill(
  order: OrderRequest,
  units: number,
  notional: number,
  fee: number,
): PaperFill {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    t: Date.now(),
    coinId: order.coinId,
    symbol: order.symbol,
    side: order.side,
    units,
    price: order.price,
    notional,
    fee,
  };
}
