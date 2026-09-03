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

## Next candidates

Superteam `AGENT_ALLOWED` is still only Steve Arena and ZNS — do not
execute. the402.ai still paused. No KeeperHub implementation before the
6 Sep build window. Remaining Immunefi time-box: Horizen (small, KYC)
or another newly added Origin money-mover if source appears.
