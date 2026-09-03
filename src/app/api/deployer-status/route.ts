import { NextResponse } from "next/server";

import {
  CREDITPASSPORT_DEPLOYER,
  classifyFunding,
  formatEther,
  readDeployerBalances,
} from "@/lib/deployer-status";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { sepoliaWei, ctcWei } = await readDeployerBalances();
    const state = classifyFunding(sepoliaWei, ctcWei);
    return NextResponse.json({
      address: CREDITPASSPORT_DEPLOYER,
      state,
      sepoliaEth: formatEther(sepoliaWei),
      ctc: formatEther(ctcWei),
      ready: state === "ready",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not read deployer balances.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
