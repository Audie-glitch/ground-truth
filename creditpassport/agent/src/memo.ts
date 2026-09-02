import type { AgentConfig } from "./config.js";
import type { ScoreResult, VerifiedProfile } from "./scoring.js";
import { toUnits } from "./scoring.js";

export interface UnderwritingMemo {
  v: 1;
  generatedAt: string;
  payer: string;
  score: number;
  creditLimit: string;
  policyMax: string;
  paymentCount: number;
  factors: ScoreResult["factors"];
  history: {
    datedVolume: string;
    undatedVolume: string;
    onTime: number;
    late: number;
    transfers: number;
    firstPaidBlock: number;
    lastPaidBlock: number;
  };
  narrative: string;
  narrativeSource: string;
}

export interface MemoInput {
  payer: string;
  profile: VerifiedProfile;
  paymentCount: number;
  score: ScoreResult;
  policyMax: bigint;
  creditLimit: bigint;
}

const NARRATIVE_LIMIT = 480;

export async function buildMemo(cfg: AgentConfig, input: MemoInput): Promise<UnderwritingMemo> {
  const template = templateNarrative(input);
  let narrative = template;
  let narrativeSource = "template";

  if (cfg.llm.provider !== "none" && cfg.llm.apiKey) {
    try {
      const generated = await generateNarrative(cfg, input);
      if (generated) {
        narrative = generated.slice(0, NARRATIVE_LIMIT);
        narrativeSource = `${cfg.llm.provider}:${cfg.llm.model}`;
      }
    } catch (err) {
      narrative = template;
      narrativeSource = `template (model call failed: ${(err as Error).message.slice(0, 80)})`;
    }
  }

  return {
    v: 1,
    generatedAt: new Date().toISOString(),
    payer: input.payer,
    score: input.score.score,
    creditLimit: input.creditLimit.toString(),
    policyMax: input.policyMax.toString(),
    paymentCount: input.paymentCount,
    factors: input.score.factors,
    history: {
      datedVolume: input.profile.datedVolume.toString(),
      undatedVolume: input.profile.undatedVolume.toString(),
      onTime: input.profile.onTimeCount,
      late: input.profile.lateCount,
      transfers: input.profile.transferCount,
      firstPaidBlock: input.profile.firstPaidBlock,
      lastPaidBlock: input.profile.lastPaidBlock,
    },
    narrative,
    narrativeSource,
  };
}

/** Encodes the memo as a data: URI so the contract stores a self-contained reference. */
export function memoToDataUri(memo: UnderwritingMemo): string {
  const json = JSON.stringify(memo);
  return `data:application/json;base64,${Buffer.from(json, "utf8").toString("base64")}`;
}

export function memoFromDataUri(uri: string): UnderwritingMemo | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  try {
    return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8")) as UnderwritingMemo;
  } catch {
    return null;
  }
}

function templateNarrative(input: MemoInput): string {
  const p = input.profile;
  const dated = p.onTimeCount + p.lateCount;
  const punctuality =
    dated === 0
      ? "no dated invoices"
      : `${p.onTimeCount}/${dated} dated invoices on time`;
  return (
    `Score ${input.score.score}/1000 from ${input.paymentCount} verified payments ` +
    `(${punctuality}, ${p.transferCount} undated transfers, ${toUnits(p.datedVolume + p.undatedVolume).toFixed(2)} settled). ` +
    `Policy cap ${toUnits(input.policyMax).toFixed(2)}; extending ${toUnits(input.creditLimit).toFixed(2)} ` +
    `(${Math.round(input.score.limitFactor * 100)}% of cap). Every figure derives from Attestcoin-proven source-chain receipts.`
  );
}

async function generateNarrative(cfg: AgentConfig, input: MemoInput): Promise<string | null> {
  const facts = {
    score: input.score.score,
    factors: input.score.factors,
    verifiedPayments: input.paymentCount,
    onTime: input.profile.onTimeCount,
    late: input.profile.lateCount,
    undatedTransfers: input.profile.transferCount,
    settledVolumeUnits: toUnits(input.profile.datedVolume + input.profile.undatedVolume),
    policyCapUnits: toUnits(input.policyMax),
    extendedLimitUnits: toUnits(input.creditLimit),
    shareOfCap: input.score.limitFactor,
  };
  const system =
    "You are an underwriting analyst. Write a two to three sentence credit memo using only the facts provided. " +
    "Do not invent history, do not speculate about the borrower, and do not change any number. Plain prose, no lists, no headings.";
  const user = `Facts (JSON): ${JSON.stringify(facts)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    if (cfg.llm.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.llm.apiKey}` },
        body: JSON.stringify({
          model: cfg.llm.model,
          temperature: 0.2,
          max_tokens: 220,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return body.choices?.[0]?.message?.content?.trim() ?? null;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.llm.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        max_tokens: 220,
        temperature: 0.2,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    return body.content?.find((c) => c.type === "text")?.text?.trim() ?? null;
  } finally {
    clearTimeout(timer);
  }
}
