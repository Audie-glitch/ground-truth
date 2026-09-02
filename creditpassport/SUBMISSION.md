# BUIDL CTC 2026 Fall submission: CreditPassport

Everything needed to deploy, record, and submit. Steps marked **you** need a
human account or identity; everything else is scripted here.

Deadline: **September 13, 2026, 23:59 ET**. Event page:
https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail

## 1. Deploy to testnets (agent does this once the key exists)

Prerequisite (**you**): a fresh testnet-only key stored as the Cloud Agent
secret `TESTNET_DEPLOYER_PRIVATE_KEY`, funded with ~0.3 Sepolia ETH and
100+ test CTC (Creditcoin Discord, `token-faucet`, `/faucet address:0x…`,
100 per 24h; two days of faucet is comfortable, proof submissions cost more gas
than ordinary transactions).

```bash
cd creditpassport/contracts
export SEPOLIA_RPC_URL=${SEPOLIA_RPC_URL:-https://ethereum-sepolia-rpc.publicnode.com}
export CREDITCOIN_RPC_URL=https://rpc.cc3-testnet.creditcoin.network
forge script script/DeploySource.s.sol   --rpc-url sepolia            --private-key $TESTNET_DEPLOYER_PRIVATE_KEY --broadcast
forge script script/DeployPassport.s.sol --rpc-url creditcoin_testnet --private-key $TESTNET_DEPLOYER_PRIVATE_KEY --broadcast
node scripts/export-abi.mjs
git add deployments && git commit -m "Record testnet deployment addresses"
```

Then the live loop, which is also the demo recording:

```bash
cd ../agent && cp .env.example .env            # AGENT_PRIVATE_KEY = the same key
npm run cli -- chains                           # Creditcoin attests Sepolia; shows the lag
npm run cli -- pay --payee 0x<merchant> --amount 250          # on time
npm run cli -- pay --payee 0x<merchant> --amount 90 --late    # late
npm run agent                                   # scans, waits ~7 min for attestation, proves, submits, underwrites
npm run cli -- profile 0x<payer>                # verified history, score, limit, memo
cd ../web && npm run dev                        # http://127.0.0.1:43331/passport/0x<payer>
```

After deployment I update README.md and the deck's status slide with the
contract addresses and explorer links, re-render `docs/deck.pdf`, and commit.

## 2. Repository (you)

- Make this repository public, or create a public repository named
  `creditpassport` and tell me; I will push the `creditpassport/` tree there
  with history. The submission form needs a public GitHub URL with a README.
- The deck URL for the form is the raw link to `creditpassport/docs/deck.pdf`
  on the default branch, for example
  `https://raw.githubusercontent.com/<owner>/<repo>/main/creditpassport/docs/deck.pdf`.

## 3. Demo video (agent records, you upload)

I record a 3-4 minute screen capture: `verify` against a live Sepolia
transaction, a payment on Sepolia, the agent proving and submitting it, the
passport page updating, the underwriting memo, a draw. No narration unless you
want to add one; a script is in `docs/demo-script.md` after deployment.
**You** upload it (YouTube unlisted or Loom) and paste the URL into the form.

## 4. Register and submit (you)

1. Create or log in to a DoraHacks account: https://dorahacks.io
2. Register for BUIDL CTC 2026 Fall from the event page.
3. Join the Creditcoin Discord (https://discord.gg/Gu43zTfmtc) and ask in
   `#buidl-ctc-qna` which asset winners are paid in and on which network, so
   the payout address you give is right. Their page states USD amounts only.
4. Create a BUIDL and fill the form with the answers below.

### Form answers

**Project Name:** CreditPassport

**Project Logo:** optional; skip or use `docs/logo.png` if I add one.

**Project Sector:** AI (fallback: DeFi)

**Project Description:**

> CreditPassport is a portable credit history on Creditcoin built only from payments that provably happened on another chain. A payer settles invoices through a PaymentRail contract on Ethereum Sepolia. Anyone submits Attestcoin inclusion proofs of those transactions to the CreditPassport contract on Creditcoin, which verifies them through the native verifier precompile, decodes the receipts, keeps only logs emitted by the registered rail, and records each payment as on-time or late. An underwriting agent reads that verified history, computes a deterministic score, writes a memo, and extends a credit line; the contract computes the maximum limit itself from verified volume and on-time ratio and rejects anything above it, so the agent can be conservative but never generous beyond the proof. Payers draw a test stablecoin against the limit on Creditcoin and repay. There is no oracle operator: the trust roots are Creditcoin's attestation of the source chain and the registration of which source contracts count.

**Attestcoin Protocol Integration Summary:**

> Verification: `AttestedBase` (modeled on `ASCBase` from `@gluwa/asc-contracts`) calls the Native Query Verifier precompile at 0xFD2 through `INativeQueryVerifier.verifyAndEmit`, keeps ASCBase's query-id derivation via `calculateTxIndex` for replay protection, adds source-chain binding, and adds `executeBatch` over the precompile's batch overload so up to ten payments sharing one continuity proof are imported in a single transaction. Decoding: `EvmV1Decoder.decodeReceiptFields` and `getLogsByEventSignature` extract receipt status and `InvoicePaid` logs from the prover's transaction bytes; the decoder is tested against genuine prover output captured from the CC3 testnet prover for a live Sepolia transaction. Off-chain: the agent uses `@gluwa/usc-sdk` (`ProofBuilder.getProof`/`getBatchProof`, `waitUntilHeightAttested`, `PrecompileChainInfoProvider` for attestation lag, `PrecompileBlockProver.verifySingle` as a gas-free pre-flight). The web app reads the ChainInfo precompile to show live attestation lag. Source chain: Ethereum Sepolia (chain key 1); execution chain: Creditcoin CC3 testnet (102031).

**GitHub Repository URL:** `<public repo URL>` (README at `creditpassport/README.md`, or repo root if split out)

**Project Deck or Whitepaper (PDF URL):** raw URL of `creditpassport/docs/deck.pdf`

**Prototype Demo Video URL:** `<your upload>`

**Team Information:** your legal first and last name, email, country of
residence, country of citizenship, short bio, role ("solo builder;
architecture, contracts, agent, web"). Telegram, X, LinkedIn, resume are
optional. If the form or judges ask about AI assistance, say the code was
written with an AI coding agent under your direction; that is true and the
event is an agent-themed track.

**Eligibility attestations:** no criminal record or pending case, not a
resident of a sanctioned country, not a sanctioned individual, legally
permitted to participate.

## 5. After submitting

- Winners announced September 20, 2026. Top three also enter the CEIP
  fast-track and get CertiK audit credits.
- If you win, the organizers will ask for a payout address. Give an address
  you control on the network they name. Never a seed phrase.
- Tell me the result either way; the payout landing in your wallet is the
  goal's completion evidence.

## Checklist

- [ ] `TESTNET_DEPLOYER_PRIVATE_KEY` secret set and funded (Sepolia ETH, test CTC)
- [ ] Deployed to Sepolia and CC3 testnet; addresses committed
- [ ] Live proof loop run at least twice (one on-time, one late payment)
- [ ] README and deck updated with addresses; deck re-rendered
- [ ] Demo video recorded and uploaded
- [ ] Repository public
- [ ] DoraHacks account, event registration, BUIDL created with the answers above
- [ ] Payout asset and network confirmed in Discord
