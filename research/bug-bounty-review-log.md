# Bug bounty review log

Time-boxed static reviews of in-scope code, done only on local clones. No
mainnet interaction, no testing against live contracts. Findings, if any, are
handed to the user to submit through the program; the user needs an Immunefi
account (some programs also require KYC).

## How targets are picked

The unofficial Immunefi mirror publishes every program's scope with timestamps:
`https://raw.githubusercontent.com/infosec-us-team/Immunefi-Bug-Bounty-Programs-Unofficial/main/projects.json`.
Filtering on 3 Sep 2026 for programs with GitHub-hosted smart-contract scope
and assets added in the last 90 days gave the shortlist below. Newer code has
had less review time, which is the only edge a few hours of reading can have
against protocols that already pay for audits.

| Program | Launched | Max bounty | KYC | Notes |
| --- | --- | --- | --- | --- |
| audit-comp-firelight-1 | 12 Aug 2026 | $20,000 pool | no | Audit competition, submissions closed 25 Aug; in evaluation until 30 Sep. Out. |
| enzyme-onyx | Sep 2025 | $200,000 | no | Scope expanded 30 Jul 2026 with Chainlink ACE compliance integration. Reviewed below. |
| gmtrade | Jul 2026 | $100,000 | no | Solana perps (Rust). Candidate for a later session. |
| 1inch-aqua | Jun 2026 | $100,000 | yes | New 1inch liquidity system + swap-vm. Also the subject of an ETHOnline bounty. Candidate for a later session. |
| sbtc | Jul 2026 | $250,000 | yes | Rust/Clarity. Candidate. |
| horizen | Jul 2026 | $10,000 | yes | Small. |

## 2026-09-03: Enzyme Onyx (commit 7b48d24, ACE integration scope)

Files read in full or in their money-moving paths: `src/shares/Shares.sol`,
`deposit-handlers/ERC7540LikeDepositQueue.sol`, `redeem-handlers/ERC7540LikeRedeemQueue.sol`,
`deposit-handlers/SyncDepositHandler.sol` (deposit path), `fees/FeeHandler.sol`
(entrance/exit settlement, claims, dynamic fees), `shares-transfer-validators/*`,
`infra/chainlink-ace/ChainlinkAcePolicyProtectedBase.sol`,
`issuance/hooks/chainlink-ace/ChainlinkAceIssuanceValidatorBase.sol` and one
concrete hook.

Checked for: access control on mint/burn/withdraw and on hook and validator
configuration; request lifecycle (double execution, non-existent ids,
cancel/execute races); fee accounting consistency between value-owed
tracking and share burns/mints; rounding direction; reentrancy on mint-then-pull
ordering; transfer-validator bypass paths; extractor/payload consistency for the
ACE policy engine; handler binding on validators.

Result: no exploitable finding.

- Request ids are deleted before transfers; non-existent or already-processed
  ids revert on zero shares/assets, so batches cannot double-pay.
- Fees are tracked as value owed rather than shares, so burning gross shares
  on exit and minting net shares on entry are consistent.
- `authTransfer`/`authTransferFrom`/`mintFor`/`burnFor` bypass the transfer
  validator by documented design; ACE hooks on the handlers cover issuance.
- ACE validators are thin wrappers over Chainlink's audited
  `PolicyProtectedBaseUpgradeable`, bound to a single handler or to Shares.
- One griefing angle: a controller can cancel a request between an admin's
  `executeDepositRequests`/`executeRedeemRequests` submission and inclusion,
  reverting the whole batch. It is bounded by `minRequestDuration` and by
  batch sizing, and the program's rules put admin-side DoS avoidance and
  configuration out of scope. Not submitted.
- Stale-NAV arbitrage on synchronous deposits is inherent to admin-reported
  pricing and documented (subscription rounds). Out of scope.

Time spent: roughly 90 minutes. Two ChainSecurity audits cover this scope,
which matches the outcome.

## 2026-09-03: GMTrade builder-fee path (gmx-solana `50c4d8d`)

Unofficial Immunefi mirror (3 Sep 2026): slug `gmtrade`, max $100,000 USDC,
`kyc: false`, `isPaused: false`, launched 6 Jul 2026. In-scope GitHub trees:
`programs/store`, `programs/treasury`, `programs/liquidity-provider`. Reviewed
only the newly activated builder-fee charge/settle/claim path in `programs/store`
(commit message: “activate builder fee charging in order execution”). No
mainnet interaction.

Files: `instructions/builder_fee.rs`, `instructions/user.rs` (`set_builder_fee_factor`),
`ops/order.rs` charge helpers, `states/order.rs` record/set, `lib.rs` error
variants for this feature.

Checked for: owner vs builder vs permissionless roles; fee factor checkpoint vs
live advertisement; store cap after a later lower; settlement routing and
double-pay; claim vault authority; increase underpayment vs decrease clamp;
liquidation/ADL attaching a fee; swap types that empty the fee bucket.

Result: no exploitable finding.

- `set_builder_fee` is owner-signed, pending-only, and requires the advertised
  factor to match `expected_factor` and the store cap (missing cap reads as 0).
- Execution uses the checkpointed factor, not the builder’s current
  advertisement. Liquidation and ADL kinds cannot take a checkpoint.
- Increase underpayment cancels the order instead of taking a partial fee.
  Decrease clamps the fee to available output.
- `settle_builder_fee` is permissionless but transfers only to the checkpointed
  builder’s ATA and zeroes `builder_fee_amount` after the CPI. A shortfall
  clamps to escrow balance so the order can still close.
- `claim_builder_fees` is owner-signed via User Account PDA seeds and rejects
  destination == claim vault so a no-op SPL self-transfer cannot fake a claim
  event.

Time spent: roughly 40 minutes on this path only. Treasury and liquidity-provider
programs were not reviewed. Not submitted.

## 2026-09-03: GMTrade treasury + LP (gmx-solana `50c4d8d`)

Same program and commit as the builder-fee pass. Reviewed money-moving paths in
`programs/treasury` and the single-file `programs/liquidity-provider`. No
mainnet interaction.

Treasury files: `lib.rs`, `instructions/{treasury,gt_bank,store,swap,config}.rs`,
`states/{gt_bank,treasury,config}.rs`. LP file: `programs/liquidity-provider/src/lib.rs`.

Checked for: role gates vs permissionless completion; authorized vs leftover
vault configs; GT-factor split and receiver-vault accounting; buyback reserve
vs later `sync_gt_bank`; pro-rata `complete_gt_exchange` insolvency/rounding;
swap in/out token flags; LP claim/unstake reward double-mint; vault dust and
fee-on-transfer; two-step authority handover.

Result: no exploitable finding.

- Withdrawals, deposits, fee claims, buyback confirm, swaps, and GT-bank sync
  are all role-gated (`TREASURY_WITHDRAWER` / `KEEPER` / `ADMIN` / `OWNER`) via
  store CPI auth. `withdraw_from_treasury_vault` may target any vault config
  tied to the same `Config` (not only the currently authorized one); that is
  how leftover vaults are recovered and is still withdrawer-gated.
- `deposit_to_treasury_vault` splits the receiver ATA with `apply_factor` then
  `checked_sub`, so GT-bank + treasury equals the pulled amount. Recorded GT
  bank balances increase only after the GT-bank CPI succeeds.
- `confirm_gt_buyback` can run once per bank. It reserves a recorded share
  (`reserve_balances`) without moving tokens; `sync_gt_bank_v2` then sends
  vault-minus-recorded excess to the treasury. Claimants later pull only the
  reserved recorded amounts.
- `complete_gt_exchange` is owner-signed and permissionless. It closes the
  exchange via store CPI first (vault must already be confirmed; ownership
  checked there), then pro-rata transfers from recorded balances. Targets must
  be owned by the signer. Last claimer with `remaining_confirmed_gt_amount`
  equal to their GT gets the leftover recorded balances; rounding dust stays
  recorded and can be synced to treasury. Missing PDA seeds on the GT bank
  account are not exploitable: only `prepare_gt_bank` can create that type.
- Swaps require swap-in deposit disabled and swap-out deposit enabled, and
  pull only from the receiver ATA. Cancel returns to the same ATAs.
- LP `claim_gt` is off by default. Unstake always mints then snapshots
  `cum_inv_cost`; when claims are disabled only a full unstake is allowed, so
  that path cannot be used as a partial-claim bypass. Full exit transfers the
  vault's actual balance (dust-safe) and closes the vault + position PDA.
  Position and vault are PDAs; destination LP ATA must be owner-owned.
- Time-weighted APY uses `stake_start_time` even after a mid-stake claim, so
  a later claim applies a life-of-position average APY to only the new inverse-
  cost integral. That can overpay if the admin lowers APY after a claim, and
  underpay if APY rises. Default `claim_enabled` is false (single unstake
  window). Admin can set APY to `APY_MAX` directly. Not submitted.
- Fee-on-transfer LP mints would record requested amount/value but unstake the
  received vault balance. Controllers are admin-created. Not submitted.

Time spent: roughly 70 minutes. No Immunefi report.

## 2026-09-03: 1inch Aqua core, swap-vm entry, and Aqua opcodes (KYC, $100k)

Unofficial Immunefi program `1inch-aqua`. Local clones: aqua `9c5c42e`,
swap-vm `08089a1` under `/tmp/1inch-aqua` and `/tmp/1inch-swap-vm`. No
mainnet interaction.

Read: `aqua/src/*` (Aqua.sol, AquaApp.sol, AquaRouter.sol, Balance.sol,
IAqua.sol) and swap-vm `SwapVM.sol`, `AquaSwapVMRouter`, `AquaOpcodes`,
`Balances`, `XYCSwap`, `XYCConcentrate`, `PeggedSwap`, `PeggedSwapMath`,
`FeeFlat`, `FeeProtocol`, `ProtocolFee` helpers, `Extruction`, `Decay`,
`Controls`, `MakerTraits`, `TakerTraits`, plus `TransientLock` /
`TransientLockUnsafe`.

Checked for: virtual-balance accounting (ship/dock/pull/push), docked-strategy
behaviour, uint248 packing, per-order transient reentrancy, Aqua vs signature
hashing, msg.value/WETH, curve rounding, fee bps vs surplus pulls, taker
threshold/partial-fill, maker-chosen Extruction.

Result: no exploitable finding on the Aqua opcode set, fee settlement, invalidators
and controls. Still unread: TWAP and whitelist, which are outside this program's
Aqua opcode dispatcher.

- `pull` and `push` update packed balances before token movement; checked
  arithmetic bounds pulls to what the maker shipped and blocks pushes to docked
  or missing strategies. Docking requires the full token list. Shipped
  strategies are immutable per (maker, app, hash).
- `TransientLockUnsafeLib` only changes slot addressing; `lock()` still reverts
  when already held, so a taker callback cannot re-enter the same order.
- Aqua-mode orders hash as `keccak256(abi.encode(order))`, matching `Aqua.ship`.
- Aqua opcode set does not include Static/DynamicBalances. Live Aqua orders
  load reserves from `AQUA.safeBalances`.
- XYC / concentrate / pegged curves round amountOut down and amountIn up.
  Concentrate caps output at `balanceOut` and recomputes exact-in.
- `FeeFlatIn` / `FeeProtocol` adjust the taker amount around `runLoop`.
  Total bps must stay below 1e7. Extruction is a maker-chosen external call
  and is documented as needing min-rate / Aqua guards.
- `MakerTraits` requires `tokenA < tokenB`. Decay offsets revert on underflow
  if they would exceed `balanceOut`.
- `PeggedSwapMath.solve` uses the rationalized quadratic and floors √D so `v`
  is larger (maker-favorable). `a == 0` reduces to `v = rightSide² / ONE`.
- Token-in fees take a pro-rata of `feeTotal` plus optional surplus from the
  taker-paid gross; token-out fees pull the same from the maker, then the
  taker receives the already-net `amountOut`. Surplus is maker-parameterized.
  Floor splits can leave dust; they do not over-allocate the flat fee.
- `TakerTraits.validate` requires `amountOut > 0`, enforces exact vs partial
  fill against the taker-specified amount, and scales min-out / max-in
  thresholds on partial fills.
- `Invalidators`: `InvalidateBit` checks the bit before and writes it after the
  inner program, gated on non-static context and covered by the per-order lock,
  so a bit shared across orders behaves as one-shot. `InvalidateTokenIn/Out`
  keep cumulative fills per (maker, order, token) and scale the paired balance
  with floor / ceilDiv in the maker's favour; the external cancel functions set
  the fill to max, after which the order reverts on underflow. `Controls`:
  `Deadline` bounds `block.timestamp`; `Stop`, `Revert`, `Salt` behave as named.
  No finding.

Do not submit. Payment requires user KYC. ETHOnline "Build an Aqua App"
($5,000) is a later path: inherit `AquaApp`, ship strategies, settle against
`AQUA.safeBalances`. Do not pre-build against Start Fresh before the user has
ETHGlobal + public GitHub.

## 2026-09-03: GMTrade store execute / liquidate / ADL (gmx-solana `50c4d8d`)

Same Immunefi program as the earlier store builder-fee and treasury/LP
passes. Reviewed the keeper-gated execution and position-cut path, not the
full `gmsol_model` decrease math (that crate is not in the sparse clone).
No mainnet interaction.

Files: `lib.rs` (`execute_increase_or_swap_order_v2`, `execute_decrease_order_v2`,
`liquidate`, `auto_deleverage`), `instructions/exchange/{execute_order,position_cut}.rs`,
`ops/order.rs` (`ExecuteOrderOperation`, `execute_swap`, `execute_increase_position`,
`execute_decrease_position`, `PositionCutOperation`).

Checked for: who can execute; liquidation vs healthy positions at the store
layer; claimable-account PDA + delegation; transfer-out destinations;
swap/min-output; ADL pnl-factor bounds; builder-fee interaction on decrease.

Result: no exploitable finding at this depth.

- Execute, liquidate, and ADL are all `ORDER_KEEPER`. A user cannot invoke
  them. Liquidation eligibility itself is inside `gmsol_model::decrease`
  (`is_liquidation_order`); the store only requires a full close
  (`size_delta >= position.size_in_usd`) and `throw_on_execution_error`.
- Position-cut `owner` is unchecked but must match the position PDA seeds
  and the user account. Receiver of the synthetic order is that owner.
  Claimable ATAs are store-owned PDAs seeded with the owner (or holding
  address) plus the recent-time key, and must be delegated to that same
  address.
- Increase/swap transfer-out goes only to the order's recorded escrows
  (no user claimable accounts on that path). Decrease/cut uses those
  escrows plus the claimable PDAs above.
- Swaps honor `validate_output_amount`. Limit failures are hard errors;
  market failures can cancel. Empty market-decrease is allowed only to
  claim funding.
- ADL requires `pnl_factor_exceeded` before and a lower-but-not-below-
  `MinAfterAdl` factor after. Liquidation forbids a closed-index skip
  except `allow_closed` on liquidate (index can be closed; long/short
  vaults cannot).

Not a full store review: oracle price assembly, revertible swap internals,
and `gmsol_model` liquidation thresholds were not read. Not submitted.

## 2026-09-03: sBTC Clarity contracts (sbtc `18caa9d`)

Unofficial Immunefi program `sbtc` ($250k, KYC). Reviewed only
`contracts/contracts` (in-scope Clarity). Did not review emily / signer /
sbtc / wsts Rust. Local clone `/tmp/sbtc`. No mainnet interaction.

Files: `sbtc-deposit.clar`, `sbtc-withdrawal.clar`, `sbtc-token.clar`,
`sbtc-registry.clar`, `sbtc-bootstrap-signers.clar`.

Checked for: user mint/burn; deposit replay; withdrawal lock vs unlock;
fee refund; protocol-caller gating; signer rotation; protocol-contract
update leaving stale roles.

Result: no exploitable finding.

- `complete-deposit-wrapper` is signer-principal-only, rejects replay on
  `(txid, vout-index)`, checks burn-header at `burn-height`, then mints
  and records. Batch deposits re-enter that wrapper.
- `initiate-withdrawal-request` locks `amount + max-fee` from `tx-sender`
  before the dust check (the failed assert reverts the lock). Accept burns
  the locked amount and mints back `max-fee - fee` when the signer fee is
  lower. Reject unlocks the full lock. Both are signer-only and require
  pending status.
- Token protocol mint/burn/lock/unlock require `is-protocol-caller` for
  the matching role. SIP-010 `transfer` allows `tx-sender` or
  `contract-caller` as sender (standard). `get-balance` includes locked
  tokens by design.
- Registry `is-protocol-caller` checks both the flag→contract and
  contract→flag maps. After `update-protocol-contract` the old contract
  fails the flag→contract check even if a stale role row remains.
- Key rotation requires the current signer principal, >50% threshold,
  33-byte keys, and a never-seen aggregate pubkey.

Bitcoin peg-in/out correctness is signer-trusted and was not verified
against emily/signer. Not submitted. Payment requires user KYC.

## 2026-09-03: sBTC signer deposit / withdraw (sbtc `18caa9d`)

Same Immunefi program. Reviewed the signer crate's deposit and withdrawal
validation, request voting, and complete/accept Stacks calls. Did not
review `emily/handler`, the `sbtc` deposit-script crate, or `wsts` (those
directories were not in the sparse clone). Local clone `/tmp/sbtc`. No
mainnet interaction.

Files: `signer/src/stacks/contracts.rs` (`CompleteDepositV1`,
`AcceptWithdrawalV1`), `signer/src/bitcoin/validation.rs`
(`DepositRequestReport`, `WithdrawalRequestReport`, pre-sign uniqueness /
fee-rate), `signer/src/request_decider.rs`, `signer/src/block_observer.rs`
(Emily load + UTXO validate), `signer/src/transaction_coordinator.rs`
(complete-deposit amount = request amount − assessed input fee),
`signer/src/emily_client.rs` (client surface only).

Checked for: user-driven over-mint or under-burn; coordinator proposing a
mint that ignores the sweep fee; sweep-txid / outpoint replay; dust and
max-fee bypass; unconfirmed or reorged sweeps; first-input not being the
signer UTXO; deposit requests that never confirmed; voting without a
request record; unverified DKG shares being used to sign.

Result: no user-exploitable finding.

- `CompleteDepositV1::validate` requires a live on-chain incomplete
  outpoint, a canonical sweep that spends that outpoint with the signers'
  UTXO as vin0, mint amount exactly `request.amount − assess_input_fee`,
  mint ≥ dust, and assessed fee ≤ `max_fee`. The coordinator constructs
  the same mint amount; other signers re-check it before signing.
- `AcceptWithdrawalV1::validate` requires a Fulfilled report whose sweep
  txid matches, output script and sat amount match the request, assessed
  output fee equals `tx_fee`, fee ≤ `max_fee`, vin0 is a signer script,
  and outputs 0/1 cannot be withdrawal outputs (`assess_output_fee`
  returns `None` there).
- Bitcoin pre-sign validation refuses empty packages, duplicate
  deposits/withdrawals, and out-of-range fee rates. A deposit must be
  confirmed and unspent, inside per-deposit min/cap, outside the reclaim
  locktime buffer, voted `can_accept` + `can_sign`, and locked to
  **Verified** DKG shares. Withdrawals need a local accept vote, cap/dust
  checks, `WITHDRAWAL_MIN_CONFIRMATIONS`, and not past
  `WITHDRAWAL_BLOCKS_EXPIRY`.
- Request-decider votes are only blocklist + “can this signer sign.” If
  the blocklist client is unset, `can_accept` is true. That is operator
  policy, not a user mint path. Incoming deposit decisions are stored
  only after Emily fetch + `load_requests` validation. Incoming
  withdrawal decisions can be stored before the request row exists
  (explicit TODO); votes are still keyed by signer pubkey and later
  counted only against the current aggregate key, so an outsider cannot
  inject a vote.
- `CreateDepositRequest::validate` in the observer requires a confirmed
  non-coinbase UTXO and `validate_tx` on the bitcoin transaction. Script
  parsing lives in the `sbtc` crate, which was not in this clone.

Not submitted. Payment requires user KYC.

## 2026-09-03: sBTC emily deposit/withdraw API + deposit scripts (`18caa9d`)

Same Immunefi program. Expanded the sparse clone to `emily/handler` and
`sbtc/src`. Reviewed the public create/update surfaces and the taproot
deposit/reclaim parsers. No mainnet interaction.

Files: `sbtc/src/deposits.rs`; `emily/handler/src/api/handlers/{deposit,withdrawal,new_block,limits}.rs`;
`emily/handler/src/api/models/deposit/requests.rs`;
`emily/handler/src/api/routes/{deposit,withdrawal}.rs`;
`emily/handler/src/database/accessors.rs` (trusted vs untrusted updates).

Checked for: posting a crafted deposit that later mints; marking another
user's request Confirmed/Failed; unauthenticated withdrawal rows that
cause a BTC sweep; reclaim scripts that skip OP_CSV via OP_SUCCESS;
deposit-script parse that accepts a mismatched ScriptPubKey or
wrong-network recipient.

Result: no user-exploitable finding.

- `CreateDepositRequestBody::validate` deserializes the submitted
  transaction hex and runs `CreateDepositRequest::validate_tx`: txid
  match, vout exists, deposit/reclaim parse, reconstructed taproot
  ScriptPubKey equals the UTXO, recipient network matches. Emily does
  **not** check that the tx is in a bitcoin block; signers re-fetch the
  outpoint from bitcoin-core and drop missing/unconfirmed UTXOs.
- Deposit script parse requires the standard
  `<max-fee><recipient> OP_DROP <xonly> OP_CHECKSIG` layout, rejects
  non-minimal PUSHDATA1, and rejects invalid x-only keys. Reclaim parse
  requires a block-height CSV prefix, rejects the disable-locktime bit
  and time-based units, caps user-script length, and rejects BIP-342
  OP_SUCCESSx so the lock cannot be skipped.
- Untrusted `PUT /deposit` (and the matching withdrawal update) may only
  move Pending → Accepted. Confirmed/Failed/RBF need the trusted sidecar
  flag. Warp routes do not enforce the OpenAPI `ApiGatewayKey` themselves;
  production is expected to sit behind API Gateway. Even a public Accepted
  flip is Emily bookkeeping — signers vote and sweep from local bitcoin
  and Stacks state.
- `POST /withdrawal` and `POST /new_block` are likewise key-annotated
  but unauthenticated in warp. `new_block` only accepts committed
  `sbtc-registry` print events for the configured deployer. Signers do
  not sweep from Emily rows; a fake withdrawal index entry cannot unlock
  BTC.

Not submitted. Payment requires user KYC.

## 2026-09-03: sBTC emily chainstate / reorg (`18caa9d`)

Same Immunefi program. Impacts list includes “Emily API crash preventing
correct processing of sBTC deposits/withdrawals,” so this slice checked
whether an unauthenticated chain-tip write can rewind statuses or crash
the API. No live Emily calls. No mainnet interaction.

Files: `emily/handler/src/api/handlers/{chainstate,internal}.rs`,
`emily/handler/src/api/routes/chainstate.rs`,
`emily/handler/src/database/accessors.rs` (`add_chainstate_entry`),
`emily/handler/src/database/entries/{chainstate,deposit,withdrawal}.rs`
(`reorganize_around`), `emily/handler/src/common/mod.rs` (`NO_REORG_DEPTH`).

Checked for: posting a fake older tip; skipping the 6-block bitcoin
guard; Confirmed deposits reminted after a rewind; panic/crash on a large
reorg.

Result: no user-exploitable finding.

- `POST`/`PUT /chainstate` are OpenAPI-key annotated but unauthenticated
  in warp. Production is expected to sit behind API Gateway. A reachable
  write would still only mutate Emily’s index; signers complete deposits
  and accept withdrawals from bitcoin-core and Stacks, with on-chain
  replay protection. A rewind to Pending cannot remint.
- `NO_REORG_DEPTH` (6 bitcoin blocks) is skipped when
  `bitcoin_block_height` is omitted. That is a defense-in-depth hole on
  the notice board, not a peg break. Do not probe the live Emily host.
- `reorganize_around` drops events at or after the new tip (unless the
  hash matches) and synthesizes Pending if history is empty.
  `synchronize_with_history` clears fulfillment unless the latest event
  is still Confirmed.
- `execute_reorg_handler` flips API status to Reorg, rewrites impacted
  rows, then Stable. Version conflicts retry four times and then
  continue; leftover stale rows are an index inconsistency, not a mint.
  No panic path on the happy or conflict routes.

Not submitted. Payment requires user KYC. Remaining sBTC slice: `wsts`.

## 2026-09-03: Origin CompoundingStakingStrategy (origin-dollar, no KYC)

Unofficial Immunefi program `originprotocol` ($1M, `kyc: false`). The 1 Sep
2026 asset adds were the existing OUSD / wOUSD / Vault / Curve AMO
proxies. Reviewed the newer native-staking strategy instead: view
`0xb7992eFDa9aBBaC3522336A626191D198fa37145` and proxy
`0x25e1d468B14005716111d5e8464573e5135275f4` were added 22 Jun 2026.
Local clone `/tmp/origin-dollar`. No mainnet interaction.

Files: `contracts/strategies/NativeStaking/CompoundingStakingStrategy.sol`
(storage + implementation), `interfaces/strategies/CompoundingStakingTypes.sol`.
Did not review `BeaconProofsLib` SSZ internals.

Checked for: user withdraw; share-price inflation via donated WETH/ETH;
double-count of pending deposits vs validator balances; permissionless
proofs rewriting NAV; registrator pulling to a non-vault recipient.

Result: no user-exploitable finding.

- `deposit` / `depositAll` are vault-only. `withdraw` allows the
  registrator but `_withdraw` requires the recipient to be the vault.
  `validatorWithdrawal` is registrator-only and only requests an EIP-7002
  sweep back to this strategy’s 0x02 credentials.
- `checkBalance` is `lastVerifiedEthBalance + WETH.balanceOf(this)`.
  `stakeEth` unwraps WETH and adds the same amount to
  `lastVerifiedEthBalance`. Wrapping ETH subtracts
  `min(lastVerified, amount)` so swept ETH is not double-counted with
  WETH. Permissionless `verifyBalances` sets lastVerified to pending
  deposits + proven validator balances + the snapped ETH balance, then
  clears the snap.
- `verifyDeposit` refuses a processed slot after an unverified snap so a
  deposit cannot leave `depositList` before `verifyBalances` has used
  that snap. First deposits to new pubkeys are capped and serialized
  (`firstDeposit`) to bound front-run loss; that loss is documented and
  deducted from lastVerified when `verifyValidator` sees wrong
  credentials.
- Donated ETH sits in `receive()` until the next snap/verify. Donated
  WETH raises `checkBalance` immediately and gifts existing vault
  holders; it does not let a later minter extract others’ funds.

Not submitted. Vault rebase interaction was not fully read.

## 2026-09-03: Origin BeaconProofsLib (origin-dollar)

Same Immunefi program. Reviewed the SSZ/EIP-4788 proof library that
`CompoundingStakingStrategy` uses to set `lastVerifiedEthBalance`.
Local clone `/tmp/origin-dollar`. No mainnet interaction.

Files: `contracts/beacon/{BeaconProofsLib,BeaconProofs,Merkle,Endian,BeaconRoots}.sol`.

Checked for: forged validator-balance proofs; wrong-leaf extraction from
the packed 4-balance chunk; gindex overflow; short proofs treated as
roots; withdrawal-credential swap on `verifyValidator`; pending-deposit
list mixin-length bypass.

Result: no user-exploitable finding.

- Inclusion proofs are index-based SHA-256 (not sorted keccak). Each
  verifier pins an exact proof length (9 / 28 / 37 / 39 / 40 / 53
  witnesses) and a zero block-root reject. `concatGenIndices` places
  `uint40` validator indexes and `uint32` deposit indexes inside the
  reserved height so they cannot collide with the parent gindex bits.
- `verifyValidator` takes the first sibling as withdrawal credentials
  and requires it to match the caller-supplied value; substituting a
  sibling breaks the beacon block root.
- `balanceAtIndex` left-shifts the packed leaf by `(index % 4) * 64`
  then byte-swaps the top 64 bits, which is the SSZ little-endian
  layout for four `uint64` balances.
- Pending-deposit indexes are capped at `2^27` to account for the SSZ
  list length mixin. `merkleizePendingDeposit` is an 8-leaf tree
  (pubkey, credentials, amount, signature root, slot, three zeros)
  matching Electra `PendingDeposit`.
- Roots come from the EIP-4788 oracle (`BeaconRoots.parentBlockRoot`);
  a missed slot reverts rather than returning a stale root.

Not submitted.

## 2026-09-03: Origin CrossChain CCTP (origin-dollar `4fa0602`)

Same Immunefi program (`originprotocol`, $1M, `kyc: false`). In-scope
proxies include Morpho V2 CrossChain Master/Remote
`0xB1d624fc40824683e2bFBEfd19eB208DbBE00866` (Ethereum + Base, added
23 Feb 2026 and again 1 Sep 2026) and HyperEVM twins
`0xE0228DB13F8C4Eb00fD1e08e076b09eF5cD0EA1e`. Local clone
`/tmp/origin-dollar` at `4fa0602`. No mainnet interaction.

Files: `contracts/strategies/crosschain/{CrossChainMasterStrategy,CrossChainRemoteStrategy,AbstractCCTPIntegrator,CrossChainStrategyHelper}.sol`.

Checked for: user-callable mint/withdraw; forged CCTP or Origin
payloads; `remoteStrategyBalance` inflation; nonce replay / skip;
`relay` vs `handleReceiveFinalizedMessage` double-apply; pending
deposit/withdraw accounting; Morpho 4626 try/catch leaving funds
untracked.

Result: no user-exploitable finding.

- Master `deposit` / `withdraw` are vault-only. Remote
  `deposit` / `withdraw` / `sendBalanceUpdate` are
  governor/strategist/operator. `relay` is operator-only.
- `handleReceiveFinalizedMessage` / `handleReceiveUnfinalizedMessage`
  are `onlyCCTPMessageTransmitter`, then require
  `sourceDomain == peerDomainID` and `sender == peerStrategy`.
  Unfinalized receives additionally require `minFinalityThreshold == 1000`.
- Burn messages are accepted only through `relay`: header sender must
  be the TokenMessenger, burn token must be `peerUsdcToken`, and the
  extracted mint sender/recipient must be `peerStrategy` / `address(this)`.
  Circle `receiveMessage` then the Origin hook. A user cannot inject a
  balance-check or deposit hook.
- Nonces start at 1 with `nonceProcessed[0] = true`.
  `_getNextNonce` reverts while the last nonce is open, so only one
  in-flight transfer exists. Confirmations apply only when
  `nonce == lastTransferNonce`. Out-of-order non-confirmation checks
  are ignored; idle checks older than one day are ignored.
- Master `checkBalance` is local USDC + `pendingAmount` + cached
  `remoteStrategyBalance`. Deposits set `pendingAmount` before the
  burn; confirmations clear it. Withdrawals do not reduce the cache
  until the remote confirmation, so TVL can stay high for one CCTP
  round-trip. That is an accounting window, not a path for a user to
  mint against unbacked value: the next Master withdraw reverts
  (`Pending token transfer`) and Origin’s rules exclude accounting
  discrepancies without extractable loss.
- Remote Morpho `deposit` / `withdraw` are try/catch so a 4626 revert
  still sends a confirmation. Idle USDC is included in
  `checkBalance`. A failed withdraw sends a confirmation without
  tokens and the Master cache is corrected to the reported balance.

Not submitted. Circle CCTP attestation and Morpho share-price behavior
are third-party / documented. Ethena ARM source is not in this clone
(only `ARMBuyback` deployment JSON).

## 2026-09-03: Origin MorphoV2Strategy (origin-dollar `4fa0602`)

Same program. In-scope proxy `0x3643cafA6eF3dd7Fcc2ADaD1cabf708075AFFf6e`
(“OUSD Strategy - Morpho V2”, added 1 Sep 2026). Local clone
`/tmp/origin-dollar`. No mainnet interaction.

Files: `contracts/strategies/{MorphoV2Strategy,Generalized4626Strategy,MorphoV2VaultUtils}.sol`.

Checked for: non-vault withdraw; `maxWithdraw` over-pull; idle-asset
under/over-count; permissionless Merkl claim redirection.

Result: no user-exploitable finding.

- `deposit` / `withdraw` stay vault-only. `withdrawAll` is
  vault-or-governor and sends assets to `vaultAddress`. Morpho V2’s
  `maxRedeem`/`maxWithdraw` return 0, so the override withdraws
  `min(idle-on-V2 + V1-adapter maxWithdraw, checkBalance)`.
- `MorphoV2VaultUtils` only adds the V1 adapter’s `maxWithdraw` when
  `morphoVaultV1()` succeeds; any other adapter reverts
  `IncompatibleAdapter`. That can block `withdrawAll`, not a user
  drain. Ordinary `withdraw` still uses ERC-4626 `withdraw`.
- `checkBalance` is `previewRedeem(shares)` only. Idle `assetToken` on
  the strategy is intentionally omitted. Donated vault shares raise
  TVL for existing holders; they do not let a later minter extract
  others’ funds.
- `merkleClaim` is permissionless but hardcodes `users[0] = address(this)`,
  so rewards can only land on the strategy. A valid proof cannot
  redirect to the caller.

Not submitted.

## 2026-09-03: sBTC wsts + signer signing gate (`18caa9d`)

Same Immunefi program (`sbtc`, $250k, KYC). Local clones `/tmp/sbtc/wsts`
and `/tmp/sbtc/signer`. No mainnet interaction.

Files: `wsts/src/{v2,common,schnorr}.rs`,
`wsts/src/state_machine/signer/mod.rs` (DKG end, nonce, sign-share,
private-share decrypt), `signer/src/transaction_signer.rs`
(`NonceRequest` / `SignatureShareRequest` and
`validate_bitcoin_sign_request`).

Checked for: unverified DKG shares becoming a signing key; nonce reuse;
coordinator swapping the message after a nonce; a user forcing a
signature on an unapproved bitcoin sighash.

Result: no user-exploitable finding.

- `check_public_shares` requires polynomial degree `== threshold` and a
  Schnorr ownership proof of the constant term (`WSTS/polynomial-constant`).
  `compute_secret` then checks each private share against
  `s * G == poly(key_id)` and refuses `BadPrivateShares` before writing
  `private_keys`. Decrypt failures go into `invalid_private_shares` and
  block a successful `DkgEnd`.
- `compute_secrets` remaps `src_party → dest_key` into
  `dest_key → src_party` before that check.
- `sign_with_tweak` `take()`s the private nonce. A second share request
  returns `MissingNonce`. The library will sign whatever message the
  caller passes; that is expected for a FROST crate.
- The sBTC signer is the policy layer. Both `NonceRequest` and
  `SignatureShareRequest` require a canonical coordinator, then
  `validate_bitcoin_sign_request`: the message must be a known
  `TapSighash` with `will_sign_bitcoin_tx_sighash == true` and a matching
  prevout signature type. Unknown or rejected sighashes do not enter
  WSTS. DKG-verification signs only the mock message for a non-failed
  pending key inside the verification window.

Not submitted. Payment requires user KYC. sBTC in-scope slices from
this clone are now exhausted (Clarity, signer mint/burn, emily,
chainstate, wsts).

## 2026-09-03: Horizen ZenStaker / RewardAccumulator (`ab92502`)

Immunefi program `horizen` ($10,000 USDC, `kyc: true`, live). Scope is
pinned to `HorizenOfficial/staker` commit `ab92502`. Upstream Tally /
ScopeLift `Staker.sol` paths already covered by published audits are
out of scope except where Horizen’s integration introduces a new
issue. Local clone `/tmp/horizen-staker`. No mainnet or testnet
broadcast.

Files: `src/ZenStaker.sol`, `src/RewardAccumulator.sol`,
`src/DelegationSurrogate.sol`, `src/calculators/IdentityEarningPowerCalculator.sol`.
Read `Staker.notifyRewardAmount` / `_stake` only for the integration
boundary (ZEN-on-ZEN, notifier, surrogate).

Checked for: RewardAccumulator over-count vs balance; permissionless
`notifyRewardAmount`; schedule skip stealing principal; surrogate
drain; view helpers changing stake/claim.

Result: no user-exploitable finding.

- `ZenStaker` adds only view helpers and a non-voting
  `ZenDelegationSurrogate`. `MAX_CLAIM_FEE` is 0. Stake still moves
  ZEN into the surrogate (max-approve back to the Staker); rewards
  sit on the Staker. Same token, separate balances. `getVotes` is
  `depositorTotalStaked` and is not a governance hook in Phase 1.
- `RewardAccumulator.transferAndNotifyRewards` pulls then increments
  `accumulatedRewards`. `notifyAlreadyTransferredRewards` requires
  `balance - accumulated >= amount` (0.8 underflow-safe). A second
  notify of the same surplus reverts. `sendRewardsToStaker` is
  permissionless after `timeWindow`, transfers exactly
  `accumulatedRewards`, then `staker.notifyRewardAmount` (notifier-
  gated on Staker) then zeros the counter. Empty flushes still snap
  `lastRewardTime` to the latest grid; they do not move principal.
- Admin whitelist / window changes are owner-gated. Donating ZEN
  when the whitelist is off gifts stakers; it does not extract
  stake. Fee-on-transfer inflation would be a ZEN-OFT property, not
  present in this integration.
- `permitAndStake` swallows a failed `permit` (production ZEN has no
  EIP-2612) and falls through to `transferFrom`. Documented known
  behavior. `MAX_CLAIM_FEE = 0` and `maxBumpTip = 0`; bumping with a
  positive tip reverts. Only a registered notifier (the accumulator
  after the deploy script) can call `notifyRewardAmount`.

Not submitted. Payment requires user KYC.

## 2026-09-03: Origin BridgedWOETHStrategy (origin-dollar `4fa0602`)

Same Immunefi program. In-scope Base proxy
`0x80c864704DD06C3693ed5179190786EE38ACf835` and bridged wOETH
`0xD8724322f44E5c58D7A815F542036fb17DbbF839` (added 1 Sep 2026).
Local clone `/tmp/origin-dollar`. No mainnet interaction.

Files: `contracts/strategies/BridgedWOETHStrategy.sol`,
`contracts/token/BridgedWOETH.sol`.

Checked for: user mint of OETHb against unbacked wOETH; permissionless
oracle snapshot inflation; vault withdraw of strategy inventory;
bridged-token mint/burn.

Result: no user-exploitable finding.

- Vault `deposit` / `withdraw` / `depositAll` revert. `withdrawAll`
  is a no-op. Inventory moves only through
  `depositBridgedWOETH` / `withdrawBridgedWOETH`, both
  governor-or-strategist. Mint happens before the wOETH pull and
  burn after the OETHb pull; `nonReentrant` plus a revert on a
  failed transfer keeps the two legs atomic.
- `updateWOETHOraclePrice` is permissionless but only stores
  `oracle.price(bridgedWOETH)`. The stored price must stay `> 1e18`,
  never decrease, and not jump more than `maxPriceDiffBps` (≤ 100%)
  from the last snapshot. A user cannot invent a price. A manipulated
  oracle spike that gets snapshotted cannot be walked back; Origin’s
  rules treat third-party oracle behavior and accounting without an
  extractable path as out of scope. `checkBalance` uses the stored
  price and is documented to underreport when stale.
- `BridgedWOETH` mint/burn are `MINTER_ROLE` / `BURNER_ROLE`.
  `transferToken` cannot rescue wOETH or WETH.

Not submitted.

## 2026-09-03: Origin WOETH CCIP zapper + Base bridge helper

Same Immunefi program. In-scope Ethereum zapper
`0x438731b5Ee8fEcC02a28532713E237b93260C3F8` (added 1 Sep 2026).
Local clone `/tmp/origin-dollar` at `4fa0602`. No mainnet interaction.

Files: `contracts/zapper/WOETHCCIPZapper.sol`,
`contracts/automation/{AbstractCCIPBridgeHelperModule,BaseBridgeHelperModule,AbstractSafeModule}.sol`.

Checked for: user stealing another zap; CCIP fee/token-amount mismatch
draining the zapper or the Safe; unprivileged bridge of Safe inventory.

Result: no user-exploitable finding.

- `WOETHCCIPZapper.zap` / `receive` convert `msg.value - fee` to OETH,
  wrap to wOETH, and `ccipSend` to the chosen receiver. There is no
  pending-zap storage. A revert on `deposit` / wrap / `ccipSend` returns
  the ETH. `getFee` quotes CCIP with the full ETH amount as the token
  amount, then the send uses the smaller wOETH share count. That can
  overpay the fee; leftover ETH sits on the zapper with no rescue.
  That is stuck dust, not a path for a second user to extract.
- `BaseBridgeHelperModule` deposit/withdraw/bridge functions are
  `onlyOperator` and execute via the Safe. CCIP receiver is the Safe
  itself. `transferTokens` on the module is `onlySafe`. A user cannot
  move Safe wOETH or WETH.

Not submitted. Circle CCIP fee behavior is third-party.

## 2026-09-03: GMTrade gmsol_model liquidation thresholds (`50c4d8d`)

Same Immunefi program (`gmtrade`, $100k, no KYC). Fetched
`crates/model` into `/tmp/gmx-solana` (it was missing from the earlier
sparse clone). No mainnet interaction.

Files: `crates/model/src/position.rs` (`check_liquidatable`,
`check_collateral`), `crates/model/src/action/decrease_position/mod.rs`
(`check_liquidation`, remaining-size close-all),
`crates/model/src/params/position.rs`, `crates/model/src/market/perp.rs`
(liq-impact cap).

Checked for: liquidating a healthy position; fee-induced liquidation;
partial liquidation leaving a dust position that steals; impact
over-cap on a close.

Result: no user-exploitable finding.

- `DecreasePosition::execute` calls `check_liquidation`. A liquidation
  flag requires `check_liquidatable(..., for_liquidation=true)` to
  return a reason; a healthy position errors `NotLiquidatable`. Users
  still cannot invoke `liquidate` (store `ORDER_KEEPER`).
- Eligibility uses collateral + full-size PnL + capped negative impact
  − position fees, and **excludes** liquidation fees so the fee itself
  cannot push a solvent position under the line.
  `for_liquidation` uses `min_collateral_factor_for_liquidation`
  (falls back to the ordinary factor). Absolute
  `min_collateral_value` is also applied.
- Negative impact is capped by
  `max_position_impact_factor_for_liquidations`. Remaining size below
  `min_position_size_usd` (or tokens that would go to zero) forces a
  full close. The store already requires `size_delta >= size_in_usd`
  on liquidate.

Not submitted.

## 2026-09-03: GMTrade swap + output/oracle checks (`50c4d8d`)

Same Immunefi program. Local clone `/tmp/gmx-solana`. No mainnet
interaction.

Files: `crates/model/src/action/swap.rs`, `crates/model/src/price.rs`,
`programs/store/src/ops/order.rs` (`execute_swap`),
`programs/store/src/states/order.rs` (`validate_output_amount`),
`programs/store/src/states/oracle/validator.rs`.

Checked for: empty/zero-price swap minting out; impact pool over-pay;
skipping `min_output`; user-set stale oracle prices.

Result: no user-exploitable finding.

- `Swap::try_new` rejects a zero `token_in` and `prices.validate()`.
  Fees come out of token-in. Negative impact is taken from token-in
  (and reverts if it cannot be paid). Positive impact is capped by the
  impact pool; extra out is `pool_amount_out + capped impact`.
  Conversion uses `pick_price(false)` on token-in and
  `pick_price(true)` on token-out. After the pool delta the action
  checks pool amount, reserve, and max PnL.
- Store `execute_swap` runs the revertible path then
  `validate_output_amount` against `min_output`. Limit-order misses
  set `should_throw_error`; market misses cancel. Execute is still
  `ORDER_KEEPER`.
- `PriceValidator` enforces max age, a future-timestamp bound, and
  optional max deviation from the reference mid. Users cannot assemble
  oracle prices.

Not submitted.

## 2026-09-03: TermMax V2 gearing token + vault (`e314f3f`)

Immunefi program `termstructurelabs` ($80,000, `kyc: false`). Primary
in-scope repo is `term-structure/termmax-contract-v2`. The 24 Aug 2026
adds were the TMX OFT token addresses; this pass reviewed the V2
money-movers instead. Local clone `/tmp/termmax-v2`. No mainnet
interaction.

Files: `contracts/v2/tokens/{AbstractGearingTokenV2,GearingTokenWithERC20V2}.sol`,
`contracts/v2/vault/TermMaxVaultV2.sol` (deposit/withdraw/dealBadDebt).

Checked for: minting an underwater GT; liquidating a healthy loan;
taking more collateral than the repaid share; flash-repay stealing
another user’s collateral; vault withdraw of someone else’s shares.

Result: no user-exploitable finding.

- `mint` is `onlyOwner` (the market) and refuses LTV above `maxLtv`.
  Collateral is pulled from the provider. Capacity is checked against
  the token balance plus the encoded amount.
- `liquidate` requires `liquidatable`, a true `_getLiquidationInfo`
  hit (LLTV before maturity, or the post-maturity window), and caps
  `repayAmt` at `maxRepayAmt`. After the window it reverts. Debt
  tokens go to the market first. Collateral to the liquidator is
  repay-equivalent plus the configured bonus, then min’d against
  `collateral * repay / debt`, so a partial close cannot drain the
  rest. Remainder returns to the owner on a full close.
- `flashRepay` / `repayAndRemoveCollateral` are owner-or-delegate.
  Collateral is sent, then `executeOperation`, then
  `safeTransferFrom` of the repay. `nonReentrant`. A third party
  cannot flash someone else’s GT.
- Vault `_deposit` / `_withdraw` are standard 4626 with allowance
  on a non-owner redeem. `dealBadDebt` burns the owner’s shares
  (or an approved spender’s) and cannot target the vault asset as
  “collateral”.

Not submitted. LayerZero internals of the flattened `TMX.sol` were
not reviewed.

## 2026-09-03: TermMax V2 market issue/redeem + order swap (`e314f3f`)

Same Immunefi program (`termstructurelabs`). Local clone `/tmp/termmax-v2`.
No mainnet interaction.

Files: `contracts/v2/TermMaxMarketV2.sol` (`mint`/`burn`/`issueFt`/
`leverageByXt`/`redeem`), `contracts/v2/tokens/MintableERC20V2.sol`,
`contracts/v2/TermMaxOrderV2.sol` (`swapExactTokenToToken`,
`swapTokenToExactToken`, `_rebalance`).

Checked for: burning someone else’s FT/XT without allowance; redeem
before the liquidation window; flash-leverage without returning
collateral; order swap without `minOut` or with a fake pair.

Result: no user-exploitable finding.

- `MintableERC20V2.burn(owner, spender, amount)` spends allowance when
  `owner != spender`. Market `burn` / `redeem` / `leverageByXt` all
  go through that path. Pair mint pulls debt tokens from the caller
  1:1 into FT+XT.
- `issueFt` mints a GT (LTV-checked, collateral pulled) then FT minus
  the mint fee. `issueFtByExistedGt` is `augmentDebt` as the GT
  owner/delegate. `leverageByXt` flashes debt to the loan receiver,
  requires collateral in the callback, then burns XT.
- `redeem` is blocked until maturity (+ liquidation window if the GT
  is liquidatable). Market FT reserves from repay/liquidate are burned
  first so they do not inflate the redeemer’s share. Delivery and
  remaining debt tokens are pro-rata.
- Order swaps allow only debt↔FT and debt↔XT. Deadline and
  `minTokenOut` / `maxTokenIn` are enforced. Input is pulled after the
  quote; `nonReentrant`. `afterSwap` is a maker-set hook, not a user
  entry.

Not submitted.

## 2026-09-03: TermMax V2 router + swap adapters (`e314f3f`)

Same Immunefi program (`termstructurelabs`). Local clone `/tmp/termmax-v2`.
No mainnet interaction.

Files: `contracts/v2/router/TermMaxRouterV2.sol`,
`contracts/v2/access/WithWhitelistCheck.sol`,
`contracts/v2/lib/{OnlyProxyCall,TransferUtilsV2}.sol`,
`contracts/v2/router/swapAdapters/{ERC20SwapAdapterV2,TermMaxSwapAdapter,OneInchSwapAdapter,LifiSwapAdapter,OdosV2AdapterV2,UniswapV3AdapterV2,PendleSwapV3AdapterV2}.sol`.

Checked for: leftover tokens after swap/leverage/flash-repay; leftover
approvals; per-order `minTokenOut=0` vs aggregate `netTokenAmt`;
adapters callable without the router; whitelist bypass; LiFi
user-supplied calldata sending output elsewhere.

Result: no user-exploitable finding.

- Adapters are `onlyProxy` (`address(this)` must differ from the
  deployed implementation), so `swap` only runs via the router's
  `delegatecall`. Markets and adapters are checked against
  `WhitelistManager` (`MARKET` / `ADAPTER`). Flash callbacks use a
  transient store that is cleared after one use.
- `TermMaxSwapAdapter` exact-in passes `minTokenOut=0` to each order
  and then reverts if the sum is below `netTokenAmt`. A sandwich on
  one order can only fail the user's tx, not extract protocol funds.
  Exact-out refunds unused input to a user-set `refundAddress`.
  Order callbacks and 4626 pools must be whitelisted.
- Aggregator adapters scale `minOut` with input, require 1inch
  `spentAmount == amountIn`, and measure LiFi output on the router
  before forwarding. A LiFi payload that pays a third party yields
  zero `tokenOut` and reverts on `netAmount`.
- `TransferUtilsV2.safeApprove` never lowers a leftover allowance.
  Uniswap / 1inch / Odos still pull only the amount in the current
  swap params, so a stale allowance does not let a third party drain
  the router.
- `useBalanceOnchain` is the intentional leftover sweep inside a
  multi-path tx. `leverage` / `flashRepayFromColl` can leave unused
  debt or collateral on the router if the caller underspends; that
  is the user's own leftover (or dust), not an attacker extract of
  protocol reserves. `swapAndRepay` returns remaining repay token
  to `msg.sender`.

Not submitted. Remaining TermMax adapters (Kyber, OKX, Pancake,
Kodiak, vault helpers) are lower-priority copies of the same
approve-and-call pattern.

## 2026-09-03: Strata CDO / Tranche / depositor / accounting (`2be97f9`)

Immunefi program `strata` ($250,000, `kyc: true`). In-scope tranche
tree added 17 Jun 2026. Local clone `/tmp/strata-contracts` on the
`tranches` branch. No mainnet interaction.

Files: `contracts/tranches/{StrataCDO,Tranche,TrancheDepositor,Accounting,DiscreteAccounting}.sol`,
`contracts/tranches/base/cooldown/SharesCooldown.sol`,
`contracts/tranches/strategies/ethena/sUSDeStrategy.sol` (withdraw
path only).

Checked for: first-depositor inflation; burning another user’s
shares as fee; cooldown finalize stealing locked shares; meta-token
Ceil redeem pulling more than accounting deducts; leftover tokens
on the depositor; DiscreteAccounting projected-NAV insolvency
beyond the published known issue.

Result: no new user-exploitable finding.

- `deposit` / `withdraw` / `cooldownShares` are `onlyTranche`.
  `burnSharesAsFee` spends allowance when `caller != owner`.
  SharesCooldown `requestRedeem` is `COOLDOWN_WORKER_ROLE`;
  `finalize` redeems to the request owner; `cancel` /
  `finalizeWithFee` are `onlyUser`.
- Tranche uses OZ `decimalsOffset` plus `MIN_SHARES = 0.1 ether`.
  Meta deposit converts Floor and pulls the quoted token amount.
  Redeem passes a Ceil `tokenAmount` into the strategy, but Ethena
  / Saturn / Neutrl `withdrawInner` ignore it and size the
  transfer from `baseAssets` (`previewWithdraw`).
- Depositor swaps are router-and-minOut gated; leftover output is
  deposited in the same tx. `deposit` is not `nonReentrant`; a
  reenter would need an admin-listed malicious token or 4626.
- Continuous `Accounting.calculateNAVSplit` caps Senior’s target
  gain by real Junior (`jrtNavT1 - ONE_ASSET`) and reverts
  `InvalidNavSplit` if the pieces do not sum to `navT1`.
- `DiscreteAccounting.calculateNAVSplitProjected` still caps by
  **projected** Junior and debits **real** Junior (known issue
  1373). The public `tranches` tip does not contain the cited
  `6aee201` real-Junior cap. Not re-reported.

Not submitted.

## 2026-09-03: Strata two-step config + cooldown silos (`2be97f9`)

Same Immunefi program (`strata`). Local clone `/tmp/strata-contracts`.
No mainnet interaction.

Files: `contracts/tranches/TwoStepConfigManager.sol`,
`contracts/tranches/base/cooldown/{ERC20Cooldown,UnstakeCooldown}.sol`,
`contracts/tranches/strategies/saturn/SaturnStrategy.sol` (deposit /
withdraw).

Checked for: instant fee hike; stealing another user’s cooldown
balance; unstake proxy reuse paying the wrong owner; Saturn
withdraw using a Ceil `tokenAmount` instead of `baseAssets`.

Result: no user-exploitable finding.

- Exit-fee increases need `MIN_DELAY` (1 day) and a second role to
  execute. Decreases apply immediately (user-friendly). Exit-mode
  bounds are always delayed. Caps: fee ≤ 5% ppm, lock ≤ 30 days.
- `ERC20Cooldown.transfer` is `COOLDOWN_WORKER_ROLE` and pulls from
  the worker (the strategy). `finalize` pays the request owner.
  Instant (`cooldownSeconds == 0`) sends straight to `to`.
- `UnstakeCooldown` clones a per-user handler, pulls tokens into
  that proxy, then `request()`. Reuse is same-block or slot-cap
  on the same recipient. `finalize` returns the proxy to that
  user’s pool. A failed `finalize()` leaves the request in place.
- Saturn `withdrawInner` sizes shares with `previewWithdraw(baseAssets)`
  and ignores `tokenAmount`. USDat deposits return post-fee
  `convertToAssets(sharesReceived)`.

Not submitted.

## 2026-09-03: OpenZeppelin LimitOrderHook (`2ae32be`)

Immunefi program `openzeppelin` ($25,000, `kyc: true`). Asset
`OpenZeppelin/uniswap-hooks` added 9 Oct 2025; tip commit is the
zero-amount claim-redemption guard. Local clone `/tmp/oz-uniswap-hooks`.
No mainnet interaction.

Files: `src/general/LimitOrderHook.sol`, `src/utils/CurrencySettler.sol`.

Checked for: withdrawing another user’s filled order; cancelling
after fill to remove already-gone liquidity and desync claims;
placing into a filled order id; fee-checkpoint dilution when
adding liquidity; native-token zero-value revert (the just-fixed
path); principal pro-rata over-pay.

Result: no new user-exploitable finding.

- `placeOrder` / `cancelOrder` / `withdraw` all key off
  `userInfo[msg.sender].liquidity`. A filled order’s map id is
  reset to default so a new place at the same tick gets a new
  id; the old filled order remains withdrawable.
- Fees accrue per liquidity unit with a re-checkpoint that keeps
  already-owed fees when the same owner adds more. Principal is
  split pro-rata and subtracted; floor dust stays in the hook
  (documented).
- `_sendFromClaims` and `CurrencySettler` skip `amount == 0`,
  which is the tip fix for tokens / native recipients that revert
  on zero-value transfers. Cancel after fill tries to
  `modifyLiquidity` on an empty position and reverts; the owner
  still uses `withdraw`.

Not submitted.

## 2026-09-03: OpenZeppelin ReHypothecationHook (`2ae32be`)

Same Immunefi program (`openzeppelin`). Local clone
`/tmp/oz-uniswap-hooks`. No mainnet interaction.

Files: `src/general/ReHypothecationHook.sol` (`seedLiquidity`,
`addReHypothecatedLiquidity`, `removeReHypothecatedLiquidity`,
`_beforeSwap` / `_afterSwap` JIT).

Checked for: first-depositor share inflation; seeding a skewed
ratio that steals later deposits; overlapping JIT + liquidity
ops; third-party `modifyLiquidity` on the hook pool.

Result: no new user-exploitable finding.

- Seed requires `totalSupply() == 0` and mints
  `sqrt(amount0 * amount1)` with a floor of
  `100 * 10 ** decimalsOffset()`, so the virtual-share offset
  cannot inflate the price. Later adds price from yield-source
  balances (`previewMint`). Burns happen before withdraw.
- `_beforeSwap` sets a transient JIT lock and snapshots ticks;
  `_afterSwap` removes the same range. Liquidity ops revert
  `JITLocked` while that flag is set. Direct pool LP is
  `LiquidityNotAllowed`.
- Permissionless `_beforeInitialize` and a front-run skewed
  seed are documented warnings (grief / idle liquidity, assets
  stay redeemable). Not submitted.

## 2026-09-03: TruFin Solana staker deposit + whitelist (`ce5d88b`)

Immunefi program `trufin` ($20,000, `kyc: true`). In-scope repo
`TruFin-io/smart-contracts-solana-public` added 25 Jun 2026.
Local clone `/tmp/trufin-solana`. No mainnet interaction.

Files: `programs/staker/src/{lib.rs,instructions/staking.rs,instructions/whitelist.rs,state/types.rs}`.

Checked for: depositing without a whitelist; minting pool tokens
against a fake stake pool; `init_if_needed` creating a
self-whitelisted user PDA.

Result: no user-exploitable finding.

- `WhitelistUserStatus` defaults to `None`. Deposit’s
  `init_if_needed` still requires `Whitelisted`, so a fresh PDA
  cannot self-approve. Only an existing `agent` PDA can
  whitelist.
- Deposit CPI targets the hardcoded SPL Stake Pool program id.
  That program checks the pool, mint, and authorities. This
  wrapper has no withdraw path; redemptions go through the
  stake pool. Validator add/remove is `access.owner`.
- Permissionless `deposit_to_specific_validator` delaying a
  rebalance is documented in-source as an accepted whitelist
  trade-off.

Not submitted.

## 2026-09-03: OpenZeppelin fee + sandwich/JIT hooks (`2ae32be`)

Same Immunefi program (`openzeppelin`). Local clone
`/tmp/oz-uniswap-hooks`. No mainnet interaction.

Files: `src/fee/{BaseDynamicAfterFee,BaseHookFee}.sol`,
`src/general/{AntiSandwichHook,LiquidityPenaltyHook}.sol`.

Checked for: taking more than the unspecified surplus; leftover
transient target across swaps; sandwich hook applying a target
on the unprotected direction; JIT penalty taking fees from the
wrong position or donating to the attacker.

Result: no new user-exploitable finding.

- `BaseDynamicAfterFee` stores the target in transient storage
  and clears it in `afterSwap`. Surplus vs target is taken as
  6909 claims on the unspecified currency only. Exact-in fees
  reduce output; exact-out fees increase input.
- `BaseHookFee` charges a subclass percent of the unspecified
  amount, capped at 100%, and skips a zero unspecified delta.
- `AntiSandwichHook` applies the beginning-of-block target only
  on `!zeroForOne` (documented). `zeroForOne` returns
  `applyTarget=false`. Tick walks can OOG on large moves
  (documented).
- `LiquidityPenaltyHook` keys withheld fees by
  `(poolId, positionKey)` including `sender`. Penalty is linear
  in blocks since last add and is donated to in-range LPs.
  Multi-account redirect is documented and rarely profitable.
  `CurrencySettler` skips zero takes.

Not submitted.

## 2026-09-03: TruFin validator add/remove and rebalance (`ce5d88b`)

Same Immunefi program (`trufin`). Local clone `/tmp/trufin-solana`.
No mainnet interaction.

Files: `programs/staker/src/instructions/{validators.rs,initialize.rs}`.

Checked for: a random signer increasing/decreasing validator
stake; adding a validator without paying the reserve; init
front-run after deploy.

Result: no user-exploitable finding.

- `AddValidator` / `RemoveValidator` require `access.owner`.
  Add transfers rent + min stake from the owner into the
  reserve, then CPI `AddValidatorToPool` on the official
  stake-pool program, signed by the `staker` PDA.
- Increase/decrease require a `stake_manager` PDA seeded with
  `signer`. CPI uses instruction indexes 19/20 on the official
  program. The live program’s one-time init front-run is
  documented as already closed.

Not submitted.

## 2026-09-03: OpenZeppelin BaseCustomCurve / BaseAsyncSwap (`2ae32be`)

Same Immunefi program (`openzeppelin`). Local clone
`/tmp/oz-uniswap-hooks`. No mainnet interaction.

Files: `src/base/{BaseCustomAccounting,BaseCustomCurve,BaseAsyncSwap}.sol`.

Checked for: hook-owned 6909 claims paying a swapper more than
the hook holds; exact-out async skip leaking the other pool;
native `msg.value` refund under/over-pay; LP add/remove via the
PoolManager bypassing the hook.

Result: no user-exploitable finding.

- `BaseCustomAccounting` blocks direct pool LP
  (`LiquidityOnlyViaHook`), checks deadline and principal
  slippage, and refunds unused native `msg.value` after
  verifying it covered `amount0`.
- `BaseCustomCurve` swaps take/settle 6909 claims the hook
  minted on add. Output size is `_getUnspecifiedAmount`
  (subclass). A bad curve can lose the hook’s own LP, not
  another pool’s reserves. One `_poolKey` per instance.
- `BaseAsyncSwap` only intercepts exact-in: it takes the
  specified amount as claims and returns a delta that nets
  that amount to 0. Exact-out is left to the PoolManager.
  Multi-pool 6909 mixing is a documented implementer warning.

Not submitted.

## 2026-09-03: 1inch Fusion SimpleSettlement (`b68b27b`)

Immunefi program `1inch-SmartContracts` ($500,000, `kyc: true`).
In-scope repo `1inch/fusion-protocol` added 10 Jun 2026. Local
clone `/tmp/1inch-fusion`. No mainnet interaction.

Files: `contracts/{Settlement,SimpleSettlement}.sol`.

Checked for: surplus fee exceeding remaining taking amount;
whitelist matching a colliding 10-byte suffix; Dutch-auction
rate bump going negative and under-charging the taker.

Result: no user-exploitable finding.

- Surplus share is only the excess of net taking over a
  Ceil-scaled estimate, times `protocolSurplusFee` (capped at
  100). That extra is added to the protocol fee so the maker
  still receives at least the estimate.
- Whitelist compares `uint80(uint160(taker))` (lowest 10
  bytes) plus a time-gated list. A 2^80 collision is not a
  practical extract. Fills before `allowedTime` revert.
- Rate bump is interpolated and then reduced by a gas bump;
  making amount is divided by `1 + bump`, taking amount is
  Ceil-multiplied. After the auction it is 0.
- Mainnet `Settlement` additionally caps `tx.priorityFee` vs
  `basefee` (governance spec). That can fail a fill; it does
  not move extra tokens.

`FeeTaker` itself lives in the limit-order-protocol dependency
and was not re-reviewed here.

Not submitted.

## 2026-09-03: 1inch Fusion whitelist / PowerPod / KycNFT (`b68b27b`)

Same Immunefi program (`1inch-SmartContracts`, $500,000, `kyc: true`).
Local clone `/tmp/1inch-fusion`. Delegation parents from
`1inch/delegating` tag `1.1.0` (`ebd1a17`). No mainnet interaction.

Files: `contracts/{WhitelistRegistry,CrosschainWhitelistRegistry,PowerPod,KycNFT}.sol`;
`1inch/delegating` `contracts/{FarmingDelegationPlugin,TokenizedDelegationPlugin,DelegationPlugin,DelegatedShare}.sol`.

Checked for: on-chain registry gating Fusion fills; flash-loan
register then settle; `_clean` skipping a swapped-in address;
permissionless `promote` impersonating a resolver; PowerPod
`balanceOf` inflation; KycNFT mint/transfer without an owner
signature.

Result: no user-exploitable finding.

- Fusion fills do **not** read `WhitelistRegistry`.
  `SimpleSettlement` gates on the order-packed 10-byte list
  plus `KycNFT` / access-token balance (already reviewed).
  Register / clean / promote only change an off-chain resolver
  roster and per-chain worker hints.
- `register` requires `balance * 10000 >= totalSupply * threshold`
  and `balance > 0`. `register` then `_clean`s anyone now
  under the threshold. `clean` is permissionless. Threshold
  changes are owner-only and do not evict until `clean`.
- `_clean` uses AddressSet swap-remove: on eviction it
  decrements length and re-checks the same index. Tests cover
  mixed burns.
- `promote` does not require whitelist membership.
  `getPromotees` only maps **current** whitelist members, so a
  stale mapping is invisible after eviction.
- PowerPod itself disables `transfer` / `transferFrom` /
  `approve`. `balanceOf` is minted to the delegatee from
  st1INCH plugin balances. DelegatedShare mint/burn is
  `onlyOwnerPlugin`. A flash-loan of PowerPod is not possible;
  staking 1INCH has a lock. Even a temporary register would
  not open a Fusion fill.
- `KycNFT` mint and `transferFrom` are owner-only or
  EIP-712-signed by the owner. `_update` bumps `nonces[tokenId]`
  and enforces one token per address. `safeTransferFrom` goes
  through the overridden `transferFrom`. Burn: owner any id,
  holder their own. No public mint path.

Not submitted.

## 2026-09-03: 1inch FeeTaker / AmountGetterWithFee (`4.3.2` / `67c56ae`)

Same program. In-scope repo `1inch/limit-order-protocol`.
Fusion depends on npm `4.3.3`; git’s latest 4.3.x tag is
`4.3.2` (`67c56ae`). Local clone `/tmp/1inch-lop`. No mainnet
interaction.

Files: `contracts/extensions/{FeeTaker,AmountGetterWithFee,AmountGetterBase}.sol`
and the taker→maker / unwrap path in `OrderMixin.sol`.

Checked for: fees exceeding `takingAmount` under `unchecked`;
getter vs postInteraction fee mismatch draining the maker;
whitelist-discount applied only on one side; ETH unwrap
leaving WETH stranded or sending unbacked ETH; extra
postInteraction pulling leftover taking tokens; integrator
fallback reentering a fill to steal FeeTaker inventory.

Result: no user-exploitable finding.

- `_parseFeeData` caps `integratorShare` and the whitelist
  discount at 100. Combined integrator + resolver fee is
  `takingAmount * (integratorFee + resolverFee) / (1e5 + fees)`,
  which is strictly below `takingAmount`. Fusion’s surplus
  add-on is capped at 100% of the leftover, so the maker still
  receives at least the Ceil-scaled estimate (already reviewed).
- Getter extraData and postInteraction extraData are different
  extension fields. Getter whitelist is `size + 10*N`; Fusion
  postInteraction whitelist is `allowedTime + size + 12*N`.
  A builder can encode different lists; the maker signed both.
- `InconsistentFee` reverts if fees are non-zero but
  `order.receiver` is not FeeTaker, so tokens cannot be
  taken from a maker who never sent them here.
- LOP unwraps WETH to `getReceiver()` (FeeTaker) **before**
  `postInteraction`. FeeTaker then `_sendEth`s integrator /
  protocol / maker. Direct WETH fills `safeTransfer`.
- Remaining-amount invalidation is written before transfers.
  Same-order reentrancy hits a reduced remaining (or
  `ReentrancyDetected` on a still-new remaining order).
  A different order filled from an integrator fallback cannot
  call `rescueFunds` or `postInteraction` (owner / LOP only)
  and FeeTaker never approves a spender, so leftover inventory
  from the outer fill is not extractable.

1inch Fusion settlement + registry + access-token + FeeTaker
money path is exhausted at this commit. Remaining 1inch
in-scope trees (token-plugins, farming, cross-chain-swap,
Solana) are separate slices.

Not submitted.

## 2026-09-03: Intuition MultiVault deposit/redeem (`94bddae`)

Immunefi program `intuition` ($100,000, `kyc: true`, launched
8 Jul 2026). In-scope assets are live proxies (MultiVault,
curves, emissions, atom wallets) plus primacy of impact.
Local clone `/tmp/intuition-v2`. No mainnet interaction.

Files: `src/protocol/{MultiVault,MultiVaultCore}.sol`,
`src/protocol/curves/LinearCurve.sol`.

Checked for: vault assets vs contract ETH insolvency after
create/deposit/redeem; ghost min-share backing on atom,
triple, and counter vaults; protocol/entry/exit/atom-wallet
fees reserved twice or not at all; redeeming someone else's
shares to a third party; batch `msg.value` mismatch;
empty-supply inflation on LinearCurve; fee flow from a
non-default curve emptying the source vault for remaining LPs.

Result: no new user-exploitable finding.

- `createAtoms` / `createTriples` require `msg.value == sum(assets)`.
  Atom cost is `atomCreationProtocolFee + minShare`; triple cost
  is `tripleCreationProtocolFee + 2 * minShare`. Those minShare
  units back ghost shares on the default Linear curve (1:1
  `previewMint`). Counter triple gets the second minShare.
- Subsequent deposits add `assetsAfterFees` to the chosen
  curve. Protocol and atom-wallet fees stay as contract ETH
  for sweep/claim. Entry fee and triple atom-fraction go to
  the **default** curve via `_increaseProRataVaultAssets`,
  and only once default shares are above `feeThreshold`.
- Redeem subtracts `convertToAssets(shares)` from the source
  vault, pays the user net of protocol+exit, and (if above
  threshold) adds the exit fee to the default curve. Remaining
  source LPs keep the pre-redeem price; the fee ETH is
  re-attributed, not double-spent.
- Ghost `minShare` cannot be burned (`remainingShares < minShare`
  reverts). LinearCurve empty-supply deposit is `shares = assets`;
  create/init never leave `totalShares = 0` with leftover assets.
- Redeem always burns `receiver`'s shares and sends ETH to
  `receiver`. A third party needs redemption approval and
  cannot redirect the payout.
- `nonReentrant` on create/deposit/redeem/claim. Admin fee
  setters are role-gated. Default-curve-must-be-created-via
  create paths blocks a first-depositor inflation on the
  pro-rata vault.
- Repo `POST-MORTEM.md` documents a Nov 2025 TrustBonding /
  VotingEscrow `_supply_at` underflow (PR #126). Not
  re-reported. Progressive / Offset curves and emissions
  were not reviewed in this slice.

C4 2026-03 + mitigation 2026-04 and two Diligence reports
already cover this tree.

Not submitted.

## 2026-09-03: Sky PAS + SBEBeam (commit `947e71c` / `beam`)

Immunefi program `sky` ($10,000,000, `kyc: false`). Newest GitHub
scope added 1 Sep 2026 at
`sky-ecosystem/pas@947e71cd5dbaaf9c5b3840dd1b23e8e99d9a564d`
(`BeamState`, `Configurator`, `PASMom`, `timelock/Timelock`,
`timelock/Bytes32LinkedList`) plus `dss-flappers` `beam`
`SBEBeam.sol` (in-scope 17 Aug). Local clones `/tmp/reviews/pas`
and `/tmp/reviews/dss-flappers`. No mainnet interaction.

Files read in full.

Checked for: an unauthorized party collapsing an unlimited
rate-limit key; hop / maxChange overflow wrapping a cap
increase; timelock self-call or executor bypass; linked-list
pointer corruption on add/remove; SBEBeam bounds that let a
facilitator halt or under/over-burn surplus.

Result: no user-exploitable finding.

- `Configurator.setRateLimit` locks a key as unlimited only
  when BeamState default is `(max, 0)` **or** the live key is
  already `(max, 0)` **and** default is `(0, 0)`. If the live
  key is unlimited **and** a finite default exists, the
  `maxAmount <= current.maxAmount` clause is always true, so
  an authorized cBeam can drop unlimited → a tiny finite cap
  in one call with no hop. BeamState already documents that
  once cBeams are paired they can interfere and that this is
  assumed monitored. Trusted-role / known assumption.
- Hop applies only to increases. Decreases are always
  allowed. `maxChange` must be 0 or ≥ WAD. Multiplication
  `current.maxAmount * maxChange / WAD` is skipped when
  current is `type(uint256).max` by the unlimited-lock
  branch or by the `<= current.maxAmount` alternative.
- Timelock: `schedule` / `execute` singles revert; batch
  rejects `targets[i] == address(this)`;
  `DEFAULT_ADMIN_ROLE` is revoked from the timelock itself;
  `EXECUTOR_ROLE` is `address(0)` (anyone after delay);
  pause/cancel/admin-immediate-delay match the in-file
  notes. `Bytes32LinkedList` rejects `bytes32(0)` and
  duplicates; remove updates first/last and both neighbors.
- `PASMom.setOwner(0)` permanently bricks `onlyOwner`.
  `auth` still works through a leftover `authority`. Admin
  footgun, not a user extract.
- `SBEBeam.set` matches its notes: `kbump ≤ maxKbump` and
  `% RAY == 0`, `burn ≤ WAD`, `minHop ≤ hop ≤ 5 years`,
  `kbump / hop ≤ maxRate`, `tau` cooldown. A facilitator
  (`buds`) can stall the burn stream by lowering throughput;
  governance can revive. Documented.

Not submitted.

## 2026-09-03: Intuition AtomWallet + OffsetProgressive + utilization (`94bddae`)

Same program and commit as the MultiVault deposit/redeem
slice. Local clone `/tmp/reviews/intuition-v2`. No mainnet
interaction. Covers the slices that slice left open.

Files: `src/protocol/wallet/AtomWallet.sol`,
`src/protocol/curves/OffsetProgressiveCurve.sol`,
`src/protocol/emissions/TrustBonding.sol` (ratio math only).

Checked for: 77-byte validity-window replay; unclaimed wallet
owner spoof; remaining `square` underflow on the offset
curve; utilization delta that inflates veTRUST rewards;
create-cost vs progressive mint if default curve is switched.

Result: no user-exploitable finding.

- AtomWallet 77-byte signatures hash
  `userOpHash ‖ validUntil ‖ validAfter` (the v1.0.2 bind).
  Other lengths are malformed (fail, zero window) or plain
  65-byte ECDSA (no expiry). Unclaimed `owner()` is always
  `multiVault.getAtomWarden()`.
- `OffsetProgressiveCurve._convertToAssets` uses
  `PCMath.square` (not `squareUp`) on both edges, matching
  the hardening note. Slope must be even and non-zero.
- Utilization is `int256`. A negative epoch delta returns
  the configured lower bound (min 25% personal / 40%
  system). It does not mint extra rewards. Skip the known
  VotingEscrow `_supply_at` underflow (PR #126).
- If an admin later pointed `defaultCurveId` at
  `OffsetProgressiveCurve`, create cost would still charge
  `minShare` wei while vault totals credited the larger
  `previewMint`. `onlyRole(DEFAULT_ADMIN_ROLE)` footgun,
  not a user path.

Not submitted.

## 2026-09-03: Intuition ProgressiveCurve + emissions mint/bridge (`94bddae`)

Same program and commit. Local clone `/tmp/reviews/intuition-v2`.
No mainnet interaction.

Files: `src/protocol/curves/ProgressiveCurve.sol`,
`src/libraries/ProgressiveCurveMathLib.sol`,
`src/protocol/emissions/{BaseEmissionsController,SatelliteEmissionsController}.sol`,
claim budget in `TrustBonding.claimRewards`.

Checked for: deposit/redeem rounding that pays a later LP
more than the curve holds; mint quoting cheaper than
deposit; double-mint of an epoch; satellite `transfer`
draining user TRUST; unclaimed-epoch withdraw racing a late
claim.

Result: no user-exploitable finding.

- Deposit: `shares = sqrt(s² + assets/½m) − s` (`square`
  down, `div` down). Redeem: `(s² − sNext²) × ½m` (both
  squares down). Rounding leans against the taker, not
  toward extra assets out.
- `previewMint` uses `squareUp(sNext) − square(s)` and
  `mulUp`, so an exact-share mint quotes ≥ the deposit
  inverse. Slope must be even and non-zero.
- `mintAndBridge` is `CONTROLLER_ROLE`, one mint per epoch
  (`_epochToMintedAmount[epoch] > 0` reverts), refunds
  excess gas. Admin `withdraw` / `burn` are
  `DEFAULT_ADMIN_ROLE`.
- Satellite `transfer` is `CONTROLLER_ROLE` (TrustBonding
  claim path). `withdrawUnclaimedEmissions` /
  `bridgeUnclaimedEmissions` require the epoch to be ≥2
  epochs old (`getUnclaimedRewardsForEpoch` is 0 otherwise)
  and mark `_reclaimedEmissions[epoch]`. A late claim is
  also capped by `_emissionsForEpoch` remaining budget.

Intuition core + periphery money paths reviewed in this
session are exhausted at `94bddae`.

## 2026-09-03: Intuition BondingCurveRegistry + totalAssets solvency (`94bddae`)

Complementary pass on the same clone after the
Progressive/Offset convert reviews above. Files:
`BondingCurveRegistry.sol`, `BaseCurve.sol`.

Checked for: registry argument-order swap between deposit
and redeem; curve ID 0; convert ignoring `totalAssets` so
redeem pays another vault’s ETH.

Result: no user-exploitable finding.

- IDs start at 1. `previewDeposit(assets, totalAssets,
  totalShares)` vs `previewRedeem(shares, totalShares,
  totalAssets)` matches `IBaseCurve`. Add is owner-only.
- Progressive convert prices from share supply only.
  Fee ETH is routed to the default Linear vault, so a
  progressive vault’s `totalAssets` accumulates rounding
  dust (`≥` theoretical area). Redeem subtracts the
  theoretical amount first; a 0.8 underflow would revert
  rather than spend another vault’s ETH.

Not submitted.

## 2026-09-03: Sky diamond-pau core + CCTP / 4626 / 7540 / OTC (`1b6743a`)

Immunefi program `sky` ($10,000,000, `kyc: false`). In-scope
`sky-ecosystem/diamond-pau` `dev` files added 6 Jul 2026.
Local clone `/tmp/reviews/diamond-pau` at `1b6743a`. No
mainnet interaction.

Files: `Controller.sol`, `ALMProxy.sol`, `ALMProxyFreezable.sol`,
`RateLimits.sol`, `AccessControls.sol`, `Beacon.sol`,
`facets/Facet.sol`, `libraries/ApproveLib.sol`,
`facets/transfer-asset/TransferAssetFacet.sol`,
`facets/cctp/CCTPFacet.sol`, `facets/erc4626/ERC4626Facet.sol`,
`facets/erc7540/ERC7540Facet.sol`, `facets/otc/OTCFacet.sol`,
`facets/ethena/EthenaFacet.sol`.

Checked for: fallback dispatch without a role check;
allocator transferring to an arbitrary destination without
a rate-limit key; CCTP mintRecipient swap; 4626 first-depositor
inflation past the max exchange-rate cap; 7540 claim without
a pending request; OTC claim draining the buffer without a
prior send; leftover ERC20 approvals on the proxy.

Result: no user-exploitable finding.

- Controller `fallback` remaps `msg.sig` →
  `delegateSelector` and `delegatecall`s the wired facet.
  There is no ACL on the fallback; every money-moving
  facet function is `onlyRole(ALLOCATOR_ROLE)` or
  `DEFAULT_ADMIN_ROLE`. `msg.sender` is preserved.
  Beacon / `updateIntegrations` are admin-only. A selector
  can be wired only once.
- `ALMProxy.doCall` is `CONTROLLER` only. Rate-limit
  decrease/increase is `CONTROLLER` only. Unlimited keys
  (`maxAmount == max`) skip accounting.
- `TransferAssetFacet.transfer` burns
  `LIMIT_ASSET_TRANSFER(asset, destination)` before the
  proxy `transfer`. An unset key reverts (`zero-maxAmount`).
- CCTP mint recipient and fee-cap band are admin-set per
  domain. Allocator cannot change destination. Dual rate
  limits (global + domain). Approval is cleared after the
  burn loop. `DESTINATION_CALLER == 0` is the standard
  permissionless-relay CCTP setting.
- 4626 deposit requires
  `(1e36 * assets) / shares <= maxExchangeRate` (admin-set)
  and `minSharesOut`. An inflated vault that mints too few
  shares fails the cap. Withdraw/redeem restore the deposit
  limit via `_tryIncreaseRateLimit` using assets received.
- 7540 `claimDeposit` / `claimRedeem` only require that a
  claim rate-limit key **exists** (maxAmount > 0), then
  mint/withdraw `maxMint` / `maxWithdraw` to the proxy.
  The request already consumed the request-side limit.
  Trusted allocator.
- OTC `send` pays the exchange; `claim` pulls the buffer
  balance. Next send is blocked until
  `claimed + recharge >= sent * maxSlippage / 1e18`.
  Counterparty, buffer, slippage, and recharge are admin
  parameters. First send is allowed (`sentTimestamp == 0`).
- `ApproveLib` force-approves (zero then retry). Facets
  reset allowance to 0 after use.
- `ALMProxyFreezable` is a separate proxy: `ALLOCATOR_ROLE`
  may `doCall`, `FREEZER_ROLE` may revoke. Not the
  Controller-owned ALMProxy used by these facets.
- Ethena mint/burn only `approve` the official minter
  (allowance is left for the off-chain mint, unlike other
  facets). Cooldown/unstake are allocator-gated and
  rate-limited. `setDelegatedSigner` requires the key to
  exist. Trusted Ethena minter + allocator.

Remaining diamond-pau facets (Aave, LayerZero, Pendle,
Maple, farms, wraps, etc.) were not read.

## 2026-09-03: Sky emergency spells hub + stUSDS (`45651a4`)

Immunefi program `sky` ($10,000,000, `kyc: false`). In-scope
`dss-emergency-spells` added 3 Jun 2025; stUSDS spells added
21 Jul 2026. Local clone `/tmp/dss-emergency-spells`. No
mainnet interaction.

Files: `src/{DssEmergencySpell,DssGroupedEmergencySpell}.sol`,
`src/stusds/{StUsdsRateSetterHaltSpell,StUsdsWipeParamSpell,StUsdsRateSetterDissBudSpell}.sol`,
`src/lite-psm-halt/SingleLitePsmHaltSpell.sol`,
`src/line-wipe/SingleLineWipeSpell.sol`.

Checked for: permissionless `schedule` halting stUSDS / wiping
a line without being the governance hat; factory-deployed
spells that MOM would honor; `done()` lying so an operator
skips a still-live setter; grouped batch walking off the
ilk list; `cast`/`execute` no-ops that still mutate.

Result: no user-exploitable finding.

- `schedule()` has no modifier. The MOM / LineMom /
  LitePsmMom call reverts `not-authorized` unless the
  spell is the current `MCD_ADM` hat (integration tests
  write `hat()` to the spell, then `hat() = 0` reverts).
  A factory `deploy()` creates a new unhatted spell;
  poking it does nothing to production.
- Once lifted as hat, anyone may poke `schedule()`. That
  is the documented emergency-spell model, not an extract.
- `cast` / `execute` / `actions` are no-ops. GSM delay
  (`eta = 0`) is unused because actions run in `schedule`.
- `done()` returns true when wards are missing or a `try`
  call reverts, so the UI treats an unwired MOM as
  finished. It does not change parameters.
- Grouped `emergencyActionsInBatch` caps `end` and
  requires `start <= end`. Same hat check on each ilk.

Not submitted.

## 2026-09-03: Sky emergency clip / OSM / DDM / splitter / SPBEAM (`45651a4`)

Same Immunefi program (`sky`) and clone `/tmp/dss-emergency-spells`.
No mainnet interaction. Completes the in-scope emergency-spell
tree after the hub + stUSDS / lite-psm / line-wipe pass.

Files: `src/clip-breaker/{Single,Grouped,Multi}ClipBreakerSpell.sol`,
`src/osm-stop/{Single,Multi}OsmStopSpell.sol`,
`src/ddm-disable/SingleDdmDisableSpell.sol`,
`src/splitter-stop/SplitterStopSpell.sol`,
`src/spbeam-halt/SPBEAMHaltSpell.sol`,
`src/line-wipe/MultiLineWipeSpell.sol`.

Checked for: a multi-ilk batch that skips the hat check;
`setBreaker` / `stop` on `address(0)` moving funds; swallowing
`not-authorized` so an unhatted poke still halts some ilks;
empty-registry `count() - 1` underflow used as a range.

Result: no user-exploitable finding.

- Single / grouped clip, OSM, DDM, splitter, and SPBEAM all
  call the matching MOM. Integration tests for the hub
  already show MOM reverts `not-authorized` unless the
  spell is the `MCD_ADM` hat. Factories deploy unhatted
  copies that cannot mutate production.
- Multi clip / OSM catch per-ilk failures and `require` if
  the reason is `ClipperMom/not-authorized` or
  `osm-mom/not-authorized`, so an unhatted poke cannot
  silently skip the auth check. Other reasons emit `Fail`
  and continue (gas-limit escape hatch).
- Multi line wipe does **not** swallow: `lineMom.wipe`
  reverts the whole `schedule` if the hat is missing.
  Ilks with `lineMom.ilks(ilk) == 0` are skipped.
- `xlip` / `osms` / `plan` of `address(0)` makes `done()`
  true and the MOM call would revert, not move tokens.
- Batch helpers use `maxEnd = count() - 1`. An empty
  registry underflows `maxEnd`; `list(start, end)` then
  depends on the registry and is a poke DoS, not an
  extract. Live MCD ilk count is not zero.

`dss-emergency-spells` at `45651a4` is exhausted.

Not submitted.

## 2026-09-03: Sky diamond-pau Aave / LayerZero / Pendle / UniV3 (`1b6743a`)

Same Immunefi program and clone as the earlier diamond-pau
core slice. No mainnet interaction.

Files: `facets/aave/AaveFacet.sol`,
`facets/aave-v4/AaveV4Facet.sol`,
`facets/layer-zero/LayerZeroFacet.sol`,
`facets/pendle/PendleFacet.sol`,
`facets/uniswap-v3/UniswapV3Facet.sol`.

Checked for: a malicious aToken/spoke that redirects the
approve; LayerZero send to an unset or attacker recipient;
Pendle redeem through an aggregator swap; UniV3 swap
without a TWAP bound; first-depositor / deficit purchase
on Aave v4.

Result: no user-exploitable finding.

- Aave v3 deposit requires admin `maxSlippage` and burns
  `LIMIT_AAVE_DEPOSIT(underlying, pool, aToken)`. Pool and
  underlying come from the aToken. Withdraw measures
  underlying received and restores the deposit limit.
  Allocator-only.
- Aave v4 additionally requires
  `hub.getAssetDeficitRay(assetId) <= maxDeficits` (default
  0, so any deficit blocks until governance opts in).
  Position change is read from `getUserSuppliedAssets`,
  not the return tuple. Withdraw rate-limit key omits
  hub/asset so a remapped reserve can still exit.
- LayerZero recipient is admin-set per `dstEid`. In-file
  note: keep the rate limit at zero until OFT integration
  tests land. `minAmountLD` floors to
  `decimalConversionRate`. Quote is a proxy `staticcall`.
  `send` refunds fees to the proxy; leftover controller
  ETH is swept. Approval cleared when `approvalRequired`.
- Pendle redeem only on `isExpired` markets, with
  `SwapType` none (no ext router). `minTokenOut` is
  `pyAmountIn * 1e18 / pyIndexCurrent - 5`, plus the
  allocator's `minAmountOut`. In-file: do not use
  non-standard SYs without extra tests.
- UniV3 swap requires TWAP seconds, a tick-delta cap, and
  `minAmountOut`. Liquidity mint/increase goes to the
  proxy NFT; remove checks ownership and slippage vs
  admin `maxSlippage`. Aggregate rate limits assume
  pegged stables (documented).

Not submitted.

## 2026-09-03: Sky diamond-pau Maple / farms / wraps / Curve / PSM (`1b6743a`)

Same Immunefi program (`sky`) and clone `/tmp/diamond-pau`
at `1b6743a`. No mainnet interaction. Aave / LayerZero /
Pendle / UniV3 / Aave V4 were logged in the prior entry.

Files: `src/facets/maple/MapleFacet.sol`,
`src/facets/farm/FarmFacet.sol`,
`src/facets/wsteth/WSTETHFacet.sol`,
`src/facets/weeth/WEETHFacet.sol`,
`src/facets/wrap-proxy-eth/WrapProxyETHFacet.sol`,
`src/facets/curve/CurveFacet.sol`,
`src/facets/psm/PSMFacet.sol`.

Checked for: Maple cancel restoring request capacity so a
second redemption could exceed the request limit; farm
`getReward` sending rewards off-proxy; wstETH/weETH claim
paying a caller-chosen owner; Curve slippage mins that do
not bind the pool call; leftover approvals; PSM fill
loop that credits a partial swap.

Result: no user-exploitable finding.

- Maple `requestRedemption` burns
  `LIMIT_MAPLE_REQUEST_REDEEM` by `convertToAssets(shares)`
  before `requestRedeem(shares, proxy)`. Cancel only
  requires that a cancel key **exists** (same pattern as
  7540 claim) and does **not** restore the request limit.
- Farm deposit/withdraw burn their keys; `claimReward`
  only requires the claim key exists. `getReward` is
  called on the farm; the delta is measured on
  `rewardsToken` at the proxy.
- WSTETH unwraps WETH then `doCallWithValue(wsteth, "",
  amount)` (expects a payable submit/wrap). Request
  burns the stETH-equivalent; claim requires the claim
  key and wraps received ETH to WETH on the proxy.
  WEETH deposit checks `minSharesOut`. Withdraw
  `requestWithdraw` pays the eETH to a `weethModule`
  authorized by the rate-limit key, then claim is
  module-gated the same way. `WrapProxyETHFacet.wrapAll`
  wraps the proxy's full ETH balance if the wrap key
  exists.
- Curve swap/add/remove require admin `maxSlippage` and
  compare mins to `stored_rates` / `get_virtual_price`.
  Unseeded pools (`virtualPrice == 0`) cannot be
  deposited into. Rate limits run after the pool call
  (swap vs deposit split on add). PSM USDS↔USDC is 1:1
  through immutable `daiUSDS` + lite PSM; the fill loop
  reverts if `rush()` is 0 before the full amount is
  swapped. DAI/USDC/USDS approvals are reset.

Not submitted.

## 2026-09-03: Sky diamond-pau UniV4 / DualPool / PSM3 / remaining facets (`1b6743a`)

Same Immunefi program (`sky`) and clone `/tmp/diamond-pau`
at `1b6743a`. No mainnet interaction. Completes the
in-scope facet tree after the Aave/LZ/Pendle and
Maple/farms/wraps/Curve/PSM passes.

Files: `src/facets/uniswap-v4/UniswapV4Facet.sol`,
`src/facets/dual-pool/DualPoolFacet.sol`,
`src/facets/psm3/PSM3Facet.sol`,
`src/facets/dai-usds/DAIUSDSFacet.sol`,
`src/facets/usds/USDSFacet.sol`,
`src/facets/basin/BasinFacet.sol`,
`src/facets/centrifuge/CentrifugeFacet.sol`,
`src/facets/spark-vault/SparkVaultFacet.sol`,
`src/facets/superstate/SuperstateFacet.sol`,
`src/facets/merkl/MerklFacet.sol`,
`src/facets/nfat-halo/NFATHaloFacet.sol`,
`src/facets/nfat-prime/NFATPrimeFacet.sol`,
`src/facets/weeth/WEETHModule.sol`.

Checked for: a fabricated UniV4 `PoolKey` that bypasses
slippage/rate limits; DualPool hook return values that
under-report spend; PSM3/Basin receiver other than the
proxy; Centrifuge transfer to a caller-chosen recipient;
Merkl `toggleOperator` for an unlisted operator; NFAT
Halo issue that credits `gem` off-proxy; leftover
Permit2 allowances; WEETH claim sweeping the wrong
recipient.

Result: no user-exploitable finding.

- UniV4 mint/increase require admin tick limits and
  `hooks == 0`. NFT recipient is the proxy. Increase
  checks `ownerOf == proxy`. Decrease sends
  `TAKE_PAIR` to the proxy; PositionManager still
  gates who can modify a tokenId. Swap hashes the
  caller `PoolKey` to `poolId`; a fabricated key has
  no `maxSlippage` and reverts. Permit2 allowances
  are set to `block.timestamp` then cleared.
- DualPool measures spend/receipt by proxy balance
  diffs, not hook return values. Deposit requires
  `previewWithdraw(shares)` value ≥ paid ×
  `maxSlippage`. Withdraw requires allocator mins ≥
  preview × slippage (governance floor if the
  allocator is compromised). Unset poolId reverts.
- PSM3 deposit/withdraw receiver is the proxy.
  Immutable `psm`. Rate limits per asset. Basin is
  the same shape plus `minSharesOut` /
  `minConversionRate`. DAIUSDS is 1:1 through
  immutable `daiUSDS`. USDS `mint` draws to the
  admin-set vault buffer then `transferFrom`s to the
  proxy; `burn` is the reverse and restores the mint
  key.
- Centrifuge cancel/claim only require that the
  matching key **exists**. `transferShares` pays the
  admin `recipients[centrifugeId]` via the vault's
  spoke. Request id is always 0 (documented).
- SparkVault `take` burns `LIMIT_SPARK_VAULT_TAKE`
  then `take`s into the proxy. Superstate
  `subscribe` is USDC→USTB on immutable addresses
  and clears the USDC allowance. Merkl
  `toggleOperator` requires a
  `(distributor, operator)` key; user is the proxy.
- NFAT Halo `issue` measures `gem` received on the
  proxy; `to` is the facility NFT recipient and is
  part of the issue rate-limit key. One tokenId per
  facility. Interest is capped by admin
  `maxAnnualGrowthRate`. Repay spends from the proxy
  and clears allowance. Prime subscribe/withdraw/
  collect rate-limit actual `gem` deltas; `data` is
  allocator-chosen on a key-gated facility.
- `WEETHModule.claimWithdrawal` is proxy-only,
  requires a valid finalized request, wraps ETH, and
  transfers WETH to the proxy.

`diamond-pau` facet sources at `1b6743a` are exhausted.

Not submitted.

## 2026-09-03: Intuition TrustSwapAndBridgeRouter (`bb34cc2`)

Immunefi program `intuition` (in-scope Base asset
`0xE485D9a5Dc39774b7A80864B625969Cf9d93E5D7`). Source is
not in `intuition-contracts-v2`; local clone
`/tmp/intuition-periphery` (`0xIntuition/intuition-contracts-v2-periphery`
`bb34cc2`). Repo README lists Base
`0xA1EC6f95A88Bfc7A8Fd35f1296b64ebaf91C93fb`. Reviewed
this tree only. No mainnet interaction.

Files: `contracts/TrustSwapAndBridgeRouter.sol`.

Checked for: a path that does not end in TRUST but still
bridges; swap output sent to the caller; bridge fee quoted
on `minTrustOut` while a larger `amountOut` is sent;
ETH-path refund of another user's leftover; missing
`receive` so Slipstream `refundETH` DoS (known S-324);
leftover allowance used against a later user.

Result: no user-exploitable finding.

- ETH and ERC20 swaps require the packed path to start
  with WETH/`tokenIn` and end with TRUST. Each hop must
  exist in the Slipstream CL factory. `tokenIn` cannot be
  TRUST. Swap `recipient` is this router; Metalayer
  recipient is the caller-chosen dest. `nonReentrant`.
- `exactInput` enforces `amountOutMinimum: minTrustOut`.
  Bridge fee is quoted on `minTrustOut` (ETH/ERC20) or
  the exact `trustAmount` (direct bridge). If the hub
  fee scales with amount and `amountOut > minTrustOut`,
  `transferRemote` reverts. Successful txs send the
  received TRUST.
- ERC20/direct-bridge refund `msg.value - fee` to
  `msg.sender`. ETH swap spends `msg.value - fee` as
  WETH in; Slipstream `refundETH` dust stays on this
  router (`receive()`). Tests document that leftover
  (S-324 was a SwapRouter contamination DoS, now
  accepted via `receive`). No sweep; dust is not an
  extract.
- Allowances use `safeIncreaseAllowance` to the
  immutable official router/hub. No third-party
  spender.

Not submitted.

## 2026-09-03: Origin OUSD vault + Curve AMO (`4fa0602`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
OUSD Token / Vault / Curve AMO were added to scope on
1 Sep 2026 (etherscan assets; source in Origin Dollar).
Local clone `/tmp/origin-dollar` at `4fa0602`. No mainnet
interaction. Continues the earlier Origin strategy /
bridge slices.

Files: `contracts/contracts/vault/VaultCore.sol`,
`contracts/contracts/vault/OUSDVault.sol`,
`contracts/contracts/strategies/CurveAMOStrategy.sol`.

Checked for: a user mint that credits more OUSD than
assets pulled; claiming another account's withdrawal;
`mintForStrategy` from a non-whitelisted caller;
Curve AMO withdraw that transfers more hard asset than
removed; strategist rebalance that worsens the peg
without the solvency floor.

Result: no user-exploitable finding.

- `mint` scales the asset to 18 decimals, mints that
  many OTokens, then `safeTransferFrom`s the asset.
  `whenNotCapitalPaused` + `nonReentrant`. Auto-allocate
  only above `autoAllocateThreshold`, after the
  withdrawal queue is filled.
- `mintForStrategy` / `burnForStrategy` require both
  `strategies[msg.sender].isSupported` and
  `isMintWhitelistedStrategy`. Curve AMO is the intended
  caller. No `nonReentrant` (documented AMO reentry
  during allocate); user mint/redeem cannot be wired to
  those strategies in production.
- Async withdraw burns OUSD on request (1:1, asset
  decimals in `queued`). Claim requires the requester,
  the delay, `queued <= claimable`, and not already
  claimed. `_postRedeem` rejects if
  `|supply/value - 1| > maxSupplyDiff`. Rebase is
  operator/strategist/governor and only increases
  supply up to vault value, with a trustee fee on yield.
- Curve AMO `deposit`/`withdraw` are `onlyVault`.
  Deposit mints OUSD between 1× and 2× the hard asset
  to rebalance, then `add_liquidity` with
  `maxSlippage`. Withdraw computes LP from the pool
  hard-asset share, requires `min[hardAsset] = amount`,
  burns all OUSD left on the strategy, transfers
  exactly `_amount`. Strategist one-sided adds/removes
  use `improvePoolBalance` (must move the
  hardAsset−OUSD diff toward zero without overshoot)
  and `_solvencyAssert` (≥ 99.8% backed).

Leather was not started: the program requires a working
PoC against the current published extension/app build
and forbids theoretical reports.

Not submitted.

## 2026-09-03: Origin WOETH / WOUSD + Ethena ARM (`4fa0602` / `2322537`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
Wrapped Super OETH (Base `wsuperOETHb`) and Ethena ARM /
Aave market / Unstaker were added Jul–Aug 2026. Local
clones `/tmp/origin-dollar` `4fa0602` and `/tmp/arm-oeth`
`2322537`. No mainnet interaction.

Files: `contracts/contracts/token/{WOETH,WOETHBase,WrappedOusd}.sol`,
`src/contracts/{AbstractARM,EthenaARM,EthenaUnstaker}.sol`,
`src/contracts/adapters/EthenaAssetAdapter.sol`,
`src/contracts/markets/Abstract4626MarketWrapper.sol`.

Checked for: a WOETH donation that inflates
`convertToAssets`; wrapping that ignores the rebase
adjuster; an ARM swap of an unlisted pair; claiming
another LP's redeem; adapter `redeem` that sends USDe
off-ARM; a non-ARM deposit into the Aave 4626 wrapper.

Result: no user-exploitable finding.

- WOETH is ERC-4626 over rebasing OETH. `totalAssets` /
  `convertToShares` / `convertToAssets` use
  `adjuster` and `rebasingCreditsPerTokenHighres()`,
  not the live OETH balance, so later donations are
  ignored. `initialize2` snapshots `adjuster` once
  (`1e27` if supply is 0). Governor
  `transferToken` cannot collect the core asset.
  `WOETHBase` / `WrappedOusd` only change name/symbol.
- ARM swaps are USDe ↔ a configured base (sUSDe) with
  operator prices and remaining-liquidity caps.
  `nonReentrant` + `whenNotPaused`. Output is paid
  after `transferFrom`. Buy-side fees accrue from
  realized gain × `fee`. Two-token Uniswap-v2 path
  only.
- LP `deposit` pulls USDe then mints
  `assets * supply / netAssets`. Floor + live LPs
  reverts `Insolvent`. Redeem escrows shares, FIFO
  `queued <= claimable()`, delay, min(request-time,
  claim-time) assets. Operator may claim for the
  requester. Dead shares + `MIN_LIQUIDITY` block
  empty-supply donation.
- `EthenaAssetAdapter.requestRedeem` / `redeem` are
  `onlyARM`. Cooldowns rotate across 42 unstakers;
  `claimUnstake` sends USDe to the ARM. The 4626
  market wrapper `deposit`/`withdraw` require
  `msg.sender == receiver == arm`. `allocate()` is
  permissionless but only moves USDe between the ARM
  and that wrapper.

Not submitted.

## 2026-09-03: Lombard SVM asset_router / bridge / bascule / mailbox (`09d5e76`)

Immunefi program Lombard Finance ($250,000, `kyc: true`).
Solana trees added 25 Jun 2026. Local clone
`/tmp/reviews/lombard-svm` at `09d5e76`. No mainnet
interaction. Reviewed only the money-moving mint/burn/GMP
paths in the in-scope programs.

Files: `programs/asset_router/src/instructions/{deposit,redeem,redeem_for_btc,mint_from_payload,mint_with_fee,gmp_receive}.rs`,
`programs/asset_router/src/utils/{mod,fee,consortium_payloads,ed25519}.rs`,
`programs/bridge/src/instructions/{deposit,gmp_receive}.rs`,
`programs/bascule/src/instructions/validator.rs`,
`programs/bascule_gmp/src/instructions/validate_mint.rs`,
`programs/mailbox/src/instructions/{deliver_message,handle_message,send_message}.rs`,
`programs/consortium/src/instructions/finalize_session.rs`.

Checked for: a replayed consortium payload that mints
twice; GMP mint of a caller-chosen mint; mailbox deliver
without a validated payload; bascule below-threshold
bypass of consortium; fee signature that is not the
recipient owner; bridge inbound without a remote-bridge
sender match.

Result: no user-exploitable finding.

- `mint_from_payload` / `mint_with_fee` require a
  consortium `ValidatedPayload` PDA for
  `sha256(payload)`, destination `CHAIN_ID`, native mint,
  and recipient-account match. Replay is an `init` PDA
  (`DEPOSIT_PAYLOAD_SPENT`). Bascule is extra: above
  threshold the deposit must already be `Reported`;
  below threshold it is marked `Withdrawn` without a
  report (documented). Consortium attestation is the
  mint gate.
- `mint_with_fee` is `Claimer`-gated. The fee payload is
  Ed25519-checked against the token-account **owner**
  via the previous native ed25519 ix (offsets must live
  in that ix). Fee is `min(signed, max_mint_commission)`
  and minted to the treasury; remainder to the recipient.
- Asset-router `deposit` / `redeem` / `redeem_for_btc`
  burn (and optionally fee-transfer) the payer’s own
  tokens, then mailbox-send. Routes are PDA-bound.
- Asset-router `gmp_receive` requires the mailbox
  `MessageV1Info` PDA as signer, sender
  `BTC_STAKING_MODULE_ADDRESS`, recipient match, and a
  `MESSAGE_HANDLED` init PDA. Optional bascule_gmp
  `validate_mint` same threshold pattern.
- Bridge `deposit` is sender-whitelist + outbound
  direction. `gmp_receive` requires mailbox signer,
  `remote_bridge_config.bridge == message.sender`,
  inbound direction, and consumes the inbound rate
  limit. Recipient may be the message pubkey or its ATA.
- Mailbox `deliver_message` `init`s the message PDA only
  when consortium has both the session payload and
  `ValidatedPayload` for that hash. `handle_message`
  flips Delivered→Handled then CPI-signs as the message
  PDA. `inbound_message_path` on deliver is
  program-owned (admin-created), matched by identifier.
- Consortium `finalize_session` requires
  `session.weight >= current_weight_threshold` then
  `init_if_needed` the hash PDA. Trusted notary set.

Remaining in-scope SVM (not read this pass):
`lombard_token_pool`, `ratio_oracle`, mailbox admin /
path enable, consortium valset update.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Leather wallet provider + extension RPC (`eca229c`)

Immunefi program `leather` ($5,000, `kyc: true`,
`immunefiStandard: false`, `safeHarbor` unset / false).
Web/app only. Assets: `leather-io/mono` (added 13 Jul
2026), leather.io (primacy of impact), Chrome
extension, iOS, Android, `app.leather.io`,
`api.leather.io`. Local clone `/tmp/leather-mono` on
`dev` at `eca229c` (2026-09-02). No live wallet,
extension, or API testing. No exploit or reproduction
steps written.

Program rules that bound this pass: reports need a
working PoC against the **current published** Chrome /
App Store build; theoretical or AI-only reports are
closed; pre-release / unreleased code is out of scope;
third-party dApps and protocol-level Bitcoin/Stacks
bugs are out of scope; on-chain metadata spoofing is
out of scope unless it becomes code execution or a
signing bypass.

Files: `apps/extension/src/content-scripts/content-script.ts`,
`apps/extension/src/background/background.ts`,
`apps/extension/src/background/messaging/{rpc-message-handler,rpc-request-utils,methods-requiring-connected-wallet}.ts`,
`apps/extension/src/background/messaging/internal-methods/message-handler.ts`,
`apps/extension/src/background/messaging/rpc-methods/{get-addresses,sign-psbt}.ts`,
`apps/extension/src/shared/{messages,permissions/permission.helpers,crypto/mnemonic-encryption,messaging/send-message-to-originating-frame,utils/urls}.ts`,
`apps/extension/src/app/common/psbt/use-psbt-request-params.ts`,
`apps/extension/src/app/features/psbt-signer/hooks/use-psbt-details.tsx`,
`apps/extension/src/app/pages/rpc-sign-psbt/use-rpc-sign-psbt.tsx`,
`packages/provider/src/{injected-provider,mobile}.ts`,
`apps/web/tests/xss-protection.spec.ts`,
`apps/extension/tests/specs/rpc-get-addresses/rpc-cross-origin-frame.spec.ts`.

Checked for: a page that can drive another origin’s
granted permissions; a sign/broadcast path that skips
the approval popup; approval UI that is not derived
from the same PSBT hex that is signed; mnemonic
plaintext leaving the encrypt/decrypt helpers;
internal background methods callable from a content
script; HTML injection from CMS/metadata.

Result: no submittable finding.

- Content-script → background uses
  `chrome.runtime.connect` named `CONTENT_SCRIPT_PORT`.
  Origin is `port.sender.url` / `port.sender.origin`
  (Chromium/Firefox), not a page-supplied string.
  Responses go to `{tabId, frameId}` via
  `chrome.tabs.sendMessage`.
- Signing methods sit in
  `methodsRequiringConnectedWallet` and open a popup.
  `getAddresses` / `stx_getAddresses` also open a
  popup and do not auto-return addresses.
- Internal background handler requires
  `sender.url` to start with `chrome.runtime.getURL('')`.
- Permissions are keyed by hostname (`localhost` keeps
  the port). That is weaker than a full origin key, but
  without a working PoC against the published build it
  is theoretical and the program closes those.
- PSBT approval reads `hex` from the popup search
  params that the background copied from the validated
  request, then signs that same hex. Inputs/outputs
  come from `@scure/btc-signer` parse of that hex.
  Cross-origin iframes get an explicit callout
  (`rpc-cross-origin-frame.spec.ts`).
- Mnemonic encrypt/decrypt uses Stacks encryption +
  Argon2 salt; no extra log of the secret in those
  helpers. Background `logger.info` of the RPC envelope
  is verbose, not a key leak.
- v0.5.2-style XSS coverage on the marketing web app
  is a Playwright sanitizer check, not a wallet signing
  surface.

Not submitted. A valid Leather report would still need
the participant to reproduce against the live store
build; this agent will not write that PoC.

## 2026-09-03: OpenZeppelin Confidential Contracts v0.5.3 (`4a4f6c7`)

Immunefi program `openzeppelin` ($25,000, `kyc: true`).
Confidential-contracts asset added 18 Aug 2026: only
release `v0.5.3`
(`4a4f6c71f58b75e391899b57e42e3b73d288dfe3`). Local
clone `/tmp/oz-confidential` at that tag. Library
scope: loss of funds, permanent DoS, access-control
bypass, unintended behavior. Best-practice critiques
out of scope. No mainnet interaction.

v0.5.3 itself only extracts `BatcherConfidential.quit`
into `_quit(batchId, account)` so a derived contract
can quit on behalf of a depositor. Public `quit` still
uses `msg.sender`.

Files: `contracts/finance/BatcherConfidential.sol`,
`contracts/token/ERC7984/ERC7984.sol`,
`contracts/token/ERC7984/extensions/{ERC7984ERC20Wrapper,ERC7984Rwa,ERC7984Freezable}.sol`,
`contracts/token/ERC7984/utils/ERC7984Utils.sol`,
`contracts/finance/VestingWalletConfidential.sol`,
`contracts/utils/{FHESafeMath,HandleAccessManager}.sol`.

Checked for: unwrap/finalize that pays a different
account or amount than the burned ciphertext; join
that credits without a matching confidential transfer;
claim/quit that drains another depositor; RWA recovery
or force-transfer callable without `AGENT_ROLE`;
receiver hook that forges an `ebool` the recipient
does not own; vesting release of unvested handles.

Result: no user-exploitable finding.

- `onConfidentialTransferReceived` requires
  `msg.sender == fromToken`. Join amount is the
  encrypted transfer; overflow uses `tryIncrease` and
  joins 0.
- `dispatchBatchCallback` finalizes the stored unwrap
  request or, if already finalized, re-checks the
  decryption proof against that request’s handle.
  Cancel rewraps `unwrapAmountCleartext * rate` of
  `fromToken`. Partial forbids a change in underlying
  `toToken` balance. Exchange rate uses this batch’s
  `toToken` underlying balance; leftover wrap dust is
  documented to roll into the next batch.
- Public `claim` / `quit` are `nonReentrant`. `_claim`
  / `_quit` are documented as needing that guard.
  Permissionless claim-for is documented and sends to
  the depositor.
- Wrapper `wrap` pulls `amount - amount % rate` then
  mints `amount / rate`. Unwrap burns first, request id
  is the ciphertext (`assert` unique), `finalizeUnwrap`
  deletes the request then transfers
  `cleartext * rate` after `FHE.checkSignatures`.
  Fee-on-transfer underlying is documented unsupported.
  Donating underlying can inflate `inferredTotalSupply`
  and grief wraps — known, documented.
- ERC7984 transfers require ACL on ciphertext amounts;
  operators are time-bounded. Transfer-and-call refund
  is documented best-effort if the receiver drains
  itself in the hook. Receiver `ebool` must be
  uninitialized or ACL-owned by `to` (v0.5.2).
- RWA mint/burn/freeze/force/recover are `onlyAgent`.
  Force/recover bypass pause and restriction via
  selector allowlist, not frozen amounts
  (`ERC7984Freezable` still clamps).
- Vesting `release` transfers `releasable` then adds
  `amountSent` to released. Handle ACL on the token is
  checked (v0.5.2). `HandleAccessManager` defaults
  `_validateHandleAllowance` to false.
- `FHESafeMath` treats uninitialized as 0; add/sub
  detect wrap via comparison.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Money on Chain V2 core + queue + V4 swapper (`d770477`)

Immunefi program `moneyonchain` ($10,000, `kyc: true`).
GitHub asset `money-on-chain/stable-protocol-core-v2`
added 8 Jul 2026; many Rootstock addresses added 20 Aug
2026. Local clone `/tmp/moneyonchain` at `d770477`.
Known-issues gist
`nubis/9c24c0e2792e4dbb25db74f8f478756f` already lists
SP-01–SP-24 on this tree (stale-price queue, liquidation
AMM bounds, reverse-auction oracle flag, flux-capacitor
TP/TP, RC20 callback refresh, locked-fund refunds,
etc.). This pass looked only for a **new** extract
path. No mainnet interaction.

Files: `contracts/core/MocOperations.sol`,
`contracts/core/MocBaseBucket.sol` (`checkRecipient`,
`unlock` accounting),
`contracts/queue/MocQueue.sol` (execute + failed-op
unlock),
`contracts/multiCollateral/swapper/MocSwapperV4.sol`.

Checked for: queue execute callable by a non-queue
caller; mint that credits without locking AC/TC/TP;
recipient override when `_allowDifferentRecipient` is
false; unlock that returns more than `qACmax`; V4
swapper that sends the contract’s leftover balance or
skips `amountOutMin`.

Result: no new user-exploitable finding.

- Enqueue mint/redeem is `notLiquidated notPaused
  checkRecipient`. `_checkRecipient` reverts
  `RecipientMustBeSender` unless the bucket allows a
  different recipient. TP lock calls `_tpi` so only
  registered pegged tokens enter the queue.
- `execMintTC` / redeem / swap are `onlyMocQueue`.
  Failed mint unlocks `params.qACmax` via
  `unlockACInPending` (`onlyMocQueue`); a failing AC
  refund is recorded in `senderLockedFunds` (known
  SP-18, no self-serve recover).
- `MocSwapperV4` is a permissionless exact-in/exact-out
  Uniswap v4 wrapper. It spends the caller’s tokens,
  checks `balanceInAfter == before - amountIn` (exact
  in) or `balanceOutAfter == before + amountOut` (exact
  out), and transfers only the swap delta (exact in) or
  the requested out plus surplus in (exact out). Pool
  fee/hook/tick maps are governor-set. Matches the
  documented V3 “no leftover sweep of whole balance”
  pattern; not a new extract.

Duplicates of SP-01–SP-24 were not re-filed.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Origin Aerodrome / Base Curve / Hydrex AMOs + OETH zapper + Safe modules (`4fa0602`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
superOETHb Sep-1 assets continue from the OUSD vault /
Curve AMO and WOETH slices. Local clone `/tmp/origin-dollar`
at `4fa0602`. No mainnet interaction.

Files: `contracts/contracts/strategies/aerodrome/AerodromeAMOStrategy.sol`,
`contracts/contracts/strategies/BaseCurveAMOStrategy.sol`,
`contracts/contracts/strategies/hydrex/OETHbHydrexAMOStrategy.sol`,
`contracts/contracts/strategies/algebra/StableSwapAMMStrategy.sol`,
`contracts/contracts/zapper/{AbstractOTokenZapper,OETHZapper,OETHBaseZapper}.sol`,
`contracts/contracts/automation/{AbstractSafeModule,CollectXOGNRewardsModule,ClaimStrategyRewardsSafeModule,ClaimBribesSafeModule}.sol`.

Checked for: a user deposit that mints unbounded OETHb;
withdraw that sends WETH off-vault; CL decrease with
zero mins that a non-strategist can sandwich; zapper
mint that credits more than ETH/WETH pulled; Safe
module that moves tokens to a non-Safe address.

Result: no user-exploitable finding.

- Aerodrome AMO `deposit` / `withdraw` / `withdrawAll`
  are `onlyVault` + `nonReentrant`. Withdraw recipient
  must be the vault. `rebalance` is
  `onlyGovernorOrStrategist`. `_addLiquidity` mints
  OETHb via `mintForStrategy` to match the Sugar
  estimate, then burns leftovers. Position is valued
  at the 1:1 tick (`_wethAmount == 0`); leftover
  WETH/OETHb on the strategy still count in vault
  `totalValue`. DecreaseLiquidity uses
  `amount0Min/amount1Min = 0` (trusted strategist);
  `_checkForExpectedPoolPrice` gates ticks and the
  configured WETH-share interval; `_solvencyAssert`
  requires vault value / supply ≥ 99.8%.
- Base Curve AMO is the WETH/OETH twin of
  `CurveAMOStrategy`: vault-only deposit mints
  between 1× and 2× OETH, `add_liquidity` with
  `maxSlippage`, then gauge-stakes. Withdraw
  computes LP from the pool WETH share, requires
  `min[WETH] = amount`, burns leftover OETH,
  transfers exactly `_amount`. Strategist one-sided
  `mintAndAddOTokens` / `removeAndBurnOTokens` /
  `removeOnlyAssets` use `improvePoolBalance` +
  `_solvencyAssert`.
- Hydrex AMO is a thin GaugeV2 `stakeToken()` wrapper
  over `StableSwapAMMStrategy`. Vault-only deposit
  mints OToken in pool-reserve proportion
  (`nearBalancedPool` + `skimPool`), withdraw burns
  leftover OToken and requires enough asset removed.
  Same 99.8% solvency floor. `withdrawAll` skips
  solvency for emergency gauge exit.
- `OETHZapper` / `OETHBaseZapper` wrap ETH or pull
  WETH, `vault.mint` the zapper’s full WETH balance,
  require minted ≥ ETH/WETH in, then optionally
  ERC-4626 wrap with `minReceived`. Leftover donated
  WETH/ETH goes to the next caller, not an extract.
- Safe modules: `DEFAULT_ADMIN_ROLE` is the Safe.
  `transferTokens` is `onlySafe` and only pays the
  Safe. `CollectXOGNRewardsModule` operator can only
  `collectRewards` and send the OGN delta to a
  hardcoded rewards source. Strategy/bribe claimers
  only `execTransactionFromModule` collect selectors
  on a Safe-owned veNFT / whitelisted strategy list.

Remaining Origin after the AMO pass was WETH/USDC/Lido
ARM (logged next) and CrossChain master/remote (also
logged this turn). xOGN remains.

Not submitted.

## 2026-09-03: Origin WETH / USDC / Lido ARM adapters (`2322537`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
WETH ARM stETH/wstETH/eETH/weETH adapters, USDC ARM
PYUSD/USDG (Paxos) adapters, Lido ARM, and ARM zappers
were listed separately from Ethena ARM. Local clone
`/tmp/arm-oeth` at `2322537`. No mainnet interaction.
`AbstractARM` swap / LP deposit / FIFO redeem was
already reviewed with Ethena ARM; this pass is the
adapter + zapper delta. HyperEVM CrossChain
Master/Remote is the same CCTP tree already logged.

Files: `src/contracts/{LidoARM,MultiAssetARM,ZapperARM,ZapperLidoARM}.sol`,
`src/contracts/adapters/{AbstractLidoAssetAdapter,StETHAssetAdapter,WstETHAssetAdapter,EtherFiAssetAdapter,WeETHAssetAdapter,PaxosAssetAdapter}.sol`.

Checked for: a non-ARM caller that opens or claims a
withdrawal; redeem that sends WETH/USDC off-ARM;
Ether.fi permissionless claim that burns the NFT and
leaves ETH elsewhere; Paxos submit that pays a
caller-chosen recipient; zapper mint of more shares
than ETH wrapped.

Result: no user-exploitable finding.

- Lido / Ether.fi / Paxos `requestRedeem` / `redeem`
  are `onlyARM`. Lido FIFO-claims only a finalized
  prefix owned by the adapter, wraps all ETH, and
  transfers all WETH to the ARM (donations included).
  stETH is 1:1; wstETH unwraps then uses
  `getStETHByWstETH`. Chunks are ≤ 1000 ETH.
- Ether.fi adapters pull eETH/weETH, open a queue
  request to `address(this)`, and claim via
  `batchClaimWithdraw`. `receive()` reverts unless
  `claimingEtherFi` is set, so a permissionless
  Ether.fi claim cannot burn the NFT and strand ETH.
  `onERC721Received` is present.
- Paxos queues `pendingShares` then the operator
  submits to an owner-set `paxosRecipient`. `redeem`
  requires `settlingShares` and enough settled
  liquidity, then sends exactly `shares` USDC to the
  ARM. Excess recovery is owner-only and also pays
  the ARM.
- `LidoARM` / `MultiAssetARM` only initialize
  `AbstractARM`. Zappers wrap the contract’s ETH
  balance and `deposit` shares to `msg.sender`.
  Lido zapper is pinned to one ARM; generic
  `ZapperARM` takes a caller-chosen ARM (user
  error if they pass a fake). `rescueERC20` is
  owner-only.

Remaining Origin in-scope: xOGN token (not in
origin-dollar / arm-oeth; rewards module already
reviewed). CapManager / Morpho market wrappers if
they differ from the Ethena 4626 wrapper.

## 2026-09-03: OZ Confidential leftover ERC7984 modules (`4a4f6c7`)

Continues the v0.5.3 pass. Same Immunefi program
(`openzeppelin`, $25,000, `kyc: true`). Same clone
`/tmp/oz-confidential` at `4a4f6c7`. No mainnet
interaction.

Files: `contracts/token/ERC7984/extensions/{ERC7984Hooked,ERC7984Votes,ERC7984Omnibus,ERC7984ObserverAccess}.sol`,
`contracts/token/ERC7984/utils/{ERC7984HookModule,ERC7984BalanceCapHookModule,ERC7984HolderCapHookModule}.sol`.

Checked for: an unprivileged install that can zero
transfers; a hook that forges compliance; holder-count
accounting that lets a transfer past the cap; omnibus
transfer that moves tokens of an account the caller
does not operate; observer that can be set on someone
else’s account.

Result: no user-exploitable finding.

- `installModule` / `uninstallModule` require
  `_authorizeModuleChange` (concrete token). Modules
  are trusted and keep ACL after uninstall
  (documented). Pre-hooks AND into one `ebool`; false
  zeroes the amount. Transient ACL on the amount is
  granted only to installed modules. Module
  `preTransfer` requires the token already allowed the
  ciphertext.
- Balance-cap compare uses `tryIncrease` then
  `le(future, max)`. `setMaxBalance` is
  `IERC7984Rwa.isAgent`. Sender-visible compliance is
  a documented leak, not an extract.
- Holder-cap must be installed before total supply is
  initialized. Pre-check uses encrypted from/to
  balances; post-transfer increments when `to` balance
  equals the transferred amount and decrements when
  `from` goes to zero. Self-transfers are skipped.
  Mint-from-zero edge is documented and dropped when
  the amount is zero.
- Votes just `_transferVotingUnits` of the actually
  transferred amount. Omnibus wrappers call
  `confidentialTransferFrom` (operator + ACL) and only
  emit extra encrypted sub-account labels; no on-chain
  sub-account ledger. Observer can be set by the
  account or cleared by the current observer.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Lombard SVM token pool + ratio oracle (`09d5e76`)

Immunefi program Lombard Finance ($250,000, `kyc: true`).
Solana trees added 25 Jun 2026. Same local clone
`/tmp/reviews/lombard-svm` at `09d5e76`. Completes the
SVM money path after asset_router / bridge / mailbox.

Files: `programs/lombard_token_pool/src/instructions/{lock_or_burn_tokens,release_or_mint_tokens}.rs`,
`programs/lombard_token_pool/src/{lib,state}.rs`,
`programs/ratio_oracle/src/instructions/{publish_ratio,initialize_oracle}.rs`,
`programs/ratio_oracle/src/{lib,state}.rs`,
`programs/ratio_oracle/src/utils/consortium_payloads.rs`,
`programs/bridge/src/instructions/gmp_receive.rs` (mint
target already reviewed; re-read for the pool CPI).

Checked for: CCIP lock that burns without the onramp
signer; offramp mint to a caller-chosen token account;
CCIP amount that does not match the GMP mint; ratio
publish without a consortium `ValidatedPayload`;
replay of a used ratio payload; a second oracle for
the same denom.

Result: no user-exploitable finding.

- `lock_or_burn_tokens` requires
  `authority == router_onramp_authority`, RMN +
  allow-list + outbound rate limit
  (`validate_lock_or_burn`). It CPI-signs `bridge.deposit`
  as the pool signer. Receiver must be 32 bytes.
  `dest_pool_data` is the 32-byte payload hash.
- `release_or_mint_tokens` requires the router
  `ALLOWED_OFFRAMP` PDA for this offramp + remote
  selector, then `validate_release_or_mint` (remote
  pool list, inbound rate limit, RMN). It CPI
  `mailbox.handle_message(payload_hash)` with the pool
  signer. Bridge `gmp_receive` mints the **payload**
  amount to the payload recipient (or that wallet’s
  ATA) and `init`s `MESSAGE_HANDLED`. If the mailbox
  returns `InboundResponse`, the pool requires
  `res.amount == parsed_amount`. If return data is
  missing it skips that check — the mint already
  happened at the payload amount; CCIP’s
  `destination_amount` is then informational. No extra
  tokens are minted. Not submitted.
- `publish_ratio` requires a consortium-owned
  `ValidatedPayload` PDA for `sha256(payload)`. Decoder
  checks selector `0x6c722c2c` and word widths. Denom
  hash must match `oracle.denom`. Timestamp must be
  strictly after `switch_time` and not beyond
  `now + max_ahead_interval`. Ratio step is bounded by
  `current * interval * threshold / (MAX * DEFAULT_INTERVAL)`.
  Replay fails `OutdatedRatioUpdate`. Oracle accounts
  are `init`ed at `[ORACLE_SEED, sha256(denom)]`, so
  one PDA per denom. Threshold/consortium updates are
  admin.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Origin CrossChain master/remote (`4fa0602`)

Immunefi program `originprotocol` ($1,000,000,
`kyc: false`). Remaining Sep-1 OETH/OUSD cross-chain
slice. Same clone `/tmp/origin-dollar` at `4fa0602`.
Base CCTP integrator already reviewed. No mainnet
interaction.

Files: `contracts/contracts/strategies/crosschain/{CrossChainMasterStrategy,CrossChainRemoteStrategy,CrossChainStrategyHelper}.sol`.

Checked for: a user deposit that credits remote
balance without bridging; withdraw to a non-vault
recipient; a replayed CCTP nonce that double-counts;
a stale balance-check that inflates `checkBalance`
enough to mint unbacked OUSD.

Result: no user-exploitable finding.

- Master `deposit` / `withdraw` are `onlyVault` +
  `nonReentrant`. Withdraw recipient must be the
  vault. One in-flight transfer (`pendingAmount` /
  `_getNextNonce` reverts if pending). Incoming CCTP
  tokens are swept entirely to the vault. Balance is
  local USDC + `pendingAmount` + cached
  `remoteStrategyBalance`.
- Balance-check messages must match
  `lastTransferNonce`. Confirmations clear
  `pendingAmount` only when `transferConfirmation` is
  set. Out-of-order or older-than-1-day checks are
  ignored. Stale cache is documented; it is not a
  user mint path (vault `mint` still pulls assets).
- Remote local `deposit` / `withdraw` are
  `onlyGovernorOrStrategist`. CCTP deposit marks the
  nonce, then tries 4626 `deposit` in a try/catch so
  a failed Morpho deposit still sends the
  confirmation (USDC stays on the remote strategy).
  Withdraw sends only if idle USDC covers the
  request; otherwise it tries 4626 withdraw first.

## 2026-09-03: Lombard mailbox admin + consortium valset (`09d5e76`)

Same Lombard Finance program and clone as the token_pool /
ratio_oracle pass above. This pass only covers leftover
admin paths that that write-up did not list.

Files: `programs/mailbox/src/instructions/{enable_inbound_message_path,admin}.rs`,
`programs/consortium/src/instructions/update_valset.rs`,
`utils/session_payloads.rs` (`UpdateValSetPayload` +
`validate_valset`).

Result: no user-exploitable finding.

- Inbound-path enable and treasury / fee / pause-unpause
  are admin-only `init` / config writes.
- `update_valset` requires a current-epoch
  `ValidatedPayload`, hash-matching session payload,
  `epoch == current+1`, incrementing height, unique
  non-zero weights, and `sum(weights) >= threshold`.
  Trusted notary set.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Sky FarmOwner (`dss-flappers` `6f3c910` / `beam`)

Immunefi Sky ($10,000,000, no KYC). In-scope 17 Aug add
`FarmOwner.sol` (paired with already-reviewed `SBEBeam`).
Local clone `/tmp/reviews/dss-flappers` at `6f3c910`.
No mainnet interaction.

File: `src/FarmOwner.sol`.

Checked for: a non-ward calling farm admin; recovered
tokens stranded or sent to the caller; ownership escape
without a ward.

Result: no user-exploitable finding.

- Every forwarded farm method is `auth` (`wards==1`).
  Constructor relies the deployer. `rely` / `deny` are
  ward-gated.
- `recoverERC20` pulls to this contract (the farm owner)
  then `transfer`s `tokenAmount` to ward-chosen `to`.
  Comment documents no fee-on-transfer. Pre-existing
  dust of the same token would ride along or cause the
  transfer to fail — trusted ward, not an external
  drain.
- `nominateNewOwner` / `acceptOwnership` can move farm
  ownership off this adapter. Trusted wards (Pause
  Proxy / SBEBeam).

Not submitted.

## 2026-09-03: Alchemix V3 core money paths (`ea6f58b`)

Immunefi program `alchemix-1` ($150,000 USDC, `kyc:
false`, live). Scope is
`github.com/alchemix-finance/v3/tree/master/src`
(added 6 Apr 2026). The 2025 audit competition is
closed; this is the standing bounty. Local clone
`/tmp/reviews/alchemix-v3` at `ea6f58b`. No mainnet
interaction.

Files: `AlchemistV3.sol` (`deposit`, `withdraw`,
`mint` / `mintFrom`, `burn`, `repay`, `liquidate` /
`batchLiquidate` / `_doLiquidation` /
`calculateLiquidation`, `redeem`, `selfLiquidate`,
`_earmark`, `_sync`, `_computeUnrealizedAccount`,
`_addDebt` / `_subDebt` / `_subCollateralBalance`,
converters), `Transmuter.sol` (create / claim /
pokeMatured), `AlTokenV3.sol` (`burn` / `burnFrom`),
`AlchemistTokenVault.sol`.

Checked for: a deposit that credits without a transfer;
withdraw past the min-collateral lock; mint without an
NFT owner / allowance; same-block mint-repay; burn of
earmarked debt that starves the transmuter; repay that
fees a third party into insolvency; liquidation of a
healthy account or seizure above realized collateral;
permissionless `redeem`; transmuter claim that over-
redeems the alchemist; alUSD burnFrom without allowance.

Result: no exploitable finding on this pass.

- `deposit` writes collateral then `transferFrom`. Cap
  is `_mytSharesDeposited + amount`. `tokenId == 0`
  mints an NFT to `recipient`; a non-zero id accepts
  donated MYT (no owner check). Donation cannot mint
  debt.
- `withdraw` is NFT-owner only, earmarks + syncs, locks
  `mulDivUp(debtShares, minimumCollateralization, 1e18)`,
  then `_validate`. The
  `collateralBalance > _mytSharesDeposited` clamp only
  fires when one account already exceeds global tracked
  shares (prior insolvency / drift).
- `mint` / `mintFrom` owner-or-allowance; `_addDebt`
  requires `collateralValue >= mulDivUp(newDebt, minCR,
  1e18)`. Same-block mint↔repay/burn is blocked both
  ways. `burn` only hits unearmarked debt and caps at
  `totalSyntheticsIssued - transmuter.totalLocked()`.
- `repay` can target any position. Protocol fee is taken
  from the position’s collateral on the earmarked slice
  only (`fee < earmarkedYield` while debt drops by the
  full credit), so a grief-repay cannot push a
  min-CR position under the lock by fee alone. Pulled
  MYT goes to the transmuter; fee MYT from the position
  goes to `protocolFeeReceiver`.
- `liquidate` no-ops on a healthy account (`CR >
  collateralizationLowerBound`) or a zero-price MYT
  share. Earmarked debt is force-repaid from the
  account first. `_doLiquidation` clamps seize / debt
  burn to realized shares and `account.debt`. Residual
  unhealthy + zero collateral uses `_clearableDebt`.
  Liquidator fee is taken from seized MYT or the fee
  vault, never minted.
- `redeem` is `onlyTransmuter`. Survival / earmark
  weights are Q128 packed; `amount` is capped to live
  earmarked. Fee is skipped if tracked MYT cannot cover
  it.
- Transmuter `createRedemption` locks synthetics under
  both `depositCap` and `alchemist.totalSyntheticsIssued`.
  `claimRedemption` is owner-only, not same-block, burns
  the NFT, scales by an up-rounded bad-debt ratio, redeems
  only the shortfall vs already-held MYT, and returns
  leftover synthetics on shortfall. `pokeMatured` only
  frees the active cap.
- `AlTokenV3.burnFrom` deducts allowance unless
  `msg.sender == account`, then optional xERC20 burner
  limits. Token vault: anyone deposits, only authorized
  withdraws.

Remaining Alchemix `src/` after the core pass: concrete
protocol strategies, Euler adapter, `StakingGraph`.

Not submitted.

## 2026-09-03: Alchemix V3 MYT adapter, allocator, router, fee vaults (`ea6f58b`)

Same Immunefi program (`alchemix-1`, $150,000, no KYC).
Same clone `/tmp/reviews/alchemix-v3` at `ea6f58b`. No
mainnet interaction. Continues the alchemist/transmuter
pass with the Morpho-V2 adapter layer and the EOA
router.

Files: `MYTStrategy.sol`, `strategies/ERC4626Strategy.sol`,
`AlchemistAllocator.sol`, `AlchemistGate.sol`,
`AlchemistETHVault.sol`, `adapters/AbstractFeeVault.sol`,
`router/AlchemistRouter.sol`.

Checked for: a non-vault allocate/deallocate; a 0x
swap that drains a protected token; allocator cap
bypass; router depositing into someone else’s NFT or
keeping the position; repay leftover MYT stuck on the
router; ETH receive that steals a WETH unwrap;
unauthorized fee-vault withdraw.

Result: no user-exploitable finding.

- `MYTStrategy.allocate` / `deallocate` are `onlyVault`.
  Kill-switch reverts allocate (it does not silently
  skip). Force-deallocate is limited to `ActionType.direct`
  on strategies that opt in. `dexSwap` pays the owner-
  set 0x allowance holder and enforces `minAmountOut`.
  `rescueTokens` cannot move the MYT asset (or, in
  ERC4626Strategy, the receipt shares). Deallocate
  requires `_totalValue() >= assets` after the pull.
- `AlchemistAllocator` is admin/operator. Caps combine
  vault absolute/relative caps with classifier global
  and (for operators) local risk caps. Swap calldata
  is operator-chosen; `minIntermediateOut` is 0 on the
  swap helpers (trusted operator slippage).
- `AlchemistGate` is an owner-only auth map. Fee vaults
  authorize the alchemist + owner at construct;
  `withdraw` is `onlyAuthorized`. ETH vault unwraps
  WETH, records deposits only as events, and sends ETH
  under a reentrancy guard. `receive()` donations add
  to `totalDeposits` without a depositor credit.
- Router holds no funds between txs. Existing-position
  deposit/withdraw/self-liquidate require
  `ownerOf == msg.sender`. New positions mint to the
  router then transfer the NFT to the caller. Borrow on
  an existing id uses `mintFrom` (needs `approveMint`).
  NFT custody is documented to reset mint allowances.
  Repay refunds unused MYT via a pre/post balance
  delta. `receive` only accepts ETH while `_ethExpected`
  is set around WETH unwrap.

Remaining Alchemix after the adapter pass: none of the
previously listed leftover files (see the strategies
pass below).
Not submitted.

## 2026-09-03: Alchemix V3 concrete strategies + Euler + StakingGraph (`ea6f58b`)

Same Immunefi program (`alchemix-1`, $150,000, no KYC).
Same clone `/tmp/reviews/alchemix-v3` at `ea6f58b`. No
mainnet interaction.

Files: `strategies/{Aave,Moonwell,EtherfiEETH,SFraxETH,SiUSD,StakeDAOWETH,TokeAuto,WstETHEthereum,WstETHL2,OraclePricedSwap}Strategy.sol`,
`adapters/EulerUSDCAdapter.sol`,
`libraries/StakingGraph.sol`.

Checked for: a non-vault pull of aTokens / mTokens /
weETH / vault shares; an oracle-priced swap that
accepts a stale or zero answer; deallocate that
approves more than the vault requested; Enso / 0x
calldata that a user can inject; Fenwick overflow that
inflates transmuter earmarks; Euler adapter minting
or moving USDC.

Result: no user-exploitable finding.

- All `_allocate` / `_deallocate` overrides still run
  only through `MYTStrategy` `onlyVault`. Idle-balance
  checks and a final approve-to-`msg.sender` (the MYT)
  are the common exit. Force-deallocate stays
  opt-in (`canForceDeallocate`) and direct-only.
- `OraclePricedSwapStrategy` requires `raw > 0`,
  `updatedAt != 0`, and `block.timestamp - updatedAt
  <= MAX_ORACLE_STALENESS`. Swap min-out is oracle *
  (1 - slippageBPS). Owner can retarget the feed.
  Child wstETH / sfrxETH / weETH / siUSD paths convert
  wrapped balances into oracle units before the swap
  cap. L2 has no sequencer-uptime check (owner
  staleness).
- Aave supplies/withdraws via the provider pool;
  aToken is protected. `adminDexSwap` is owner-only.
  Moonwell mints/redeems with error-code checks,
  `ceilDiv` on redeem, and optional ETH→WETH wrap.
- Ether.fi instant redeem sizes weETH from the
  liquidity-pool share math plus exit fee and a
  bounded `grossRedeemAmountBuffer`; it reverts when
  `canRedeem` is false. sFRAX deposit is
  unwrap-WETH→minter; swap-deallocate unwraps sfrxETH
  to frxETH first. siUSD uses InfiniFi
  `mintAndStake` / `unstake`+`redeem(..., shortfall)`.
- StakeDAO: Curve add/remove with virtual-price and
  absolute LP floors; Enso routes are operator
  calldata with a min-out and a post-hoc LP-spent
  ceiling. Tokemak: deposit NAV floor, direct redeem
  through Autopilot with `execToleranceBps` (cap 650)
  and a NAV-anchored min-out; route calldata requires
  `minAmountOut >= shortfall`.
- `EulerUSDCAdapter` is a `convertToAssets` price
  view only. `StakingGraph` packs a 112/144 Fenwick
  tree, reverts on delta/product overflow, and
  `queryStake` clamps to `g.size`. Transmuter never
  queries start block 0 (would underflow `start--`).

Alchemix V3 `src/` money-moving trees treated as
exhausted. Not submitted.

## 2026-09-03: Origin ARM CapManager + Morpho/Silo 4626 wrappers (`2322537`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
USDC ARM CapManager, WETH/Lido ARM Morpho markets, and
USDC ARM Aave market (same 4626 wrapper) continue the
ARM adapter slice. Local clone `/tmp/arm-oeth` at
`2322537`. No mainnet interaction.

Files: `src/contracts/CapManager.sol`,
`src/contracts/markets/{Abstract4626MarketWrapper,MorphoMarket,SiloMarket}.sol`.

Checked for: a non-ARM deposit/withdraw that mints
market shares to a third party; CapManager hook that
a user can skip or raise their own cap; reward collect
that sends MORPHO/Silo incentives off-harvester;
`transferTokens` of the market share token.

Result: no user-exploitable finding.

- `CapManager.postDepositHook` is ARM-only. It checks
  `totalAssetsCap >= arm.totalAssets()` after the
  deposit and, when account caps are on, decrements
  the LP’s remaining cap (`oldCap >= assets`). Caps
  and the total cap are operator/owner. Setting the
  total cap to 0 only blocks further deposits.
- `Abstract4626MarketWrapper.deposit` /
  `withdraw` / `redeem` require
  `msg.sender == receiver == owner == arm`. Shares
  are minted to the wrapper, assets return to the ARM.
  `balanceOf` / `maxWithdraw` / `maxRedeem` report 0
  for any other owner. `collectRewards` is
  harvester-only. `merkleClaim` is permissionless but
  always claims for `address(this)`.
  `transferTokens` is owner-only, cannot move the
  market share token, and can only pay owner or
  harvester.
- `MorphoMarket` only forwards MORPHO balance to the
  harvester. `SiloMarket` claims gauge rewards to the
  harvester. USDC ARM “AAVE Market” is this same
  wrapper over a 4626 Aave market.

Remaining Origin in-scope: xOGN token
(`0x63898b3b6Ef3d39332082178656E9862bee45C57`) is not
in origin-dollar or arm-oeth.

Not submitted.

## 2026-09-03: Origin xOGN ExponentialStaking (`eff0d3d`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
xOGN (`0x63898b3b6Ef3d39332082178656E9862bee45C57`) is
Staked OGN. Source is `OriginProtocol/ousd-governance`,
not origin-dollar. Local clone `/tmp/ousd-governance`
at `eff0d3d`. No mainnet interaction.

Files: `contracts/ExponentialStaking.sol`,
`contracts/RewardsSource.sol`.

Checked for: unstaking another account’s lockup;
gifting a stake that also restakes the recipient’s
rewards; collecting rewards for a third party;
transferring xOGN voting points; RewardsSource mint
to a non-target.

Result: no user-exploitable finding.

- `transfer` / `transferFrom` revert. Points are
  soulbound. `stake` always `transferFrom`s
  `msg.sender`. Gifting (`to != msg.sender`) forbids
  `stakeRewards` and lockup extension. `_collectRewards`
  for the recipient pays that user’s pending OGN to
  them, then mints only the new points.
- `unstake` reads `lockups[msg.sender]`. Early-exit
  penalty goes to `rewardsSource`; remainder to the
  staker. Lockup slots are deleted, indexes stay
  stable.
- `collectRewards` is `msg.sender` only. Global
  `accRewardPerShare` is updated from the
  `rewardsSource` delta before the user’s debt is
  settled. `rewardsSource.collectRewards` is
  try/catch so a rewards failure does not brick
  staking.
- `RewardsSource.collectRewards` requires
  `msg.sender == rewardsTarget` (the xOGN contract).
  Inflation slopes and the target are governor-only.
  Rate is capped at 5M OGN/day.

Origin Sep-1 / ARM / xOGN smart-contract trees that
were listed as remaining are now exhausted.

Not submitted.

## 2026-09-03: Horizen ZenStaker + RewardAccumulator (`ab92502`)

Immunefi program Horizen ($10,000, `kyc: true`). GitHub
assets added 20 Jul 2026 at the testnet merge commit.
Local clone `/tmp/horizen-staker` at `ab92502`. No
mainnet or testnet interaction.

Files: `src/{ZenStaker,Staker,RewardAccumulator,DelegationSurrogate}.sol`,
`src/extensions/StakerPermitAndStake.sol`.

Checked for: withdrawing another account’s deposit;
claiming another deposit’s rewards; `notifyRewardAmount`
from a non-notifier; RewardAccumulator notify that
credits more than transferred; stake/reward token
commingling (ZEN-on-ZEN).

Result: no user-exploitable finding.

- `ZenStaker` inherits Tally `Staker` unchanged for
  writes. Stake pulls ZEN from the caller into a
  per-delegatee `ZenDelegationSurrogate` (max-approve
  back to the staker). Withdraw/claim require owner
  (and claimer for rewards). Payouts go to owner /
  caller. Claim fee is hardcoded 0; `maxBumpTip` is
  constructor-set (Phase 1: 0).
- `notifyRewardAmount` is notifier-only. It
  checkpoints, stretches the remaining stream over
  `REWARD_DURATION`, and reverts if
  `rate * duration > this.balance`. Staked ZEN lives
  on surrogates, so the balance check sees only
  reward inventory on the staker.
- `RewardAccumulator.transferAndNotifyRewards` /
  `notifyAlreadyTransferredRewards` are whitelist-
  gated (or open if whitelist is off). Notify of
  already-transferred tokens requires
  `balance - accumulated >= amount`.
  `sendRewardsToStaker` is permissionless after the
  window, transfers `accumulatedRewards`, then
  `notifyRewardAmount`. Un-notified donations stay
  stuck; they are not an extract.
- `permitAndStake` swallows a failed permit then
  `transferFrom` (standard). Surrogate holds tokens
  with no extra functions.

Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: Origin CoW harvester + live xOGN rewards + Governor (`4fa0602` / `eff0d3d`)

Immunefi program `originprotocol` ($1,000,000, `kyc: false`).
The Sep-1 list still had “OUSD CoW Harvester”
`0xD400341aEfED0BC75176714cFdE82e8BDAA2D3b8`,
Origin Governance, and Origin Timelock after the ARM /
xOGN pass. The live xOGN rewards proxy is
`FixedRateRewardsSource`, not the inflation
`RewardsSource` file in the earlier xOGN note. Local
clones `/tmp/origin-dollar` `4fa0602` and
`/tmp/ousd-governance` `eff0d3d`. No mainnet
interaction.

Files: `contracts/harvest/HarvestingEIP1271.sol`,
`contracts/harvest/{AbstractHarvester,SimpleHarvester}.sol`
(read to confirm the CoW address is not that path),
`contracts/ExponentialStaking.sol` (already logged;
rewards target only), `contracts/FixedRateRewardsSource.sol`,
`contracts/Governance.sol`.

Checked for: an EIP-1271 magic-value on an order the bot
did not sign; a reconstructed digest that is not the CoW
EIP-712 hash; a permissionless harvest that pays the
caller more than `harvestRewardBps`; FixedRate rewards
mint or a non-target collect; Governor threshold /
timelock bypass.

Result: no user-exploitable finding.

- `HarvestingEIP1271` is the CoW harvester at
  `0xD400…`. `isValidSignature` decodes
  `(Order, r, s, v)`, requires
  `_hashOrder(order, COW_DOMAIN_SEPARATOR) == hash`,
  then `ecrecover` of
  `"\x19COWSWAP order digest:\n32" || hash` equals
  `bot`. `_isOrderValid` requires an enabled sell
  token, allow-listed buy token and receiver, fill-or-kill,
  `feeAmount == 0`, `validTo >= now`, and
  `sellAmount >= minSellAmount`. There is no min
  `buyAmount` / price bound — the bot is trusted.
  `kind` / balance enums are unchecked; CoW settlement
  still pulls only the approved `sellToken` via
  `VAULT_RELAYER`. `setTokenConfig` max-approves the
  relayer; `disableToken` zeros it. `transferTokens`
  cannot move an enabled sell token. Ownership cannot
  be renounced. Domain separator is snapshotted at
  deploy from ComposableCoW.
- `AbstractHarvester.harvestAndSwap` is permissionless
  but the implementation now calls
  `_swap(..., IOracle(address(0x1)))` and comments that
  this harvester is unused. The in-scope CoW address is
  `HarvestingEIP1271`, not this path.
  `SimpleHarvester` is strategist/governor for support
  flags; harvest itself is open but only forwards
  collected rewards to dripper (wrapped native) or
  strategist.
- Live xOGN rewards (`010_xOGNSetupScript`) initialize
  `FixedRateRewardsSource` with `rewardsTarget = xOGN`.
  `collectRewards` is target-only, pays
  `min(elapsed * rewardsPerSecond, balance)`, and does
  not mint. Rate / target / strategist are
  governor-or-strategist. Changing a non-zero rate
  accrues past time at the new rate (documented). The
  unused `RewardsSource` inflation minter is not the
  proxy implementation.
- `Governance` is an OZ GovernorSettings + Bravo +
  quorum-fraction + timelock + late-quorum wrapper
  (1-day voting delay, ~2-day period, 100k xOGN
  threshold, 20% quorum). No custom execute path.

Origin Sep-1 Solidity named on Immunefi, including the
CoW harvester and governance/timelock wrappers, is
exhausted. Not submitted.

## 2026-09-03: 1inch Aqua solidity-utils mixins + libraries (`5b597e4`)

Same Immunefi program `1inch-aqua` ($100k, KYC). Local clone
`/tmp/reviews/1inch-solidity-utils` at `5b597e4`. No
mainnet interaction. Aqua opcodes / core already logged.

Files: `contracts/mixins/{Simulator,Multicall,Rescuable,
EthReceiver,OnlyWethReceiver}.sol`,
`contracts/libraries/{SafeERC20,ECDSA,UniERC20,
TransientLock,Transient,Calldata,CalldataPtr,
RevertReasonForwarder,StringUtil}.sol`.

Composition on this program: `AquaRouter` is
`Aqua + Simulator + Multicall + Rescuable`.
`AquaSwapVMRouter` is `Simulator + SwapVM + AquaOpcodes`
(`SwapVM` is `OnlyWethReceiver + Rescuable`).

Checked for: `simulate` that persists a drain if a
later revert is swallowed; `multicall` msg.value
reuse against a payable Aqua path; `rescueFunds` that
pulls a maker’s shipped allowance; permit assembly
that approves a third-party spender; ECDSA recover
that accepts a high-`s` malleable signature;
transient lock that unlocks a different slot.

Result: no user-exploitable finding.

- `Simulator.simulate` always `revert Simulated(...)`
  after the delegatecall. A parent `try/catch` still
  reverts that frame, so token/ETH moves inside the
  simulation unwind. Empty storage on the mixin;
  no collision with Aqua `_balances` or Ownable.
- `Multicall` delegatecalls `address(this)` and
  bubbles the first revert. Aqua `ship` / `dock` /
  `pull` / `push` are not payable. Sending ETH with
  `multicall` can only donate to the router; the
  owner can `rescueFunds` it. Not an extract.
- `Rescuable.rescueFunds` is `onlyOwner` and
  `uniTransfer`s the router’s own balance. Aqua
  accounting is virtual; makers keep tokens and
  grant allowance. Owner cannot pull a shipped
  maker inventory.
- `SafeERC20.tryPermit` dispatches by length
  (compact/full ERC-2612, DAI, Permit2, ERC-7597
  default). Owner/spender are taken from the
  Solidity arguments, not from attacker-controlled
  permit body on the compact paths. Compact
  deadline/expiry are documented as `stored - 1`.
- `ECDSA.recover` rejects `s >= n/2 + 1` and leaves
  `signer == 0`. `recoverOrIsValidSignature`
  refuses `address(0)` before EIP-1271. Compact vs
  65-byte malleability is documented; Aqua order
  hashes are not invalidated by raw signature
  bytes (Aqua mode hashes the order; signed mode
  uses EIP-712).
- `TransientLib` tstore/tload at `slot + OFFSET`.
  `TransientLock.lock` requires `inc() == 1`.
  `Calldata.slice` unchecked variants are
  caller-gated; the bounds-checked overloads
  revert on `end > length`.
- `EthReceiver` rejects EOA `tx.origin` deposits.
  `OnlyWethReceiver` accepts only the constructor
  WETH. `UniERC20` treats `address(0)` and
  `0xEeee…` as native; `uniTransferFrom` refunds
  excess `msg.value` to `from` and forbids
  `from != msg.sender`.

Aqua-listed solidity-utils files treated as
exhausted. Do not submit. Payment requires user KYC.

## 2026-09-03: 1inch-aqua-improvement is a different program (no proposal)

Unofficial mirror slug `1inch-aqua-improvement` ($25k, KYC, not
paused, last updated 18 Aug 2026). Same GitHub blobs as
`1inch-aqua`, but the published rules are an **improvement
proposal** bounty, not a second vuln book: OOS includes new
protocol mechanics / feature requests, micro gas (< 1k), pure
refactors, and proposals without the required demonstration.
`ReserveFloor` / AquaFloor is therefore an ETHOnline app
(`aqua-app/DESIGN.md`), not an Immunefi submission. No
improvement proposal from this pass.

## 2026-09-03: Alchemix V3 leftover curator / gauge / 0x / NFT (`ea6f58b`)

Same Immunefi program (`alchemix-1`, $150,000, no KYC).
Same clone `/tmp/reviews/alchemix-v3` at `ea6f58b`. No
mainnet interaction. Closes the leftover `src/` files
after the strategies pass.

Files: `AlchemistCurator.sol`,
`AlchemistStrategyClassifier.sol`,
`AlchemistV3Position.sol`,
`AlchemistV3PositionRenderer.sol`, `PerpetualGauge.sol`,
`FrxEthEthDualOracleAggregatorAdapter.sol`,
`utils/{PermissionedProxy,Whitelist,ZeroXSwapVerifier}.sol`,
`libraries/{FixedPointMath,TokenUtils,SafeERC20,Sets,SafeCast,NFTMetadataGenerator}.sol`,
`external/AlEth.sol`.

Checked for: a non-operator addAdapter / cap raise; NFT
mint or burn outside the alchemist; a user-callable
gauge allocate that ignores risk caps; 0x calldata that
swaps a protected token; an oracle adapter that a user
can point at a stale feed; permissionless alETH mint.

Result: no user-exploitable finding.

- Curator add/remove/cap paths are `onlyOperator` /
  `onlyAdmin`. Immediate `setStrategy` writes
  `adapterToMYT` then `addAdapter`; submit helpers only
  `vault.submit`. `removeStrategy` uses the mapped MYT,
  not the `myt` argument. `PermissionedProxy.proxy` is
  operator-only and selector-gated.
- Classifier defaults unassigned ids to risk 0 (100% /
  100% caps). Admin-only writes. Trusted omission, not
  a user extract.
- Position NFT mint/burn is alchemist-only.
  `_update` resets mint allowances before transfer
  (already noted on the router). Renderer is metadata.
- `PerpetualGauge` is unfinished: `strategyList` is
  never pushed (`registerNewStrategy` only stamps
  `lastStrategyAddedAt` and is permissionless), so
  `executeAllocation` always reverts `No allocations`.
  Vote power is live `balanceOf` with no checkpoint
  (transfer-then-revote would leave stale weight if
  the list were ever wired). Caps divide WAD by `1e4`
  instead of `1e18`. Tests comment the TODO. Not
  submitted: no live allocate path.
- `ZeroXSwapVerifier` is not imported by any production
  strategy. Fill parsers are marked TODO; `buyToken` is
  unchecked. Dead code until an allocator uses it.
- Frax dual-oracle adapter synthesizes `updatedAt =
  block.timestamp` (documented). Combined with the
  already-logged owner staleness on oracle-priced
  strategies. Not a user-set feed.
- `AlEth.sol` comments say it is modified for V3
  invariant testing; `setWhitelist` / `pauseAlchemist`
  / `setCeiling` have no access control. Production
  token is `AlTokenV3` (already reviewed).
- Libraries are standard mulDiv / safe ERC20 / 1-based
  address set / NFT SVG.

Alchemix V3 `src/` treated as exhausted. Not submitted.

## 2026-09-03: Enzyme Blue gated redemption wrapper + share-price throttle (`da3b870`)

Immunefi program `enzymefinance` ($200,000, `kyc: false`).
Newest GitHub-adjacent add is
`GatedRedemptionQueueSharesWrapperFactory`
(etherscan, 17 Aug 2026). Local clone
`/tmp/reviews/enzyme-protocol` at `da3b870`. No mainnet
interaction. Distinct from the already-logged
`enzyme-onyx` ACE tree.

Files:
`contracts/persistent/shares-wrappers/gated-redemption-queue/{GatedRedemptionQueueSharesWrapperFactory,GatedRedemptionQueueSharesWrapperLib,IGatedRedemptionQueueSharesWrapper,bases/GatedRedemptionQueueSharesWrapperLibBase1}.sol`,
`contracts/persistent/smart-accounts/share-price-throttled-asset-manager/{SharePriceThrottledAssetManagerFactory,SharePriceThrottledAssetManagerLib}.sol`.

Checked for: a deposit that mints wrapped shares without
pulling assets; queue cancel after the manager has
already tallied the request; redeem outside the window
or above the relative cap; kick / force-transfer by a
non-owner; throttle that lets a signer exceed
`lossTolerance` in one multicall.

Result: no user-exploitable finding.

- Factory `deploy` requires a dispatcher-known vault
  and inits the beacon proxy in the constructor.
  `setImplementation` is dispatcher-owner only.
- Direct `deposit` pulls (or wraps native), deposits
  via `GlobalConfig.formatDepositCall`, and mints the
  vault-share delta. Request mode escrows the asset;
  cancel refunds the queued amount. Manager
  `__depositFromQueue` removes requests before the
  vault call (cancel then reverts `No request`) and
  pro-rata mints (floored dust stays as unwrapped
  vault shares, documented).
- `requestRedeem` / `cancelRequestRedeem` revert in
  the latest window. Transfers cannot move shares
  that are queued. `redeemFromQueue` is
  manager/owner, window-gated, checkpoints
  `relativeSharesAllowed` from wrapped supply × cap,
  burns, then redeems and disperses by redeemed
  shares. Native payouts use `sendValue` (a rejecting
  recipient reverts the slice).
- `kick` / `forceTransfer` / manager approvals are
  privileged. The lib header states holders must
  trust the vault owner, who can appropriate value.
- Throttled smart account `executeCalls` snapshots
  gross share value, runs the owner multicall, then
  adds replenished cumulative relative loss. A 0
  `lossTolerancePeriodDuration` would revert on
  replenish (owner config). Shutdowner zeros the
  owner.

Not submitted.

## 2026-09-03: Charm Alpha Pro Vault (`0174095`)

Immunefi program `charm` ($10,000, `kyc: false`).
In-scope files are the three GitHub blobs below.
Local clone `/tmp/reviews/charm-vaults` at `0174095`.
No mainnet interaction.

Files: `contracts/AlphaProVault.sol`,
`contracts/AlphaProVaultFactory.sol`,
`contracts/CloneFactory.sol`.

Checked for: first-deposit share inflation; withdraw
that pulls more than the share of idle + three UniV3
positions; a non-pool mint/swap callback; rebalance
that a user can run inside the TWAP / period guards;
`sweep` of token0/token1; protocol+manager fee
overflow.

Result: no user-exploitable finding.

- `deposit` pokes all three ranges, sizes from
  `getTotalAmounts()`, pulls, then mints. First
  depositor locks `MINIMUM_LIQUIDITY` (1e3) on the
  factory and needs `max(amount0, amount1) > 1e3`.
  `amount0Min` / `amount1Min` are the sandwich
  defense the comment describes.
- `withdraw` burns first, then idle × shares /
  supply plus `_burnLiquidityShare` on full/base/
  limit. Collect takes the whole position’s owed
  fees; the withdrawer only receives
  `fees * shares / totalSupply` after protocol and
  manager cuts. Leftover fees stay idle for other
  LPs.
- Mint/swap callbacks require `msg.sender == pool`.
  The vault never starts a swap; the swap callback
  is unused.
- `rebalance` is permissionless when
  `rebalanceDelegate == 0`, else manager/delegate,
  and still needs `checkCanRebalance` (period, min
  tick move, TWAP deviation, tick bounds). Manager
  `emergencyBurn` returns tokens to the vault, not
  the manager. `sweep` cannot move token0/token1.
- Factory and vault cap protocol and manager fees at
  20% each (`20e4 / 1e6`). Combined 40% cannot
  underflow `1e6 - protocol - manager`.

Not submitted.

## 2026-09-03: DeFi Saver V3 executor + FL + auth (`e623f20`)

Immunefi program `defisaver` ($350,000, `kyc: false`).
GitHub asset `defisaver-v3-contracts/tree/main/contracts`
(excluding `mocks` and `views`), added 24 Sep 2025.
Local clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction. First slice: the wallet
execution spine, not protocol-specific actions.

Files: `contracts/core/RecipeExecutor.sol`,
`contracts/core/strategy/{StrategyExecutor,StrategyExecutorCommon,ProxyAuth,SafeModuleAuth,BotAuth,WalletAuth,SubStorage,SubProxy}.sol`,
`contracts/auth/{Permission,DSProxyPermission,AdminAuth}.sol`,
`contracts/actions/flashloan/{FLAction.sol,helpers/FLHelper.sol}`.

Checked for: a bot executing a sub it does not own;
a strategy hash mismatch that still runs; FL callback
from a non-lender or a swapped recipe; leftover
execute-permission on the wallet after FL; Aave
`modes` / `onBehalfOf` that opens debt on a third
party; `executeActionsFromFL` callable without a
live FL.

Result: no user-exploitable finding on this slice.

- `executeRecipe` is meant to be delegatecalled from
  the user’s wallet. Direct calls run actions in the
  RecipeExecutor’s own context (no user inventory).
- Strategy path: `BotAuth` owner-approved callers,
  stored `strategySubHash` must match, sub must be
  enabled. `ProxyAuth` / `SafeModuleAuth` are
  `onlyExecutor`. Triggers run before actions;
  one-shot strategies `deactivateSub` as the wallet
  (owner). Changeable triggers update via the same
  owner check.
- FL: RecipeExecutor grants the FL action execute /
  module rights, calls `executeAction` on FLAction
  (not a delegatecall), then revokes. Callbacks
  require the matching lender and, where the
  interface has an initiator, `address(this)`.
  Funds go to the encoded wallet; payback is an
  exact balance check (stETH 2-wei faucet exception).
  `_executeRecipe` re-enters the wallet →
  `executeActionsFromFL` (skips index 0). UniV3
  verifies `getPool(token0, token1, fee)`.
- Aave/Spark `modes` / `onBehalfOf` are user-chosen.
  Debt mode still has to satisfy the payback
  balance check, so a third-party credit-delegate
  cannot be left with unpaid FL debt through a
  successful callback.
- `SubProxy.subscribeToStrategy` (wallet context)
  enables ProxyAuth / SafeModuleAuth. Sub ids are
  wallet-owned.

Remaining DFS: `exchangeV3`, protocol `actions/*`
(Aave/Morpho/Compound/Liquity/…), `tx-saver`,
triggers. Not submitted.

## 2026-09-03: Jito stake-deposit-interceptor (`dbd8ce4`)

Immunefi program `jito` ($250,000, KYC). In-scope tree
`jito-foundation/stake-deposit-interceptor`. Local clone
`/tmp/jito-interceptor` at `dbd8ce4`. No mainnet
interaction. Three published audits (Offside 2024-11,
Certora 2024-12, Certora Coinbase integration 2026-03).

Files: `stake_deposit_interceptor/src/{processor,state,state/hopper,instruction,error,entrypoint}.rs`.
API / cranker / CLI not reviewed (off-chain).

Checked for: init that binds the wrong pool mint or a
writable vault an attacker owns; update that a
non-authority can flip `fee_wallet` / whitelist program;
deposit that credits a receipt to a third party without
the staker’s authorize; claim that drains the vault past
`lst_amount`; permissionless post-cooldown claim to a
non-owner ATA; whitelist deposit that skips the list;
hopper rebate or `WithdrawFromHopper` that a user can
point at themselves.

Result: no user-exploitable finding.

- Init caps `initial_fee_bps` at 10_000, derives the
  authority PDA from `stake_pool + base`, and forces
  `vault` to the ATA of that PDA. Stake-pool program
  and mint owners are checked. The `authority` account
  does not sign (the pool manager later points
  `stake_deposit_authority` at the PDA).
- Update is current-authority signer only. Existing
  receipts snapshot `cool_down_seconds` /
  `initial_fee_bps` at deposit, so a later admin raise
  does not reprice them.
- `DepositStake` CPIs SPL `DepositStake` signed by the
  interceptor PDA and records `vault.amount` delta.
  `owner` is an instruction arg because the stake
  account’s withdrawer is already the PDA (same as
  vanilla SPL stake-pool after `Authorize`). Receipt
  PDA is `deposit_receipt + pool + base`.
- Claim: during cooldown the owner must sign; after
  cooldown the path is permissionless but destination
  ATA owner must equal `receipt.owner` and fee ATA
  owner must equal `fee_wallet`. Transfers use
  `transfer_checked` with the authority PDA. Receipt
  closes to `owner`. Linear fee uses `div_ceil` (rounds
  against the depositor; 1-lamport dust case is
  tested).
- Whitelisted deposit / withdraw require the signer
  in `jito_whitelist_management` and CPI through the
  stored stake-pool program. Destination of minted LST
  is caller-chosen by design (Coinbase path). Hopper
  rebate is `min(fee_lamports, hopper - rent)`; empty
  hopper does not fail the withdraw. Hopper drain is
  authority-only.

Jito interceptor on-chain program treated as exhausted.
Restaking `restaking_*` / `vault_*` and `jito-solana` /
`mev-programs` remain. Do not submit. Payment requires
user KYC.

## 2026-09-03: Money on Chain V2 governance machines (`d770477`)

Same Immunefi program `moneyonchain` ($10,000, `kyc: true`).
Local clone `/tmp/reviews/moneyonchain` at `d770477`.
Core / queue / V4 swapper already logged. No mainnet
interaction.

Files: `contracts/governance/{InterimGovernor,Governed,
Stoppable,MocUpgradable}.sol`,
`contracts/governance/changerTemplates/{Governance,
AddBucket,EditBucket,AddPeggedToken,EditPeggedToken,
UpgraderUUPS}ChangerTemplate.sol`.

Checked for: a permissionless `execute()` that changes
governor, upgrades a UUPS proxy, or grants TP minter
roles; `changeGovernor` callable by a non-changer;
pauser that can unpause without being pauser or
authorized; UUPS `_authorizeUpgrade` open.

Result: no user-exploitable finding.

- Changer `execute()` is intentionally ungated. The
  productive calls (`changeGovernor`, `addBucket`,
  `editBucket`, `addPeggedToken`, `editPeggedToken`,
  `upgradeTo`) sit behind `onlyAuthorizedChanger` on
  the target. Areopagus (and `InterimGovernor`) only
  treat the current change contract / owner as
  authorized. A direct `execute()` from a random
  caller reverts on that check.
- `InterimGovernor.executeChange` / 
  `isAuthorizedChanger` are owner-only. Production
  governor is Areopagus, not this file.
- `Governed.changeGovernor` is
  `onlyAuthorizedChanger`. `Stoppable.pause` is
  pauser-only; `unpause` is pauser or authorized
  changer. `makeUnstoppable` / `setPauser` are
  changer-only.
- `MocUpgradable._authorizeUpgrade` is
  `onlyAuthorizedChanger`.
- Add-bucket / add-TP templates also
  `grantRole(MINTER/BURNER)` on the TP; that needs
  admin on the token, which the changer does not
  have unless governance already arranged it.

V2 governance tree treated as exhausted. Remaining
MoC: live Rootstock v1 proxy implementations (not
this repo). Not submitted. Payouts need Immunefi KYC.

## 2026-09-03: DeFi Saver exchangeV3 + sell actions (`e623f20`)

Same Immunefi program (`defisaver`, $350,000, `kyc: false`).
Same clone `/tmp/defisaver-v3` at `e623f20`. No mainnet
interaction. Follows the already-logged executor / FL /
auth spine.

Files: `contracts/exchangeV3/DFSExchange{Core,Helper,Data,WithTxSaver}.sol`,
`registries/{WrapperExchangeRegistry,ExchangeAggregatorRegistry,TokenGroupRegistry}.sol`,
`offchainWrappersV3/{OneInch,Zerox,Paraswap,Odos,KyberAggregator,Bebop,Pendle}Wrapper.sol`,
`onchainWrappersV3/{Uniswap,UniV3,Kyber,Curve}WrapperV3.sol`,
`contracts/actions/exchange/{DFSSell,DFSSellNoFee,LSVSell,LimitSell,LimitSellL2,LimitOrderSubProxy}.sol`.

Checked for: an unregistered wrapper or aggregator
call; off-chain `takeOrder` that keeps src and still
returns false so `_executeSwap` double-spends; dest
amount taken from a lying wrapper return; `minPrice`
checked against pre-fee src; recipe fee divider of 1;
Pendle calldata that spends more than the post-fee
src; LimitSell gas fee above the fill; TxSaver
injection of an unregistered wrapper.

Result: no user-exploitable finding.

- Off-chain path requires both
  `ExchangeAggregatorRegistry` and
  `WrapperExchangeRegistry`. On-chain `sell` requires
  the wrapper registry. Owner-only add/remove.
- `takeOrder` on the 1inch-style wrappers always
  `sendLeftover` src+dest+ETH to `msg.sender` (the
  wallet) before returning. A failed aggregator call
  refunds src, then the on-chain fallback spends the
  wallet’s refunded balance — not a second pull of
  already-consumed tokens. Zero dest on success
  reverts `ZeroTokensSwapped`.
- `_sell` records dest by wallet balance delta, not
  the wrapper return. Slippage is
  `wmul(minPrice, srcAmount)` after the DFS fee is
  subtracted (user-favorable vs the pre-fee amount).
  `minPrice` is caller-chosen except LimitSell, which
  requires it equal the trigger `CURR_PRICE`.
- Recipe `DFSSell` replaces any `dfsFeeDivider` other
  than 400 with `TokenGroupRegistry.getFeeForTokens`
  (standard 400, same-group 1000, banned src 0).
  Direct sells and `DFSSellNoFee` take no DFS fee.
  `getFee` is skipped when `Discount.serviceFeesDisabled`.
- Pendle does not patch calldata with the post-fee
  amount (documented: use `DFSSellNoFee`). A mismatch
  fails the call or refunds leftover; it does not
  spend more than the transferred src.
- LimitSell gas fee is capped at 20% of dest.
  TxSaver injects wrapper/off-chain data from
  transient storage set by the already-reviewed
  executor; injected addresses still hit the
  registries.

exchangeV3 + sell actions treated as exhausted.
Remaining DFS: protocol `actions/*` (Aave / Morpho /
Liquity / CurveUsd swappers / …) and `tx-saver`
beyond the gas-cost hook already read here. Not
submitted.

## 2026-09-03: DeFi Saver Morpho Blue actions (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/morpho-blue/{MorphoBlueBorrow,
MorphoBlueSupply,MorphoBlueWithdraw,MorphoBluePayback,
MorphoBlueSupplyCollateral,MorphoBlueWithdrawCollateral,
MorphoBlueSetAuth,MorphoBlueSetAuthWithSig,
MorphoBlueReallocateLiquidity,MorphoBlueClaim,
MorphoTokenWrap}.sol`,
`helpers/MorphoBlueHelper.sol`.

Checked for: borrow/withdraw `onBehalf` of a third
party without Morpho authorization; SetAuth that a
bot can flip on a wallet the user did not sign;
claim that pulls another account’s merkle rewards;
reallocate that drains a user’s Morpho position.

Result: no user-exploitable finding.

- Actions run via wallet delegatecall, so Morpho
  sees `msg.sender` as the wallet. `onBehalf == 0`
  defaults to the wallet. Borrow / withdraw /
  withdrawCollateral against another `onBehalf`
  require Morpho `isAuthorized`. Tokens go to the
  recipe’s `to`.
- `SetAuth` calls `setAuthorization` as the wallet
  (user-signed recipe or official strategy).
  `SetAuthWithSig` only relays a valid Morpho
  authorization signature.
- `Payback` accrues, caps at current debt, and
  repays shares on max so leftover loan tokens are
  not over-pulled past debt (pull is the capped
  amount).
- `ReallocateLiquidity` is a thin
  `PublicAllocator.reallocateTo` loop. That path is
  permissionless on Morpho vaults; it does not
  touch the wallet’s position.
- `Claim` claims `address(this)` then
  `withdrawTokens` to `to`. Wrap deposits legacy
  MORPHO into the hardcoded wrapper for `to`.

Remaining DFS protocol actions: Aave / Liquity /
CurveUsd / Fluid / Euler / … Not submitted.

## 2026-09-03: DeFi Saver Liquity V2 trove + SP (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/liquityV2/trove/{LiquityV2Open,
LiquityV2Borrow,LiquityV2Withdraw,LiquityV2Close,
LiquityV2Adjust,LiquityV2AdjustZombieTrove,
LiquityV2Payback,LiquityV2Supply,LiquityV2Claim}.sol`,
`stabilityPool/{LiquityV2SPDeposit,LiquityV2SPWithdraw,
LiquityV2SPClaimColl}.sol`,
`helpers/LiquityV2Helper.sol`.

Checked for: open/borrow on a trove the wallet does
not own; close that sends more coll than the trove
returned; payback past `MIN_DEBT` that bricks the
trove; SP withdraw of another depositor; WETH max
open that spends the gas-compensation lock as coll.

Result: no user-exploitable finding.

- Open always sets Liquity `owner` to `address(this)`
  (the wallet). `troveId = keccak256(wallet,
  ownerIndex)`. 0.0375 WETH gas lock is pulled in
  addition to coll; WETH-max open subtracts that
  lock before `openTrove`. BOLD minted is sent to
  `to`.
- Borrow / withdraw / adjust / close / addColl call
  `BorrowerOperations` as the wallet. Liquity
  requires the caller to be owner or manager. A
  third-party `troveId` reverts.
- Close pulls `entireDebt` BOLD, then sends
  `entireColl` (+ gas lock if WETH market) to `to`.
  Payback / adjust-payback cap at
  `entireDebt - MIN_DEBT`.
- SP deposit/withdraw/claim use `address(this)` as
  the depositor. Gains are snapshotted, then claimed
  in the same call, then sent to the recipe
  recipients.

Remaining DFS protocol actions: Aave / CurveUsd /
Fluid / Euler / Liquity V1. Not submitted.

## 2026-09-03: DeFi Saver Fluid T1 + liquidity logic (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/fluid/vaultT1/{FluidVaultT1Open,
FluidVaultT1Borrow,FluidVaultT1Withdraw}.sol`,
`logic/liquidity/{FluidSupply,FluidBorrow,FluidWithdraw,
FluidPayback}LiquidityLogic.sol`,
`helpers/FluidVaultTypes.sol`.

Checked for: operate on an NFT the wallet does not
own; ETH wrap that deposits the wrong amount; max
payback that keeps leftover borrow tokens; T1
helpers that accept a T2/T3 vault type.

Result: no user-exploitable finding.

- T1 actions hardcode `T1_VAULT_TYPE`. Liquidity
  libraries `requireLiquidityCollateral` /
  `requireLiquidityDebt`. `operate` is called as the
  wallet; Fluid requires the NFT owner. Open uses
  `nftId == 0` so the vault mints to the wallet.
- ETH coll is unwrapped WETH then sent as `msg.value`.
  Borrow/withdraw can wrap ETH to WETH on the wallet
  then `withdrawTokens` to `to`. Wrap amount is the
  requested borrow or the vault-returned withdraw.
- Max payback pulls `borrow * 10001/10000 + 5`, uses
  `type(int256).min`, refunds dust to `from`, and
  clears leftover approval. `signed256` reverts above
  `int256.max`.

Remaining Fluid: Dex T2/T3/T4 operate paths.
Aave V3 / Comp / Spark / Liquity V1 follow.
Not submitted.

## 2026-09-03: DeFi Saver Aave V3 money actions (`e623f20`)

Same Immunefi program (`defisaver`, $350,000, no KYC).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction. Exchange/sell already logged;
this slice is Aave V3 supply / withdraw / borrow /
payback.

Files: `contracts/actions/aaveV3/{AaveV3Supply,AaveV3Withdraw,AaveV3Borrow,AaveV3Payback}.sol`.

Checked for: a fake AddressProvider that drains an
approved pull; withdraw/borrow of another wallet’s
position; `onBehalf` without Aave credit delegation.

Result: no user-exploitable finding.

- Token is `getReserveAddressById` on the pool
  returned by the caller-chosen market (or
  `useDefaultMarket`). Supply/payback pull from
  `from` (needs allowance if not the wallet).
- Borrow/withdraw move the wallet’s own position.
  `onBehalf` needs Aave credit delegation.
- A fake AddressProvider would need the wallet
  owner or a `BotAuth` bot to pass it in. Bots
  are owner-approved (already logged).

## 2026-09-03: DeFi Saver Comp V2/V3 + Spark + Liquity V1 (`e623f20`)

Same program and clone. Liquity V2 trove/SP already
logged; this slice adds Comp, Spark, and Liquity V1,
plus a V2 fake-registry note.

Files: `contracts/actions/compoundV3/{CompV3Supply,CompV3Withdraw,CompV3Borrow,CompV3Payback,CompV3Transfer,CompV3Allow,CompV3Claim}.sol`,
`contracts/actions/compound/{CompSupply,CompWithdraw,CompBorrow,CompPayback}.sol`,
`contracts/actions/spark/{SparkSupply,SparkWithdraw,SparkBorrow,SparkPayback,SparkSpTokenPayback,SparkDelegateCredit}.sol`,
`contracts/actions/spark/helpers/SparkHelper.sol`,
`contracts/actions/liquity/trove/{LiquityOpen,LiquityClose}.sol`,
`contracts/actions/liquity/stabilityPool/LiquitySPWithdraw.sol`,
`contracts/utils/token/TokenUtils.sol`.

Checked for: CompV3 withdraw/borrow/transfer of
another account without `allow`; a fake Comet /
Spark AddressProvider that makes `withdrawTokens`
send the wallet’s existing balance; Spark delegate
that a stranger can set; Liquity V1 close that
over-pulls LUSD.

Result: no user-exploitable finding.

- CompV3 `onBehalf == 0` defaults to the wallet.
  `withdrawFrom` / `transferAssetFrom` against
  another account need Comet `allow`. `CompV3Allow`
  calls `allow` as the wallet. Claim uses hardcoded
  `COMET_REWARDS_ADDR` and a receiver balance
  delta. A fake Comet cannot move a real position.
- Comp V2 `getUnderlyingAddr` is
  `cToken.underlying()` (cETH hardcoded). Withdraw
  uses a wallet balance delta. Borrow / supply to
  a fake cToken that returns `NO_ERROR` then
  `withdrawTokens` of the requested amount would
  drain existing wallet tokens of that underlying
  — owner-or-bot fake-target, same as Aave
  `market`. Payback caps at
  `borrowBalanceCurrent`.
- Spark resolves the pool via
  `ISparkPoolAddressesProvider(_market).getPool()`
  unless `useDefaultMarket`. Withdraw sends from
  the pool to `to`. Borrow then
  `withdrawTokens(_to, amount)` is the same
  fake-pool drain if the owner/bot passes a
  hostile AddressProvider. Delegate credit is
  `approveDelegation` as the wallet.
- Liquity V2 (already logged): money actions take
  `IAddressesRegistry(market)` as given.
  `getDebtInFront` whitelists WETH/wstETH/rETH,
  but open/adjust/close/SP do not. A fake
  registry that reports a huge `entireColl` / SP
  gain would make `withdrawTokens` send the
  wallet’s existing coll/BOLD; owner/bot only.
- Liquity V1 addresses are hardcoded in
  `LiquityHelper`. Close reads the wallet’s own
  trove debt/coll, pulls that LUSD, then wraps
  and sends coll to `to`. SP withdraw caps at
  the wallet’s compounded deposit.

Remaining DFS: `curveusd`, Fluid Dex T2/T3/T4,
`eulerV2`, `aaveV4` / leftover Aave, `llamalend`,
`mcd`, `tx-saver`, triggers. Not submitted.

## 2026-09-03: DeFi Saver CurveUsd core money actions (`e623f20`)

Same Immunefi program (`defisaver`, $350,000, no KYC).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/curveusd/{CurveUsdCreate,CurveUsdBorrow,CurveUsdWithdraw,CurveUsdSupply,CurveUsdAdjust,CurveUsdPayback,CurveUsdSelfLiquidate}.sol`,
`helpers/CurveUsdHelper.sol`,
`advanced/CurveUsdSwapper.sol` (callback gate only).

Checked for: a fake controller that
`withdrawTokens` of minted crvUSD from the wallet;
borrow/withdraw of another user’s llamma
position; payback `onBehalfOf` that closes and
sends someone else’s coll to `to`; self-liquidate
that pulls more crvUSD than needed and keeps it;
swapper callback from a non-controller.

Result: no user-exploitable finding.

- Every money action checks
  `isControllerValid`: factory `debt_ceiling`
  != 0. A random AddressProvider-style fake
  cannot pass. Positions are the wallet’s
  `create_loan` / `borrow_more` /
  `remove_collateral` on that controller.
- Create / adjust / borrow then
  `withdrawTokens` of the requested crvUSD
  amount. If the controller minted less, the
  transfer reverts. Supply can credit
  `onBehalfOf` (donation). Payback caps at
  `debt(onBehalfOf)` and, on close, sends only
  the wallet’s balance deltas.
- Self-liquidate is `liquidate(address(this))`.
  Extra crvUSD pull is `debt - collInCrvUsd +
  1000` wei and leftover is returned to `from`.
  Outgoing amounts are post-liq deltas.
- Swapper callbacks require `msg.sender` to be
  a valid controller. `setAdditionalRoutes` is
  permissionless storage, but the action writes
  it in the same tx before the callback and
  `_curveSwap` deletes it. `withdrawAll` lets
  anyone sweep leftover swapper balances (no
  user position).

Remaining CurveUsd: lev-create / repay /
self-liquidate-with-coll + transient variants.
Remaining DFS: those, Fluid Dex T2–T4,
`eulerV2`, `aaveV4` / leftover Aave,
`llamalend`, `mcd`, `tx-saver`, triggers.
Not submitted.

## 2026-09-03: Jito restaking vault money path + NCN tickets (`db90840`)

Immunefi program `jito` ($250,000, KYC). In-scope trees
`jito-foundation/restaking/{vault_core,vault_program,
restaking_core,restaking_program}`. Sparse clone
`/tmp/jito-restaking` at `db90840`. No mainnet
interaction. Interceptor already logged (`dbd8ce4`).
The restaking audit-competition page states slashing
was not enabled at launch; this tree has no slash
instruction (only `DelegationState::slash` math).

Files: `vault_program/src/{mint_to,enqueue_withdrawal,
burn_withdrawal_ticket,change_withdrawal_ticket_owner,
update_vault_balance,initialize_vault_update_state_tracker,
crank_vault_update_state_tracker,close_update_state_tracker,
add_delegation,cooldown_delegation,initialize_vault,
initialize_vault_with_mint,set_fees,delegate_token_account}.rs`,
`vault_core/src/{vault,vault_staker_withdrawal_ticket,
delegation_state}.rs`,
`restaking_program/src/{initialize_ncn_vault_ticket,
warmup_ncn_vault_ticket,initialize_ncn_vault_slasher_ticket,
ncn_delegate_token_account,operator_delegate_token_account}.rs`.

Checked for: empty-vault share inflation or a
donate-then-update brick; mint that credits VRT
without transferring ST; enqueue that locks another
staker’s VRT; permissionless burn that pays a
non-owner; reserved-VRT accounting that under-reserves
ST so a later depositor funds an earlier withdrawal;
`update_vault_balance` that mints unbounded fee VRT;
crank that force-cools another operator’s stake for
an attacker; ticket owner change without the old
owner; restaking ticket warmup that a non-admin can
flip; a user slash path.

Result: no user-exploitable finding.

- `InitializeVault` requires `initialize_token_amount
  > 0`, temporarily zeros the deposit fee, mints 1:1
  VRT to a burn-vault ATA, then restores the fee.
  `vrt_supply` is never zero on a live vault, so the
  donate-then-`update_vault_balance` brick (tokens>0,
  vrt=0, later mints return 0) is not reachable.
  `InitializeVaultWithMint` is a no-op stub.
- `mint_to` requires the depositor signer, classic
  SPL token only, rejects depositor==vault and
  depositor ATA==vault ATA, `mint_with_fee` +
  `min_amount_out`, and `vrt_to_depositor == 0`.
  Deposit fee is `div_ceil` against the depositor.
- Enqueue: staker+base sign; ticket PDA
  `(program, vault, base)`; VRT moves to the ticket
  ATA; `increment_vrt_enqueued_for_cooldown_amount`.
  Burn is permissionless after `current_epoch >
  unstake_epoch+1` but `check_staker` pins payout
  to the ticket’s staker ATA. Extra VRT sent to the
  ticket after enqueue is swept to the program fee
  wallet. Owner change needs the old staker.
- Reserved ST is
  `calculate_burn_summary` on the sum of enqueued +
  cooling + ready VRT. Individual ticket burns apply
  fees per ticket (`div_ceil`), so they take
  slightly more fee / less ST than the aggregate
  reserve. Conservative, not an extract. `delegate`
  subtracts that reserve plus already-delegated
  security from `tokens_deposited`.
- `update_vault_balance` treats ATA growth as
  rewards, takes `reward_fee_bps` in ST, mints the
  matching VRT to the fee wallet, then stores the
  full ATA as `tokens_deposited`.
  `check_reward_fee_effective_rate` aborts a zero
  fee mint when `reward_fee_bps > 0`.
- Epoch crank: only `Greedy` allocation; force
  cooldown is capped at that operator’s staked
  amount and `additional_assets_need_unstaking`.
  Close of the *current* epoch requires every
  operator updated and
  `additional_assets_need_unstaking == 0`, then
  copies tracker delegation and shifts VRT buckets
  at most two epochs. Old-epoch close is rent-only.
- Restaking tickets are NCN/operator-admin PDAs.
  Warmup/cooldown need the matching admin. Delegate
  token is admin `approve(u64::MAX)` of an NCN- or
  operator-owned ATA (not the vault ST). Slasher
  tickets store `max_slashable_per_epoch` but no
  instruction spends them. Vault
  `delegate_token_account` refuses the supported
  mint.

Jito restaking `vault_*` / `restaking_*` treated as
exhausted at `db90840`. `jito-solana` and
`mev-programs` remain. Not submitted. Payouts need
Immunefi KYC.

## 2026-09-03: DeFi Saver CurveUsd advanced + transient (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/defisaver-v3` at `e623f20`. Core
CurveUsd money actions already logged; this slice is
the leftover extended/transient path.

Files: `contracts/actions/curveusd/advanced/{CurveUsdRepay,
CurveUsdLevCreate,CurveUsdSelfLiquidateWithColl}.sol`,
`advanced/transient/{CurveUsdRepayTransient,
CurveUsdLevCreateTransient,CurveUsdSelfLiquidateWithCollTransient,
CurveUsdSwapperTransient}.sol`.

Checked for: lev-create that borrows for a third
party; repay_extended callback that a non-controller
can fire with leftover routes; transient
`ExchangeData` that another recipe can overwrite
in the same tx; leftover funds left on the swapper.

Result: no user-exploitable finding.

- Advanced actions write routes via
  `_setupCurvePath` then call
  `repay_extended` / `create_loan_extended` /
  `liquidate_extended` as the wallet. After the
  callback they `withdrawAll` on the swapper and
  `_sendLeftoverFunds` to `to`. Liquidate target
  is `address(this)`.
- Transient actions write `exData` to
  `BYTES_TRANSIENT_STORAGE` in the same tx, then
  pass the registry swapper. The swapper decodes
  that blob and requires a valid controller
  `msg.sender`. Leftovers use a starting-balance
  snapshot so only the delta is sent to `to`.
  `srcAmount == 0` reverts.

CurveUsd treated as exhausted. Remaining DFS:
Fluid Dex T2–T4, `eulerV2`, `aaveV4` / leftover
Aave, `llamalend`, `mcd`, `tx-saver`, triggers.
Not submitted.

Note on the non-transient leftover (same files):
`LevCreate` / `Repay` / `SelfLiquidateWithColl`
do not call `isControllerValid` (transient
paths do). After `repay_extended` /
`liquidate_extended` they
`_sendLeftoverFunds`, which
`withdrawTokens(..., type(uint256).max)` of
crvUSD and `collateral_token()`. A fake
controller whose `collateral_token()` is WETH
would sweep the wallet’s WETH + crvUSD to
`to` — owner-or-bot, same fake-target pattern
already logged. Transient leftovers use a
starting-balance snapshot.

## 2026-09-03: DeFi Saver Euler V2 actions (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/defisaver-v3` at `e623f20`. No mainnet
interaction.

Files: `contracts/actions/eulerV2/{EulerV2Supply,
EulerV2Withdraw,EulerV2Borrow,EulerV2Payback,
EulerV2PaybackWithShares,EulerV2PullDebt,
EulerV2CollateralSwitch,EulerV2ReorderCollaterals}.sol`,
`helpers/{EulerV2Helper,MainnetEulerV2Addresses}.sol`.

Checked for: borrow/withdraw of an account the
wallet does not own; `enableController` on a
stranger; `pullDebt` that loads a victim with
debt; `repayWithShares` that burns another
account’s eTokens; a fake vault that
`withdrawTokens` of a requested amount.

Result: no user-exploitable finding.

- EVC is hardcoded
  `0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383`.
  Borrow / withdraw / repayWithShares /
  disableController go through
  `IEVC.call(vault, account, …)`. EVC only
  accepts the account owner or an operator.
  `account == 0` defaults to the wallet.
  Sub-accounts share the wallet’s 19-byte
  prefix.
- Supply deposits to `account` (donation if it
  is not the wallet) after a pull/approve.
  Payback caps at `debtOf(account)` and, on a
  full repay, disables the controller via EVC.
- `pullDebt` takes `from`’s debt onto `account`
  (the wallet / its sub-account). That is
  debt-relief for `from`, not an extract.
  `repayWithShares` burns shares of `from`
  via EVC (`from` must be wallet-owned).
- A hostile `vault` address is owner-or-bot
  fake-target (same class as Comp cToken /
  Spark AddressProvider). It cannot pass EVC
  as a real Euler account.

## 2026-09-03: DeFi Saver LlamaLend core money actions (`e623f20`)

Same program and clone. LlamaLend is the
crvUSD-style controller fork; CurveUsd already
logged.

Files: `contracts/actions/llamalend/{LlamaLendCreate,
LlamaLendBorrow,LlamaLendWithdraw,LlamaLendPayback}.sol`,
`helpers/LlamaLendHelper.sol`.

Checked for: a fake controller that
`withdrawTokens` of minted debt from the wallet;
borrow/withdraw of another user’s llamma
position; payback `onBehalfOf` that closes and
sends someone else’s coll to `to`.

Result: no user-exploitable finding.

- Create / borrow / withdraw do **not** call
  `isControllerValid` (unlike CurveUsd).
  `isControllerValid` exists
  (`factory.controllers(id) == addr`) but is
  unused here. A hostile controller plus
  `withdrawTokens` of the requested amount
  would drain the wallet’s existing
  debt/coll tokens — owner-or-bot fake-target,
  same class already logged for Comp / Spark.
  Positions on a *real* controller are the
  wallet’s (`create_loan` / `borrow_more` /
  `remove_collateral`).
- Payback caps at `debt(onBehalfOf)` and on
  close sends only wallet balance deltas.
  `onBehalfOf` repay is a donation.

Remaining LlamaLend: supply / self-liquidate /
advanced swapper paths. Remaining DFS: those,
`aaveV4` / leftover Aave, `mcd`, `tx-saver`,
triggers. Not submitted.

## 2026-09-03: DeFi Saver Fluid Dex T2/T3/T4 (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/fluid/dex/{FluidDexOpen,
FluidDexBorrow,FluidDexSupply,FluidDexWithdraw,
FluidDexPayback}.sol`,
`logic/dex/{FluidSupply,FluidBorrow,FluidWithdraw,
FluidPayback}DexLogic.sol`,
`helpers/{FluidDexTokensUtils,FluidDexModel,
FluidVaultTypes}.sol`.

Checked for: operate on an NFT the wallet does not
own; Open that leaves a minted NFT if borrow fails;
wrap that deposits the wrong ETH amount; max payback
that keeps leftover debt tokens; T2/T3/T4 helpers
that accept the wrong vault type.

Result: no user-exploitable finding.

- `operate` / `operatePerfect` run as the wallet.
  Fluid requires the NFT owner. Open is two-step in
  one tx: supply with `nftId == 0` (vault mints to
  the wallet) then borrow. A failed borrow reverts
  the mint.
- T3 supply/withdraw use liquidity libraries
  (`requireLiquidityCollateral`). T2/T4 supply and
  T3/T4 borrow use DEX libraries
  (`requireSmartCollateral` / `requireSmartDebt`).
  Actions call `requireDexVault` first.
- `shouldSendTokensAsWrapped` only wraps when
  `wrapEth` is set and that side is native. If wrap
  is false, `sendTokens` is a no-op (vault already
  sent to `to`). Max withdraw wraps the
  vault-returned amount. Max payback pulls
  `maxAmountToPull`, uses `type(int256).min`,
  refunds dust as WETH if native, and clears leftover
  approval. `signed256` reverts above `int256.max`.

Remaining DFS: LlamaLend leftover, `aaveV4` /
leftover Aave, `mcd`, `tx-saver`, triggers.
Not submitted.

## 2026-09-03: DeFi Saver Aave V3 + GHO/Umbrella (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/aaveV3/{AaveV3Supply,
AaveV3Borrow,AaveV3Withdraw,AaveV3Payback,
AaveV3ATokenPayback,AaveV3ClaimRewards,
AaveV3CollateralSwitch,AaveV3SetEMode,
AaveV3DelegateCredit,AaveV3DelegateWithSig,
GhoStake,GhoUnstake}.sol`,
`umbrella/{UmbrellaStake,UmbrellaUnstake,
UmbrellaClaimRewards}.sol`,
`helpers/AaveV3Helper.sol`.

Checked for: borrow/withdraw `onBehalf` of a third
party without Aave credit delegation; payback that
over-pulls past debt; aToken repay of someone else’s
debt from pulled tokens; claim that drains another
account’s rewards; Umbrella stake without slippage
or unwrap to the wrong asset.

Result: no user-exploitable finding.

- Actions run via wallet delegatecall, so Aave sees
  `msg.sender` as the wallet. `onBehalf == 0`
  defaults to the wallet. Borrow against another
  `onBehalf` needs Aave `approveDelegation`. Supply
  / payback on behalf are Aave’s intended donate /
  repay paths. Withdraw always burns the wallet’s
  aTokens.
- Payback and aToken payback cap at
  `getWholeDebt`. aToken repay uses
  `repayWithATokens` for `address(this)` after
  pulling aTokens from `from`.
- `DelegateCredit` calls `approveDelegation` as the
  wallet. `DelegateWithSig` only relays a valid
  Aave debt-token signature.
- Claim rewards / Umbrella claim are
  `msg.sender` = wallet. GHO stake/unstake and
  Umbrella stake/unstake pull from `from` or burn
  the wallet’s shares, then send to `to`. Umbrella
  stake/unstake enforce `minSharesOut` /
  `minAmountOut`. Amount `0` only starts cooldown.

Aave V3 supply/borrow/withdraw/payback were already
logged in a narrower slice; this pass adds aToken
payback, delegation, GHO, and Umbrella. Remaining
DFS: LlamaLend leftover, `aaveV4`, `mcd`,
`tx-saver`, triggers. Not submitted.

Note on Dex wrap-path leftovers (same files):
a fake vault that does not pay would make
wrap-path `withdrawTokens` of the requested
amount drain existing wallet tokens of that
asset — owner-or-bot, same class already
logged.

## 2026-09-03: DeFi Saver LlamaLend leftover + swapper (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction. Core create/borrow/withdraw/
payback already logged.

Files: `contracts/actions/llamalend/{LlamaLendSupply,
LlamaLendSelfLiquidate,LlamaLendGetDebt}.sol`,
`advanced/{LlamaLendLevCreate,LlamaLendBoost,
LlamaLendRepay,LlamaLendSelfLiquidateWithColl,
LlamaLendSwapper}.sol`.

Checked for: self-liquidate of another user’s
position; swapper callback from a fake controller;
lev-create that spends wallet coll without a valid
factory id; leftover sweep that sends more than
the action’s delta.

Result: no user-exploitable finding.

- Supply `onBehalfOf` is a donate `add_collateral`.
  Self-liquidate calls `liquidate(address(this))`,
  pulls a 1000-wei buffer only if coll-in-debt <
  debt, refunds unused debt token to `from`, and
  sends the coll delta to `to`. Same un-gated
  controller + `withdrawTokens` fake-target class
  as the core slice.
- Lev-create / boost / repay / self-liquidate-with-
  coll require `factory.controllers(id) == addr`.
  Swapper callbacks revert unless `msg.sender` is
  that controller. Transient `exData` is written
  in the same tx. Leftovers use a starting-balance
  snapshot. `withdrawAll` returns leftover swapper
  balances to `msg.sender` (the wallet).
- `GetDebt` is a view.

LlamaLend treated as exhausted. Remaining DFS:
`aaveV4` / leftover Aave, `mcd`, `tx-saver`,
triggers. Not submitted.

## 2026-09-03: DeFi Saver Aave V4 sig + premium (`e623f20`)

Same program and clone. No mainnet interaction.

Files: `contracts/actions/aaveV4/{AaveV4DelegateBorrowWithSig,
AaveV4DelegateWithdrawWithSig,
AaveV4DelegateSetUsingAsCollateralWithSig,
AaveV4SetUserManagersWithSig,AaveV4RefreshPremium}.sol`.

Checked for: a recipe that sets a stranger’s
managers or borrow/withdraw permits without their
signature; premium refresh that mutates another
account without Aave approval.

Result: no user-exploitable finding.

- Delegate / set-managers actions only relay
  EIP-712 signatures to hardcoded Taker /
  Config position managers or a caller-chosen
  Spoke. Aave verifies the signer.
- `RefreshPremium` defaults `onBehalf` to the
  wallet. On another `onBehalf` it goes through
  `ConfigPositionManager` `*OnBehalfOf`, which
  Aave gates (wallet must already be an approved
  manager). No tokens move.

Aave V4 listed wrappers treated as exhausted.
Remaining DFS: `mcd`, `tx-saver`, triggers.
Not submitted.

## 2026-09-03: DeFi Saver Maker MCD actions (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/mcd/{McdOpen,McdSupply,McdWithdraw,
McdGenerate,McdPayback,McdGive,McdMerge,McdClaim,
McdDsrDeposit,McdDsrWithdraw,McdTokenConverter,
McdBoostComposite,McdRepayComposite,McdRatio}.sol`,
`helpers/{McdHelper,McdRatioHelper}.sol`.

Checked for: generate/withdraw of a CDP the
wallet does not own; Give that a bot can fire
on a stranger’s vault; Cropper claim that
steals another owner’s bonus; DSR withdraw of
another pot pie; composite leftover DAI sent
to the wrong address.

Result: no user-exploitable finding.

- `McdOpen` mints the CDP to `address(this)`.
  Manager `frob` / `give` / `shift` / `move` /
  `flux` require the wallet to own the vault.
  Cropper paths resolve `owns(vaultId)` and
  `frob` as that owner; Cropper only accepts
  the owner’s authorized proxy.
- Payback caps at `getAllDebt`. Give reverts
  on `0x0`. Claim crops with amount 0 and
  sends only the wallet’s bonus delta.
- DSR `join`/`exit` use `pot.pie(address(this))`
  on max. Converter only routes DAI/USDS/MKR
  through hardcoded Sky converters.
- Boost/repay composites hardcode
  `MCD_MANAGER_ADDR`, sell via already-logged
  `DFSSell`, and send leftover DAI to the
  wallet owner. Strategy ratio checks revert
  if the ratio moves the wrong way.
- A caller-chosen `joinAddr` plus
  `withdrawTokens` of a requested amount is
  the same owner-or-bot fake-target class
  already logged for Comp / Spark / LlamaLend.

Maker MCD treated as exhausted. Remaining DFS:
`tx-saver`, triggers. Not submitted.

## 2026-09-03: DeFi Saver TxSaver leftover (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction. RecipeExecutor / BotAuth
already logged; this slice is the TxSaver entry
plus gas-cost helper.

Files: `contracts/tx-saver/{TxSaverExecutor,
BotAuthForTxSaver,TxSaverBytesTransientStorage,
TxSaverGasCostCalc}.sol`.

Checked for: a stranger calling `executeTx`
without a Safe signature; injected exchange
data that runs without the user’s signed
recipe; gas-cost helper that over-charges
past block gas.

Result: no user-exploitable finding.

- `executeTx` requires
  `BotAuthForTxSaver.isApproved(msg.sender)`
  (owner-gated add/remove). It then
  `Safe.execTransaction` to RecipeExecutor as
  DelegateCall with the user’s packed
  signatures. Safe verifies the signers.
  Deadline is checked when non-zero.
- Transient storage is written only by
  TxSaverExecutor in the same tx. Anyone can
  read it; only that tx’s sell/fee hook
  consumes it.
- Gas cost caps `_gasUsed` at `block.gaslimit`
  and converts via an injected ETH price
  (reverts if zero). Fee-from-position vs
  EOA is the user’s signed flag.

TxSaver treated as exhausted. Remaining DFS:
triggers. Not submitted.

## 2026-09-03: DeFi Saver Aave V4 money actions (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/defisaver-v3` at `e623f20`. No mainnet
interaction. Signature-relay / premium already logged;
this is `contracts/actions/aavev4/` supply, borrow,
withdraw, payback, and collateral-switch.

Files: `contracts/actions/aavev4/{AaveV4Supply,
AaveV4Borrow,AaveV4Withdraw,AaveV4Payback,
AaveV4CollateralSwitch,AaveV4StoreRatio}.sol`,
`helpers/{AaveV4Helper,MainnetAaveV4Addresses}.sol`.

Checked for: borrow/withdraw of a third-party
position without Aave manager approval; payback
that over-pulls past debt; fake Spoke whose
`getReserve` returns a real token so the trailing
`withdrawTokens` drains the wallet.

Result: no user-exploitable finding.

- Giver / Taker / Config position managers are
  hardcoded. `onBehalf == 0` defaults to the
  wallet. Other-account supply/repay go through
  `GiverPositionManager`; borrow/withdraw/
  collateral-switch go through Taker / Config.
  Aave must already have enabled that manager
  and approved this wallet.
- Payback caps at `getUserTotalDebt`. Supply
  and payback pull from `from` (allowance).
- After borrow/withdraw the action sends
  `spoke.getReserve(id).underlying` of the
  returned amount to `to`. A fake Spoke plus
  that `withdrawTokens` is the same
  owner-or-bot fake-target class already
  logged. `StoreRatio` is a view helper.

Aave V4 money actions treated as exhausted.
Remaining DFS: triggers. Not submitted.

## 2026-09-03: DeFi Saver triggers (`e623f20`)

Same program and clone. No mainnet interaction.
StrategyExecutor / BotAuth already logged.

Files: `contracts/triggers/{OffchainPriceTrigger,
TokenBalanceTrigger,TrailingStopTrigger,
ChainLinkPriceTrigger,TimestampTrigger,
GasPriceTrigger,ClosePriceTrigger,
AaveV3RatioTrigger,AaveV2RatioTrigger,
AaveV4RatioTrigger,CompV3RatioTrigger,
CompoundRatioTrigger,SparkRatioTrigger,
MorphoBlueRatioTrigger,MorphoBluePriceTrigger,
FluidRatioTrigger,LiquityRatioTrigger,
LiquityV2RatioTrigger,McdRatioTrigger,
CurveUsdCollRatioTrigger,
CurveUsdHealthRatioTrigger,
CurveUsdSoftLiquidationTrigger,
CurveUsdBorrowRateTrigger}.sol` plus the
quote-price / debt-in-front / adjust-rate
variants and `helpers/TriggerHelper.sol`.

Checked for: a stranger firing a strategy
without the subscribed condition; Offchain
price that a non-bot can set; LimitSell that
accepts a 1-wei attested price and dumps
the position; TokenBalance that reads a
spoofable token.

Result: no user-exploitable finding.

- `executeStrategy` is BotAuth-gated and the
  `StrategySub` hash must match storage.
  Trigger `callData` is bot-supplied;
  `subData` is the user’s stored hash.
- Ratio / Chainlink / Morpho / Fluid /
  Liquity / MCD / CurveUsd / Spark /
  Comp / Aave quote-price triggers read
  on-chain oracles or protocol views.
  `currRatio == 0` or a missing price
  returns false (no fire).
- `OffchainPriceTrigger` takes
  `currentPrice` from bot calldata, writes
  `CURR_PRICE`, and LimitSell requires
  `minPrice == CURR_PRICE` before `_sell`.
  A tiny attested price would weaken
  slippage to nearly zero. Only approved
  bots can pass that calldata — same
  owner-or-bot class already logged for
  LimitSell in the exchangeV3 slice.
- `TrailingStopTrigger` takes a Chainlink
  `maxRoundId` from the bot but prices
  come from `getRoundInfo`; the round
  must be after `startRoundId`.
- Token balance / timestamp / gas-price
  triggers are views on the subscribed
  addresses and thresholds.

DeFi Saver V3 treated as exhausted. Not
submitted.

## 2026-09-03: DeFi Saver leftover Aave V2 (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction. Aave V3 / V4 already
logged; this is `contracts/actions/aave/`.

Files: `contracts/actions/aave/{AaveSupply,
AaveBorrow,AaveWithdraw,AavePayback,
AaveCollateralSwitch,AaveClaimAAVE,
AaveClaimStkAave,AaveUnstake}.sol`,
`helpers/{AaveHelper,MainnetAaveAddresses}.sol`.
`AaveSubProxy` only registers boost/repay
bundles against hardcoded Aave V2 market
`0xB53C…c5`.

Checked for: borrow through a fake
AddressesProvider that then
`withdrawTokens` a caller-chosen amount;
payback leftover that sweeps more than the
unused pull; claim of another account’s
stkAave rewards.

Result: no user-exploitable finding.

- `market` is an unvalidated
  AddressesProvider. Borrow then
  `withdrawTokens(tokenAddr, amount)` —
  owner-or-bot fake-target, same class as
  Comp / Spark. Withdraw sends via the
  pool to `to` (max uses a `to`-balance
  delta). The 1–2 wei faucet top-up is
  hardcoded `DYDX_FL_FEE_FAUCET`.
- Payback caps at `getWholeDebt`. After
  repay it `withdrawTokens(_from,
  tokensAfter)` — the entire remaining
  wallet balance of that token, not only
  unused pull. Recipe leftover footgun to
  `from`, not a third-party extract.
- Claims / unstake hit hardcoded stkAave
  `0x4da2…0f5`. `amount == 0` on unstake
  only starts cooldown.

## 2026-09-03: DeFi Saver EtherFi + Lido + leftover utils (`e623f20`)

Same program and clone.

Files: `contracts/actions/etherfi/{EtherFiStake,
EtherFiStakeFromLido,EtherFiWrap,EtherFiUnwrap}.sol`,
`lido/{LidoStake,LidoWrap,LidoUnwrap}.sol`,
`utils/{ExecuteCall,SendToken,SendTokens,
PullToken,TransferNFT,ChangeProxyOwner,
HandleAuth,PermitToken,TokenizedVaultAdapter,
KingClaim,SDaiWrap,SDaiUnwrap}.sol`.

Checked for: stake that sends more eETH /
stETH than the deposit minted; Lido ETH
call that a fake recipient can keep;
ERC4626 vault that `withdrawTokens` of a
requested amount; `ExecuteCall` that a
strategy bot can aim at an arbitrary
target; `KingClaim` of another wallet’s
merkle allocation.

Result: no user-exploitable finding.

- EtherFi / Lido addresses are hardcoded
  (eETH `0x35fA…ac2`, weETH `0xCd5f…b7ee`,
  liquidity pool, deposit adapter, stETH /
  wstETH). Stake / wrap send only the
  received-balance delta. Lido stake/wrap
  require the ETH call to succeed.
  `StakeFromLido` approves the adapter and
  passes an empty permit (`deadline =
  max`); `minAmountOut` is user-set.
- `TokenizedVaultAdapter` takes a
  caller-chosen ERC4626. Deposit/mint pull
  `vault.asset()`. A fake vault can keep
  the pull — owner-or-bot. Redeem/withdraw
  use the vault’s `from` allowance.
  Slippage (`minOutOrMaxIn`) is checked.
  Sky staked USDS uses a hardcoded vault +
  referral on mainnet.
- `ExecuteCall` / `SendToken*` /
  `ChangeProxyOwner` are owner-or-bot
  recipe primitives. `PermitToken` relays
  an exact EIP-2612 signature and requires
  the nonce to increment. `KingClaim`
  claims for `address(this)` on hardcoded
  `0x6Db2…B64` and sends the KING delta.
  `SDaiWrap` deposits to hardcoded sDAI.

Remaining DFS folders without a dedicated
pass: `renzo`, `sky`, `pendle`, `yearn`,
`summerfi`, `uniswap`, `insta`, `lsv`,
`merkel`, `fee`, `checkers`, leftover
utils (`CreateSub` / `UpdateSub` /
`ToggleSub` / wrap-ETH). Not submitted.

## 2026-09-03: DeFi Saver Renzo / Sky / Pendle / Yearn / Uni (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/renzo/RenzoStake.sol`,
`sky/{SkyStake,SkyUnstake,SkyClaimRewards,
SkyStakingEngineOpen,SkyStakingEngineStake,
SkyStakingEngineUnstake,SkyStakingEngineClaimRewards,
SkyStakingEngineSelectFarm}.sol`,
`pendle/PendleTokenRedeem.sol`,
`yearn/{YearnSupply,YearnWithdraw}.sol`,
`uniswap/{UniswapClaim,v2/UniSupply,v2/UniWithdraw,
v3/UniMintV3,v3/UniSupplyV3,v3/UniWithdrawV3,
v3/UniCollectV3,v3/UniCreatePoolV3}.sol`.

Checked for: Yearn withdraw of a fake yVault
that `withdrawTokens` a requested underlying
amount; Sky unstake that sends wallet tokens
after a no-op `withdraw`; Pendle redeem that
transfers PT to a hostile YT; Uni V3
decrease/collect of an NFT the wallet does
not own.

Result: no user-exploitable finding.

- Renzo stake is hardcoded manager + ezETH
  and sends only the received-balance
  delta.
- Sky stake/unstake take a caller-chosen
  `stakingContract`. Stake approves and
  `stake`s. Unstake calls `withdraw` then
  `withdrawTokens(stakingToken, amount)` —
  a no-op fake farm drains existing wallet
  tokens of that asset. Owner-or-bot.
  Staking-engine `free` / `lock` send
  through the engine to `to` / urn index
  for `address(this)`.
- Pendle redeem requires
  `market.isExpired()`, pulls PT, transfers
  it to `readTokens().yt`, then
  `redeemPY` + SY `redeem` with
  `minAmountOut`. A hostile market that
  names an attacker YT is owner-or-bot.
- Yearn supply uses hardcoded
  `yearnRegistry.latestVault(token)`.
  Withdraw takes a caller-chosen yToken,
  pulls shares, `vault.withdraw`, and
  sends the underlying-balance delta.
  A fake vault that does not pay sends
  zero, not a requested amount.
- Uni V2 factory/router and Uni V3
  position manager are hardcoded. V3
  decrease/collect require the wallet to
  own `tokenId`. V2 removeLiquidity sends
  to `to` via the router.

Remaining DFS folders: `summerfi`, `insta`,
`lsv`, `merkel`, `fee`, `checkers`, leftover
utils (`CreateSub` / wrap-ETH). Not submitted.

## 2026-09-03: DeFi Saver Summer.fi / Insta / LSV / Merkl / fee / checkers (`e623f20`)

Same Immunefi program `defisaver` ($350,000, `kyc: false`).
Same clone `/tmp/reviews/defisaver-v3` at `e623f20`.
No mainnet interaction.

Files: `contracts/actions/summerfi/{SFProxyEntryPoint,
SFApproveTokens,SummerfiUnsub,SummerfiUnsubV2}.sol`,
`insta/{InstPullTokens,connectors/ConnectV2DefiSaver*.sol,
connectors/resolver.sol}`,
`lsv/{LSVSupply,LSVBorrow,LSVPayback,LSVWithdraw}.sol`,
`merkel/MerklClaim.sol`,
`fee/{GasFeeTaker,GasFeeTakerL2,GasFeeCalc}.sol`,
`checkers/*RatioCheck*.sol`,
`utils/{CreateSub,UpdateSub,ToggleSub,WrapEth,UnwrapEth}.sol`.

Checked for: Summer.fi approve that sets
allowance on a stranger’s SF proxy; Insta
`cast` that drains another DSA; Merkl
`distinctTokens` that `withdrawTokens` more
than the claim minted; LSV fee that takes
more than 10% of a real withdraw; GasFeeTaker
that spends an unpiped wallet balance past
the 20% cap.

Result: no user-exploitable finding.

- `SFApproveTokens` executes
  `AAVEV3PaybackWithdraw` on a
  caller-chosen `sfProxy` through
  hardcoded OperationExecutor /
  SetApproval `0x3CF2…bA5` (version-
  pinned in ServiceRegistry). AccountGuard
  must already permit this wallet. Spender
  defaults to the wallet; allowance is
  re-read after the call.
- `SummerfiUnsub` / `UnsubV2` delegatecall
  hardcoded AutomationBot /
  AutomationBotV2 (`0x6E87…01b` /
  `0x5743…25E`) to remove the wallet’s
  own triggers. `SFProxyEntryPoint`
  fallback delegatecalls RecipeExecutor;
  `receive` reverts.
- `InstPullTokens` `cast`s `BASIC-A`
  withdraw on a caller-chosen DSA. Only a
  DSA that already authorized this wallet
  will succeed. ConnectV2DefiSaver
  fallbacks delegatecall a hardcoded
  RecipeExecutor from an Instadapp spell
  the DSA owner signed.
- LSV supply/borrow/payback only write
  the hardcoded profit tracker. Withdraw
  takes a performance fee (0% if
  discounted) capped at 10% of the stated
  LST amount, converted via hardcoded
  rETH/cbETH/wstETH/weETH/ezETH rates.
- `MerklClaim` hits the hardcoded
  distributor. Claiming for another
  `users[]` entry is the intended merkle
  path; `distinctTokens` then
  `withdrawTokens` from the wallet —
  owner-or-bot if those amounts exceed
  the claim. Docs say leave that array
  empty when claiming for someone else.
- `GasFeeTaker` caps gas at 20% of
  `availableAmount` (wallet balance if
  unpiped) plus a DFS fee floored at 5
  bps. Checkers only revert a strategy
  when the post-action ratio moved the
  wrong way. `CreateSub` grants auth and
  stores a hash the wallet signed.

DeFi Saver leftover folders treated as
exhausted. Not submitted.

## 2026-09-03: 0x Settler execute + Permit2 + RFQ/UniV3 (`1df9087`)

Immunefi program `0x` ($1,000,000, `kyc: true`).
In-scope GH tree is
`https://github.com/0xProject/0x-settler/tree/master/src`.
Web/API (Matcha, gasless, swap) are websites —
not reviewed, no live-API probing. Local clone
`/tmp/0x-settler` at `1df9087`. No mainnet
interaction.

Files: `src/Settler.sol`, `src/SettlerMetaTxn.sol`,
`src/SettlerBase.sol` (`_checkSlippageAndTransfer`),
`src/core/{Permit2Payment,Basic,RfqOrderSettlement,
UniswapV3Fork}.sol`,
`src/allowanceholder/AllowanceHolder.sol`,
`src/bridge/BridgeSettler.sol`.

Checked for: a later action that spends a
payer the taker did not authorize; forwarded
Permit2 that accepts a forged empty sig;
meta-txn that skips the witness-binding VIP;
RFQ self-funded that transfers more taker
tokens than the maker signed; UniV3 callback
from a non-pool; AllowanceHolder that leaves
a standing allowance; slippage check that
sends the buy-token to the operator.

Result: no user-exploitable finding.

- `takerSubmitted` sets transient payer to
  `_operator()` (`_msgSender()`). After that,
  `_msgSender()` is the payer. Restricted
  targets are Permit2 and AllowanceHolder
  (`ConfusedDeputy`). `executeWithPermit`
  requires `_isForwarded()`.
- Forwarded `_transferFrom` requires empty
  sig, nonce 0, and a live deadline, then
  AllowanceHolder `transferFrom`. Witness
  transfers (`_transferFromIKnowWhatImDoing`)
  revert `ForwarderNotAllowed` when
  forwarded.
- Meta-txn `executeMetaTxn` sets witness =
  `keccak(slippage || actions hash)` and
  payer = signed `msgSender`. First action
  must be a VIP that spends that witness
  (`METATXN_TRANSFER_FROM` /
  `METATXN_UNISWAPV3_VIP`). `takerSubmitted`
  on the meta-txn contract reverts. Operator
  cannot equal `msgSender`. Forwarded
  meta-txns revert. AllowanceHolder path
  on meta-txn reverts `ConfusedDeputy`.
- RFQ self-funded pays the maker from
  Settler’s taker-token balance (capped at
  `maxTakerAmount`, maker-favor rounding)
  then `permitWitnessTransferFrom` of the
  maker’s permit with a Consideration
  witness of the taker. RFQ VIP is
  commented out.
- UniV3 VIP / multi-hop: pool address is
  `CREATE2` from a trusted factory+initHash
  (`_uniV3ForkInfo`). Callback is installed
  via `_setOperatorAndCall`; payer `address(this)`
  pays from Settler, payer `0` pays via
  Permit2/AllowanceHolder packed into
  callback data. Subsequent hops reset
  callback data to Settler+token.
- `basicSellToPool` rejects restricted
  targets, patches `ppm` of balance into
  calldata, and forbids empty-return to an
  EOA.
- AllowanceHolder `exec` sets an ephemeral
  allowance, ERC-2771-appends sender,
  rejects ERC20 targets via `balanceOf`
  probe. If `sender != tx.origin` the
  allowance is zeroed after exec.
- Slippage: `minAmountOut==0 && buyToken==0`
  skips (unless mandatory). Else require
  Settler balance ≥ min and send the full
  (or exact-min) buy-token/ETH to
  `slippage.recipient`. Intentional leftover
  sweep of the last hop.
- BridgeSettler `execute` is takerSubmitted;
  first action may be `TRANSFER_FROM` VIP
  or a regular dispatch. No slippage helper
  here — remaining work is the per-bridge
  adapters.

Remaining 0x: other per-DEX adapters and
the rest of `src/bridge/`. Not submitted.

## 2026-09-03: 0x Settler UniV2 / Velodrome / Across (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/0x-settler` at `1df9087`. No
mainnet interaction. Execute / Permit2 / RFQ /
UniV3 already logged.

Files: `src/SettlerBase.sol` (`UNISWAPV2`,
`VELODROME`, `POSITIVE_SLIPPAGE`),
`src/core/{UniswapV2,Velodrome,Across}.sol`.

Checked for: a user-supplied UniV2/Velo pool
that is not a pair but still drains a later
action’s tokens; Across spoke that is a
restricted target; positive-slippage that
sends more than leftover.

Result: no user-exploitable finding.

- UniV2 / Velodrome take a caller-chosen
  pool, read `token0`/`token1` (or
  `metadata`), transfer `ppm` of Settler’s
  sell-token balance, then `swap`. A fake
  pool can only take tokens already in this
  Settler execution. `minBuyAmount` still
  applies. Permit2 / AllowanceHolder do not
  implement `swap`.
- `POSITIVE_SLIPPAGE` sends
  `min(balance - expected, balance * maxPpm
  / BASIS)` of leftover to `recipient`.
  Action data is in the signed / submitted
  list.
- Across overwrites `inputAmount` to the
  current Settler balance (or ETH balance)
  and scales `outputAmount` with 512-bit
  math, then calls `ISpokePool.deposit` on
  a caller-chosen spoke. Selector does not
  clash with restricted targets. Funds
  moved are this execution’s leftovers.

Remaining 0x: other DEX mixins
(Maverick, Balancer, Bebop, EulerSwap,
Dodo, Curve, UniswapV4, PancakeInfinity,
Renegade, …) and Stargate / LayerZero /
CCIP / Mayan / deBridge. Not submitted.

## 2026-09-03: Extra Finance LYF LendingPool + Velo manager

Immunefi program `extrafinance` ($100,000,
`kyc: false`, updated 2026-09-02). Scope is
Optimism etherscan addresses, no official
GH tree in the program JSON. Sources from
Sourcify exact-match plus
[ExtraFi/extra-contracts](https://github.com/ExtraFi/extra-contracts)
(repo documents mainnet-vs-fix diffs).
No mainnet interaction.

Files: Sourcify `/tmp/extrafinance/lendingpool`
`contracts/lendingpool/{LendingPool,
ExtraInterestBearingToken,StakingRewards}.sol`,
`libraries/logic/ReserveLogic.sol`,
`Payments.sol`; Sourcify
`/tmp/extrafinance/velo`
`contracts/VeloPositionManager.sol`;
Sourcify `/tmp/extrafinance/rdist`
`contracts/RewardsDistributor.sol`.
Live LendingPool
`0xBB505c54D71E9e599cB8435b4F0cEEc05fC71cbD`,
VeloPositionManager
`0xf9cFB8a62f50e10AdDE5Aa888B44cF01C5957055`.

Checked for: redeem of another user’s
eTokens; borrow without whitelist /
credits; repay that inflates vault
credits past actual debt; first-depositor
exchange-rate inflation; Velo callback
from a non-vault; staking withdraw of
another user.

Result: no new user-exploitable finding.

- Borrow / repay require
  `borrowingWhiteList[msg.sender]` and
  `debtPosition.owner == msg.sender`.
  Credits and whitelist are owner-set
  per vault from `VaultFactory`.
- Mainnet `repay` adds `credits` using
  the *requested* amount before capping
  to `debtPosition.borrowed`. ExtraFi’s
  own `BUG_FIXES_AND_MODIFICATIONS.md`
  already labels this a known mainnet
  bug and says it is not externally
  exploitable because only whitelisted
  vaults call `repay`. The public repo
  already caps first. Vault position-
  logic implementations (registry ids
  101–105) are not on Sourcify, so this
  slice cannot prove a user-controlled
  passthrough. Do not file the known
  credit bug without that vault path.
- eToken burn is `onlyLendingPool` and
  burns the pool’s own balance after
  `transferFrom` of the redeemer.
  `withdrawByLendingPool` is
  `onlyLendingPool`.
- First-depositor inflation is also in
  ExtraFi’s known-issues list; they say
  mainnet inits dead-share the first
  10k eTokens in the same tx.
- `unwrapWETH9` unwraps the contract’s
  full WETH balance (donation / leftover
  sweep, not another user’s position).
- Velo `payToVaultCallback` /
  `payFeeToTreasuryCallback` require
  `msg.sender == factory.vaults(id)`.
  Liquidation / compound / range-stop
  are whitelist-or-flag gated.
- StakingRewards `setReward` / claim
  quirks are the same documented
  owner-gated known issues.

Remaining Extra Finance: vault
implementations (not Sourcify), ExtraX
account factory
(`0x345e8250cB11F61F0d8cFaBAC6be59A356309a58`),
Aave-fork Pool impl
(`0x0353b6221B23B8320202320Ca450EEB9fB0de9E5`),
veToken. Not submitted.

## Next candidates

Sky PAS / SBEBeam / FarmOwner, the full `dss-emergency-spells` tree,
the full `diamond-pau` facet tree at `1b6743a`,
Intuition MultiVault / AtomWallet / curves / emissions /
registry / `TrustSwapAndBridgeRouter` (`bb34cc2`),
Origin OUSD vault + Curve AMO + WOETH/WOUSD + Ethena ARM,
Origin Aerodrome / Base Curve / Hydrex AMOs + OETH
zapper + Safe modules, Origin WETH/USDC/Lido ARM
adapters + zappers, Origin ARM CapManager + Morpho/Silo
4626 wrappers, Origin xOGN ExponentialStaking
(`eff0d3d`), Origin CrossChain master/remote
(`4fa0602`), Lombard SVM asset_router / bridge /
bascule / mailbox / token_pool / ratio_oracle / valset
(`09d5e76`), Leather extension RPC / PSBT approval, OZ
Confidential v0.5.3 including hooked/votes/omnibus/
observer/cap modules (`4a4f6c7`), Money on Chain V2
core/queue/V4 swapper (`d770477`), Sky FarmOwner,
Alchemix V3 alchemist + transmuter + alUSD +
token-vault + MYT adapter / allocator / router / fee
vaults + concrete strategies / Euler adapter /
`StakingGraph`, and Horizen ZenStaker +
RewardAccumulator (`ab92502`), 1inch Aqua
solidity-utils mixins / libraries (`5b597e4`) are
exhausted. Origin in-scope Solidity listed as remaining
is exhausted (including CoW `HarvestingEIP1271`, live
`FixedRateRewardsSource`, and the OZ Governor wrapper).
Remaining Alchemix leftover `src/` (curator,
classifier, position NFT, gauge, 0x verifier, Frax
adapter, libs, test `AlEth`) is exhausted. Enzyme
Blue gated-redemption wrapper + share-price throttle
(`da3b870`) and Charm Alpha Pro Vault (`0174095`)
are exhausted. Remaining MoC: live Rootstock v1
proxies if a later pass wants addresses rather than
the V2 tree. V2 governance machines (`d770477`) are
exhausted. 1inch Aqua opcode set and Aqua-listed
solidity-utils mixins / libraries (`5b597e4`) are
exhausted. DeFi Saver V3 executor + FL + auth
(`e623f20`) and exchangeV3 + sell actions (`e623f20`)
are logged; Morpho Blue, Liquity V2, Fluid T1
+ liquidity logic, Fluid Dex T2/T3/T4, Aave V3
+ GHO/Umbrella, Comp V2/V3, Spark, Liquity V1,
CurveUsd core, CurveUsd advanced/transient,
Euler V2, LlamaLend core, LlamaLend leftover +
swapper, Aave V4 sig/premium, Aave V4 money
actions, Maker MCD, TxSaver leftover, and
triggers, leftover Aave V2, EtherFi / Lido,
leftover utils, and Renzo / Sky / Pendle /
Yearn / Uni, and Summer.fi / Insta / LSV /
Merkl / fee / checkers (`e623f20`) are
logged. DeFi Saver V3 leftover folders are
exhausted. 0x Settler execute / Permit2 /
RFQ / UniV3 / AllowanceHolder / BridgeSettler
plus UniV2 / Velodrome / Across /
POSITIVE_SLIPPAGE (`1df9087`) are logged;
remaining 0x is other DEX mixins and
Stargate / LayerZero / CCIP / Mayan /
deBridge. Extra Finance LYF LendingPool +
VeloPositionManager + RewardDistributor
(Sourcify, 2024-08 verified) are logged;
remaining Extra Finance is vault logic
(not Sourcify), ExtraX factory, Aave-fork
Pool, veToken. Next unreviewed Immunefi
GitHub-or-recent trees: those 0x leftover
adapters, Extra Finance leftover,
Index Coop etherscan set
($200k, no KYC), Jito `jito-solana` /
`mev-programs` ($250k, KYC; interceptor
`dbd8ce4` and restaking `vault_*` /
`restaking_*` at `db90840` are exhausted),
Enzyme Blue adapters added as etherscan
addresses after Apr 2026 (Bebop / ThreeOneThird /
SharesSplitter). Superteam API rechecked 03:53 UTC
3 Sep: still 28 open listings.
`AGENT_ALLOWED` is still only Steve Arena and ZNS —
do not execute. Mermail skill is built
(`mermail-onchain-receipts/`); remaining work is the
participant's PR, Mermail MCP, and X demo. T3N Vendor
Receipts is built (`t3n-vendor-receipts/`); remaining
work is Terminal 3 SSO. NectarFi is a creator campaign.
Manic $1k bug bounty is `HUMAN_ONLY`.
the402.ai still paused. 1inch Fusion settlement /
whitelist / PowerPod / KycNFT and FeeTaker are exhausted.
Remaining OZ hooks: none of the money-moving
general/fee/base files. Leather still requires a
working PoC against the published store build; do not
file theoretical reports. USDT0’s 1 Sep add is Stellar
explorer, not a Solidity GitHub tree. Sherlock
`https://audits.sherlock.xyz/api/contests` is paginated
(301 items); page 1 as of 03:26 UTC 3 Sep still shows
the only non-FINISHED row as contest `1234` (Tare) in
`SHERLOCK_JUDGING` (later pages 403 from this VM).
Code4rena API: 25 audits, 24
`Completed`, 1 `Reporting` (Rujira, window ended Jan
2026). Hedera Harness #8 still `open`, 0 comments, 0
HOL-Guard PRs; file-level plan is in
`research/ethonline-hedera-harness-8.md` (read-only
clone `/tmp/hedera-harness` at `e045b10`). Uniswap
Foundation OSS backup is
[Uniswap/sdks#720](https://github.com/Uniswap/sdks/issues/720)
(DCA EIP-712 vs `DCALib.sol`, 0 comments, 0 PRs);
file-level plan is in
`research/ethonline-uniswap-sdks-720.md` (read-only
clones `/tmp/uniswap-sdks` `35c4e35`, `/tmp/uniswapx`
`fd60225`). ETHOnline 1inch Aqua App design is
`aqua-app/DESIGN.md` (AquaFloor / `ReserveFloor`); no
product code before 4 Sep 16:00 UTC.
`1inch-aqua-improvement` is an improvement-proposal
program and is not a second vuln book. Rechecked
03:53 UTC 3 Sep: KeeperHub #2105 still `open` +
`accepted` + `confirmed`, 0 comments, 0 PRs;
Uniswap/sdks#720 still `open`, 0 comments, 0 PRs;
CreditPassport deployer still 0 Sepolia ETH / 0 tCTC;
official CTC HTML still blocked by DoraHacks “Human
Verification” (last good count 47 BUIDLs / 203 hackers,
deadline 13 Sep 2026 23:59 ET). No KeeperHub
implementation before the 6 Sep build window. No
ETHOnline project code before 4 Sep 16:00 UTC.
