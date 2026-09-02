import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETH = /^0x[0-9a-fA-F]{40}$/;

function looksLikeSecret(value: string) {
  const v = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return true;
  if (/^0x[0-9a-fA-F]{64}$/.test(v)) return true;
  if (v.split(/\s+/).length >= 12) return true;
  return false;
}

export async function POST(request: Request) {
  let body: { appId?: string; ethereumAddress?: string };
  try {
    body = (await request.json()) as { appId?: string; ethereumAddress?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const appId = (body.appId || "").trim();
  const ethereumAddress = (body.ethereumAddress || "").trim();

  if (looksLikeSecret(appId) || looksLikeSecret(ethereumAddress)) {
    return NextResponse.json(
      { ok: false, error: "Do not paste keys, seeds, or hex secrets." },
      { status: 400 },
    );
  }
  if (appId && !UUID.test(appId)) {
    return NextResponse.json({ ok: false, error: "App ID must be a UUID." }, { status: 400 });
  }
  if (ethereumAddress && !ETH.test(ethereumAddress)) {
    return NextResponse.json(
      { ok: false, error: "Ethereum address must be 0x plus 40 hex characters." },
      { status: 400 },
    );
  }
  if (!appId && !ethereumAddress) {
    return NextResponse.json({ ok: false, error: "Provide an App ID or an Ethereum address." }, { status: 400 });
  }

  let classification: { realWhitelistRow?: boolean; stub?: boolean; enabled?: boolean } | null =
    null;
  if (appId) {
    try {
      const res = await fetch(`https://api.phantom.app/v1/wallets/whitelist/${appId}`, {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          origin: "https://connect.phantom.app",
        },
      });
      const row = (await res.json()) as {
        id?: string;
        externalId?: string;
        createdAt?: string;
        enabled?: boolean;
        redirectUris?: unknown[];
      };
      const createdMs = row.createdAt ? Date.parse(row.createdAt) : NaN;
      const stub =
        row.id === row.externalId &&
        Array.isArray(row.redirectUris) &&
        row.redirectUris.length === 0 &&
        Number.isFinite(createdMs) &&
        Date.now() - createdMs < 60_000;
      classification = {
        realWhitelistRow: Boolean(res.ok && !stub && row.createdAt),
        stub,
        enabled: row.enabled,
      };
    } catch {
      classification = null;
    }
  }

  const dir = join(homedir(), ".phantom-mcp");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(dir, "user-provided.json"),
    JSON.stringify(
      {
        appId: appId || null,
        ethereumAddress: ethereumAddress || null,
        classification,
        receivedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  return NextResponse.json({
    ok: true,
    stored: { appId: Boolean(appId), ethereumAddress: Boolean(ethereumAddress) },
    classification,
  });
}
