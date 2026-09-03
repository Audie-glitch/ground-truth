import assert from "node:assert/strict";
import { test } from "node:test";

import { requireEnv, tenantIdFromDid } from "./session.ts";

test("requireEnv names the missing key and refuses to invent one", () => {
  const previous = process.env.T3N_API_KEY;
  delete process.env.T3N_API_KEY;
  assert.throws(
    () => requireEnv("T3N_API_KEY"),
    /T3N_API_KEY is missing[\s\S]*claim-page/,
  );
  if (previous === undefined) {
    delete process.env.T3N_API_KEY;
  } else {
    process.env.T3N_API_KEY = previous;
  }
});

test("requireEnv returns the exported value", () => {
  process.env.T3N_API_KEY = "0xtest";
  assert.equal(requireEnv("T3N_API_KEY"), "0xtest");
  delete process.env.T3N_API_KEY;
});

test("tenantIdFromDid refuses a constructed wallet-looking value", () => {
  assert.throws(() => tenantIdFromDid("0xabc"), /authenticated session/);
  assert.equal(
    tenantIdFromDid("did:t3n:abcdef0123456789abcdef0123456789abcdef01"),
    "abcdef0123456789abcdef0123456789abcdef01",
  );
});
