import { NextResponse } from "next/server";

import { fetchAddressBalances, isEthAddress } from "@/lib/evm-balances";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address") || "";
  if (!isEthAddress(address)) {
    return NextResponse.json(
      { ok: false, error: "Ethereum address must be 0x plus 40 hex characters." },
      { status: 400 },
    );
  }
  try {
    const balances = await fetchAddressBalances(address);
    return NextResponse.json({ ok: true, ...balances });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Balance lookup failed." },
      { status: 502 },
    );
  }
}
