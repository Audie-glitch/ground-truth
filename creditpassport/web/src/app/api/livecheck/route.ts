import { NextResponse } from "next/server";
import { isHex } from "viem";
import { findRecentTransfer, runLiveCheck } from "@/lib/livecheck";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { txHash?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  try {
    let txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    if (!txHash) txHash = await findRecentTransfer();
    if (!isHex(txHash) || txHash.length !== 66) return NextResponse.json({ error: "txHash must be a 32-byte hex hash" }, { status: 400 });
    const result = await runLiveCheck(txHash);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
