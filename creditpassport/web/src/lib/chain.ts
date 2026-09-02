import "server-only";
import {
  createPublicClient,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import creditPassportAbi from "./abi/CreditPassport.json";
import { getConfig, type AppConfig } from "./config";

export const TOKEN_DECIMALS = 6;
const CHAIN_INFO_PRECOMPILE = "0x0000000000000000000000000000000000000fd3" as const;
const chainInfoAbi = parseAbi([
  "function get_latest_attestation_height_and_hash(uint64 chainKey) view returns ((uint64 height, bytes32 hash, bool isAttestation, bool exists) result)",
]);

const passportAbi = creditPassportAbi as unknown as Abi;

let clients: { creditcoin: PublicClient; sepolia: PublicClient | null } | null = null;

function getClients(cfg: AppConfig) {
  if (clients) return clients;
  const creditcoin = createPublicClient({
    chain: defineChain({
      id: cfg.chainId,
      name: cfg.deployment === "local" ? "Creditcoin (local anvil)" : "Creditcoin Testnet",
      nativeCurrency: { name: "Creditcoin", symbol: "CTC", decimals: 18 },
      rpcUrls: { default: { http: [cfg.creditcoinRpcUrl] } },
    }),
    transport: http(cfg.creditcoinRpcUrl, { timeout: 15_000 }),
  });
  const sepolia = cfg.sepoliaRpcUrl
    ? createPublicClient({
        chain: defineChain({
          id: 11_155_111,
          name: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [cfg.sepoliaRpcUrl] } },
        }),
        transport: http(cfg.sepoliaRpcUrl, { timeout: 15_000 }),
      })
    : null;
  clients = { creditcoin, sepolia };
  return clients;
}

export interface PaymentView {
  invoiceId: Hex;
  payee: Address;
  amount: string; // raw units as string
  amountFormatted: string;
  dueBlock: number;
  paidBlock: number;
  sourceBlock: number;
  sourceTxIndex: number;
  queryId: Hex;
  dated: boolean;
  onTime: boolean;
  creditcoinTx: Hex | null;
  sepoliaTx: Hex | null;
}

export interface UnderwritingView {
  score: number;
  creditLimit: string;
  creditLimitFormatted: string;
  policyMax: string;
  policyMaxFormatted: string;
  memoURI: string;
  blockNumber: number;
  creditcoinTx: Hex;
}

export interface PassportView {
  address: Address;
  profile: {
    datedVolume: string;
    undatedVolume: string;
    datedVolumeFormatted: string;
    undatedVolumeFormatted: string;
    onTimeCount: number;
    lateCount: number;
    transferCount: number;
    firstPaidBlock: number;
    lastPaidBlock: number;
    score: number;
    creditLimit: string;
    creditLimitFormatted: string;
    drawn: string;
    drawnFormatted: string;
    underwrittenAt: number;
    memoURI: string;
  };
  policyMax: string;
  policyMaxFormatted: string;
  available: string;
  availableFormatted: string;
  payments: PaymentView[];
  underwritings: UnderwritingView[];
  sepoliaHead: number | null;
}

type RawProfile = {
  datedVolume: bigint;
  undatedVolume: bigint;
  onTimeCount: number;
  lateCount: number;
  transferCount: number;
  firstPaidBlock: bigint;
  lastPaidBlock: bigint;
  score: number;
  creditLimit: bigint;
  drawn: bigint;
  underwrittenAt: bigint;
  memoURI: string;
};

type RawPayment = {
  invoiceId: Hex;
  payer: Address;
  payee: Address;
  amount: bigint;
  dueBlock: bigint;
  paidBlock: bigint;
  sourceBlock: bigint;
  sourceTxIndex: bigint;
  queryId: Hex;
};

const fmt = (raw: bigint) => formatUnits(raw, TOKEN_DECIMALS);

export function requirePassport(cfg: AppConfig): Address {
  if (!cfg.contracts.creditPassport) {
    throw new Error(
      "CreditPassport is not deployed for this configuration. Run the deploy scripts (or scripts/demo-local.sh with DEPLOYMENT=local).",
    );
  }
  return cfg.contracts.creditPassport;
}

const sepoliaTxCache = new Map<string, Hex | null>();

async function resolveSepoliaTx(cfg: AppConfig, block: number, index: number): Promise<Hex | null> {
  const { sepolia } = getClients(cfg);
  if (!sepolia || block === 0) return null;
  const key = `${block}:${index}`;
  const hit = sepoliaTxCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const b = await sepolia.getBlock({ blockNumber: BigInt(block), includeTransactions: false });
    const hash = (b.transactions[index] as Hex | undefined) ?? null;
    sepoliaTxCache.set(key, hash);
    return hash;
  } catch {
    return null;
  }
}

export async function readPassport(address: Address): Promise<PassportView> {
  const cfg = getConfig();
  const passport = requirePassport(cfg);
  const { creditcoin, sepolia } = getClients(cfg);

  const [profileRaw, paymentsRaw, policyMax, available, verifiedLogs, underwrittenLogs, sepoliaHead] = await Promise.all([
    creditcoin.readContract({ address: passport, abi: passportAbi, functionName: "getProfile", args: [address] }) as Promise<RawProfile>,
    creditcoin.readContract({ address: passport, abi: passportAbi, functionName: "getPayments", args: [address] }) as Promise<RawPayment[]>,
    creditcoin.readContract({ address: passport, abi: passportAbi, functionName: "maxCreditLimit", args: [address] }) as Promise<bigint>,
    creditcoin.readContract({ address: passport, abi: passportAbi, functionName: "availableCredit", args: [address] }) as Promise<bigint>,
    creditcoin.getContractEvents({
      address: passport,
      abi: passportAbi,
      eventName: "PaymentVerified",
      args: { payer: address },
      fromBlock: 0n,
      toBlock: "latest",
    }),
    creditcoin.getContractEvents({
      address: passport,
      abi: passportAbi,
      eventName: "Underwritten",
      args: { user: address },
      fromBlock: 0n,
      toBlock: "latest",
    }),
    sepolia ? sepolia.getBlockNumber().then(Number).catch(() => null) : Promise.resolve(null),
  ]);

  const txByQuery = new Map<string, Hex>();
  for (const log of verifiedLogs) {
    const args = log.args as { queryId?: Hex };
    if (args.queryId && log.transactionHash) txByQuery.set(args.queryId.toLowerCase(), log.transactionHash);
  }

  const payments: PaymentView[] = await Promise.all(
    paymentsRaw.map(async (p) => {
      const dated = p.dueBlock !== 0n;
      return {
        invoiceId: p.invoiceId,
        payee: p.payee,
        amount: p.amount.toString(),
        amountFormatted: fmt(p.amount),
        dueBlock: Number(p.dueBlock),
        paidBlock: Number(p.paidBlock),
        sourceBlock: Number(p.sourceBlock),
        sourceTxIndex: Number(p.sourceTxIndex),
        queryId: p.queryId,
        dated,
        onTime: dated && p.paidBlock <= p.dueBlock,
        creditcoinTx: txByQuery.get(p.queryId.toLowerCase()) ?? null,
        sepoliaTx: await resolveSepoliaTx(cfg, Number(p.sourceBlock), Number(p.sourceTxIndex)),
      };
    }),
  );

  const underwritings: UnderwritingView[] = underwrittenLogs
    .map((log) => {
      const a = log.args as { score?: number; creditLimit?: bigint; policyMax?: bigint; memoURI?: string };
      return {
        score: Number(a.score ?? 0),
        creditLimit: (a.creditLimit ?? 0n).toString(),
        creditLimitFormatted: fmt(a.creditLimit ?? 0n),
        policyMax: (a.policyMax ?? 0n).toString(),
        policyMaxFormatted: fmt(a.policyMax ?? 0n),
        memoURI: a.memoURI ?? "",
        blockNumber: Number(log.blockNumber ?? 0n),
        creditcoinTx: log.transactionHash as Hex,
      };
    })
    .sort((a, b) => b.blockNumber - a.blockNumber);

  return {
    address,
    profile: {
      datedVolume: profileRaw.datedVolume.toString(),
      undatedVolume: profileRaw.undatedVolume.toString(),
      datedVolumeFormatted: fmt(profileRaw.datedVolume),
      undatedVolumeFormatted: fmt(profileRaw.undatedVolume),
      onTimeCount: Number(profileRaw.onTimeCount),
      lateCount: Number(profileRaw.lateCount),
      transferCount: Number(profileRaw.transferCount),
      firstPaidBlock: Number(profileRaw.firstPaidBlock),
      lastPaidBlock: Number(profileRaw.lastPaidBlock),
      score: Number(profileRaw.score),
      creditLimit: profileRaw.creditLimit.toString(),
      creditLimitFormatted: fmt(profileRaw.creditLimit),
      drawn: profileRaw.drawn.toString(),
      drawnFormatted: fmt(profileRaw.drawn),
      underwrittenAt: Number(profileRaw.underwrittenAt),
      memoURI: profileRaw.memoURI,
    },
    policyMax: policyMax.toString(),
    policyMaxFormatted: fmt(policyMax),
    available: available.toString(),
    availableFormatted: fmt(available),
    payments: payments.sort((a, b) => b.paidBlock - a.paidBlock),
    underwritings,
    sepoliaHead,
  };
}

export interface RecentPayer {
  address: Address;
  verifiedCount: number;
  lastBlock: number;
  lastAmountFormatted: string;
}

export async function recentPayers(limit = 8): Promise<RecentPayer[]> {
  const cfg = getConfig();
  const passport = requirePassport(cfg);
  const { creditcoin } = getClients(cfg);
  const logs = await creditcoin.getContractEvents({
    address: passport,
    abi: passportAbi,
    eventName: "PaymentVerified",
    fromBlock: 0n,
    toBlock: "latest",
  });
  const byPayer = new Map<string, RecentPayer>();
  for (const log of logs) {
    const a = log.args as { payer?: Address; amount?: bigint };
    if (!a.payer) continue;
    const cur = byPayer.get(a.payer) ?? { address: a.payer, verifiedCount: 0, lastBlock: 0, lastAmountFormatted: "0" };
    cur.verifiedCount += 1;
    const bn = Number(log.blockNumber ?? 0n);
    if (bn >= cur.lastBlock) {
      cur.lastBlock = bn;
      cur.lastAmountFormatted = fmt(a.amount ?? 0n);
    }
    byPayer.set(a.payer, cur);
  }
  return [...byPayer.values()].sort((x, y) => y.lastBlock - x.lastBlock).slice(0, limit);
}

export interface ChainStatus {
  deployment: string;
  chainId: number;
  creditcoinHead: number | null;
  sepoliaHead: number | null;
  attestedHeight: number | null;
  attestationLagBlocks: number | null;
  contracts: AppConfig["contracts"];
  errors: string[];
}

export async function chainStatus(): Promise<ChainStatus> {
  const cfg = getConfig();
  const { creditcoin, sepolia } = getClients(cfg);
  const errors: string[] = [];

  const [creditcoinHead, sepoliaHead, attested] = await Promise.all([
    creditcoin.getBlockNumber().then(Number).catch((e) => {
      errors.push(`creditcoin rpc: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }),
    sepolia
      ? sepolia.getBlockNumber().then(Number).catch((e) => {
          errors.push(`sepolia rpc: ${(e as Error).message.split("\n")[0]}`);
          return null;
        })
      : Promise.resolve(null),
    creditcoin
      .readContract({
        address: CHAIN_INFO_PRECOMPILE,
        abi: chainInfoAbi,
        functionName: "get_latest_attestation_height_and_hash",
        args: [BigInt(cfg.sourceChainKey)],
      })
      .then((r) => (r.exists ? Number(r.height) : null))
      .catch(() => null), // absent on local anvil
  ]);

  return {
    deployment: cfg.deployment,
    chainId: cfg.chainId,
    creditcoinHead,
    sepoliaHead,
    attestedHeight: attested,
    attestationLagBlocks: attested !== null && sepoliaHead !== null ? sepoliaHead - attested : null,
    contracts: cfg.contracts,
    errors,
  };
}
