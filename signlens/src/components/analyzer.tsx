"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, OctagonAlert, Search, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EXAMPLES } from "@/lib/examples";
import type { AddressInfo, Report, Severity } from "@/lib/analyze/types";
import { cn } from "@/lib/utils";

const CHAINS: Array<{ id: number | null; label: string }> = [
  { id: null, label: "Chain from payload" },
  { id: 1, label: "Ethereum" },
  { id: 8453, label: "Base" },
  { id: 42161, label: "Arbitrum" },
  { id: 10, label: "Optimism" },
  { id: 137, label: "Polygon" },
  { id: 56, label: "BNB Chain" },
  { id: 11155111, label: "Sepolia" },
  { id: 84532, label: "Base Sepolia" },
];

const EXPLORER: Record<number, string> = {
  1: "https://etherscan.io/address/",
  11155111: "https://sepolia.etherscan.io/address/",
  8453: "https://basescan.org/address/",
  84532: "https://sepolia.basescan.org/address/",
  42161: "https://arbiscan.io/address/",
  10: "https://optimistic.etherscan.io/address/",
  137: "https://polygonscan.com/address/",
  56: "https://bscscan.com/address/",
};

const VERDICT: Record<Severity, { label: string; className: string; Icon: typeof OctagonAlert }> = {
  critical: { label: "Do not sign", className: "border-red-500/50 bg-red-500/10 text-red-200", Icon: OctagonAlert },
  high: { label: "High risk", className: "border-orange-500/50 bg-orange-500/10 text-orange-200", Icon: TriangleAlert },
  medium: { label: "Check carefully", className: "border-amber-500/50 bg-amber-500/10 text-amber-200", Icon: AlertTriangle },
  low: { label: "Minor notes", className: "border-sky-500/40 bg-sky-500/10 text-sky-200", Icon: Search },
  info: { label: "Looks routine", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200", Icon: CheckCircle2 },
};

const BADGE: Record<Severity, string> = {
  critical: "bg-red-500/20 text-red-200 hover:bg-red-500/20",
  high: "bg-orange-500/20 text-orange-200 hover:bg-orange-500/20",
  medium: "bg-amber-500/20 text-amber-200 hover:bg-amber-500/20",
  low: "bg-sky-500/20 text-sky-200 hover:bg-sky-500/20",
  info: "bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/20",
};

export function Analyzer() {
  const [input, setInput] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (payload = input, chain = chainId) => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: payload, chainId: chain ?? undefined }),
      });
      const body = (await res.json()) as Report | { error: string };
      if (!res.ok || "error" in body) {
        setError("error" in body ? body.error : `request failed (${res.status})`);
        return;
      }
      setReport(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadExample = (id: string) => {
    const ex = EXAMPLES.find((e) => e.id === id);
    if (!ex) return;
    setInput(ex.payload);
    setChainId(ex.chainId);
    void run(ex.payload, ex.chainId);
  };

  // Deep links such as /?example=drainer-approve preload and analyse an example.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("example");
    if (!id) return;
    const timer = setTimeout(() => loadExample(id), 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-3">
        <label htmlFor="payload" className="text-sm font-medium">
          Wallet request
        </label>
        <Textarea
          id="payload"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'{"method":"eth_sendTransaction","params":[{"to":"0x…","data":"0x095ea7b3…"}]}\n\nor EIP-712 typed data, or raw calldata'}
          className="min-h-[300px] font-mono text-xs"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Chain"
            value={chainId ?? ""}
            onChange={(e) => setChainId(e.target.value ? Number(e.target.value) : null)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {CHAINS.map((c) => (
              <option key={c.label} value={c.id ?? ""}>
                {c.label}
              </option>
            ))}
          </select>
          <Button onClick={() => void run()} disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Search className="size-4" aria-hidden />}
            Analyze
          </Button>
        </div>
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Try an example</div>
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                onClick={() => loadExample(ex.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs transition-colors hover:bg-muted",
                  ex.tone === "bad" ? "border-red-500/30 text-red-200" : ex.tone === "good" ? "border-emerald-500/30 text-emerald-200" : "border-border",
                )}
              >
                {ex.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-[300px]">
        {error && (
          <Alert variant="destructive">
            <AlertTitle>Could not analyse that</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!error && !report && !busy && (
          <Card className="h-full">
            <CardContent className="flex h-full flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
              <Search className="mb-3 size-6" aria-hidden />
              The verdict appears here. Paste a request or pick an example.
            </CardContent>
          </Card>
        )}
        {busy && (
          <Card className="h-full">
            <CardContent className="flex h-full items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
              Decoding and checking addresses on-chain…
            </CardContent>
          </Card>
        )}
        {report && <ReportView report={report} />}
      </div>
    </div>
  );
}

function AddressCard({ title, info, chainId }: { title: string; info: AddressInfo; chainId: number | null }) {
  const href = chainId && EXPLORER[chainId] && info.address.startsWith("0x") ? `${EXPLORER[chainId]}${info.address}` : null;
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3 text-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 break-all font-mono text-xs">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sky-300 hover:underline">
            {info.address}
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : (
          info.address
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {info.label && <Badge variant="outline">{info.label}</Badge>}
        {info.isContract === true && <Badge variant="outline">contract</Badge>}
        {info.isContract === false && <Badge className={BADGE.critical}>wallet address (no code)</Badge>}
        {info.isContract === null && <Badge variant="outline">not checked</Badge>}
        {info.verified === true && <Badge variant="outline">source verified</Badge>}
        {info.verified === false && <Badge className={BADGE.high}>unverified</Badge>}
      </div>
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const v = VERDICT[report.verdict];
  return (
    <div className="space-y-4">
      <div className={cn("rounded-lg border p-4", v.className)}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
          <v.Icon className="size-4" aria-hidden />
          {v.label}
          <span className="ml-auto font-mono normal-case tracking-normal opacity-70">
            {report.method}
            {report.chainId ? ` · chain ${report.chainId}` : ""}
          </span>
        </div>
        <p className="mt-2 text-base leading-snug text-foreground">{report.summary}</p>
      </div>

      {report.findings.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Findings</CardTitle>
            <CardDescription>Ordered by severity.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {report.findings.map((f, i) => (
                <li key={`${f.title}-${i}`} className="text-sm">
                  <div className="flex items-center gap-2">
                    <Badge className={BADGE[f.severity]}>{f.severity}</Badge>
                    <span className="font-medium">{f.title}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{f.detail}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {report.target && report.target.address !== "unknown" && <AddressCard title="Target contract" info={report.target} chainId={report.chainId} />}
        {report.counterparty && <AddressCard title="Who gets the permission or funds" info={report.counterparty} chainId={report.chainId} />}
      </div>

      {report.decoded.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Decoded request</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Field</TableHead>
                <TableHead>Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.decoded.map((d, i) => (
                <TableRow key={`${d.name}-${i}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{d.name}</TableCell>
                  <TableCell className="break-all font-mono text-xs">
                    {d.value}
                    {d.note && <span className="ml-2 text-muted-foreground">({d.note})</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {report.children && report.children.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium">Calls in this batch</div>
          {report.children.map((c, i) => (
            <div key={i} className={cn("rounded-lg border p-3 text-sm", VERDICT[c.verdict].className)}>
              <span className="font-mono text-xs opacity-70">call {i + 1} · {VERDICT[c.verdict].label}</span>
              <p className="mt-1 text-foreground">{c.summary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
