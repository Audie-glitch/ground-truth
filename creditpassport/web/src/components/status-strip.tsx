"use client";

import { useEffect, useState } from "react";
import { Activity, Bot, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Status {
  chain: {
    deployment: string;
    creditcoinHead: number | null;
    sepoliaHead: number | null;
    attestedHeight: number | null;
    attestationLagBlocks: number | null;
    errors: string[];
    contracts: { creditPassport: string | null };
  };
  agent: { online: boolean; pending?: Array<{ status: string }>; error?: string };
}

export function StatusStrip() {
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as Status;
        if (!cancelled) {
          setStatus(body);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const pending = status?.agent.pending ?? [];
  const queued = pending.filter((p) => p.status === "seen" || p.status === "attested").length;

  return (
    <div className="border-t border-border/40 bg-muted/20">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-4 py-1.5 font-mono text-[11px] text-muted-foreground sm:px-6">
        <span className="flex items-center gap-1.5">
          <Link2 className="size-3" aria-hidden />
          {status ? (
            <>
              {status.chain.deployment === "local" ? "local anvil" : "Creditcoin testnet"}
              {status.chain.creditcoinHead !== null && <> · block {status.chain.creditcoinHead.toLocaleString()}</>}
            </>
          ) : failed ? (
            "status unavailable"
          ) : (
            "connecting…"
          )}
        </span>
        {status?.chain.sepoliaHead !== null && status?.chain.sepoliaHead !== undefined && (
          <span className="flex items-center gap-1.5">
            <Activity className="size-3" aria-hidden />
            Sepolia {status.chain.sepoliaHead.toLocaleString()}
            {status.chain.attestedHeight !== null && (
              <>
                {" "}
                · attested {status.chain.attestedHeight.toLocaleString()}
                <span
                  className={cn(
                    "ml-1 rounded px-1",
                    (status.chain.attestationLagBlocks ?? 0) < 120 ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
                  )}
                >
                  lag {status.chain.attestationLagBlocks} blocks
                </span>
              </>
            )}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Bot className="size-3" aria-hidden />
          {status ? (
            status.agent.online ? (
              <>
                agent online{queued > 0 && <> · {queued} awaiting proof</>}
              </>
            ) : (
              <span className="text-neutral-500">agent offline</span>
            )
          ) : (
            "agent …"
          )}
        </span>
        {status && !status.chain.contracts.creditPassport && (
          <span className="text-amber-300">passport not deployed for this configuration</span>
        )}
      </div>
    </div>
  );
}
