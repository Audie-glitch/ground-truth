# What this environment can actually do

**Probed:** 2 September 2026, this Cloud Agent VM.  
**Constraint:** identify any legitimate path to acquire crypto **without soliciting or receiving user funds.**

This is the inventory of what *this session* can execute. It is not a trading plan.

## Environment facts

| Check | Result | Evidence |
| --- | --- | --- |
| Project type | Research notes only. No trading bot, no custody service | Workspace listing; `git` history |
| Wallet / exchange secrets | **None.** `PHANTOM`, `SOLANA`, `WALLET`, `PRIVATE_KEY`, `MNEMONIC`, `HELIUS`, `ALCHEMY`, `INFURA`, `FAUCET` env vars are unset | Shell `env` filter, 2 Sep 2026 |
| Linked Cursor environment / secrets store | None | `cursor-cloud` `environment-info`: `environment: null`, `build: null` |
| Network egress | Unrestricted | Same tool: `egress.restricted: false` |
| Phantom MCP | Server reports `ready`. Tools exist for status, addresses, balances, swaps, transfers, Hyperliquid perps | Tool catalog |
| Phantom session | **Auth yes, wallet no.** Device code `PRs7Fxb4` was approved; tokens and userinfo `organization_id` exist. KMS `getOrCreateWalletWithTag` returns `whitelist-disabled` for DCR app `4da950ac-…`. No `session.json`, no addresses | [`phantom-wallet-blocker-2026-09.md`](phantom-wallet-blocker-2026-09.md), 2 Sep 2026 20:35 UTC |
| User message queue | Empty | `get-message-queue` |
| Ability to receive user funds | **Refused and technically unsupported.** No address we control; no secret store; no custody role | Policy + missing keys |

## Paths this VM can and cannot execute

| Path | Executable here now? | Why |
| --- | --- | --- |
| Take user deposits and “grow” them | **No** | No agent address to receive into. Will not generate a hot key on this VM. A Phantom *agent* wallet funded from the user's MetaMask is the official path once KMS is unblocked. |
| Swap / transfer / perps via Phantom | **No** | Login tokens exist, but KMS will not issue a wallet for the DCR app (`whitelist-disabled`). MCP tools still time out (`-32001`). |
| Buy on a regulated exchange | **No** | Needs the user’s KYC identity and fiat. Not available to this agent. |
| Claim mainnet faucets / airdrops | **No** | Need a funded address the claimant controls. We have neither. |
| Official Solana **devnet** `requestAirdrop` | Technically yes, to *any* pubkey | [Solana `requestAirdrop`](https://solana.com/docs/rpc/http/requestairdrop) is public. **Not done.** Devnet SOL has no market value. Generating a keypair on this ephemeral VM would be bad custody, not an asset. |
| Coinbase Developer Platform faucets | **No** | Needs a CDP project key we do not have. Testnet only anyway. |
| Learn-and-earn on Coinbase/etc. | **No** | Needs an exchange account in a person’s name. |
| Staking / lending yield | **No** | Requires assets already held. |
| KeeperHub feature bounty (stablecoins, Sep 6–18) | **Not yet; eligible to prepare** | Live listing verified 2 Sep 2026. Build window has not opened. Issue [#2208](https://github.com/keeperhub/keeperhub/issues/2208) is `accepted`/`confirmed` and already referenced by PR #2215 — do not duplicate. Candidate queue lives in [crypto-earning-opportunities-2026-09.md](crypto-earning-opportunities-2026-09.md). |
| BUIDL CTC 2026 Fall ($15k, due Sep 13 ET) | Possible as a build; payout form unverified | Live listing verified. Requires Attestcoin testnet integration, deck, video. Prize currency is not stated as crypto. |
| Immunefi / Ethereum Foundation bounties | Possible only with a real, in-scope finding | Immunefi explorer: “Showing all 183 bounty programs,” metrics updated 2 Sep 2026 16:01 UTC. Ethereum.org program pays up to $1M and asks for an ETH address after identity checks. Not a “quick” path. |

## Legitimate no-fund conclusion

There is **no path in this VM that produces mainnet crypto assets today**. A Phantom agent wallet cannot be created while KMS returns `whitelist-disabled`. Generating a hot key here and asking for a deposit is refused. Paid engineering later, or the user buying on an exchange they control, remain the legal no-agent-wallet routes.

The only legitimate no-capital routes that remain open:

1. **Paid engineering in the user’s name** — KeeperHub stablecoin bounty after Sep 6, or another verified contest. Payout goes to **their** wallet. This agent can help write code; it cannot be the payee.
2. **The user buys on a licensed exchange they control.** Recurring buys from surplus income are the long-horizon plan in [gaining-crypto-assets.md](gaining-crypto-assets.md). This agent cannot open the account or take the deposit.
3. **Testnet tokens** — useful for building, worthless as assets. Not a substitute for gaining crypto.

Anything that looks faster than those three is either a bet with capital we do not have, or a scam.

## Sources

- Solana `requestAirdrop` (devnet/testnet only): https://solana.com/docs/rpc/http/requestairdrop
- KeeperHub Agent Economy hackathon (live 2 Sep 2026): https://dorahacks.io/hackathon/agent-economy/detail
- BUIDL CTC 2026 Fall (live 2 Sep 2026): https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail
- Immunefi bounty explorer (“Showing all 183 bounty programs,” 2 Sep 2026): https://immunefi.com/bug-bounty/
- Ethereum Foundation bug bounty: https://ethereum.org/bug-bounty/
- KeeperHub issue #2208 (accepted; PR #2215 exists): https://github.com/keeperhub/keeperhub/issues/2208
- Additional claimed issues (do not duplicate): #2211→PR #2217, #2206→PR #2213, #2230→PR #2228, #2196→PR #2197 (GitHub timeline, 2 Sep 2026)
- Phantom KMS blocker after successful device login: [phantom-wallet-blocker-2026-09.md](phantom-wallet-blocker-2026-09.md)
