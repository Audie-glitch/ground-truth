import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { connectCodeTtlLeftSec } from "@/lib/phantom-connect-url";

export const dynamic = "force-dynamic";

type StatusFile = {
  ok?: boolean;
  stage?: string;
  user_code?: string;
  url?: string;
  t?: string;
  type?: string;
  detail?: string;
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

  function readStatus(file: string): StatusFile {
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as StatusFile;
    } catch {
      return {};
    }
  }

  const portal = readStatus("/tmp/phantom-portal-status.json");
  const dcr2 = readStatus("/tmp/phantom-dcr2-status.json");
  const portalTtl = connectCodeTtlLeftSec(portal, "/tmp/phantom-portal-app/device.json");
  const usePortal = portal.stage === "waiting" && portalTtl > 0;
  const connect = usePortal ? portal : dcr2;
  const ttlLeftSec = usePortal
    ? portalTtl
    : connectCodeTtlLeftSec(connect, "/tmp/phantom-dcr2-device.json");

  let userInput: {
    stage: string | null;
    hint: string | null;
    hasEthereum: boolean;
    ethereumAddress: string | null;
  } = {
    stage: null,
    hint: null,
    hasEthereum: false,
    ethereumAddress: null,
  };
  try {
    const verdict = JSON.parse(readFileSync("/tmp/phantom-user-input-status.json", "utf-8")) as {
      stage?: string;
      hint?: string;
    };
    userInput.stage = verdict.stage ?? null;
    userInput.hint = verdict.hint ?? null;
  } catch {
    /* none yet */
  }
  try {
    const provided = JSON.parse(
      readFileSync(join(homedir(), ".phantom-mcp", "user-provided.json"), "utf-8"),
    ) as { ethereumAddress?: string };
    userInput.ethereumAddress = provided.ethereumAddress || null;
    userInput.hasEthereum = Boolean(provided.ethereumAddress);
  } catch {
    /* none */
  }

  return NextResponse.json({
    session,
    ethereum,
    solana,
    stage: connect.stage ?? null,
    userCode: connect.user_code ?? null,
    url: connect.url ?? null,
    ttlLeftSec,
    waiting: connect.stage === "waiting" && ttlLeftSec > 0 && !session,
    kmsBlocked: connect.stage === "kms",
    kmsType: connect.type ?? null,
    kmsDetail: connect.detail ?? null,
    source: usePortal ? "portal-app" : "dcr",
    userInput,
  });
}
