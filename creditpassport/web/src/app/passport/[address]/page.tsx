import { notFound } from "next/navigation";
import { isAddress, type Address } from "viem";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Hash } from "@/components/address-link";
import { PassportSearch } from "@/components/passport-search";
import { readPassport, type PassportView } from "@/lib/chain";
import { explorerBases, getConfig } from "@/lib/config";
import { blocksAgo, money, scoreTone } from "@/lib/format";
import { decodeMemo } from "@/lib/memo";

export const dynamic = "force-dynamic";

export default async function PassportPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) notFound();

  const cfg = getConfig();
  const explorers = explorerBases(cfg);
  let view: PassportView | null = null;
  let error: string | null = null;
  try {
    view = await readPassport(address as Address);
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Passport</div>
          <h1 className="mt-1 break-all font-mono text-xl sm:text-2xl">{address}</h1>
          {explorers && (
            <div className="mt-1">
              <Hash value={address} href={`${explorers.creditcoinAddress}${address}`} kind="address" />
            </div>
          )}
        </div>
        <div className="w-full sm:max-w-md">
          <PassportSearch size="sm" />
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load this passport</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {view && view.payments.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">No verified payments for this address.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              A passport starts when a proof of an <code>InvoicePaid</code> log from the registered rail is submitted to
              CreditPassport. Pay an invoice on Sepolia and run the agent, or submit a proof with{" "}
              <code>npm run cli -- prove &lt;txHash&gt;</code>.
            </p>
          </CardContent>
        </Card>
      )}

      {view && view.payments.length > 0 && <PassportBody view={view} explorers={explorers} />}
    </div>
  );
}

function PassportBody({ view, explorers }: { view: PassportView; explorers: ReturnType<typeof explorerBases> }) {
  const p = view.profile;
  const tone = scoreTone(p.score);
  const memo = decodeMemo(p.memoURI);
  const dated = p.onTimeCount + p.lateCount;
  const onTimePct = dated ? Math.round((100 * p.onTimeCount) / dated) : null;
  const drawn = Number(p.drawnFormatted);
  const limit = Number(p.creditLimitFormatted);
  const utilisation = limit > 0 ? Math.min(100, Math.round((100 * drawn) / limit)) : 0;

  return (
    <>
      <section className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Score</CardDescription>
            <CardTitle className="flex items-baseline gap-3">
              <span className={`text-5xl font-semibold tabular-nums ${tone.className}`}>{p.score}</span>
              <span className="text-sm text-muted-foreground">/ 1000 · {tone.label}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verified payments</span>
              <span className="tabular-nums">{view.payments.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">On time</span>
              <span className="tabular-nums">
                {p.onTimeCount} of {dated}
                {onTimePct !== null && <span className="text-muted-foreground"> ({onTimePct}%)</span>}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Late</span>
              <span className="tabular-nums">{p.lateCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Dated volume</span>
              <span className="tabular-nums">{money(p.datedVolumeFormatted)} tUSD</span>
            </div>
            {p.transferCount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Undated transfers</span>
                <span className="tabular-nums">
                  {p.transferCount} · {money(p.undatedVolumeFormatted)} tUSD
                </span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>First verified payment</span>
              <span className="tabular-nums">block {p.firstPaidBlock.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Most recent</span>
              <span className="tabular-nums">
                block {p.lastPaidBlock.toLocaleString()}
                {blocksAgo(p.lastPaidBlock, view.sepoliaHead) ? ` · ${blocksAgo(p.lastPaidBlock, view.sepoliaHead)}` : ""}
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Credit limit</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{money(p.creditLimitFormatted)} cUSD</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Policy cap {money(view.policyMaxFormatted)} cUSD
              {Number(view.policyMaxFormatted) > 0 && limit > 0 && (
                <> · agent extended {Math.round((100 * limit) / Number(view.policyMaxFormatted))}% of it</>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Available to draw</CardDescription>
              <CardTitle className="text-3xl tabular-nums">{money(view.availableFormatted)} cUSD</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>
                Drawn {money(p.drawnFormatted)} cUSD · {utilisation}% utilised
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                <div className="h-full bg-emerald-500" style={{ width: `${utilisation}%` }} aria-hidden />
              </div>
            </CardContent>
          </Card>
          <Card className="sm:col-span-2">
            <CardHeader className="pb-2">
              <CardDescription>Underwriting memo</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {memo ? (
                <>
                  <p>{memo.narrative}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{memo.narrativeSource ?? "memo"}</Badge>
                    {memo.generatedAt && <span>{new Date(memo.generatedAt).toUTCString()}</span>}
                    {p.underwrittenAt > 0 && <span>· recorded at Creditcoin block {p.underwrittenAt.toLocaleString()}</span>}
                  </div>
                  {memo.factors && memo.factors.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Factor</TableHead>
                          <TableHead className="text-right">Points</TableHead>
                          <TableHead>Detail</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {memo.factors.map((f) => (
                          <TableRow key={f.name}>
                            <TableCell className="font-mono text-xs">{f.name}</TableCell>
                            <TableCell className="text-right tabular-nums">{f.points > 0 ? `+${f.points}` : f.points}</TableCell>
                            <TableCell className="text-muted-foreground">{f.detail}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Not underwritten yet. The agent underwrites after each new verified payment.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Verified payments</h2>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Due block</TableHead>
                <TableHead className="text-right">Paid block</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Source tx</TableHead>
                <TableHead>Verified on Creditcoin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.payments.map((pay) => (
                <TableRow key={pay.queryId}>
                  <TableCell className="font-mono text-xs">{pay.dated ? pay.invoiceId.slice(0, 10) + "…" : "transfer"}</TableCell>
                  <TableCell>
                    <Hash value={pay.payee} kind="address" href={explorers ? `${explorers.sepoliaAddress}${pay.payee}` : null} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(pay.amountFormatted)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {pay.dated ? pay.dueBlock.toLocaleString() : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{pay.paidBlock.toLocaleString()}</TableCell>
                  <TableCell>
                    {pay.dated ? (
                      pay.onTime ? (
                        <Badge className="bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">on time</Badge>
                      ) : (
                        <Badge className="bg-amber-500/15 text-amber-300 hover:bg-amber-500/15">
                          late by {(pay.paidBlock - pay.dueBlock).toLocaleString()} blocks
                        </Badge>
                      )
                    ) : (
                      <Badge variant="outline">undated</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {pay.sepoliaTx ? (
                      <Hash value={pay.sepoliaTx} href={explorers ? `${explorers.sepoliaTx}${pay.sepoliaTx}` : null} />
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground" title="block and index of the proven transaction">
                        #{pay.sourceBlock.toLocaleString()}/{pay.sourceTxIndex}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {pay.creditcoinTx ? (
                      <Hash value={pay.creditcoinTx} href={explorers ? `${explorers.creditcoinTx}${pay.creditcoinTx}` : null} />
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
        <p className="text-xs text-muted-foreground">
          Query id for each row is keccak256(chainKey, sourceBlock, txIndex); the same identity the contract uses to
          refuse replays.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How the cap is computed</CardTitle>
            <CardDescription>On-chain, from verified history only. The agent cannot exceed it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 font-mono text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">50% × dated volume</span>
              <span>{money((Number(p.datedVolumeFormatted) * 0.5).toString())}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">× on-time ratio {onTimePct !== null ? `${p.onTimeCount}/${dated}` : "n/a"}</span>
              <span>{dated ? money(((Number(p.datedVolumeFormatted) * 0.5 * p.onTimeCount) / dated).toString()) : "0"}</span>
            </div>
            {p.lateCount > p.onTimeCount && (
              <div className="text-amber-300">more late than on-time payments: dated credit is zero</div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">+ 25% × undated volume</span>
              <span>{money((Number(p.undatedVolumeFormatted) * 0.25).toString())}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-medium">
              <span>maxCreditLimit</span>
              <span>{money(view.policyMaxFormatted)} cUSD</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Underwriting history</CardTitle>
            <CardDescription>Every decision the agent recorded on-chain for this passport.</CardDescription>
          </CardHeader>
          <CardContent>
            {view.underwritings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No underwriting yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {view.underwritings.map((u) => (
                  <li key={u.creditcoinTx} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      score <span className="tabular-nums">{u.score}</span> · limit{" "}
                      <span className="tabular-nums">{money(u.creditLimitFormatted)}</span> of{" "}
                      <span className="tabular-nums">{money(u.policyMaxFormatted)}</span>
                    </span>
                    <Hash value={u.creditcoinTx} href={explorers ? `${explorers.creditcoinTx}${u.creditcoinTx}` : null} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}
