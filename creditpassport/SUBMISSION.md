# BUIDL CTC 2026 Fall submission: CreditPassport

Everything needed to deploy, record, and submit. Steps marked **you** need a
human account or identity; everything else is scripted here.

Deadline: **September 13, 2026, 23:59 ET**. Event page:
https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail

## 1. Deploy to testnets (agent does this once the deployer is funded)

Prerequisite (**you**): testnet gas for the deployer. Two ways, either works:

- **Fund the deployer I generated.** A testnet-only key lives outside the
  repository on the agent VM; its address is in the chat. Send it Sepolia ETH
  (any faucet; the [Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
  gives 0.05 per day, deployment costs ~0.002) and test CTC (Creditcoin
  Discord, channel `token-faucet`, `/faucet address:0x…`, 100 per 24h). Never
  send real assets to it. `scripts/wait-for-funds.sh` is polling both balances
  and runs the deployment the minute both arrive.
- **Or use your own key.** Generate a fresh testnet-only key, store it as the
  Cloud Agent secret `TESTNET_DEPLOYER_PRIVATE_KEY`, fund it the same way, and
  tell me; I run `scripts/deploy-testnet.sh` with it.

Budget: deployment is ~0.002 Sepolia ETH and ~0.005 tCTC; each proof
submission on Creditcoin costs more than an ordinary transaction, so 0.05
Sepolia ETH and one faucet round (100 tCTC) cover the whole demo.

```bash
cd creditpassport
scripts/deploy-testnet.sh        # Sepolia rail + token, then CC3 passport; idempotent per side; exports ABIs
git add contracts/deployments && git commit -m "Record testnet deployment addresses"
```

`contracts/foundry.toml` pins `evm_version = "london"`: Creditcoin's RPC omits
`mixHash`, and forge's post-Merge fork simulation rejects such headers.

Then the live loop, which is also the demo recording:

```bash
cd ../agent && cp .env.example .env            # AGENT_PRIVATE_KEY = the same key
npm run cli -- chains                           # Creditcoin attests Sepolia; shows the lag
npm run cli -- pay --payee 0x<merchant> --amount 250          # on time
npm run cli -- pay --payee 0x<merchant> --amount 90 --late    # late
npm run agent                                   # scans, waits ~7 min for attestation, proves, submits, underwrites
npm run cli -- import 0x<any active Sepolia address>   # passport from real USDC transfers, batch-proved
npm run cli -- profile 0x<payer>                # verified history, score, limit, memo
cd ../web && npm run dev                        # http://127.0.0.1:43331/passport/0x<payer>
```

After deployment I update README.md and the deck's status slide with the
contract addresses and explorer links, re-render `docs/deck.pdf`, and commit.

Independent of deployment, judges can exercise the contract against the live
verifier themselves at `/verify` in the web app (or `npm run cli -- livecheck`):
paste any Sepolia transaction, and a throwaway passport verifies, decodes and
records it inside one `eth_call`. Mention this in the description if the hosted
web app is reachable at submission time; otherwise the video shows it.

## 2. Repository (you)

The entry is judged at repository level, so it should stand alone. A standalone
branch with this directory as its root and full history is already pushed:
`cursor/creditpassport-standalone-4667` (submodule config included; a fresh
`git clone --recurse-submodules` of it builds and passes all tests).

1. Create an empty public GitHub repository, e.g. `creditpassport`.
2. From any clone of this repository:
   `git push https://github.com/<you>/creditpassport.git cursor/creditpassport-standalone-4667:main`
3. Use that repository's URL in the form. Its README is at the root.

Alternatively make this whole repository public and submit the subdirectory
URL; the standalone repository is cleaner for judges.
- The deck URL for the form is the raw link to `docs/deck.pdf` in the
  standalone repository, for example
  `https://raw.githubusercontent.com/<you>/creditpassport/main/docs/deck.pdf`.

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

> Verification: `AttestedBase` (modeled on `ASCBase` from `@gluwa/asc-contracts`) calls the Native Query Verifier precompile at 0xFD2 through `INativeQueryVerifier.verifyAndEmit`, keeps ASCBase's query-id derivation via `calculateTxIndex` for replay protection, adds source-chain binding, and adds `executeBatch` over the precompile's batch overload so up to ten payments sharing one continuity proof are imported in a single transaction. Decoding: `EvmV1Decoder.decodeReceiptFields` and `getLogsByEventSignature` extract receipt status and `InvoicePaid` logs from the prover's transaction bytes; the decoder is tested against genuine prover output captured from the CC3 testnet prover for a live Sepolia transaction. Off-chain: the agent uses `@gluwa/usc-sdk` (`ProofBuilder.getProof`/`getBatchProof`, `waitUntilHeightAttested`, `PrecompileChainInfoProvider` for attestation lag, `PrecompileBlockProver.verifySingle` as a gas-free pre-flight). The web app reads the ChainInfo precompile to show live attestation lag. Before deployment the whole contract path was executed against the live CC3 verifier precompile through `eth_call` (`LivePrecompileCheck`): a real Sepolia ERC-20 transfer was verified, decoded and recorded on a passport that existed only for the duration of the call. Source chain: Ethereum Sepolia (chain key 1); execution chain: Creditcoin CC3 testnet (102031).

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

- [ ] Deployer funded (Sepolia ETH, test CTC): the generated address from the chat, or your own key as `TESTNET_DEPLOYER_PRIVATE_KEY`
- [ ] Deployed to Sepolia and CC3 testnet; addresses committed
- [ ] Live proof loop run at least twice (one on-time, one late payment)
- [ ] README and deck updated with addresses; deck re-rendered
- [ ] Demo video recorded and uploaded
- [ ] Repository public
- [ ] DoraHacks account, event registration, BUIDL created with the answers above
- [ ] Payout asset and network confirmed in Discord
