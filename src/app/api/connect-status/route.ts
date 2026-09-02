import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type StatusFile = {
  ok?: boolean;
  stage?: string;
  user_code?: string;
  url?: string;
  t?: string;
};

export async function GET() {
  const session = existsSync(join(homedir(), ".phantom-mcp", "session.json"));
  let ethereum: string | null = null;
  let solana: string | null = null;
  const addressesPath = join(homedir(), ".phantom-mcp", "addresses.json");
  if (existsSync(addressesPath)) {
    try {
      const saved = JSON.parse(readFileSync(addressesPath, "utf-8")) as {
        ethereum?: string;
        solana?: string;
      };
      ethereum = saved.ethereum ?? null;
      solana = saved.solana ?? null;
    } catch {
      /* ignore */
    }
  }

  let connect: StatusFile = {};
  try {
    connect = JSON.parse(readFileSync("/tmp/phantom-dcr2-status.json", "utf-8")) as StatusFile;
  } catch {
    connect = {};
  }

  const mintedMs = connect.t ? Date.parse(connect.t) : NaN;
  const ttlLeftSec = Number.isFinite(mintedMs)
    ? Math.max(0, Math.round(600 - (Date.now() - mintedMs) / 1000))
    : 0;

  return NextResponse.json({
    session,
    ethereum,
    solana,
    stage: connect.stage ?? null,
    userCode: connect.user_code ?? null,
    url: connect.url ?? null,
    ttlLeftSec,
    waiting: connect.stage === "waiting" && ttlLeftSec > 0 && !session,
  });
}
