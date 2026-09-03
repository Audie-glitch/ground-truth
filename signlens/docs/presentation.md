# SignLens: know what you are signing

3rd-Web-Hack 2026 submission

## Problem

Wallet prompts show a function name and hex. Approval and signature phishing
lives in that gap: drainers ask for `approve`, `setApprovalForAll`, Permit2
grants, zero-price marketplace listings, or `eth_sign`, and the address that
receives the power is never evaluated in front of the user. The loss is
irreversible at the moment of signing. Chainalysis and ScamSniffer have
tracked hundreds of millions of dollars lost to signature phishing per year.

## Solution

Paste the exact request the site sent to the wallet. SignLens decodes it,
looks up the counterparty on-chain, applies explicit rules, and answers in one
sentence: what it lets whom do to your assets, for how long. Then it explains
every finding in plain language.

## Technology

- Next.js and TypeScript; `viem` for ABI and typed-data decoding.
- Deterministic rule engine with 23 offline tests over fixtures for each
  request shape: transactions, batches, EIP-2612 permits, Permit2 single,
  batch and transfer-from permits, Seaport orders, unknown typed data, SIWE,
  hash-shaped `personal_sign`, `eth_sign`.
- On-chain enrichment: `eth_getCode` to tell contracts from wallets, ERC-165 to
  tell NFTs from tokens, ERC-20 metadata for readable amounts, Sourcify for
  source verification. All keyless public infrastructure; degrades gracefully.

## Innovation

- Works before connecting a wallet, on the request itself.
- Puts the counterparty's on-chain status (codeless wallet, unverified
  contract, known protocol) next to the permission, which is exactly the
  fact wallets omit and drainers exploit.
- Recognises the newer drain vectors: Permit2 batch signatures, one-time
  `PermitTransferFrom` pulls, Permit2-shaped messages from impostor
  contracts, zero-consideration Seaport orders, EIP-5792 batches that hide an
  approval among benign calls.
- Every verdict is explained, so the tool teaches the pattern rather than
  just blocking it.

## Impact

Any user can check a suspicious prompt in ten seconds without installing an
extension or connecting a wallet. Support teams and communities can paste a
victim's pending request and see the drain before it executes. The engine is a
library with a stable `Report` shape, so wallets, browser extensions and
Discord bots can embed it.

## Demo

`npm run dev`, then open `/?example=drainer-approve`. Live examples cover an
unlimited USDC approval to a wallet address, a Permit2 batch to an unknown
spender, `setApprovalForAll`, a zero-price Seaport listing, `eth_sign`, a
legitimate bounded approval to Permit2, and a Sign-In with Ethereum message.
