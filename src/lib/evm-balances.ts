export const ETH_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export const USDC = {
  ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
} as const;

const RPC = {
  ethereum: "https://ethereum.publicnode.com",
  base: "https://mainnet.base.org",
} as const;

export type ChainId = keyof typeof RPC;

export type ChainBalances = {
  native: string;
  usdc: string;
  ok: boolean;
  error?: string;
};

export type AddressBalances = {
  address: string;
  checkedAt: string;
  chains: Record<ChainId, ChainBalances>;
  funded: boolean;
};

export function isEthAddress(value: string): boolean {
  return ETH_ADDRESS.test(value.trim());
}

export function encodeBalanceOf(address: string): string {
  return `0x70a08231${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

export function hexToDecimal(hex: string, decimals: number): string {
  const raw = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  const value = raw === "" ? 0n : BigInt(`0x${raw}`);
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${whole.toString()}.${frac}` : whole.toString();
}

function emptyChain(error: string): ChainBalances {
  return { native: "0", usdc: "0", ok: false, error };
}

async function rpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json()) as { result?: string; error?: { message?: string } };
    if (!res.ok || body.error || typeof body.result !== "string") {
      throw new Error(body.error?.message || `RPC ${method} failed`);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function loadChain(chain: ChainId, address: string): Promise<ChainBalances> {
  try {
    const [nativeHex, usdcHex] = await Promise.all([
      rpc(RPC[chain], "eth_getBalance", [address, "latest"]),
      rpc(RPC[chain], "eth_call", [
        { to: USDC[chain], data: encodeBalanceOf(address) },
        "latest",
      ]),
    ]);
    return {
      native: hexToDecimal(nativeHex, 18),
      usdc: hexToDecimal(usdcHex, 6),
      ok: true,
    };
  } catch (error) {
    return emptyChain(error instanceof Error ? error.message : String(error));
  }
}

export async function fetchAddressBalances(address: string): Promise<AddressBalances> {
  const normalized = address.trim();
  if (!isEthAddress(normalized)) {
    throw new Error("Ethereum address must be 0x plus 40 hex characters.");
  }
  const [ethereum, base] = await Promise.all([
    loadChain("ethereum", normalized),
    loadChain("base", normalized),
  ]);
  const funded = [ethereum, base].some((chain) => {
    if (!chain.ok) return false;
    return Number(chain.native) > 0 || Number(chain.usdc) > 0;
  });
  return {
    address: normalized,
    checkedAt: new Date().toISOString(),
    chains: { ethereum, base },
    funded,
  };
}
