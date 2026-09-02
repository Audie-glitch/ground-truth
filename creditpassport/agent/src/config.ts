import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { isAddress, isHexString } from "ethers";

const here = dirname(fileURLToPath(import.meta.url));
export const AGENT_ROOT = resolve(here, "..");
export const PROJECT_ROOT = resolve(AGENT_ROOT, "..");

loadDotenv({ path: join(AGENT_ROOT, ".env"), quiet: true });

export interface AgentConfig {
  sepoliaRpcUrl: string;
  creditcoinRpcUrl: string;
  proofBuilderUrl: string;
  sourceChainKey: number;
  agentPrivateKey: string | undefined;
  payerPrivateKey: string | undefined;
  creditPassport: string;
  paymentRail: string;
  settlementToken: string;
  creditToken: string | undefined;
  pollIntervalMs: number;
  scanStartBlock: number | undefined;
  stateDir: string;
  statusPort: number;
  llm: { provider: "openai" | "anthropic" | "none"; apiKey: string | undefined; model: string };
}

interface Deployments {
  paymentRail?: string;
  settlementToken?: string;
  creditPassport?: string;
  creditToken?: string;
}

function readDeployments(): Deployments {
  const dir = join(PROJECT_ROOT, "contracts", "deployments");
  const out: Deployments = {};
  for (const file of ["source.json", "creditcoin.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    try {
      Object.assign(out, JSON.parse(readFileSync(path, "utf8")));
    } catch (err) {
      console.warn(`Ignoring unreadable ${path}: ${(err as Error).message}`);
    }
  }
  return out;
}

function optionalAddress(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim() || fallback;
  if (!value) return undefined;
  if (!isAddress(value)) throw new Error(`${name} is not a valid address: ${value}`);
  return value;
}

function optionalKey(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!isHexString(value, 32)) throw new Error(`${name} must be a 0x-prefixed 32-byte hex private key`);
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

export function loadConfig(): AgentConfig {
  const deployments = readDeployments();
  const openai = process.env.OPENAI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const provider = openai ? "openai" : anthropic ? "anthropic" : "none";
  const defaultModel = provider === "openai" ? "gpt-4o-mini" : "claude-3-5-haiku-latest";

  return {
    sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com",
    creditcoinRpcUrl: process.env.CREDITCOIN_RPC_URL?.trim() || "https://rpc.cc3-testnet.creditcoin.network",
    proofBuilderUrl: process.env.PROOF_BUILDER_URL?.trim() || "https://prover.cc3-testnet.creditcoin.network",
    sourceChainKey: intEnv("SOURCE_CHAIN_KEY", 1),
    agentPrivateKey: optionalKey("AGENT_PRIVATE_KEY") ?? optionalKey("TESTNET_DEPLOYER_PRIVATE_KEY"),
    payerPrivateKey: optionalKey("PAYER_PRIVATE_KEY"),
    creditPassport: optionalAddress("CREDIT_PASSPORT_ADDRESS", deployments.creditPassport) ?? "",
    paymentRail: optionalAddress("PAYMENT_RAIL_ADDRESS", deployments.paymentRail) ?? "",
    settlementToken: optionalAddress("SETTLEMENT_TOKEN_ADDRESS", deployments.settlementToken) ?? "",
    creditToken: optionalAddress("CREDIT_TOKEN_ADDRESS", deployments.creditToken),
    pollIntervalMs: intEnv("POLL_INTERVAL_MS", 15_000),
    scanStartBlock: process.env.SCAN_START_BLOCK?.trim() ? intEnv("SCAN_START_BLOCK", 0) : undefined,
    stateDir: resolve(AGENT_ROOT, process.env.STATE_DIR?.trim() || "./state"),
    statusPort: intEnv("STATUS_PORT", 47_391),
    llm: {
      provider,
      apiKey: openai ?? anthropic,
      model: process.env.LLM_MODEL?.trim() || defaultModel,
    },
  };
}

export function requireDeployed(cfg: AgentConfig): void {
  const missing = (["creditPassport", "paymentRail", "settlementToken"] as const).filter((k) => !cfg[k]);
  if (missing.length) {
    throw new Error(
      `Missing contract addresses: ${missing.join(", ")}. Run the deploy scripts in ../contracts or set the *_ADDRESS env vars.`,
    );
  }
}

export function requireAgentKey(cfg: AgentConfig): string {
  if (!cfg.agentPrivateKey) {
    throw new Error("AGENT_PRIVATE_KEY (or TESTNET_DEPLOYER_PRIVATE_KEY) is required for this command.");
  }
  return cfg.agentPrivateKey;
}
