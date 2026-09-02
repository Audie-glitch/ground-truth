# Reconciled: statement PDFs to arithmetic-verified CSV, paid per page over x402

Design only. Per ETHGlobal's rules for ETHOnline 2026 (Sep 4-16), no
project-specific code exists before Sep 4. This document is the plan the build
follows from the first commit on Sep 4.

## Problem (from the demand list)

"Convert PDF bank statements into CSV transaction files reliably" (Ask HN).
Generic OCR and LLM extraction produce plausible rows that are silently wrong,
and nobody downstream can tell. Bookkeepers, accountants, and increasingly the
agents doing their data entry need output they can trust without re-keying.

## Insight

Bank statements carry their own checksum: the running balance. If every row's
balance equals the previous balance plus the row's signed amount, and the
final balance matches the closing balance, the extraction is arithmetically
consistent. That does not prove every description is right, but it catches
the failure mode that matters (missed rows, merged rows, wrong signs,
misplaced decimals). Reconciled output is the product. Unreconciled output is
flagged, cheaper, and never silent.

The same philosophy as CreditPassport: verification over trust, and a machine
consumer that pays only for what checks out.

## Who pays and why in USDC

Agents doing bookkeeping (and the tools that host them) are the buyer. They
have no card on file, they make thousands of small calls, and they need a
machine-readable price and a machine-executable payment. x402 gives them a
`402 Payment Required` with terms, they pay in USDC, they retry with the
payment header, they get the CSV. No signup, no API key, no invoice.

## API

```
GET  /                          service description, pricing, supported layouts, x402 terms (free)
POST /v1/probe                  multipart PDF -> { pages, textExtractable, detectedBank?, quote }   (free)
POST /v1/parse                  multipart PDF -> reconciled CSV (+ JSON sidecar)                     (x402, per page)
GET  /v1/receipt/{id}           re-fetch a paid result for 24h                                       (free, bearer = payment id)
```

`/v1/parse` response (JSON, with `text/csv` available via `Accept`):

```json
{
  "statement": { "account": "…1234", "currency": "USD", "opening": "1250.00", "closing": "982.41", "period": ["2026-07-01","2026-07-31"] },
  "rows": [ { "date": "2026-07-02", "description": "…", "amount": "-42.10", "balance": "1207.90", "page": 1 } ],
  "reconciliation": { "status": "reconciled" | "partial" | "failed", "brokenAt": [], "closingMatches": true },
  "pricing": { "pages": 3, "unitPrice": "0.05", "charged": "0.15", "currency": "USDC" }
}
```

Pricing: $0.05 USDC per page for reconciled output; `partial`/`failed` pages
are billed at $0.01 (the probe told the caller up front whether the PDF is
text-based, so failures are rare and never surprising). Prices are quoted in
the 402 terms, so agents can decide before paying.

## Extraction pipeline (v1 scope: text-based PDFs, no OCR)

1. `pdfjs-dist` text extraction with positions per page.
2. Line reconstruction by y-clustering; column detection by x-clustering of
   numeric tokens (date column, amount column(s), balance column).
3. Row assembly: a row starts at a date token; continuation lines (wrapped
   descriptions) attach to the previous row.
4. Amount normalisation: parentheses, trailing CR/DR, thousands separators,
   locale decimal commas, sign inference from debit/credit columns.
5. Reconciliation: walk rows, check `balance[i] == balance[i-1] + amount[i]`;
   report the first break per page; check closing balance against the
   statement summary when present.
6. Optional LLM pass (only when a key is configured) to repair description
   text or decide ambiguous sign conventions; it never invents amounts, and
   any row it touches is re-checked by step 5.

Layout fixtures: synthetic statements generated in several common layouts
(single amount column with signs, debit/credit columns, balance-forward,
multi-page with carried balances, European number formats). Every fixture has
a known-good CSV; the test suite asserts reconciliation succeeds and output
matches. Public sample statements from bank developer docs are added as they
are found; no real customer data ever enters the repo.

## x402 integration

- Server: Node (Hono) with the x402 middleware guarding `/v1/parse`. Price
  computed from the probe (pages), so the 402 quotes the exact amount.
- Networks: whatever the sponsor tracks accept. Hedera's track requires their
  facilitator and Hedera testnet USDC; Arc's requires USDC on Arc testnet via
  Agent Stack / Nanopayments; Base Sepolia as the universal fallback. The
  middleware supports a list of accepted networks; the client picks one.
- Client: a tiny reference agent (TypeScript) that probes, pays, parses, and
  writes the CSV, so judges can run the full loop from a terminal. A second
  example wires the same call into a Bazantic recipe for the Bazantic bounty.
- Facilitator: sponsor-provided where available; otherwise the open x402
  facilitator on testnet.

## Deliverables mapped to bounties

| Bounty | Deliverable |
| --- | --- |
| Hedera AI & Agentic Payments ($2k x 3) | Working x402 service on Hedera testnet, agent client, demo video under 5 min |
| Bazantic Agentify a new API ($500/$300/$200) | Service registered in Bazantic, recipe combining it with another sponsor API, screen recording |
| Arc Best Agentic Economy Application ($1,667) | Same service accepting USDC on Arc testnet, architecture diagram, frontend (probe + pay + download) |
| Uniswap / Hedera Harness open-source ($1k each) | Separate small PRs if time allows; unrelated to this service |

## Build order (Sep 4-16, small frequent commits)

1. Sep 4: repo scaffold, Hono server, `/`, `/probe`, pdf text extraction, first two synthetic fixtures, tests.
2. Sep 5-6: row assembly, amount normalisation, reconciliation, remaining fixtures, CSV output.
3. Sep 7: x402 middleware on Base Sepolia, reference client, end-to-end paid call on testnet.
4. Sep 8-9: Hedera and Arc network support per sponsor docs; Bazantic registration and recipe (needs your account).
5. Sep 10-11: minimal web frontend (probe, pay with injected wallet, download), architecture diagram, README.
6. Sep 12-15: hardening, LLM repair pass behind a flag, demo recording, submission text.
7. Sep 16: submit before the deadline.

## What only you do

- Register as a hacker on ETHGlobal and stake before Sep 4 if possible.
- Create a bazantic.com account and tell me the username so the recipe is attributed to you.
- Payout wallet address (already requested).
- Upload the demo video; paste the link in the submission.

## After the hackathon

Deploy to a small VPS or serverless host, keep the x402 endpoint live on
mainnet USDC (Base), list it in x402 service directories and Bazantic, and
let it earn. Revenue is per page; costs are near zero for text PDFs. OCR for
scanned statements is the obvious v2 and doubles the addressable set.
