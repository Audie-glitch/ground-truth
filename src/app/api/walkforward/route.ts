import { NextResponse } from "next/server";

import { fetchDailyCandles, UpstreamError } from "@/lib/coingecko";
import { isTradeableWindow, STRATEGIES } from "@/lib/strategies";
import type { StrategyId, WalkForwardObjective } from "@/lib/types";
import { runWalkForward } from "@/lib/walk-forward";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [180, 365];

type Body = {
  coinId?: unknown;
  coinLabel?: unknown;
  days?: unknown;
  strategyId?: unknown;
  initialCapital?: unknown;
  feeBps?: unknown;
  slippageBps?: unknown;
  trainRatio?: unknown;
  objective?: unknown;
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
  const trainRatio = clamp(body.trainRatio, 0.55, 0.75, 0.65);

  const objectiveRaw = body.objective;
  const objective: WalkForwardObjective =
    objectiveRaw === "sharpe" ? "sharpe" : "return";

  try {
    const candles = await fetchDailyCandles(coinId, days);
    if (!isTradeableWindow(candles)) {
      return NextResponse.json(
        { error: "Not enough price history for this asset to simulate." },
        { status: 422 },
      );
    }

    const result = runWalkForward({
      candles,
      strategyId,
      initialCapital,
      feeBps,
      slippageBps,
      coinId,
      coinLabel:
        typeof body.coinLabel === "string" && body.coinLabel
          ? body.coinLabel
          : coinId,
      trainRatio,
      objective,
    });

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof Error && error.message.includes("walk-forward")) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "Could not run walk-forward test.";
    return NextResponse.json({ error: message }, { status });
  }
}

function clamp(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
