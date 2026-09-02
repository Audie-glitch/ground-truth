import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { readPassport } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address)) {
    return NextResponse.json({ error: "not a valid address" }, { status: 400 });
  }
  try {
    const view = await readPassport(address);
    return NextResponse.json(view, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
