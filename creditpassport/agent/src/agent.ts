import { EventLog } from "ethers";
import { describeRevert, fn, type Chains } from "./chain.js";
import type { AgentConfig } from "./config.js";
import { buildMemo, memoToDataUri } from "./memo.js";
import { ACTION, executeArgs, executeBatchArgs, padGas, queryIdFor, ProofService } from "./proofs.js";
import { requestedLimit, scoreProfile, type VerifiedProfile } from "./scoring.js";
import type { PendingPayment, StateStore } from "./state.js";

const SCAN_CHUNK = 2_000;
const DEFAULT_LOOKBACK = 5_000;
const MAX_BATCH = 10;
const BATCH_RANGE = 1_000;
const HARD_FAIL_ATTEMPTS = 25;

export interface OnChainProfile extends VerifiedProfile {
  score: number;
  creditLimit: bigint;
  drawn: bigint;
  underwrittenAt: number;
  memoURI: string;
}

export function parseProfile(raw: Record<string, unknown> | unknown[]): OnChainProfile {
  const r = raw as Record<string, unknown>;
  const v = <T>(key: string, idx: number): T => (Array.isArray(raw) ? (raw[idx] as T) : (r[key] as T));
  return {
    datedVolume: BigInt(v<bigint>("datedVolume", 0)),
    undatedVolume: BigInt(v<bigint>("undatedVolume", 1)),
    onTimeCount: Number(v<bigint>("onTimeCount", 2)),
    lateCount: Number(v<bigint>("lateCount", 3)),
    transferCount: Number(v<bigint>("transferCount", 4)),
    firstPaidBlock: Number(v<bigint>("firstPaidBlock", 5)),
    lastPaidBlock: Number(v<bigint>("lastPaidBlock", 6)),
    score: Number(v<bigint>("score", 7)),
    creditLimit: BigInt(v<bigint>("creditLimit", 8)),
    drawn: BigInt(v<bigint>("drawn", 9)),
    underwrittenAt: Number(v<bigint>("underwrittenAt", 10)),
    memoURI: String(v<string>("memoURI", 11)),
  };
}

export class Agent {
  constructor(
    private readonly cfg: AgentConfig,
    private readonly store: StateStore,
    private readonly chains: Chains,
    private readonly proofs: ProofService,
  ) {}

  async tick(): Promise<void> {
    await this.step("scan", () => this.scan());
    await this.step("attestations", () => this.checkAttestations());
    await this.step("submit", () => this.submitReady());
    await this.step("underwrite", () => this.underwriteDirty());
  }

  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.store.log("error", `${name}: ${(err as Error).message}`);
    } finally {
      this.store.save();
    }
  }

  // ------------------------------------------------------------------ 1. scan the source chain

  async scan(): Promise<void> {
    const latest = await this.chains.sepolia.getBlockNumber();
    const s = this.store.state;
    let from = s.lastScannedBlock !== null ? s.lastScannedBlock + 1 : this.cfg.scanStartBlock ?? Math.max(0, latest - DEFAULT_LOOKBACK);
    if (from > latest) return;

    while (from <= latest) {
      const to = Math.min(latest, from + SCAN_CHUNK - 1);
      const logs = await this.chains.rail.queryFilter(this.chains.rail.getEvent("InvoicePaid"), from, to);
      for (const log of logs) {
        if (!(log instanceof EventLog)) continue;
        if (s.pending[log.transactionHash]) continue;
        const [invoiceId, payer, payee, amount, dueBlock] = log.args as unknown as [string, string, string, bigint, bigint, bigint];
        s.pending[log.transactionHash] = {
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          payer,
          payee,
          invoiceId,
          amount: amount.toString(),
          dueBlock: Number(dueBlock),
          status: "seen",
          seenAt: new Date().toISOString(),
          attempts: 0,
        };
        this.store.log("info", `new InvoicePaid ${log.transactionHash} block ${log.blockNumber} payer ${payer}`);
      }
      s.lastScannedBlock = to;
      from = to + 1;
    }
  }

  // ------------------------------------------------------------------ 2. wait for Creditcoin to attest

  async checkAttestations(): Promise<void> {
    const seen = this.store.pendingByStatus("seen");
    if (seen.length === 0) return;
    const attested = await this.proofs.latestAttestedHeight();
    for (const p of seen) {
      if (p.blockNumber <= attested) {
        p.status = "attested";
        this.store.log("info", `block ${p.blockNumber} attested (latest ${attested}); ${p.txHash} ready to prove`);
      }
    }
  }

  // ------------------------------------------------------------------ 3. prove and submit

  async submitReady(): Promise<void> {
    if (!this.chains.agent) throw new Error("agent key not configured; cannot submit proofs");
    const ready = this.store.pendingByStatus("attested").sort((a, b) => a.blockNumber - b.blockNumber);
    if (ready.length === 0) return;

    const byPayer = new Map<string, PendingPayment[]>();
    for (const p of ready) byPayer.set(p.payer, [...(byPayer.get(p.payer) ?? []), p]);

    for (const group of byPayer.values()) {
      const batch = group.filter((p) => p.blockNumber - group[0]!.blockNumber <= BATCH_RANGE).slice(0, MAX_BATCH);
      if (batch.length >= 2) {
        const ok = await this.submitBatch(batch);
        if (ok) continue;
      }
      for (const p of batch) await this.submitSingle(p);
    }
  }

  private async submitBatch(batch: PendingPayment[]): Promise<boolean> {
    const hashes = batch.map((p) => p.txHash);
    try {
      const proof = await this.proofs.getBatchProof(hashes);
      const { args, entries } = executeBatchArgs(ACTION.InvoicePaid, proof);
      if (entries.length === 0) throw new Error("prover returned an empty batch");

      const fresh: string[] = [];
      for (const e of entries) {
        if (!(await fn(this.chains.passport, "processedQueries")(e.queryId))) fresh.push(e.txHash);
      }
      if (fresh.length === 0) {
        for (const p of batch) this.markSubmitted(p, "already-processed", entries.length);
        return true;
      }

      await fn(this.chains.passport, "executeBatch").staticCall(...args);
      const gas = padGas(await fn(this.chains.passport, "executeBatch").estimateGas(...args));
      const tx = await fn(this.chains.passport, "executeBatch")(...args, { gasLimit: gas });
      this.store.log("info", `executeBatch(${entries.length}) sent ${tx.hash}`);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`executeBatch reverted in ${tx.hash}`);
      for (const p of batch) this.markSubmitted(p, tx.hash, entries.length);
      this.store.log("info", `executeBatch confirmed ${tx.hash} (${entries.length} payments)`);
      return true;
    } catch (err) {
      this.store.log("warn", `batch of ${batch.length} fell back to single proofs: ${describeRevert(this.chains.passport, err)}`);
      return false;
    }
  }

  private async submitSingle(p: PendingPayment): Promise<void> {
    try {
      const proof = await this.proofs.getProof(p.txHash);
      const queryId = queryIdFor(proof.chainKey, proof.headerNumber, proof.txIndex);
      if (await fn(this.chains.passport, "processedQueries")(queryId)) {
        this.markSubmitted(p, "already-processed", 1);
        return;
      }
      if (!(await this.proofs.preverify(proof))) throw new Error("verifier precompile rejected the proof off-chain");

      const args = executeArgs(ACTION.InvoicePaid, proof);
      await fn(this.chains.passport, "execute").staticCall(...args);
      const gas = padGas(await fn(this.chains.passport, "execute").estimateGas(...args));
      const tx = await fn(this.chains.passport, "execute")(...args, { gasLimit: gas });
      this.store.log("info", `execute sent ${tx.hash} for ${p.txHash}`);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`execute reverted in ${tx.hash}`);
      this.markSubmitted(p, tx.hash, 1);
      this.store.log("info", `payment ${p.txHash} verified on Creditcoin in ${tx.hash}`);
    } catch (err) {
      p.attempts += 1;
      p.lastError = describeRevert(this.chains.passport, err);
      if (p.attempts >= HARD_FAIL_ATTEMPTS) {
        p.status = "failed";
        this.store.log("error", `giving up on ${p.txHash} after ${p.attempts} attempts: ${p.lastError}`);
      } else {
        this.store.log("warn", `attempt ${p.attempts} for ${p.txHash}: ${p.lastError}`);
      }
    }
  }

  private markSubmitted(p: PendingPayment, creditcoinTxHash: string, batchSize: number): void {
    p.status = "submitted";
    p.submission = { creditcoinTxHash, batchSize, at: new Date().toISOString() };
    delete p.lastError;
  }

  // ------------------------------------------------------------------ 3b. import a payer's real settlement-token transfers

  /**
   * Builds history for `payer` from plain `Transfer` logs of the settlement token (USDC on Sepolia by
   * default): finds attested transfers sent by the payer, skips ones already on the passport, proves up to
   * `max` of the newest within the prover's 1000-block batch range, and submits them as undated payments.
   * Returns the number of payments recorded in this call.
   */
  async importTransfers(payer: string, lookbackBlocks = 20_000, max = 10): Promise<number> {
    if (!this.chains.agent) throw new Error("agent key not configured; cannot submit proofs");
    const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const [head, attested] = await Promise.all([this.chains.sepolia.getBlockNumber(), this.proofs.latestAttestedHeight()]);
    const toBlock = Math.min(head, attested);
    const fromBlock = Math.max(0, toBlock - lookbackBlocks);
    const topicPayer = `0x${payer.toLowerCase().replace("0x", "").padStart(64, "0")}`;

    const candidates: Array<{ txHash: string; block: number; index: number }> = [];
    for (let from = fromBlock; from <= toBlock; from += 5_000) {
      const to = Math.min(toBlock, from + 4_999);
      const logs = await this.chains.sepolia.getLogs({
        address: this.cfg.settlementToken,
        topics: [TRANSFER_TOPIC, topicPayer],
        fromBlock: from,
        toBlock: to,
      });
      for (const log of logs) {
        if (!candidates.some((c) => c.txHash === log.transactionHash)) {
          candidates.push({ txHash: log.transactionHash, block: log.blockNumber, index: log.transactionIndex });
        }
      }
    }
    this.store.log("info", `import ${payer}: ${candidates.length} settlement-token transfer(s) in attested blocks ${fromBlock}-${toBlock}`);
    if (candidates.length === 0) return 0;

    candidates.sort((a, b) => b.block - a.block);
    const newest = candidates[0]!;
    const fresh: typeof candidates = [];
    for (const c of candidates) {
      if (newest.block - c.block > 1_000 || fresh.length >= max) break;
      const queryId = queryIdFor(this.proofs.chainKey, c.block, c.index);
      if (!(await fn(this.chains.passport, "processedQueries")(queryId))) fresh.push(c);
    }
    if (fresh.length === 0) {
      this.store.log("info", `import ${payer}: every recent transfer is already on the passport`);
      return 0;
    }

    let recorded = 0;
    if (fresh.length >= 2) {
      try {
        const proof = await this.proofs.getBatchProof(fresh.map((c) => c.txHash));
        const { args, entries } = executeBatchArgs(ACTION.TokenTransfer, proof);
        await fn(this.chains.passport, "executeBatch").staticCall(...args);
        const gas = padGas(await fn(this.chains.passport, "executeBatch").estimateGas(...args));
        const tx = await fn(this.chains.passport, "executeBatch")(...args, { gasLimit: gas });
        const receipt = await tx.wait();
        if (!receipt || receipt.status !== 1) throw new Error(`executeBatch reverted in ${tx.hash}`);
        recorded = entries.length;
        this.store.log("info", `import ${payer}: executeBatch recorded ${entries.length} transfer(s) in ${tx.hash}`);
      } catch (err) {
        this.store.log("warn", `import ${payer}: batch failed, falling back to single proofs: ${describeRevert(this.chains.passport, err)}`);
      }
    }
    if (recorded === 0) {
      for (const c of fresh) {
        try {
          const proof = await this.proofs.getProof(c.txHash);
          const args = executeArgs(ACTION.TokenTransfer, proof);
          await fn(this.chains.passport, "execute").staticCall(...args);
          const gas = padGas(await fn(this.chains.passport, "execute").estimateGas(...args));
          const tx = await fn(this.chains.passport, "execute")(...args, { gasLimit: gas });
          const receipt = await tx.wait();
          if (!receipt || receipt.status !== 1) throw new Error(`execute reverted in ${tx.hash}`);
          recorded += 1;
          this.store.log("info", `import ${payer}: recorded ${c.txHash} in ${tx.hash}`);
        } catch (err) {
          this.store.log("warn", `import ${payer}: ${c.txHash} failed: ${describeRevert(this.chains.passport, err)}`);
        }
      }
    }
    if (recorded > 0) await this.underwrite(payer);
    return recorded;
  }

  // ------------------------------------------------------------------ 4. underwrite anyone whose history changed

  async underwriteDirty(): Promise<void> {
    if (!this.chains.agent) return;
    const payers = new Set(this.store.pendingByStatus("submitted").map((p) => p.payer));
    for (const payer of payers) {
      const count = Number(await fn(this.chains.passport, "paymentCount")(payer));
      const last = this.store.state.underwritings[payer];
      if (last && last.paymentCount === count) continue;
      await this.underwrite(payer);
    }
  }

  async underwrite(payer: string): Promise<void> {
    if (!this.chains.agent) throw new Error("agent key not configured; cannot underwrite");
    const [rawProfile, policyMaxRaw, countRaw, sourceBlock] = await Promise.all([
      fn(this.chains.passport, "getProfile")(payer),
      fn(this.chains.passport, "maxCreditLimit")(payer),
      fn(this.chains.passport, "paymentCount")(payer),
      this.chains.sepolia.getBlockNumber(),
    ]);
    const profile = parseProfile(rawProfile);
    const policyMax = BigInt(policyMaxRaw);
    const paymentCount = Number(countRaw);

    const score = scoreProfile(profile, sourceBlock);
    let creditLimit = requestedLimit(policyMax, score.limitFactor);
    // The contract refuses to set a limit below what is already drawn; hold the line there instead.
    if (creditLimit < profile.drawn) creditLimit = profile.drawn;

    const memo = await buildMemo(this.cfg, { payer, profile, paymentCount, score, policyMax, creditLimit });
    const memoURI = memoToDataUri(memo);

    try {
      await fn(this.chains.passport, "underwrite").staticCall(payer, score.score, creditLimit, memoURI);
      const tx = await fn(this.chains.passport, "underwrite")(payer, score.score, creditLimit, memoURI);
      const receipt = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Error(`underwrite reverted in ${tx.hash}`);
      this.store.state.underwritings[payer] = {
        payer,
        score: score.score,
        creditLimit: creditLimit.toString(),
        policyMax: policyMax.toString(),
        paymentCount,
        memo,
        creditcoinTxHash: tx.hash,
        at: new Date().toISOString(),
      };
      this.store.log("info", `underwrote ${payer}: score ${score.score}, limit ${creditLimit} (policy max ${policyMax}) in ${tx.hash}`);
    } catch (err) {
      throw new Error(`underwrite ${payer}: ${describeRevert(this.chains.passport, err)}`);
    }
  }
}
