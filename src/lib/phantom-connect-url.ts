import { existsSync, readFileSync, statSync } from "node:fs";

type StatusFile = {
  stage?: string;
  url?: string;
  t?: string;
  user_code?: string;
};

type DeviceFile = {
  user_code?: string;
  expires_in?: number;
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

/** Seconds left on a device code. Prefers device-file mtime so a poller restart cannot fake a fresh TTL. */
export function connectCodeTtlLeftSec(
  status: StatusFile,
  devicePath: string,
  nowMs = Date.now(),
): number {
  if (status.stage !== "waiting") return 0;
  let mintedMs = status.t ? Date.parse(status.t) : NaN;
  let expiresIn = CODE_TTL_SEC;
  try {
    const device = JSON.parse(readFileSync(devicePath, "utf-8")) as DeviceFile;
    if (device.user_code && device.user_code === status.user_code) {
      mintedMs = statSync(devicePath).mtimeMs;
      if (typeof device.expires_in === "number" && device.expires_in > 0) {
        expiresIn = device.expires_in;
      }
    }
  } catch {
    /* fall back to status.t */
  }
  if (!Number.isFinite(mintedMs)) return 0;
  return Math.max(0, Math.round(expiresIn - (nowMs - mintedMs) / 1000));
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
  const portalTtl = connectCodeTtlLeftSec(portal, "/tmp/phantom-portal-app/device.json");
  const connect = portal.stage === "waiting" && portalTtl > 0 ? portal : dcr2;
  const devicePath =
    connect === portal ? "/tmp/phantom-portal-app/device.json" : "/tmp/phantom-dcr2-device.json";
  const ttlLeftSec = connect === portal ? portalTtl : connectCodeTtlLeftSec(connect, devicePath);
  if (connect.stage !== "waiting" || ttlLeftSec <= 0 || !connect.url) return null;
  if (existsSync(`${process.env.HOME || ""}/.phantom-mcp/session.json`)) return null;
  return isAllowedPhantomConnectUrl(connect.url) ? connect.url : null;
}
