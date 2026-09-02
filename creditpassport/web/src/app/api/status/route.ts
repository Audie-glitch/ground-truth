import { NextResponse } from "next/server";
import { chainStatus } from "@/lib/chain";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

interface AgentStatus {
  online: boolean;
  agent?: string | null;
  pending?: unknown[];
  underwritings?: unknown[];
  log?: unknown[];
  narrativeSource?: string;
  error?: string;
}

async function agentStatus(url: string): Promise<AgentStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_500);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return { online: false, error: `agent responded ${res.status}` };
    const body = (await res.json()) as Omit<AgentStatus, "online">;
    return { online: true, ...body };
  } catch (err) {
    return { online: false, error: (err as Error).name === "AbortError" ? "agent status timed out" : "agent offline" };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const cfg = getConfig();
  const [chain, agent] = await Promise.all([chainStatus(), agentStatus(cfg.agentStatusUrl)]);
  return NextResponse.json({ now: new Date().toISOString(), chain, agent }, { headers: { "cache-control": "no-store" } });
}
