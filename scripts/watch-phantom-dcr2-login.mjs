#!/usr/bin/env node
/**
 * Keep exactly one Hydra-assigned DCR device-code login alive.
 * Does not print tokens. Writes /tmp/phantom-dcr2-status.json and
 * /tmp/phantom-dcr2-url.txt. Copies session.json into ~/.phantom-mcp
 * only after KMS returns a walletId.
 *
 * Usage: node scripts/watch-phantom-dcr2-login.mjs
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { Auth2Stamper, _deriveNonce } from "/home/ubuntu/.local/node_modules/@phantom/auth2/dist/index.js";

const sessionDir = "/tmp/phantom-dcr2";
const storageFile = path.join(sessionDir, "auth2-stamper.json");
const statusFile = "/tmp/phantom-dcr2-status.json";
const deviceFile = "/tmp/phantom-dcr2-device.json";
const urlFile = "/tmp/phantom-dcr2-url.txt";
const homeSession = path.join(process.env.HOME, ".phantom-mcp/session.json");
const clientId = "b90d07cd-2585-4ced-af0c-41a2841abb16";
const maxMints = 36;

class FileStorage {
  requiresExtractableKeys = true;
  async open() {
    fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  }
  async load() {
    const stored = JSON.parse(fs.readFileSync(storageFile, "utf-8"));
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
  async save() {}
  async clear() {}
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(statusFile, "utf-8"));
  } catch {
    return null;
  }
}

function anotherPollerExists() {
  const procs = fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p));
  for (const pid of procs) {
    if (pid === String(process.pid)) continue;
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (cmd.includes("phantom-dcr2-poll.mjs")) return true;
    } catch {
      /* gone */
    }
  }
  return false;
}

async function mint() {
  const stamper = new Auth2Stamper(new FileStorage(), {
    authApiBaseUrl: "https://auth.phantom.app",
    clientId,
    redirectUri: "",
  });
  await stamper.init();
  const nonce = await _deriveNonce(stamper.getCryptoKeyPair(), "");
  const keyInfo = stamper.getKeyInfo();
  const deviceRes = await fetch("https://auth.phantom.app/oauth2/device/auth", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0" },
    body: new URLSearchParams({ client_id: clientId, scope: "openid offline_access", nonce }).toString(),
  });
  const deviceAuth = await deviceRes.json();
  if (!deviceRes.ok || !deviceAuth.device_code) {
    fs.writeFileSync(
      statusFile,
      JSON.stringify(
        {
          ok: false,
          stage: "device-auth",
          status: deviceRes.status,
          error: deviceAuth.error,
          t: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return false;
  }
  const url = `https://connect.phantom.app/device-connect?user_code=${encodeURIComponent(deviceAuth.user_code)}&client_id=${encodeURIComponent(clientId)}&public_key=${encodeURIComponent(keyInfo.publicKey)}`;
  fs.writeFileSync(deviceFile, JSON.stringify({ ...deviceAuth, clientId, url }, null, 2), { mode: 0o600 });
  fs.writeFileSync(urlFile, `${url}\nCODE=${deviceAuth.user_code}\n`, { mode: 0o600 });
  fs.writeFileSync(
    statusFile,
    JSON.stringify({ ok: true, stage: "waiting", user_code: deviceAuth.user_code, url, t: new Date().toISOString() }, null, 2),
  );
  console.log(JSON.stringify({ ok: true, stage: "minted", user_code: deviceAuth.user_code }));
  return true;
}

function startPoller() {
  const child = spawn("node", [path.join(path.dirname(fileURLToPath(import.meta.url)), "phantom-dcr2-poll.mjs")], {
    detached: true,
    stdio: ["ignore", fs.openSync("/tmp/phantom-dcr2-login.log", "a"), fs.openSync("/tmp/phantom-dcr2-login.log", "a")],
  });
  child.unref();
}

let mints = 0;
while (mints < maxMints) {
  if (fs.existsSync(homeSession) || fs.existsSync(path.join(sessionDir, "session.json"))) {
    console.log(JSON.stringify({ ok: true, stage: "session-present" }));
    process.exit(0);
  }
  const status = readStatus();
  if (status?.stage === "session") {
    console.log(JSON.stringify({ ok: true, stage: "session-present" }));
    process.exit(0);
  }
  if (status?.stage === "waiting" && anotherPollerExists()) {
    await new Promise((r) => setTimeout(r, 15000));
    continue;
  }
  if (status?.stage === "kms") {
    console.log(JSON.stringify({ ok: false, stage: "kms", type: status.type, detail: status.detail }));
    process.exit(1);
  }
  if (!anotherPollerExists()) {
    const minted = await mint();
    if (!minted) {
      await new Promise((r) => setTimeout(r, 30000));
      mints += 1;
      continue;
    }
    mints += 1;
    startPoller();
  }
  await new Promise((r) => setTimeout(r, 15000));
}
console.log(JSON.stringify({ ok: false, stage: "max-mints" }));
process.exit(1);
