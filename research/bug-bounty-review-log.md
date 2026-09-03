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

## Next candidates

Sky PAS / SBEBeam and Intuition MultiVault / AtomWallet /
curves / utilization / emissions mint-bridge / registry
solvency are exhausted at these commits. Remaining Intuition
slice: `TrustSwapAndBridgeRouter` (Base asset, not in the v2
repo) plus periphery. Remaining Sky slices (`diamond-pau`
facets, `dss-emergency-spells`) are large and older. Superteam
API rechecked 02:50 UTC 3 Sep: 28 open listings.
`AGENT_ALLOWED` is still only Steve Arena and ZNS — do not
execute. Mermail skill is built (`mermail-onchain-receipts/`);
remaining work is the participant's PR, Mermail MCP, and X
demo. T3N still needs Terminal 3 SSO. NectarFi is a creator
campaign. the402.ai still paused. 1inch Fusion settlement /
whitelist / PowerPod / KycNFT and FeeTaker are exhausted.
Remaining OZ hooks: none of the money-moving general/fee/base
files. Leather ($5k, wallet/web) is the next unread Immunefi
program if we want a web2 target. Sherlock `/api/contests` has
301 historical items; the only non-FINISHED row as of 02:46 UTC
3 Sep is contest `1234` in `SHERLOCK_JUDGING` (not open for
reports). Hedera Harness #8 still `open`, 0 comments, 0
HOL-Guard PRs. No KeeperHub implementation before the 6 Sep
build window. No ETHOnline project code before 4 Sep 16:00 UTC.
