import { NextResponse } from "next/server";
import { recentPayers } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ payers: await recentPayers() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
