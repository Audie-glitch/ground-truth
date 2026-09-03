import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Contract, JsonRpcProvider, Wallet, type InterfaceAbi } from "ethers";
import { PROJECT_ROOT, type AgentConfig } from "./config.js";

function loadAbi(name: string): InterfaceAbi {
  return JSON.parse(readFileSync(join(PROJECT_ROOT, "abi", `${name}.json`), "utf8")) as InterfaceAbi;
}

export const ABI = {
  CreditPassport: loadAbi("CreditPassport"),
  PaymentRail: loadAbi("PaymentRail"),
  TestUSD: loadAbi("TestUSD"),
};

export interface Chains {
  sepolia: JsonRpcProvider;
  creditcoin: JsonRpcProvider;
  /** Provider for ChainInfo / verifier precompile reads; same as `creditcoin` unless ATTESTATION_RPC_URL is set. */
  attestation: JsonRpcProvider;
  agent: Wallet | undefined;
  passport: Contract;
  rail: Contract;
  railToken: Contract;
  settlementToken: Contract;
}

export function connect(cfg: AgentConfig): Chains {
  const sepolia = new JsonRpcProvider(cfg.sepoliaRpcUrl, undefined, { staticNetwork: true, polling: true });
  const creditcoin = new JsonRpcProvider(cfg.creditcoinRpcUrl, undefined, { staticNetwork: true, polling: true });
  const attestation =
    cfg.attestationRpcUrl === cfg.creditcoinRpcUrl
      ? creditcoin
      : new JsonRpcProvider(cfg.attestationRpcUrl, undefined, { staticNetwork: true, polling: true });
  const agent = cfg.agentPrivateKey ? new Wallet(cfg.agentPrivateKey, creditcoin) : undefined;

  return {
    sepolia,
    creditcoin,
    attestation,
    agent,
    passport: new Contract(cfg.creditPassport, ABI.CreditPassport, agent ?? creditcoin),
    rail: new Contract(cfg.paymentRail, ABI.PaymentRail, sepolia),
    railToken: new Contract(cfg.railToken, ABI.TestUSD, sepolia),
    settlementToken: new Contract(cfg.settlementToken, ABI.TestUSD, sepolia),
  };
}

/** Typed access to a contract method; ethers' dynamic properties are otherwise `possibly undefined`. */
export function fn(contract: Contract, name: string) {
  return contract.getFunction(name);
}

export const EXPLORERS = {
  sepoliaTx: (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`,
  creditcoinTx: (hash: string) => `https://creditcoin-testnet.blockscout.com/tx/${hash}`,
  creditcoinAddress: (addr: string) => `https://creditcoin-testnet.blockscout.com/address/${addr}`,
};

/** Turns an ethers call exception into the contract's custom error name when possible. */
export function describeRevert(contract: Contract, err: unknown): string {
  const e = err as { data?: string; info?: { error?: { data?: string } }; shortMessage?: string; message?: string };
  const data = e.data ?? e.info?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      const parsed = contract.interface.parseError(data);
      if (parsed) return `${parsed.name}(${parsed.args.map((a) => String(a)).join(", ")})`;
    } catch {
      // not one of ours
    }
  }
  return e.shortMessage ?? e.message ?? String(err);
}
