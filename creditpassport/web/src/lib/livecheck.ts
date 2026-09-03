import "server-only";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blockProver, chainInfo, proofProvider } from "@gluwa/usc-sdk";
import { AbiCoder, ContractFactory, Interface, JsonRpcProvider, type InterfaceAbi } from "ethers";
import creditPassportAbi from "./abi/CreditPassport.json";
import { getConfig } from "./config";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ACTION_INVOICE_PAID = 0;
const ACTION_TOKEN_TRANSFER = 1;

export interface LiveCheckStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface LiveCheckResult {
  txHash: string;
  sepoliaBlock: number;
  attestedHeight: number;
  attested: boolean;
  steps: LiveCheckStep[];
  proof: { header: number; txIndex: number; siblings: number; continuityRoots: number; txBytes: number } | null;
  source: { token: string; payer: string } | null;
  outcome:
    | { kind: "recorded"; payer: string; payee: string; amount: string; paymentCount: number; queryId: string }
    | { kind: "rejected"; reason: string }
    | { kind: "pending" }
    | null;
  ranAgainst: string;
}

let providers: { sepolia: JsonRpcProvider; creditcoin: JsonRpcProvider } | null = null;
function getProviders() {
  const cfg = getConfig();
  // The live check always targets the real Creditcoin testnet, even when the ledger runs on a local anvil.
  const attestationRpc = process.env.ATTESTATION_RPC_URL?.trim() || (cfg.deployment === "local" ? "https://rpc.cc3-testnet.creditcoin.network" : cfg.creditcoinRpcUrl);
  const sepoliaRpc = cfg.sepoliaRpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com";
  if (!providers) {
    providers = {
      sepolia: new JsonRpcProvider(sepoliaRpc, undefined, { staticNetwork: true }),
      creditcoin: new JsonRpcProvider(attestationRpc, undefined, { staticNetwork: true }),
    };
  }
  return { ...providers, attestationRpc };
}

function pickTransfer(logs: readonly { address: string; topics: readonly string[]; data: string }[]) {
  return logs.find(
    (l) => l.topics[0] === TRANSFER_TOPIC && l.topics.length === 3 && l.data.length === 66 && BigInt(l.topics[1] ?? "0x0") !== 0n,
  );
}

/** A recent, attested Sepolia transaction carrying an ERC-20 Transfer, for the "try one" button. */
export async function findRecentTransfer(): Promise<string> {
  const { sepolia, creditcoin } = getProviders();
  const cfg = getConfig();
  const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
  const latest = await info.getLatestAttestedHeightAndHash(cfg.sourceChainKey);
  for (let h = latest.height - 2; h > latest.height - 40; h--) {
    const block = await sepolia.getBlock(h, true);
    for (const tx of block?.prefetchedTransactions ?? []) {
      const rc = await sepolia.getTransactionReceipt(tx.hash);
      if (rc?.status === 1 && rc.logs.length > 0 && rc.logs.length <= 4 && pickTransfer(rc.logs)) return tx.hash;
    }
  }
  throw new Error("no attested ERC-20 transfer found in the last 40 blocks; try again in a minute");
}

export async function runLiveCheck(txHash: string): Promise<LiveCheckResult> {
  const cfg = getConfig();
  const { sepolia, creditcoin, attestationRpc } = getProviders();
  const steps: LiveCheckStep[] = [];

  const receipt = await sepolia.getTransactionReceipt(txHash);
  if (!receipt) throw new Error("transaction not found on Sepolia");
  steps.push({ name: "Source transaction", ok: receipt.status === 1, detail: `Sepolia block ${receipt.blockNumber}, ${receipt.logs.length} log(s), status ${receipt.status}` });

  const info = new chainInfo.PrecompileChainInfoProvider(creditcoin);
  const latest = await info.getLatestAttestedHeightAndHash(cfg.sourceChainKey);
  const attested = latest.exists && receipt.blockNumber <= latest.height;
  steps.push({
    name: "Attestation",
    ok: attested,
    detail: attested
      ? `Creditcoin has attested Sepolia up to block ${latest.height}; this block is covered`
      : `Creditcoin has attested up to block ${latest.height}; this block is ${receipt.blockNumber - latest.height} block(s) ahead. Retry in a few minutes.`,
  });

  const transfer = pickTransfer(receipt.logs);
  const source = transfer ? { token: transfer.address, payer: `0x${(transfer.topics[1] ?? "").slice(26)}` } : null;
  steps.push({
    name: "Payment log",
    ok: Boolean(transfer),
    detail: transfer
      ? `ERC-20 Transfer from ${source!.payer} on token ${transfer.address}; the check registers that token as the passport's settlement token`
      : "No ERC-20 Transfer log; the proof will still be verified, and the passport is expected to reject the receipt for lacking a registered payment log",
  });

  const base: Omit<LiveCheckResult, "proof" | "outcome"> = {
    txHash,
    sepoliaBlock: receipt.blockNumber,
    attestedHeight: latest.height,
    attested,
    steps,
    source,
    ranAgainst: new URL(attestationRpc).host,
  };
  if (!attested) return { ...base, proof: null, outcome: { kind: "pending" } };

  const builder = new proofProvider.service.ProofBuilder(cfg.sourceChainKey, process.env.PROOF_BUILDER_URL?.trim() || "https://prover.cc3-testnet.creditcoin.network", 20_000);
  const result = await builder.getProof(txHash);
  if (!result.success || !result.data) {
    steps.push({ name: "Proof", ok: false, detail: `prover error: ${result.error ?? "unknown"}` });
    return { ...base, proof: null, outcome: null };
  }
  const p = result.data;
  const proofSummary = { header: p.headerNumber, txIndex: p.txIndex, siblings: p.merkleProof.siblings.length, continuityRoots: p.continuityProof.roots.length, txBytes: (p.txBytes.length - 2) / 2 };
  steps.push({ name: "Proof", ok: true, detail: `Merkle inclusion (${proofSummary.siblings} siblings) and continuity (${proofSummary.continuityRoots} roots) fetched from the hosted prover for header ${p.headerNumber}, index ${p.txIndex}` });

  const prover = new blockProver.PrecompileBlockProver(creditcoin);
  const valid = await prover.verifySingle(p.chainKey, p.headerNumber, p.txBytes, p.merkleProof, p.continuityProof);
  steps.push({ name: "Verifier precompile (0xFD2)", ok: valid, detail: valid ? "verifySingle returned true via eth_call" : "verifySingle returned false" });

  // Deploy + register + execute inside one constructor, executed by eth_call. Nothing persists.
  const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "..", "abi", "LivePrecompileCheck.json"), "utf8")) as { abi: InterfaceAbi; bytecode: string };
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const sourceContract = source?.token ?? receipt.to ?? "0x0000000000000000000000000000000000000001";
  const payer = source?.payer ?? receipt.from;
  const deployTx = await factory.getDeployTransaction(
    {
      action: source ? ACTION_TOKEN_TRANSFER : ACTION_INVOICE_PAID,
      chainKey: p.chainKey,
      blockHeight: p.headerNumber,
      encodedTransaction: p.txBytes,
      merkleRoot: p.merkleProof.root,
      siblings: p.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
      lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
      continuityRoots: p.continuityProof.roots,
    },
    sourceContract,
    payer,
  );
  const returned = await creditcoin.call({ data: deployTx.data, gasLimit: 30_000_000 });
  if (!returned || returned === "0x") throw new Error("the RPC returned no data for the creation call");
  const outcomeType = "tuple(bool recorded, bytes reason, address payer, address payee, uint256 amount, uint256 paymentCount, bytes32 queryId)";
  const [o] = AbiCoder.defaultAbiCoder().decode([outcomeType], returned) as unknown as [
    { recorded: boolean; reason: string; payer: string; payee: string; amount: bigint; paymentCount: bigint; queryId: string },
  ];

  if (o.recorded) {
    steps.push({ name: "CreditPassport.execute", ok: true, detail: `recorded ${o.paymentCount.toString()} payment(s) on a passport that existed only for this call` });
    return {
      ...base,
      proof: proofSummary,
      outcome: { kind: "recorded", payer: o.payer, payee: o.payee, amount: o.amount.toString(), paymentCount: Number(o.paymentCount), queryId: o.queryId },
    };
  }
  let reason = o.reason;
  try {
    const parsed = new Interface(creditPassportAbi as unknown as InterfaceAbi).parseError(o.reason);
    if (parsed) reason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
  } catch {
    // raw
  }
  steps.push({ name: "CreditPassport.execute", ok: false, detail: `rejected: ${reason}` });
  return { ...base, proof: proofSummary, outcome: { kind: "rejected", reason } };
}
