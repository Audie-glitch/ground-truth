# ETHOnline 2026 official prizes (readable)

**Fetched:** 22:56 UTC 2 September 2026 from [ethglobal.com/events/ethonline2026/prizes](https://ethglobal.com/events/ethonline2026/prizes) (HTTP 200). The event landing page still returned HTTP 500 from this VM. Event window: **4–16 September 2026**, async / remote.

This is **not** a submission and **not** an acquired asset. Official Start Fresh rules say project-specific prior code does not qualify, so this repo must not grow an ETHOnline project before 4 Sep.

## Partner totals on the official prize page

| Sponsor | Listed total | Official slug |
| --- | ---: | --- |
| The Graph | $15,000 | `/prizes/the-graph` |
| Hedera | $15,000 | `/prizes/hedera` |
| Arc | $10,000 | `/prizes/arc` |
| World | $7,000 | `/prizes/world` |
| 1inch | $7,000 | `/prizes/1inch` |
| ENS | $5,000 | `/prizes/ens` |
| Uniswap Foundation | $5,000 | `/prizes/uniswap-foundation` |
| Ledger | $5,000 | `/prizes/ledger` |
| Privy | $5,000 | `/prizes/privy` |
| Bazantic | $3,000 | `/prizes/bazantic` |
| Chainlink | $2,500 | `/prizes/chainlink` |

## Tracks that match this agent if accounts exist

### Hedera — AI & Agentic Payments ($6,000; up to 3 × $2,000)

Official requirement: host a live **x402-gated service on Hedera** testnet or mainnet, settled through the [Blocky402 facilitator](https://blocky402.com/), plus a platform/agent that completes at least one real paid request. Public GitHub repo and a demo video ≤ 5 minutes. Starter links on the official page include [hedera-dev/x402-inference-pay-per-request-poc](https://github.com/hedera-dev/x402-inference-pay-per-request-poc) and [hashgraph/hedera-agent-kit-js](https://github.com/hashgraph/hedera-agent-kit-js).

### Hedera — Open Source / Hedera Harness ($2,000; up to 2 × $1,000)

Contribution to [hedera-dev/hedera-harness](https://github.com/hedera-dev/hedera-harness) (open PR is enough) or a new harness that extends it. Still needs the participant’s GitHub and an ETHGlobal submission. Only work done during the event is judged.

### The Graph — Best AI Tooling or AI Use Case ($5,000 Start Fresh + $5,000 Continuity)

Live Graph data required (Subgraph Studio API key or The Graph Market). Mocked/local-only data does not qualify. **Start Fresh:** project begun during the hackathon; project-specific prior code is out. Continuity is for extending an existing open-source repo. Public repo + 2–4 minute demo.

### Arc — agentic USDC ($10,000 across DeFi / agent / payments tracks)

Official copy asks for agents that hold wallets, make USDC payments, or settle jobs using Arc + Circle Agent Stack. That path needs a funded/signable wallet this VM does not have.

### 1inch — Build an Aqua App ($5,000; $2,500 / $1,500 / $1,000)

Official page (HTTP 200, 3 Sep): custom Aqua app for a sophisticated
DeFi position. SwapVM use is scored higher; modified SwapVM redeploys
are allowed; official Aqua must stay the registry. On-chain token
transfers (local forks ok). No single-commit dump on the last day.
Continuity $2,000 is a **separate** prize.

Picked Start Fresh app: **AquaFloor** — a reserved-inventory book.
Makers ship a pair plus a hard floor; a new SwapVM opcode
`ReserveFloor` (`Opcode._27`) rejects fills that would pull below it.
Also wire existing `TWAPSwap` (`0x9d`), which AquaOpcodes currently
omits. Design: [`../aqua-app/DESIGN.md`](../aqua-app/DESIGN.md).
File-level note: [`ethonline-aqua-app.md`](ethonline-aqua-app.md).
No Aqua / SwapVM product code before 4 Sep 16:00 UTC.

### Uniswap Foundation — Best Uniswap Stack Contribution ($3,000; up to 3 × $1,000)

Official page (HTTP 200, 3 Sep): build on or improve any Uniswap stack piece (API, AMM v2/v3/v4, CCA, official repos, v4 hooks, ecosystem tooling). Qualification: public GitHub repo, `FEEDBACK.md`, and the [Uniswap Developer Feedback Form](https://developers.uniswap.org/hackathon-feedback) linking that file. README must point at the changed files. A separate $2,000 prize is Continuity-track only.

Picked backup: [Uniswap/sdks#720](https://github.com/Uniswap/sdks/issues/720) — `uniswapx-sdk` DCA intent EIP-712 hashing does not match deployed `DCALib.sol` on four axes (struct shape, type-string order, `string` encoding, array packing). File-level plan: [`ethonline-uniswap-sdks-720.md`](ethonline-uniswap-sdks-720.md). No SDK code before 4 Sep 16:00 UTC.

## Still blocked here

- No ETHGlobal login in this VM.
- `gh` is not authenticated; this new-project repo is not a public GitHub submission target until the participant creates one.
- No agent wallet, so Arc/USDC payment tracks and any mainnet x402 settlement that needs gas are blocked.
- Do not pre-build a Start Fresh project in this tree.
