import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isAddress, type Address } from "viem";

export type Deployment = "local" | "testnet";

export interface Explorers {
  creditcoinTx: (hash: string) => string;
  creditcoinAddress: (address: string) => string;
  sepoliaTx: (hash: string) => string;
  sepoliaAddress: (address: string) => string;
}

export interface AppConfig {
  deployment: Deployment;
  chainId: number;
  sourceChainKey: number;
  creditcoinRpcUrl: string;
  sepoliaRpcUrl: string | null;
  agentStatusUrl: string;
  contracts: {
    creditPassport: Address | null;
    paymentRail: Address | null;
    settlementToken: Address | null;
    creditToken: Address | null;
    agent: Address | null;
  };
  explorers: Explorers | null;
}

interface DeploymentFile {
  chainId?: number;
  sourceChainKey?: number;
  creditPassport?: string;
  paymentRail?: string;
  settlementToken?: string;
  creditToken?: string;
  agent?: string;
}

function readDeployment(deployment: Deployment): DeploymentFile {
  const dir = resolve(process.cwd(), "..", "contracts", "deployments");
  const files = deployment === "local" ? ["local.json"] : ["source.json", "creditcoin.json"];
  const out: DeploymentFile = {};
  for (const file of files) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      Object.assign(out, JSON.parse(readFileSync(path, "utf8")) as DeploymentFile);
    } catch {
      // unreadable file: fall through to env overrides
    }
  }
  return out;
}

function addr(envName: string, fallback?: string): Address | null {
  const value = process.env[envName]?.trim() || fallback;
  if (!value || !isAddress(value)) return null;
  return value;
}

const TESTNET_EXPLORERS: Explorers = {
  creditcoinTx: (hash) => `https://creditcoin-testnet.blockscout.com/tx/${hash}`,
  creditcoinAddress: (address) => `https://creditcoin-testnet.blockscout.com/address/${address}`,
  sepoliaTx: (hash) => `https://sepolia.etherscan.io/tx/${hash}`,
  sepoliaAddress: (address) => `https://sepolia.etherscan.io/address/${address}`,
};

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const deployment: Deployment = process.env.DEPLOYMENT?.trim() === "local" ? "local" : "testnet";
  const file = readDeployment(deployment);
  const isLocal = deployment === "local";

  cached = {
    deployment,
    chainId: Number(process.env.CREDITCOIN_CHAIN_ID ?? file.chainId ?? 102031),
    sourceChainKey: Number(process.env.SOURCE_CHAIN_KEY ?? file.sourceChainKey ?? 1),
    creditcoinRpcUrl:
      process.env.CREDITCOIN_RPC_URL?.trim() ||
      (isLocal ? "http://127.0.0.1:48545" : "https://rpc.cc3-testnet.creditcoin.network"),
    sepoliaRpcUrl: isLocal
      ? null
      : process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com",
    agentStatusUrl: process.env.AGENT_STATUS_URL?.trim() || "http://127.0.0.1:47391/status",
    contracts: {
      creditPassport: addr("CREDIT_PASSPORT_ADDRESS", file.creditPassport),
      paymentRail: addr("PAYMENT_RAIL_ADDRESS", file.paymentRail),
      settlementToken: addr("SETTLEMENT_TOKEN_ADDRESS", file.settlementToken),
      creditToken: addr("CREDIT_TOKEN_ADDRESS", file.creditToken),
      agent: addr("AGENT_ADDRESS", file.agent),
    },
    explorers: isLocal ? null : TESTNET_EXPLORERS,
  };
  return cached;
}

/** Explorer links serialisable to the client: bases only, no functions. */
export function explorerBases(cfg: AppConfig) {
  if (!cfg.explorers) return null;
  return {
    creditcoinTx: cfg.explorers.creditcoinTx(""),
    creditcoinAddress: cfg.explorers.creditcoinAddress(""),
    sepoliaTx: cfg.explorers.sepoliaTx(""),
    sepoliaAddress: cfg.explorers.sepoliaAddress(""),
  };
}
