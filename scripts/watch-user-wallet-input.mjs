#!/usr/bin/env node
/**
 * When the /connect form writes ~/.phantom-mcp/user-provided.json, classify
 * a Portal App ID and start at most one device-code login for it.
 * Does not print tokens. Does not touch the first-client stamper.
 *
 * Usage: node scripts/watch-user-wallet-input.mjs
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { Auth2Stamper, _deriveNonce } from "/home/ubuntu/.local/node_modules/@phantom/auth2/dist/index.js";

const homeDir = path.join(process.env.HOME, ".phantom-mcp");
const inputFile = path.join(homeDir, "user-provided.json");
const appliedFile = "/tmp/phantom-user-input-applied.json";
const verdictFile = "/tmp/phantom-user-input-status.json";
const portalDir = "/tmp/phantom-portal-app";
const portalDevice = path.join(portalDir, "device.json");
const portalStatus = "/tmp/phantom-portal-status.json";
const poller = path.join(path.dirname(fileURLToPath(import.meta.url)), "phantom-dcr2-poll.mjs");

function writeVerdict(obj) {
  fs.writeFileSync(verdictFile, JSON.stringify({ ...obj, t: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify(obj));
}

function alreadyApplied(receivedAt) {
  try {
    return JSON.parse(fs.readFileSync(appliedFile, "utf-8")).receivedAt === receivedAt;
  } catch {
    return false;
  }
}

async function classify(appId) {
  const res = await fetch(`https://api.phantom.app/v1/wallets/whitelist/${appId}`, {
    headers: {
      accept: "application/json",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      origin: "https://connect.phantom.app",
    },
  });
  const body = await res.json().catch(() => ({}));
  const createdMs = body.createdAt ? Date.parse(body.createdAt) : NaN;
  const stub =
    body.id === body.externalId &&
    Array.isArray(body.redirectUris) &&
    body.redirectUris.length === 0 &&
    Number.isFinite(createdMs) &&
    Date.now() - createdMs < 60_000;
  return { ok: res.ok, stub, real: Boolean(res.ok && !stub && body.createdAt), enabled: body.enabled };
}

class FileStorage {
  requiresExtractableKeys = true;
  constructor(file) {
    this.file = file;
  }
  async open() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
  }
  async load() {
    if (!fs.existsSync(this.file)) return null;
    const stored = JSON.parse(fs.readFileSync(this.file, "utf-8"));
    const [publicKey, privateKey] = await Promise.all([
      crypto.subtle.importKey(
        "raw",
        Buffer.from(stored.publicKeyRawBase64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"],
      ),
      crypto.subtle.importKey(
        "pkcs8",
        Buffer.from(stored.privateKeyPkcs8Base64, "base64"),
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      ),
    ]);
    return {
      keyPair: { publicKey, privateKey },
      keyInfo: stored.keyInfo,
      idType: stored.idType,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      tokenExpiresAt: stored.tokenExpiresAt,
    };
  }
  async save(record) {
    const [publicKeyRaw, privateKeyPkcs8] = await Promise.all([
      crypto.subtle.exportKey("raw", record.keyPair.publicKey),
      crypto.subtle.exportKey("pkcs8", record.keyPair.privateKey),
    ]);
    fs.writeFileSync(
      this.file,
      JSON.stringify(
        {
          keyInfo: record.keyInfo,
          publicKeyRawBase64: Buffer.from(publicKeyRaw).toString("base64"),
          privateKeyPkcs8Base64: Buffer.from(privateKeyPkcs8).toString("base64"),
          idType: record.idType,
          accessToken: record.accessToken,
          refreshToken: record.refreshToken,
          tokenExpiresAt: record.tokenExpiresAt,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  async clear() {}
}

async function startPortalDeviceLogin(appId) {
  fs.mkdirSync(portalDir, { recursive: true, mode: 0o700 });
  const stamper = new Auth2Stamper(new FileStorage(path.join(portalDir, "auth2-stamper.json")), {
    authApiBaseUrl: "https://auth.phantom.app",
    clientId: appId,
    redirectUri: "",
  });
  await stamper.init();
  const nonce = await _deriveNonce(stamper.getCryptoKeyPair(), "");
  const keyInfo = stamper.getKeyInfo();
  const deviceRes = await fetch("https://auth.phantom.app/oauth2/device/auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" },
    body: new URLSearchParams({ client_id: appId, scope: "openid offline_access", nonce }).toString(),
  });
  const deviceAuth = await deviceRes.json();
  if (!deviceRes.ok || !deviceAuth.device_code) {
    return {
      granted: false,
      error: deviceAuth.error,
      description: deviceAuth.error_description,
    };
  }
  const url = `https://connect.phantom.app/device-connect?user_code=${encodeURIComponent(deviceAuth.user_code)}&client_id=${encodeURIComponent(appId)}&public_key=${encodeURIComponent(keyInfo.publicKey)}`;
  fs.writeFileSync(portalDevice, JSON.stringify({ ...deviceAuth, clientId: appId, url }, null, 2), { mode: 0o600 });
  fs.writeFileSync(
    portalStatus,
    JSON.stringify({ ok: true, stage: "waiting", user_code: deviceAuth.user_code, url, t: new Date().toISOString() }, null, 2),
  );
  spawn("node", [poller], {
    detached: true,
    env: {
      ...process.env,
      PHANTOM_DCR_DIR: portalDir,
      PHANTOM_DCR_STATUS: portalStatus,
      PHANTOM_DCR_DEVICE: portalDevice,
    },
    stdio: ["ignore", fs.openSync("/tmp/phantom-portal-login.log", "a"), fs.openSync("/tmp/phantom-portal-login.log", "a")],
  }).unref();
  return { granted: true, userCode: deviceAuth.user_code, url };
}

async function apply(input) {
  const appId = input.appId;
  const ethereumAddress = input.ethereumAddress;
  if (ethereumAddress && !appId) {
    writeVerdict({ ok: true, stage: "ethereum-only", hasEthereum: true });
    spawn("node", [path.join(path.dirname(fileURLToPath(import.meta.url)), "inspect-user-balances.mjs")], {
      detached: true,
      stdio: ["ignore", fs.openSync("/tmp/user-wallet-balances.log", "a"), fs.openSync("/tmp/user-wallet-balances.log", "a")],
    }).unref();
    return;
  }
  if (!appId) {
    writeVerdict({ ok: false, stage: "empty" });
    return;
  }
  const row = await classify(appId);
  if (row.stub || !row.real) {
    writeVerdict({ ok: false, stage: "not-portal-app", stub: row.stub, real: row.real });
    return;
  }
  const login = await startPortalDeviceLogin(appId);
  if (!login.granted) {
    writeVerdict({
      ok: false,
      stage: "no-device-grant",
      error: login.error,
      hint: "Run PHANTOM_APP_ID=<id> phantom login on your desktop and paste only the Ethereum address.",
    });
    return;
  }
  writeVerdict({ ok: true, stage: "portal-waiting", userCode: login.userCode, url: login.url });
}

while (true) {
  if (fs.existsSync(path.join(homeDir, "session.json"))) {
    writeVerdict({ ok: true, stage: "session-present" });
    process.exit(0);
  }
  try {
    if (fs.existsSync(inputFile)) {
      const input = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
      if (input.receivedAt && !alreadyApplied(input.receivedAt)) {
        await apply(input);
        fs.writeFileSync(appliedFile, JSON.stringify({ receivedAt: input.receivedAt }, null, 2));
      }
    }
  } catch (error) {
    writeVerdict({ ok: false, stage: "error", error: error instanceof Error ? error.message : String(error) });
  }
  await new Promise((r) => setTimeout(r, 5000));
}
