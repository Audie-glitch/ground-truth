import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  Interface,
  MaxUint256,
  Wallet,
  formatUnits,
  keccak256,
  parseUnits,
  toUtf8Bytes,
  toUtf8String,
  type InterfaceAbi,
} from "ethers";
import { Agent, parseProfile } from "./agent.js";
import { ABI, EXPLORERS, connect, describeRevert, fn } from "./chain.js";
import { PROJECT_ROOT, loadConfig, requireAgentKey, requireDeployed } from "./config.js";
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
  verify [sepoliaTxHash]                Fetch an Attestcoin proof for any Sepolia transaction (a recent one if
                                        omitted) and dry-run the Creditcoin verifier precompile. No key, no gas.
  livecheck [sepoliaTxHash]             Run CreditPassport.execute against the REAL Creditcoin verifier via
                                        eth_call (deploy + execute inside one constructor). Finds a recent
                                        attested ERC-20 transfer if no hash is given. No key, no gas.
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

    case "verify": {
      const placeholder = "0x0000000000000000000000000000000000000001";
      const chains = connect({
        ...cfg,
        creditPassport: cfg.creditPassport || placeholder,
        paymentRail: cfg.paymentRail || placeholder,
        settlementToken: cfg.settlementToken || placeholder,
      });
      const proofs = new ProofService(cfg, chains.creditcoin);
      const attested = await proofs.latestAttestedHeight();
      let txHash = args[0];

      if (!txHash) {
        // Find a recent successful transaction with logs inside an attested block.
        for (let h = attested - 2; h > attested - 40 && !txHash; h--) {
          const block = await chains.sepolia.getBlock(h, true);
          for (const tx of block?.prefetchedTransactions ?? []) {
            const rc = await chains.sepolia.getTransactionReceipt(tx.hash);
            if (rc?.status === 1 && rc.logs.length > 0 && rc.logs.length < 6) {
              txHash = tx.hash;
              break;
            }
          }
        }
        if (!txHash) throw new Error("no recent transaction with logs found in the last 40 attested blocks");
      }

      const receipt = await chains.sepolia.getTransactionReceipt(txHash);
      if (!receipt) throw new Error("transaction not found on the source chain");
      console.log(`tx        ${txHash}`);
      console.log(`block     ${receipt.blockNumber} (latest attested ${attested}, ${receipt.blockNumber <= attested ? "attested" : "NOT yet attested"})`);
      console.log(`logs      ${receipt.logs.length}, status ${receipt.status}`);
      if (receipt.blockNumber > attested) {
        console.log("block not attested yet; wait a few minutes and retry");
        return;
      }
      const t0 = Date.now();
      const proof = await proofs.getProof(txHash);
      console.log(`proof     fetched in ${Date.now() - t0} ms: header ${proof.headerNumber}, txIndex ${proof.txIndex}, ${proof.merkleProof.siblings.length} Merkle siblings, ${proof.continuityProof.roots.length} continuity roots, ${(proof.txBytes.length - 2) / 2} tx bytes`);
      console.log(`queryId   ${queryIdFor(proof.chainKey, proof.headerNumber, proof.txIndex)}`);
      const t1 = Date.now();
      const ok = await proofs.preverify(proof);
      console.log(`verifier  precompile 0xFD2 on Creditcoin says ${ok ? "VALID" : "INVALID"} (${Date.now() - t1} ms, eth_call, no gas)`);
      process.exitCode = ok ? 0 : 2;
      return;
    }

    case "livecheck": {
      const placeholder = "0x0000000000000000000000000000000000000001";
      const chains = connect({
        ...cfg,
        creditPassport: cfg.creditPassport || placeholder,
        paymentRail: cfg.paymentRail || placeholder,
        settlementToken: cfg.settlementToken || placeholder,
      });
      const proofs = new ProofService(cfg, chains.creditcoin);
      const attested = await proofs.latestAttestedHeight();
      const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

      // Pick a transaction whose receipt has an ERC-20 Transfer log with a non-zero sender.
      let txHash = args[0];
      let token: string | undefined;
      let from: string | undefined;
      const pickTransfer = (logs: readonly { address: string; topics: readonly string[]; data: string }[]) =>
        logs.find(
          (l) =>
            l.topics[0] === TRANSFER_TOPIC &&
            l.topics.length === 3 &&
            l.data.length === 66 &&
            BigInt(l.topics[1] ?? "0x0") !== 0n,
        );
      if (txHash) {
        const rc = await chains.sepolia.getTransactionReceipt(txHash);
        if (!rc) throw new Error("transaction not found on Sepolia");
        const log = pickTransfer(rc.logs);
        if (!log) throw new Error("that transaction has no ERC-20 Transfer log");
        token = log.address;
        from = `0x${(log.topics[1] ?? "").slice(26)}`;
      } else {
        outer: for (let h = attested - 2; h > attested - 60; h--) {
          const block = await chains.sepolia.getBlock(h, true);
          for (const tx of block?.prefetchedTransactions ?? []) {
            const rc = await chains.sepolia.getTransactionReceipt(tx.hash);
            if (!rc || rc.status !== 1 || rc.logs.length === 0 || rc.logs.length > 4) continue;
            const log = pickTransfer(rc.logs);
            if (log) {
              txHash = tx.hash;
              token = log.address;
              from = `0x${(log.topics[1] ?? "").slice(26)}`;
              break outer;
            }
          }
        }
        if (!txHash || !token || !from) throw new Error("no attested ERC-20 transfer found in the last 60 blocks");
      }

      console.log(`tx        ${txHash}`);
      console.log(`token     ${token}`);
      console.log(`payer     ${from}`);
      const proof = await proofs.getProof(txHash);
      console.log(`proof     header ${proof.headerNumber}, txIndex ${proof.txIndex}, ${proof.merkleProof.siblings.length} siblings, ${proof.continuityProof.roots.length} continuity roots`);

      const artifact = JSON.parse(readFileSync(join(PROJECT_ROOT, "abi", "LivePrecompileCheck.json"), "utf8")) as {
        abi: InterfaceAbi;
        bytecode: string;
      };
      const factory = new ContractFactory(artifact.abi, artifact.bytecode);
      const deployTx = await factory.getDeployTransaction(
        {
          action: ACTION.TokenTransfer,
          chainKey: proof.chainKey,
          blockHeight: proof.headerNumber,
          encodedTransaction: proof.txBytes,
          merkleRoot: proof.merkleProof.root,
          siblings: proof.merkleProof.siblings.map((s) => ({ hash: s.hash, isLeft: s.isLeft })),
          lowerEndpointDigest: proof.continuityProof.lowerEndpointDigest,
          continuityRoots: proof.continuityProof.roots,
        },
        token,
        from,
      );

      console.log(`calling   eth_call on ${new URL(cfg.creditcoinRpcUrl).host}: deploy TestUSD + CreditPassport, setSources, execute (no gas, nothing persisted)`);
      const passportIface = new Interface(ABI.CreditPassport);
      const returned = await chains.creditcoin.call({ data: deployTx.data, gasLimit: 30_000_000 });
      if (!returned || returned === "0x") throw new Error("the RPC returned no data for the creation call");
      const outcomeType = "tuple(bool recorded, bytes reason, address payer, address payee, uint256 amount, uint256 paymentCount, bytes32 queryId)";
      const [outcome] = AbiCoder.defaultAbiCoder().decode([outcomeType], returned) as unknown as [
        { recorded: boolean; reason: string; payer: string; payee: string; amount: bigint; paymentCount: bigint; queryId: string },
      ];
      if (outcome.recorded) {
        console.log(
          `result    RECORDED on the live verifier: payer ${outcome.payer} -> payee ${outcome.payee}, amount ${outcome.amount.toString()} raw units, ${outcome.paymentCount.toString()} payment(s), queryId ${outcome.queryId}`,
        );
        console.log("          precompile 0xFD2 accepted the proof, EvmV1Decoder decoded the receipt, CreditPassport recorded the transfer.");
        return;
      }
      let reason = outcome.reason;
      try {
        const p = passportIface.parseError(outcome.reason);
        if (p) reason = `${p.name}(${p.args.map(String).join(", ")})`;
      } catch {
        // leave raw
      }
      console.log(`result    REJECTED by CreditPassport.execute: ${reason}`);
      process.exitCode = 2;
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
