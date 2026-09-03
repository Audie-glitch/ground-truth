import { NextResponse } from "next/server";
import { ParseError, analyze } from "@/lib/analyze/analyze";
import { liveEnricher } from "@/lib/analyze/enrich";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { input?: unknown; chainId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const input = typeof body.input === "string" ? body.input : "";
  const chainId = typeof body.chainId === "number" && body.chainId > 0 ? body.chainId : null;
  if (input.length > 200_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });

  try {
    const report = await analyze(input, chainId, liveEnricher);
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof ParseError) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: `analysis failed: ${(err as Error).message}` }, { status: 500 });
  }
}
