export type Severity = "critical" | "high" | "medium" | "low" | "info";

export const SEVERITY_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];

export function maxSeverity(items: Array<{ severity: Severity }>): Severity {
  let best: Severity = "info";
  for (const it of items) {
    if (SEVERITY_ORDER.indexOf(it.severity) > SEVERITY_ORDER.indexOf(best)) best = it.severity;
  }
  return best;
}

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
}

export interface AddressInfo {
  address: string;
  /** null when no RPC was available for the chain */
  isContract: boolean | null;
  /** Sourcify verification status; null when unknown */
  verified: boolean | null;
  label?: string;
}

export interface TokenInfo {
  address: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  /** ERC-165: 0x80ac58cd (ERC-721) or 0xd9b67a26 (ERC-1155) when detectable */
  standard?: "erc20" | "erc721" | "erc1155" | "unknown";
}

export type RequestKind =
  | "transaction"
  | "batch"
  | "typed-data"
  | "personal-sign"
  | "eth-sign"
  | "unknown";

export interface DecodedField {
  name: string;
  value: string;
  note?: string;
}

export interface Report {
  kind: RequestKind;
  method: string;
  chainId: number | null;
  verdict: Severity;
  summary: string;
  findings: Finding[];
  decoded: DecodedField[];
  target: AddressInfo | null;
  counterparty: AddressInfo | null;
  token: TokenInfo | null;
  /** For batches (EIP-5792 wallet_sendCalls) each call gets its own report. */
  children?: Report[];
}

/** Everything the analyzer may look up on-chain. Injected so tests run offline. */
export interface Enricher {
  addressInfo(chainId: number | null, address: string): Promise<AddressInfo>;
  tokenInfo(chainId: number | null, address: string): Promise<TokenInfo>;
}

export const offlineEnricher: Enricher = {
  async addressInfo(_chainId, address) {
    return { address, isContract: null, verified: null };
  },
  async tokenInfo(_chainId, address) {
    return { address, standard: "unknown" };
  },
};
