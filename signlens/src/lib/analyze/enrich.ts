import "server-only";
import { createPublicClient, http, parseAbi, type Address, type PublicClient } from "viem";
import type { AddressInfo, Enricher, TokenInfo } from "./types";

/** Public RPCs; keyless, rate-limited, good enough for a few calls per analysis. */
const RPCS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  11155111: "https://ethereum-sepolia-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  84532: "https://base-sepolia-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  137: "https://polygon-bor-rpc.publicnode.com",
  56: "https://bsc-rpc.publicnode.com",
};

const erc165Abi = parseAbi(["function supportsInterface(bytes4 interfaceId) view returns (bool)"]);
const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const clients = new Map<number, PublicClient>();
function client(chainId: number): PublicClient | null {
  const url = RPCS[chainId];
  if (!url) return null;
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ transport: http(url, { timeout: 6_000, retryCount: 1 }) });
    clients.set(chainId, c);
  }
  return c;
}

const cache = new Map<string, unknown>();
async function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const v = await fn();
  cache.set(key, v);
  if (cache.size > 2_000) cache.delete(cache.keys().next().value as string);
  return v;
}

async function sourcifyVerified(chainId: number, address: string): Promise<boolean | null> {
  return memo(`sourcify:${chainId}:${address.toLowerCase()}`, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(`https://sourcify.dev/server/v2/contract/${chainId}/${address}`, { signal: controller.signal, cache: "no-store" });
      if (res.status === 200) return true;
      if (res.status === 404) return false;
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  });
}

export const liveEnricher: Enricher = {
  async addressInfo(chainId, address): Promise<AddressInfo> {
    const c = chainId !== null ? client(chainId) : null;
    if (!c || chainId === null) return { address, isContract: null, verified: null };
    return memo(`addr:${chainId}:${address.toLowerCase()}`, async () => {
      let isContract: boolean | null = null;
      try {
        const code = await c.getCode({ address: address as Address });
        isContract = Boolean(code && code !== "0x");
      } catch {
        isContract = null;
      }
      const verified = isContract ? await sourcifyVerified(chainId, address) : null;
      return { address, isContract, verified };
    });
  },

  async tokenInfo(chainId, address): Promise<TokenInfo> {
    const c = chainId !== null ? client(chainId) : null;
    if (!c || chainId === null) return { address, standard: "unknown" };
    return memo(`token:${chainId}:${address.toLowerCase()}`, async () => {
      const a = address as Address;
      const [is721, is1155] = await Promise.all([
        c.readContract({ address: a, abi: erc165Abi, functionName: "supportsInterface", args: ["0x80ac58cd"] }).catch(() => false),
        c.readContract({ address: a, abi: erc165Abi, functionName: "supportsInterface", args: ["0xd9b67a26"] }).catch(() => false),
      ]);
      const [symbol, name, decimals] = await Promise.all([
        c.readContract({ address: a, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined),
        c.readContract({ address: a, abi: erc20Abi, functionName: "name" }).catch(() => undefined),
        c.readContract({ address: a, abi: erc20Abi, functionName: "decimals" }).catch(() => undefined),
      ]);
      const standard: TokenInfo["standard"] = is721 ? "erc721" : is1155 ? "erc1155" : decimals !== undefined ? "erc20" : "unknown";
      return {
        address,
        symbol: typeof symbol === "string" ? symbol : undefined,
        name: typeof name === "string" ? name : undefined,
        decimals: typeof decimals === "number" ? decimals : undefined,
        standard,
      };
    });
  },
};
