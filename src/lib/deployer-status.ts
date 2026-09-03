export const CREDITPASSPORT_DEPLOYER =
  "0x8F72A0f832068555C0edAf649b1F8A37d33bA14D";

/** Same gates as creditpassport/scripts/wait-for-funds.sh */
export const MIN_SEPOLIA_WEI = 10_000_000_000_000_000n;
export const MIN_CTC_WEI = 50_000_000_000_000_000n;

export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const CREDITCOIN_RPC_URL = "https://rpc.cc3-testnet.creditcoin.network";

export type FundingState =
  | "unfunded"
  | "sepolia-only"
  | "ctc-only"
  | "ready";

export function classifyFunding(
  sepoliaWei: bigint,
  ctcWei: bigint,
): FundingState {
  const sepoliaReady = sepoliaWei >= MIN_SEPOLIA_WEI;
  const ctcReady = ctcWei >= MIN_CTC_WEI;
  if (sepoliaReady && ctcReady) return "ready";
  if (sepoliaReady) return "sepolia-only";
  if (ctcReady) return "ctc-only";
  return "unfunded";
}

export function parseHexWei(hex: string): bigint {
  if (!/^0x[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("Balance response was not a hex integer.");
  }
  return BigInt(hex);
}

export function formatEther(wei: bigint, digits = 4): string {
  const whole = wei / 1_000_000_000_000_000_000n;
  const frac = wei % 1_000_000_000_000_000_000n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, digits);
  return `${whole.toString()}.${fracStr}`;
}

type RpcFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ json: () => Promise<{ result?: unknown; error?: { message?: string } }> }>;

async function ethGetBalance(
  rpcUrl: string,
  address: string,
  rpcFetch: RpcFetch,
): Promise<bigint> {
  const res = await rpcFetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const body = await res.json();
  if (typeof body.result !== "string") {
    throw new Error(body.error?.message ?? "RPC did not return a balance.");
  }
  return parseHexWei(body.result);
}

export async function readDeployerBalances(
  rpcFetch: RpcFetch = fetch,
): Promise<{ sepoliaWei: bigint; ctcWei: bigint }> {
  const [sepoliaWei, ctcWei] = await Promise.all([
    ethGetBalance(SEPOLIA_RPC_URL, CREDITPASSPORT_DEPLOYER, rpcFetch),
    ethGetBalance(CREDITCOIN_RPC_URL, CREDITPASSPORT_DEPLOYER, rpcFetch),
  ]);
  return { sepoliaWei, ctcWei };
}
