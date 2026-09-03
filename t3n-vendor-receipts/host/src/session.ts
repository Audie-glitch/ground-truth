/** Shared env + auth helpers. Never write a key to disk. */

export const CLAIM_PAGE = "https://www.terminal3.io/claim-page";
export const COMMUNITY_SSO = "https://go.terminal3.io/adk-community";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing. Claim a key at ${CLAIM_PAGE} (or ${COMMUNITY_SSO}), then export it in this shell. Do not write the key into a file. Tenant and agent keys must be different.`,
    );
  }
  return value;
}

export function tenantIdFromDid(tenantDid: string): string {
  const prefix = "did:t3n:";
  if (!tenantDid.startsWith(prefix)) {
    throw new Error(
      `tenantDid must be read from the authenticated session (did:t3n:…), got ${tenantDid}`,
    );
  }
  return tenantDid.slice(prefix.length);
}
