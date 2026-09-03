import { NextResponse } from "next/server";

import { fetchDailyCandles, UpstreamError } from "@/lib/coingecko";
import { runMonteCarlo } from "@/lib/monte-carlo";
import { defaultParams, isTradeableWindow, STRATEGIES } from "@/lib/strategies";
import type { StrategyId } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [90, 180, 365];

type Body = {
  coinId?: unknown;
  coinLabel?: unknown;
  days?: unknown;
  strategyId?: unknown;
  params?: unknown;
  initialCapital?: unknown;
  feeBps?: unknown;
  slippageBps?: unknown;
  simulations?: unknown;
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

  const initialCapital = clamp(body.initialCapital, 1, 10_000_000, 10_000);
  const feeBps = clamp(body.feeBps, 0, 500, 10);
  const slippageBps = clamp(body.slippageBps, 0, 500, 5);
  const simulations = clamp(body.simulations, 100, 3000, 800);

  const spec = STRATEGIES.find((s) => s.id === strategyId)!;
  const rawParams = (body.params ?? {}) as Record<string, unknown>;
  const params: Record<string, number> = {};
  for (const p of spec.params) {
    params[p.key] = clamp(rawParams[p.key], p.min, p.max, p.default);
  }
  if (spec.params.length === 0) Object.assign(params, defaultParams(strategyId));

  try {
    const candles = await fetchDailyCandles(coinId, days);
    if (!isTradeableWindow(candles)) {
      return NextResponse.json(
        { error: "Not enough price history for this asset to simulate." },
        { status: 422 },
      );
    }

    const result = runMonteCarlo({
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
      simulations,
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Monte Carlo")) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "Could not run Monte Carlo simulation.";
    return NextResponse.json({ error: message }, { status });
  }
}

function clamp(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
