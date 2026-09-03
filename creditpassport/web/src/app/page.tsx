import Link from "next/link";
import { ArrowRight, FileCheck2, Landmark, Lock, ScanSearch } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PassportSearch } from "@/components/passport-search";
import { recentPayers, type RecentPayer } from "@/lib/chain";
import { getConfig } from "@/lib/config";
import { money, shortAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

async function loadRecent(): Promise<{ payers: RecentPayer[]; error: string | null }> {
  try {
    return { payers: await recentPayers(), error: null };
  } catch (err) {
    return { payers: [], error: (err as Error).message };
  }
}

export default async function Home() {
  const cfg = getConfig();
  const { payers, error } = await loadRecent();

  return (
    <div className="space-y-12">
      <section className="space-y-6 pt-4">
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
          Creditcoin · Attestcoin Protocol
        </Badge>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Credit history you can prove, not just claim.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          CreditPassport records invoice payments that provably happened on Ethereum Sepolia, verified by
          Creditcoin&apos;s attestation of the source chain. An underwriting agent reads only that verified
          history and extends a credit line the contract caps for it. No oracle operator anywhere.
        </p>
        <div className="max-w-2xl">
          <PassportSearch />
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="size-4 text-emerald-400" aria-hidden />
              Proven payments
            </CardTitle>
            <CardDescription>
              Every row on a passport is an <code>InvoicePaid</code> log, or a plain USDC <code>Transfer</code>, decoded
              from a receipt whose inclusion the Creditcoin verifier precompile checked. Late or on time is fixed by the
              source log itself.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Lock className="size-4 text-emerald-400" aria-hidden />
              Bounded underwriting
            </CardTitle>
            <CardDescription>
              The agent scores and writes a memo, but <code>maxCreditLimit</code> is computed on-chain from verified
              volume and on-time ratio. Any limit above it reverts.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="size-4 text-emerald-400" aria-hidden />
              Drawable credit
            </CardTitle>
            <CardDescription>
              Payers draw cUSD against their limit on Creditcoin and repay. Limits can only rise with more proven
              history and never fall below what is drawn.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Recent passports</h2>
          <span className="text-xs text-muted-foreground">
            {cfg.deployment === "local" ? "Local demo chain" : "Creditcoin testnet"}
          </span>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Cannot read the passport contract</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : payers.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <ScanSearch className="mx-auto mb-3 size-6" aria-hidden />
              No verified payments yet. Pay an invoice through the rail on Sepolia, then run the agent; the first
              passport appears here once Creditcoin has attested the block and the proof is submitted.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {payers.map((p) => (
              <Link key={p.address} href={`/passport/${p.address}`} className="group">
                <Card className="h-full transition-colors group-hover:border-emerald-500/40">
                  <CardHeader className="pb-2">
                    <CardTitle className="font-mono text-sm">{shortAddress(p.address, 6)}</CardTitle>
                    <CardDescription>
                      {p.verifiedCount} verified payment{p.verifiedCount === 1 ? "" : "s"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>last {money(p.lastAmountFormatted)} tUSD</span>
                    <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section id="how-it-works" className="space-y-4">
        <h2 className="text-lg font-medium">How a payment becomes credit</h2>
        <ol className="grid gap-3 text-sm md:grid-cols-5">
          {[
            ["Pay", "The payer settles an invoice through PaymentRail on Sepolia; the log carries amount, due block and paid block."],
            ["Attest", "Creditcoin attests Sepolia blocks continuously, typically a few minutes behind the head."],
            ["Prove", "The agent fetches a Merkle inclusion proof and continuity proof from the hosted prover, singly or in batches of ten."],
            ["Verify", "CreditPassport asks the verifier precompile to check the proof, decodes the receipt, and records the payment."],
            ["Underwrite", "The agent scores the verified history and sets a limit the contract caps; the payer draws cUSD."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-lg border border-border/60 bg-card p-4">
              <div className="mb-1 font-mono text-xs text-muted-foreground">0{i + 1}</div>
              <div className="font-medium">{title}</div>
              <p className="mt-1 text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
