# Triage of the demand-signal list against the earning goal

Source: ~180 "unmet need" rows scraped from Reddit, Hacker News and Indie
Hackers (Aug 23-25, 2026), supplied in chat on 2 Sep 2026 as a table with
columns date, platform, post title, unmet need, niche concept, monetization,
source URL. Rows are referenced below by their post titles.

The goal is crypto earned through skill-based work. The list is validated
demand for products, which is a different thing: a product earns fiat over
months after distribution and support, not stablecoins in weeks. So the useful
question is narrower than "which idea is best": which rows can be shipped
inside the open bounty windows, get paid in crypto, and keep earning afterwards.

## What actually connects to the pipeline

### 1. Agentic-payment bounties want exactly one shape: an API agents pay per call

Three ETHOnline tracks (Sep 4-16) and the KeeperHub main track reward a
service that an autonomous agent can discover, pay for in USDC, and consume:

| Track | Prize | What it asks for |
| --- | --- | --- |
| Hedera "AI & Agentic Payments" | $2,000 x 3 | A working x402 service |
| Bazantic "Agentify a new API" | $500 / $300 / $200 | Add a new API service to Bazantic's x402/MPP gateway and a reusable recipe |
| Arc "Best Agentic Economy Application" | $1,667 | Agents that pay/settle in USDC, ideally via Circle Agent Stack / Nanopayments |
| KeeperHub main track | $2,000 / $1,200 / $800 | KeeperHub as execution layer inside a live project, value moving through it |

A per-call API from the list, priced in USDC over x402, is one build that
qualifies for several of these and is a real product afterwards. That is the
only place the list and the goal overlap directly.

Rows that fit "an agent pays per call" (developer-facing, deterministic or
verifiable output, stateless request/response, no consumer distribution):

| Row | Unit of value | Verifiability | Effort | Verdict |
| --- | --- | --- | --- | --- |
| Convert PDF bank statements into CSV reliably (Ask HN) | per page | Arithmetic: running balance must reconcile row to row, so wrong extractions are detectable | Medium-high (text PDFs; OCR out of scope) | **Build.** Highest willingness to pay on the list; bookkeeping agents are a real buyer; reconciliation makes the output trustworthy without trusting a model |
| Strict-spec document/photo pre-flight resizer | per image | Deterministic (dimensions, bytes, DPI) | Low | Second endpoint if time allows |
| HAR file PII/auth-token sanitizer | per file | Deterministic | Low | Cheap add-on, low value |
| Breaking API surface gatekeeper (semver) | per check | Deterministic per language | Medium | Later; language-specific |
| PR-diff-aware CI test selector | per PR | Hard to verify | High | No |
| Cost-optimised LLM router | per request | Quality unverifiable, needs upstream keys | Medium | No; OpenRouter exists |
| Multi-OS untrusted code sandbox API | per second | Infra-heavy | Very high | No |

Decision: the ETHOnline entry is a paid API whose headline endpoint turns
text-based bank statement PDFs into reconciled CSV, priced per page in USDC
over x402. Design in `../x402-api/DESIGN.md`. Per ETHGlobal's rules nothing
project-specific is written before Sep 4; the design is the only artifact
until then.

### 2. Rows that validate the CreditPassport thesis (use in the deck, do not build)

Several rows ask for portable, verified history without a trusted middleman,
which is what CreditPassport does with Attestcoin proofs:

- Two-way verified landlord and tenant mutual reputation registry
- Client-freelancer pre-payment milestone verification and acceptance runner
- B2B referral contract generator and commission escrow
- Standardized software engineering competency credential with live verification
- Deep GitHub activity dossier for recruiting

These go on the "market pull" slide as evidence the problem is felt, with
their URLs. None is built now.

### 3. Rows that are not a crypto-earning path in any open window

Roughly 150 of the rows are consumer or SMB apps (ADHD tools, screen-time
lockers, photo journals, meetup apps, household trackers, macOS utilities).
They need app-store distribution, marketing and support, they earn fiat, and
the first dollar is months away. Some are good businesses; none is an answer
to "gain crypto assets," and building any of them now would displace work
that pays in stablecoins in September. They are parked, not rejected.

Two rows are close to what the parallel agent runs already built here:
"Covered call backtester with historical IV surfaces" and "Options income
backtester" resemble the Ground Truth backtester at the repo root, but with a
paid-data dependency (options surfaces) that makes them a fiat SaaS, not a
bounty.

## What this changes in the pipeline

- New ETHOnline plan: one x402-paid API (statement parsing) targeting Hedera
  x402, Bazantic, and Arc agentic tracks, plus Uniswap/Hedera Harness
  open-source contributions as originally planned if time allows.
- New user action before Sep 4: create a bazantic.com account (the Bazantic
  bounty attributes recipes to the account holder), and confirm whether a
  Hedera testnet account is needed for their x402 facilitator.
- Everything else in `PIPELINE.md` stands.
