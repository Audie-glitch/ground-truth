import { NextResponse } from "next/server";

import { fetchTopCoins, UpstreamError } from "@/lib/coingecko";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const coins = await fetchTopCoins(25);
    return NextResponse.json({ coins, fetchedAt: Date.now() });
  } catch (error) {
    const status = error instanceof UpstreamError ? error.status : 502;
    const message =
      error instanceof Error ? error.message : "Could not load market data.";
    return NextResponse.json({ error: message }, { status });
  }
}
