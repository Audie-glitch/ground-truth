import { NextResponse } from "next/server";

import { runBacktest } from "@/lib/backtest";
import { fetchDailyCandles, UpstreamError } from "@/lib/coingecko";
import { defaultParams, isTradeableWindow, STRATEGIES } from "@/lib/strategies";

export const dynamic = "force-dynamic";

const ALLOWED_DAYS = [90, 180, 365];

/**
 * Runs every strategy at its default settings over one window. This is the
 * comparison that actually answers "which approach works", because a single
 * strategy's return means nothing without the buy-and-hold line next to it.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const coinId = typeof body.coinId === "string" ? body.coinId.trim() : "";
  if (!/^[a-z0-9-]{1,64}$/i.test(coinId)) {
    return NextResponse.json({ error: "Pick a valid asset." }, { status: 400 });
  }

  const days = Number(body.days);
  if (!ALLOWED_DAYS.includes(days)) {
    return NextResponse.json({ error: "Unsupported window." }, { status: 400 });
  }

  const initialCapital = clamp(body.initialCapital, 1, 10_000_000, 10_000);
  const feeBps = clamp(body.feeBps, 0, 500, 10);
  const slippageBps = clamp(body.slippageBps, 0, 500, 5);

  try {
    const candles = await fetchDailyCandles(coinId, days);
    if (!isTradeableWindow(candles)) {
      return NextResponse.json(
        { error: "Not enough price history for this asset to simulate." },
        { status: 422 },
      );
    }

    const rows = STRATEGIES.map((spec) => {
      const result = runBacktest({
        candles,
        strategyId: spec.id,
        params: defaultParams(spec.id),
        initialCapital,
        feeBps,
        slippageBps,
        coinId,
        coinLabel: coinId,
      });
      return {
        strategyId: spec.id,
        name: spec.name,
        tagline: spec.tagline,
        family: spec.family,
        totalReturn: result.metrics.totalReturn,
        maxDrawdown: result.metrics.maxDrawdown,
        sharpe: result.metrics.sharpe,
        tradeCount: result.metrics.tradeCount,
        feesPaid: result.metrics.feesPaid,
        winRate: result.metrics.winRate,
        timeInMarket: result.metrics.timeInMarket,
        finalEquity: result.metrics.finalEquity,
      };
    }).sort((a, b) => b.totalReturn - a.totalReturn);

    return NextResponse.json({
      rows,
      initialCapital,
      days: Math.round(
        (candles[candles.length - 1].t - candles[0].t) / 86_400_000,
      ),
      from: candles[0].t,
      to: candles[candles.length - 1].t,
    });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "Could not run the comparison.";
    return NextResponse.json({ error: message }, { status });
  }
}

function clamp(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
