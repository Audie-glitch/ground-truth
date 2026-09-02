import { Contract, MaxUint256, Wallet, formatUnits, keccak256, parseUnits, toUtf8Bytes, toUtf8String } from "ethers";
import { Agent, parseProfile } from "./agent.js";
import { ABI, EXPLORERS, connect, describeRevert, fn } from "./chain.js";
import { loadConfig, requireAgentKey, requireDeployed } from "./config.js";
import { memoFromDataUri } from "./memo.js";
import { ACTION, executeArgs, padGas, queryIdFor, ProofService, type ActionName } from "./proofs.js";
import { startStatusServer } from "./server.js";
import { StateStore } from "./state.js";

const USAGE = `CreditPassport agent

  run                                   Start the agent loop and the status server
  status                                Print chain, attestation, and queue status once
  chains                                List source chains Creditcoin attests, with latest heights
  pay --payee <addr> --amount <units> [--due-in <blocks>] [--late] [--invoice <id>]
                                        Demo payer flow on Sepolia: mint tUSD if needed, approve, pay an invoice
  prove <sepoliaTxHash> [--action InvoicePaid|TokenTransfer]
                                        Wait for attestation, fetch the proof, submit it to CreditPassport
  underwrite <payer>                    Score and underwrite a payer now
  profile <payer>                       Show a payer's verified history, score, limit, and memo
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const cfg = loadConfig();

  switch (command) {
    case "run": {
      requireDeployed(cfg);
      requireAgentKey(cfg);
      const store = new StateStore(cfg.stateDir);
      const chains = connect(cfg);
      const proofs = new ProofService(cfg, chains.creditcoin);
      const agent = new Agent(cfg, store, chains, proofs);
      startStatusServer(cfg, store, chains, proofs);
      store.log("info", `agent ${chains.agent?.address} watching rail ${cfg.paymentRail}, passport ${cfg.creditPassport}`);
      let running = true;
      const stop = () => {
        running = false;
        store.log("info", "shutting down");
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      while (running) {
        await agent.tick();
        await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
      }
      store.save();
      process.exit(0);
    }

    case "status": {
      requireDeployed(cfg);
      const chains = connect(cfg);
      const proofs = new ProofService(cfg, chains.creditcoin);
      const store = new StateStore(cfg.stateDir);
      const [sepolia, creditcoin, attested] = await Promise.all([
        chains.sepolia.getBlockNumber(),
        chains.creditcoin.getBlockNumber(),
        proofs.latestAttestedHeight(),
      ]);
      console.log(`Sepolia latest      ${sepolia}`);
      console.log(`Attested on CC3     ${attested} (lag ${sepolia - attested} blocks)`);
      console.log(`Creditcoin latest   ${creditcoin}`);
      console.log(`Last scanned        ${store.state.lastScannedBlock ?? "-"}`);
      for (const status of ["seen", "attested", "submitted", "failed"] as const) {
        console.log(`${status.padEnd(20)}${store.pendingByStatus(status).length}`);
      }
      return;
    }

    case "chains": {
      const chains = connect({ ...cfg, creditPassport: cfg.creditPassport || "0x0000000000000000000000000000000000000001", paymentRail: cfg.paymentRail || "0x0000000000000000000000000000000000000001", settlementToken: cfg.settlementToken || "0x0000000000000000000000000000000000000001" });
      const proofs = new ProofService(cfg, chains.creditcoin);
      for (const c of await proofs.supportedChains()) {
        const latest = await proofs.info.getLatestAttestedHeightAndHash(c.chainKey);
        const name = c.chainName.startsWith("0x") ? toUtf8String(c.chainName).replace(/\0+$/, "") : c.chainName;
        console.log(`chainKey ${c.chainKey}  ${name} (chainId ${c.chainId})  attested height ${latest.exists ? latest.height : "-"}`);
      }
      return;
    }

    case "pay": {
      requireDeployed(cfg);
      const key = cfg.payerPrivateKey ?? requireAgentKey(cfg);
      const payee = flag(args, "payee");
      const amountArg = flag(args, "amount");
      if (!payee || !amountArg) throw new Error("pay requires --payee and --amount");
      const chains = connect(cfg);
      const payer = new Wallet(key, chains.sepolia);
      const token = new Contract(cfg.settlementToken, ABI.TestUSD, payer);
      const rail = new Contract(cfg.paymentRail, ABI.PaymentRail, payer);
      const amount = parseUnits(amountArg, 6);

      const balance: bigint = await fn(token, "balanceOf")(payer.address);
      if (balance < amount) {
        const mintAmount = amount > parseUnits("1000", 6) ? amount : parseUnits("1000", 6);
        const tx = await fn(token, "mint")(payer.address, mintAmount);
        await tx.wait();
        console.log(`minted ${formatUnits(mintAmount, 6)} tUSD to ${payer.address} (${tx.hash})`);
      }
      const allowance: bigint = await fn(token, "allowance")(payer.address, cfg.paymentRail);
      if (allowance < amount) {
        const tx = await fn(token, "approve")(cfg.paymentRail, MaxUint256);
        await tx.wait();
        console.log(`approved rail (${tx.hash})`);
      }

      const latest = await chains.sepolia.getBlockNumber();
      const dueIn = Number(flag(args, "due-in") ?? 100);
      const dueBlock = has(args, "late") ? Math.max(1, latest - 1) : latest + dueIn;
      const invoiceId = flag(args, "invoice") ?? keccak256(toUtf8Bytes(`INV-${Date.now()}`));

      const tx = await fn(rail, "payInvoice")(invoiceId, payee, amount, dueBlock);
      console.log(`payInvoice sent ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`paid ${formatUnits(amount, 6)} tUSD to ${payee} in block ${receipt.blockNumber}, due block ${dueBlock} (${has(args, "late") ? "late" : "on time"})`);
      console.log(EXPLORERS.sepoliaTx(tx.hash));
      console.log(`prove it with: npm run cli -- prove ${tx.hash}`);
      return;
    }

    case "prove": {
      requireDeployed(cfg);
      requireAgentKey(cfg);
      const txHash = args[0];
      if (!txHash) throw new Error("prove requires a Sepolia transaction hash");
      const actionName = (flag(args, "action") ?? "InvoicePaid") as ActionName;
      if (!(actionName in ACTION)) throw new Error(`unknown action ${actionName}`);
      const chains = connect(cfg);
      const proofs = new ProofService(cfg, chains.creditcoin);

      const receipt = await chains.sepolia.getTransactionReceipt(txHash);
      if (!receipt) throw new Error("transaction not found on the source chain");
      const attested = await proofs.latestAttestedHeight();
      console.log(`tx in block ${receipt.blockNumber}; latest attested ${attested}`);
      if (attested < receipt.blockNumber) {
        console.log("waiting for Creditcoin to attest the block (typically a few minutes)...");
        await proofs.waitUntilAttested(receipt.blockNumber);
      }
      const proof = await proofs.getProof(txHash);
      const queryId = queryIdFor(proof.chainKey, proof.headerNumber, proof.txIndex);
      console.log(`proof ready: header ${proof.headerNumber}, txIndex ${proof.txIndex}, ${proof.continuityProof.roots.length} continuity roots, queryId ${queryId}`);
      if (await fn(chains.passport, "processedQueries")(queryId)) {
        console.log("already processed on Creditcoin");
        return;
      }
      console.log(`off-chain verification: ${(await proofs.preverify(proof)) ? "ok" : "FAILED"}`);
      const callArgs = executeArgs(ACTION[actionName], proof);
      try {
        await fn(chains.passport, "execute").staticCall(...callArgs);
      } catch (err) {
        throw new Error(`execute would revert: ${describeRevert(chains.passport, err)}`);
      }
      const gas = padGas(await fn(chains.passport, "execute").estimateGas(...callArgs));
      const tx = await fn(chains.passport, "execute")(...callArgs, { gasLimit: gas });
      console.log(`execute sent ${tx.hash}`);
      const rc = await tx.wait();
      console.log(`confirmed in Creditcoin block ${rc.blockNumber}: ${EXPLORERS.creditcoinTx(tx.hash)}`);
      return;
    }

    case "underwrite": {
      requireDeployed(cfg);
      requireAgentKey(cfg);
      const payer = args[0];
      if (!payer) throw new Error("underwrite requires a payer address");
      const store = new StateStore(cfg.stateDir);
      const chains = connect(cfg);
      const proofs = new ProofService(cfg, chains.creditcoin);
      await new Agent(cfg, store, chains, proofs).underwrite(payer);
      store.save();
      return;
    }

    case "profile": {
      requireDeployed(cfg);
      const payer = args[0];
      if (!payer) throw new Error("profile requires a payer address");
      const chains = connect(cfg);
      const profile = parseProfile(await fn(chains.passport, "getProfile")(payer));
      const payments = (await fn(chains.passport, "getPayments")(payer)) as Array<Record<string, unknown>>;
      const policyMax: bigint = await fn(chains.passport, "maxCreditLimit")(payer);
      console.log(`payer            ${payer}`);
      console.log(`verified payments ${payments.length} (${profile.onTimeCount} on time, ${profile.lateCount} late, ${profile.transferCount} undated)`);
      console.log(`dated volume     ${formatUnits(profile.datedVolume, 6)}  undated ${formatUnits(profile.undatedVolume, 6)}`);
      console.log(`score            ${profile.score}/1000`);
      console.log(`credit limit     ${formatUnits(profile.creditLimit, 6)} (policy max ${formatUnits(policyMax, 6)}), drawn ${formatUnits(profile.drawn, 6)}`);
      const memo = memoFromDataUri(profile.memoURI);
      if (memo) console.log(`memo             ${memo.narrative}\n                 (${memo.narrativeSource}, ${memo.generatedAt})`);
      for (const p of payments) {
        console.log(
          `  ${String(p.invoiceId).slice(0, 10)}… ${formatUnits(BigInt(p.amount as bigint), 6).padStart(12)}  paid ${p.paidBlock}  due ${p.dueBlock}  ${Number(p.dueBlock) === 0 ? "undated" : Number(p.paidBlock) <= Number(p.dueBlock) ? "on time" : "late"}`,
        );
      }
      return;
    }

    default:
      console.log(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
