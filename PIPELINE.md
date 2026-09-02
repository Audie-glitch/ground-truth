# Earning pipeline

Goal: gain crypto assets by earning them. Every item below pays in crypto or
stablecoins for shipped engineering work. Nothing here involves trading,
custody, or sending funds anywhere.

Status as of 2 September 2026, 23:30 UTC. Dates verified against each
organizer's own page on that day.

## Opportunities, ranked by expected payout per unit of work

| # | Opportunity | Prize | Pays in | Window | Competition signal | Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | [KeeperHub Agent Economy hackathon](https://dorahacks.io/hackathon/agent-economy/detail), Best KeeperHub Feature bounty | $500 x 2 winners | Stablecoins | Build Sep 6-18, submit by Sep 18 12:00 CEST | Niche: needs a mergeable PR into a 2,700-file TypeScript codebase. Maintainers opened `accepted` + `help wanted` feature issues on Sep 2 | Implement issue [#2240](https://github.com/keeperhub/keeperhub/issues/2240) (state-threshold trigger, "ranked first for unlock per unit of cost"). Design proposal first, code from Sep 6. |
| 2 | [ETHOnline 2026](https://ethglobal.com/events/ethonline2026), Uniswap Foundation "Best Uniswap Stack Contribution" | $1,000 x 3 | USDC (ETHGlobal standard) | Sep 4-16 | Open-source contribution track; typically undersubscribed relative to app tracks | Improvement or tooling PR against an official Uniswap repo, plus `FEEDBACK.md` and the feedback form. |
| 3 | ETHOnline 2026, Hedera "Open Source, Improve the Hedera Harness" | $1,000 x 2 | USDC | Sep 4-16 | PR to [hedera-dev/hedera-harness](https://github.com/hedera-dev/hedera-harness); "open PR, not merged is fine" | Service-coverage or local-dev-mode PR with tests and a before/after demo. |
| 4 | [BUIDL CTC 2026 Fall](https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail) (Creditcoin / Attestcoin Protocol) | $10,000 / $3,000 / $2,000 | USD-denominated; payout asset not stated (ask in Discord `#buidl-ctc-qna`) | Open now, deadline Sep 13 23:59 ET | 46 submissions so far; most hackathon entries are shallow. Depth of Attestcoin integration is a core scoring criterion | Build now. Project: CreditPassport (see below). |
| 5 | ETHOnline 2026, Arc (Circle) agentic and DeFi bounties | $1,667 x 3 tracks, plus $3,500 mainnet-readiness | USDC | Sep 4-16 | Requires frontend + backend + architecture diagram + video | Stretch: only if the KeeperHub work can be pointed at Arc (KeeperHub issue #2230 adds Arc testnet). |
| 6 | KeeperHub main track, Best Integration into a Live Project | $2,000 / $1,200 / $800 | Stablecoins | Sep 6-18 | Needs a KeeperHub account, a funded testnet wallet, and a real third-party project on the other side | Phase 2 once you have a KeeperHub account. |
| 7 | [3rd-Web-Hack](https://3rd-web-hack.devpost.com/) (Devpost) | $500 / $200 / $50 | USDT | Deadline Sep 27 | 86 participants, tiny pool, low bar | Adapt one of the builds above if its rules permit. |
| 8 | [Arbitrum Open House Singapore buildathon](https://web3voyager.com/event/arbitrum-open-house-singapore-online-buildathon) | $115,000 pool | Not stated | Sep 13 - Oct 4; existing projects allowed | Large field | Re-target the ETHOnline or CTC project after Sep 16. |
| 9 | [Monad Metropolis](https://www.monad.xyz/developers/hackathons/metropolis) | $250,000 pool, $30k per track | Not stated | Sep 1 - Oct 13 | Very large field, startup-oriented | Only if items 1-4 are shipped early. |

Verified dead ends: Sherlock has 0 active audit contests; Code4rena wound down
in May 2026; Colosseum's Solana hackathon does not open until Sep 28.

## Division of labour with the parallel agents in this repo

Other agent runs on this branch have produced `research/` notes, the Ground
Truth backtester at the repo root, and a KeeperHub analysis that targets issue
[#2105](https://github.com/keeperhub/keeperhub/issues/2105). To avoid
collisions:

- This track owns `creditpassport/` (BUIDL CTC entry), `keeperhub/2240-*`
  (the #2240 trigger design and implementation), and the ETHOnline
  open-source bounties.
- #2105 stays with the run that scoped it; the two KeeperHub PRs are
  independent and both can be entered for the bounty.
- One note (`research/crypto-earning-opportunities-2026-09.md`) marks BUIDL
  CTC "not executable from this VM." Registration and the submission form do
  need you; the build does not, and it is the only window open for code
  today, so it is being built now.

## ETHOnline entry (decided 2 Sep, from the demand list)

A paid API agents call over x402: text-based bank statement PDFs to
arithmetic-verified CSV, priced per page in USDC. Targets Hedera's x402 track
($2k x 3), Bazantic's "Agentify a new API" ($1k), and Arc's agentic track
($1,667), and keeps earning after the event. Design in `x402-api/DESIGN.md`;
triage of the whole list in `research/demand-list-triage.md`. No code before
Sep 4 (ETHGlobal rule). Extra user step: create a bazantic.com account and
share the username.

## Built so far

- `creditpassport/contracts`: 30 passing Foundry tests, deploy scripts.
- `creditpassport/agent`: type-checks, unit tests pass, verified live against
  Creditcoin testnet chain info (Sepolia attested ~36 blocks behind head).
- `keeperhub/2240-state-threshold-trigger-design.md`: ready to post.

## Schedule

| Dates | Work |
| --- | --- |
| Sep 2-5 | Build CreditPassport for BUIDL CTC (contracts, agent, frontend, docs). Write the #2240 design proposal for KeeperHub maintainers. Read-only prep for ETHOnline targets (no code before Sep 4: ETHGlobal disqualifies pre-built work). |
| Sep 4-16 | ETHOnline: Uniswap and Hedera Harness contributions, small frequent commits inside the window. |
| Sep 6-18 | KeeperHub #2240 implementation, tests, PR to `staging`. |
| Sep 13 | BUIDL CTC submission deadline. |
| Sep 16 | ETHOnline submission deadline. |
| Sep 18 | KeeperHub submission deadline. Finalist calls Sep 18-25. |
| Sep 18+ | Re-target builds at Arbitrum / 3rd-Web-Hack; KeeperHub main track if account exists. |

## What only you can do

Ordered by urgency. Each is a few minutes.

1. Eligibility. Confirm you are 18+, not resident in or located in a sanctioned
   jurisdiction, and (for BUIDL CTC) have no criminal record or pending case.
   If any of these fail, tell me which events to drop.
2. A payout wallet address you control, EVM-compatible, for stablecoin/USDC
   payouts. Address only. Never the seed phrase or private key.
3. A fresh testnet-only deployer key. Generate a new key (`cast wallet new`,
   or any wallet), never one holding real funds. Add its private key as the
   Cloud Agent secret `TESTNET_DEPLOYER_PRIVATE_KEY` (Cursor Dashboard, Cloud
   Agents, Secrets). Then fund its address:
   - Creditcoin CC3 testnet: join the [Creditcoin Discord](https://discord.gg/creditcoin),
     channel `token-faucet`, run `/faucet address:0xYourDeployer`. 100 tCTC per 24h.
     Do this on two consecutive days if possible; testnet proof submissions are
     gas-heavy.
   - Sepolia ETH: [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
     or any Sepolia faucet, ~0.5 ETH is plenty.
   Optional: `SEPOLIA_RPC_URL` (Infura/Alchemy key) as a secret; public RPCs
   work but rate-limit.
4. Registrations:
   - [DoraHacks](https://dorahacks.io): register for BUIDL CTC 2026 Fall and
     KeeperHub Agent Economy. Submission forms need your name, email, country
     of residence and citizenship, and an X or Discord handle.
   - [ETHGlobal](https://ethglobal.com/events/ethonline2026): apply as a hacker
     for ETHOnline. Approval requires staking 0.01 ETH, refunded when you submit.
   - [Devpost](https://3rd-web-hack.devpost.com/): register for 3rd-Web-Hack.
5. GitHub. Fork [keeperhub/keeperhub](https://github.com/keeperhub/keeperhub)
   and, if you want me to push the branch and open the PR directly, add a
   fine-grained personal access token scoped to that fork (Contents: write,
   Pull requests: write) as the secret `GITHUB_FORK_TOKEN`. Otherwise I hand
   you a patch and you push it.
6. Post the #2240 design proposal (I will write it in `keeperhub/`) as a
   comment on the issue so maintainers can agree before code lands.
7. Make this repository public before any submission links to it, or create a
   separate public repo per submission and tell me the names.
8. Demo videos: I record the screen; you upload to YouTube or Loom and paste
   the link in the submission form. If a track wants narration, I write the
   script.

## Rules I am respecting

- ETHGlobal: no project code before Sep 4, small frequent commits during the
  event, disclose any pre-existing libraries. Their stated penalty for
  undisclosed prior work is disqualification and a permanent ban.
- KeeperHub: build phase Sep 6-18; PRs reference an `accepted` issue, target
  `staging`, conventional-commit titles, `pnpm check` and `pnpm type-check`
  clean, tests included.
- BUIDL CTC: original work created during the hackathon (window opened Aug 13),
  deployed on testnet, Attestcoin Protocol as a core feature, README + deck +
  demo video.
- Bug bounties: only in-scope programs, only static analysis and local forks,
  responsible disclosure, never test against mainnet.
- Be truthful in every form. If a form asks about AI assistance, say yes.

## CreditPassport (BUIDL CTC entry)

Working title. A portable, verifiable credit history on Creditcoin built from
payments that provably happened on another chain.

- Source chain (Sepolia): a `PaymentRail` contract settles invoices in a test
  stablecoin and emits `InvoicePaid(invoiceId, payer, payee, amount, dueBlock,
  paidBlock)`.
- Creditcoin CC3 testnet: `CreditPassport` inherits Attestcoin's `ASCBase`. It
  accepts inclusion proofs, decodes the receipt with `EvmV1Decoder`, checks
  the log came from the registered rail, and records on-time vs late payments
  per payer. Adds an `executeBatch` path over the verifier precompile's batch
  method so a payer can import up to 10 payments in one transaction.
- Underwriting agent (TypeScript): watches Sepolia, waits for attestation,
  fetches proofs from the hosted prover, submits them, computes a score from
  verified history only, writes an underwriting memo (LLM-generated when a key
  is present, templated otherwise), and calls `underwrite`. The contract caps
  the credit limit as a function of verified volume and on-time ratio, so the
  agent's discretion is bounded by proven data.
- Credit line: users draw a CC3 test stablecoin against their limit and repay.
- Frontend (Next.js): passport view, verified payment list with proof links,
  score, limit, agent memo, attestation status from the ChainInfo precompile.

Tracks: AI (agent acts on cryptographically verified cross-chain data with no
oracle operator) with DeFi as the fallback.

Lives in `creditpassport/`.
