import { existsSync, readFileSync } from "node:fs";

type StatusFile = {
  stage?: string;
  url?: string;
  t?: string;
};

const CONNECT_HOST = "connect.phantom.app";
const CODE_TTL_SEC = 600;

function readStatus(file: string): StatusFile {
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as StatusFile;
  } catch {
    return {};
  }
}

export function isAllowedPhantomConnectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === CONNECT_HOST;
  } catch {
    return false;
  }
}

export function currentPhantomConnectUrl(): string | null {
  const portal = readStatus("/tmp/phantom-portal-status.json");
  const dcr2 = readStatus("/tmp/phantom-dcr2-status.json");
  const portalMs = portal.t ? Date.parse(portal.t) : NaN;
  const portalTtl = Number.isFinite(portalMs)
    ? Math.max(0, Math.round(CODE_TTL_SEC - (Date.now() - portalMs) / 1000))
    : 0;
  const connect = portal.stage === "waiting" && portalTtl > 0 ? portal : dcr2;
  const mintedMs = connect.t ? Date.parse(connect.t) : NaN;
  const ttlLeftSec = Number.isFinite(mintedMs)
    ? Math.max(0, Math.round(CODE_TTL_SEC - (Date.now() - mintedMs) / 1000))
    : 0;
  if (connect.stage !== "waiting" || ttlLeftSec <= 0 || !connect.url) return null;
  if (existsSync(`${process.env.HOME || ""}/.phantom-mcp/session.json`)) return null;
  return isAllowedPhantomConnectUrl(connect.url) ? connect.url : null;
}
