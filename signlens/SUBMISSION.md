# 3rd-Web-Hack submission: SignLens

Event: https://3rd-web-hack.devpost.com/ · Deadline: **Sep 27, 2026, 12:30 IST**
(07:00 UTC). Prizes: $500 / $200 / $50 in USDT.

Rules checked 3 Sep 2026: original project developed for the hackathon (SignLens
was started 3 Sep 2026 for this event and shares no code with other entries),
addresses a real Web3 problem, meaningful use of Web3 technology, working MVP,
GitHub repository with setup instructions, short demo video or live demo, brief
presentation covering problem, solution, technology, innovation, impact.

## Agent does

- [x] Working MVP with tests (`npm test`), README with setup, presentation (`docs/presentation.md`)
- [ ] Demo video: 2-3 minute screen recording walking through the seven examples and one pasted real prompt
- [ ] Hosted demo (optional, strengthens "live demonstration"): deploy to Vercel or any Node host; no env vars required

## You do

1. Register on Devpost and join the hackathon from the event page.
2. Make the repository public (or create a public `signlens` repository and tell me; I push the tree).
3. Upload the demo video (YouTube unlisted or Loom) and paste the URL.
4. Submit with the answers below.

## Form answers

**Project name:** SignLens

**Tagline:** Paste what a dApp asks your wallet to sign; get a plain-English verdict on what it lets whom do to your assets.

**Inspiration:** Signature phishing works because wallet prompts show a function name and hex, and never evaluate the address receiving the power.

**What it does:** Parses any wallet request (transactions, EIP-712 typed data, personal_sign, eth_sign, EIP-5792 batches, raw calldata), decodes approvals, transfers, permits, Permit2 grants and pulls, Seaport orders and phishing-kit selectors, checks the counterparty on-chain (contract or wallet, Sourcify verification, token standard and metadata), and returns one sentence plus explained findings ranked by severity.

**How we built it:** Next.js, TypeScript, viem for ABI/typed-data decoding, a deterministic rule engine with 23 offline tests, keyless public RPCs and Sourcify for enrichment.

**Challenges:** Shared selectors (ERC-20 and ERC-721 `approve` are the same 4 bytes) resolved with ERC-165 lookups; telling hash-shaped `personal_sign` payloads from real text; keeping explanations honest about what the tool cannot know.

**Accomplishments:** Every drain vector in the examples is caught with the right reason, including the ones wallets miss: codeless spenders, Permit2 batches, zero-consideration listings.

**What we learned:** The single most useful fact for a user is whether the counterparty is a contract at all, and no wallet shows it.

**What's next:** Browser extension that intercepts the prompt automatically, wallet integrations via the `Report` API, larger known-contract registry, transaction simulation for unknown functions.

**Built with:** Next.js, TypeScript, viem, Tailwind, shadcn/ui, Vitest, Sourcify, publicnode RPC.

**Links:** repository URL, demo video URL, hosted demo URL (if deployed).

**Prize payout:** USDT; give the organizers an address you control on the network they specify.
