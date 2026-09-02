import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { keccak256, solidityPacked, type JsonRpcProvider } from "ethers";
import type { AgentConfig } from "./config.js";

export type SingleProof = proofProvider.ContinuityResponse;
export type BatchProof = proofProvider.BatchContinuityResponse;

export const ACTION = { InvoicePaid: 0, TokenTransfer: 1 } as const;
export type ActionName = keyof typeof ACTION;

/** Same derivation as AttestedBase._computeQueryId (and ASCBase). */
export function queryIdFor(chainKey: number, blockHeight: number, txIndex: number): string {
  return keccak256(solidityPacked(["uint256", "uint64", "uint256"], [chainKey, blockHeight, txIndex]));
}

export interface BatchEntry {
  txHash: string;
  headerNumber: number;
  txIndex: number;
  queryId: string;
}

export class ProofService {
  readonly builder: proofProvider.service.ProofBuilder;
  readonly info: chainInfo.PrecompileChainInfoProvider;
  readonly prover: blockProver.PrecompileBlockProver;
  readonly chainKey: number;

  constructor(cfg: AgentConfig, creditcoin: JsonRpcProvider) {
    this.chainKey = cfg.sourceChainKey;
    this.builder = new proofProvider.service.ProofBuilder(cfg.sourceChainKey, cfg.proofBuilderUrl, 15_000);
    this.info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
    this.prover = new blockProver.PrecompileBlockProver(creditcoin);
  }

  async latestAttestedHeight(): Promise<number> {
    const latest = await this.info.getLatestAttestedHeightAndHash(this.chainKey);
    return latest.exists ? latest.height : 0;
  }

  async supportedChains(): Promise<chainInfo.ChainInfo[]> {
    return this.info.getSupportedChains();
  }

  async waitUntilAttested(height: number, timeoutMs = 25 * 60_000): Promise<void> {
    await this.builder.waitUntilHeightAttested(this.chainKey, height, 15_000, timeoutMs);
  }

  async getProof(txHash: string): Promise<SingleProof> {
    const result = await this.builder.getProof(txHash);
    if (!result.success || !result.data) throw new Error(`proof unavailable for ${txHash}: ${result.error ?? "unknown"}`);
    return result.data;
  }

  async getBatchProof(txHashes: string[]): Promise<BatchProof> {
    const result = await this.builder.getBatchProof(txHashes);
    if (!result.success || !result.data) throw new Error(`batch proof unavailable: ${result.error ?? "unknown"}`);
    return result.data;
  }

  /** Off-chain dry run of the verifier precompile before spending gas. */
  async preverify(proof: SingleProof): Promise<boolean> {
    return this.prover.verifySingle(
      proof.chainKey,
      proof.headerNumber,
      proof.txBytes,
      proof.merkleProof,
      proof.continuityProof,
    );
  }
}

/** Positional arguments for `AttestedBase.execute`. */
export function executeArgs(action: number, p: SingleProof) {
  return [
    action,
    p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
  ] as const;
}

/** Positional arguments for `AttestedBase.executeBatch`, plus the entries in submission order. */
export function executeBatchArgs(action: number, batch: BatchProof) {
  const heights: number[] = [];
  const txBytes: string[] = [];
  const merkleProofs: Array<{ root: string; siblings: Array<{ hash: string; isLeft: boolean }> }> = [];
  const entries: BatchEntry[] = [];

  const headers = [...batch.merkleProofs.keys()].sort((a, b) => a - b);
  for (const header of headers) {
    const byIndex = batch.merkleProofs.get(header);
    if (!byIndex) continue;
    for (const txIndex of [...byIndex.keys()].sort((a, b) => a - b)) {
      const entry = byIndex.get(txIndex);
      if (!entry) continue;
      heights.push(header);
      txBytes.push(entry.txBytes);
      merkleProofs.push({
        root: entry.merkleProof.root,
        siblings: entry.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
      });
      entries.push({ txHash: entry.txHash, headerNumber: header, txIndex, queryId: queryIdFor(batch.chainKey, header, txIndex) });
    }
  }

  return {
    args: [
      action,
      batch.chainKey,
      heights,
      txBytes,
      merkleProofs,
      { lowerEndpointDigest: batch.continuityProof.lowerEndpointDigest, roots: batch.continuityProof.roots },
    ] as const,
    entries,
  };
}

/** Proofs are large; pad the estimate so a slightly heavier continuity chain does not run out of gas. */
export function padGas(estimate: bigint): bigint {
  return (estimate * 130n) / 100n + 50_000n;
}
