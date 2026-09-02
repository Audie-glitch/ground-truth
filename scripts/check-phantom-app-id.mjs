#!/usr/bin/env node
/**
 * Classify a Phantom app ID before starting login.
 * Does not print tokens and does not start a device-code flow.
 *
 * Usage: node scripts/check-phantom-app-id.mjs <app-id>
 */
const appId = (process.argv[2] || process.env.PHANTOM_APP_ID || process.env.PHANTOM_CLIENT_ID || "").trim();
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
  console.log(JSON.stringify({ ok: false, error: "Pass a UUID app ID as argv or PHANTOM_APP_ID." }));
  process.exit(2);
}

const res = await fetch(`https://api.phantom.app/v1/wallets/whitelist/${appId}`, {
  headers: {
    accept: "application/json",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    origin: "https://connect.phantom.app",
  },
});
const body = await res.json().catch(() => ({}));
const createdAt = body.createdAt;
const createdMs = createdAt ? Date.parse(createdAt) : NaN;
const stub =
  body.id === body.externalId &&
  Array.isArray(body.redirectUris) &&
  body.redirectUris.length === 0 &&
  Number.isFinite(createdMs) &&
  Date.now() - createdMs < 60_000;

console.log(
  JSON.stringify({
    ok: res.ok,
    appId,
    realWhitelistRow: Boolean(res.ok && !stub && createdAt),
    stub,
    status: body.status,
    enabled: body.enabled,
    createdAt,
    redirectUriCount: Array.isArray(body.redirectUris) ? body.redirectUris.length : 0,
  }),
);
process.exit(res.ok && !stub ? 0 : 1);
