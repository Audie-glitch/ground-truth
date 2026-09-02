import { createServer, type Server } from "node:http";
import type { Chains } from "./chain.js";
import type { AgentConfig } from "./config.js";
import type { ProofService } from "./proofs.js";
import type { StateStore } from "./state.js";

/** Read-only JSON status endpoint consumed by the web app. Never exposes keys. */
export function startStatusServer(cfg: AgentConfig, store: StateStore, chains: Chains, proofs: ProofService): Server {
  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("cache-control", "no-store");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url !== "/status") {
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }));
      return;
    }
    try {
      const [sepoliaLatest, creditcoinLatest, attested] = await Promise.all([
        chains.sepolia.getBlockNumber(),
        chains.creditcoin.getBlockNumber(),
        proofs.latestAttestedHeight().catch(() => null),
      ]);
      const body = {
        now: new Date().toISOString(),
        agent: chains.agent?.address ?? null,
        contracts: {
          creditPassport: cfg.creditPassport,
          paymentRail: cfg.paymentRail,
          settlementToken: cfg.settlementToken,
          creditToken: cfg.creditToken ?? null,
        },
        sourceChainKey: cfg.sourceChainKey,
        rpc: { sepolia: new URL(cfg.sepoliaRpcUrl).host, creditcoin: new URL(cfg.creditcoinRpcUrl).host, prover: new URL(cfg.proofBuilderUrl).host },
        chain: {
          sepoliaLatest,
          creditcoinLatest,
          attestedHeight: attested,
          attestationLagBlocks: attested === null ? null : sepoliaLatest - attested,
        },
        lastScannedBlock: store.state.lastScannedBlock,
        pending: Object.values(store.state.pending).sort((a, b) => b.blockNumber - a.blockNumber),
        underwritings: Object.values(store.state.underwritings).sort((a, b) => b.at.localeCompare(a.at)),
        log: store.state.log.slice(-50),
        narrativeSource: cfg.llm.provider === "none" ? "template" : `${cfg.llm.provider}:${cfg.llm.model}`,
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: (err as Error).message }));
    }
  });
  server.listen(cfg.statusPort, "127.0.0.1", () => {
    console.log(`status server listening on http://127.0.0.1:${cfg.statusPort}/status`);
  });
  return server;
}
