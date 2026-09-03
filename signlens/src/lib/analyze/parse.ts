import { isAddress, isHex, type Hex } from "viem";

export interface TxRequest {
  kind: "transaction";
  method: string;
  from?: string;
  to?: string;
  data: Hex;
  value: bigint;
  chainId: number | null;
}

export interface BatchRequest {
  kind: "batch";
  method: string;
  chainId: number | null;
  calls: TxRequest[];
}

export interface TypedDataRequest {
  kind: "typed-data";
  method: string;
  chainId: number | null;
  domain: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}

export interface PersonalSignRequest {
  kind: "personal-sign";
  method: string;
  chainId: number | null;
  raw: string;
}

export interface EthSignRequest {
  kind: "eth-sign";
  method: string;
  chainId: number | null;
  hash: string;
}

export type ParsedRequest = TxRequest | BatchRequest | TypedDataRequest | PersonalSignRequest | EthSignRequest;

export class ParseError extends Error {}

function toBigInt(v: unknown): bigint {
  if (v === undefined || v === null || v === "" || v === "0x") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (/^0x[0-9a-fA-F]*$/.test(s)) return s.length > 2 ? BigInt(s) : 0n;
    if (/^\d+$/.test(s)) return BigInt(s);
  }
  throw new ParseError(`cannot read numeric value: ${String(v)}`);
}

function toChainId(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  try {
    const n = Number(toBigInt(v));
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function asHexData(v: unknown): Hex {
  if (v === undefined || v === null || v === "") return "0x";
  if (typeof v !== "string" || !isHex(v, { strict: false })) throw new ParseError("transaction data must be 0x-prefixed hex");
  return (v.length % 2 === 0 ? v : `0x0${v.slice(2)}`) as Hex;
}

function txFromObject(obj: Record<string, unknown>, method: string, chainId: number | null): TxRequest {
  const to = typeof obj.to === "string" && obj.to ? obj.to : undefined;
  if (to && !isAddress(to)) throw new ParseError(`"to" is not a valid address: ${to}`);
  const from = typeof obj.from === "string" && isAddress(obj.from) ? obj.from : undefined;
  return {
    kind: "transaction",
    method,
    from,
    to,
    data: asHexData(obj.data ?? obj.input),
    value: toBigInt(obj.value),
    chainId: toChainId(obj.chainId) ?? chainId,
  };
}

function typedFromObject(obj: Record<string, unknown>, method: string, chainId: number | null): TypedDataRequest {
  const types = obj.types as TypedDataRequest["types"] | undefined;
  const message = obj.message as Record<string, unknown> | undefined;
  if (!types || !message || typeof obj.primaryType !== "string") {
    throw new ParseError("typed data needs types, primaryType and message");
  }
  const domain = (obj.domain as Record<string, unknown>) ?? {};
  return {
    kind: "typed-data",
    method,
    chainId: toChainId(domain.chainId) ?? chainId,
    domain,
    primaryType: obj.primaryType,
    types,
    message,
  };
}

function looksLikeTypedData(obj: Record<string, unknown>): boolean {
  return "types" in obj && "primaryType" in obj && "message" in obj;
}

function looksLikeTx(obj: Record<string, unknown>): boolean {
  return "to" in obj || "data" in obj || "input" in obj || "value" in obj;
}

/**
 * Accepts what a dApp hands a wallet: a JSON-RPC request, a bare transaction object, bare EIP-712
 * typed data (object or string), or raw calldata. `chainIdHint` applies when the payload carries none.
 */
export function parseRequest(input: string, chainIdHint: number | null = null): ParsedRequest {
  const text = input.trim();
  if (!text) throw new ParseError("paste a wallet request first");

  if (/^0x[0-9a-fA-F]*$/.test(text)) {
    if (text.length === 66) return { kind: "eth-sign", method: "eth_sign", chainId: chainIdHint, hash: text };
    return { kind: "transaction", method: "calldata", data: asHexData(text), value: 0n, chainId: chainIdHint };
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new ParseError("input is neither hex calldata nor JSON");
  }
  if (Array.isArray(obj)) {
    // A params array on its own: try the first element as a transaction.
    if (obj.length > 0 && typeof obj[0] === "object" && obj[0] !== null) {
      return parseRequest(JSON.stringify(obj[0]), chainIdHint);
    }
    throw new ParseError("unsupported array payload");
  }
  if (typeof obj !== "object" || obj === null) throw new ParseError("unsupported payload");
  const o = obj as Record<string, unknown>;

  if (typeof o.method === "string") {
    const method = o.method;
    const params = Array.isArray(o.params) ? (o.params as unknown[]) : [];
    switch (method) {
      case "eth_sendTransaction":
      case "eth_signTransaction":
      case "eth_estimateGas": {
        const tx = params[0];
        if (typeof tx !== "object" || tx === null) throw new ParseError(`${method} needs a transaction object in params[0]`);
        return txFromObject(tx as Record<string, unknown>, method, chainIdHint);
      }
      case "wallet_sendCalls": {
        const bundle = params[0] as Record<string, unknown> | undefined;
        const calls = Array.isArray(bundle?.calls) ? (bundle!.calls as Record<string, unknown>[]) : [];
        const chainId = toChainId(bundle?.chainId) ?? chainIdHint;
        return { kind: "batch", method, chainId, calls: calls.map((c) => txFromObject(c, method, chainId)) };
      }
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        // params: [address, typedData] (typedData may be a JSON string); v1 legacy used [typedData, address]
        const candidate = params.find((p) => typeof p === "object" && p !== null && "types" in (p as object)) ??
          params.find((p) => typeof p === "string" && p.trim().startsWith("{"));
        if (candidate === undefined) throw new ParseError(`${method} params do not contain typed data`);
        const td = typeof candidate === "string" ? (JSON.parse(candidate) as Record<string, unknown>) : (candidate as Record<string, unknown>);
        return typedFromObject(td, method, chainIdHint);
      }
      case "personal_sign": {
        // params: [message, address] per spec; some wallets accept the reverse.
        const msg = params.find((p) => typeof p === "string" && !isAddress(p as string)) as string | undefined;
        if (msg === undefined) throw new ParseError("personal_sign params do not contain a message");
        return { kind: "personal-sign", method, chainId: chainIdHint, raw: msg };
      }
      case "eth_sign": {
        const hash = params.find((p) => typeof p === "string" && !isAddress(p as string)) as string | undefined;
        if (!hash) throw new ParseError("eth_sign params do not contain a hash");
        return { kind: "eth-sign", method, chainId: chainIdHint, hash };
      }
      default:
        throw new ParseError(`unsupported method ${method}`);
    }
  }

  if (looksLikeTypedData(o)) return typedFromObject(o, "eth_signTypedData_v4", chainIdHint);
  if (looksLikeTx(o)) return txFromObject(o, "eth_sendTransaction", chainIdHint);
  throw new ParseError("could not recognise this payload as a transaction, typed data, or signing request");
}
