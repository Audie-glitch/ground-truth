import { NextResponse } from "next/server";

import { runBacktest } from "@/lib/backtest";
import { fetchDailyCandles, UpstreamError } from "@/lib/coingecko";
import { getStrategy, isTradeableWindow, STRATEGIES } from "@/lib/strategies";
import type { StrategyId } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [90, 180, 365];
const MAX_CAPITAL = 10_000_000;

type Body = {
  coinId?: unknown;
  coinLabel?: unknown;
  days?: unknown;
  strategyId?: unknown;
  params?: unknown;
  initialCapital?: unknown;
  feeBps?: unknown;
  slippageBps?: unknown;
};

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Request body must be JSON.");
  }

  const coinId = typeof body.coinId === "string" ? body.coinId.trim() : "";
  if (!/^[a-z0-9-]{1,64}$/i.test(coinId)) return bad("Pick a valid asset.");

  const strategyId = body.strategyId as StrategyId;
  if (!STRATEGIES.some((s) => s.id === strategyId)) {
    return bad("Pick a valid strategy.");
  }

  const days = Number(body.days);
  if (!ALLOWED_DAYS.includes(days)) {
    return bad(`Window must be one of ${ALLOWED_DAYS.join(", ")} days.`);
  }

  const initialCapital = Number(body.initialCapital);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    return bad("Starting capital must be a positive number.");
  }
  if (initialCapital > MAX_CAPITAL) {
    return bad("Starting capital is capped at $10,000,000 in the simulator.");
  }

  const feeBps = clampNumber(body.feeBps, 0, 500, 10);
  const slippageBps = clampNumber(body.slippageBps, 0, 500, 5);

  // Only accept parameters the chosen strategy actually declares, clamped to
  // the range its UI advertises, so a hand-made request cannot produce a
  // nonsensical simulation.
  const spec = getStrategy(strategyId);
  const rawParams = (body.params ?? {}) as Record<string, unknown>;
  const params: Record<string, number> = {};
  for (const p of spec.params) {
    params[p.key] = clampNumber(rawParams[p.key], p.min, p.max, p.default);
  }

  try {
    const candles = await fetchDailyCandles(coinId, days);
    if (!isTradeableWindow(candles)) {
      return NextResponse.json(
        { error: "Not enough price history for this asset to simulate." },
        { status: 422 },
      );
    }

    const result = runBacktest({
      candles,
      strategyId,
      params,
      initialCapital,
      feeBps,
      slippageBps,
      coinId,
      coinLabel:
        typeof body.coinLabel === "string" && body.coinLabel
          ? body.coinLabel
          : coinId,
    });

    return NextResponse.json({ result });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "Could not run the backtest.";
    return NextResponse.json({ error: message }, { status });
  }
}

function clampNumber(
  raw: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
