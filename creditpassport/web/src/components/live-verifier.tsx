"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

interface Result {
  txHash: string;
  sepoliaBlock: number;
  attestedHeight: number;
  attested: boolean;
  steps: Step[];
  proof: { header: number; txIndex: number; siblings: number; continuityRoots: number; txBytes: number } | null;
  source: { token: string; payer: string } | null;
  outcome:
    | { kind: "recorded"; payer: string; payee: string; amount: string; paymentCount: number; queryId: string }
    | { kind: "rejected"; reason: string }
    | { kind: "pending" }
    | null;
  ranAgainst: string;
}

export function LiveVerifier() {
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const run = async (hash: string) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/livecheck", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txHash: hash }),
      });
      const body = (await res.json()) as Result | { error: string };
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : `request failed (${res.status})`);
        return;
      }
      setResult(body);
      setTxHash(body.txHash);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // /verify?tx=0x… runs the check on load, so results can be shared and screenshotted.
  useEffect(() => {
    const tx = new URLSearchParams(window.location.search).get("tx");
    if (!tx) return;
    const timer = setTimeout(() => {
      setTxHash(tx);
      void run(tx);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(txHash.trim());
        }}
      >
        <Input
          value={txHash}
          onChange={(e) => setTxHash(e.target.value)}
          placeholder="0x… Sepolia transaction hash"
          className="h-11 font-mono text-sm"
          spellCheck={false}
          aria-label="Sepolia transaction hash"
        />
        <Button type="submit" className="h-11" disabled={busy || txHash.trim().length !== 66}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          Verify on Creditcoin
        </Button>
        <Button type="button" variant="outline" className="h-11" disabled={busy} onClick={() => void run("")}>
          Use a recent transfer
        </Button>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Check failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {busy && (
        <Card>
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Fetching the proof and running the passport on the live verifier (5-15 seconds)…
          </CardContent>
        </Card>
      )}

      {result && (
        <div className="space-y-4">
          <Card
            className={
              result.outcome?.kind === "recorded"
                ? "border-emerald-500/40"
                : result.outcome?.kind === "pending"
                  ? "border-amber-500/40"
                  : "border-border"
            }
          >
            <CardHeader className="pb-2">
              <CardDescription>Outcome</CardDescription>
              <CardTitle className="text-xl">
                {result.outcome?.kind === "recorded" && "Recorded on a passport by the live verifier"}
                {result.outcome?.kind === "rejected" && "Proof verified; the passport rejected the receipt"}
                {result.outcome?.kind === "pending" && "Not attested yet"}
                {!result.outcome && "Proof unavailable"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {result.outcome?.kind === "recorded" && (
                <>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <div>
                      <span className="text-muted-foreground">payer </span>
                      <span className="font-mono text-xs">{result.outcome.payer}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">payee </span>
                      <span className="font-mono text-xs">{result.outcome.payee}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">amount </span>
                      <span className="tabular-nums">{result.outcome.amount} raw units</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">payments on the temporary passport </span>
                      <span className="tabular-nums">{result.outcome.paymentCount}</span>
                    </div>
                  </div>
                  <div className="break-all font-mono text-xs text-muted-foreground">query id {result.outcome.queryId}</div>
                </>
              )}
              {result.outcome?.kind === "rejected" && (
                <p className="text-muted-foreground">
                  The verifier accepted the proof and the receipt decoded, but this transaction carries no payment log
                  from a registered source, so the passport refused to record anything:{" "}
                  <code>{result.outcome.reason}</code>. That refusal is the source-binding check doing its job.
                </p>
              )}
              {result.outcome?.kind === "pending" && (
                <p className="text-muted-foreground">
                  Creditcoin has attested Sepolia up to block {result.attestedHeight.toLocaleString()}; this transaction is
                  in block {result.sepoliaBlock.toLocaleString()}. Attestation trails the head by a few minutes; try again shortly.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Ran against {result.ranAgainst} inside one eth_call. Nothing was deployed and no gas was spent.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {result.steps.map((s) => (
                  <li key={s.name} className="flex items-start gap-3 text-sm">
                    {s.ok ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
                    ) : s.name === "Attestation" ? (
                      <Clock className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-neutral-400" aria-hidden />
                    )}
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-muted-foreground">{s.detail}</div>
                    </div>
                  </li>
                ))}
              </ol>
              {result.proof && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Badge variant="outline">header {result.proof.header.toLocaleString()}</Badge>
                  <Badge variant="outline">tx index {result.proof.txIndex}</Badge>
                  <Badge variant="outline">{result.proof.siblings} Merkle siblings</Badge>
                  <Badge variant="outline">{result.proof.continuityRoots} continuity roots</Badge>
                  <Badge variant="outline">{result.proof.txBytes} tx bytes</Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
