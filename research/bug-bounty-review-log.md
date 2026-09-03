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
Renegade, …) and Relay / NucleusTeller.
Not submitted.

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

## 2026-09-03: 0x leftover Stargate / LayerZero / CCIP / Mayan / DeBridge (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/0x-settler` at `1df9087`.
No mainnet interaction. Across / UniV2 /
Velodrome already logged.

Files: `src/core/{StargateV2,LayerZeroOFT,
CCIP,Mayan,DeBridge}.sol`,
`src/bridge/IBridgeSettlerActions.sol`.

Checked for: a hostile pool/OFT/router that
is Permit2 or AllowanceHolder; amount
override that spends a later action’s
tokens for a stranger; Mayan
`protocolAndData` that calls an arbitrary
target with Settler’s allowance.

Result: no user-exploitable finding.

- All five run only from BridgeSettler
  `_dispatch` inside one
  `takerSubmitted` / signed execute.
  They overwrite `amountLD` /
  `giveAmount` / `tokenAmounts[0].amount`
  / Mayan `amountIn` to this Settler’s
  current token (or ETH-minus-fee)
  balance, then `safeApproveIfBelow` the
  bridge.
- Stargate / LayerZero / CCIP take a
  caller-chosen `pool` / `oft` / `router`
  and call a fixed selector
  (`sendToken` / `send` / `ccipSend`).
  Comments note those selectors do not
  clash with Permit2 or AllowanceHolder.
  A fake pool can only keep tokens this
  execution already pulled — same
  authenticated-execution class as UniV2.
- Mayan / DeBridge use hardcoded
  `MAYAN_FORWARDER`
  (`0x3376…3E2`) and `DLN_SOURCE`
  (`0xeF4f…EB66`). Receiver / `to` /
  `mayanProtocol` bytes are in the
  taker’s action data.
- CCIP requires `feeToken == 0` and
  exactly one `tokenAmounts` entry, then
  sends `selfbalance()` as native fee
  (excess is documented as a donation).

Remaining 0x: other DEX mixins (UniV4,
BalancerV3, Curve, Dodo, EulerSwap,
PancakeInfinity, …) and Relay /
NucleusTeller. Not submitted.

## 2026-09-03: 0x Settler UniV4 + Relay + SETTLER_SWAP (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/reviews/0x-settler` at `1df9087`.
No mainnet interaction. Stargate / LayerZero /
CCIP / Mayan / DeBridge already logged in
the leftover above.

Files: `src/core/{UniswapV4,Relay}.sol`,
`src/bridge/BridgeSettlerBase.sol`
(`SETTLER_SWAP`, Relay),
`src/chains/Mainnet/{Common,TakerSubmitted,
MetaTxn}.sol` (UniV4 / UniV4 VIP).

Checked for: a UniV4 hook that spends a
payer the taker did not authorize; Relay
that hits Permit2 or AllowanceHolder;
SETTLER_SWAP to a counterfeit Settler.

Result: no user-exploitable finding.

- UniV4 unlocks via `_setOperatorAndCall`.
  Payer `address(this)` transfers from
  Settler; payer `0` uses Permit2 /
  AllowanceHolder packed into the VIP.
  Fills (pool key, hooks, hook data, ppm)
  are in the submitted / signed action.
  Global buy token is `take`n to
  `recipient` against `minBuyAmount`;
  leftover credit on other notes is swept
  to Settler. Incomplete fill refunds sell
  credit. Zero sell reverts.
- Relay transfers this execution’s full
  ERC20 / ETH balance to the action’s
  `to`. Native path is a raw call with
  `requestId` graffiti; ERC20 path is
  `transfer`. Neither selector clashes
  with Permit2 / AllowanceHolder.
- `SETTLER_SWAP` requires the target to
  be the current or previous Deployer
  NFT owner of the taker-submitted
  tokenId. Comment notes MEV can force
  the inner swap to its slippage limit;
  that is in-execution leftover, not
  another user’s custody.

Remaining 0x: other DEX mixins
(Maverick, BalancerV3, Bebop, EulerSwap,
Dodo, Curve, PancakeInfinity, Renegade,
Ekubo, Hanji, NucleusTeller). Not
submitted.

## 2026-09-03: 0x Settler Maverick / Dodo / BalancerV3 (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/reviews/0x-settler` at `1df9087`.
No mainnet interaction. UniV4 / Relay /
SETTLER_SWAP already logged.

Files: `src/core/{MaverickV2,DodoV1,DodoV2,
BalancerV3}.sol`,
`src/chains/Mainnet/Common.sol` (dispatch).

Checked for: a fake Maverick/Dodo pool that
drains a later action; BalancerV3 vault
callback that spends a payer the taker
did not authorize; Dodo V1 quote-for-base
that over-buys past `minBuyAmount`.

Result: no user-exploitable finding.

- Maverick V2 transfers `ppm` of Settler
  balance (or pool-balance delta when
  `ppm==0`), then `swap` with empty
  callback data so the pool does not
  flash-callback. `minBuyAmount` still
  applies. A fake pool can only take
  tokens already in this execution.
- Dodo V2 transfers then
  `sellBase`/`sellQuote` to `recipient`.
  Dodo V1 `safeApproveIfBelow`s the
  caller-chosen pair, sells base with
  the pair’s own `minReceiveQuote`, or
  quote-for-base after local curve math
  and `buyBaseToken(buyAmount,
  sellAmount)`. Slippage is checked
  before the buy call.
- Balancer V3 vault is hardcoded
  (`0xbA13…9bA9`). Unlock uses the same
  `_setOperatorAndCall` + notes pattern
  as UniV4. Payer `address(this)`
  transfers from Settler; payer `0` uses
  Permit2. Wrap/unwrap bits are in the
  signed fills. Global buy token is
  `sendTo`’d to `recipient` against
  `minBuyAmount`.

Remaining 0x: EulerSwap, Curve,
PancakeInfinity, Bebop, Renegade, Ekubo,
Hanji, NucleusTeller. Not submitted.

## 2026-09-03: Extra Finance ExtraX factory + Aave-fork Pool

Same Immunefi program `extrafinance` ($100,000,
`kyc: false`, updated 2026-09-02). Same
Sourcify + ExtraFi/extra-contracts method
as the LYF slice. Live Optimism RPC
`https://mainnet.optimism.io` used only
for `initialized` / EIP-1967 views — no
state-changing calls. No mainnet
interaction beyond those reads.

Files: Sourcify exact_match ExtraX impl
`/tmp/extrafinance/xacct`
`contracts/extra-x-account/ExtraXAccountFactory.sol`
(`0x345e8250cB11F61F0d8cFaBAC6be59A356309a58`);
Safe creator
`/tmp/extrafinance/creator_safe`
`…/SafeAccount130Creator.sol`
(`0x1EEA0464D31F349D31FF7D318ce236F48AD92438`);
Coinbase creator
`/tmp/extrafinance/creator_cb`
`…/CoinbaseAccountCreator.sol`
(`0xd4b5D2A9F8e9Ec1883Ef997eB508EA6Cc12B240f`);
Sourcify match (not exact) Aave V3 fork
`/tmp/extrafinance/poolimpl`
`contracts/core-v3/protocol/pool/Pool.sol`
(`0x0353b6221B23B8320202320Ca450EEB9fB0de9E5`)
plus PoolConfigurator / AToken /
VariableDebtToken under
`/tmp/extrafinance/{poolcfg,atoken,debt}`.
Live ExtraX proxy
`0x90cF2763CC710B9Ce215584A89c77F70bbb96B44`.

Checked for: uninitialized ExtraX proxy
takeover; `createAccountFor` that assigns
a Safe/Coinbase account to a stranger;
import of an account the caller does not
own; ExtraFi-specific money-flow in the
Aave-fork Pool.

Result: no user-exploitable finding.

- Live proxy and impl both return
  `initialized() == 1`. EIP-1967
  implementation is the ExtraX factory
  impl; admin is
  `0x750f7153e6c92a24089a34ec6afe65740c9bd40a`.
  `initialize` is `public initializable`
  (once). Not an uninitialized-proxy
  takeover.
- `createAccount` / `createAccountFor`
  are public. They create a Safe 1.3.0
  or Coinbase smart account *owned by
  `owner`* via official L2 factories
  (`0xC228…10BC` + singleton
  `0xfb1b…91EA`; Coinbase
  `0x0BA5…428a`). That is a gift, not
  a steal. Creators are `onlyFactory`.
  Nonce is
  `keccak(factory, EXTRA_X_ACCOUNT_SEED,
  accType, owner, id)`.
- Live `totalAccTypes == 2` and
  `isAccountImportEnabled == false`.
  Import, when enabled, calls
  `validateAccountOwner` (`isOwner` +
  singleton / implementation match).
- Aave-fork Pool is stock Aave V3
  Supply / Borrow / Liquidation /
  FlashLoan / Validation. Grep found no
  ExtraFi-specific money-flow. Do not
  spend a later pass re-auditing Aave
  V3.
- Official extra-contracts repo still
  has only `VaultFactory` + `IveToken`
  for vault / veToken. Registry logic
  ids 101–105 and live vault 1
  (`0x2f8305…A33C`) are Sourcify 404.

Remaining Extra Finance: vault position
logic (not Sourcify) and veToken. Not
submitted.

## 2026-09-03: Index Coop Set Protocol V2

Immunefi program `indexcoop` ($200,000,
`kyc: false`, updated 2026-09-01). Scope
is five Ethereum mainnet etherscan
addresses, no GH tree in the program
JSON. Sourcify exact_match fetched to
`/tmp/indexcoop/`. No mainnet
interaction.

| Address | Contract | Path |
| --- | --- | --- |
| `0xD2463675a099101E36D85278494268261a66603A` | Controller | `ic_controller` |
| `0x2758BF6Af0EC63f1710d3d7890e1C263a247B75E` | SetTokenCreator | `ic_creator` |
| `0xa0a98EB7Af028BE00d04e46e1316808A62a8fd59` | DebtIssuanceModuleV2 | `ic_dimv2` |
| `0x165EDF07Bb61904f47800e13F5120E64C4B9A186` | StreamingFeeModule | `ic_sfm` |
| `0xb9083dee5e8273E54B9DB4c31bA9d4aB7C6B28d3` | IntegrationRegistry | `ic_registry` |

These are Set Protocol V2 (Set Labs,
Apache-2.0, Solidity 0.6.10).

Files: `Controller.sol`,
`SetTokenCreator.sol`,
`DebtIssuanceModuleV2.sol` +
`IssuanceValidationUtils.sol`,
`StreamingFeeModule.sol`,
`IntegrationRegistry.sol`.

Checked for: a non-factory that
registers a Set; issue/redeem that
leaves the Set undercollateralized
beyond the documented aToken ±1 wei
tolerance; streaming fee that inflates
past the committed max; a public
adapter add.

Result: no user-exploitable finding.

- Controller `initialize` is
  `onlyOwner` once. `addSet` is
  `onlyFactory`. Factories / modules /
  resources / fees are owner-gated.
- `SetTokenCreator.create` deploys a
  new Set the caller manages and
  registers it via `controller.addSet`.
  Components / units / modules are
  checked; modules must already be
  enabled. Intended factory path.
- DIMV2 overrides V1 issue/redeem with
  looser post-transfer
  collateralization checks (aToken ±1
  wei rounding). Still
  `onlyValidAndInitializedSet`, pulls
  components from `msg.sender`,
  mints/burns, and charges
  manager/protocol fees. V1 manager
  hooks stay `onlyManagerAndValidSet`.
  Equity in uses
  `preciseMulCeil` as a lower bound
  after the transfer.
- StreamingFee inflates Set supply to
  the manager (and protocol cut).
  `feeStates` are per Set. Max fee is
  committed at `initialize`
  (`onlySetManager` + pending Set).
  `updateStreamingFee` accrues first
  and requires the new fee `< max`.
- IntegrationRegistry add/edit/remove
  are `onlyOwner` and require
  `controller.isModule`.

Remaining Index Coop: none of the five
in-scope addresses. Not submitted.

## 2026-09-03: 0x leftover Bebop / EulerSwap / Curve (`1df9087`)

Same Immunefi program `0x` ($1,000,000,
`kyc: true`). Same clone
`/tmp/0x-settler` at `1df9087`. No
mainnet interaction. Maverick / Dodo /
BalancerV3 already logged.

Files: `src/core/{Bebop,EulerSwap,
CurveTricrypto}.sol`.

Checked for: Bebop that fills more
taker tokens than Settler holds or
sends maker proceeds to the operator;
EulerSwap that spends a pool the
account did not authorize as operator,
or that incurs a second EVC
controller; Curve callback that spends
a Permit2 the taker did not sign.

Result: no user-exploitable finding.

- Bebop settlement is hardcoded
  `_BEBOP =
  0xbbbbbBB520d69a9775E85b458C58c648259FAD5F`
  and is a restricted target. Taker
  fill is `min(Settler balance,
  order.taker_amount)`; maker fill
  scales with that. `amountOutMin`
  applies before approve +
  `fastSwapSingle`. Calldata forces
  `taker_address = address()`
  (Settler) and `receiver =
  recipient`. Maker signature is
  required.
- EulerSwap `sellToEulerSwap` reads
  pool params/reserves first (safe
  because Euler admits only listed
  tokens), caps `ppm` of Settler
  balance at `calcLimits` (supply cap,
  cash, borrow cap, operator
  authorization). Curve solve then
  `fastSwap` to `recipient` if
  `amountOut > 1`. `checkSolvency`
  refuses a deferred-check account,
  refuses a second controller, and
  LTV-adjusts remaining collaterals
  against the single debt vault’s
  oracle. A fake pool can only take
  tokens already in this execution.
- Curve Tricrypto VIP derives the pool
  via CREATE2 from `_curveFactory()` +
  `factoryNonce` packed in `poolInfo`.
  Callback is installed with
  `_setOperatorAndCall`. Permit
  fields live in transient storage.
  Callback asserts `payer == 0` and
  `_transferFrom`s Permit2 /
  AllowanceHolder to `msg.sender`
  (the pool). Code-prefix hash check
  is commented out; a colliding
  CREATE2 at that nonce would still
  only spend the signed permit.

Remaining 0x: PancakeInfinity,
Renegade, Ekubo, Hanji,
NucleusTeller. Not submitted.

## 2026-09-03: 0x leftover Pancake / Renegade / Ekubo / Hanji / Nucleus (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/reviews/0x-settler` at `1df9087`.
No mainnet interaction. Bebop / EulerSwap /
Curve already logged.

Files: `src/core/{PancakeInfinity,Renegade,
EkuboV3,Hanji,NucleusTeller}.sol`,
`src/chains/Mainnet/BridgeSettler.sol`.

Checked for: Pancake / Ekubo lock that
spends a stranger’s Permit2; Renegade
that pays a maker more than this
Settler holds; Hanji / Nucleus that
hits Permit2 or AllowanceHolder.

Result: no user-exploitable finding.

- Pancake Infinity and Ekubo V3 use
  the same notes / VIP pattern as
  UniV4 against hardcoded vault /
  `CORE`. Payer `address(this)`
  transfers from Settler; payer `0`
  uses Permit2. Fills (hooks, pool
  manager id, fee) are in the signed
  action.
- Renegade approves a chain-specific
  `GasSponsorV2`, patches sell amount
  / tokens / recipient into opaque
  signed calldata, then subtracts
  `maxRefundAmount` from reported
  buy (conservative). `minBuyAmount`
  applies.
- Hanji is a caller-chosen book:
  approve or native `ppm`, market
  order, `minBuyAmount`.
- Nucleus Teller / WPAXG are
  hardcoded. `bridge` /
  `depositAndBridge` overwrite share
  or deposit amount to this Settler’s
  balance and forward `selfbalance()`.

0x Settler listed leftover DEX /
bridge mixins treated as exhausted.
Not submitted.

## 2026-09-03: Extra Finance VeToken (LYF)

Same Immunefi program `extrafinance` ($100,000,
`kyc: false`). Scope address
`0xe0BeC4F45aEF64CeC9dCB9010d4beFfB13e91466`
(Optimism). Sourcify `match` fetched to
`/tmp/extrafinance/vetoken/VeToken.sol`.
No mainnet interaction.

Checked for: withdraw of another user’s
lock; `depositFor` that extends a
stranger’s unlock time; transfer of
voting-escrow balance.

Result: no user-exploitable finding.

- Curve-style voting escrow. Locks are
  per `msg.sender`. `withdraw` requires
  `block.timestamp >= end` and pays
  `account` (`msg.sender`) only.
- `depositFor` cannot create a lock or
  extend `end`; it only adds tokens to
  an existing unexpired lock. Tokens
  come from `_msgSender()` via
  `safeTransferFrom`.
- `createLock` / `increaseAmount` /
  `increaseUnlockTime` are
  `msg.sender`-scoped. Unlock is
  rounded to weeks and capped at
  `MAX_TIME`. `checkpoint` is
  permissionless bookkeeping.
- `balanceOf` is voting power, not an
  ERC-20 transferable balance.

Remaining Extra Finance in the
Immunefi assets table: Aave-fork
ACL / PoolAddressProvider /
PoolConfigurator / AToken /
DebtToken / EXTRA. Vault registry
ids 101–105 are not listed on the
program. Not submitted.

## 2026-09-03: Lista DAO Moolah + PublicLiquidator (`ce72699`)

Immunefi program `listadao` ($1,000,000,
`kyc: false`, updated 2026-05-29). Newest
in-scope adds that day:
Moolah
`0x8F73b65B4caAf64FBA2aF91cC5D4a2A1318E5D8C`
and PublicLiquidator
`0x882475d622c687b079f149B69a15683FCbeCC6D9`
(BSC). Official tree
[lista-dao/moolah](https://github.com/lista-dao/moolah)
cloned at `ce72699`. Sourcify
`exact_match` for live Moolah. No mainnet
interaction.

Files: `src/moolah/Moolah.sol`
(borrow / repay / supplyCollateral /
withdrawCollateral / liquidate /
flashLoan / authorization),
`src/liquidator/PublicLiquidator.sol`.

Checked for: borrow of another user’s
position; liquidate of a healthy
position; PublicLiquidator callback
that spends a non-whitelisted pair or
keeps leftover approval; flash loan
that does not pull back.

Result: no user-exploitable finding
in this first slice.

- Borrow / withdrawCollateral require
  `_isSenderAuthorized` unless a
  market `provider` or `broker` is
  set (then only that role). Supply
  and borrow also gate `isWhiteList`
  (empty list = open). Health is
  checked after share math; liquidity
  is `totalBorrow <= totalSupply`.
- `liquidate` requires the caller on
  the market’s liquidation whitelist
  (empty = open), exactly one of
  seized/repaid, and
  `!_isHealthy`. Collateral is sent,
  then `onMoolahLiquidate`, then
  `transferFrom` of `repaidAssets`.
  `_isHealthyAfterLiquidate` forbids
  leaving a dust unhealthy leftover
  below `minLoan`.
- `liquidateBrokerPosition` is
  `msg.sender == brokers[id]` and
  writes off shares without seizing
  collateral (broker-gated).
- Flash loan transfers out, callback,
  then `transferFrom` the same
  amount. Token blacklist is
  admin-set.
- PublicLiquidator `isLiquidatable`
  is an extra allowlist (Moolah
  open-liq / market / per-user), not
  the health check — Moolah still
  requires unhealthy. Flash paths
  `call` only `pairWhitelist` /
  `smartProviders` (MANAGER).
  `NoProfit` compares pre/post loan
  or collateral balances. Approvals
  are zeroed after the swap.
  `onMoolahLiquidate` is `OnlyMoolah`.

Remaining Lista: older lisUSD /
slisBNB / clipper / gemJoin /
distributor / PSM / OFT / strategy
addresses, plus Moolah vault /
IRM / broker / credit-loan in the
same repo if a later pass wants
depth. Not submitted.

## 2026-09-03: 0x leftover EulerSwap / Curve / Pancake / Bebop / Renegade / Ekubo / Hanji / Nucleus / MakerPSM (`1df9087`)

Same Immunefi program `0x` ($1,000,000, `kyc: true`).
Same clone `/tmp/0x-settler` at `1df9087`
(log text also points at `/tmp/reviews/0x-settler`).
No mainnet interaction. Earlier 0x slices
already covered execute / Permit2 / RFQ /
UniV3 / AllowanceHolder / BridgeSettler,
UniV2 / Velodrome / Across /
POSITIVE_SLIPPAGE, leftover bridges,
UniV4 / Relay / SETTLER_SWAP, and
Maverick / Dodo / BalancerV3.

Files: `src/core/{EulerSwap,EulerSwapBUSL,
CurveTricrypto,PancakeInfinity,Bebop,
Renegade,EkuboV2,EkuboV3,Hanji,
NucleusTeller,MakerPSM}.sol`,
`src/core/pancakeInfinityForks/{PancakeInfinity,OrvexCL}.sol`,
`src/chains/{Mainnet,Arbitrum,Base,Bnb,Optimism}/Common.sol`
(dispatch + hardcoded factory / vault /
sponsor / teller).

Checked for: a fake Euler/Hanji pool that
drains a later action; Curve VIP callback
that spends a Permit2 the taker did not
sign; Pancake / Ekubo lock callback that
pays a vault the operator did not set;
Bebop / Renegade settlement that
rewrites receiver past `recipient`;
Nucleus Teller that bridges a user’s
WPAXG they did not send this execution;
MakerPSM that spends constructor
approvals for a caller-chosen fake PSM.

Result: no user-exploitable finding.

- EulerSwap transfers `ppm` of Settler
  balance (capped to the pool’s
  `inLimit`), then `swap` after local
  curve math. Slippage is checked
  before the swap. A fake pool can only
  keep tokens already in this
  execution. `EulerSwapBUSL` is the
  licensed curve library, not an
  entrypoint.
- Curve Tricrypto VIP is compiled out
  of the Mainnet mixin (`//CurveTricrypto`)
  and still live on Arbitrum. Pool is
  CREATE-derived from a hardcoded
  factory (`0xbC07…EE8`) plus the
  action’s factory nonce. The old
  bytecode-prefix check is commented
  out; CREATE from the real factory is
  the deputy check. Callback asserts
  `payer == 0` and Permit2-transfers
  the signed token to `msg.sender`
  (the derived pool).
- Pancake Infinity vault is hardcoded
  (`0x238a…e6c4` on BNB/Base; Orvex
  fork `0xFe7E…b0D`). Lock uses the
  same `_setOperatorAndCall` + notes
  pattern as UniV4. Payer
  `address(this)` transfers from
  Settler; payer `0` uses Permit2.
  Hostile hooks are in the signed
  fills and can only move this
  execution’s notes. Global buy token
  is taken to `recipient` against
  `minBuyAmount`.
- Bebop settlement is hardcoded
  (`0xbbbb…AD5F`) and is a restricted
  target. Taker is overwritten to
  Settler; receiver is overwritten to
  `recipient`. Approval is this
  execution’s balance capped by
  `order.taker_amount`. Proportional
  maker fill is slippage-checked
  before `swapSingle`.
- Renegade calls a per-chain hardcoded
  `GasSponsorV2` (Arbitrum
  `0xcE7a…EBcf`, Base `0xD9E0…e80`).
  Sell amount is this Settler’s
  balance capped by `maxSellAmount`.
  Calldata prefix overwrites
  `recipient` / buy / sell tokens.
  Returned buy amount subtracts
  `maxRefundAmount` before the
  slippage check when the refund is
  not already the buy token.
- Ekubo V2 core `0xe0e0…d444` and V3
  core `0x0000…d701` are hardcoded.
  Same lock/notes pattern. V2 requires
  `payer == address(this)` (no VIP).
  V3 VIP pays via Permit2 to the
  operator-set core.
- Hanji is a caller-chosen pool.
  Settler approves `ppm` of balance
  (or sends native) and places a
  market order. A fake pool can only
  take tokens already in this
  execution.
- Nucleus Teller
  (`0xeE98…59dF`) and WPAXG
  (`0x5cB5…F484`) are hardcoded.
  `bridge` / `depositAndBridge`
  overwrite share/deposit amount to
  this Settler’s current balance.
  `BridgeData.destinationChainReceiver`
  is in the action. Excess native is
  documented as an endpoint refund to
  this contract.
- MakerPSM constructor max-approves
  only LitePSM / SkyPSM / UsddPSM /
  UsddGemJoin. Gem is USDT iff
  `psm == UsddPSM`, else USDC. A fake
  `dai` only changes the local
  balance read used to size the trade;
  the real PSM still pulls the
  approved stable. Oversized fake
  `balanceOf` makes the PSM revert
  when it cannot pull that much.

`src/core/univ3forks/*` are
factory+initHash tables for the
already-logged UniV3 path. OrvexCL is
address constants only. 0x leftover
DEX / teller mixins are exhausted.

Remaining 0x: none of the mixin trees.
Not submitted.

## 2026-09-03: Enzyme Blue Bebop / ThreeOneThird / SharesSplitter (`da3b870` + Sourcify)

Immunefi program `enzymefinance` ($200,000,
`kyc: false`). Gated-redemption wrapper +
share-price throttle already logged.
This slice is the leftover etherscan
adapters / splitter. No mainnet
interaction.

Files: GH `/tmp/reviews/enzyme-protocol`
`da3b870`
`contracts/release/extensions/integration-manager/integrations/adapters/BebopBlendAdapter.sol`,
`contracts/persistent/shares-splitter/{SharesSplitterFactory,SharesSplitterLib,TreasurySplitterMixin}.sol`,
`contracts/persistent/global-config/GlobalConfigLib.sol`
(`isValidRedeemSharesCall`);
Sourcify exact-match Base
`0x5a1c0E89133C4Cd844A8B345370565f1368A79A8`
(`/tmp/reviews/enzyme-tot`)
`ThreeOneThirdAdapter.sol` +
`ThreeOneThirdActionsMixin.sol`
(added to Immunefi 25 May 2026).
BebopBlendAdapter etherscan add is
17 Dec 2025; SharesSplitterFactory is
2022 (same tree).

Checked for: Bebop that sends maker
proceeds off-vault or spends past the
IM transfer; ThreeOneThird batch that
nets spend/incoming so a later hop
is unpaid; splitter redeem that
cashes another user’s unclaimed
shares.

Result: no user-exploitable finding.

- Bebop `action` is
  `onlyIntegrationManager`.
  `parseAssetsForAction` requires
  `receiver == vault` and
  `isAllowedMaker` (list id 0 is
  documented as any maker). IM
  `Transfer`s `taker_amount` to the
  adapter, then checks the vault’s
  maker-token delta against
  `minIncomingAssetAmount`.
- ThreeOneThird `takeOrder` has no
  `onlyIntegrationManager`; it can
  only spend tokens already on the
  adapter (donation / leftover). IM
  still `Transfer`s net spend assets
  and requires the vault incoming
  delta. `parseAssets` nets
  from/to per asset, applies
  `ceilDiv(minToReceiveBeforeFees *
  (10000 - fee) / 10000)`, then
  leftover spend/incoming are
  pushed back to the vault.
- SharesSplitter `init` is
  factory-only once. Splits must
  sum to 100% with unique users.
  `redeemShares` claims only
  `msg.sender`’s share, then
  `isValidRedeemSharesCall` requires
  the vault accessor and a V4
  redeem selector, and the encoded
  shares amount must equal the
  claimed amount. Recipient is
  intentionally unchecked
  (`0x…aaaa`).

Remaining Enzyme Blue leftover
etherscan adapters: none of Bebop /
ThreeOneThird / SharesSplitter.
Extra Finance vault / veToken still
not on Sourcify. Not submitted.

## 2026-09-03: Lista leftover PSM / LisUSD / clip-join / slisBNB (`3e120da` + `67e524c`)

Same Immunefi program `listadao` ($1,000,000,
`kyc: false`). Moolah + PublicLiquidator
already logged. Official trees
[lista-dao/lista-dao-contracts](https://github.com/lista-dao/lista-dao-contracts)
at `3e120da` and
[lista-dao/synclub-contracts](https://github.com/lista-dao/synclub-contracts)
at `67e524c`. Immunefi HTML
(scraped 04:00 UTC 3 Sep) lists lisUSD
`0x0782…41E5`, PSM(USDT)
`0xaa57…eC0c`, LisUSDPoolSet
`0x37DB…D0Bf`, clipCE / clipper
rows, GemJoin rows, and slisBNB
`0xB0b8…14A1`. No mainnet
interaction.

Files: `contracts/{LisUSD,clip,join}.sol`,
`contracts/psm/{PSM,VaultManager,
LisUSDPoolSet,EarnPool}.sol`,
`contracts/ListaStakeManager.sol`,
`contracts/SLisBNB.sol`.

Checked for: PSM buy that skips the
lisUSD pull; LisUSDPoolSet withdraw
that skips a user’s emission bucket;
EarnPool that credits a stranger’s
PSM fill; Clipper `take` of a healthy
vault; GemJoin exit without vat slip;
slisBNB mint without BNB / claim of
another user’s unconfirmed request.

Result: no user-exploitable finding.

- PSM `sell` pulls token, pays
  `amount - fee` lisUSD, deposits the
  full token amount to
  `VaultManager` (`onlyPSMOrManager`).
  `buy` pulls `amount` lisUSD and
  withdraws `amount - fee` token to
  the caller. A 100% `buyFee` can
  increment `fees` without a pull —
  `setBuyFee` is `MANAGER`. Daily
  buy cap and `minBuy` apply.
- VaultManager leftover token stays
  in the vault when adapter points
  sum to zero; otherwise it
  distributes by point. Withdraw
  walks live adapters until `remain
  == 0`.
- LisUSDPoolSet shares accrue a
  synthetic `duty` (BOT, capped by
  `maxDuty`). Rate does not read the
  token balance, so donations do not
  inflate shares. Withdraw rounds
  shares up and requires the caller
  to drain emission weights first.
  `depositFor` is `onlyEarnPool`.
- EarnPool sells through a
  manager-set PSM whose `token()`
  must match, then
  `depositFor(token, msg.sender,
  delta)`. Leftover lisUSD in
  EarnPool is a gift to the next
  depositor, not a steal.
- LisUSD mint is `onlyMinter`. Burn
  spends the holder or their
  allowance. `DEFAULT_ADMIN` is
  hardcoded TimeLock
  `0x07D2…5253`.
- GemJoin / HayJoin `join` / `exit`
  are `auth` (Interaction-gated),
  not public Maker-style joins.
  Clipper `take` is also `auth` +
  Maker dust / `chost` rules;
  PublicLiquidator was the previous
  slice.
- slisBNB mint/burn is
  `onlyStakeManager`. Deposit mints
  against `amountToDelegate +
  totalDelegated` (not
  `address(this).balance`). Instant
  withdraw is whitelist-gated,
  burns the post-fee amount, and
  subtracts from the buffer.
  `claimWithdraw` only pays a
  confirmed uuid to that request’s
  user (or BOT-for-user). Two
  hardcoded incident addresses
  redirect to a recovery vault.

Remaining Lista: SnBnb strategy /
OFT / older distributors / oracles,
and `lista-new-contracts` (`fa5dfa5`,
RWA / slisXAUE / LisAster) if those
addresses are later added to
Immunefi. Not submitted.

## 2026-09-03: Lista Moolah vault + Credit/Lending brokers (`ce72699`)

Same Immunefi program `listadao` ($1,000,000,
`kyc: false`). Moolah core +
PublicLiquidator already logged. Same
clone `/tmp/reviews/lista-moolah` at
`ce72699`. No mainnet interaction.

Files: `src/moolah-vault/MoolahVault.sol`
(deposit / mint / withdraw / redeem /
withdrawFor / redeemFor),
`src/credit-loan/{CreditBroker,CreditToken,
libraries/MoolahOperateLib}.sol`,
`src/broker/LendingBroker.sol`.

Checked for: `withdrawFor` that burns
a stranger’s shares without a
provider; CreditBroker repay that
clears another user’s Moolah debt
with the caller as `onBehalf`;
`_tryWithdrawAndBurnDebt` that
withdraws credit tokens without
burning; LendingBroker borrow that
skips health.

Result: no user-exploitable finding.

- Vault `withdraw`/`redeem` go
  through ERC-4626 `_withdraw`
  (`sender` spends allowance of
  `owner`). `withdrawFor` /
  `redeemFor` require
  `msg.sender == provider` and pass
  the provider-supplied `sender` as
  that caller. Receiver is the
  provider. Deposit/mint whitelist
  the `receiver`.
- CreditBroker supply/borrow/
  withdraw are `msg.sender` +
  merkle `syncCreditScore`.
  `_tryWithdrawAndBurnDebt` pulls
  `debtOf` credit tokens back to
  the user so the following sync
  can `_safeBurn` the excess.
  `_repay` pulls loan tokens from
  `msg.sender` and Moolah-repays
  `onBehalf`. Penalized positions
  must be paid in full. Liquidate
  is `BOT` and only marks
  penalized positions bad debt
  after `liquidateBrokerPosition`.
- LendingBroker dynamic/fixed
  borrow is `msg.sender`, then
  `_validateDynamicPosition` /
  `_borrowFixed`. Repay paths go
  through `LendingBrokerOperatorLib`
  and pull from the caller for
  `onBehalf`.
- `MoolahOperateLib.supplyToMoolahVault`
  documents MEV on interest
  supply; they say it is capped
  on credit markets. Not filed.

Remaining Lista: providers
(SlisBNB / BNB / ERC20-LP),
MasterVault + yield strategies,
OFT / distributors /
`lista-new-contracts` (`fa5dfa5`).
Extra Finance leftover that is
actually in the Immunefi assets
table is Aave-fork ACL /
PoolAddressProvider /
PoolConfigurator / AToken /
DebtToken / EXTRA — not vault
registry ids 101–105. Not
submitted.

## 2026-09-03: Lista SlisBNB / BNB / ERC20-LP providers (`ce72699` + Sourcify)

Same Immunefi program `listadao`
($1,000,000, `kyc: false`). In-scope
BSC adds: slisBNBProvider
`0xfD31…819b` (2024-12-04),
ERC20TokenProvider
`0x2725…aa57` (2025-04-29),
BNBProvider
`0x3673…5701` / `0x501b…35c9`
and SlisBNBProvider
`0x33f7…D5f` (2025-05-27).
Moolah + vault + PSM leftover
already logged. Official tree
[lista-dao/moolah](https://github.com/lista-dao/moolah)
at `ce72699`. ERC20TokenProvider
live proxy is OZ ERC1967;
implementation
`0x946e5C3d32d33128543B785a446B81eedbe74C05`
is Sourcify `ERC20LpTokenProvider`
(`contracts/dao/erc20LpProvider/ERC20LpTokenProvider.sol`,
verified 2026-05-20). No mainnet
interaction.

Files:
`src/provider/{SlisBNBProvider,BNBProvider}.sol`
(and `ETHProvider.sol` as the
WETH twin — **not** an Immunefi
asset),
`src/moolah-vault/MoolahVault.sol`
`withdrawFor` / `redeemFor` (already
logged; re-read for the provider
call), Sourcify
`ERC20LpTokenProvider.sol`.

Checked for: SlisBNBProvider
withdraw of another user’s
Moolah collateral; permissionless
`syncUserLp` that mints unbacked
clis; BNBProvider
`withdraw`/`borrow` that unwraps
to an unauthorized receiver;
ERC20-LP deposit that mints clis
to a stranger or withdraw that
skips the distributor burn.

Result: no user-exploitable finding.

- SlisBNBProvider
  `supplyCollateral` pulls
  slisBNB from `msg.sender`,
  supplies to Moolah `onBehalf`,
  then `_syncPosition`.
  `withdrawCollateral` requires
  `_isSenderAuthorized`
  (`msg.sender == onBehalf` or
  Moolah allowance). `liquidate`
  is `onlyMoolah`. LP rebalance
  converts `userTotalDeposit`
  through `STAKE_MANAGER` ×
  `userLpRate` (MANAGER, ≤ 1e18)
  and mints/burns via
  `_mintToMPCs` / `_safeBurnLp`.
  If `providers[id][TOKEN]` is
  not this contract, recorded
  collateral is treated as 0
  (intended unbind).
  `delegateAllTo` is disabled
  once `slisBNBxMinter` is set.
  Permissionless `syncUserLp`
  only remints to the recorded
  holder. Transferring clis away
  leaves leftover tokens in
  circulation (`_safeBurnLp`
  burns `min(need, balance)`);
  that is a receipt-token
  footgun, not a steal of
  slisBNB.
- BNBProvider wraps `msg.value`
  to WBNB and deposits only into
  manager-whitelisted vaults
  whose `MOOLAH()` / `asset()`
  match. `withdraw`/`redeem`
  call vault `withdrawFor` /
  `redeemFor` (`msg.sender ==
  provider`) with the
  provider-supplied `sender` as
  the ERC-4626 spender, then
  unwrap to `receiver`.
  `borrow` / `withdrawCollateral`
  require `isSenderAuthorized`.
  Excess BNB on `mint` / `repay`
  is refunded to `msg.sender`.
  `liquidate` is an empty
  `onlyMoolah` hook.
- ERC20LpTokenProvider
  `deposit` / `withdraw` are
  `msg.sender`-scoped.
  `_deposit` transfers the LP
  token, `depositFor`s the
  distributor, then rebalances
  clis to the chosen delegatee.
  `withdraw` calls
  `withdrawFor(_amount,
  msg.sender)` before
  rebalance. `syncUserLp` is
  permissionless bookkeeping.
  `initialize` compares
  `_exchangeRate >= userLpRate`
  against **storage** (still 0),
  so a bad first-time pair of
  rates can underflow
  `newReservedLp` — that is
  deploy/admin config, and
  later `setUserLpRate`
  requires `_userLpRate <=
  exchangeRate`. Live proxy
  has been serving since Apr
  2025. Not filed.

Remaining Lista: MasterVault +
yield strategies, OFT /
distributors /
`lista-new-contracts`. Extra
Finance in-scope leftover is
Aave-fork ACL / config / aToken
/ EXTRA, not vault 101–105.
Not submitted.

## 2026-09-03: Lista MasterVault + yield strategies (`3e120da`)

Same program. Official
[lista-dao/lista-dao-contracts](https://github.com/lista-dao/lista-dao-contracts)
at `3e120da`. Immunefi lists
Master Vault
`0x986b…cc54` and
Ceros / stkBNB / snBNB /
bnbYieldConverter strategies
(2024-02-22). PSM / clip-join
already logged. No mainnet
interaction.

Files:
`contracts/masterVault/MasterVault.sol`,
`contracts/strategy/{BaseStrategy,SnBnbYieldConverterStrategy}.sol`,
`contracts/old/strategy/{CerosYieldConverterStrategy,StkBnbStrategy}.sol`.

Checked for: MasterVault mint
without `onlyProvider`;
`withdrawETH` that pays more
BNB than burned shares;
strategy `withdraw` callable
by a stranger; FIFO
distribute that pays the
wrong recipient.

Result: no user-exploitable
finding.

- `depositETH` /
  `withdrawETH` /
  `withdrawInTokenFromStrategy`
  are `onlyProvider`.
  Deposit mints `amount -
  depositFee` ceToken to the
  provider. Withdraw burns
  `amount` from the provider,
  pays `amount - withdrawalFee`
  from idle BNB, then pulls
  the shortfall from active
  strategies (debt-capped).
  `withdrawInTokenFromStrategy`
  burns first, then
  `withdrawInToken` on the
  strategy. `allocate` /
  `retireStrat` /
  `migrateStrategy` are
  manager.
- `BaseStrategy` `deposit` /
  `withdraw` are `onlyVault`.
  `receive` accepts BNB only
  from `destination` or
  `strategist`.
- SnBnb strategy `_withdraw`
  records FIFO
  `{recipient, amount}` and
  batches `requestWithdraw`
  permissionlessly (≥ 1h).
  `_distributeFund` pays the
  recorded recipient (5000
  gas); failed sends go to
  `manualWithdrawAmount`
  (anyone can
  `distributeManual` to that
  recipient). `withdrawInToken`
  transfers
  `convertBnbToSnBnb(amount)`
  and decrements
  `bnbDepositBalance`.
  Harvest is strategist-only
  and sends surplus snBNB
  (holding − queued unstake −
  BNB-equivalent) to
  `rewards`.
- Ceros / StkBnb old
  strategies are the same
  `onlyVault` deposit/withdraw
  pattern plus a strategist
  panic that withdraws vault
  debt to the vault.

Remaining Lista: OFT /
distributors /
`lista-new-contracts`
(`fa5dfa5`). Extra Finance
in-scope leftover is the
Aave-fork ACL / config /
aToken / EXTRA set. Not
submitted.

## 2026-09-03: Lista leftover strategy / OFT / distributors / providers (`3e120da` + `28a3c02` + `fa5dfa5`)

Same Immunefi program `listadao` ($1,000,000,
`kyc: false`). PSM / LisUSD / clip-join /
slisBNB already logged. Official trees
`lista-dao-contracts` `3e120da`,
`lista-token` `28a3c02`,
`lista-new-contracts` `fa5dfa5`.
Immunefi HTML (rechecked 04:03 UTC 3 Sep)
lists snBNBStrategy / Ceros / stkBNB /
bnbYieldConverter, ListaOFTAdapter
`0x837C…E7B3`, VenusAdapter(USDT),
SlisBNBProvider / ERC20TokenProvider,
Borrow / Collateral / Stake
distributors, VeListaRevenueDistributor,
VeListaInterestRebater, and
LendingRewardsDistributor. No mainnet
interaction.

Files: `contracts/strategy/{BaseStrategy,
SnBnbYieldConverterStrategy}.sol`,
`contracts/old/strategy/CerosYieldConverterStrategy.sol`,
`contracts/psm/VenusAdapter.sol`,
`contracts/ceros/{ClisToken,provider/BaseTokenProvider,provider/SlisBNBProvider}.sol`,
`contracts/{Interaction,libraries/AuctionProxy}.sol`,
`lista-token/contracts/oft/ListaOFTAdapter.sol`,
`lista-token/contracts/dao/{CommonListaDistributor,BorrowListaDistributor,CollateralListaDistributor,StakeLisUSDListaDistributor,VeListaRevenueDistributor}.sol`,
`lista-new-contracts/src/{LendingRewardsDistributor,VeListaInterestRebater}.sol`.

Checked for: a permissionless strategy
withdraw that pays a stranger; Venus
harvest that drains principal; provider
`release` of another user’s token;
`daoBurn` that leaves LP spendable
after bark; OFT credit while paused;
distributor claim of another user’s
integral; merkle claim that pays the
caller.

Result: no user-exploitable finding.

- SnBnb / Ceros strategies:
  `deposit` / `withdraw` are
  `onlyVault`. Harvest is
  `onlyStrategist`. FIFO unstake
  pays the recorded recipient;
  failed 5k-gas sends go to
  `manualWithdrawAmount[recipient]`.
  Yield is `snBNB balance -
  snBnbToUnstake -
  convert(bnbDepositBalance)` and
  underflows rather than over-harvest.
- VenusAdapter is
  `onlyVaultManager`. Public
  `harvest` sends interest above
  `netDepositAmount` to
  `feeReceiver`. Withdraw cannot
  exceed `netDepositAmount`.
- BaseTokenProvider `provide` /
  `release` are `msg.sender`.
  `liquidation` / `daoBurn` are
  `PROXY`. After `dog.bark`,
  `dao.locked` is 0 so `daoBurn`’s
  `_syncLp` burns leftover LP even
  though it ignores `_amount`.
  SlisBNBProvider mints a reserve
  cut to `lpReserveAddress`;
  `releaseFor` is migrator-only.
  `withdrawLeftover` pays
  `dao.free` of `msg.sender`.
- ClisToken mint/burn is
  `onlyMinter`; token is
  non-transferable.
- ListaOFTAdapter is LayerZero
  `OFTAdapter` plus pause and
  per-dest transfer limits. `_debit`
  / `_credit` are `whenNotPaused`.
- CommonListaDistributor snapshots
  are `MANAGER` (Interaction).
  `claimReward` pays `msg.sender`
  via the vault; `vaultClaimReward`
  is `VAULT`. VeListaRevenueDistributor
  `distribute` is `BOT` and splits
  to receiver + `dEaD`.
- LendingRewardsDistributor and
  VeListaInterestRebater merkle
  leaves encode `chainid, account,
  totalAmount`. Anyone may submit
  a proof; tokens go to `_account`.
  Pending root waits ≥6h (default
  1 day). `emergencyWithdraw` is
  `MANAGER`.

Remaining Lista: price-feed oracles,
Pancake V3 / BNB vault provider
wrappers if they are not the same
BaseTokenProvider path, and
`lista-new-contracts` RWA / slisXAUE /
LisAster (not in the Immunefi HTML).
Not submitted.

## 2026-09-03: Extra Finance Aave-fork leftover (ACL / config / aToken)

Immunefi program `extrafinance`
($100,000, `kyc: false`). LYF +
ExtraX + Pool skim + VeToken
already logged. Remaining
**listed** assets (2024-11-26)
are Optimism Aave-v3-fork
PoolConfigurator
`0x9378…0ADC`, AToken
`0x2B27…662E`, DebtToken
`0xC0C8…d5E`,
PoolAddressProvider
`0xA98c…721d`, ACL
`0x70Cd…595f`, and EXTRA
`0x2dad…8f8`. Vault registry
ids 101–105 are not in the
assets table. Sourcify extracts
under `/tmp/extrafinance/{atoken,
debt,poolcfg}`. No mainnet
interaction.

Files:
`protocol/tokenization/{AToken,VariableDebtToken}.sol`,
`protocol/pool/PoolConfigurator.sol`.

Checked for: aToken mint/burn
without `onlyPool`; debt token
that a user can mint to
themselves; configurator
`initReserves` / `dropReserve`
callable by a non-admin.

Result: no user-exploitable
finding. This is stock Aave v3
tokenization + configurator.

- AToken `mint` / `burn` /
  `mintToTreasury` /
  `transferOnLiquidation` /
  `transferUnderlyingTo` /
  `updateTreasury` are
  `onlyPool`. `rescueTokens` is
  `onlyPoolAdmin`. Scaled
  balances use
  `getReserveNormalizedIncome`.
- VariableDebtToken `mint` /
  `burn` are `onlyPool`.
  `user != onBehalfOf` spends
  borrow allowance. ERC-20
  `transfer` / `approve` revert
  `OPERATION_NOT_SUPPORTED`.
- PoolConfigurator
  `initReserves` is
  `onlyAssetListingOrPoolAdmins`;
  `dropReserve` / treasury /
  interest-rate updates are
  `onlyPoolAdmin`; collateral /
  borrow flags are
  `onlyRiskOrPoolAdmins`; pause
  is `onlyEmergencyOrPoolAdmin`.
  Roles resolve through the
  addresses-provider ACL.

Remaining Extra Finance listed
Solidity: EXTRA token (standard
ERC-20, not pulled here). Vault
101–105 stay OOS. Not
submitted.

## 2026-09-03: Lista new-contracts RWA / slisXAUE / LisAster / leftover distributors (`fa5dfa5`)

Same Immunefi program `listadao` ($1,000,000,
`kyc: false`). Official tree
[lista-dao/lista-new-contracts](https://github.com/lista-dao/lista-new-contracts)
at `fa5dfa5`. Immunefi HTML
(scraped earlier 3 Sep) still lists
the Moolah / PSM / slisBNB table;
these RWA / XAUE / LisAster proxies
are not on that table. Program text
also invites out-of-table Lista
assets when the impact matches.
No mainnet interaction.

Files: `src/rwa/{RWAEarnPool,RWAAdapter,
OTCManager}.sol`,
`src/slisXAUE/{SlisXAUE,XAUEAdapter,
XAUTStaking}.sol`,
`src/lisaster/{LisAster,LisAsterStaking,
LisAsterDistributor,AsterVault,
AsterRewards}.sol`,
`src/{LendingRewardsDistributor,
LendingRewardsDistributorV2,
VaultDistributor,RewardsRouter,
BeraChainVaultAdapter}.sol`.

Checked for: EarnPool withdraw that
pays a stranger; adapter notify that
inflates share price for the next
depositor; XAUE adapter interest on
unowned shares; SlisXAUE mint without
MINTER; LisAster claim that redirects
payout; `claimAndStake` that stakes
to the caller instead of the leaf
account; distributor claim that pays
`msg.sender`; VaultDistributor claim
that skips the LP / merkle bind.

Result: no user-exploitable finding
on in-scope table assets. Not
submitted.

- RWAEarnPool `deposit` mints then
  `transferFrom` to the adapter
  (reverts together). Whitelist
  gates `receiver` on deposit and
  share transfer. `requestWithdraw`
  burns the caller, queues for
  `receiver`. `claimWithdraw` pays
  `user`, not the caller.
  `convertToShares/Assets` uses
  `totalSupply+1` / `totalAssets()+1`.
  `finishWithdraw` is adapter-only.
- RWAAdapter vault / OTC / fee
  paths are BOT or MANAGER.
  `_updateVaultAssets` only notifies
  when vault NAV rose.
- SlisXAUE mint/burn is `onlyRole
  (MINTER)`. XAUTStaking deposit
  and `requestWithdraw` sync adapter
  NAV first. `claimWithdraw` is
  self-only. Adapter NAV uses
  `expectedShareBalance` and
  fail-closes on a share deficit
  or NAV drop.
- LisAster `stake`/`unstake` are
  `msg.sender`. `stakeFor` is a
  permissionless gift. Distributor
  merkle leaf is
  `(chainid, account, asterToken,
  cumulative)`. `claim` pays
  `account`. `claimAndStake` is
  self-only and deposits 1:1 into
  AsterVault then `stakeFor`.
- LendingRewardsDistributor /
  V2 claims pay `_account` after
  a chainid-bound proof. V2 leaf
  also binds `address(this)`,
  `claim.selector`, and token.
  RewardsRouter transfers are BOT
  to a whitelisted distributor.
- VaultDistributor pulls
  `_lpAmount` into the contract and
  never returns it; the leaf binds
  that amount. MANAGER
  `emergencyWithdraw` is the only
  escape. Not filed: not on the
  Immunefi table, and a privileged
  rescue exists.
- BeraChainVaultAdapter user
  `withdraw` burns the caller’s LP
  1:1. Manager/bot drains are
  privileged.

Remaining Lista: price-feed oracles /
VeLista lock / airdrop. Extra
Finance leftover listed Solidity is
EXTRA token. Not submitted.

## 2026-09-03: Lista leftover price-feed oracles (`fa5dfa5`)

Same Immunefi program `listadao` ($1,000,000,
`kyc: false`). Same clone
`/tmp/reviews/lista-new-contracts` at
`fa5dfa5`. Program text still
excludes third-party oracle data
(not oracle-manipulation / flash-loan
attacks). No mainnet interaction.

Files: `src/oracle/{LisAsterPriceFeed,
wNLPPriceFeed,AtlasOracleAdaptor}.sol`,
`src/oracle/priceFeed/sUSDSPriceFeed.sol`.

Checked for: a feed that lets a
caller set the answer; scale that
wraps a negative Atlas price into
a huge unsigned; wNLP / sUSDS rate
that a stranger can inflate on-chain
without touching the wrapper.

Result: no user-exploitable finding.
Not submitted.

- LisAsterPriceFeed is
  `ASTER * 0.8` from ResilientOracle
  `peek`. No admin. `getRoundData`
  stamps `block.timestamp`.
- AtlasOracleAdaptor rescales 1e18
  → 1e8. `ans <= 0` becomes 0
  (ResilientOracle INVALID_PRICE).
- wNLP and sUSDS multiply the
  wrapper `convert` / `getNlpByWnlp`
  rate by `peek(underlying)`. Rate
  has no timestamp (documented).
  Constructor / constants pin
  addresses.

Remaining Lista: VeLista lock /
airdrop. Extra Finance leftover
listed Solidity is EXTRA token.
Not submitted.

## 2026-09-03: Yearn stYFI July leftover (YBC / funding / bonus / team) (`69e262e`)

Immunefi program `yearnfinance`
($200,000, `kyc: false`). July 1
2026 adds: Weight Aggregator
`0x6973…ECd7`, YBC Weight
Aggregator `0xADB7…8D9`, YBC
`0xd6AF…B315`, YBC Reward
Distributor `0x5310…bbe1`, YBC
Election `0xe166…206C`, Bonus
Recipient `0xf03a…9e4C`, Team
Registry `0x9da4…2F29`, Team
impl `0xa59B…BF43`, Team
Accountant `0x1c22…DFD6`,
Revenue Recipient `0x5B5A…9587`,
Revenue Price Oracle
`0xC1f9…E2E`, Funding
Distributor `0xbCc9…116b`,
Bonus Distributor `0xA660…1116`,
Bonus Price Oracle `0x7e41…b416`,
Staking Middleware
`0x24b2…0A86`. Official tree
[yearn/stYFI](https://github.com/yearn/stYFI)
at `69e262e`. No mainnet
interaction.

Files: `contracts/ybc/{YBC,
YBCElection,YBCRewardDistributor,
YBCWeightAggregator,
YBCBonusRecipient}.vy`,
`contracts/{WeightAggregator,
FundingDistributor,BonusDistributor,
Team,TeamRegistry,TeamAccountant,
RewardClaimer,RewardDistributor}.vy`.

Checked for: YBC claim that pays
the caller instead of the member
without a claimer gate; election
execute of a failed vote; funding
claim by a non-team; bonus claim
by a non-owner; RewardClaimer
that claims a stranger’s
components into the caller.

Result: no user-exploitable
finding. Not submitted.

- YBC `add_member` /
  `remove_member` are
  `msg.sender == self` via
  operator `call`. Election
  execute is permissionless
  only after the proposal
  epoch + 1 and `_passed`.
  Members cannot vote their
  own expulsion.
- YBCRewardDistributor
  `claim` requires
  `claimers[msg.sender]` and
  pays the claimer. RewardClaimer
  is the intended claimer: it
  calls `claim(msg.sender)`
  then transfers to
  `_recipient` (default caller).
- FundingDistributor `claim`
  is `msg.sender == team` and
  `registry.is_team`. Refund
  does not unwind `used`.
  Team `claim_funding` is
  owner-only.
  `return_funding` is
  permissionless donate-back.
- BonusDistributor `claim` is
  `ITeam(_team).owner()`.
  `finalize_period` is
  operator-or-unset.
- WeightAggregator hooks
  require `depositors
  [msg.sender]`. YBCWeightAggregator
  member hooks require
  `upstream_members`; stake
  hooks require
  `upstream_weights`.
- RewardDistributor `claim`
  pays `msg.sender` and
  unpacks that caller as a
  registered component.

Remaining Yearn stYFI: Feb 2026
core (StakedYFI / liquid lockers /
veYFI distributor) if a later
pass wants it. Twyne / Hashflow
still unreviewed. Remaining
Lista: VeLista lock / airdrop.
Not submitted.

## 2026-09-03: Lista VeLista lock + airdrop (`28a3c02`)

Same Immunefi program `listadao`
($1,000,000, `kyc: false`). Official
tree [lista-dao/lista-token](https://github.com/lista-dao/lista-token)
at `28a3c02`. OFT / dao
distributors already logged. No
mainnet interaction.

Files: `contracts/{VeLista,
ListaAirdrop}.sol`.

Checked for: lock that credits a
stranger; `claim` / `earlyClaim`
that pays the caller for another
account; airdrop leaf collision
or payout to `msg.sender`.

Result: no user-exploitable
finding. Not submitted.

- `lock` / `relockUnclaimed` /
  `extendWeek` / `claim` /
  `earlyClaim` are `msg.sender`.
  `increaseAmountFor` is a
  permissionless gift (caller
  pays LISTA).
- `claim` requires the lock
  expired and not auto-lock,
  then pays the caller.
  `earlyClaim` is self-only,
  applies `getPenalty`, and
  zeros the position.
- ListaAirdrop leaf is
  `keccak256(abi.encodePacked
  (account, amount))`. `claim`
  pays `account`. Owner can
  change the root only before
  `startTime`. `reclaim` is
  owner after both
  `reclaimPeriod` and
  `endTime`.

Remaining Lista leftover: none
of the named VeLista lock /
airdrop / oracle slices.
Extra Finance leftover listed
Solidity (EXTRA) is logged
below. Not submitted.

## 2026-09-03: Hashflow factory / pool / router (`e41cfaa`)

Immunefi program `hashflow`
($50,000, `kyc: false`). 8 Jun
2026 listed assets:
HashflowFactory
`0xdE82…DAb5`, plus the
three sibling pool/router
rows. Official tree
[hashflownetwork/x-protocol](https://github.com/hashflownetwork/x-protocol)
at `e41cfaa`. No mainnet
interaction.

Files: `evm/contracts/
{HashflowFactory,
HashflowRouter}.sol`,
`evm/contracts/pools/
HashflowPool.sol`.

Checked for: permissionless
`createPool`; RFQ-T that pays
a stranger without a MM
signature; RFQ-M that skips
the taker signature; x-chain
`fillXChain` from an
unauthorized messenger.

Result: no user-exploitable
finding. Not submitted.

- Factory `createPool` is
  allowlisted. `updatePoolImpl`
  is owner and one-shot.
- Router RFQ-T pulls
  `effectiveBaseTokenAmount`
  from `_msgSender` and
  requires an authorized
  pool. Pool `tradeRFQT` is
  router-only, recovers the
  MM signer, and pays
  `quote.trader`. The RFQ-T
  hash binds trader /
  effectiveTrader / amounts /
  nonce / expiry / chainid.
  Partial fills scale quote
  tokens down only.
- RFQ-M requires the trader
  EIP-1271 / EOA signature
  and a unique `txid`, then
  pulls from `quote.trader`.
- `fillXChain` requires an
  authorized messenger and
  peer pool. Pool `fillXChain`
  is router-only and
  one-shots `txid`.

Remaining Hashflow: the listed
Wormhole messenger (this pass
below). There is no Aave portal
row in the Immunefi table.
Twyne GitHub is still private
from this VM. Extra Finance
leftover listed Solidity is
EXTRA token. Not submitted.

## 2026-09-03: Extra Finance EXTRA token (Sourcify)

Immunefi program `extrafinance`
($100,000, `kyc: false`). Last
listed leftover Solidity is
Optimism EXTRA
`0x2dAD3a13ef0C6366220f989157009e501e7938F8`
(token row, 2023-08-30). Sourcify
v2 exact match, verified
2024-08-08. Contract name
`EXTRA`. Extract under
`/tmp/extrafinance/extra-token`.
No mainnet interaction.

Files: `contracts/EXTRA.sol`
plus stock OZ `ERC20` /
`Ownable`.

Checked for: permissionless
mint; mint that ignores the
cap; ownerless mint via a
public initializer.

Result: no user-exploitable
finding. This is a capped
owner-mint ERC-20. Closes
Extra Finance listed Solidity
(vault factory ids 101–105
stay off the table). Not
submitted.

- Constructor sets an
  immutable `supplyCap`.
  `mint` is `onlyOwner` and
  reverts when
  `totalSupply() + amount`
  exceeds `cap()`. No burn,
  no permit, no hooks.
- Primacy of Impact still
  covers ExtraFi-owned
  Critical / High / Medium
  off-table assets; this pass
  only closes the EXTRA row.

## 2026-09-03: Hashflow Wormhole messenger (Sourcify)

Same Immunefi program
`hashflow` ($50,000,
`kyc: false`). Fourth 8 Jun
2026 listed asset:
Hashflow Wormhole Messenger
`0x0a09B370950f69ADC4c2FbF8677C7b0047599c9F`.
Sourcify v2 exact match,
verified 2024-08-08. Contract
name `HashflowWormholeMessenger`.
Extract under
`/tmp/hashflow/wormhole`.
Factory / pool / router
already logged (`e41cfaa`).
No mainnet interaction.

Files:
`contracts/xchain/
{HashflowWormholeMessenger,
HashflowXChainMessengerBase}.sol`.

Checked for: `tradeXChain`
from a non-router; a VAA
from an unauthorized emitter
that still fills; a
permissioned-relayer bypass;
payload amounts that ignore
the source partial fill;
replay of the slow + fast
VAAs against the same
`txid`.

Result: no user-exploitable
finding. Listed Hashflow
Solidity is now exhausted.
Not submitted.

- `tradeXChain` is
  router-only and requires
  `quote.srcChainId ==
  hChainId`. Payload
  `quoteTokenAmount` is the
  amount the router already
  scaled for a partial RFQ-T.
- `publishMessage` spends
  `messageFee` (doubled when
  a fast consistency level
  and a permissioned relayer
  are set). Excess `msg.value`
  stays on the messenger;
  `withdrawFunds` is owner.
  Self-grief, not theft.
- `wormholeReceive` requires
  a Guardian-valid VAA, a
  configured source H-chain,
  and `vm.emitterAddress ==`
  the stored remote (left-
  padded). Destination
  addresses must be canonical
  EVM (high 12 bytes zero).
  A non-zero
  `permissionedRelayer` must
  be the caller.
- Router `fillXChain` still
  gates messenger + peer
  pool; pool `fillXChain`
  one-shots `txid`, so the
  slow and fast VAAs cannot
  double-pay.
- `dstContract` /
  `dstCalldata` are not MM-
  signed. Destination
  callback still requires the
  callee to opt in both the
  source caller and the
  messenger. Dust partial
  fills of an x-chain RFQ-T
  can burn `dstTrader`’s
  nonce; that is quote
  griefing, not a redirect.

## 2026-09-03: Magpie Wombat USDC deposit helper (Sourcify)

Immunefi program `magpiexyz`
($200,000, `kyc: false`).
Listed 2023-01-13 asset
“Main Pool USDC Deposit
Helper”
`0xb68F5247f31fe28FDe0b0F7543F635a4d6EDbD7F`
(BSC). Sourcify v2 exact
match, verified 2026-06-03.
Contract name
`WombatPoolHelper`. Extract
under `/tmp/magpie/helper`.
The 26 Aug 2026 add is
Primacy of Impact only. No
mainnet interaction.

Files:
`contracts/wombat/
WombatPoolHelper.sol`.

Checked for: deposit that
stakes to the caller while
pulling a stranger; withdraw
that burns someone else’s
receipt; native path that
keeps the wrapped BNB.

Result: no user-exploitable
finding. Listed Magpie
Solidity is this helper;
POI remains. Not submitted.

- `deposit` / `depositLP`
  measure `stakingToken`
  balance, call
  `wombatStaking`, then
  `_stake` the delta to
  `msg.sender`. A donated
  receipt is a gift to the
  next depositor, not a
  theft.
- `depositNative` wraps
  `msg.value`, approves
  exactly that amount, and
  deposits from the helper.
- `withdraw` pulls from
  Wombat for the caller,
  `withdrawFor`s the same
  liquidity from MasterMagpie,
  then burns the receipt.
- `harvest` is anyone-calls
  into `wombatStaking`.
## 2026-09-03: Lista leftover CDP oracles (`3e120da`)

Same Immunefi program `listadao`
($1,000,000, `kyc: false`). This
is the in-scope CDP oracle tree
in [lista-dao/lista-dao-contracts](https://github.com/lista-dao/lista-dao-contracts)
at `3e120da`, not the already-logged
`lista-new-contracts` LisAster /
wNLP / Atlas / sUSDS feeds at
`fa5dfa5`. Official HTML / unofficial
mirror (3 Sep) lists eight oracle
rows: ResilientOracle
`0xf3af…c750` plus the STONE /
solvBTC / BBTC / SolvBTC.BBN /
USDF / asUSDF / USD1 pips.
Read-only BSC `eth_call` only;
no state-changing txs.

Files: `contracts/oracle/
ResilientOracle.sol`,
`BoundValidator.sol`,
`HelioOracle.sol`,
`PythOracle.sol`,
`API3Oracle.sol`,
listed pip wrappers
(`StoneOracle`, `SolvBtcOracle`,
`BBtcOracle`, `SolvBTCBBNOracle`,
`xSolvBtcOracle`, `UsdfOracle`,
`AsUsdfOracle`, `Usd1Oracle`,
`SlisBnbOracle`, `BnbOracle`,
`WeEthOracle`, `asBnbOracle`,
`sUsdxOracle`), and
`contracts/oracle/priceFeeds/*`
(`Stone`, `SlisBnb`, `AsBnb`,
`StableUsdt`, `StableAsUsdf`,
`sUSDX`, `sUSDXLiquidation`,
`USDXLiquidation`, `yUSD`,
`yUSDFixed`, `sUSD1`, `sUSDe`,
`xSolvBtc`, `uniBTC`, `mXRP`,
`wsrUSD`, `wstUSR`, `wNLPUSDT`,
`PufEth`, `WBETH`, `WstETH`,
`lisUSD`).

Checked for: a raw AggregatorV3
main with pivot disabled so a
negative `answer` wraps through
`uint256(answer)` into a huge
CDP price; `setTokenConfigs`
without `onlyOwner`; wrapper
`peek` that returns
`(huge, true)` on a failed
inner price; composite feeds
that skip positivity or
staleness; `convertToAssets` /
`convertSnBnbToBnb` donation
inflation.

Result: no user-exploitable
finding on the eight listed
oracle addresses. Not
submitted.

- `getPriceFromOracle` casts
  `int256 answer` to `uint256`
  with no `answer > 0` check
  (Venus’s original feed does
  check). If pivot is disabled,
  `_getMainOraclePrice` returns
  `(mainPrice, true)` with no
  BoundValidator. A negative
  aggregator answer would wrap.
  `setTokenConfigs` has no
  modifier but calls
  `setTokenConfig`, which is
  `onlyOwner`.
- Live `getTokenConfig` on
  ResilientOracle (BSC block
  ~119660895): solvBTC / USDT /
  USDF / USD1 / WBNB / ETH /
  BTC / USDe have pivot +
  fallback enabled. USDX /
  STONE / slisBNB / asUSDF /
  BBTC / xSolvBBN / sUSDX /
  yUSD / XRP are main-only
  (`enabled [1,0,0]`).
- Those main-only mains are
  Lista composites (or WINkLink
  BBTC/BBUSD), not raw
  Chainlink — except XRP
  `0x93a6…4fda` (“XRP / USD”).
  Sampled Chainlink
  aggregators (XRP, solvBTC,
  USDT, ETH) have `minAnswer
  = 1`, so the wrap cannot
  fire on those feeds. XRP /
  yUSD / sUSDX are not on the
  57-asset Immunefi table.
  BBTC’s WINkLink pair has no
  `minAnswer`; BBtcOracle
  still treats `price <= 0`
  as `(0, false)`. Do not
  file the wrap without a
  listed asset whose **main**
  is a raw feed that can
  return `answer < 0` **and**
  pivot off.
- In-scope pip proxies
  (EIP-1967) all `peek()`
  successfully: STONE
  impl holds STONE +
  ResilientOracle; solvBTC /
  BBTC impls hold their
  token + ResilientOracle;
  USDF / asUSDF / USD1 impls
  hold the matching token.
  Live SolvBTC.BBN pip equals
  the solvBTC pip
  ($77,585.27), not the
  xSolvBtcPriceFeed USD print
  ($77,613.60). Source
  `SolvBTCBBNOracle` would
  double-count if both peeks
  were USD 8-dec; that path
  is not what the live pip
  returns.
- Wrapper `peek()` mostly
  returns `has=true`.
  `ResilientOracle.peek`
  **reverts** on invalid, so
  Interaction /
  `collateralPrice` never
  sees a silent stale-false.
  `SolvBtcOracle` /
  `BBtcOracle` extra-check
  `price <= 0`. `WeEthOracle`
  rejects `price1 < 0 ||
  price2 < 0` and 6h / 300s
  staleness.
- Composite
  `latestRoundData` mocks
  `updatedAt = block.timestamp`,
  so outer ResilientOracle
  staleness on the wrapper
  never fires. Nested
  `latestRoundData` still
  enforces its own window
  (Stone/ETH 24h+300s,
  sUSD1 24h+300s, xSolv /
  PufETH / wstETH 6h+300s,
  uniBTC / wsrUSD / wstUSR
  24h+300s). `mXRPPriceFeed`
  ignores `updatedAt` and
  clamps the ratio to
  `[1.0, 1.5]` 8-dec; mXRP
  is not on the Immunefi
  table.
- `HelioOracle` is
  owner-set. Trusted.
  `yUSDFixedPriceFeed` is
  hardcoded `112400000`
  (1.124e8) and is the live
  yUSD main; not listed.
  `sUSDXLiquidationPriceFeed`
  / `USDXLiquidationPriceFeed`
  are documented emergency
  feeds; manager
  `0x8d38…B0c6` sets the
  rate. `lisUSDPriceFeed`
  is fixed `1e8`.
- `StableUsdtPriceFeed`
  clamps USDT to
  `[0.98, 1.02]` 8-dec
  (protocol risk on a
  deeper depeg, by design).
- `sUSDXPriceFeed` /
  `yUSDPriceFeed` use
  ERC-4626 `convertToAssets
  (1e18)`. `SlisBnbPriceFeed`
  uses `convertSnBnbToBnb`
  over `amountToDelegate +
  totalDelegated`, not the
  contract’s BNB balance, so
  a raw BNB donation does
  not inflate the rate.
- `PythOracle` uses
  `getPriceUnsafe`; freshness
  is only
  `timeDeltaTolerance` if
  that adapter is a
  ResilientOracle source.
  `API3Oracle` divides the
  18-dec dAPI by `1e10` to
  8-dec.
- `BoundValidator` rejects
  `reportedPrice == 0` /
  `anchorPrice == 0`; ratios
  are 18-dec.
- Copy-paste notes, not
  filed: `asBnbOracle`
  constant `AsBNB_TOKEN_ADDR`
  is the slisBNB address
  (underprices asBNB if used
  as a pip; protocol-safe).
  `sUsdxOracle.peek` reads
  USDT, not sUSDX.

Lista CDP oracle + new-contracts
oracle + VeLista lock / airdrop
slices are now logged. Listed
Extra Finance and Hashflow
Solidity are exhausted. Not
submitted.

## 2026-09-03: SparkLend sUSDC vault + PSM Variant1 actions (Sourcify)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Newest money-moving adds
(15 Jul 2026): Ethereum SUSDC
proxy
`0xBc65ad17c5C0a2A4D159fa5a503f4992c7B545FE`,
SUSDC_IMPL
`0xf943Cb8D5f06f2bBF352878ebEF3Ec5C537A20bA`
(`UsdcVault`, Sourcify exact
match, verified 2025-04-29),
and USER_ACTIONS_PSM_VARIANT1
`0xd0A61F2963622e992e6534bde4D52fd0a89F39E0`
(`PSMVariant1Actions`,
verified 2024-09-11). Same
impl is listed on Arb / Base
/ OP / Unichain. Extract
under `/tmp/spark/{usdc-vault,
psm-actions}`. No mainnet
interaction.

Files: `src/UsdcVault.sol`,
`src/PSMVariant1Actions.sol`.

Checked for: first-depositor
share inflation via donated
sUSDS; withdraw that burns a
stranger without allowance;
`exit` that transfers more
sUSDS than shares; PSM helper
that deposits a delta to the
caller after a stranger’s
pull.

Result: no user-exploitable
finding. Not submitted.

- Vault shares are minted 1:1
  with sUSDS received from
  `susds.deposit` / `mint`,
  not from a
  `totalAssets`/`totalSupply`
  ratio. Donated USDC or
  sUSDS does not mint shares.
  `exit` transfers exactly
  `shares` of sUSDS after
  `_burn`.
- `deposit` / `mint` pull
  USDC from `msg.sender`,
  `sellGem` through the
  immutable PSM wrapper, and
  credit `receiver`. PSM
  `tin >= WAD` halt-closes
  sells.
- `withdraw` / `redeem` pull
  sUSDS, `_burn` the owner
  (allowance if not sender),
  then `buyGem` to
  `receiver`. `tout ==
  type(uint256).max`
  halt-closes buys. Rounding
  overestimates PSM fees and
  can leave USDS dust
  (documented).
- UUPS `_authorizeUpgrade`
  is `auth` (`wards`).
- PSMVariant1Actions
  `swapAndDeposit` measures
  the DAI delta after
  `sellGem` and deposits that
  to `receiver`.
  `withdrawAndSwap` /
  `redeemAndSwap` spend
  `msg.sender`’s 4626
  allowance. Leftover DAI
  dust is documented.

Remaining SparkLend after this
slice: ALM controllers (logged
below at `ce5cbd9`) plus
other-chain vaults / PSM3 and
Robinhood / X Layer 13 Jul
rows. Not submitted.

## 2026-09-03: Twyne Aave V3 operators (Sourcify)

Immunefi program `twyne`
($50,000, `kyc: false`). GitHub
is private from this VM. Vault /
wrapper / EVC / factory rows
are still Sourcify 404. The
three Aave V3 operators
(listed June 2026) are exact
Sourcify matches
(verified 2026-03-06):
Teleport `0x868a…bd78`,
Leverage `0x4519…4A4C`,
Deleverage `0x229f…5e91`.
Extract under
`/tmp/twyne-sourcify`. No
state-changing txs.

Files:
`src/operators/AaveV3{Leverage,
Deleverage,Teleport}Operator.sol`.

Checked for: a stranger
flashloan that borrows from
someone else’s vault; swap
`multicall` that keeps the
Morpho loan; teleport that
pulls another user’s aTokens
without being the borrower.

Result: no user-exploitable
finding. Not submitted.

- `executeLeverage` /
  `executeDeleverage` /
  `executeTeleport` require
  `isCollateralVault` and
  `borrower() == _msgSender()`.
  `onMorphoFlashLoan` is
  Morpho-only. Morpho only
  callbacks the initiator, so
  encoded args stay the
  caller’s.
- Leverage pulls the
  borrower’s underlying /
  aTokens via Permit2, supplies
  Aave, `depositATokens` to the
  vault, then EVC-batch
  `skim` + `borrow` on behalf
  of that borrower. A hostile
  `swapData` can only strand
  this tx (Morpho repay
  reverts). Leftover aTokens
  on the operator are deposited
  to the current vault
  (donation).
- Deleverage swaps the
  flashloaned underlying to
  the target, `repay`s the
  vault’s Aave debt, checks
  `<= maxDebt`, then
  `redeemUnderlying` on behalf
  of the borrower. Dust of
  target / underlying is sent
  to the borrower.
- Teleport `repay`s the
  borrower’s existing Aave
  debt, Permit2-pulls their
  aTokens, deposits the
  wrapper into their vault,
  and borrows the flashloan
  amount back. `debtAmount`
  is clamped to the user’s
  live variable-debt
  balance.

Remaining Twyne: vaults,
wrappers, EVC, factories
(still Sourcify 404). Not
submitted.

## 2026-09-03: Yearn stYFI February core (`69e262e`)

Immunefi program `yearnfinance`
($200,000, `kyc: false`). July
YBC / funding / bonus leftover
already logged. This pass is
the 15 Feb 2026 stYFI core:
StakedYFI `0x42b2…c016`,
liquid-locker depositors
(StakeDAO / 1up / Cove), and
the staking reward distributor
pattern. Official tree
[yearn/stYFI](https://github.com/yearn/stYFI)
at `69e262e`. No mainnet
interaction.

Files: `contracts/{StakedYFI,
LiquidLockerDepositor,
StakingRewardDistributor}.vy`.

Checked for: withdraw that
pays a stream that is still
locked; redeem of another
account without allowance;
reward `claim` that pays the
subject instead of the
claimer; first-depositor
inflation (1:1 vault).

Result: no user-exploitable
finding. Not submitted.

- StakedYFI is 1:1. `deposit`
  / `mint` pull from
  `msg.sender` and mint to
  `_receiver`. `unstake` burns
  the caller and starts a 14-day
  stream. `withdraw` /
  `redeem` spend allowance if
  `_owner != msg.sender` and
  only transfer the streamed
  (or hook-instant) amount.
  `sweep` cannot take
  `asset`.
- LiquidLockerDepositor is
  `1:scale`. Transfers of
  shares are not implemented
  (only `approve`). `unstake`
  is `msg.sender`. `_redeem`
  enforces the same stream
  math and allowance.
- StakingRewardDistributor
  `claim(_account)` requires
  `claimers[msg.sender]` and
  pays `msg.sender` (the
  already-logged RewardClaimer
  pattern).

Remaining Yearn stYFI Feb:
stYFIx / middleware / main
RewardDistributor (this pass
below). Not submitted.

## 2026-09-03: Yearn stYFI leftover stYFIx / middleware / main distributor (Sourcify)

Same Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). February rows
not in the prior StakedYFI /
LL / StakingRewardDistributor
pass: stYFIx
`0x9C42…9d79`
(`DelegatedStakedYFI`,
Sourcify match, verified
2026-02-07), Staking
Middleware
`0xc32b…4C020`
(verified 2026-02-18),
Reward Claimer
`0xA824…5e50`
(verified 2026-02-22), and
stYFI Main Reward Distributor
`0xd319…5934`
(`RewardDistributor`,
verified 2026-02-18). Extract
under `/tmp/yearn/{styfix,
styfi_mw,styfi_claimer,
styfi_maindist}`. Official
tree still `69e262e`. No
mainnet interaction.

Files:
`contracts/{DelegatedStakedYFI,
StakingMiddleware,RewardClaimer,
RewardDistributor}.vy`.

Checked for: stYFIx withdraw
that pulls stYFI without the
instant-whitelist assumption
failing closed; middleware
that lets a stranger set
`instant_withdrawal`; main
distributor `claim` by a
non-component; RewardClaimer
that claims a stranger’s
components into the caller.

Result: no user-exploitable
finding. Not submitted.

- DelegatedStakedYFI is 1:1
  over YFI and deposits into
  StakedYFI. `unstake` burns
  the caller and
  `staking.withdraw`s to
  itself (needs the stYFI
  instant-withdrawal
  whitelist). User assets
  then stream 14 days.
  `sweep` cannot take `asset`
  or `staking`.
- StakingMiddleware hooks
  require `msg.sender ==
  upstream`. Instant
  whitelist and transfer
  blacklist are management.
- RewardClaimer `claim`
  calls each component
  `claim(msg.sender)` and
  forwards tokens to
  `_recipient`.
- RewardDistributor `claim`
  is `nonreentrant` and only
  pays `msg.sender` when that
  address is a packed
  component whose synced
  epoch is behind current.

Remaining Yearn stYFI Feb:
veYFI / stYFIx / LL reward
distributors and Vault V3.1.0
(23 Jun) if wanted. Not
submitted.

## 2026-09-03: Balancer V3 Router (Sourcify)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun 2026 add: V3 Router
(V2) `0xAE56…8Ea2`. Sourcify
v2 exact match, verified
2025-04-29. Contract name
`Router`. Extract under
`/tmp/balancer/router`. No
mainnet interaction.

Files: `contracts/{Router,
RouterCommon,SenderGuard,
VaultGuard}.sol`.

Checked for: a hook that
pulls Permit2 from a
stranger; remove-liquidity
that sends tokens to the
caller instead of
`params.sender`; swap that
skips `onlyVault`; query
path that mutates balances.

Result: no user-exploitable
finding. Not submitted.

- External API functions
  `saveSender(msg.sender)`
  then `_vault.unlock` into
  the matching hook.
  Hooks are `onlyVault` +
  `nonReentrant`.
- `addLiquidityHook` /
  `initializeHook` pull
  `params.sender` via
  Permit2 (or wrap `msg.value`
  when `wethIsEth`) and
  `settle` the Vault. BPT is
  minted `to: params.sender`.
- `removeLiquidityHook`
  burns BPT `from:
  params.sender` and
  `_vault.sendTo` /
  unwraps WETH to that
  sender. Recovery hook is
  the same.
- `swapSingleTokenHook`
  takes `tokenIn` from
  `params.sender` and sends
  `tokenOut` to them.
  Deadline is
  `block.timestamp`.
- Queries are separate
  `query*` entrypoints; they
  do not settle.

Remaining Balancer 23 Jun
rows: ProtocolFeeController
and the V3 factory / oracle
factory set (CompositeLiquidityRouter
logged below). Not submitted.

## 2026-09-03: Yearn stYFI leftover LL redemption / LL+veYFI distributors (`69e262e`)

Same Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). Official tree
[yearn/stYFI](https://github.com/yearn/stYFI)
at `69e262e`. February rows
not in the StakedYFI /
depositor / stYFIx /
StakingMiddleware pass:
LiquidLockerMiddleware,
LiquidLockerRedemption
(in-tree; no separate
Immunefi row),
LiquidLockerRewardDistributor
`0x7eFc…A000`, and
VotingEscrowRewardDistributor
(veYFI) `0x2548…e884`. No
mainnet interaction.

Files: `contracts/{
LiquidLockerMiddleware,
LiquidLockerRedemption,
LiquidLockerRewardDistributor,
VotingEscrowRewardDistributor}.vy`.

Checked for: a stranger
hook that credits another
account’s LL weight;
`redeem` that pays more YFI
than the scale allows;
`exchange` that underflows
`used` into extra LL;
reward `claim` that pays the
subject instead of the
claimer.

Result: no user-exploitable
finding. Not submitted.

- LiquidLockerMiddleware
  forwards `on_stake` /
  `on_unstake` to downstream
  + aggregator. Both require
  `msg.sender == upstream`.
- `redeem` is enabled +
  `epoch < lock`. It increments
  `used` by `_ll_amount //
  scale` (must be > 0 and
  `<= capacity`), pulls LL
  tokens from the caller, and
  pays YFI minus a decaying
  fee (`MAX_FEE` 10% over
  104 epochs). Dust below
  `scale` stays with the LL
  recipient. Fee YFI remains
  in the contract;
  `sweep` is management.
- `exchange` decrements
  `used` (Vyper underflow
  reverts), pulls YFI, and
  pays `yfi * scale` LL
  tokens from inventory.
- LiquidLockerRewardDistributor
  and VotingEscrowRewardDistributor
  `claim(_account)` require
  `claimers[msg.sender]` and
  pay `msg.sender`.
  Permissionless `reclaim`
  only moves expired rewards
  (bounty + `reclaim_recipient`).

Remaining Yearn: Vault V3.1.0
(23 Jun) if wanted. Not
submitted.

## 2026-09-03: TermMax TMX token (Sourcify BSC)

Same Immunefi program
`termstructurelabs` ($80,000,
`kyc: false`). 24 Aug 2026
rows: TMX Ethereum and BNB
`0x3c2F…0039`. Ethereum
Sourcify 404. BSC Sourcify
exact match, flattened
`MyOFT.sol` (Hardhat 2.28).
Extract under
`/tmp/tmx-sourcify/bsc`. V2
market / vault / router
already logged. No
state-changing txs.

Files: `contracts/MyOFT.sol`
(LayerZero OFT v3 flatten).

Checked for: a public mint
after deploy; `_credit` to
an attacker; constructor
mint on BSC.

Result: no user-exploitable
finding. Not submitted.

- `MyOFT` is stock
  LayerZero `OFT`. `_debit`
  burns `amountSentLD`;
  `_credit` mints to `_to`
  (`address(0)` remaps to
  `0xdead`).
- Constructor
  `Ownable(_delegate)`. It
  mints `1e9 ether` only
  when `block.chainid == 1`.
  The BSC bytecode therefore
  does not premint.
- No extra mint / burn
  entrypoints beyond OFT
  send/receive.

Remaining TermMax adapters
(Kyber, OKX, Pancake, Kodiak,
vault helpers) are still
lower-priority copies of the
already-logged
approve-and-call pattern.
Not submitted.

## 2026-09-03: Balancer V3 CompositeLiquidityRouter (Sourcify)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun 2026 row
CompositeLiquidityRouter (V2)
`0xb21A…5c8A`. Sourcify exact
match. Extract under
`/tmp/balancer-clr`. The V3
Router row is already logged.
No mainnet interaction.

Files:
`contracts/CompositeLiquidityRouter.sol`
(hooks + wrap helpers).

Checked for: a hook that
mints BPT to the router; wrap
that pulls a stranger;
unwrap that sends tokens to
`msg.sender` instead of
`params.sender`.

Result: no user-exploitable
finding. Not submitted.

- External add/remove
  functions `saveSender
  (msg.sender)` and
  `_vault.unlock` into
  `onlyVault` hooks.
  `params.sender` is that
  caller.
- Unbalanced / proportional
  add send BPT `to:
  params.sender`. Tokens are
  `_takeTokenIn` from that
  sender (Permit2 / ETH
  wrap).
- Proportional remove burns
  BPT `from: params.sender`
  and `_sendTokenOut` to
  them after optional buffer
  unwrap. `minAmountsOut` is
  checked per token.
- Buffer wrap/unwrap is the
  Vault’s
  `erc4626BufferWrapOrUnwrap`.
  Uninitialized buffers
  revert. Query paths are
  static-call only.

Remaining Balancer 23 Jun
rows: ProtocolFeeController
(this pass below) and the V3
factory / oracle factory set.
Not submitted.

## 2026-09-03: Balancer ProtocolFeeController (Sourcify)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun 2026 leftover after
Router + CompositeLiquidityRouter:
ProtocolFeeController (V2)
`0x212F…C2879`. Sourcify
exact match, verified
2025-05-21. Extract under
`/tmp/balancer/pfc`. No
mainnet interaction.

Files:
`contracts/{ProtocolFeeController,
VaultGuard}.sol`.

Checked for: fee `collect` /
`withdraw` that pays a
non-creator; split math that
credits the caller; `migratePool`
that overwrites live fee
balances.

Result: no user-exploitable
finding. Not submitted.

- `collectAggregateFees` is
  permissionless and only
  pulls the Vault’s aggregate
  cut into this contract
  (`onlyVault` hook).
- Protocol withdraw is
  `authenticate`. Creator
  withdraw with a recipient
  is `onlyPoolCreator`; the
  public overload pays
  `_getPoolCreator(pool)`.
- Split math reconstructs
  the pre-aggregate notional
  then assigns protocol
  first; underflow on a
  rounding inversion
  fail-closes.
- `migratePool` copies
  percentages from the
  current Vault controller
  and cannot run when this
  contract is already the
  controller. Fee balances
  are not copied.

Remaining Balancer 23 Jun
rows: V3 factory / oracle
factory set
(FixedPriceLBPoolFactory,
Gyro2CLPPoolFactory,
StableLPOracleFactory,
LBPoolFactory this pass
below, Stable / Weighted /
ReClamm / StableSurge
factories, EclpLPOracleFactory,
GyroECLPPoolFactory). Not
submitted.

## 2026-09-03: Spark ALM controller (`ce5cbd9`)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Listed GitHub rows
[marsfoundation/spark-alm-controller](https://github.com/marsfoundation/spark-alm-controller)
`MainnetController.sol`,
`ForeignController.sol`,
`ALMProxy.sol`,
`RateLimitHelpers.sol`, plus
live `ALM_CONTROLLER` /
`ALM_PROXY` /
`ALM_RATE_LIMITS` on
Ethereum / Base / OP / Arb /
Avalanche / Unichain /
Robinhood / X Layer. Local
clone `/tmp/spark-alm` at
`ce5cbd9`. No mainnet
interaction.

Files:
`src/{MainnetController,ForeignController,ALMProxy,ALMProxyFreezable,RateLimits,RateLimitHelpers,OTCBuffer,WEETHModule}.sol`,
`src/libraries/{CCTPLib,ERC4626Lib,LayerZeroLib,PSMLib,AaveLib,ApproveLib}.sol`.

Checked for: a relayer
`transferAsset` to an
unlisted destination; CCTP
`mintRecipient` taken from
the caller; 4626 deposit that
mints to the relayer; LayerZero
`to` override; OTC claim that
unlocks a later send without
returning value; `take` that
pulls a user Spark vault;
farm `stake` to an arbitrary
farm without a rate-limit
key.

Result: no user-exploitable
finding. Not submitted.

- `ALMProxy.doCall` /
  `doCallWithValue` /
  `doDelegateCall` are
  `CONTROLLER` only.
  `RateLimits` decrease /
  increase is `CONTROLLER`
  only. Unset keys revert
  (`zero-maxAmount`).
- `transferAsset` burns
  `LIMIT_ASSET_TRANSFER(asset,
  destination)` before the
  proxy `transfer`. Same
  pattern on
  `ForeignController`.
- CCTP uses
  `mintRecipients[domain]`
  (admin-set). Zero recipient
  reverts. Dual global +
  domain rate limits.
- 4626 deposit mints shares
  to the proxy, requires
  `minSharesOut` and
  `assets/shares <=
  maxExchangeRates[token]`.
  Unset max rate is 0, so
  a deposit of assets > 0
  reverts. Withdraw/redeem
  restore the deposit key
  using assets received.
- LayerZero `to` is
  `layerZeroRecipients[eid]`.
  Comment on the wrapper:
  keep the rate-limit key
  at zero until OFTs are
  integration-tested.
  `minAmountLD` is filled
  from `quoteOFT`.
- OTC first send is allowed
  because storage `sent18`
  is still 0 at the ready
  check. Later sends need
  `claimed + recharge >=
  sent * maxSlippage`.
  Assets and the exchange
  buffer are admin
  whitelists. Compromised
  relayer + junk whitelist
  is their documented OTC
  trust assumption.
- Farm / Maple / Superstate
  / Spark-vault `take` /
  wstETH / weETH / Ethena
  prepare-approve are
  rate-limited (or
  destination-keyed).
  `setDelegatedSigner` is
  relayer-callable;
  SECURITY.md accepts
  Ethena’s off-chain
  checks. Dai↔USDS is 1:1
  inside the proxy (no
  rate limit; accepted
  parity assumption).
- `FREEZER` can
  `removeRelayer`. Threat
  model treats the relayer
  as compromisable and
  bounds loss by rate
  limits. Users do not
  call these entrypoints.

Remaining SparkLend after this
slice: SparkVault V2 (logged
below) plus PSM3 / treasury
controllers and the 13 Jul
Robinhood / X Layer rows. Not
submitted.

## 2026-09-03: SparkVault V2 (`51c6d7a`)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Listed GitHub row
[sparkdotfi/spark-vaults-v2](https://github.com/sparkdotfi/spark-vaults-v2)
`src/SparkVault.sol`
(“Spark Savings V2”). Local
clone `/tmp/spark-vaults-v2`
at `51c6d7a`. No mainnet
interaction.

Files: `src/SparkVault.sol`
(sUSDS-style pot).

Checked for: first-depositor
inflation via a dust mint
plus a raw asset donation;
`take` by a non-taker;
redeem that pays
`msg.sender` instead of
`receiver`; chi/VSR overflow
that mints extra shares;
taker depositing then
redeeming other users’
liquidity.

Result: no user-exploitable
finding. Not submitted.

- PPS is `chi`, not
  `balance / supply`. A raw
  donation does not change
  `convertToShares`. Initial
  `chi == RAY` so the first
  deposit is 1:1.
- `take` is `TAKER_ROLE`
  only and just
  `_pushAsset`s. Liquidity
  can go below
  `totalAssets()`
  (`assetsOutstanding`).
  That is the ALM model
  already reviewed above;
  `maxRedeem` /
  `maxWithdraw` are capped
  by the token balance.
- Deposit/mint pull
  `msg.sender` and mint to
  `receiver` (not 0 / self).
  Taker cannot be sender
  or receiver. Redeem /
  withdraw burn `owner`
  (allowance if sender ≠
  owner) and pay
  `receiver`.
- `drip` is the Maker pot
  `_rpow`. VSR is bounded
  to `[RAY, MAX_VSR]`
  (100% APY). UUPS
  `initialize` is
  initializer-gated; impl
  constructor disables
  initializers. Upgrade is
  admin-only.

Remaining SparkLend after this
slice: PSM3 (logged later
this pass) plus treasury
controllers and the 13 Jul
Robinhood / X Layer rows. Not
submitted.

## 2026-09-03: Yearn Vault V3.1.0 (Sourcify)

Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). 23 Jun 2026
rows: Vault V3.1.0
`0xdD3F…7824` (Sourcify
match, Vyper
`YearnV3Vault`, verified
2026-06-19), Tokenized
Strategy V3.1.0
`0x310f…1e76` (exact
match, `TokenizedStrategy`),
Vault V3.1.0 Factory
`0x310a…bcAC` (match,
`YearnVaultFactory`).
Extracts under
`/tmp/yearn/{vault310,strat310,vfact310}`.
No mainnet interaction.

Files:
`YearnV3Vault.vy`,
`src/TokenizedStrategy.sol`,
`YearnVaultFactory.vy`.

Checked for: first-depositor
inflation via a 1-wei
deposit plus a raw asset
donation; redeem that pays
`msg.sender` instead of
`receiver` / burns a
stranger; `process_report`
that mints unlocked profit;
factory fee unpack that
points fees at the caller;
strategy `MINIMUM_SUPPLY`
bypass that lets a dust
depositor steal a later
deposit.

Result: no user-exploitable
finding. Not submitted.

- Vault `total_assets` is
  `total_idle + total_debt`,
  not the ERC20 balance.
  A raw donation does not
  change PPS until
  `process_report(self)`
  (role-gated) accrues it
  into idle. Empty supply
  mints 1:1; `total_supply
  > 0` and `total_assets
  == 0` mints 0 shares
  (`cannot mint zero`).
- Deposit pulls
  `msg.sender` and mints
  to `recipient` (cannot
  be `address(0)` or
  `self`). Redeem burns
  `owner` (allowance if
  sender ≠ owner) and
  pays `receiver`. Losses
  from the withdraw queue
  are capped by `max_loss`.
- Profit is locked as
  shares minted to the
  vault and unlocked over
  `profit_max_unlock_time`.
  Fees go to the accountant
  and the factory
  `protocol_fee_config`
  recipient.
- Factory `deploy_new_vault`
  is create2 + `initialize`.
  Protocol fee bps ≤ 5000.
  Custom vault fees still
  pay the default
  recipient. Governance
  is two-step.
- TokenizedStrategy 3.1.0
  simulates constant
  accrual for
  `convertTo*` /
  `totalAssets`.
  `MINIMUM_SUPPLY` (1e3)
  confiscates profit into
  supply while under the
  floor. Deposit transfers
  first, then
  `deployFunds`, then
  mints. Withdraw
  `freeFunds` then pays
  `receiver`. `report` /
  `tend` are keeper-only.

Remaining Yearn listed
Solidity after this slice:
none of the 23 Jun V3.1.0
trio. Older 3.0.4 vault /
factory rows were already
in the table and were not
re-read here. Not
submitted.

## 2026-09-03: Balancer V3 LBPoolFactory (Sourcify)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun 2026 leftover factory
row: V3 LBPoolFactory (V4)
`0x6642…069A`. Sourcify
exact match, verified
2026-05-16. Extract under
`/tmp/balancer/lb_factory`.
WeightedPoolFactory
`0x3326…1D99` and
StablePoolFactory
`0x4eFc…3228` are Sourcify
404 on Ethereum / Base /
Arbitrum / Optimism /
Polygon from this VM. No
mainnet interaction.

Files: `contracts/lbp/{LBPoolFactory,
BaseLBPFactory,LBPValidation,
LBPool,LBPCommon}.sol`,
`@balancer-labs/v3-pool-utils/contracts/BasePoolFactory.sol`.

Checked for: `create` that
registers attacker bytecode
as a Balancer pool; hook
set to a stranger; add
liquidity by a non-owner
through an untrusted router;
remove during the sale.

Result: no user-exploitable
finding. Not submitted.

- `create` deploys the
  factory’s `LBPool`
  creationCode via create2
  (salt binds `msg.sender` +
  chainid) and registers
  that pool as its own hook.
  Tokens are the two LBP
  tokens, STANDARD, sorted.
  Unbalanced liquidity is
  disabled.
- `onRegister` requires
  `pool == address(this)`
  and two STANDARD tokens.
- `onBeforeAddLiquidity`
  requires the trusted
  router and
  `getSender() == owner()`,
  and `onlyBeforeSale`.
- `onBeforeInitialize` is
  owner-via-`getSender` and
  `onlyBeforeSale`. Seedless
  LBPs reject a non-zero
  reserve amount. Init
  frontrun is the documented
  factory DoS, not a steal.
- `onBeforeRemoveLiquidity`
  reverts while the sale is
  live.

Remaining Balancer 23 Jun
factories: ReClamm + LP
oracle factories this pass
below; FixedPrice LBP,
Gyro2CLP, GyroECLP,
StableSurge, plus Weighted /
Stable (Sourcify 404). Not
submitted.

## 2026-09-03: Balancer ReClamm factory + LP oracle factories (Sourcify)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun leftover:
ReClammPoolFactory (V3)
`0x3ccD…ab7FF` (exact match,
verified 2026-05-14),
StableLPOracleFactory (V2)
`0x765c…A93c` (2026-02-27),
WeightedLPOracleFactory (V2)
`0x4b4b…85C6` (2026-04-04),
EclpLPOracleFactory
`0x301E…54B` (2026-04-04).
Extract under
`/tmp/balancer/{reclamm,
stable_oracle,weighted_oracle,
eclp_oracle}`. FixedPrice LBP
/ Gyro2CLP / GyroECLP /
StableSurge factories are
still Sourcify 404. No
mainnet interaction.

Files:
`contracts/{ReClammPoolFactory,
lib/ReClammPoolFactoryLib,
ReClammPool}.sol`,
`contracts/{LPOracleFactoryBase,
LPOracleBase,StableLPOracle,
WeightedLPOracle,EclpLPOracle,
*Factory}.sol`.

Checked for: factory `create`
that registers attacker
bytecode; ReClamm hook used
by a stranger pool; 1-token
ReClamm that skips Vault
min-token checks; factory
oracle that overwrites a
canonical feed set; TVL that
credits a transient balance
when the vault is locked.

Result: no user-exploitable
finding. Not submitted.

- ReClamm `create` deploys
  the factory’s `ReClammPool`
  creationCode (helper vault
  must match) and registers
  that pool as its own hook.
  Donation is off; unbalanced
  liquidity is disabled.
  `onRegister` requires
  `pool == address(this)`,
  two tokens, and those
  liquidity flags. Factory
  `tokens.length <= 2`
  without an explicit min
  still fail-closes at
  `onRegister`.
- Init / add / remove hooks
  are `onlyVault` and scale
  virtual balances with
  supply. Price-range params
  are bounded in
  `ReClammPoolFactoryLib`.
- Oracle factories deploy a
  new oracle per
  `(pool, flags, feeds)` id.
  A junk feed list cannot
  replace an existing id.
  `latestRoundData` is TVL /
  BPT supply; sequencer
  uptime is checked when a
  feed is configured.
  `shouldRevertIfVaultUnlocked`
  is an integrator flag.
  Feeds are caller-chosen;
  `isOracleFromFactory` is
  not a price-feed whitelist.

Remaining Balancer 23 Jun
factories: FixedPrice LBP,
Gyro2CLP, GyroECLP,
StableSurge, Weighted /
Stable (Sourcify 404). Not
submitted.

## 2026-09-03: Balancer leftover Sourcify-404 factories (official monorepo)

Immunefi program `balancer`
($1,000,000, `kyc: false`).
23 Jun 2026 rows still open
after PFC / Router / CLR /
LBPool / ReClamm / LP
oracles: FixedPriceLBPoolFactory
`0xeb1a…8758`, Gyro2CLP
`0x8902…ECC6`, GyroECLP
`0x04d5…69d1`, StableSurge
`0x187a…A6Ac`, V3 Stable
`0x4eFc…3228`, V3 Weighted
`0x3326…1D99`. Sourcify v2
and `repo.sourcify.dev`
full/partial match are 404
from this VM. `create()`
bodies were read from
official
`balancer/balancer-v3-monorepo`
`main` raw files (3 Sep;
same `BasePoolFactory`
pattern as the Sourcify-exact
LBPool / ReClamm factories).
No state-changing txs.

Files (GitHub `main`, not
bytecode-matched):
`FixedPriceLBPoolFactory.sol`,
`Gyro2CLPPoolFactory.sol`,
`GyroECLPPoolFactory.sol`,
`StablePoolFactory.sol`,
`WeightedPoolFactory.sol`,
`StableSurgePoolFactory.sol`,
`BasePoolFactory.sol`.

Checked for: a create that
registers a pool the factory
did not deploy; CREATE2 salt
that omits the sender so a
stranger can collide; a
hook/role account the
caller cannot set; StableSurge
registering a stranger hook.

Result: no user-exploitable
finding. Not submitted.
Bytecode match is unverified
here; do not file against
these addresses until
Sourcify/Etherscan confirms
the same `create()`.

- Every factory `_create`s
  (CREATE2 salt
  `keccak(msg.sender, chainid, salt)`)
  then `registerPool`s in
  the same transaction.
  `disable()` is
  `authenticate`.
- Gyro factories revert
  unless `tokens.length == 2`.
  Stable / StableSurge cap
  at `StableMath.MAX_STABLE_TOKENS`.
  Weighted computes
  `minTokenBalances` via
  `MinTokenBalanceLib`.
- FixedPrice LBP requires
  `projectTokenRate != 0`
  and
  `blockProjectTokenSwapsIn`
  (buy-only), then uses
  the same `_registerLBP`
  path (pool is the hook;
  `poolCreator` is a create
  argument).
- StableSurge hardcodes
  the factory’s
  `StableSurgeHook`. Other
  factories take
  `poolHooksContract` /
  `roleAccounts` as
  documented create args.
  `protocolFeeExempt` is
  always false.

23 Jun Balancer leftover
is exhausted. Older Jan
2025 BatchRouter /
BufferRouter rows are
unchanged. Not submitted.

## 2026-09-03: Spark PSM3 (`2b1a72a`)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Listed GitHub row
[marsfoundation/spark-psm](https://github.com/marsfoundation/spark-psm)
`src/PSM3.sol`, plus live
PSM3 on Base
`0x1601…47E`, Optimism
`0xe0F9…7F62`, Arbitrum
`0x2B05…7266`, Unichain
`0x7b42…312f`. Local clone
`/tmp/spark-psm` at
`2b1a72a`. Live
`totalShares()` was read
via `eth_call` only (Base
~3.41e24, OP ~1.57e24, Arb
~4.63e25). No state-changing
txs.

Files: `src/PSM3.sol`,
`deploy/PSM3Deploy.sol`,
`test/unit/{InflationAttack,DoSAttack}.t.sol`.

Checked for: first-depositor
inflation via a 1-wei share
plus a USDC donation;
deposit that mints 0 shares
after a pre-seed donation
(`totalShares == 0` and
`totalAssets > 0`); swap
that pays a stranger;
withdraw that burns another
user’s shares; pocket drain
by a non-owner.

Result: no submittable
finding. Not submitted.

- README marks both attacks
  **CRITICAL** and requires
  a deploy-time seed of at
  least 1e18 shares.
  `PSM3Deploy` deposits
  1e6 USDC (1e18 value) to
  `address(0)` so those
  shares cannot withdraw.
  In-repo tests show the
  unseeded 1-wei + 10m
  donation path and the
  pre-seed 0-share DoS.
- Live listed PSM3s already
  have ≫ 1e18 shares. The
  documented seed
  mitigation is in place.
  Do not file a test-suite
  attack against a seeded
  pool.
- Swaps are 1:1 USDC↔USDS
  or sUSDS via the
  immutable rate provider.
  `minAmountOut` /
  `maxAmountIn` bind the
  caller. Receiver cannot
  be 0.
- Deposit mints to
  `receiver` then pulls
  `msg.sender`. Withdraw
  burns `msg.sender` then
  pushes to `receiver`.
  USDC custody is `pocket`
  (Base live pocket is the
  PSM itself). `setPocket`
  is owner-only and moves
  the full USDC balance.

Remaining SparkLend:
treasury / cap automator /
ratio oracles (this pass
below) and the 13 Jul
Robinhood / X Layer rows.
Not submitted.

## 2026-09-03: Spark CapAutomator + ratio oracles + CollectorController (Sourcify)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
5 Mar 2026 leftover:
CapAutomator v1.1.0
`0x4C13…F2eE` (exact match,
verified 2026-03-09),
cbBTC/weETH/rETH ratio
oracles (`0x64B1…cCBC`,
`0x4C80…b7E4`,
`0xd0B3…8d06`), plus
Ethereum TREASURY_CONTROLLER
`0x92eF…8F7a` (CollectorController,
verified 2025-06-23). Treasury
proxy rows are
`InitializableAdminUpgradeabilityProxy`
only. Extract under
`/tmp/spark-leftover/{cap_auto,
cbbtc_oracle,weeth_oracle,
reth_oracle,treasury_ctrl}`.
No mainnet interaction.

Files: `src/CapAutomator.sol`,
`src/{CBBTC,WEETH,RETH}RatioOracle.sol`,
`CollectorController.sol`.

Checked for: a public `exec`
that raises caps past `max`;
same-block cap pump; ratio
oracle that returns 1e18 on
a dead feed; controller
`transfer` by a non-owner.

Result: no user-exploitable
finding. Not submitted.

- Cap config is
  `DEFAULT_ADMIN_ROLE`.
  `exec` / `execSupply` /
  `execBorrow` are
  `UPDATE_ROLE`. New cap is
  `min(usage + gap, max)`.
  Increases respect
  `increaseCooldown`;
  decreases do not. A second
  update in the same block
  returns the current cap.
- Ratio oracles return 0
  when a feed is
  non-positive (or the LST
  rate is 0). Kill-switch
  consumers treat that as a
  halt, not a peg. Feeds
  are immutable.
- CollectorController
  `approve` / `transfer`
  are `onlyOwner` and
  forward to the collector
  proxy.

Remaining SparkLend: the
13 Jul Robinhood / X Layer
executor / receiver rows
(ALM + Vault V2 on those
chains already logged).
Not submitted.

## 2026-09-03: Yearn leftover yYB token / operator / locker / staker / distributor (Sourcify)

Same Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). 5 Jan 2026
rows: yYB Token
`0x2222…9D6` (exact
`YToken`), Operator
`0x1111…4af9` (exact),
Locker `0x0000…6A` (exact),
Boosted Staker
`0x5D2e…AD91` (`match`,
`YearnBoostedStaker`),
Reward Distributor
`0x1d02…746` (`match`,
`SingleTokenRewardDistributor`).
Extract under
`/tmp/yearn-yyb`. Vault
V3.1.0 + stYFI leftovers
already logged. No
state-changing txs.

Files: `src/{YToken,
Operator,Locker}.sol`,
`YearnBoostedStaker.sol`,
`SingleTokenRewardDistributor.sol`.

Checked for: a stranger
`YToken.mint` that skips
the underlying transfer;
`Locker.execute` that
anyone can call;
`nftTransferCallback`
that mints without a lock
increase; distributor
`claimFor` that pays the
claimer; staker
`stakeAsMaxWeighted` that
is permissionless.

Result: no user-exploitable
finding. Not submitted.

- `YToken.mint` pulls
  `token` to the locker and
  `Operator.lock` unless
  `msg.sender` is the
  locker operator (NFT
  wrap path). `sweep` /
  `setLocker` are owner or
  operator.
- `Locker.execute` /
  `safeExecute` are owner
  or operator. Escrow
  `increase_amount` is
  blocked unless the
  operator calls.
  `onERC721Received`
  requires the escrow NFT
  and forwards to
  `nftTransferCallback`.
- Operator
  `nftTransferCallback`
  is locker-only and mints
  the lock-amount delta.
  `lock` is `onlyLockers`
  (yToken is authorized at
  construct). Gauge / DAO
  votes are role-gated.
- Staker `stake` /
  `unstake` use even
  amounts and checkpoints.
  `stakeAsMaxWeighted` is
  `approvedWeightedStaker`.
  `stakeFor` / `unstakeFor`
  need `approvedCaller`.
- Distributor
  `claim` / `claimWithRange`
  pay the account (or its
  configured recipient).
  `claimFor` needs
  `approvedClaimer`.
  Skipping weeks in a
  ranged claim is a
  documented self-lockout.
  `pushRewards` only moves
  a past week with zero
  adjusted global weight.

Yearn 23 Jun + Jan 2026
yYB leftovers are
exhausted. Auction /
splitter / 3.0.4 factory
rows (this pass below).
Not submitted.

## 2026-09-03: Yearn AuctionFactory leftover (Sourcify)

Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). 29 Oct 2025
row: Auction Factory
`0xbC58…7526`. Sourcify
exact match, verified
2025-11-26, `AuctionFactory`
v1.0.3. Extract under
`/tmp/yearn-leftover/auction_fact`.
Splitter Factory
`0xe28f…614D` is a flattened
Vyper match; 3.0.4 Vault
Factory `0x770D…812F` is
`YearnVaultFactory.vy`
(same pattern as the
already-logged 3.1.0
factory). No mainnet
interaction.

Files:
`src/Auctions/{AuctionFactory,
Auction}.sol`.

Checked for: factory
`create` that initializes
to an attacker receiver;
`take` that sends `from`
without pulling `want`;
CoW `isValidSignature`
that accepts a stranger
receiver; `kick` that
restarts a live auction.

Result: no user-exploitable
finding. Not submitted.

- Factory clones the
  immutable `Auction`
  original via create2 and
  `initialize`s want /
  receiver / governance /
  starting price.
- `take` is
  `nonReentrant`. It
  transfers `_from` to the
  taker, optional callback,
  then
  `safeTransferFrom`
  `want` from `msg.sender`
  to `receiver`. A failed
  pay reverts the take.
- CoW signature requires
  `receiver == receiver`,
  `buyToken == want`,
  `buyAmount >= needed`,
  `feeAmount == 0`.
- `kick` needs an enabled
  auction past
  `AUCTION_LENGTH` and a
  non-zero balance.
  `enable` / `disable` /
  `sweep` / `forceKick`
  are governance.

Remaining Yearn: splitter
factory flatten and 3.0.4
vault factory (this pass
below). Not submitted.

## 2026-09-03: Yearn splitter factory + 3.0.4 Vault Factory leftover (Sourcify)

Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). 29 Oct 2025
rows: Splitter Factory
`0xe28f…614D` and Vault
Factory 3.0.4
`0x770D…812F`. Factory
Sourcify exact match
(verified 2025-01-14,
Vyper 0.3.7 flatten).
ORIGINAL splitter
`0x8e8e…6f69` Sourcify
exact match (verified
2026-02-01). 3.0.4 factory
is `YearnVaultFactory.vy`
API `3.0.4`, same pattern
as the already-logged
3.1.0 factory. Extract
under
`/tmp/yearn-leftover/{splitter_fact,splitter_impl,vault304_fact}`.
No mainnet interaction.

Files:
`Vyper_contract.vy`
(factory + impl),
`YearnVaultFactory.vy`.

Checked for: factory
`newSplitter` that leaves
the clone uninitialized
or points `ORIGINAL` at
an attacker impl;
`initialize` that can be
replayed; `unwrapVault`
that redeems to a
stranger; `distribute*`
that pays an attacker
cut; `fundAuction` that
anyone can drain; `set*`
that a non-manager /
non-splitee can flip;
3.0.4 `deploy_new_vault`
that skips initialize or
lets a stranger take
protocol fees.

Result: no user-exploitable
finding. Not submitted.

- Factory
  `create_minimal_proxy_to`
  the immutable
  `ORIGINAL`
  (`0x8e8e…6f69`) and
  `initialize`s in the
  same tx. Permissionless
  deploy is intended.
- Impl `initialize` is
  one-shot
  (`manager == 0`).
  Manager, recipient, and
  splitee must be
  non-zero; split must be
  non-zero. Default
  `maxLoss` is 1.
- `unwrapVault(s)` are
  manager or splitee.
  Redeem sends assets to
  `self` with stored
  `maxLoss`.
- `distribute*` are
  manager or splitee.
  Manager cut is
  `balance * split /
  10_000`; remainder to
  splitee. `split ==
  10_000` pays the
  manager recipient only.
- `fundAuction(s)`
  are manager or splitee
  and transfer to the
  stored `auction`.
  `auction` starts unset;
  sending to `0` is a
  trusted-role burn.
- `setMangerRecipient` /
  `setSplit` /
  `setMaxLoss` /
  `setAuction` are
  manager-only.
  `setSplitee` is
  current-splitee-only.
  `setSplit` has no
  `MAX_BPS` cap (manager
  can brick
  `distribute` with
  `unsafe_mul` /
  `unsafe_sub`); trusted
  role, not a user
  finding.
- 3.0.4 factory
  `deploy_new_vault` is
  create2
  (`msg.sender`, asset,
  name, symbol) +
  `initialize`. Protocol
  fee bps ≤ 5000.
  Custom vault fees still
  pay the default
  recipient. Governance
  is two-step.
  `shutdown_factory` is
  one-way.

Yearn 29 Oct 2025 leftover
rows (AuctionFactory +
splitter factory + 3.0.4
factory) are exhausted.
Not submitted.

## 2026-09-03: GammaSwap vault May 2026 leftover + PositionManager

Immunefi program `gammaswap`
($40,000, `kyc: false`,
Primacy of Rules, critical
only, PoC required). 10 May
2026 leftover: VaultGammaPool
`0xbd6e…311c` (live factory
protocol 3 impl),
VaultBorrow / Repay /
Rebalance / ExternalRebalance
/ Liquidation / ExternalLiq
/ BatchLiq / Short strategies,
CPMMMath, VaultBatchLiquidation
(listed; pool no-ops batch +
external liquidate), and
PositionManager proxy
`0x3b72…98b0` → impl
`0x3Cc1…fB37` (Sourcify
exact `PositionManagerExternalWithStaking`).
Sources: `@gammaswap/v1-implementations@1.2.18`
`/tmp/gammaswap-impl` `e71dd91`,
`v1-core` `/tmp/gammaswap-core`
`2312d0e`, periphery Sourcify
`/tmp/gammaswap-pm` (repo
`v1-periphery` `6774367`).
Live factory
`0xFD51…c20B` owner
`0x937f…C3Fb`.
`getLoanObserver(1..15)` all
unset (zero addr, refType 0).
Known issues list empty.
No Arbitrum state-changing
txs from this VM.

Files: `contracts/pools/VaultGammaPool.sol`,
`strategies/vault/**`,
`libraries/cpmm/CPMMMath.sol`,
`v1-core` `AbstractLoanObserverStore`
+ `LibStorage.createLoan`,
`PositionManager{,WithStaking,ExternalWithStaking}.sol`,
`base/{Transfers,GammaPoolERC721,GammaPoolQueryableLoans}.sol`.

Checked for: anyone opening a
refType-3 interest-free loan;
reserved-LP global counter
theft; reserved borrowed
invariant desync on repay;
share-price inflation from
reserved debt; no-op
liquidation freezing funds;
PositionManager callback
paying a stranger; public
`clearToken` / `unwrapWETH`
stealing user funds in
flight.

Result: no user-exploitable
finding. Not submitted.

- `createLoan(refId)` reads
  `getPoolObserverByUser`
  from the factory. refType
  3 requires an owner-set
  observer that implements
  `ICollateralManager`, an
  observed pool, and (if
  `restricted`) an allowlist.
  `createLoan(0)` is refType
  0 and accrues interest.
  Live observers 1–15 are
  empty, so nobody can open
  a refType-3 loan today.
  Do not file “anyone can
  borrow interest-free.”
- `_reserveLPTokens` is
  loan-creator + refType 3
  only. The reserved-LP
  counter is global: any
  other live refType-3
  creator can unreserve.
  That is privileged-user
  griefing, not theft, and
  it is not live.
- Reserved LP is excluded
  from `maxAssets`,
  `getAdjLPTokenBalance`,
  and utilization (98% cap).
  Reserved borrowed
  invariant is excluded from
  interest in
  `accrueBorrowedInvariant`
  and added back as
  `convertInvariantToLPRoundUp`
  in `totalReservedAssetsAndSupply`.
  `payLoanLiquidity`
  decrements reserved
  borrowed invariant on
  refType-3 repay.
- `VaultGammaPool.liquidateExternally`
  and `batchLiquidations`
  return `(0, [])`. Regular
  `liquidate` still hits
  `VaultLiquidationStrategy`.
  External / batch strategy
  contracts exist but are
  unreachable through the
  pool. Not a freeze of
  liquidatable debt.
- OOS: UniV2 issues in
  DeltaSwap unless GammaSwap
  materially changed them;
  “impacts affecting only
  the state of implementation
  contracts”; GS / timelock /
  staking capped at high;
  airdrop ineligible for
  medium. Program pays
  critical only.
- PositionManager: loans are
  owned by the PM; the NFT
  owner (or approved) gates
  borrow / repay / collateral.
  `sendTokensCallback`
  requires `msg.sender` is
  the computed GammaPool.
  `createLoan` uses PM as
  `msg.sender` for observer
  lookup. `clearToken` /
  `unwrapWETH` / `refundETH`
  sweep leftovers on the PM
  (UniV3-style dust), not
  funds sitting in a pool.
  UUPS `_authorizeUpgrade`
  is `onlyOwner`.

Remaining GammaSwap listed
Solidity: 2024 factory /
DeltaSwap / staking / GS /
timelock / airdrop rows
(staking / GS / timelock
capped at high; airdrop
medium ineligible). Spark
13 Jul Robinhood / X Layer
rows are the same ALM +
Vault V2 trees already
logged. Next leftover:
Olympus March 2026
migrator / Cooler / CCIP
(`olympus`, $3.33M, no KYC)
or Spark 15 Jul sUSDC
impls. Not submitted.

## 2026-09-03: Olympus V1Migrator + Cooler V2 + CCIP + CD Facility (`3f918a0`)

Immunefi program `olympus`
($3,333,333, `kyc: false`,
critical only: loss of
treasury / user / bond
funds). 2 Mar 2026 leftover
is V1 Migrator
`0x5131…B8B0`. 20 Feb 2026
Cooler / CD / CCIP leftover
includes MonoCooler
`0xdb59…e7cC`, Cooler v2
Migrator `0xe045…9F1c`,
CCIPCrossChainBridge
`0xFbf6…143D`, CD Facility
`0xEBDe…9678`, CD Auctioneer
`0xF351…E39a`. Official
`OlympusDAO/olympus-v3`
`3f918a0` (2026-09-01).
Sourcify v2 returned HTTP
400 on checksummed
addresses; used the public
tree. No mainnet
interaction.

Files: `src/policies/V1Migrator.sol`,
`policies/cooler/{MonoCooler,
CoolerTreasuryBorrower,
CoolerLtvOracle}.sol`,
`periphery/{CoolerV2Migrator,
bridge/CCIPCrossChainBridge}.sol`,
`policies/deposits/ConvertibleDepositFacility.sol`.

Checked for: merkle-free
OHM v2 mint; migrator
reminting after a root
change without burning v1;
Cooler V2 migrator flash
loan that credits a
stranger; MonoCooler
borrow / withdraw without
authorization; CCIP receive
from an untrusted remote;
CD `convert` minting OHM
for a non-owner.

Result: no user-exploitable
finding. Not submitted.

- `V1Migrator.migrate` is
  `onlyEnabled`, burns
  `OHMv1` from `msg.sender`,
  then `MINTR.mintOhm` after
  a double-hashed merkle
  leaf `(account, allocated)`.
  Partial claims are capped
  by `_migratedAmounts` for
  the current nonce. gOHM
  `balanceTo`/`balanceFrom`
  can dust; documented.
  `setMerkleRoot` increments
  the nonce (admin /
  `legacy_migration_admin`).
  `rescue` sweeps to that
  same role.
- `CoolerV2Migrator.consolidate`
  requires the caller owns
  each factory-created
  Cooler, lenders in CHREG,
  and DAI/USDS debt. Flash
  DAI (fee 0) repays V1,
  pulls gOHM from the owner,
  `addCollateral` /
  `borrow` on Cooler V2 for
  `newOwner` (needs
  authorization or a
  signature), converts USDS
  back, repays the flash.
  Leftover DAI/USDS refund
  to `msg.sender`.
- `MonoCooler` withdraw /
  borrow / applyDelegations
  need `isSenderAuthorized`.
  `addCollateral` can credit
  any `onBehalfOf` (donation);
  delegating for them still
  needs auth. `repay` is
  permissionless. Liquidation
  burns gOHM minus incentive
  and `writeOffDebt`. LTV
  oracle can only rise.
  `setTreasuryBorrower` is
  permissionless only while
  unset.
- CCIP send pulls OHM from
  the caller to a trusted
  remote. Receive requires
  the stored EVM remote,
  a single OHM amount, and
  transfers to the decoded
  recipient. Failed messages
  are retryable by anyone
  to that same recipient.
  `withdraw` is owner-only
  native dust.
- CD `createPosition` is
  `ROLE_AUCTIONEER`.
  `convert` is owner-only,
  withdraws the receipt into
  TRSRY, then mints OHM at
  the position’s
  `conversionPrice`.
  `claimYield` sends yield
  to TRSRY.

Remaining Olympus leftover:
DepositManager / ReceiptToken
/ RedemptionVault, Clearinghouse
v1.2, Heart / Operator /
Emission, CCIP token pool
(logged below), Governor
Bravo, BondTeller /
BondCallback, L2 MINTR /
Roles / CrossChainBridge
copies. Spark 15 Jul
Ethereum `UsdcVault` is
logged; L2 rows are
`UsdcVaultL2` (logged
below). Not submitted.

## 2026-09-03: Spark leftover gov-relay Executor + SPARK_RECEIVER (`6218d57`)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Listed GitHub row
[marsfoundation/spark-gov-relay](https://github.com/marsfoundation/spark-gov-relay)
`src/Executor.sol` plus
SPARK_EXECUTOR /
SPARK_RECEIVER clones
(including 13 Jul
Robinhood / X Layer).
Local clone
`/tmp/spark-gov-relay`
at `6218d57` (sparkdotfi
mirror). Receivers are
`marsfoundation/xchain-helpers`
`OptimismReceiver` /
`ArbitrumReceiver` /
`LZReceiver` /
`AMBReceiver` (raw
`master`, 3 Sep). ALM +
Vault V2 + PSM3 +
Collector already logged.
No state-changing txs.

Files: `src/Executor.sol`,
`deploy/Deploy.sol`,
xchain-helpers receivers.

Checked for: a stranger
`queue` / `execute` that
runs before the delay;
receiver fallback that
forwards without the
bridge check; admin role
that is left on the
deployer after
`setUpExecutorPermissions`.

Result: no user-exploitable
finding. Not submitted.

- `queue` is
  `SUBMISSION_ROLE` (the
  receiver). `execute` is
  permissionless after
  `executionTime` and only
  while `Queued`. It marks
  `executed` before the
  calls. `cancel` is
  `GUARDIAN_ROLE`. Delay /
  grace-period updates and
  `executeDelegateCall`
  are `DEFAULT_ADMIN_ROLE`.
  The constructor also
  grants admin to
  `address(this)` so a
  queued self-call can
  reconfigure.
- Optimism receiver
  requires the L2
  messenger and
  `xDomainMessageSender
  == l1Authority`.
  Arbitrum subtracts the
  standard alias.
  LZ / AMB check src
  eid / chain id and
  source authority. All
  `functionCall` the
  executor.
- Deploy grants
  `SUBMISSION_ROLE` to
  the receiver and
  revokes deployer
  `DEFAULT_ADMIN_ROLE`.

Remaining SparkLend after
this write-up was the
DSR / SSR tree; that
pass is logged below.
Robinhood / X Layer
executor / receiver rows
are the same gov-relay
contracts. Not submitted.

## 2026-09-03: Spark leftover DSR/SSR xchain-ssr-oracle (`4a23d1f`)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Listed GitHub
[marsfoundation/xchain-ssr-oracle](https://github.com/marsfoundation/xchain-ssr-oracle)
(live default tree is
`sky-ecosystem/xchain-ssr-oracle`
`master` `4a23d1f`). DSR_*
live rows are the README
“Legacy Deployments (DAI)”
of the same contracts.
Receivers are
`marsfoundation/xchain-helpers`
`bb76966`
(`OptimismReceiver` /
`ArbitrumReceiver` /
`AMBReceiver` /
`LZComposeReceiver`).
ALM + Vault V2 + PSM3 +
Collector + gov-relay
already logged. No
state-changing txs.
Read-only `eth_call` only.

Files: `SSRAuthOracle`,
`SSRMainnetOracle`,
`SSROracleBase`, forwarders
(Base / Optimism /
Arbitrum / Gnosis / LZ),
adapters (Chainlink /
Balancer), `script/Deploy.s.sol`,
xchain-helpers receivers.

Checked for: a stranger
`setSUSDSData`; a receiver
fallback that skips the
bridge check; a forwarder
that lets the caller pick
a fake payload; first-update
/ `maxSSR == 0` letting a
stranger inflate `chi`;
Arbitrum alias spoof.

Result: no user-exploitable
finding. Not submitted.

- `setSUSDSData` is
  `DATA_PROVIDER_ROLE`.
  `rho` must be `<= now`
  and strictly increasing;
  `ssr >= RAY`; `chi`
  non-decreasing; optional
  `chiMax` only when
  `maxSSR != 0`. First
  update (`rho == 0`) skips
  those checks. Deploy
  grants `DATA_PROVIDER`
  to the receiver and
  renounces deployer admin.
- Live Base AuthOracle
  `0x65d946…f7a1` (~04:41
  UTC 3 Sep): `maxSSR = 0`
  (same on Arb / OP).
  Receiver `0x212871…8474`
  has `DATA_PROVIDER`, not
  admin. Zero is not admin.
  `maxSSR = 0` is
  documented; a compromised
  provider can set a large
  `chi`, but the provider
  is the bridge receiver.
  Stored `rho` is
  2026-08-20T12:56:47Z;
  views extrapolate.
- Forwarders are
  permissionless `refresh()`
  that SafeCast-pack live
  sUSDS and send to the
  immutable `l2Oracle` (the
  receiver). The caller
  cannot choose the payload.
- Optimism receiver:
  messenger `0x4200…0007`
  and `xDomainMessageSender
  == l1Authority`.
  Arbitrum subtracts the
  standard alias. AMB
  checks amb / source chain
  / authority. LZ compose
  checks src eid + source
  authority, then composes
  only from self via the
  endpoint.
- Mainnet `refresh()` copies
  sUSDS with raw
  uint96 / 120 / 40 casts
  (forwarders use SafeCast).
  Live `ssr` / `chi` are
  nowhere near those caps.
- Adapters are views.
  Chainlink
  `latestRoundData` uses
  `roundId = 0`. Balancer
  divides the binomial ray
  by `1e9`. `getAPR`
  unchecked `(ssr - RAY)`
  is a view; the Auth path
  rejects `ssr < RAY`.

Remaining SparkLend after
this write-up was
`SSR_RATE_SOURCE` /
`KILL_SWITCH_ORACLE` /
`SavingsDaiOracle`; that
pass is logged below. The
`xchain-ssr-oracle` GitHub
tree and DSR / SSR live
rows are exhausted. Not
submitted.

## 2026-09-03: Spark leftover SSRRateSource + KillSwitchOracle + SavingsDaiOracle (Sourcify)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
Leftover oracle addresses
after the DSR / SSR tree:
`SSR_RATE_SOURCE`
`0x57027B…9973` (Sourcify
exact, verified 2024-12-28,
`SSRRateSource`),
`KILL_SWITCH_ORACLE`
`0x909A86…be82` (exact,
2024-08-08,
`KillSwitchOracle`),
`SavingsDaiOracle`
`0xb9E6DB…AB5f` (exact,
2025-07-04). Extract under
`/tmp/spark-leftover-oracles`.
15 Jul sUSDC / `UsdcVault`
already logged. No
state-changing txs.
Read-only `eth_call` only.

Files: `src/SSRRateSource.sol`,
`src/KillSwitchOracle.sol`,
`src/SavingsDaiOracle.sol`.

Checked for: a stranger
`trigger` that disables
borrows while listed
oracles are healthy; a
threshold of zero that
still counts; `getAPR`
that underflows into a
huge rate; `getAnswer`
that multiplies a stale
DAI round by current
`chi` in a money path.

Result: no user-exploitable
finding. Not submitted.

- `SSRRateSource.getAPR`
  is a view:
  `(susds.ssr() - 1e27) *
  365 days` in 0.8
  (reverts if `ssr < RAY`).
  Live ~04:45 UTC: ~3.46e25
  (~3.46% APR ray).
- `KillSwitchOracle.trigger`
  is permissionless. The
  first trip requires a
  owner-listed oracle with
  `latestAnswer > 0` and
  `price <= threshold`.
  After that, anyone can
  keep disabling borrow on
  remaining active reserves
  until `reset` (owner).
  Live: `triggered = false`,
  6 oracles, owner
  `0x3300f198…8c4`.
- `SavingsDaiOracle` is a
  view adapter:
  `daiPrice * pot.chi / RAY`.
  `getAnswer(roundId)` uses
  **current** `chi` against
  a historical DAI round
  (known inaccuracy; Aave
  paths use `latestAnswer`).
  Live `latestAnswer`
  ~1.18e8 (8-dec USD).

Remaining SparkLend listed
oracle leftovers are
exhausted (`AAVE_ORACLE` is
the already-logged Aave V3
price oracle). Not
submitted.

## 2026-09-03: KeeperHub #2105 claimed

Rechecked ~04:34 UTC
3 Sep. Issue #2105 is
still `open` +
`accepted` +
`confirmed`, but
[comment](https://github.com/KeeperHub/keeperhub/issues/2105#issuecomment-5520347847)
and
[PR #2275](https://github.com/KeeperHub/keeperhub/pull/2275)
from `tenk-earn` (opened
04:27 UTC, targeting
`staging`,
`Closes #2105`,
`app/api/openapi/route.ts`
+ `tests/unit/openapi-route.test.ts`).
Do not open a second
#2105 PR. This run’s
#2105 spec is
superseded. No
KeeperHub
implementation before
the 6 Sep window; #2240
remains the other
track.

## 2026-09-03: Spark X Layer SavingsVaultIntents leftover (Sourcify)

Immunefi program `sparklend`
($5,000,000, `kyc: false`).
18 Mar 2026 leftover:
SPARK_SAVINGS_INTENTS
`0x5bCD…1865` on X Layer
(chain 196). Sourcify
exact match, verified
2026-08-11,
`SavingsVaultIntents`
solc 0.8.27. Ctor admin
`0x23d4…5FB3`, relayer
`0x8a25…39ab`,
`maxDeadlineDuration`
604800. Extract under
`/tmp/spark-leftover/intents`.
No mainnet interaction.

Files:
`src/SavingsVaultIntents.sol`,
`src/interfaces/{ISavingsVaultIntents,IERC4626Like}.sol`.

Checked for: `request`
that binds a stranger’s
shares; `fulfill` that
redeems to an attacker
or after the deadline;
overwrite of another
account’s request; a
non-relayer fulfill;
admin-less vault swap
mid-flight.

Result: no user-exploitable
finding. Not submitted.

- `request` is
  permissionless for the
  caller’s own
  `(account, vault)` slot.
  Vault must be
  whitelisted. Recipient
  cannot be `0`. Assets
  from
  `convertToAssets(shares)`
  must sit in
  `[min, max]`. Deadline
  must be in
  `(now, now +
  maxDeadlineDuration]`.
  Caller must hold the
  shares and have
  approved this contract.
  Shares are not pulled
  at request time.
- A second `request` for
  the same vault
  overwrites the caller’s
  pending intent only.
- `cancel` deletes the
  caller’s slot.
- `fulfill` is `RELAYER`.
  It requires a matching
  non-zero `requestId`,
  rejects after
  `deadline`, deletes,
  then
  `redeem(shares,
  recipient, account)`.
  The relayer cannot
  change shares or
  recipient. A later
  allowance revoke or
  share transfer makes
  redeem revert (user
  self-lock, not theft).
- Admin sets whitelist /
  bounds /
  `maxDeadlineDuration`
  (`!= 0`). Relayer is
  granted in the
  constructor.

Spark leftover oracle
rows and 15 Jul Ethereum
`UsdcVault` were logged
in a parallel pass. L2
15 Jul `SUSDC_IMPL` rows
are `UsdcVaultL2` (logged
below), not the Ethereum
vault. Not submitted.

## 2026-09-03: Olympus DepositManager + RedemptionVault + Clearinghouse + Heart (`3f918a0`)

Same Immunefi program
`olympus` ($3,333,333,
`kyc: false`, critical
only). 20 Feb leftover
after the V1Migrator /
Cooler V2 / CCIP / CD
Facility pass:
DepositManager
`0xcb4E…bbf2`,
ReceiptTokenMgr
`0xD98B…ddd1`,
DepositRedemptionVault
`0x20a3…029Db`,
Clearinghouse v1.2
`0x1e09…e0`, Heart v1.7
`0x5824…5ECB`, Operator
v1.5 `0x6417…b52`,
EmissionManager v1.2
`0xa61b…b6ff`,
CCIPBurnMintTokenPool
`0xa558…e3aD`. Official
`olympus-v3` `3f918a0`.
Sourcify v2 HTTP 400 on
several leftovers; used
the public tree. No
state-changing txs.

Files:
`src/policies/deposits/{DepositManager,
ReceiptTokenManager,
DepositRedemptionVault}.sol`,
`policies/{Clearinghouse,
Heart,Operator,EmissionManager}.sol`,
`policies/bridge/CCIPBurnMintTokenPool.sol`.

Checked for: a deposit
operator withdrawing
another operator’s
liabilities; receipt mint
by a stranger; redemption
finish before `redeemableAt`;
borrow-against-redemption
without a committed
receipt; Clearinghouse
`lendToCooler` to a
factory-foreign cooler;
Heart `beat` minting
unbounded OHM; CCIP pool
`_mint` callable outside
the router.

Result: no user-exploitable
finding. Not submitted.

- `DepositManager.deposit`
  / `withdraw` / `claimYield`
  / `borrowingWithdraw` are
  `ROLE_DEPOSIT_OPERATOR` and
  keyed by `msg.sender`.
  Receipt token IDs bind
  `(manager, asset, period,
  operator)`. Mint/burn
  require the token owner
  (`ReceiptTokenManager`).
  Solvency is
  `liabilities <= assets
  + borrowed`. Borrow
  capacity is the operator’s
  own liabilities minus
  already borrowed.
- Redemption start pulls
  unwrapped receipts, records
  `msg.sender`, and commits
  at the facility. Finish /
  cancel / borrow / repay
  are `onlyValidRedemptionId`
  for the owner. Finish
  waits for `redeemableAt`
  and refuses an unpaid
  loan. Default burns unpaid
  principal receipts and
  sends the buffer to TRSRY.
- `Clearinghouse.lendToCooler`
  requires `factory.created`
  and matching gOHM/reserve,
  pulls collateral from the
  caller, and clears the
  request itself. Defaults
  pay a capped keeper
  reward and burn leftover
  gOHM. `defund` is
  `cooler_overseer`.
- `Heart.beat` is
  frequency-gated and mints
  at most `currentReward()`.
  `EmissionManager.execute`
  and `Operator.operate` are
  `heart`. `Operator.swap`
  is the RBS wall with
  capacity + `minAmountOut`.
- CCIP pool `_mint` /
  `_burn` override
  Chainlink’s TokenPool
  hooks (`onlyEnabled`).
  Router / RMN still gate
  the external path.

## 2026-09-03: Olympus Governor Bravo + BondTeller + BondCallback (`3f918a0`)

Same program. Sourcify
exact matches on
GovernorBravoDelegate
`0xa601…1B4`, Delegator
`0x0941…fcD`, Timelock
`0x953E…9c39`,
BondFixedTermTeller
`0x007F…Fed6`,
BondCallback v1.1
`0x73df…795e`. Bond
Manager
`0xf577…B2A3` is
`BondManager.sol`.
Official tree `3f918a0`.
No state-changing txs.

Files:
`src/external/governance/{GovernorBravoDelegate,
GovernorBravoDelegator,Timelock}.sol`,
`src/policies/{BondCallback,BondManager}.sol`,
Bond Protocol
`BondFixedTermTeller` /
`BondBaseTeller` (Sourcify
+ vendored `src/test/lib/bonds`).
Also read L2 copies of
`OlympusMinter.sol` and
deprecated
`policies/CrossChainBridge.sol`.

Checked for: a stranger
`initialize` / `_setImplementation`;
emergency propose / queue
without the veto guardian;
cancel of an emergency
proposal by a non-proposer
when `proposalThreshold`
is 0; execute after a
target codehash change;
callback mint to a
non-whitelisted teller;
teller redeem that pays
more underlying than
shares burned; BondManager
market create by a
non-admin; L2 MINTR mint
without kernel permission;
LZ receive from an
untrusted remote.

Result: no user-exploitable
finding. Not submitted.

- Delegator constructor
  `delegatecall`s
  `initialize` (admin-only,
  reverts if `timelock`
  already set) then sets
  `admin = timelock_`.
  `_setImplementation` is
  admin-only and rejects
  `address(0)`.
- `propose` requires prior
  votes above the
  percentage threshold.
  `activate` (anyone, after
  `startBlock`) locks
  quorum from current
  gOHM supply. Votes take
  `min(startBlock,
  now-1)` prior votes.
  Queue / execute require
  `Succeeded` / `Queued`
  and that the proposer
  still holds the captured
  threshold. Timelock
  execute re-checks the
  propose-time codehash.
- `emergencyPropose` /
  emergency queue /
  execute are
  `vetoGuardian` and only
  while `gOHM.totalSupply
  < 1000e18`. Emergency
  proposals store
  `proposalThreshold = 0`;
  cancel by a stranger
  hits `votes >= 0` and
  reverts
  `Cancel_AboveThreshold`.
  Only the proposer
  (guardian) can cancel.
- BondCallback `callback`
  requires
  `approvedMarkets[msg.sender][id_]`.
  Whitelist /
  blacklist are
  `callback_whitelist`
  and the teller must
  match the aggregator.
  Quote tokens must
  already sit on the
  callback. OHM payout
  mints to the teller;
  inverse withdraws
  TRSRY (unwraps a
  configured 4626 first)
  and burns the received
  OHM. `batchToTreasury`
  / `setOperator` are
  `callback_admin`.
- Teller `purchase` pulls
  quote, pays protocol /
  referrer fees from the
  quote, then either
  `callback` (must return
  `payout_` of the payout
  token) or
  `transferFrom` the
  market owner. Redeem /
  `create` are 1:1 with
  the ERC1155 supply
  after expiry. Protocol
  fee is `requiresAuth`
  and capped at 5%.
- `BondManager` market
  launch / settle /
  emergency withdraw are
  `bondmanager_admin`.
- L2 `OlympusMinter`
  `mintOhm` is
  `permissioned` +
  `onlyWhileActive` and
  spends `mintApproval`.
  Deprecated LZ
  `CrossChainBridge`
  `lzReceive` requires
  the endpoint and a
  stored trusted remote;
  mint goes to the
  decoded recipient.
  Failed messages retry
  the same payload hash.

Remaining Olympus leftover:
CD Auctioneer / Limit
Orders / CoolerFactory /
LTV / TreasuryBorrower /
Composites / RANGE / YRF
/ CHREG / RGSTY / DLGTE /
RolesAdmin (this pass
below). CDEPO module
`0x0233…9F1c` is still
Sourcify 404. Not
submitted.

## 2026-09-03: Spark UsdcVaultL2 (15 Jul L2 SUSDC_IMPL)

Immunefi program
`sparklend` ($5,000,000,
`kyc: false`). 15 Jul
L2 `SUSDC_IMPL` rows are
**not** the Ethereum
`UsdcVault` already
logged. Sourcify exact
`UsdcVaultL2`
`src/UsdcVaultL2.sol`:
Base
`0x6ACC…7723`
(verified 2026-06-30),
Arbitrum
`0xdC8D…92d6`
(2026-06-19), Optimism
`0x3a1d…CEA5`
(2026-06-19). Unichain
`0x1fcc…4C79`
Sourcify 404 (same
listing). Ethereum
`0xf943…20bA` remains
`UsdcVault`. Extract
under
`/tmp/spark-usdcvault-l2`.
Read-only. No
state-changing txs.

Checked for: first-depositor
share inflation; withdraw /
redeem that spends vault
sUSDS without burning the
owner’s shares; `exit`
that pays more sUSDS than
shares; `mint` /
`swapExactOut` taking a
stranger’s USDC; UUPS
upgrade without `wards`.

Result: no user-exploitable
finding. Not submitted.

- Shares mint 1:1 with
  sUSDS received from
  `psm.swapExactIn` /
  `swapExactOut`, not from
  a `totalAssets` /
  `totalSupply` ratio.
  Donated USDC or sUSDS
  does not mint shares.
- `deposit` pulls USDC
  from `msg.sender`, swaps
  into this vault, then
  `_mint`s `amountOut`.
  `withdraw` / `redeem`
  swap vault sUSDS to the
  receiver and then
  `_burn` the owner
  (allowance if not
  sender). A shortfall
  reverts the whole tx.
- `exit` burns shares and
  transfers that many
  sUSDS. Transfer to
  `address(this)` is
  rejected.
- UUPS
  `_authorizeUpgrade` is
  `auth`. `initialize`
  is disabled on the
  implementation.

Listed Spark leftover
addresses after this
correction: Unichain
impl still unverified
on Sourcify (treat as
the same L2 vault).
Not submitted.

## 2026-09-03: Olympus CD Auctioneer + Cooler leftovers + RANGE/YRF (`3f918a0`)

Same Immunefi program
`olympus` ($3,333,333,
`kyc: false`, critical
only). Sourcify matches
on ConvertibleDeposit
Auctioneer
`0xF351…E39a`,
CDAuctioneerLimitOrders
`0x7d8f…Fc2e`,
CoolerFactory
`0x30Ce…4216`,
CoolerLtvOracle
`0x9ee9…e8dc`,
CoolerTreasuryBorrower
`0xD58d…79B0`,
CoolerComposites
`0x6593…57Fd`,
YieldRepurchaseFacility
`0x271e…0692`,
OlympusRange
`0x399c…0fb5`,
CHREG
`0x69a3…43a4`,
RGSTY
`0x8963…de48`,
DLGTE
`0xD320…ad74`.
RolesAdmin is
`policies/RolesAdmin.sol`
(L2 copies of the same
tree). Official
`olympus-v3` `3f918a0`.
CDEPO `0x0233…9F1c`
Sourcify 404. No
state-changing txs.

Files:
`policies/deposits/{ConvertibleDepositAuctioneer,LimitOrders}.sol`,
`external/cooler/CoolerFactory.sol`,
`policies/cooler/{CoolerLtvOracle,CoolerTreasuryBorrower}.sol`,
`periphery/CoolerComposites.sol`,
`policies/{YieldRepurchaseFacility,RolesAdmin}.sol`,
`modules/{RANGE/OlympusRange,CHREG/OlympusClearinghouseRegistry,RGSTY/OlympusContractRegistry,DLGTE/OlympusGovDelegation}.sol`.

Checked for: a stranger
`bid` that mints a
receipt at a stale
price below `minPrice`;
limit-order `fillOrder`
that spends another
user’s sUSDS or sweeps
principal as yield;
CoolerFactory
`generateCooler` that
overwrites a victim’s
escrow; LTV decrease;
TreasuryBorrower
`borrow` without the
cooler role; composites
that borrow against a
stranger without a
signature; YRF
`endEpoch` by a
non-heart; DLGTE
withdraw across policy
namespaces.

Result: no user-exploitable
finding. Not submitted.

- Auctioneer `bid` is
  `onlyEnabled` +
  period-enabled +
  `nonReentrant`. It
  prices from the
  decaying tick (floored
  at `minPrice`) and
  `createPosition`s at
  the facility as
  `ROLE_AUCTIONEER`.
  Parameters are
  `cd_emissionmanager` /
  manager-or-admin.
- Limit orders hold USDS
  in sUSDS and track
  `totalUsdsOwed`.
  `fillOrder` withdraws
  only `fill + incentive`,
  bids with
  `minOhmOut = preview`,
  and sends the NFT +
  receipts to the order
  owner. `sweepYield`
  transfers only shares
  above
  `previewWithdraw(totalUsdsOwed)`.
  `cancelOrder` is the
  owner and works while
  disabled.
- CoolerFactory clones
  with immutable owner /
  tokens / factory and
  sets `created`. Events
  are `onlyFromFactory`.
- LTV
  `setOriginationLtvAt`
  is admin-only and
  reverts
  `CannotDecreaseLtv`.
  Slope is capped.
- TreasuryBorrower
  `borrow` / `repay` /
  `writeOffDebt` are
  `treasuryborrower_cooler`.
  `setDebt` is admin.
- Composites pull
  collateral / debt from
  `msg.sender`, credit
  `msg.sender` on MonoCooler,
  and optionally
  `setAuthorizationWithSig`.
  Excess debt is refunded
  to the caller.
- YRF `endEpoch` is
  `heart`. `initialize` /
  `adjustNextYield` /
  `shutdown` are
  `loop_daddy`.
- RANGE / CHREG / RGSTY
  mutators are
  `permissioned`.
- DLGTE deposit / withdraw
  / `applyDelegations`
  are `permissioned`.
  Withdraw is capped by
  `_policyAccountBalances[msg.sender][onBehalfOf]`.
- RolesAdmin
  `grantRole` /
  `revokeRole` are
  `onlyAdmin` with a
  two-step admin handoff.

Remaining Olympus leftover:
CDEPO module
`0x0233…9F1c`
(Sourcify 404). L2 OHM /
gOHM token rows are
standard tokens. 20 Feb
money-moving leftovers
that Sourcify or the
public tree can open
are exhausted. Not
submitted.

## 2026-09-03: GammaSwap 2024 factory + DeltaSwap leftover

Immunefi program
`gammaswap` ($40,000,
`kyc: false`, Primacy of
Rules, critical only,
PoC required). 24 Mar
2024 leftover after the
May 2026 vault pass:
GammaPoolFactory
`0xFD51…c20B` (Sourcify
exact, solc 0.8.21,
core `2312d0e`),
DeltaSwapFactory
`0xCb85…ffA8`,
DeltaSwapRouter02
`0x5FbE…1e1b`,
DeltaSwapPair
`0x755F…6EF0`
(Sourcify exact),
MinimalBeaconProxy +
LockableMinimalBeacon.
Extract under
`/tmp/gammaswap-core`
and
`/tmp/gammaswap-deltaswap`.
Read-only. No
state-changing txs.
UniV2 issues in
DeltaSwap are OOS unless
GammaSwap materially
changed them. Staking /
GS / timelock are capped
at high; airdrop is
medium-ineligible.

Files:
`contracts/GammaPoolFactory.sol`,
`base/AbstractGammaPoolFactory.sol`,
`utils/{LockableMinimalBeacon,MinimalBeaconProxy}.sol`,
`libraries/AddressCalculator.sol`,
`observer/AbstractLoanObserverStore.sol`,
DeltaSwap
`{DeltaSwapFactory,DeltaSwapPair,DeltaSwapRouter02}.sol`.

Checked for: a stranger
`createPool` that
initializes a victim’s
predicted address; beacon
delegatecall to a
swappable impl; factory
`execute` by a
non-feeToSetter; DeltaSwap
`swap` that skips the K
check when
`msg.sender == gammaPool`
for a spoofed pool;
`setGammaPool` by a
stranger; router fee
calc that lets a swap
drain reserves.

Result: no user-exploitable
critical. Not submitted.

- `createPool` is
  permissionless unless
  the protocol is
  restricted. It
  `validateCFMM`s, salts
  by `(cfmm, protocolId)`,
  create2s, then
  `initialize`s in the
  same tx. `addProtocol` /
  `updateProtocol` /
  `lockProtocol` are
  owner-only. After
  `lock`, the beacon
  freezes
  `_implementation()`.
- `execute` is
  `feeToSetter` only
  (admin-trusted arbitrary
  call). Pause is owner.
- Beacon proxy bytecode
  is
  `calcMinimalBeaconProxyBytecode`
  (factory + protocolId
  baked in), not the
  placeholder constants
  in the Solidity source.
- DeltaSwap is UniV2
  plus a size-gated fee
  (`dsFee` when trade ≥
  `dsFeeThreshold` of
  the liquidity EMA) and
  a `gsFee` path when
  `msg.sender ==
  gammaPool`.
  `gammaPool` is set only
  by the factory to
  `calcAddress(gsFactory,
  gsProtocolId,
  keccak256(pair,
  protocolId))`.
  `setGammaPool` /
  `updateGammaPool` are
  `gammaPoolSetter`.
- Zero-fee small trades
  are designed. The K
  invariant still uses
  `1000 - fee`. Router
  `getAmountOut` uses
  `calcPairTradingFee`.
- Staking rows Sourcify
  as GMX-style
  `RewardTracker` /
  `Vester` /
  `StakingRouter`
  (`@gammaswap/v1-staking`).
  Do not file high
  findings against them.

Remaining GammaSwap
listed Solidity:
staking / GS / timelock
(high-capped) and
airdrop (medium
ineligible). Factory +
DeltaSwap + May 2026
vault leftover are
logged. Not submitted.

## 2026-09-03: Zest Protocol V2 market + vault leftover (`f2fce52`)

Immunefi program
`zest-protocol-v2`
($100,000, `kyc: false`,
Clarity / Stacks). Listed
Hiro principals under
`SP1A27…ADJ7`:
`v0-6-market` (newest
listed market),
`v0-market-vault`,
`v0-assets`, `v0-egroup`,
six `v0-vault-*`
(sBTC / STX / stSTX /
USDC / USDH / stSTXbtc)
plus DAO executor /
multisig / treasury.
Official
`Zest-Protocol/zest-v2-contracts`
`f2fce52` (2026-09-02)
has `v0-8-market` as the
current tree. Hiro
`v0-6-market` source
pulled read-only
(`/tmp/zest-v06.json`).
Repo extract under
`/tmp/zest-v2`. No
mainnet interaction.

Files:
`mainnet/contracts/market/{v0-8-market,v0-market-vault}.clar`,
`vault/v0-vault-sbtc.clar`,
Hiro `v0-6-market.clar`.

Checked for: collateral
add that credits a
stranger; remove that
pays a non-owner;
`borrow` without a
health check; `repay`
that writes off another
account without a pull;
`liquidate` of a healthy
or same-block borrower;
vault `system-borrow`
without market auth.

Result: no user-exploitable
finding. Not submitted.

- `collateral-add` /
  `supply-collateral-add`
  / `repay` /
  `liquidate` require
  `contract-caller ==
  tx-sender`. Account is
  `contract-caller`.
  Vault `receive-tokens`
  pulls that account.
- `collateral-remove` /
  `borrow` credit an
  optional receiver but
  still debit
  `contract-caller`.
  Borrow and remove
  check egroup LTV
  after the change.
- Market-vault money
  paths are
  `check-impl-auth`
  (`contract-caller ==
  impl`). `set-impl` is
  `dao-executor`.
- Vault
  `system-borrow` /
  `system-repay` are
  `check-caller-auth`
  (authorized-contract
  map, DAO-set). Caps
  bind available assets
  and `CAP-DEBT`.
- Liquidation requires
  `current-ltv >=
  LTV-LIQ-PARTIAL`,
  rejects
  `last-borrow-block ==
  stacks-block-height`,
  then repay + seize
  with `min-collateral-
  expected`. Same-block
  oracle borrow is
  blocked. v0-6 Hiro
  source has the same
  auth / same-block /
  healthy gates.

Remaining Zest leftover
was DAO executor /
multisig / treasury and
the zvstBTC strategy
vault; logged in the
DAO + strategy pass
below. Not submitted.

## 2026-09-03: GammaSwap staking + GS token + timelock + airdrop leftover

Immunefi program
`gammaswap` ($40,000,
`kyc: false`, Primacy of
Rules, **critical only**:
theft / freeze /
insolvency). Custom OOS:
GS, `GSTimelockController`,
and staking are eligible
for at most high (so they
do not pay on this
program); airdrop is not
eligible for medium.
Factory + DeltaSwap + May
2026 vault leftovers are
already logged. This pass
is the remaining 2024
staking / GS / timelock /
airdrop rows. Sourcify
exact (Arbitrum 42161).
Read-only `eth_call` via
`https://arb1.arbitrum.io/rpc`
~05:05 UTC 3 Sep. No
state-changing txs.

Listing labels are
swapped: listed
`GSTimelockController`
`0xb08d…3e83` is an
ERC1967 proxy whose
implementation
`0x91fb…f2dd` is `GS`
(symbol `GS`, name
`GammaSwap`); listed `GS`
`0x3f7c…73f8` is
`GSTimelockController`
(`minDelay` 60). Airdrop
`0x4c02…0f98` `token()`
is the GS proxy.

Sources: staking router
Sourcify
`/tmp/gammaswap-leftover/c582…4ae4`
+ tree `/tmp/gammaswap-staking`
`c3df0b0`; GS impl
`/tmp/gammaswap-leftover/91fb…f2dd`
+ `/tmp/gammaswap-gstoken`
`9e7e3d2`; timelock
`/tmp/gammaswap-leftover/3f7c…73f8`
+ `/tmp/gammaswap-timelock`
`d3cfc85`; airdrop
`/tmp/gammaswap-leftover/4c02…0f98`.

Files:
`StakingRouter.sol`,
`StakingAdmin.sol`,
`RewardTracker.sol`,
`RewardDistributor.sol`,
`Vester.sol`,
`FeeTracker.sol`,
`BonusDistributor.sol`,
`BeaconProxyFactory.sol`,
`contracts/GS.sol` (LZ V2
OFT + UUPS),
`GSTimelockController.sol`,
`Airdrop.sol`.

Checked for: public
`stake` / `stakeForAccount`
draining a tracker;
uninitialized GS-token
router accepting deposits;
airdrop claim against a
zero merkle root; OFT mint
above `MAX_SUPPLY` or
without a peer; timelock
`executeEmergency` on an
unlisted selector;
permissionless
`addEmergencyCall`.

Result: no user-exploitable
finding. Not submitted.
Would not pay even as
high (GS / staking /
timelock cap) or medium
(airdrop).

- StakingRouter owner
  `0x937f…C3Fb`.
  `gsTokensInitialized`
  is false; `gs` / `esGs`
  are zero. Live
  RewardTracker
  `0xd04F…4088` is in
  private staking /
  transfer mode,
  `distributor == 0`,
  `totalSupply == 0`.
  `stake` reverts when
  private; `stakeForAccount`
  is handler-only. Loan
  staking is a published
  known issue (unused).
  `initializeGSTokens` is
  owner-only and one-shot.
- GS is LayerZero V2 OFT
  + UUPS. Constructor /
  `initialize` mint once;
  later mint is OFT
  `_credit` (peer-gated)
  and `_mint` enforces
  `MAX_SUPPLY`
  1.6e9. Live supply
  ~3.33e8. Proxy owner
  `0x9b2a…b3f1` (not the
  factory EOA). Upgrade
  is `onlyOwner`.
- Timelock `minDelay` is
  60 seconds. Factory EOA
  `0x937f…C3Fb` holds
  proposer / executor /
  canceller / emergency;
  it does not hold
  `DEFAULT_ADMIN_ROLE`.
  `addEmergencyCall` /
  `removeEmergencyCall`
  require
  `msg.sender ==
  address(this)`.
  `executeEmergency` is
  `EMERGENCY_ROLE` and
  only for a previously
  registered
  `(target, func)` id.
- Airdrop: `isPaused ==
  true`, merkle roots 0
  and 1 are zero,
  `totalClaimed == 0`,
  GS balance 0. `claim`
  reverts
  `MerkleRootNotSet` when
  the epoch root is zero
  (also `Paused`).
  `updateRoot` / `withdraw`
  / `pause` / UUPS are
  owner-only. Constructor
  `_disableInitializers()`.

Listed GammaSwap Solidity
is exhausted. Do not
re-review factory /
DeltaSwap / May 2026
vault. Olympus CDEPO is
the official DEPOS
module and is logged
below. Next leftover:
StackingDAO rewards /
stakers / signers,
TermMax adapters, Twyne
Sourcify-404 vaults, Sky
`PAUFactory` / `Kicker` /
`sky-oapp-oft`, or Yearn
3.0.4 Tokenized Strategy
/ Vault V3. Not
submitted.

## 2026-09-03: Zest Protocol V2 DAO + zvstBTC strategy leftover (`f2fce52`)

Immunefi program
`zest-protocol-v2`
($100,000, `kyc: false`,
Clarity / Stacks). Listed
Hiro principals include
`dao-executor` /
`dao-multisig` /
`dao-treasury`. The
zvstBTC strategy vault
is in the official
`Zest-Protocol/zest-v2-contracts`
tree at `f2fce52` (not a
listed Hiro row; Primacy
of Impact only if a
finding existed). Local
extract `/tmp/zest-v2`.
No mainnet interaction.

Files:
`mainnet/contracts/dao/{dao-executor,dao-multisig,dao-treasury,dao-traits}.clar`,
`mainnet/contracts/strategy-vault/{zvstBTC,zv-engine-stbtc-0,zv-ops-stbtc-0,zv-state-stbtc-0,zv-traits}.clar`.

Checked for: proposal
execution that skips the
multisig impl; treasury
withdraw that is not
executor-gated; strategy
share mint without a
pull; redeem that pays a
stranger; first-depositor
inflation; claim
double-fund; trader
redirect of borrowed
sBTC or removed
collateral; ops sweep
that drains state past
funded-claim liability.

Result: no user-exploitable
finding. Not submitted.

- `dao-executor`
  `execute-proposal` /
  `set-impl` require
  `contract-caller ==
  impl`. `init` is
  deployer-once.
  `as-contract` so
  proposal scripts see
  `tx-sender ==
  dao-executor`.
- Multisig signer
  management and impl
  schedule / execute /
  cancel are
  `tx-sender ==
  dao-executor`. Propose /
  approve / execute are
  signer-gated. Execute
  requires matching
  script, threshold,
  unexpired, and either
  the 1-day timelock or
  the `urgent` flag (DAO
  trust). Impl replace
  has a 7-day timelock.
- Treasury `withdraw`
  is executor-only and
  pays the proposal-
  chosen recipient.
- `zvstBTC` mint / burn
  are engine-only.
  `set-authorized-minter`
  is state-only.
- Engine `initialize`
  seeds 1000 dead shares
  to the null principal.
  Deposit mints
  `amount * supply /
  gross` after
  crystallize; sBTC
  deposit converts first,
  then uses pre-deposit
  NAV. Request-redeem
  locks a share price
  and escrows shares.
  `fund-claim` pays
  `min(quoted, live NAV)`
  and can run after
  cooldown or by
  manager/engine.
  `redeem` always pays
  the stored user.
  Cancel is user-only
  and unfunded-only.
- State pulls / pays
  are engine- or
  ops-gated. Collateral
  to ops cannot drop
  the state stBTC
  balance below
  `funded-claim-liability`.
  Owner / trader /
  guardian are
  privileged; hot-role
  changes are immediate
  (admin trust).
- Ops open / borrow /
  close / unstack keep
  sBTC and stBTC inside
  ops → StackingDAO /
  Zest market → state.
  Borrow receiver is
  `none` (ops). Collateral
  remove receiver is
  `zv-state`. Close
  requires zero leftover
  scaled debt. Permissionless
  `restack-ops-sbtc` /
  `sweep-ops-stbtc` only
  return leftovers to
  state.

Listed Zest Clarity is
exhausted. Next leftover
is StackingDAO rewards /
stakers / signers after
the core deposit path
logged below, not a
second Zest pass. Not
submitted.

## 2026-09-03: Olympus DEPOS / CDEPO (`3f918a0`)

Same Immunefi program
`olympus` ($3,333,333,
`kyc: false`, critical
only). Listed leftover
CDEPO
`0x02331A4c97a4841084dF54d7c0eC04DD3f1A9F1c`
is still Sourcify 404.
Official
`OlympusDAO/olympus-v3`
`3f918a0` + `env.json`
map it to module
`OlympusDepositPositionManager`
(KEYCODE `DEPOS`), not a
separate deposit vault.
Renderer is
`PositionTokenRenderer`.
No state-changing txs.

Files:
`src/modules/DEPOS/{OlympusDepositPositionManager,DEPOS.v1,IDepositPositionManager,PositionTokenRenderer}.sol`,
plus the already-logged
`ConvertibleDepositFacility`
/ `BaseDepositFacility`
DEPOS call sites.

Checked for: permissionless
`mint` of conversion
rights; `split` to a
stranger; wrap/unwrap
that steals an NFT;
`transferFrom` that
leaves `position.owner`
and ERC721 owner
desynced; `previewConvert`
that overpays OHM;
facility `convert` that
mints without burning
receipts.

Result: no user-exploitable
finding. Not submitted.

- `mint` /
  `setRemainingDeposit` /
  `split` /
  `setAdditionalData` /
  `setTokenRenderer` are
  Kernel `permissioned`.
  Only CDF requests
  `mint` / `setRemainingDeposit`
  / `split`.
- `_create` binds
  `operator = msg.sender`
  (the policy). CDF
  `createPosition` is
  `ROLE_AUCTIONEER` and
  mints remaining equal
  to `DepositManager.deposit`
  `actualAmount`.
- CDF `split` requires
  `position.operator ==
  this` and
  `position.owner ==
  msg.sender`. DEPOS
  `split` cannot be
  called by the holder.
- `wrap` / `unwrap` are
  `onlyPositionOwner`.
  Overridden
  `transferFrom` updates
  `position.owner` and
  `_userPositions`
  before Solmate
  transfer. Unwrapped
  IDs revert
  `DEPOS_NotWrapped`.
- CDF `convert` requires
  `position.owner ==
  msg.sender`,
  `operator == this`,
  decrements remaining,
  then
  `DepositManager.withdraw`
  receipts from the
  caller and `MINTR.mintOhm`
  to the caller. NFT
  without receipts
  cannot convert.
- `handlePositionRedemption`
  / cancel are
  authorized-operator
  only (already-logged
  DepositRedemptionVault).
- Renderer is view-only
  metadata.

Listed Olympus leftover
addresses that Sourcify
or the public tree can
open are exhausted.
L2 MINTR / RolesAdmin /
deprecated LZ bridge
copies are the same
tree already logged.
Not submitted.

## 2026-09-03: Sky StarGuard + SubProxyMethods + PAU assembler (`707c84d` / `8ab9daf` / `c13e80f`)

Immunefi program `sky`
($10,000,000, `kyc: false`).
Feb 2026 leftover
`star-guard`
`src/StarGuard.sol`
(`main` `707c84d`).
6 Jul leftover
`subproxy-methods`
`src/SubProxyMethods.sol`
(`8ab9daf`),
`pau-assemblers`
`DefaultPAUAssembler.sol`
(`dev` `c13e80f`), and
`pau-administered-agent`
`AdministeredAgent{,Factory}.sol`
(`5e6b52f`). Official
clones under
`/tmp/sky-star-guard`,
`/tmp/sky-subproxy-methods`,
`/tmp/sky-pau-assembler`,
`/tmp/sky-administered-agent`.
No mainnet interaction.

Files as named above
plus `deploy/StarGuardInit.sol`.

Checked for: permissionless
`plot` / `exec` of an
unwhitelisted star
spell; `exec` that
keeps running after a
codehash swap;
SubProxyMethods
`transfer` that drains
a SubProxy without
`wards`; assembler
`deploy` that keeps
DEFAULT_ADMIN on a
live PAU; agent
`call` without being
an actor.

Result: no user-exploitable
finding. Not submitted.

- StarGuard `plot` /
  `drop` / `file` /
  `rely` / `deny` are
  `auth`. `exec` is
  permissionless only
  after a plotted
  address, matching
  `codehash`,
  `deadline`, and
  `isExecutable()`.
  `spellData` is
  deleted before
  `subProxy.exec`.
  Afterwards
  `subProxy.wards(this)
  == 1` or the tx
  reverts. Cantina +
  ChainSecurity reports
  are in-repo. Trust
  model is PauseProxy
  wards + trusted
  spells.
- SubProxyMethods is a
  one-function
  `delegatecall` helper.
  Direct calls move
  tokens from the
  helper (empty). Via
  `SubProxy.exec` it
  moves SubProxy
  inventory; that path
  is ward-gated.
- `DefaultPAUAssembler.deploy`
  is permissionless
  factory wiring. It
  is temporary admin,
  grants caller-supplied
  admins, then revokes
  itself. It cannot
  touch an already-
  deployed stack.
- `AdministeredAgentFactory.deploy`
  is a create.
  `call` / `batchCall` /
  `sendValue` are
  `onlyActor`. Last
  admin cannot be
  removed. Actors are
  trusted allocators
  for a new stack.

Remaining Sky leftover
that this pass did not
open: `sky-oapp-oft`
after PAUFactory +
Kicker logged below.
Not submitted.

## 2026-09-03: Yearn Accountant leftover (Sourcify)

Immunefi program
`yearnfinance`
($200,000, `kyc: false`).
29 Oct 2025 leftover
Accountant
`0x5A74Cb32D36f2f517DB6f7b0A0591e09b22cDE69`
is **not** the already-
logged stYFI
TeamAccountant
`0x1c22…DFD6`.
Sourcify exact match
`Accountant.sol:Accountant`
(verified 2024-08-08).
Extract
`/tmp/yearn-accountant`.
No state-changing txs.

Files: Sourcify
`Accountant.sol`
(`report`,
`addVault` /
`removeVault`,
`redeemUnderlying`,
`distribute`,
config / role
handoff).

Checked for: a stranger
adding their vault and
pulling refunds; `report`
approving the caller
for the accountant’s
entire asset balance;
permissionless
`redeemUnderlying` /
`distribute`.

Result: no user-exploitable
finding. Not submitted.

- `addVault` /
  `removeVault` are
  `feeManager` or
  `vaultManager` (the
  modifier name
  `onlyVaultOrFeeManager`
  does **not** let a
  vault add itself).
- `report` is
  `onlyAddedVaults`.
  Refunds approve the
  reporting vault for
  `min(loss *
  refundRatio, idle
  asset)`. Shared-asset
  idle (fees from
  another vault) is
  trusted-vault
  inventory, not an
  external extract.
- `redeemUnderlying`
  is `onlyFeeManager`.
  `distribute` is
  `feeManager` or
  `feeRecipient` and
  always pays
  `feeRecipient`.
- Fee caps:
  management ≤ 2%,
  performance ≤ 50%.
  Health-check skips
  are one-shot and
  manager-set.

Remaining Yearn listed
leftover: 3.0.4
Tokenized Strategy
`0xD377…139c` and
3.0.4 Vault V3
`0xd806…00d` if a
later pass wants those
impls (Factory 3.0.4
is already logged).
Not submitted.

## 2026-09-03: StackingDAO cores + stBTC/STX reserve leftover (Hiro 13 Aug 2026)

Immunefi program
`stackingdao` ($100,000,
`kyc: false`, Primacy of
Impact on Critical/High).
Newest listed money path
(13 Aug 2026): Hiro
`SP4SZE…VDPBG`
`stacking-dao-core-stbtc-v1`,
`stacking-dao-core-stx-v2`,
`stacking-dao-core-ststxbtc-v2`,
plus `stbtc-token`,
`stbtc-reserve`,
`data-stbtc-v1`,
`stx-reserve-v2`,
`data-stx-v2`,
`withdraw-data-stbtc`,
`stbtc-withdraw-nft`.
Official repo
`StackingDAO/stackingdao-smart-contracts`
updated the same day.
Source pulled read-only
from Hiro
(`/tmp/stacking-dao`).
No mainnet interaction.

Checked for: first-depositor
inflation; share mint
without a pull; idle
withdraw that spends
reserved backing; NFT
withdraw that pays a
non-owner or a missing
ticket; ratio excluding
pending/escrow shares
incorrectly; stSTX vs
stSTXbtc reserve mix-up;
permissionless
`process-rewards`
skimming new deposits.

Result: no user-exploitable
finding. Not submitted.

- stBTC / stSTX deposit
  computes shares from
  the pre-pull ratio
  (`get-*-up` rounds
  against the depositor),
  then pulls the full
  asset and mints. First
  deposit seeds 1000 dead
  shares on the core.
- `init-withdraw` escrows
  shares on the core,
  records the NFT ticket,
  and increments the
  reserved counter (does
  not require idle cash).
  `withdraw` is NFT-owner
  + unlock-height gated,
  deletes the ticket,
  pays the stored user
  amount, then burns
  escrowed shares.
  Missing tickets default
  to a zero payout.
- `withdraw-idle` burns
  the caller's shares and
  pays only
  `idle - reserved`.
  Idle fee stays in the
  pool (stBTC/stSTX) or
  goes to treasury
  (stSTXbtc).
- Ratio uses
  `total - reserved`
  over `supply - pending
  (stBTC) / escrowed
  cores (stSTX)`.
  stSTXbtc is 1:1 and
  earmarked via
  `stx-for-ststxbtc-idle`;
  STX reserve pay/stack
  paths keep that bucket
  out of stSTX idle.
- Token mint/burn and
  reserve moves are
  `dao.check-is-protocol
  (contract-caller)`.
  NFT mint/burn too.
- `rewards-pox5-v1
  process-rewards` is
  called on deposit.
  The permissionless
  branch only streams
  already-queued sBTC
  into reserves.
  Commission on new
  inbound sBTC is
  keeper-only.

Remaining StackingDAO
was rewards-stx /
commission / strategy-v6
/ stakers; logged in the
strategy + rewards pass
below. Native-pool /
signer-managers if a
later pass wants those
admin wrappers. Not
submitted.

## 2026-09-03: Yearn 3.0.4 TokenizedStrategy + Vault V3 leftover (Sourcify)

Immunefi program
`yearnfinance` ($200,000,
`kyc: false`). Remaining
listed impls after
Factory 3.0.4 + V3.1.0 +
Accountant: 3.0.4
Tokenized Strategy
`0xD377919FA87120584B21279a491F82D5265A139c`
(Sourcify match,
`TokenizedStrategy`,
solc 0.8.18, verified
2024-11-01,
`API_VERSION` 3.0.4) and
3.0.4 Vault V3
`0xd8063123BBA3B480569244AE66BFE72B6c84b00d`
(Sourcify match,
`YearnV3Vault`, Vyper
0.3.7, verified
2025-01-14). Extract
`/tmp/yearn-304/{strat304,vault304}`.
These are implementation
singletons used via
clones; no
state-changing txs.

Files: flattened
`TokenizedStrategy.sol`
(`initialize`,
`deposit` / `mint` /
`withdraw` / `redeem`,
`_deposit` / `_withdraw`,
`report`, `tend`),
`YearnV3Vault.vy`
(`initialize`,
`_deposit` / `_redeem`,
`process_report`,
`_total_assets`).

Checked for: first-depositor
1-wei inflation plus a
raw donation (3.0.4 has
no `MINIMUM_SUPPLY`);
deposit that credits a
stranger or the vault;
redeem that pays
`msg.sender` instead of
`receiver`; keeper-less
`report` that unlocks
profit immediately;
`process_report(self)`
by a non-role.

Result: no user-exploitable
finding. Not submitted.
Listed Yearn leftover
impls are exhausted.

- Strategy `totalAssets`
  is a stored counter,
  not `balanceOf`. Empty
  supply mints 1:1;
  `totalSupply > 0` and
  `totalAssets == 0`
  mints 0. Donations
  sit idle until a
  keeper `report` /
  `harvestAndReport`;
  profit is locked as
  shares to the
  strategy and unlocked
  over
  `profitMaxUnlockTime`
  (default 10 days).
  `_deposit` pulls
  `msg.sender`, then
  `deployFunds` on the
  full loose balance,
  then `totalAssets +=
  assets` (deposited
  amount only), then
  mints to `receiver`.
  Cannot deposit to
  `address(this)`.
  `_withdraw` burns
  `owner` (allowance if
  sender ≠ owner) and
  pays `receiver`.
  `report` / `tend` are
  `onlyKeepers`.
  Performance fee ≤
  50%. `initialize` is
  one-shot (`asset ==
  0`).
- Vault
  `_total_assets` is
  `total_idle +
  total_debt`. Empty
  supply is 1:1;
  `total_assets == 0`
  with supply > 0
  mints 0. `_deposit`
  pulls `msg.sender`,
  increments idle,
  mints to `recipient`.
  `_max_deposit` is 0
  for `address(0)` and
  `self`. `_redeem`
  burns `owner` and
  pays `receiver`.
  Losses from the
  withdraw queue are
  capped by `max_loss`.
  `process_report` is
  `REPORTING_MANAGER`.
  Impl `__init__` sets
  `asset = self` so the
  singleton cannot be
  initialized. Factory
  3.0.4 `create2` +
  `initialize` is
  already logged.

Next leftover: Sky
`sky-oapp-oft`, TermMax
leftover adapters, Twyne
Sourcify-404 vaults, or
StackingDAO native-pool
/ signer-managers. Not
submitted.

## 2026-09-03: Sky PAUFactory + Kicker leftover (`fd5f09c` / `ed90ec2`)

Immunefi program `sky`
($10,000,000, `kyc:
false`). Remaining
listed Solidity after
StarGuard /
SubProxyMethods / PAU
assembler /
AdministeredAgent:
`PAUFactory.sol` (6 Jul
2026,
sky-ecosystem/diamond-pau
`dev` `fd5f09c`) and
`Kicker.sol` (19 Nov
2025, dss-flappers
`ed90ec2`). Official
raw GitHub. No mainnet
interaction.

Files:
`src/PAUFactory.sol`,
`src/Kicker.sol`.

Checked for: factory
`deploy*` that
re-points a live
controller / proxy /
rate-limit to a
stranger; permissionless
`flap` that `suck`s
beyond the surplus
threshold or pays the
caller.

Result: no user-exploitable
finding. Not submitted.

- PAUFactory stores an
  immutable `beacon`
  (non-zero). Every
  `deploy*` is a
  `new` of a fresh
  AccessControls /
  Controller / ALMProxy
  / ALMProxyFreezable /
  RateLimits. It cannot
  mutate an already-
  deployed PAU graph.
  Controller is wired
  with caller-supplied
  accessControls /
  proxy / rateLimits
  plus the factory
  beacon.
- Kicker `rely` /
  `deny` / `file` are
  `wards`. `flap` is
  permissionless only
  after
  `vat.dai(vow) >=
  vat.sin(vow) + kbump
  + khump`. It
  `vat.suck(vow, this,
  kbump)` then
  `splitter.kick(kbump,
  0)`. The kicker
  `hope`s the splitter
  in the constructor.
  No caller payout.

Remaining Sky listed
Solidity was
`sky-oapp-oft`; logged
in the OFT pass below.
Not submitted.

## 2026-09-03: StackingDAO strategy-v6 + stakers + rewards leftover (Hiro 13 Aug 2026)

Same Immunefi program
`stackingdao` ($100,000,
`kyc: false`). Remaining
admin / stacker path
after the cores: Hiro
`strategy-v6`,
`stx-staker-stacking-dao-v2`,
`stbtc-staker-bond-1-v2`,
`commission-sbtc-v1`,
`rewards-stx-v2`. Source
pulled read-only
(`/tmp/stacking-dao`).
No mainnet interaction.

Checked for: strategy
`perform-*` callable by
anyone; staker that
pulls reserve STX/sBTC
without protocol auth;
`return-*` that credits
a stranger; commission
skim that is not
protocol-gated;
permissionless
`process-rewards` that
folds new inbound STX
to a non-reserve sink.

Result: no user-exploitable
finding. Not submitted.

- `strategy-v6`
  `perform-*` require
  `contract-caller ==
  manager`. Bond /
  recall / rollover /
  stake / unstake also
  require an approved
  signer-manager.
  `initialize` /
  `set-manager` /
  `set-approved-signer-manager`
  are
  `dao.check-is-protocol`.
- STX / sBTC stakers
  are protocol-gated.
  They pull via reserve
  `request-*-to-stack`
  / `request-stx-for-staking`
  (reserved-aware) and
  return via
  `return-*-from-stacking`.
  PoX calls run
  `as-contract`.
- `commission-sbtc-v1
  add-commission` pulls
  from `tx-sender` and
  is protocol-gated.
  Default signer bps is
  10000 (all to
  `signer-payout-v1`).
  `withdraw-treasury`
  is protocol-gated.
- `rewards-stx-v2
  process-rewards` is
  permissionless only
  for already-queued
  streaming STX to
  `stx-reserve-v2`.
  Folding new inbound
  STX and `add-rewards`
  are keeper-only.

Remaining StackingDAO
was native-pool +
signer-managers /
signer-payout; logged
in the native-pool pass
below. Not submitted.

## 2026-09-03: Sky sky-oapp-oft leftover (`0baba10`)

Immunefi program `sky`
($10,000,000, `kyc:
false`). Last listed
Sky leftover after
PAUFactory / Kicker:
sky-ecosystem/sky-oapp-oft
`0baba10` (19 Nov 2025
assets). Listed files
`SkyOFTAdapter.sol`,
`GovernanceOAppSender.sol`,
`programs/oft/src/state/oft.rs`,
`programs/governance/src/state/governance.rs`.
Also read the money
path around those:
`SkyOFTCore` /
`SkyRateLimiter` /
`SkyOFTAdapterMintBurn`
/ `GovernanceOAppReceiver`,
Solana `send` /
`lz_receive` /
`withdraw_fee`. Official
raw GitHub
(`/tmp/sky-oapp`). No
mainnet interaction.

Checked for: adapter
`_credit` that unlocks
more than was locked;
fee withdraw that
pulls TVL; mint-burn
`_debit` that burns
less than it credits
remotely; inbound
without an LZ peer;
Solana withdraw that
ignores `tvl_ld`;
governance `_lzReceive`
that executes for a
non-peer.

Result: no user-exploitable
finding. Not submitted.
Listed Sky leftover
Solidity / Solana OFT
is exhausted.

- Adapter `_debit`
  pulls `amountSentLD`
  from `_from`, rate-
  limits
  `amountReceivedLD`,
  and parks the fee in
  `feeBalance`.
  `_credit` is
  `whenNotPaused`,
  inbound-limited, and
  unlocks exactly
  `_amountLD`. Zero /
  token recipients go
  to `0xdead`.
  `withdrawFees` and
  `migrateLockedTokens`
  are `onlyOwner` and
  exclude
  `feeBalance` from
  migration.
- Mint-burn adapter
  burns `amountSentLD`
  and mints the fee to
  itself; `_credit`
  mints to the
  recipient. Fee
  withdraw is owner
  rescue of the
  adapter balance.
- Unset rate-limit
  windows have
  `limit == 0` so
  `_calculateDecay`
  returns 0 capacity
  (fail-closed).
- Governance sender
  `sendTx` requires
  `canCallTarget`
  (`onlyOwner` set).
  Receiver
  `_lzReceive` is
  peer-gated by
  OAppCore and does
  a raw call to the
  decoded target;
  targets must check
  `messageOrigin`.
- Solana Adapter send
  escrows
  `amount_sent_ld` and
  increments `tvl_ld`
  by `amount_received_ld`.
  Receive requires
  `peer.peer_address ==
  params.sender`,
  clears via the
  endpoint, then
  unlocks / mints
  `sd2ld(amount_sd)`.
  `withdraw_fee` is
  admin and requires
  `escrow.amount -
  tvl_ld >= fee_ld`.

Next leftover:
Sky L1/L2 governance
relays + TermMax leftover
adapters (logged below),
or Twyne Sourcify-404
vaults. Not submitted.

## 2026-09-03: StackingDAO native-pool + signer leftover (Hiro 13 Aug 2026)

Same Immunefi program
`stackingdao` ($100,000,
`kyc: false`). Remaining
wrappers after
strategy-v6 / stakers /
rewards: Hiro
`native-pool-v1`,
`native-pool-signer-manager`,
`signer-manager-stacking-dao-v1`,
`signer-manager-bond-1-v1`,
`signer-payout-v1`,
`signer-admin-v1`.
Source pulled read-only
(`/tmp/stacking-dao`).
No mainnet interaction.

Checked for: native-pool
delegate that stakes a
stranger's STX; signer
`validate-stake!` that
accepts any staker;
`claim-rewards` that
pays the caller;
payout `distribute`
that is not keeper-
gated; admin bootstrap
that seizes a manager
before the DAO wires
it.

Result: no user-exploitable
finding. Not submitted.
Listed StackingDAO
Clarity leftover is
exhausted.

- `native-pool-v1
  delegate` /
  `delegate-update` /
  `undelegate` use
  `tx-sender` and the
  protocol-set
  `native-pool-sm`.
  The `delegating`
  flag is set only
  around the user's
  own PoX call.
- Native-pool signer
  `validate-stake!`
  requires
  `is-delegating
  (staker, this)`.
  `claim-staker-rewards`
  pays `tx-sender`.
- Protocol signer-
  managers
  `validate-stake!`
  against an admin
  allowlist.
  `claim-rewards`
  forwards sBTC to
  the admin-set
  recipient, not the
  caller.
- `signer-admin-v1
  set-admin` is
  `dao.check-is-protocol`
  with no self-
  bootstrap.
- `signer-payout-v1
  distribute` is
  keeper-only.
  `withdraw-residual`
  is protocol-gated.

## 2026-09-03: Sky L1/L2 governance relay leftover (`ff964bb` / `82918f4`)

Immunefi program `sky`
($10,000,000, `kyc:
false`). Remaining
listed relays after
sky-oapp-oft:
sky-ecosystem/lz-governance-relay
`master` `ff964bb`
and
sky-ecosystem/op-token-bridge
`master` `82918f4`.
Local clones
`/tmp/lz-gov-relay` and
`/tmp/op-token-bridge`.
No mainnet interaction.

Files:
`lz-governance-relay/src/{L1,L2}GovernanceRelay.sol`,
`op-token-bridge/src/{L1,L2}GovernanceRelay.sol`.

Checked for:
permissionless `relay`
that executes a stranger
spell; L2 `file` that
re-points the OApp /
L1 sender; OP messenger
spoof (`xDomainMessageSender`
unchecked).

Result: no user-exploitable
finding. Not submitted.

- LZ L1 `relayEVM` /
  `relayRaw` /
  `reclaim*` are
  `wards`. The payload
  is
  `L2GovernanceRelay.relay(target,
  targetData)` via the
  already-reviewed
  GovernanceOAppSender
  (src sender must be
  allowlisted per
  dst target).
- LZ L2 `relay` is
  `messageAuth`:
  `msg.sender == l2Oapp`,
  `srcEid == l1Eid`,
  `srcSender ==
  l1GovernanceRelay`.
  Execution is
  `delegatecall`.
  `file` requires
  `msg.sender ==
  address(this)` (only
  via that relay).
- OP L1 `relay` is
  `wards` and always
  targets the immutable
  `l2GovernanceRelay`
  through the immutable
  messenger. L2
  `onlyL1GovRelay`
  requires
  `msg.sender ==
  messenger` and
  `xDomainMessageSender
  == l1GovernanceRelay`.

Remaining Sky listed
relays are the older
Optimism / Arbitrum /
Starknet DAI-bridge
copies of the same
ward + messenger
pattern. Not
submitted.

## 2026-09-03: StackingDAO swap + rewards-pox5 leftover (Hiro 13 Aug 2026)

Same Immunefi program
`stackingdao` ($100,000,
`kyc: false`). Listed
wrappers the native-pool
pass did not open:
Hiro
`swap-ststx-ststxbtc-v4`,
`rewards-pox5-v1`,
`reward-split-calculator-v1`.
Source pulled read-only
(`/tmp/stackingdao`).
No mainnet interaction.

Checked for: swap that
mints stSTXbtc without
locking idle; harvest
of the already-logged
paper PPS bump after
pending stSTXbtc exit;
permissionless
`process-rewards` that
skims new inbound
sBTC.

Result: no user-exploitable
finding. Not submitted.
Listed StackingDAO
money-path leftover
that Hiro would open
is exhausted (tracking
/ withdraw NFTs were
reviewed with the
cores).

- Forward swap pulls
  stSTX, quotes
  `get-stx-per-ststx`
  (round down), burns,
  mints `value-v`
  stSTXbtc, and
  `lock-stx-for-ststxbtc`.
  Reverse uses
  `get-stx-per-ststx-up`
  so shares round
  against the swapper,
  then unlocks only
  when idle covers
  amount + reserved
  withdrawals.
  `get-stx-available`
  subtracts
  `stx-for-ststxbtc-idle`.
  After
  `init-withdraw` of
  stSTXbtc the quoted
  stSTX PPS can rise
  (circulating
  `get-stx-for-ststxbtc`
  drops) but available
  idle does not, so
  the inflated quote
  fails
  `ERR_INSUFFICIENT_IDLE`
  the same way
  `withdraw-idle` does.
- `rewards-pox5-v1
  process-rewards` is
  permissionless only
  for already-queued
  sBTC (split by
  protocol bps).
  Commission on new
  inbound sBTC and
  the fold are
  keeper-only.
  `reward-split-
  calculator-v1
  compute-and-apply`
  is protocol-gated.

## 2026-09-03: TermMax leftover swap adapters (`e314f3f`)

Same Immunefi program
`termstructurelabs`
($80,000, `kyc: false`).
Remaining V2 adapters
after the already-logged
1inch / LiFi / Odos /
UniV3 / Pendle /
TermMaxSwap set:
`KyberswapV2AdapterV2`,
`OkxSwapAdapter`,
`PancakeSmartAdapter`,
`KodiakSwapAdapter`,
`ERC4626VaultAdapterV2`,
`StrataVaultAdapter`,
`TerminalVaultAdapter`,
`OndoSwapAdapter`.
Local clone
`/tmp/termmax-v2` at
`e314f3f`. No mainnet
interaction.

Checked for: adapter
`swap` callable on the
implementation;
user calldata that
pays a third party
while returning a
fake `tokenOutAmt`;
vault redeem that
credits a stranger;
Ondo quote that
spends a different
asset than `tokenIn`.

Result: no user-exploitable
finding. Not submitted.
Listed TermMax leftover
adapters are exhausted.

- Parent
  `ERC20SwapAdapterV2.swap`
  is `onlyProxy`
  (`delegatecall` from
  the router). Markets
  / adapters stay on
  the already-logged
  whitelist.
- Kyber scales via
  the immutable helper
  then `functionCall`s
  the immutable router.
  OKX / Pancake /
  Kodiak measure or
  decode output on the
  router and revert on
  `LessThanMinTokenOut`
  / `InvalidTradeAmount`.
  A payload that pays
  a third party yields
  zero observed output.
- 4626 / Strata
  deposit to
  `recipient` and
  redeem from
  `address(this)`.
  Terminal instant
  paths leave output
  on the router and
  forward the balance
  (same intentional
  leftover-sweep as
  `useBalanceOnchain`).
- Ondo checks
  `quote.asset` against
  `tokenOut` (BUY) or
  `tokenIn` (SELL) and
  refunds unused input
  / USDon to the
  user-set
  `refundAddress`.

Next leftover: Sky
Optimism / Arbitrum /
Starknet DAI-bridge
relays (logged below),
Lombard EVM strategy
leftover (logged
below), or Twyne
Sourcify-404 vaults.
Not submitted.

## 2026-09-03: Sky Optimism / Arbitrum / Starknet DAI-bridge leftover

Immunefi program `sky`
($10,000,000, `kyc:
false`). Remaining
listed 2022 DAI-bridge
trees after LZ / OP
governance relays:
sky-ecosystem/optimism-dai-bridge
`master` `bc3d63f`,
arbitrum-dai-bridge
`master` `ba5e986`,
starknet-dai-bridge
`main` `380a6ed`.
Local clones
`/tmp/op-dai-bridge`,
`/tmp/arb-dai-bridge`,
`/tmp/sn-dai-bridge`.
No mainnet interaction.

Files: OP
`L1/L2GovernanceRelay`,
`L1Escrow`,
`L1/L2DAITokenBridge`;
Arb
`L1/L2GovernanceRelay`,
`L1Escrow`,
`L1/L2DaiGateway`;
Starknet
`L1DAIBridge`,
`L1Escrow`,
`L1EscrowMom`,
`L1GovernanceRelay`,
`l2_dai_bridge.cairo`,
`l2_governance_relay.cairo`.

Checked for:
permissionless L2
`relay` / mint;
withdrawal that unlocks
escrow without a burn;
escrow `approve` that
is not ward-gated;
Starknet
`consumeMessageFromL2`
that pays a stranger
who did not appear in
the L2 payload;
Arb router-decoded
`from` that burns a
non-caller without the
official router.

Result: no user-exploitable
finding. Not submitted.
Listed Sky leftover
that a public GitHub
tree would open is
exhausted (Twyne vaults
are still Sourcify 404).

- OP / Arb L1 relays
  are `wards`. L2
  `relay` is
  messenger + L1
  counterpart gated
  and `delegatecall`s
  a trusted spell.
  OP L2 also checks
  the messenger slot
  did not change.
- Escrows only
  `approve` under
  `wards`. Starknet
  `L1EscrowMom.refuse`
  can only set
  allowance to 0.
- OP deposit locks
  DAI in escrow and
  mints on L2 only
  via
  `onlyFromCrossDomainAccount`.
  L2 withdraw burns
  `msg.sender` then
  unlocks the same
  amount on L1.
  Closed bridges still
  finalize in-flight
  messages and reject
  new ones.
- Arb
  `outboundTransfer`
  sets `from =
  msg.sender` unless
  `msg.sender` is the
  immutable official
  router. Extra hook
  data is rejected.
  L2 burns `from` and
  L1
  `finalizeInboundTransfer`
  is
  `onlyL2Counterpart`.
- Starknet deposit
  pulls `msg.sender`
  into escrow under
  `maxDeposit` +
  ceiling. L2
  `handle_deposit`
  requires
  `from_address ==
  l1 bridge`.
  `initiate_withdraw`
  burns the L2 caller
  and posts
  `[0, l1_recipient,
  amount]`. L1
  `withdraw` consumes
  that payload with
  `msg.sender ==
  l1_recipient`, then
  may forward DAI to
  a caller-chosen
  address (same
  designated
  recipient).
  `cancelDeposit`
  rebuilds the
  original payload
  with `msg.sender`
  as the depositor.

Next leftover: Lombard
EVM strategy leftover
(logged below), Enzyme
`CreWorkflowConsumer`,
or Twyne Sourcify-404
vaults. Not submitted.

## 2026-09-03: Lombard EVM strategy shard leftover (`7fe83e5`)

Immunefi program
`lombard-finance`
($250,000, `kyc: true`).
15 Jul 2026 leftover
after the SVM tree:
`Shard.sol`,
`BlocklistOracle.sol`,
`MerkleAllowlistValidator.sol`,
and
`contracts/strategy/converters`
(listed live Ethereum
`0xDde9…2dFD` /
`0xc94B…da16` /
`0x5D84…6602` /
`0x6647…CDd3` /
`0xecc0…A777`).
Official clone
`/tmp/lombard-evm` at
`7fe83e5`. No mainnet
interaction.

Files as named plus
`ShardBaseUpgradeable.sol`
and
`ChainlinkConverter` /
`ChainlinkCompositeConverter`
/ `DirectConverter`.

Checked for: `exec`
that skips the
allowlist; merkle
`validatorArgs` that
forges a leaf; privileged
`exec` callable by
anyone; `pullFromStrategy`
without the transfer
role; blocklist `check`
that an allowlisted
sanctioned address
bypasses; converter
that uses a stale or
pre-downtime answer.

Result: no user-exploitable
finding. Not submitted.

- `Shard.initialize` is
  one-shot
  (`initializer`) and
  `_disableInitializers`
  on the impl.
  `pullFromStrategy` /
  `pushToStrategy` are
  `SHARD_TRANSFER_ROLE`.
  `exec` is
  `nonReentrant`,
  rejects `to == this`,
  and requires
  `validator.isAllowed`.
  The 3-arg `exec` is
  `PRIVILEGED_EXECUTOR_ROLE`
  only. `setValidator`
  is
  `DEFAULT_ADMIN_ROLE`.
- Merkle validator
  fail-closes on a
  zero root. Leaves
  bind `LEAF_TYPE` +
  chainid +
  `address(this)`.
  Rules are packed and
  must be canonical
  (reserved flags 0,
  unused header fields
  0, exact length,
  strictly increasing
  constraint offsets,
  `expected ⊆ mask`).
  Dynamic-ABI
  constraint limits
  are documented
  in-source (policy
  authoring, not a
  user bypass).
- Blocklist `check`
  reverts on the
  manual list first,
  then external
  sanction lists.
  Allowlist skips
  sanctions only.
  `blockAccount` /
  `unblockAccount` /
  `allowAccount` /
  sanction-list add
  are role-gated.
- Converters are
  view. Chainlink
  rejects `answer <= 0`,
  future
  `updatedAt`,
  heartbeat staleness,
  sequencer-down, zero
  `startedAt`, grace
  period, and
  pre-recovery
  answers. Composite
  is one `mulDiv`.
  Direct is 1:1.

Next leftover: Enzyme
`CreWorkflowConsumer`
(logged below), Silo V3
vaults (logged below),
or Twyne Sourcify-404
vaults.
Not submitted.

## 2026-09-03: Enzyme Onyx CreWorkflowConsumer leftover (`7b48d24`)

Immunefi program
`enzyme-onyx` ($200,000,
`kyc: false`). 2 Jul /
24 Feb leftover
`CreWorkflowConsumer.sol`
after the ACE issuance
pass. Official clone
`/tmp/enzyme-onyx` at
`7b48d24` (same ACE
commit). In-repo
ChainSecurity QA notes
nonce / expiry and
deployment sequencing.
No mainnet interaction.

Files:
`src/components/automations/chainlink-cre/CreWorkflowConsumer.sol`,
`IReceiver.sol`. Adjacent:
`LimitedAccessLimitedCallForwarder.executeCalls`.

Checked for: `onReport`
from a non-Keystone
caller; metadata that
swaps workflow owner;
replay / skipped nonce;
permissionless `init`
that steals a live
forwarder role;
`setAllowedWorkflowId`
by a stranger.

Result: no user-exploitable
finding. Not submitted.

- `onReport` requires
  `msg.sender ==
  CHAINLINK_KEYSTONE_FORWARDER`
  (immutable).
  Metadata must match
  stored workflow id /
  name and immutable
  `ALLOWED_WORKFLOW_OWNER`.
  `expiresAt` is
  `block.timestamp <=`.
  Nonce must be
  `lastNonce + 1`;
  storage updates
  before
  `executeCalls`.
- `executeCalls` on
  the configured
  forwarder requires
  `isUser(consumer)`.
  A front-run `init`
  can point a
  not-yet-inited clone
  at a stranger
  forwarder (DoS of
  that instance until
  redeploy). It cannot
  become a user on the
  live protocol
  forwarder
  (`addUser` is
  `onlyAdminOrOwner`).
  In-repo QA already
  flags the
  sequencing.
- `init` is one-shot
  (`forwarder != 0`).
  `setAllowedWorkflowId`
  is
  `onlyAdminOrOwner`.

Next leftover: Silo V3
vaults (logged below) or
Twyne Sourcify-404
vaults.
Not submitted.

## 2026-09-03: Silo Finance V3 vaults (`31b98b3`)

Immunefi program `silofinance-v2` (Silo Finance v2 & v3,
$100,000, `kyc: true`). GitHub vault tree added 25 Mar
2026. Local clone `/tmp/silo-v3` at `31b98b3`. No
mainnet interaction.

Files: `silo-vaults/contracts/{SiloVault,PublicAllocator,
SiloVaultsFactory,IdleVault,IdleVaultsFactory}.sol`,
`libraries/{SiloVaultActionsLib,SiloVaultFactoryActionsLib}.sol`,
`incentives/VaultIncentivesModule.sol`.

Checked for: first-depositor inflation; lying market
`previewRedeem` that inflates share price then deflates;
`balanceTracker` that can be lowered without a real
withdraw; PublicAllocator flow-cap underflow / unsorted
duplicates; claiming-logic `delegatecall` without a
timelock; IdleVault deposit-to-stranger; factory init
that leaves the incentives module unbound.

Result: no user-exploitable finding.

- MetaMorpho-style allocator / curator / guardian /
  timelock. Caps require `market.asset() == vault.asset()`.
  Lowering a cap is instant; raising is timelocked.
  Market removal needs cap 0, no pending cap, and either
  zero market-share balance or `removableAt` elapsed.
- `DECIMALS_OFFSET = 6` plus `+1` virtual assets. IdleVault
  is the same offset and only `ONLY_DEPOSITOR` (the
  SiloVault) may mint/deposit (`maxDeposit(other) == 0`
  and receiver must match).
- `balanceTracker` only ratchets up when the market
  reports more (`_updateInternalBalanceForMarket`). It
  decreases only by the exact ERC20 delta received
  (`_checkAfterWithdraw`). A lying high report can raise
  `totalAssets()` (fee / share price) but that is
  curator-trusted market risk; the tracker then blocks
  further supply until a guardian `syncBalanceTracker`.
- Fresh deposits `forceApprove` the exact amount, then
  reset to 1 wei. `_priceManipulationCheck` reverts if
  `previewRedeem(gotShares) + threshold < assets`
  (default threshold `1e6`).
- PublicAllocator `reallocateTo` is permissionless but
  only if the vault set it as allocator. Withdrawals
  must be unique and address-sorted; `maxOut` /
  `maxIn` are `uint128` with
  `MAX_SETTABLE_FLOW_CAP = type(uint128).max / 2`.
  Fee is exact `msg.value`.
- Incentives claiming logics run via `delegatecall`
  from the vault. Owner-submitted logics are
  timelocked; curator-submitted logics skip the
  timelock only when a trusted factory (itself
  owner-timelocked) reports `createdInFactory`.
  Notification receivers are owner-only.
- Factory clones the incentives module, deploys
  `SiloVault` with that address, then
  `__VaultIncentivesModule_init` binds `vault`.

Not submitted. Remaining Silo listed Solidity: core
`Silo` / `SiloConfig` / `SiloFactory` / router /
leverage / kink IRM / incentives / hooks, plus
share tokens (core Actions logged below).

## 2026-09-03: Silo Finance V3 core Actions leftover (`31b98b3`)

Same Immunefi program `silofinance-v2`. Money path
after the vault pass: `silo-core/contracts/Silo.sol`
wrappers plus `lib/{Actions,SiloLendingLib,Views}.sol`.
Local clone `/tmp/silo-v3` at `31b98b3`. No mainnet
interaction.

Checked for: flash-loan reentrancy that borrows
against accounting liquidity after tokens left;
repay that burns more debt than it pulls; withdraw
that skips solvency when the deposit silo is the
collateral silo; `transitionCollateral` that mints
unbacked shares; `withdrawFees` that spends
protected assets; `callOnBehalfOfSilo` from a
non-hook.

Result: no user-exploitable finding.

- Deposit / withdraw / borrow / repay / transition
  take `siloConfig` reentrancy, accrue, then mutate.
  Borrow forbids an existing other-silo debt, sets
  the other silo as collateral, then
  `_checkLTVWithoutAccruingInterest`. Withdraw /
  transition check solvency when
  `depositConfig.silo == collateralConfig.silo`.
- `SiloLendingLib.borrow` sizes from stored
  `totalAssets[Debt]` and requires
  `borrowedAssets <= collateral - debt`. Transfer
  is live ERC20; a flash-loan callback that tries
  to borrow more than the leftover balance reverts
  on `safeTransfer`. Flash loan itself does not
  change accounting (intentional) and only lends
  `balance - protected`.
- Repay converts, clamps shares to the borrower's
  debt balance, requires `totalDebt >= assets`,
  burns then `transferFrom` (commented fee-on-
  transfer ignore). Anyone may repay anyone.
- Transition withdraws with `_asset == 0` (no
  transfer) and deposits the same `assets` onto
  the other share token. No extra tokens appear.
- `withdrawFees` subtracts protected from
  `balanceOf(this)` before paying DAO/deployer.
  Failed deployer transfer redirects to the DAO.
- `callOnBehalfOfSilo` is `OnlyHookReceiver`.
  Hook `delegatecall` is hook-admin trust.

Not submitted. Remaining Silo listed Solidity
is logged below.

## 2026-09-03: Silo Finance V3 config / router / leverage / hooks leftover (`31b98b3`)

Same Immunefi program `silofinance-v2`. Remaining
listed Solidity after vaults + Actions:
`SiloConfig`, `SiloFactory`, `SiloRouterV2` +
implementation, `LeverageRouter` +
`LeverageUsingSiloFlashloanWithGeneralSwap`,
`PartialLiquidation` / `PartialLiquidationExecLib`,
`SiloHookV1`/`V2`/`V3`, `ShareDebtToken`, plus a
skim of `DynamicKinkModel` and
`SiloIncentivesControllerCompatible`. Local clone
`/tmp/silo-v3` at `31b98b3`. No mainnet interaction.

Checked for: `setOtherSiloAsCollateralSilo` from a
non-silo; debt transfer that skips recipient
solvency; router `delegatecall` that spends a
stranger's leftover; leverage swap that keeps
flash-loaned tokens; liquidation that seizes
shares of a solvent user; V3 hook that still
liquidates.

Result: no user-exploitable finding.

- Config is immutable except
  `borrowerCollateralSilo`. Only a silo can
  `_setSiloAsCollateralSilo`. `onDebtTransfer` is
  `OnlyDebtShareToken`, forbids a second-silo
  debt, and copies the sender's collateral silo
  only when the recipient has none.
  `ShareDebtToken` transfers need a receive
  allowance and require the recipient solvent
  after (`transferWithChecks`).
- Factory clones + initializes both silos and
  share tokens, mints the fee NFT to `_deployer`.
  Fee caps are owner-set (max 50% DAO / 15%
  deployer / 30% liquidation).
- Router `multicall` is `nonReentrant` + pause and
  `delegatecall`s the implementation. Deposit /
  withdraw / borrow / repay always use
  `msg.sender` as owner. Leftover on the router
  is the caller's to sweep (`transferAll`); next
  user can take it (documented).
- Per-user leverage clone, `onlyRouter`. Open:
  flash debt → swap → deposit to borrower →
  borrow debt+fee to repay flash. Close: flash
  maxRepay → repayShares → redeem → swap must
  cover flash+fee; leftover goes to borrower.
  `GeneralSwapModule` is a separate contract;
  leverage transfers sell tokens in, never
  approves the module. User calldata that pays
  elsewhere yields `amountOut == 0` and reverts.
  `onFlashLoan` requires
  `msg.sender == _txFlashloanTarget`.
- Partial liquidation accrues, sizes via
  `liquidationPreview` (reverts `UserIsSolvent`),
  pulls debt from the caller, forwards share
  tokens with checks off, then `repay`. Empty
  collateral after seize reverts
  `NoCollateralToLiquidate`. V1/V2 `beforeAction`
  reverts; V3 `liquidationCall` is
  `NotSupported` (defaulting path is V2).
- IRM implementation is initializer-locked;
  `RCUR_CAP` is 1000% APR. Incentives gauge
  kill is owner-only.

Listed Silo V3 GitHub Solidity leftover is
exhausted. Next leftover: PancakeSwap
Infinity (logged below), Mux3 (logged
below), or Twyne Sourcify-404 vaults.
Not submitted.

## 2026-09-03: PancakeSwap Infinity leftover (`61cd131` / `8261f8d` / `33dbf5a`)

Immunefi program `pancakeswap` ($1,000,000,
`kyc: false`, not paused). Five GitHub SC
assets added 30 Oct 2025. This pass is the
Infinity trees only. Local clones:
`/tmp/pcs-infinity-core` `61cd131` (single
squash titled “Fix known issues (#263)”,
2 Sep 2026), `/tmp/pcs-infinity-periphery`
`8261f8d` (bin add-liquidity slippage
#95, 2 Sep 2026), `/tmp/pcs-infinity-ur`
`33dbf5a` (BytesLib.toLengthOffset bounds
#57, 22 Jul 2026). Hexens / OtterSec /
Zellic PDFs ship in-tree. No mainnet
interaction.

Immunefi known issues — do not refile:
1291 (UniversalRouter OnlyMintAllowed
bypass via INCREASE_FROM_DELTAS +
TAKE_PAIR), 1298 (CL
MINT_POSITION_FROM_DELTAS /
_increaseFromDeltas slippage; Uniswap
v4-periphery #517), 1493 (exact-output
partial fill). OFT issues go to
LayerZero. Website scope is only
pancakeswap.finance.

Files: core `Vault` / `VaultToken` /
`SettlementGuard` / `AppDeficit` /
`VaultReserve` / `ProtocolFees` /
`ProtocolFeeController` / `Hooks` /
`CLPoolManager` / `CLPool` / `CLHooks` /
`BinPoolManager` / `BinPool` /
`BinHooks` / `BinHelper`; periphery
`SlippageCheck` / `DeltaResolver` /
`SafeCallback` / `BaseActionsRouter` /
`InfinityRouter` / `CLPositionManager`
FROM_DELTAS / `BinPositionManager`
add/remove; UR `UniversalRouter` /
`Dispatcher` / `InfinitySwapRouter` /
`Payments` / `BytesLib` / `Lock`.

Checked for: lock that releases with an
unrepaid app reserve overdraft; hook
that takes another app’s physical
tokens via the shared vault pot;
`collectFee` vs floored reserves;
`sync` sandwich from a hook or token
callback; donate on empty liquidity;
first-bin share inflation;
`afterMint`/`afterBurn` hook delta
unbounded vs official routers;
BIN_ADD_LIQUIDITY_FROM_DELTAS without
amountMax / share min; UR
INFI_SWAP forwarding position-manager
actions; leftover TRANSFER of another
user’s tokens; BytesLib length/offset
OOB after #57.

Result: no user-exploitable finding
beyond the listed known issues.

- Vault `lock` requires zero unsettled
  settler deltas and `AppDeficit.count()
  == 0`. Mid-lock `_accountDeltaForApp`
  floors `reservesOfApp` at 0 and
  records a transient per-(app,
  currency) deficit (the #263 JIT-hook
  underflow fix). Cross-app deposit
  cannot repay another app’s deficit
  (in-repo `VaultAppDeficit` test).
  `take`/`mint`/`settle`/`clear`/`burn`
  are `isLocked`. `collectFee` is
  registered-app only, not locked, and
  underflows while a deficit has
  floored the reserve. `sync` is
  public; a hook that resets
  VaultReserve after a user transfer
  zeros the next `settle` and the lock
  reverts (`CurrencyNotSettled`). Same
  lock, whole tx reverts.
- CL donate reverts
  `NoLiquidityToReceiveFees`. Bin donate
  reverts on empty active bin and,
  separately, if
  `shareOfBin[active] <
  minBinShareForDonate` (default
  `2**128`, so donate is owner-gated).
- First bin mint locks `MINIMUM_SHARE`
  1e3 and reverts if the minter would
  receive 0. Burns round down. Last
  burn that leaves only the min share
  drops the bin from the tree; reserves
  for the lock stay.
- Swap hook specified-delta cannot flip
  exact-in/out
  (`HookDeltaExceedsSwapAmount`).
  Unspecified afterSwap delta is paid
  by the caller. `afterMint` /
  `afterBurn` / CL after-modify hook
  deltas are unbounded — users opt
  into the hook. Official
  BinPositionManager now
  `validateMaxIn` plus per-bin
  `minLiquidities` (#95). CL
  FROM_DELTAS still uses
  `validateMaxIn` on principal only
  (known issue 1298).
- UR `INFI_SWAP` calls
  `InfinityRouter._executeActions`.
  That router only handles CL/Bin
  swaps and SETTLE/TAKE — not
  position-manager mint/increase. No
  `OnlyMintAllowed` command remains
  in `33dbf5a`. `TRANSFER` / `SWEEP`
  move the router’s own balance;
  leftover from a caller who skipped
  SWEEP is the next caller’s
  (same Uniswap UR pattern).
  `toLengthOffset` reverts if
  `32*length + relativeOffset`
  exceeds the input. Self-reentrancy
  via `EXECUTE_SUB_PLAN` is allowed;
  external reentrancy is not.
- Protocol fee is subtracted from bin
  / CL step input before reserves
  update and is collected from app
  reserves later. Controller is
  owner-set; `protocolFeeForPool`
  caps each direction at 0.4%.

Not submitted. Remaining Pancake listed
Solidity: `pancake-v3-contracts` and
`pancake-swap-periphery` (older V3/V2
trees added the same day). Next leftover:
Mux3 (logged below) or Twyne
Sourcify-404 vaults.

## 2026-09-03: Mux3 core trade + pool + orderbook (`8674f2b`)

Immunefi program `mux` ($100,000, `kyc:
false`). mux3-protocol tree added 17 Mar
2025. Local clone `/tmp/mux3` at
`8674f2b`. No mainnet interaction.

Files: `core/trade/{FacetPositionAccount,
FacetOpen,FacetClose,PositionAccount}.sol`,
`orderbook/OrderBook.sol`,
`libraries/{LibOrderBook2,LibCodec}.sol`,
`pool/CollateralPool.sol` (add/remove/
rebalance), `peripherals/Swapper.sol`
(`swapAndTransfer`).

Checked for: deposit into a stranger's
positionId; withdraw that skips MM after
fees; liquidate of a solvent account;
LP remove that spends reserved collateral;
swapper that keeps tokens on failure;
broker-less fill.

Result: no user-exploitable finding.

- PositionId encodes `address || index`.
  OrderBook deposit / withdraw / modify
  require `decode(positionId) == msg.sender`
  unless `DELEGATOR`. Fills, liquidate,
  ADL, and rebalance-fill are
  `BROKER_ROLE`. Core trade facets are
  `ORDER_BOOK_ROLE`.
- Deposit: OrderBook pulls tokens to the
  facet, then `_depositToAccount` credits
  wad. Sub-1e18 amounts on tokens with
  decimals > 18 credit 0 (dust donation
  to the core, user self-grief).
- Withdraw deducts wad, sends raw to
  Swapper. Failed / skipped swap transfers
  `tokenIn` to `positionAccount.owner`.
  Partial withdraw then requires leverage
  and IM safe. `withdrawAll` requires
  `activeMarkets.length == 0`.
- Open/close size must be a lot multiple.
  Fees come from collateral. Close
  realizes capped PnL then requires MM
  safe. Liquidate gathers all markets,
  requires MM unsafe including pending
  borrowing, closes profits then losses.
- Reallocate is broker-only; `toPool`
  `reservedUsd <= collateralUsd`.
- LP add/remove `onlyOrderBook`. Shares =
  `(amount - fee) * price / nav`. Remove
  burns shares held by the pool and
  refuses if new collateral USD <
  reserved. Rebalance sends token0 then
  expects collateral back under slippage.
- Swap paths are admin `SET_ROUTE_ROLE`.
  `receive()` only accepts WETH.

Not submitted. Remaining Mux: mux-protocol
core/orderbook (Aug 2025 leftover),
aggregator proxyFactory / gmxV2
(logged below), mux-degen,
mux-staking.

## 2026-09-03: Obyte Coop AA leftover (`d7d5e57`)

Immunefi program `obyte`
($50,000, `kyc: false`).
22 Jun 2026 leftover
`byteball/coop-aa`
(Autonomous Agent for
Obyte Coop). Official
clone `/tmp/obyte-coop-aa`
at `d7d5e57` (“fix
total_votes_bal
accounting after
partial withdrawal” —
the whole tree, not a
follow-up delta). Custom
OOS: fund-loss under
$1,000; attacker expense
≥ 50% of damage. No
mainnet interaction.

Files: `coop.oscript`
(deposit, withdraw, claim,
vote, replace, `update_user`
emission index,
`check_attestation`) and
`governance.oscript`
(`commit` / vote / unvote /
`update_user_balance`).

Checked for: withdraw that
leaves `total_votes_bal`
high so later emissions
overpay; claim that mints
without a liquid accrual;
deposit referral that
credits a stranger; vote
that adds strength without
a 1-year lock; governance
`commit` before the
challenge window;
`update_user` skipped on
withdraw that lets an
exited voter steal
principal.

Result: no
user-exploitable finding.
Not submitted.

- Deposit requires a
  messaging attestation
  and either a real-name
  attestation or
  `min_balance_instead_of_real_name`.
  AAs are refused. One
  messaging / real-name id
  per address. Unlock term
  is 365–3650 days and
  cannot move backward.
  `total_votes_bal +=
  amount * existing votes`
  so new deposits
  immediately scale prior
  votes.
- Referrer is first-deposit
  only, must already exist,
  and must unlock ≥ 1 year
  out. The deposit-share
  payment is
  issued-by-definer. The
  fixed `referral_reward`
  is state inflation
  capped by
  `min(referral_reward,
  user.total_balance,
  referrer.total_balance)`
  and added to both
  balances.
- Withdraw pays
  `min(balance, 4e15)`
  COOP plus all remaining
  bytes and stored
  `liquid_balance`. It
  subtracts
  `(total_balance -
  new_balance) * votes`
  from `total_votes_bal`
  (the named partial-
  withdraw fix). Votes
  persist until 90-day
  expiry (by design;
  exited voters can still
  accrue the vote-share of
  *new* emissions, not
  other users’ deposits).
  Withdraw does **not**
  call `$update_user`, so
  unaccrued locked
  emissions stay unminted
  (self-loss, not theft).
- Claim calls
  `$update_user` first,
  then mints stored
  `liquid_balance` and
  zeroes it. Restake folds
  the remainder into
  locked balance and
  `total_locked` and can
  extend unlock +1 year.
- Vote strength is 0–3;
  self-vote is
  `3 * sqrt(balance)`.
  Target and voter must
  unlock ≥ 1 year out.
  `delete_expired_votes`
  only removes votes past
  `$vote_lifetime`.
- Governance names are a
  fixed list. Daily
  locked/liquid rewards
  are capped at 0.1.
  `commit` requires the
  3-day
  `challenging_period`.
  Permissionless
  `update_user_balance`
  only rescales existing
  support to current
  `sqrt(total_balance)`.

Next leftover: remaining
Obyte `friend-aa` /
`prediction-markets-aa` /
`counterstake-bridge`, or
Mux `mux3-protocol`, or
Twyne Sourcify-404
vaults. Not submitted.

## 2026-09-03: Obyte Friends AA leftover (`45019f9`)

Immunefi program `obyte`
($50,000, `kyc: false`).
3 Mar 2026 leftover
`byteball/friend-aa`
(Autonomous Agent for
Obyte Friends). Official
clone `/tmp/obyte-friend-aa`
at `45019f9` (“higher
limit when resetting
votes”). Custom OOS:
fund-loss under $1,000;
attacker expense ≥ 50%
of damage. No mainnet
interaction.

Files: `friend.oscript`
(deposit, connect /
followup, withdraw,
replace, ghost admin),
`rewards.oscript` /
`rewards2.oscript`
(library-only getters),
`governance.oscript`.

Checked for: friendship
handshake that mints
against another user’s
principal; followup that
pays twice; deposit-asset
oracle that overvalues
and inflates rewards;
withdraw that leaves
`total_locked` high;
governance `commit` of a
malicious `rewards_aa`
without a challenge;
user2 always-eligible
path that drains the AA.

Result: no
user-exploitable finding.
Not submitted.

- Deposit requires
  messaging attestation
  plus real-name or
  `min_balance_instead_of_real_name`
  (default 5e9 FRD). AAs
  are refused. Term
  365–3650 days, cannot
  move backward. Max 3
  extra deposit assets.
  Referrer deposit-share
  is issued-by-definer
  and requires unlock ≥
  1 year.
- Connect is a two-sided
  handshake inside a
  10-minute window. One
  new friend per address
  per calendar day. Both
  unlock dates must be
  ≥ 1 year (ghosts
  excepted). Rewards are
  1% locked / 0.1%
  liquid of
  reducer-adjusted
  balance (`rewards2`
  doubles those shares).
  Non-new-user balances
  cap at 200e9. New-user
  and referral bonuses
  are
  `min(10e9, balances)`.
  Followups use the
  friendship’s frozen
  `followup_reward_share`
  (default 0.1) and a
  10-day claim window.
- `$are_eligible` treats
  user2 as eligible when
  `in_friend_price > 0`
  (commented: they will
  not complete if they
  do not want to pay).
  That is issuance
  policy, not a drain of
  other users’ deposits.
- Hardcoded `$ghost_admin`
  can add ghost accounts
  with 100e9 FRD **not**
  in `total_locked`
  (admin trust). Ghost
  connect resets the
  caller’s streak.
- Withdraw after unlock
  pays FRD, all bytes,
  and up to 3 deposit
  assets, then zeroes
  `balances`.
  `total_locked` only
  tracks FRD.
- Replace uses
  `ceiling_price` for
  bytes and
  `exchange_rates.max`
  for deposit assets
  (conservative out).
  Pool rates come from
  an oswap AA’s
  `recent.current/prev`
  pmin/pmax.
- Governance names are
  a fixed list.
  `rewards_aa` must be
  an AA. `commit` needs
  the 3-day
  `challenging_period`.
  Permissionless
  `update_user_balance`
  only rescales support.

Next leftover: remaining
Obyte
`prediction-markets-aa` /
`counterstake-bridge`, or
Mux leftover
(mux-protocol / aggregator
/ degen / staking), or
Twyne Sourcify-404
vaults. Not submitted.

## 2026-09-03: Obyte prediction-markets AA leftover (`1292a09`)

Immunefi program `obyte`
($50,000, `kyc: false`).
19 Aug 2025 leftover
`byteball/prediction-markets-aa`
(Prophet / prophet.ooo).
Official clone
`/tmp/obyte-prediction` at
`1292a09` (“solvency
checks”). Custom OOS:
fund-loss under $1,000;
attacker expense ≥ 50%
of damage. No mainnet
interaction.

Files: `agent.oscript`
(define / mint / redeem /
add_liquidity / commit /
claim_profit),
`aa-lib.oscript`
(library-only LMSR-style
math), `factory.oscript`.

Checked for: redeem that
pays more reserve than
the curve holds; claim
that pays losing tokens;
commit before
`event_date`; mint after
result; first-LP ratio
that inflates supply
above reserve; factory
that overwrites another
market’s params;
`to` that redirects a
stranger’s tokens.

Result: no
user-exploitable finding.
Not submitted.

- Market reserve is
  `coef * hypot(yes, no,
  draw)`. Issue / redeem
  fees and a 90% arb-profit
  tax stay in the reserve
  and raise `coef`. Soft
  bounce returns reserve
  on curve errors; sending
  outcome tokens on error
  hard-bounces so they
  come back.
- Trading is closed from
  `event_date -
  quiet_period` until
  `event_date +
  waiting_period` (default
  5 days). After a
  committed result, mint /
  redeem refuse (`result
  already exists`). After
  the wait with no
  result, trading
  reopens (by design).
- End-of-trade solvency:
  `new_reserve <=
  balance[reserve] -
  payout` and reserve
  growth cannot exceed
  the added reserve
  (the named solvency
  commit).
- `add_liquidity` mints
  pro-rata yes/no/draw.
  First LP sets weights
  via `sqrt(ratio)` so
  `hypot` equals the
  deposited reserve.
- `commit` is
  permissionless after
  `event_date` and reads
  the creator-chosen
  oracle feed. Draw wins
  only when the yes
  comparison is false
  and the feed equals
  `datafeed_draw_value`.
  Oracle choice is
  market-creator trust.
- `claim_profit` pays
  `floor(winner_amount /
  winner_supply *
  reserve)` and requires
  a positive winner
  amount. Losing tokens
  sent in the same unit
  are burned without
  payout (self-loss).
  Last winner gets the
  remaining reserve
  (`winner_amount ==
  supply`).
- Factory `chash160`s
  params so a duplicate
  market is refused.
  Asset definition is
  sequential via the
  factory bounce. Fees
  must be in `[0, 1)`.

Next leftover: remaining
Obyte Counterstake
(logged below), Mux
leftover (mux-protocol /
degen / staking;
aggregator logged
below), or Twyne
Sourcify-404 vaults.
Not submitted.

## 2026-09-03: Obyte Counterstake bridge leftover (`530fb8b`)

Immunefi program `obyte`
($50,000, `kyc: false`).
10 May 2022 leftover
`byteball/counterstake-bridge`
(Counterstake.org
Obyte↔EVM/BSC). Official
clone `/tmp/obyte-counterstake`
at `530fb8b`. Custom OOS:
fund-loss under $1,000;
attacker expense ≥ 50%
of damage. No mainnet
interaction.

This pass: EVM
`Counterstake` /
`CounterstakeLibrary` /
`Export` / `Import` and
Obyte `aas/export.oscript`
+ `aas/import.oscript`
claim / challenge /
withdraw. Remaining:
assistants, factories,
governance, `evm-v1.0`.

Checked for: double-claim
of the same transfer;
withdraw of a losing
stake; third-party claim
that spends other users’
locked reserve before
stake is posted; challenge
after expiry; Import mint
without a matching burn;
`withdraw(to)` that
redirects another
staker’s winnings.

Result: no
user-exploitable finding
beyond the documented
optimistic-verification
model (watchdogs must
challenge fraudulent
claims). Not submitted.

- Claim id is
  `sender_recipient_txid_txts_amount_reward_data`
  (underscores banned in
  sender/txid). Same
  underlying tx with a
  different reward is a
  new id — watchdogs
  challenge the unmatched
  one.
- `claim` is
  `nonReentrant`. Stake
  must cover
  `max(amount * ratio,
  min_stake)` (Export) or
  oracle*`ratio` floored
  by `min_price20`
  (Import). `txts +
  min_tx_age` must be in
  the past. Negative
  reward forbids
  third-party claiming.
- Third-party claim
  deposits
  `stake + (amount -
  reward)` then immediately
  pays the recipient the
  prepaid amount (assistant
  float). Net contract
  change is +stake. A
  successful withdraw then
  pays `amount` from the
  locked/minted pool.
- Challenge must flip the
  current outcome and
  meet
  `current * coef/100`
  (default 1.5x). Excess
  is refunded. Periods
  are ≥ 12h and
  non-decreasing.
- `finish` after expiry
  pays each winning
  staker
  `(yes+no) * my / win`.
  Only the claimant
  additionally receives
  `amount`, and only
  once (`withdrawn`).
  `withdraw(to)` looks up
  `to`’s stake and pays
  `to` (permissionless
  harvest, not theft).
- Import mints on
  successful claim /
  withdraw and burns on
  `transferToHomeChain`.
  Export locks on
  `transferToForeignChain`
  and unlocks on a
  winning repatriation
  claim.
- Obyte AAs use the same
  hash, stake, and
  period rules (periods
  in hours).

Next leftover: Counterstake
assistants / factories /
governance, or Mux
leftover (mux-protocol /
degen / staking;
aggregator logged
below), or Twyne
Sourcify-404 vaults.
Not submitted.

## 2026-09-03: Mux aggregator proxyFactory + GmxV2 leftover (`0f36131`)

Immunefi program `mux`
($100,000, `kyc: false`,
smart-contract rewards
are critical-only). Whole
`mux-aggregator-protocol`
repo listed 28 Aug 2024;
leftover folders
`contracts/proxyFactory`
and
`contracts/aggregators/gmxV2`
added 28 Aug 2025. Local
clone `/tmp/mux-agg` at
`0f36131` (“distribute
gmx2 ETH when not debt”).
In-repo README: keeper
never calls
`GmxV2Adapter.liquidate`
since Dec 2023; GMX1
adapter unsupported since
Mar 2025; GMX2 borrowing
disabled since Mar 2025.
Program OOS: `test` /
`oracle` / `reader`
folders; listed ConsenSys
/ OpenZeppelin /
Quantstamp audit issues.
No mainnet interaction.

Files:
`proxyFactory/{ProxyFactory,
DebtManager,ProxyBeacon,
Storage,ProxyConfig}.sol`,
`aggregators/gmxV2/{GmxV2Adapter,
libraries/{LibGmxV2,LibDebt,
LibSwap,LibConfig,LibUtils}}.sol`,
`lendingPool/LendingPool.sol`
(2024 whole-repo asset).

Checked for: factory
calldata that places a
mux / mux3 order for a
stranger; CREATE2 proxy
that binds a victim key;
borrow that skips the
created-proxy check;
GmxV2 callback that pays
the caller; swapPath that
drains another account;
lending-pool share
inflation; permissionless
liquidate of a solvent
account.

Result: no
user-exploitable
critical. Not submitted.

- Proxy id is
  `keccak(projectId,
  account, collateral,
  asset, isLong)`.
  `proxyFunctionCall2` /
  `transferToken2` /
  `muxFunctionCall` /
  `mux3PositionCall` /
  cancel require
  `msg.sender == account`
  or an owner-set
  `DELEGATOR`. mux3
  `positionId` owner is
  the high 160 bits
  (`address || uint96`,
  same as Mux3).
- Beacon `create2` writes
  `_proxyProjectIds[predicted]
  = projectId` before
  deploy so
  `implementation()`
  works during
  `initialize`. Salt
  includes the owner.
  `_isCreatedProxy` is
  `projectId != 0` (ids
  are 1 = GMX1, 2 =
  GMX2).
- `borrowAsset` /
  `repayAsset` require a
  created proxy and a
  matching projectId.
  Factory `totalDebt` is
  tracked, not raw ERC20
  on the factory.
- `_getLiquiditySource`
  writes
  `_liquiditySource[projectId]`
  but reads
  `_liquiditySource[sourceId]`.
  For live ids 1 and 2
  this coincides when
  `sourceId == projectId`
  (GMX2 + lending = 2).
  Do not file without a
  live project that sets
  `sourceId != projectId`
  and a proven fund path.
  GMX2 borrow is
  disabled.
- GmxV2 `placeOrder` is
  owner or factory.
  Callbacks accept keeper
  or GMX `CONTROLLER`.
  After a decrease fill,
  leftover adapter
  collateral refunds to
  `account.owner` if the
  GMX position is still
  IM-safe; if size is 0,
  debt is repaid from
  adapter balance (and
  the secondary token).
  Keeper-supplied
  liquidate prices are
  privileged (default
  OOS).
- UniV3 `swapPath` is
  user-chosen; `tokenIn`
  cannot be the position
  collateral. Tokens
  must already sit on
  that adapter.
- LendingPool `deposit`
  increments
  `supplyAmount` after
  the pull. Withdraw is
  owner. Borrow / repay
  are `onlyBorrower`.
  Donations that skip
  `deposit` do not
  inflate withdrawable
  supply.

Not submitted. Remaining
Mux: mux-protocol
`components` / `core` /
`governance` /
`libraries` / `orderbook`
(28 Aug 2025 leftover),
mux-degen (logged
below), mux-staking.
Aggregator
`aggregators/gmx` is the
unsupported GMX1
adapter.

## 2026-09-03: Obyte Counterstake assistants leftover (`530fb8b`)

Same Immunefi program
`obyte` and clone
`/tmp/obyte-counterstake`
at `530fb8b`. Remaining
listed Solidity / AAs
after the claim path:
EVM `ExportAssistant` /
`ImportAssistant` /
`AssistantFactory` /
`CounterstakeFactory` /
`Governance` /
`VotedValue`, plus Obyte
`aas/export-assistant.oscript`
(import-assistant AA is
the same LP + manager
pattern). `evm-v1.0` is
the prior deployment
tree, not re-reviewed.
No mainnet interaction.

Checked for: LP redeem
that spends
`balance_in_work`;
manager claim that
over-stakes past net
balance; `recordLoss` on
a winning claim;
`recordWin` that mints
unearned profit; Import
swap that drains the
in-work reserve;
factory re-init of a
live clone.

Result: no
user-exploitable finding
beyond manager-trust
(the assistant bot is
supposed to stake LP
funds). Not submitted.

- Both assistants are
  manager-gated for
  `claim` / `challenge`.
  Stake is capped by
  current net balance
  (gross − MF − success
  fee − network-fee
  reserve). Infinite
  approve is to the
  paired bridge only.
- Shares: first mint
  requires ≥ 1e6 units.
  Later mints use
  `balance^(1/exponent)`
  (1/2/4). Redeem pays
  only risk-free net
  (`net − unavailable
  profit −
  balance_in_work`) and
  charges `exit_fee`.
  Profit diffuses over
  10 days by default
  (governance-capped at
  365 days).
- `onReceivedFromClaim`
  is `onlyBridge`.
  `recordLoss` is
  permissionless after
  expiry and requires a
  losing stake and zero
  winning stake.
  `recordWin` rebuilds
  the missed payout;
  Export assumes a 1%
  claimant reward
  (documented
  accounting slack, not
  a drain).
- Import assistant is a
  two-asset CPMM. Swaps
  use risk-free balances
  and `min_amount_out`.
  Redeem also charges
  `swap_fee` so
  buy+redeem is not a
  free swap.
- Factories `Clones` +
  `init*` +
  `setupGovernance`.
  Init is once
  (`governance == 0` /
  `governedContract ==
  0`). Default challenge
  periods are 72h+.
- Governance: 10-day
  challenge + 30-day
  freeze before a vote
  can move. Withdraw
  requires untying every
  vote. `addVotedValue`
  is governed-contract
  only.

Listed Counterstake
GitHub leftover is
exhausted (`evm-v1.0` is
the old pin). Next
leftover: Mux leftover
(mux-protocol /
staking; degen logged
below), or Twyne
Sourcify-404 vaults.
Not submitted.

## 2026-09-03: Mux degen pool leftover (`c5bfe81`)

Immunefi program `mux`
($100,000, `kyc: false`,
smart-contract rewards
are critical-only).
`mux-degen-protocol`
listed 28 Aug 2024 (same
day as the aggregator
repo). Local clone
`/tmp/mux-degen` at
`c5bfe81` (“add
comment”). Program OOS:
`test` / `oracle` /
`reader`. No mainnet
interaction.

Files:
`facets/{Trade,Liquidity,
Account}.sol`,
`orderbook/OrderBook.sol`,
`libraries/{LibOrderBook,
LibPoolStorage,LibAsset,
LibSubAccount,
LibReferenceOracle}.sol`.

Checked for: deposit into
a stranger’s
`subAccountId`; first-LP
MLP inflation; remove
that spends reserved
spot; liquidate of a
solvent account;
broker-less fill.

Result: no
user-exploitable
critical. Not submitted.

- `subAccountId` is
  `account ||
  collateralId ||
  assetId || isLong`.
  Place / deposit /
  withdraw-all require
  `owner() == msg.sender`
  or an owner-set
  `DELEGATOR`. Fills,
  liquidate, ADL, and
  broker rebate are
  `BROKER_ROLE`. Pool
  facets are
  `onlyOrderBook`.
- Deposit: OrderBook
  `_transferIn` to the
  pool, then
  `depositCollateral`
  credits wad. Pool does
  not pull ERC20.
- First MLP mint uses
  nav `1e18`. AUM is
  tracked
  `spotLiquidity` ±
  capped trader PnL, not
  raw ERC20. `donate`
  increases spot without
  minting. Remove burns
  MLP held by the
  OrderBook and refuses
  if reservation USD >
  pool USD without PnL.
- Open/close size must
  be a lot multiple.
  Fees come from
  collateral. Close
  requires MM safe after
  the fill. Liquidate
  requires MM unsafe
  including pending
  funding (mark prices
  are broker-supplied,
  then Chainlink-
  truncated when a
  reference oracle is
  set).
- Funding is
  permissionless on the
  interval; traders pay
  LP, never each other.

Not submitted. Remaining
Mux: mux-protocol
folders (logged below)
and mux-staking.

## 2026-09-03: Mux protocol v1 core leftover (`0f70a70`)

Immunefi program `mux`
($100,000, `kyc: false`,
smart-contract rewards
are critical-only).
Listed leftover folders
added 28 Aug 2025:
`contracts/components`,
`core`, `governance`,
`libraries`,
`orderbook`. Local clone
`/tmp/mux-v1` at
`0f70a70` (“a better
protection to asset
price”). Program OOS:
`test` / `oracle` /
`reader`. No mainnet
interaction.

Files:
`core/{Trade,Liquidity,
Account,LiquidityPool}.sol`,
`orderbook/OrderBook.sol`,
`libraries/{LibOrderBook,
LibAsset,LibSubAccount,
LibReferenceOracle}.sol`,
`components/NativeUnwrapper.sol`,
`governance/{Vault,POL,
MuxTimelock}.sol`.

Checked for: aggregator
or owner bypass that
places a stranger’s
order; MLP add that
mints against a
broker-chosen zero nav;
remove that over-pays
spot; liquidate of a
solvent account;
unwrapper that sends ETH
to the caller.

Result: no
user-exploitable
critical. Not submitted.

- `placePositionOrder3`
  and `depositCollateral`
  require
  `getSubAccountOwner ==
  msg.sender` unless
  `aggregators[msg.sender]`
  (owner-set, the Mux
  aggregator factory).
  Fills / liquidate /
  rebate are
  `onlyBroker`. Pool
  hops are
  `onlyOrderBook`.
- Deposit: OrderBook
  `_transferIn` from the
  owner to the pool,
  then credits wad.
- Add liquidity
  transfers pre-minted
  MLP from the pool at a
  broker `mlpPrice`
  clamped to
  `mlpPriceLowerBound` /
  `UpperBound`. Token
  price is
  Chainlink-truncated
  with bid/ask spread.
  Spot is tracked
  `spotLiquidity`, not
  raw ERC20. Remove
  refuses
  `wad > spotLiquidity`.
- Open requires IM safe.
  Close requires MM
  safe. Liquidate
  requires MM unsafe
  including funding.
- `NativeUnwrapper.unwrap`
  is whitelist-only
  (the pool). Failed ETH
  send re-wraps WETH to
  the trader.
- Vault / POL transfers
  are `onlyOwner`.
  Timelock is standard
  OZ-style.

Not submitted. Remaining
Mux listed Solidity:
`mux-staking` only
(GitHub 404 as of 3 Sep
2026; cannot open).

## 2026-09-03: Threshold tBTC BOB cross-chain leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Unique GitHub leftover
added 24 Oct 2025:
`threshold-network/tbtc-v2`
`cross-chain/bob/contracts`.
Local clone `/tmp/tbtc-v2`
at `502cd39`. Do not
refile known issues 1308
(rebate timestamp), 1494
(closeable wallets),
1320 (relayer
reimbursement), 1496
(cross-chain redemption
timeout), 1426 (Sui
minter cap), 1410
(TOB-TBTCACEXT-30).
No mainnet interaction.

Files:
`TokenPoolUpgradeable.sol`,
`BurnFromMintTokenPoolUpgradeable.sol`,
`LockReleaseTokenPoolUpgradeable.sol`,
`canonical/L2TBTC.sol`,
`OptimismMintableUpgradableTBTC.sol`,
`libraries/RateLimiter.sol`,
`Timelock.sol`.

Checked for: permissionless
mint on L2; CCIP
`releaseOrMint` that
skips the source-pool
check; lock that does
not require an onRamp;
decimal scale that mints
more than burned;
legacy OP-bridge burn
of CCIP-minted supply;
rebalancer drain by a
stranger.

Result: no
user-exploitable
finding. Not submitted.

- Pool `lockOrBurn` /
  `releaseOrMint` require
  the CCIP router onRamp
  / offRamp for that
  chain, a configured
  remote pool, and an
  uncursed RMN. Inbound
  / outbound token-
  bucket rate limits
  apply when enabled.
- Burn-mint burns from
  the pool after the
  ramp has already
  transferred in.
  Lock-release only
  emits `Locked` (same
  CCIP pattern) and
  releases from tracked
  pool balance.
- `_calculateLocalAmount`
  rounds down when the
  dest has fewer
  decimals and reverts
  on overflow. Empty
  `sourcePoolData` falls
  back to local decimals
  (documented
  backwards-compat).
- `L2TBTC.mint` is
  owner-listed minters
  only. Guardians pause
  mint/burn. `recover*`
  is owner.
- OP-mintable v2
  `legacyCapRemaining`
  starts at
  `totalSupply`. Bridge
  mints increase it;
  other minters do not.
  While the cap is > 0,
  only `BRIDGE` can
  `burnFrom` / legacy
  `burn(from, amount)`,
  so the OP bridge
  cannot burn
  CCIP-minted tokens.
- Lock-release
  `withdrawLiquidity` is
  the owner-set
  rebalancer. Timelock
  is OZ
  `TimelockController`
  with admin `address(0)`.

Not submitted. Remaining
Threshold listed assets
are explorer addresses
plus
`keep-network/tbtc-v2`
`typescript` (not a
Solidity money path).
Next leftover: Pancake
V3 MasterChef / LmPool
+ V2 periphery (logged
below), remaining V3
core / NPM fork, or
Twyne Sourcify-404
vaults.
## 2026-09-03: Pancake V3 MasterChef/LmPool + V2 periphery (`9868479` / `d769a6d`)

Immunefi program
`pancakeswap`. Listed
leftover after Infinity:
`pancake-v3-contracts`
and
`pancake-swap-periphery`.
Local clones
`/tmp/pancake-v3` at
`9868479` (“chore:
Remove router”) and
`/tmp/pancake-periphery`
at `d769a6d`. Local
static read of
`projects/masterchef-v3/contracts/MasterChefV3.sol`,
`projects/v3-lm-pool/contracts/PancakeV3LmPool.sol`,
`PancakeRouter.sol`,
`PancakeLibrary.sol`.
No mainnet interaction.

No finding.

MasterChefV3 holds the
V3 NFT. `onERC721Received`
requires a listed pid
and a live LM pool.
Harvest / withdraw /
decrease / collect
require
`positionInfo.user ==
msg.sender`. Permissionless
`updateLiquidity` only
accrues rewards to the
position (`_to == 0`)
and resyncs LM ticks
from the NFT.
`increaseLiquidity` is
also unscoped on owner
(anyone may gift tokens
into a staked NFT).
Boost is clamped to
`[1x, 2x]`. LM pool
`accumulateReward` /
`updatePosition` are
pool-or-MC only.
`crossLmTick` is
pool-only. V2 router is
the UniV2 pattern with
Pancake 0.2% fee
(`998/1000`) and a
CREATE2 init-code hash;
deadline + amountMin
protect swaps. `sweepToken`
/ `unwrapWETH9` are the
usual leftover-balance
helpers; CAKE sweep
subtracts
`cakeAmountBelongToMC`.
Keeper V2
`performUpkeep` is
`onlyRegister`.
Emergency flag is
owner-only and skips
LM updates so users
can still withdraw
the NFT. Do not
refile Infinity known
issues 1291 / 1298 /
1493.

Not submitted. Remaining
Pancake listed Solidity:
v3-core pool/factory
and v3-periphery NPM
(same `9868479` tree;
logged below).

## 2026-09-03: Pancake V3 core pool/factory + v3-periphery leftover (`9868479`)

Immunefi program `pancakeswap`
($1,000,000, `kyc: false`).
MasterChef / LmPool + V2
periphery leftover is already
logged. Remaining listed
Solidity on the same pin:
v3-core pool / factory and
v3-periphery (SwapRouter
removed in `9868479`). Local
clone `/tmp/pcs-v3` at
`9868479`. No mainnet
interaction. Infinity known
issues 1291 / 1298 / 1493
do not apply here.

Files:
`projects/v3-core/contracts/PancakeV3Pool.sol`,
`PancakeV3Factory.sol`,
`projects/v3-periphery/contracts/NonfungiblePositionManager.sol`,
`base/PeripheryPayments.sol`.

Checked for: stranger collect
of an NFT; protocol-fee siphon
via factory; leftover ETH /
token sweep of user funds;
LM attach that steals swap
fees.

Result: no
user-exploitable
critical. Not submitted.

- Pool is Uniswap V3 plus
  protocol fee
  (`feeAmount * feeProtocol /
  PROTOCOL_FEE_DENOMINATOR`)
  and `lmPool.accumulateReward`
  / `crossLmTick` on swap.
  `setLmPool` /
  `setFeeProtocol` /
  `collectProtocol` are
  `onlyFactoryOrFactoryOwner`.
  `collectProtocol` leaves
  1 wei in the slot.
- Factory
  `setFeeProtocol` /
  `collectProtocol` are
  `onlyOwner`. `setLmPool`
  is `onlyOwnerOrLmPoolDeployer`.
- NFT manager
  `decreaseLiquidity` /
  `collect` / `burn` use
  `isAuthorizedForToken`.
  `increaseLiquidity` is
  unscoped (gift into any
  position — self-loss, not
  theft). Periphery
  `unwrapWETH9` /
  `sweepToken` /
  `refundETH` are the usual
  leftover-balance helpers;
  `receive` is WETH-only.

Not submitted. Listed
Pancake GitHub leftover
is exhausted (Infinity +
MasterChef / LmPool + V2
+ v3-core + v3-periphery).

## 2026-09-03: Obyte City AA leftover (`4a0a53f`)

Immunefi program `obyte`
($50,000, `kyc: false`).
19 Aug 2025 leftover
`byteball/city-aa`
(Autonomous Agent for
Obyte City). Local clone
`/tmp/obyte-city-aa` at
`4a0a53f` (“renounce
replicator”). Custom OOS:
fund-loss under $1,000;
attacker expense ≥ 50% of
damage. No mainnet
interaction.

Files: `city.oscript`,
`city-lib.oscript`,
`governance.oscript`,
`random.oscript`.

Checked for: leave that
refunds a stranger’s plot;
p2p buy that underpays
the seller; build that
self-matches after a
transfer; followup that
credits a third party;
replicator drain after
renounce; governance
`commit` before the
challenge window.

Result: no
user-exploitable
finding. Not submitted.

- Buy requires attestation
  and exact
  `plot_price * (1+buy_fee)`.
  `buy_from_balance` spends
  the caller’s followup
  `balance_`. Mayor plots
  are amount-0 and become
  mayor houses.
- Leave / sell / transfer /
  rent / edit are
  owner-gated. P2P buy
  pays `sale_price - fee`
  to the old owner.
  Transfer after matching
  is refused (later plot
  any transfer; earlier
  plot if after plot2.ts).
  Rental expansion after
  plot2.ts is refused.
- Build is a two-sided
  10-minute handshake.
  Reward mints four new
  plots of
  `min(plot1, plot2)`
  (designed inflation;
  houses cannot be left).
- Followup is the same
  handshake; reward is
  frozen at first request
  (`followup_reward_share *
  house1.amount`) and
  credited to both house
  owners’ internal
  balances.
- Replicator
  (`GAFNBCPR…`) can copy
  vars and restore
  outputs until
  `renounce`. After
  `$constants.renounced`,
  `$is_replicator_request`
  is false.
- Governance names are a
  fixed list; `commit`
  needs a 3-day challenge.
  New city needs 75% of
  `total_land`. Randomness
  allocation is
  `randomness_aa`-only.

Not submitted. Remaining
Obyte listed AAs:
`perpetual-aa` (logged
below), `oswap-token-aa`,
`token-registry-aa`,
`obyte-cascading-donations`.

## 2026-09-03: Obyte perpetual AA leftover (`126cdd0`)

Immunefi program `obyte`
($50,000, `kyc: false`).
19 Aug 2025 leftover
`byteball/perpetual-aa`
(Pythagorean perpetual
futures). Local clone
`/tmp/obyte-perpetual-aa`
at `126cdd0` (“require VP
to vote and check leader
before committing”).
Custom OOS: fund-loss
under $1,000; attacker
expense ≥ 50% of damage.
No mainnet interaction.

Files: `perpetual.oscript`,
`factory.oscript`,
`staking.oscript`,
`staking-lib.oscript`,
`price.oscript`.

Checked for: redeem that
pays more reserve than the
invariant; presale withdraw
of a stranger’s
contribution; staking AA
that drains
`total_staker_fees`; claim
that mints above the
launched supply; hop that
forwards into staking.

Result: no
user-exploitable
finding. Not submitted.

- Trade is the Pythagorean
  invariant
  `r'^2 - r^2 =
  a c^2 (s'^2 - s^2) *
  (1 - fee)`. Sell payout
  is `r - new_r_gross`
  (fees stay in reserve /
  staker pot). Buy mints
  `floor` tokens after
  arb-profit tax. Same
  `initial_address` can
  merge trades within 1s
  (designed).
- Presale add/withdraw is
  per-address
  `contribution_`. Claim
  after launch mints
  `floor(contribution /
  initial_price)` and
  clears the slot.
- `withdraw_staker_fees` on
  the perp AA is
  staking-AA-only and
  decrements
  `total_staker_fees`.
  Staking pays
  `floor(user rewards.r)`
  after
  `distribute_emissions`.
  Unstake is after expiry
  and requires a full
  asset0 exit.
- Parameter / asset adds
  come only from staking
  governance (fixed name
  list; 5-day default
  challenge). Factory
  clamps swap_fee /
  min_s0_share < 1.
- Hops refuse
  `address == staking_aa`.
  Price AAs are
  governance-set (oracle
  trust, not a theft
  path).

Not submitted. Remaining
Obyte listed AAs:
`oswap-token-aa` (logged
below), `token-registry-aa`,
`obyte-cascading-donations`.

## 2026-09-03: Obyte OSWAP token AA leftover (`461e860`)

Immunefi program `obyte`
($50,000, `kyc: false`).
19 Aug 2025 leftover
`byteball/oswap-token-aa`
(OSWAP token). Local clone
`/tmp/obyte-oswap-token-aa`
at `461e860`
(“replication”). Custom
OOS: fund-loss under
$1,000; attacker expense
≥ 50% of damage. No
mainnet interaction.

Files: `oswap.oscript`,
`oswap-lib.oscript`,
`initial-sale-pool.oscript`.

Checked for: redeem that
pays more reserve than the
invariant; unstake of a
stranger’s stake; LP
withdraw of another
address’s tokens; reward
claim that double-mints
emissions; replicator
drain after renounce.

Result: no
user-exploitable
finding. Not submitted.

- Trade is the same
  Pythagorean curve as
  perpetual (swap fee +
  arb-profit tax).
  Appreciation uses a TVL
  data-feed oracle
  (oracle trust).
- Stake is
  term-locked (≥14 days).
  Unstake after expiry
  pays the caller’s
  `user.balance` and
  forfeits unclaimed
  rewards. Staking rewards
  are `floor(user.reward)`
  after
  `distribute_stakers_emissions`.
- LP withdraw is capped
  at the caller’s recorded
  balance. A third party
  can pass `for` to update
  another LP’s accrual
  without paying them
  (anti-share-gaming).
- Replicator
  (`OKQFTRCE…`) can copy
  vars (not `constants` /
  `lp_*` /
  `pool_asset_balance_*`)
  and restore outputs
  until `renounce`.

Not submitted. Remaining
Obyte listed AAs:
`token-registry-aa`,
`obyte-cascading-donations`
(logged below).

## 2026-09-03: Obyte cascading-donations AA leftover (`2f48482`)

Immunefi program `obyte`
($50,000, `kyc: false`).
Listed leftover
`byteball/obyte-cascading-donations`
(kivach.org). Official
clone `/tmp/obyte-cascading`
at `2f48482` (“doc and
banner”). Local static
read of `agent.aa`. No
mainnet interaction.

No finding.

Donate credits
`repo*pool*asset` after a
storage fee (1000 bytes
or 100 to an optional
notification AA).
`trigger.data.donor` may
attribute ranking to
another address (display
only). Distribute is
permissionless once
rules exist: each dest
repo gets
`floor(pool * pct/100)`
as pool credit inside
this AA; remainder is
`$to_self`. Only a
GitHub-attested owner
is paid `$to_self +
unclaimed`; otherwise
remainder stays
unclaimed. Rules sum
must be ≤ 100, ≤ 10
dests, dest ≠ self.
Repo strings are
`owner/project` with
`\w/.-` only. The
published tree hardcodes
the testkit attestor AA
(mainnet IDs are
commented). That is a
deploy-time constant,
not a user drain of a
live kivach AA that
uses the mainnet
attestor.

Not submitted.

## 2026-09-03: Obyte token-registry AA leftover (`8d37f20`)

Immunefi program `obyte`
($50,000, `kyc: false`).
Listed leftover
`byteball/token-registry-aa`.
Official clone
`/tmp/obyte-token-registry`
at `8d37f20` (“numbers
are now stored as
numbers”). Local static
read of
`token-registry.oscript`.
No mainnet interaction.

No finding.

Support deposits
(`≥ 1e8` bytes) vote for
a symbol↔asset link.
Withdraw pays only
`trigger.address` from
that address’s drawer
and only after a locked
drawer’s expiry.
Permissionless `move`
shifts an expired drawer
to the same address’s
drawer 0 (no payout).
Symbol/asset flips need
a 30-day challenge
unless a new asset is
still in the 30-day
grace window and the
challenger has 5×
support. Description /
decimals votes use the
voter’s existing
balance, not new
payments. Reserved
GBYTE/BYTE names bounce.

Not submitted. Remaining
Obyte listed AAs:
exhausted
(`token-registry-aa` +
`obyte-cascading-donations`).

## 2026-09-03: MtPelerin bridge-v2 leftover (`1126cfc`)

Immunefi program
`mtpelerin` ($5,000,
`kyc: false`). Listed
`MtPelerin/bridge-v2`
token / rules /
operating / sale files.
Official clone
`/tmp/mtpelerin` at
`1126cfc` (“Bumped
version”). Local static
read of
`operating/{Processor,
RuleEngine,ComplianceRegistry}.sol`,
`token/abstract/{BridgeERC20,
SeizableBridgeERC20}.sol`,
`rules/{Soft,Hard}TransferLimitRule.sol`,
`sale/TokenSale.sol`,
`utils/TokenDispenserQueue.sol`,
`tokenbridge/Mediator.sol`.
No mainnet interaction.

No finding.

Balances live in the
Processor keyed by
`_msgSender()` (the
token). A stranger
calling Processor
directly only writes
their own unregistered
slot. Token
`transferFrom` checks
allowance, then
Processor runs each
rule; `beforeTransferHook`
may rewrite `to` /
amount (Soft AML hold
sends tokens to the
ComplianceRegistry).
Hooks are
`onlyOperator` on the
rule (the Processor must
be an operator). Seize /
mint / burn require
token-level seizer /
supplier roles. On-hold
release is keyed by
`msg.sender` as the
trusted intermediary.
Mediator
`transferFrom`s the
caller then AMB-passes
to a mapped token.
Sale / dispenser are
operator-gated.

Not submitted. Remaining
MtPelerin listed files
(logged below).

## 2026-09-03: MtPelerin leftover wrappers + KYC rules (`1126cfc`)

Immunefi program
`mtpelerin` ($5,000,
`kyc: false`). Same
`MtPelerin/bridge-v2`
tree at `1126cfc`. Local
static read of
`token/{BridgeToken,
CoinBridgeToken,
ShareBridgeToken,
BondBridgeToken}.sol`
and
`rules/{UserValidRule,
UserKycThresholdFromRule,
UserFreezeRule,
AddressThresholdLockRule}.sol`.
No mainnet interaction.

No finding.

Coin / Bond wrappers
only call
`BridgeToken.initialize`.
Share adds admin-set
`tokenizedShares` /
board-resolution
metadata (no money
path). Mint / burn are
`onlySupplier`. EIP-2612
/ EIP-3009 use typed
hashes, expiry, and
one-time
`authorizationStates`.
KYC / valid / freeze
rules are view-only
registry lookups
(`TRANSFER_VALID_WITH_NO_HOOK`
or reject). Address lock
refuses a send that
would leave the sender
below an admin-set
threshold.

Not submitted. Listed
MtPelerin GitHub
Solidity leftover is
exhausted.

## 2026-09-03: Orderly Vault leftover (`462e129`)

Immunefi program
`orderlynetwork`
($100,000, `kyc: false`).
Listed leftover
`OrderlyNetwork/contract-evm`
`src/` except `tUSDC.sol`.
Local clone `/tmp/orderly-evm`
at `462e129` (“Merge
branch 'staging' into
'main'”). This slice is
`src/vaultSide/Vault.sol`
only. No mainnet
interaction.

Checked for: deposit that
credits a stranger’s
accountId; permissionless
withdraw; withdraw that
pays after a failed
transfer while the ledger
already deducted;
delegateSwap that drains
without the operator +
signer.

Result: no
user-exploitable
finding. Not submitted.

- Deposit pulls
  `tokenAmount` from
  `msg.sender` and posts
  a CC deposit for
  `receiver`. Regular
  callers must satisfy
  `accountId ==
  keccak256(receiver,
  brokerHash)`. Allowed
  token / broker, amount
  > 0. Deposit limit is
  documented as soft
  (async withdraws).
  `depositTo` is a gift.
- Withdraw /
  `withdraw2Contract` /
  CCTP rebalance are
  `onlyCrossChainManager`.
  Payout is
  `tokenAmount - fee`.
  Native / blacklist
  failures emit
  `WithdrawFailed` and
  leave tokens in the
  vault (ledger already
  notified — CC trust).
- `delegateSwap` is
  `onlySwapOperator`,
  one-time `tradeId`,
  and requires
  `swapSigner`. Arbitrary
  `to` + calldata is the
  trusted-operator
  path, not a user
  theft path.
- `vaultAdapter` may
  skip accountId checks
  (owner-set).

Not submitted. Remaining
Orderly listed GitHub:
Ledger / Operator /
Fee / Market managers
and `evm-cross-chain`
`contracts/` (Ledger
withdraw logged below).

## 2026-09-03: Orderly Ledger withdraw leftover (`462e129`)

Immunefi program
`orderlynetwork`
($100,000, `kyc: false`).
Vault leftover is already
logged. This slice is
Ledger withdraw + deposit
notify on the same pin
`462e129`. Local clone
`/tmp/orderly-evm`. No
mainnet interaction.

Files: `Ledger.sol`,
`LedgerImplA.sol`
(`executeWithdrawAction`,
`accountWithDrawFinish`,
`accountWithdrawFail`,
`accountDeposit`),
`VaultManager.sol`
freeze helpers,
`library/Signature.sol`,
`library/typesHelper/AccountTypeHelper.sol`.

Checked for: operator
withdraw without a valid
user sig; finish that
credits a stranger;
unfreeze that inflates
balance; deposit that
registers a hijacked
userAddress.

Result: no
user-exploitable
finding. Not submitted.

- `executeWithdrawAction`
  is `onlyOperatorManager`.
  Requires allowed broker
  / chain token, accountId
  matching sender (or
  strategy-vault id),
  increasing nonce, ledger
  balance minus escrow,
  vault chain balance,
  EIP-712 sig from
  `sender` (domain
  `Orderly`/`1`,
  `verifyingContract` is
  the Ledger via
  delegatecall), fee ≤
  max, receiver ≠ 0.
  Bad nonce / sig /
  escrow emit fail and
  return. Then freezes
  `tokenAmount` on the
  account and
  `tokenAmount - fee` on
  the vault and CCs the
  vault.
- Finish is
  `onlyCrossChainManager`.
  Clears the nonce freeze
  (must match exactly)
  and credits the
  withdraw-fee collector.
  Fail (`onlyOwner`)
  unfreezes the same
  amounts.
- `accountDeposit` is
  `onlyCrossChainManager`.
  First deposit registers
  `userAddress` /
  `brokerHash` from the
  CC payload (CC trust).
- VaultManager freeze /
  add / sub are
  `onlyLedger`.

Not submitted. Remaining
Orderly listed GitHub:
Operator / Fee / Market
managers, LedgerImpl B/C/D
trade / Sol withdraw
paths, and
`evm-cross-chain`.

## 2026-09-03: Yearn yCRV token + Boosted Staker leftover (Sourcify)

Immunefi program
`yearnfinance`
($200,000, `kyc: false`).
Listed leftover that was
never logged: yCRV token
`0xFCc5c47bE19d06BF83eB04298b026F81069ff65b`
(22 Feb 2022), yCRV
Boosted Staker
`0xE9A115b77A1057C918F997c32663FdcE24FB873f`
(22 Oct 2024), and yCRV
Reward Distributor
`0xB226c52EB411326CdB54824a88aBaFDAAfF16D3d`
(22 Oct 2024). Sourcify
`match` on all three
(staker / distributor
verified 2024-08-08;
token verified
2025-01-13). Extract
`/tmp/yearn-ycrv/{token,
staker,distributor}`.
Jan 2026 yYB leftover
already logged the same
`YearnBoostedStaker` /
`SingleTokenRewardDistributor`
sources on different
addresses. No mainnet
interaction.

Files: Sourcify
`Vyper_contract.vy`
(yCRV 0.3.7),
`YearnBoostedStaker.sol`,
`SingleTokenRewardDistributor.sol`.

Checked for: permissionless
yCRV mint without a CRV /
yveCRV pull; `sweep` /
`sweep_yvecrv` of locked
backing; stranger
`unstakeFor` / `claimFor`;
distributor `pushRewards`
that steals a live week's
rewards; `stakeAsMaxWeighted`
without the owner role.

Result: no
user-exploitable
finding. Not submitted.

- `mint` pulls CRV to the
  hardcoded Yearn `VOTER`
  and mints yCRV 1:1.
  Donations are
  non-redeemable. Default
  `_amount` is
  `max_value` and uses
  the caller's CRV
  balance.
- `burn_to_mint` pulls
  yveCRV to this contract,
  increments `burned`,
  and mints 1:1.
  `sweep_yvecrv` can only
  take
  `balance - burned`.
  `sweep` is
  `sweep_recipient` and
  cannot take YVECRV.
- Staker `stake` /
  `unstake` use even
  amounts and checkpoint.
  `stakeAsMaxWeighted` is
  `approvedWeightedStaker`.
  `stakeFor` /
  `unstakeFor` need
  `approvedCaller`.
  Owner `sweep` subtracts
  `totalSupply` of the
  stake token.
- Distributor `claim` /
  `claimWithRange` pay the
  account or its
  configured recipient.
  `claimFor` needs
  `approvedClaimer`.
  Skipping weeks in a
  ranged claim is a
  documented self-lockout.
  `pushRewards` only moves
  a past week with zero
  adjusted global weight.
  First-week deposits are
  excluded from shares via
  `weightPersistent`.

Not submitted. Remaining
Yearn listed leftover:
yvUSD
`0x696d02Db93291651ED510704c9b286841d506987`
(Sourcify 404; yearn.fi
vault URL, not an impl
this pass can open) and
the 2023 YFI / Woofy
token rows. Do not treat
the already-logged yYB
staker / distributor as
a second finding.

## 2026-09-03: Hermetica hBTC vault leftover (Hiro)

Immunefi program
`hermetica`
($100,000, `kyc: false`).
Listed Clarity (11 Feb
and 31 Mar 2026): HQ,
blacklist, token, state,
reserve, reserve-fund,
controller, fee-collector,
hermetica / zest
interfaces, trading, and
vault `vault-hbtc-v1-1`.
Hiro
`extended/v1/tx/{txid}`
source extract under
`/tmp/hermetica`. Principal
`SP1S1HSFH0SQQGWKB69EYFNY0B1MHRMGXR3J1FH4D`.
No GitHub tree. Primacy of
Impact row is the marketing
site, not extra code. No
mainnet interaction.

Files: `vault.clar`,
`state.clar`,
`token.clar`,
`controller.clar`,
`hq.clar`,
`reserve.clar`,
`trading.clar`,
`hermetica-interface.clar`,
`zest-interface.clar`,
`blacklist.clar`.

Checked for: first-depositor
inflation via reserve
donation; share mint
without an sBTC pull;
permissionless
`fund-claim` that
finalizes a stranger's
claim at a crashed PPS;
`redeem` that pays the
caller instead of the
claim user; trader
`sweep` off-reserve;
`update-state` from a
non-protocol contract.

Result: no
user-exploitable
finding. Not submitted.

- `deposit` pulls sBTC to
  the reserve, then
  `update-state` adds
  `total-assets` and mints
  shares. PPS is
  `net-assets * 1e8 /
  supply` (accounting, not
  the reserve ERC-20
  balance). A donation
  into the reserve does
  not mint shares and does
  not change PPS.
- Empty vault mints 1:1.
  `convert-to-shares`
  divides by `net-assets`
  when supply > 0; a
  zero-net book would DoS
  deposits, not inflate.
- `request-redeem` moves
  shares to the vault.
  `fund-claim` after
  cooldown is
  permissionless and
  snapshots the current
  accounting PPS, pulls
  sBTC reserve → vault,
  and burns the vault's
  shares. `redeem` pays
  the claim `user` (minus
  the recorded fee).
  Express claims cannot
  `cancel-redeem`.
- Trading / mint / unstake
  / Zest borrow-repay are
  `check-is-trader` plus
  allowlisted externals.
  `reserve.transfer`
  requires both caller and
  recipient to be PROTOCOL.
  Token mint/burn is
  protocol-only.
- `log-reward` is
  rewarder-only and is
  capped by `max-reward`
  and `max-deviation`.
  `settle-pending` is
  manager-only.

Not submitted. Listed
Hermetica Clarity is
exhausted. Next leftover:
Yearn yvUSD (Sourcify 404)
/ YFI / Woofy, Twyne
Sourcify-404 vaults, or
another unreviewed no-KYC
slug (beanstalk /
cowprotocol / staderforeth
have older trees).

## 2026-09-03: Orderly evm-cross-chain leftover (`9a8ba76`)

Immunefi program
`orderlynetwork`
($100,000, `kyc: false`).
Listed leftover
`OrderlyNetwork/evm-cross-chain`
`/contracts/` except
`contracts/test` and the
vendored `contracts/layerzero`
UA copy. Local clone
`/tmp/orderly-xchain` at
`9a8ba76` (“init”). Vault
and Ledger withdraw on
`contract-evm` `462e129`
are already logged. No
mainnet interaction.

Files:
`VaultCrossChainManagerUpgradeable.sol`,
`LedgerCrossChainManagerUpgradeable.sol`,
`CrossChainRelayUpgradeable.sol`,
`utils/OrderlyCrossChainMessage.sol`,
proxies.

Checked for: a forged LZ
payload that credits a
deposit or pays a
withdraw; `srcChainId`
spoof that inflates
`convertDecimal`;
permissionless
`receiveMessage` on the
managers; relay
`onlyCaller` that includes
a stranger.

Result: no
user-exploitable
finding. Not submitted.

- Relay `lzReceive` is
  endpoint-only and
  requires the owner-set
  `trustedRemoteLookup`.
  `_blockingLzReceive`
  remaps the LZ chain id
  and forwards the inner
  `MessageV1` to
  `_managerAddress`. It
  does not re-bind
  `message.srcChainId` to
  the LZ source; a lying
  inner id still needs a
  trusted remote relay
  (owner-set callers:
  owner, endpoint,
  manager).
- Vault CCM
  `receiveMessage` is
  `onlyRelay` and
  `dstChainId == chainId`.
  Withdraw decodes
  `EventTypesWithdrawData`
  and calls
  `vault.withdraw`.
  Rebalance burn/mint
  forward to the vault.
  `deposit` /
  `depositWithFee` /
  `withdraw` /
  burn/mint finish are
  `onlyVault`.
- Ledger CCM
  `receiveMessage` is
  `onlyRelay`. Deposit /
  withdraw-finish /
  rebalance finish convert
  amounts with owner-set
  `tokenDecimalMapping`
  (unset both sides is
  1:1; one-sided zeros
  are owner misconfig,
  not a user path) and
  call `ledger.accountDeposit`
  / `accountWithDrawFinish`.
  Outbound withdraw /
  burn / mint are
  `onlyLedger`.
- `CrossChainManagerTest`
  token hash is a ping
  that does not pay.
  Owner `sendTestWithdraw`
  / native + ERC20 sweep
  are privileged.

Not submitted. Remaining
Orderly listed GitHub:
Operator / Fee / Market
managers and LedgerImpl
B/C/D trade / Sol
withdraw paths.

## 2026-09-03: Orderly Operator / Fee / Market + LedgerImpl B/C/D (`462e129`)

Immunefi program
`orderlynetwork`
($100,000, `kyc: false`).
Vault, Ledger withdraw,
and `evm-cross-chain`
are already logged. This
slice is the remaining
listed `contract-evm`
`src/` at `462e129`.
Local clone
`/tmp/orderly-evm`. No
mainnet interaction.

Files: `OperatorManager.sol`,
`OperatorManagerImplA.sol`,
`OperatorManagerImplB.sol`,
`FeeManager.sol`,
`MarketManager.sol`,
`LedgerImplB.sol`,
`LedgerImplC.sol`,
`LedgerImplD.sol`,
plus the `Ledger.sol`
wrappers for those
selectors.

Checked for: a stranger
uploading trades /
settlements / fees;
engine-sig skip on
batch id; deposit or
Sol withdraw that
registers a hijacked
pubkey; withdraw2Contract
to an arbitrary
receiver; swap upload
that credits without
the operator.

Result: no
user-exploitable
finding. Not submitted.

- OperatorManager
  `onlyOperator` (or the
  owner-set zip) gates
  every upload. Impl A
  verifies the engine
  perp / market /
  rebalance signer and
  requires a matching
  sequential
  `futuresUploadBatchId`.
  Impl B does the same
  for events
  (`eventUploadBatchId`
  + `engineEventUploadAddress`)
  then `ledger.call`s
  the owner-inited
  `bizTypeToSelectors`.
  Unknown bizType
  reverts. Engine keys
  are owner-set.
- FeeManager collectors
  are owner-set;
  `setBrokerAccountId`
  is owner or
  `BROKER_MANAGER_ROLE`.
  Getters only.
- MarketManager price /
  funding writes are
  `onlyOperatorManager`.
  `setLastFundingUpdated`
  is `onlyLedger`. Cfg
  is owner-set.
- Ledger wrappers:
  trades / settlement /
  liq / ADL / fee /
  delegate / balance
  transfer / swap /
  withdraw2Contract are
  `onlyOperatorManager`.
  Sol deposit is
  `onlyCrossChainManagerV2`.
- Impl B batch trades
  apply the same symbol
  allowlist and position
  math as Impl A, using
  transient storage for
  gas. Operator-only.
- Impl C Sol deposit
  requires
  `accountId ==
  keccak256(pubkey,
  brokerHash)` then
  credits that id. Sol
  withdraw requires
  Ed25519 (EOA memo or
  ledger tx) from
  `sender`, then
  freeze+finish in one
  tx (no async finish,
  documented). Balance
  transfer is a
  two-sided debit/credit
  keyed by `transferId`
  (engine trust).
- Impl D
  withdraw2Contract
  pays only a Ceffu
  prime wallet mapped
  to the account, or a
  protocol vault whose
  accountId matches.
  Swap `applyDelta` is
  operator-only; vault
  deltas apply only
  when `swapStatus ==
  1`.

Not submitted. Listed
Orderly GitHub leftover
is exhausted.

## 2026-09-03: Compound Finance PR 127 / 2.9 (`ae4388e`)

Immunefi program
`Compound Finance`
($1,000,000, `kyc: true`).
The only listed GitHub
smart-contract asset is
`compound-finance/compound-protocol`
pull 127 (merge
`ae4388e`, “Compound/2.9”).
Remaining Compound assets
are explorer addresses +
Primacy of Impact. Local
worktree
`/tmp/compound-pr127-merge`
at that merge (do not use
`/tmp/compound-protocol`
HEAD `#152`). No mainnet
interaction.

Files:
`contracts/Comptroller.sol`
(`liquidateBorrowAllowed`,
`isDeprecated`,
`seizeAllowed`),
`contracts/CToken.sol`
(`liquidateBorrowFresh`,
`seize` /
`seizeInternal`),
`contracts/CTokenInterfaces.sol`
(`protocolSeizeShareMantissa`).

Checked for: a
non-deprecated market
that can be fully
liquidated without
shortfall; seize that
inflates the exchange
rate or steals extra
collateral; permissionless
`seize` from a stranger
cToken.

Result: no
user-exploitable
finding. Not submitted.

- `isDeprecated` requires
  CF = 0, borrow paused,
  and reserve factor =
  100%. Only then does
  `liquidateBorrowAllowed`
  skip shortfall and
  close-factor (repay ≤
  stored borrow). All
  three knobs are
  governance. Intended
  SAI/REP wind-down.
- Otherwise liquidate
  still needs shortfall
  and `repay ≤
  closeFactor * borrow`.
  Both markets listed.
  Freshness on both
  cTokens. Liquidator ≠
  borrower. `repayAmount`
  not 0 / uint-max.
- `seize` is
  `nonReentrant` and
  passes `msg.sender` as
  the seizer. Comptroller
  requires both markets
  listed and the same
  comptroller.
- Protocol share is
  2.8% of seize tokens:
  burn that supply and
  add `tokens * rate`
  to reserves. Rate
  stays invariant:
  `(cash+borrows-reserves
  - amount) / (supply -
  tokens)` equals the
  prior rate. Liquidator
  gets the remaining
  97.2%.

Not submitted. Listed
Compound GitHub leftover
(PR 127) is exhausted.

## 2026-09-03: Raydium CLMM leftover (`ed7c84a`)

Immunefi program
`raydium` ($505,000,
`kyc: false`). Listed
leftover is per-file
GitHub URLs under
`raydium-io/raydium-amm-v3`
`programs/amm/src`
(instructions +
libraries + states +
`lib.rs` / `error.rs`,
added 24 Apr 2023).
Local clone
`/tmp/raydium-amm-v3` at
`ed7c84a` (“Feat/position
nft freeze (#197)”).
Program id
`CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`.
No mainnet interaction.

This slice is the listed
swap / liquidity / fee /
reward / admin money
path at current HEAD
(tree has later limit-
order and Token-2022
helpers that are not in
the 2023 file list).

Files:
`instructions/swap.rs`,
`increase_liquidity.rs`,
`decrease_liquidity.rs`,
`close_position.rs`,
`open_position.rs`,
`create_pool.rs`,
`initialize_reward.rs`,
`collect_remaining_rewards.rs`,
`admin/collect_protocol_fee.rs`,
`admin/collect_fund_fee.rs`,
`admin/update_amm_config.rs`.

Checked for: swap that
pulls the wrong vault or
skips slippage; increase
that credits a stranger’s
NFT; decrease that pays
without burning liquidity;
close that burns a live
position; remaining-reward
collect that takes
unclaimed LP rewards;
permissionless protocol /
fund fee collect.

Result: no
user-exploitable
finding. Not submitted.

- Swap `exact_internal`
  binds input/output
  vaults to
  `pool.token_vault_0/1`
  by mint direction.
  Input ATA must be
  payer-owned and match
  the input vault mint.
  Tick arrays must
  belong to the pool.
  Exact-in/out amounts
  are checked against
  `other_amount_threshold`.
  Zero limit price
  forbids a partial fill.
  Fees split into LP /
  protocol / fund from
  the trade fee; LP
  growth is
  `mul_div_floor`.
- Increase liquidity
  requires the position
  NFT (amount 1,
  authority =
  `nft_owner`) and pulls
  only from the signer’s
  token accounts into
  the pool vaults.
  Position ticks come
  from the PDA, not the
  caller.
- Decrease requires the
  same NFT. Liquidity
  burned cannot exceed
  the position.
  Payout is burned
  amounts plus zeroed
  `token_fees_owed_*`.
  Recipients need only
  the vault mint (gift).
  Rewards pay recorded
  `reward_amount_owed`
  and never more than
  the reward vault.
- Close requires zero
  liquidity, fees, and
  reward owed, then
  burns the NFT. Frozen
  NFT thaws with the
  pool PDA after the
  remaining account is
  checked against
  `personal_position.pool_id`.
- Create pool is a PDA
  (`config`, mint0 <
  mint1) and creates
  vault PDAs; it does
  not take user tokens.
- `update_amm_config`
  is `admin::ID` only.
  Protocol / fund fee
  collect is admin or
  config owner /
  fund_owner and caps
  at the recorded
  balances.
- Remaining rewards:
  funder must be the
  reward authority,
  emissions must have
  ended
  (`last_update_time ==
  end_time`), and the
  payout is vault minus
  unclaimed
  (`emitted - claimed`).

Not submitted. Remaining
Raydium listed GitHub:
`raydium-amm` (classic)
and `raydium-cp-swap`.

## 2026-09-03: Marinade liquid-staking leftover (`b8fe3f8`)

Immunefi program
`marinade` ($250,000,
`kyc: false`). Listed
leftover is
`marinade-finance/liquid-staking-program`
(whole tree, added
11 Feb 2022). Local clone
`/tmp/marinade-lsp` at
`b8fe3f8` (“[trivial]
[GEN-8081] Update
README.md (#89)”). This
slice is the user SOL /
mSOL / LP money path.
No mainnet interaction.

Files:
`instructions/user/deposit.rs`,
`deposit_stake_account.rs`
(stake-account gates),
`liq_pool/liquid_unstake.rs`,
`liq_pool/add_liquidity.rs`,
`liq_pool/remove_liquidity.rs`,
`delayed_unstake/order_unstake.rs`,
`delayed_unstake/claim.rs`.

Checked for: mSOL minted
without a matching SOL
pull; liquid unstake that
pays more SOL than the
burned mSOL; claim of a
stranger’s ticket;
LP mint without a SOL
deposit; remaining-ticket
reuse.

Result: no
user-exploitable
finding. Not submitted.

- Deposit pulls SOL from
  the signer into the
  liq-pool SOL leg and/or
  reserve PDA, then
  transfers existing
  liq-pool mSOL and/or
  mints the rest via the
  mint-authority PDA.
  `mint_to` is any mSOL
  ATA (gift). Supply
  cannot exceed the
  recorded
  `msol_supply`.
- Liquid unstake requires
  a token source check
  (owner or delegate)
  and pays
  `msol_to_sol(amount -
  fee)` from the SOL-leg
  PDA, capped by
  available liquidity
  minus rent. Fee mSOL
  stays in the pool;
  treasury cut goes to
  the state treasury.
  SOL destination is
  unconstrained (gift).
- `order_unstake` burns
  the caller’s mSOL and
  writes a zeroed ticket
  with beneficiary =
  token-account owner
  and lamports =
  `msol_to_sol - delay
  fee`. Claim requires
  `transfer_sol_to ==
  ticket.beneficiary`,
  matching
  `state_address`,
  non-zero lamports,
  one epoch + 30 minutes,
  and reserve SOL above
  rent. Anyone may
  trigger claim; payout
  is only to the
  beneficiary. Ticket
  closes to that
  account.
- Add liquidity pulls
  signer SOL into the
  SOL leg and mints LP
  shares from
  `shares_from_value`
  after syncing
  `lp_supply` to the
  real mint (must not
  exceed recorded).
  Remove burns LP and
  pays pro-rata SOL +
  mSOL from the legs.

Not submitted. Remaining
Marinade: crank
(stake_reserve /
deactivate / merge /
update), admin pause /
config, and validator
management /
`withdraw_stake_account`
split.

## 2026-09-03: Rocket Pool v1.4 deposit / rETH / megapool queue (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Listed leftover
`rocket-pool/rocketpool`
blob/v1.4 (added 17 Feb
2026). Local clone
`/tmp/rocketpool` at
`fb7d9c4` (“Insert
correct mainnet genesis
block time”). This slice
is the user + node ETH
path into the deposit
pool and megapool queue.
No mainnet interaction.

Files:
`contracts/contract/deposit/RocketDepositPool.sol`,
`contracts/contract/token/RocketTokenRETH.sol`,
`contracts/contract/node/RocketNodeDeposit.sol`,
`contracts/contract/megapool/RocketMegapoolDelegate.sol`
(`newValidator`,
`dequeue`,
`assignFunds`,
`reduceBond`),
`contracts/contract/network/RocketNetworkBalances.sol`.

Checked for: minting
rETH without ETH;
`exitQueue` underflowing
`nodeBalance` so excess
can be drained;
`applyCredit` to a
stranger; dequeue that
credits twice; burn that
pulls more than excess.

Result: no
user-exploitable
finding. Not submitted.

- User `deposit` is
  `onlyThisLatestContract`,
  min size, pool cap
  (plus queue capacity
  when assign is on).
  Fee comes out of
  `msg.value`; rETH is
  minted on the net
  amount via the oracle
  rate. ETH is split to
  the rETH buffer then
  the vault.
- `mint` /
  `depositExcess` /
  `withdrawExcessBalance`
  are deposit-pool-only.
  `burn` pays
  `getEthValue` and
  pulls only
  `getExcessBalance`
  from the vault.
- Node bond hits the
  vault via
  `nodeDeposit` (only
  `rocketNodeDeposit`)
  which increments
  `nodeBalance` by the
  full bond (credit may
  cover `msg.value`).
  `requestFunds` is
  only a registered
  megapool; it enqueues
  and raises bonded /
  borrowed snapshots
  but does not touch
  `nodeBalance` — that
  increment already
  happened in
  `nodeDeposit`.
- `exitQueue` subtracts
  that bond from
  `nodeBalance` and
  `requestedTotal`.
  Megapool `dequeue`
  then
  `fundsReturned` +
  `applyCredit(bond)`.
  The ETH stays in the
  vault; credit mints
  rETH the same way a
  user deposit does.
- `assignFunds` is
  deposit-pool-only,
  prestakes 1 ETH to
  the official deposit
  contract, and moves
  queued capital into
  `nodeBond` /
  `userCapital`.
- Network totals are
  oracle-submitted
  (trusted-node
  threshold). Rate
  games need oDAO
  collusion.

Not submitted. Remaining
Rocket Pool listed
GitHub: megapool
stake / dissolve /
rewards, minipool
delegate leftover,
vault, auction, DAO
settings / voting.

## 2026-09-03: Raydium classic AMM leftover (`27f461d`)

Immunefi program
`raydium` ($505,000,
`kyc: false`). Listed
leftover is per-file
URLs under
`raydium-io/raydium-amm`
`program/src` (added
27 Dec 2023): `lib.rs`,
`entrypoint.rs`,
`instruction.rs`,
`error.rs`, `invokers.rs`,
`log.rs`, `math.rs`,
`processor.rs`,
`state.rs`. Local clone
`/tmp/raydium-amm` at
`27f461d` (“Remove
openbook dependency
(#69)”). Program id
`675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8`.
No mainnet interaction.

This slice is
initialize2 / deposit /
withdraw / swap (v1+v2)
/ withdraw-pnl / admin
config after OpenBook
accounts became unused
padding.

Checked for: LP minted
without a matching
vault pull; withdraw
that pays more than
pro-rata; swap that
uses a stranger’s vault
or skips slippage;
permissionless pnl
withdraw.

Result: no
user-exploitable
finding. Not submitted.

- `Initialize2` requires
  a signer wallet, the
  AMM authority PDA, and
  the config PDA. Coin
  and PC mints must
  differ. Create-pool
  fee (if set) pays the
  hardcoded fee
  destination.
- Deposit requires the
  source owner signer.
  Vault accounts must
  match `amm.coin_vault`
  / `pc_vault`; user
  sources cannot be the
  vaults. LP mint and
  target-orders must
  match the AMM. Amounts
  follow the pool ratio
  (ceiling on the other
  side) with max and
  optional min
  slippage. LP minted
  `floor(input /
  reserve * lp_amount)`.
  Empty `lp_amount` is
  refused.
- Withdraw requires the
  LP owner signer, LP
  mint match, and dest
  mints = vault mints.
  Cannot dest into the
  vaults. Cannot redeem
  `>= amm.lp_amount`.
  Payout is
  `floor(lp / total *
  reserve)` per side
  with optional mins.
  LP is burned.
- Swap v1/v2 require a
  signer. Vaults bind to
  the AMM. User ATAs
  cannot be the vaults.
  Direction is mint
  pair. Exact-in: fee
  `ceil`, then constant
  product; `minimum_out`
  and cannot take the
  whole reserve.
  Exact-out: input is
  `ceil(need /
  (1-fee))` vs
  `max_amount_in`.
- `WithdrawPnl` is the
  hardcoded amm-owner
  or config `pnl_owner`.
  `SetParams` /
  create/update config
  are amm-owner only.

Not submitted. Remaining
Raydium listed GitHub:
`raydium-cp-swap`.

## 2026-09-03: Raydium cp-swap leftover (`244e124`)

Immunefi program
`raydium` ($505,000,
`kyc: false`). Listed
leftover is per-file
URLs under
`raydium-io/raydium-cp-swap`
`programs/cp-swap/src`
(added 26 Mar 2024).
Local clone `/tmp/raydium-cp`
at `244e124`
(“Feat/permissionless
collect creator fee
(#76)”). Program id
`CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C`.
No mainnet interaction.

Files:
`instructions/deposit.rs`,
`withdraw.rs`,
`swap_base_input.rs`,
`swap_base_output.rs`,
`admin/collect_protocol_fee.rs`,
`admin/collect_fund_fee.rs`,
`collect_creator_fee.rs`,
plus `states/pool.rs`
`get_swap_params`.

Checked for: LP minted
without a matching
vault pull; withdraw
that pays more than
pro-rata; swap that
uses the same vault
twice or skips
slippage; permissionless
protocol / fund /
creator fee collect.

Result: no
user-exploitable
finding. Not submitted.

- Deposit requires the
  owner signer. User
  ATAs must be
  owner-owned and match
  vault mints. Vaults
  bind to the pool. LP
  mint binds to
  `pool.lp_mint`. Token
  amounts are
  `ceiling(lp / supply *
  reserve)` plus Token-
  2022 inverse transfer
  fees, capped by max.
  LP is minted by the
  auth PDA.
- Withdraw burns the
  owner’s LP and pays
  `floor` pro-rata
  (capped at
  fee-exclusive vault)
  with min slippage.
  Dest ATAs need only
  the vault mint (gift).
- Swap vaults must be
  the pool’s two
  distinct vaults
  (`get_swap_params`
  else `InvalidVault`).
  Exact-in deducts
  input transfer fee,
  charges trade /
  protocol / fund /
  creator fees, requires
  `constant_after >=
  constant_before` and
  `minimum_amount_out`.
  Exact-out adds the
  output transfer fee
  then checks
  `max_amount_in`.
  Payer must authorize
  the input transfer.
- Protocol / fund fee
  collect is admin or
  config owner /
  fund_owner and caps
  at recorded balances.
  Creator fee collect
  is `pool_creator`
  only, to the
  creator’s ATAs.

Not submitted. Listed
Raydium GitHub leftover
is exhausted.

## 2026-09-03: Rocket Pool v1.4 megapool dissolve / rewards / exit (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Deposit / rETH / queue
on the same pin
`fb7d9c4` is already
logged. This slice is
megapool dissolve,
reward split, and
beacon exit notify.
Local clone
`/tmp/rocketpool`. No
mainnet interaction.

Files:
`contracts/contract/megapool/RocketMegapoolDelegate.sol`
(`dissolveValidator`,
`distribute` /
`_distributeAmount`,
`claim`,
`notifyExit`,
`notifyFinalBalance`,
`_notifyFinalBalance`,
`challengeExit`,
`getPendingRewards`,
`_calculateCapitalDispersal`).

Checked for: permissionless
dissolve that recycles
another node’s bond;
`distribute` treating
exit principal as
rewards; claim to a
stranger; final-balance
that sends user capital
to the node.

Result: no
user-exploitable
finding. Not submitted.

- `dissolveValidator`
  requires `inPrestake`.
  Anyone may call after
  `timeBeforeDissolve`;
  the manager may skip
  the wait. Penalty is
  debt. Recycle is
  `32 ETH - prestake`
  split by the new bond
  requirement. User
  share returns to the
  deposit pool; node
  share goes to
  `refundValue`. Lost
  prestake is the
  dissolve cost.
- `getPendingRewards`
  is `balance -
  refundValue -
  assignedValue`.
  `distribute` is public
  but reverts while
  `numExitingValidators`
  or `numLockedValidators`
  is non-zero, so an
  in-progress exit’s
  withdrawal is not
  treated as rewards.
  The window before
  `notifyExit` is oDAO
  timing, not a
  stranger extract.
- Reward split uses
  oDAO revenue shares
  and the time-weighted
  capital ratio. Node
  share can repay debt;
  the rest is
  `refundValue`. User
  share goes to rETH;
  voter / pDAO shares
  to those contracts.
- `claim` is
  megapool-owner only
  and pays the node
  withdrawal address.
- `notifyExit` /
  `notifyFinalBalance`
  are manager-only.
  Shortfall of user
  capital becomes debt.
  Node share takes the
  first loss. Permissionless
  final-balance waits
  a configured delay
  (longer if shortfall).

Not submitted. Remaining
Rocket Pool listed
GitHub: minipool
delegate leftover,
vault, auction, DAO
settings / voting,
smoothing / rewards
pool.

## 2026-09-03: Beanstalk Basin leftover (Sourcify + `ecf6923`)

Immunefi program
`beanstalk`
($1,100,000, `kyc: false`).
Listed leftover this
slice is Basin +
Pipeline / Depot, not
the L1/L2 Beanstalk
diamond. Sourcify
Arbitrum `exact_match`:
Pipeline
`0xb1bE…91B0`, Depot
`0xDEb0…20c3`, Aquifer
`0xBA51…7521`, Well
Upgradeable impl
`0xBA51…e50B`, Constant
Product 2
`0xBA15…72b4`, Multi
Flow Pump
`0xBA15…5b13`. Official
tree `/tmp/basin` at
`ecf6923`. No mainnet
interaction.

Program text: unexpected
outcomes from misuse of
Pipeline and/or Depot
do not qualify. Do not
file leftover Pipeline
balances or user-signed
Depot `farm` calls.

Files: Sourcify
`Pipeline.sol` /
`LibFunction.sol`,
`Depot.sol` /
`DepotFacet.sol` /
`TokenSupportFacet.sol`,
`Well.sol` /
`WellUpgradeable.sol`,
`Aquifer.sol`,
`functions/ConstantProduct2.sol`,
`functions/Stable2.sol`,
`pumps/MultiFlowPump.sol`.

Checked for: Pipeline
call that spends a
stranger’s approval;
Depot `farm` that
moves a stranger’s
Silo deposit; Well
swap / remove that
pays without a pull or
burn; Aquifer bore that
rewrites an existing
well; upgrade that
swaps tokens; CP2
rounding that drains
the other reserve;
Pump update that
writes another well’s
slot.

Result: no
user-exploitable
finding. Not submitted.

- Pipeline is a
  documented sandbox.
  `pipe` / `multiPipe` /
  `advancedPipe` call
  `target` from
  Pipeline. Assets left
  between txs are
  permissionless. Clipboard
  paste is
  caller-controlled.
- Depot `farm` is a
  self-`delegatecall`
  multicall. ERC-20 /
  deposit transfers
  require `msg.sender`
  as the source.
  `INTERNAL` uses
  Beanstalk
  `transferInternalTokenFrom`
  from the caller.
  `pipe*` forwards to
  the listed Pipeline.
- Well `swapFrom`
  pulls then updates
  reserves via the
  immutable well
  function. `swapTo`
  computes then pulls.
  `removeLiquidity*`
  burns the caller’s
  LP. `shift` / `sync`
  / `skim` extract or
  mint against excess
  balances
  (documented rebase /
  donation helpers).
  `_setReserves`
  requires
  `balance >= reserve`.
- Aquifer `boreWell`
  clones and requires
  `isInitialized` plus
  `aquifer() == this`.
  CREATE2 salt is
  `keccak256(sender,
  salt)`.
- WellUpgradeable
  upgrade is
  `onlyOwner`. New impl
  must already be an
  Aquifer-bored well
  with the same token
  order.
- CP2
  `calcLpTokenSupply`
  is `sqrt(b0*b1*1e12)`.
  `calcReserve` rounds
  up (pool-favorable
  on swap-out).
- MultiFlowPump
  storage is keyed by
  `msg.sender`. Wells
  ignore a failing
  `update`. Zero-reserve
  updates reset that
  well’s pump.

Not submitted. Remaining
Beanstalk listed:
L1/L2 diamond, Bean /
Unripe / Fertilizer
tokens, LSD oracle,
Shipment Planner,
Junctions, Unwrap ETH.

## 2026-09-03: Beets leftover (stS `877087b` + token Sourcify)

Immunefi program
`beets`
($200,000, `kyc: false`).
Listed leftover: Beets
Staked Sonic
`0xE5DA…3955` (Sonic
Sourcify 404; official
`beethovenxfi/sonic-staking`
`/tmp/beets-lst`
`877087b`), Beets token
`0x2D0E…e4f0`
(Sourcify
`exact_match`
`Beets.sol`), Token
Migrator
`0x5f9a…E386`
(Sourcify 404). No
mainnet interaction.

Files:
`src/SonicStaking.sol`,
Sourcify
`src/token/Beets.sol`.

Checked for: stS minted
without adding S to
`totalPool`; undelegate
that burns a stranger’s
shares; withdraw that
pays a stranger; donate
that inflates PPS for
a first depositor;
owner mint above the
yearly cap.

Result: no
user-exploitable
finding. Not submitted.

- `deposit` requires
  `msg.value >= 1e16`,
  adds it to
  `totalPool`, and mints
  `convertToShares`
  (1:1 when supply or
  assets are 0). README
  says burn 1e18 on
  first deposit; not
  enforced on-chain.
- `totalAssets` is
  `totalPool +
  totalDelegated +
  pendingClawBackAmount`
  (accounting, not raw
  balance). `receive`
  is SFC-only; a
  stranger cannot donate
  native to inflate
  shares. Operator
  `donate` is
  `OPERATOR_ROLE`.
- Undelegate burns the
  caller’s shares and
  writes a withdraw
  ticket. `withdraw`
  requires
  `msg.sender ==
  request.user` and
  `kind != CLAW_BACK`.
  Emergency path can
  pay less after an
  SFC slash (user-opted).
- Operator clawback can
  drop the rate
  (documented).
  `protocolFeeBIPS` and
  `withdrawDelay` are
  admin. UUPS is
  `onlyOwner`.
- BEETS `mint` is
  `onlyOwner` and is
  capped at 10% of
  supply per year
  (`incrementYear`
  required after the
  window).

Not submitted. Remaining
Beets listed: Token
Migrator (Sourcify 404).

## 2026-09-03: Yearn YFI token leftover (Sourcify)

Immunefi program
`yearnfinance`
($200,000, `kyc: false`).
Listed leftover row YFI
Token
`0x0bc5…d93e`. Sourcify
Ethereum `match`
(`YFI.sol`, Solidity
0.5.16). Woofy
`0xD066…57f1` is still
Sourcify 404. yvUSD
vault URL is still
Sourcify 404. No
mainnet interaction.

Checked for:
permissionless mint;
governance transfer
without the current
governor.

Result: no
user-exploitable
finding. Not submitted.

- `mint` requires
  `minters[msg.sender]`.
  `addMinter` /
  `removeMinter` /
  `setGovernance` are
  `governance` only.
  Transfers are
  standard OpenZeppelin
  2-era ERC-20.

Not submitted. Remaining
Yearn listed leftover:
yvUSD
`0x696d…6987`
(Sourcify 404) and
Woofy (Sourcify 404).

## 2026-09-03: Benqi Dual Oracle leftover (Sourcify)

Immunefi program
`benqi`
($500,000, `kyc: false`).
Listed leftover this
slice is Benqi Dual
Oracle
`0x926C…73A`
(Avalanche Sourcify
`exact_match`,
`Oracle/BenqiDualOracle.sol`).
Second Dual Oracle row
`0xf81B…F15e` is the
same type. No mainnet
interaction.

Checked for: a
non-owner that can set
feeds or a direct
price; dual mode that
returns a stale or
zero price as live;
fallback that prefers
the higher of two
manipulated feeds.

Result: no
user-exploitable
finding. Not submitted.

- `setAssetOracles`,
  `setOracleMode`,
  `setDirectPrice`,
  `setUnderlyingPrice`,
  and
  `transferOracleAdmins`
  are `onlyOwner`.
  Manual prices without
  `manualOverrideAllowed`
  must stay within 10x
  of a live feed.
- Unconfigured assets
  revert. Dual mode
  reverts if both
  feeds are stale or
  if fresh prices
  deviate past the
  asset threshold
  (default 5%, cap
  20% / hard 50%).
  One stale feed falls
  back to the other.
  Edge is primary when
  both are fresh.
- Zero prices revert
  inside
  `getOraclePriceWithFreshness`.
  This is an oracle,
  not a vault.

Not submitted. Remaining
Benqi listed: qiToken
markets, unitrollers,
sAVAX, gauges,
Maximillion, Ignite,
veQI, distributors.

## 2026-09-03: Rocket Pool v1.4 vault + RPL auction leftover (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Deposit / megapool
slices on the same pin
`fb7d9c4` are already
logged. This slice is
ETH/token custody and
slashed-RPL auctions.
Local clone
`/tmp/rocketpool`. No
mainnet interaction.

Files:
`contracts/contract/RocketVault.sol`,
`contracts/contract/auction/RocketAuctionManager.sol`.

Checked for: a stranger
withdrawing another
contract’s ETH or RPL;
`depositToken` crediting
a fake balance that can
be withdrawn as real
RPL; auction claim of
someone else’s bid;
recover that steals
allotted RPL.

Result: no
user-exploitable
finding. Not submitted.

- Vault ETH deposit /
  withdraw is
  `onlyLatestNetworkContract`
  and keys the ledger
  by `getContractName
  (msg.sender)`. Withdraw
  deducts that name’s
  balance then callbacks
  `receiveVaultWithdrawalETH`.
  Token withdraw /
  transfer / burn use
  the same gate and the
  caller’s own token
  slot.
- `depositToken` is
  permissionless: the
  caller
  `transferFrom`s
  themselves and credits
  a named network
  contract. That is a
  gift. Fee-on-transfer
  would over-credit a
  slot; the token in
  scope is RPL, and only
  the named contract can
  later withdraw it.
- `createLot` allots
  unallotted vault RPL
  up to the DAO max ETH
  value / oracle price.
  `placeBid` caps ETH
  at remaining RPL *
  current price, sends
  the accepted ETH to
  the deposit pool
  (`recycleLiquidatedStake`),
  and refunds the rest.
- `claimBid` requires
  the lot cleared and
  pays only
  `msg.sender`’s bid /
  clearing price, then
  zeros that bid.
  Rounding is clamped
  to allotted RPL.
- `recoverUnclaimedRPL`
  after the lot ends
  only un-allots the
  remainder so a later
  lot can use it. RPL
  stays in the vault.

Not submitted. Remaining
Rocket Pool listed
GitHub: minipool
delegate leftover, DAO
settings / voting.

## 2026-09-03: Rocket Pool v1.4 smoothing / rewards leftover (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Deposit / megapool /
vault slices on the
same pin `fb7d9c4` are
already logged. This
slice is the smoothing
pool, rewards
consensus, merkle
distributor, and pDAO
treasury claim. Local
clone `/tmp/rocketpool`.
No mainnet interaction.

Files:
`contracts/contract/rewards/RocketSmoothingPool.sol`,
`contracts/contract/rewards/RocketRewardsPool.sol`,
`contracts/contract/rewards/RocketMerkleDistributorMainnet.sol`,
`contracts/contract/rewards/RocketClaimDAO.sol`.

Checked for: a stranger
draining the smoothing
pool; a lying snapshot
that pays unearned ETH
or RPL; double-claim of
a merkle leaf; claiming
another node’s parked
ETH; pDAO `spend` /
`newContract` without a
proposal.

Result: no
user-exploitable
finding. Not submitted.

- SmoothingPool
  `receive()` is open
  (anyone can gift ETH).
  `withdrawEther` is
  `onlyLatestNetworkContract`
  and can send the
  entire SP balance to
  an arbitrary `_to`.
  That is the trusted
  network-contract path;
  the intended caller is
  RewardsPool when a
  snapshot executes.
- `depositVoterShare` is
  permissionless: a gift
  of ETH into the
  rewards vault slot.
  `submitRewardSnapshot`
  is `onlyTrustedNode`.
  Totals must be ≤
  pending RPL and
  pending ETH (from
  inflation +
  SmoothingPool
  balance). Trusted-node
  consensus then
  `_executeRewardSnapshot`.
  `executeRewardSnapshot`
  is permissionless
  after consensus. An
  oDAO majority can
  submit a lying merkle
  root; that is the
  trusted-oracle model,
  not a stranger
  extract.
- MerkleDistributor
  `relayRewards` is
  rewards-pool-only and
  one root per interval
  index. `claim` /
  `claimAndStake`
  require a merkle
  proof **and** that
  `msg.sender` is the
  node, withdrawal, or
  RPL-withdrawal
  address for that
  node. Double-claim is
  a bitmap. A failed
  ETH send parks under
  `rewards.eth.balance
  [addr]`;
  `claimOutstandingEth`
  pays only
  `msg.sender`’s parked
  balance.
- ClaimDAO `spend` /
  `newContract` /
  `updateContract` are
  DAO-proposals-only.
  `withdrawBalance` is
  permissionless but
  pays the recipient’s
  own accrued balance.
  `receive()` ETH is
  forwarded to the
  vault with the
  comment that there is
  no way to spend that
  ETH from this
  contract.

Not submitted. Remaining
Rocket Pool listed
GitHub: minipool
delegate leftover, DAO
settings / voting.

## 2026-09-03: Harvest vault / controller leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Listed
leftover is whole trees
`harvestfi/harvest-strategy`
(added 7 Apr 2022),
`harvest-strategy-polygon`
(3 Apr 2023), and
`harvest-strategy-arbitrum`
(3 Apr 2023, re-added
15 Mar 2024). This
slice is the Ethereum
base vault / controller
only. Local clone
`/tmp/harvest-strategy`
at `0364901` (“Merge
pull request #20 from
CryptJS13/claude/inactive-vault-yield-fee-69b38a”).
No mainnet interaction.

Files:
`contracts/base/VaultV1.sol`,
`VaultV2.sol`,
`Controller.sol`,
`upgradability/BaseUpgradeableStrategy.sol`,
`upgradability/BaseUpgradeableStrategyStorage.sol`,
`noop/NoopStrategyUpgradeable.sol`,
`interface/IStrategy.sol`.

Checked for: share
mint without a matching
underlying pull;
withdraw that pays more
than pro-rata or skips
the owner / allowance
check; strategy switch
that leaves funds on
the old strategy;
permissionless salvage
of underlying;
controller fee change
without the queued
delay.

Result: no
user-exploitable
finding. Not submitted.

- `VaultV1` is an
  upgradeable ERC20.
  `initializeVault` caps
  the invest fraction at
  100%. Share decimals
  match the underlying.
  `defense` greylists
  only contracts (EOA
  always passes);
  `Controller.greyList`
  is true unless the
  address or codehash is
  whitelisted.
- Empty-vault deposit
  mints 1:1 then
  `transferFrom`. That
  is the known Yearn-
  style first-depositor
  inflation if someone
  donates after a 1-wei
  first mint. Not treated
  as a new finding.
- Later deposits mint
  `amount * supply /
  AUM`. Withdraw burns
  the owner’s shares
  (allowance if
  `msg.sender != owner`)
  then pays pro-rata of
  vault cash plus
  `investedUnderlyingBalance`.
  A shortfall pulls from
  the strategy and recaps
  to vault cash.
- `setStrategy` is
  controller / governance
  plus the announce
  timelock (first
  strategy is immediate).
  The new strategy must
  match `underlying` and
  `vault`. The old
  strategy
  `withdrawAllToVault`
  before the pointer
  moves. `doHardWork` /
  `rebalance` /
  `withdrawAll` are
  controller or
  governance.
- `VaultV2` is the
  ERC-4626 wrapper over
  the same `_deposit` /
  `_withdraw`. Empty
  convert is 1:1 after
  the shared decimals.
  `mint` converts then
  `_deposit`.
- Controller fees start
  at 10% profit-sharing,
  5% platform, 0%
  strategist, max 30% /
  10_000. Changes queue
  until
  `nextImplementationDelay`.
  `salvage` /
  `salvageStrategy` are
  governance only. The
  interface names
  `salvageToken`; live
  strategies implement
  `salvage`. That is a
  governance-ops ABI
  mismatch, not a
  third-party theft
  path.
- `BaseUpgradeableStrategy`
  `restricted` is vault /
  controller /
  governance. Fee notify
  approves the
  controller’s
  `rewardForwarder`.
  `NoopStrategyUpgradeable`
  holds idle underlying,
  withdraws only on
  `restricted`, and
  refuses salvage of
  underlying / reward.

Not submitted. Remaining
Harvest is
`contracts/strategies/*`
(dolomite / fluid /
euler / sky / morpho /
yel / stakeDao / convex /
aave / penpie / notional /
zerolend / aura /
compoundV3 / idle /
inactive) plus the
polygon and arbitrum
trees.

Rechecked ~06:10 UTC
3 Sep: Superteam still
28 open listings,
`AGENT_ALLOWED` still
only Steve Arena and
ZNS; Sherlock page 1
still only contest
`1234` (Tare) in
`SHERLOCK_JUDGING`;
KeeperHub #2105 still
`open` + PR #2275;
#2240 still `open` +
1 design comment, search
hit PR #2277 is #2247;
Uniswap/sdks#720 and
Hedera Harness #8 still
`open`, 0 comments;
CreditPassport deployer
still 0 Sepolia ETH /
0 tCTC; no Immunefi
programs launched Sep
2026; no new GitHub SC
assets since 2026-09-02
(246 programs).

## 2026-09-03: Harvest 4626 / Dolomite lend leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Vault /
controller on the same
pin `0364901` is already
logged. This slice is
the 4626-style lend
strategies. Local clone
`/tmp/harvest-strategy`.
No mainnet interaction.

Files:
`contracts/strategies/morpho/MorphoLendStrategy.sol`,
`MorphoVaultStrategy.sol`,
`fluid/FluidLendStrategy.sol`,
`euler/EulerLendStrategy.sol`,
`dolomite/DolomiteLendStrategy.sol`.

Checked for: a stranger
redeeming the strategy’s
4626 shares; withdraw
that pays the vault more
than idle plus supplied
minus reserved fee;
permissionless salvage
of underlying; fee
accrual that lets
governance or a keeper
pull user principal.

Result: no
user-exploitable
finding. Not submitted.

- Each 4626 lend
  strategy requires the
  market `asset()` to
  match `underlying`.
  Supply deposits to
  `address(this)`.
  Redeem / withdraw
  also pays this
  strategy. `restricted`
  withdraws send
  `min(requested, idle)`
  to the vault.
- `investedUnderlyingBalance`
  is idle + stored
  supplied −
  `pendingFee`. SafeMath
  reverts if the
  reserved fee exceeds
  that sum (grief, not
  theft).
- Fee is a slice of
  `current − stored`
  using the controller
  numerators. Morpho
  lend / Fluid update
  stored inside
  `_accrueFee`. Euler /
  Dolomite / Morpho
  vault update stored
  after the withdraw or
  hard-work. They redeem
  only the fee, then
  `_notifyProfitInRewardToken`
  on the reconstructed
  yield so the
  forwarder pulls the
  fee legs. Dust
  thresholds skip a
  collect.
- Fluid
  `claimReward` is
  permissionless but
  always claims to
  `address(this)`.
  Extra reward tokens
  swap through the
  controller liquidator
  with `minOut = 1`
  (keeper sandwich,
  known Harvest
  pattern). Salvage is
  governance and
  refuses underlying /
  reward / receipt
  tokens.
- Dolomite supplies
  through
  `depositWei` after
  `getMarketIdByTokenAddress`
  matches. Withdraw
  uses the same market
  id. `hardhat/console`
  is still imported;
  not a money path.

Not submitted. Remaining
Harvest is Convex /
Aura / Aave fold /
Penpie / Notional /
StakeDAO / Yel /
ZeroLend / CompoundV3 /
Idle / inactive plus
MorphoVault V2 and the
polygon / arbitrum
trees.

## 2026-09-03: CoW GPv2 leftover (`6ebbd81`)

Immunefi program
`cowprotocol`
($1,000,000, `kyc: false`).
All 19 listed assets are
GitHub blobs at
`cowprotocol/contracts`
`6ebbd810ff2da635fb6f88e9a15fde196f8c852a`.
Local clone
`/tmp/cow-contracts` at
`6ebbd81`. No mainnet
interaction.

Files:
`GPv2Settlement.sol`,
`GPv2VaultRelayer.sol`,
`mixins/GPv2Signing.sol`,
`GPv2AllowListAuthentication.sol`,
`libraries/GPv2Transfer.sol`,
`GPv2Order.sol`,
`GPv2Trade.sol`,
`GPv2Interaction.sol`,
plus the listed mixins /
SafeMath / IERC20 /
IVault interfaces.

Checked for: unsigned
`settle`; a solver
interaction that spends
a stranger’s Vault
Relayer approval; limit-
price bypass; EIP-1271 /
pre-sign owner spoof.

Result: no
user-exploitable
finding. Not submitted.

- `settle` / `swap` are
  `onlySolver` +
  `nonReentrant`.
  Authenticator
  `addSolver` /
  `removeSolver` are
  manager-gated.
- Interactions cannot
  target `vaultRelayer`
  (`GPv2: forbidden
  interaction`). Relayer
  `transferFromAccounts`
  / `batchSwapWithFee`
  are `onlyCreator`
  (the settlement
  contract).
- Limit:
  `sellAmount *
  sellPrice >=
  buyAmount * buyPrice`.
  Sell FOK:
  `executedBuy =
  sellAmount *
  sellPrice / buyPrice`
  and must still clear
  that floor. Partial
  fills are tracked in
  `filledAmount`.
- Signing: EIP-712 /
  eth_sign ECDSA;
  EIP-1271 owner is the
  first 20 bytes of the
  signature and must
  return magic;
  pre-sign owner is the
  20-byte signature and
  `preSignature[uid] ==
  PRE_SIGNED` set by
  that owner.
- `invalidateOrder` /
  `setPreSignature`
  require
  `owner == msg.sender`.
  `freeFilledAmountStorage`
  is `onlyInteraction`
  and only expired
  UIDs.
- Solver interactions
  can use settlement
  balances
  (documented;
  misbehaving solvers
  are slashed). User
  buy amounts still go
  out via
  `vault.transferToAccounts
  (outTransfers)` after
  `interactions[1]`.

Do not file “solver can
steal via interactions”
without a path that
bypasses the signed
limit and the
out-transfers.

Not submitted. Listed
CoW GitHub leftover is
exhausted.

## 2026-09-03: Stader ETHx user deposit / withdraw leftover (`9d4a921`)

Immunefi program
`staderforeth`
($1,000,000, `kyc: false`).
Listed leftover is 2023
etherscan addresses
(proxies). This slice is
the user money path:
Stake Pool Manager
`0xcf5EA1b38380f6aF39068375516Daf40Ed70D299`,
User Withdrawal Manager
`0x9F0491B32DBce587c50c4C43AB303b06478193A7`,
ETHx
`0xA35b1B31Ce002FBF2058D22F30f95D405200A15b`.
Official tree
`stader-labs/ethx`.
Local clone
`/tmp/stader-ethx` at
`9d4a921`. No mainnet
interaction.

Files:
`StaderStakePoolsManager.sol`,
`UserWithdrawalManager.sol`,
`ETHx.sol`.

Checked for: ETHx minted
without ETH; a withdraw
claim that pays a
stranger; a donation
that inflates PPS for a
first depositor;
permissionless burn.

Result: no
user-exploitable
finding. Not submitted.

- `deposit` requires
  min/max,
  `previewDeposit`
  (round down), and
  mints via
  `ETHx.mint`
  (`MINTER_ROLE`). Rate
  is the oracle
  `totalETHBalance /
  totalETHXSupply`, not
  raw
  `address(this).balance`.
  Accidental `receive` /
  `fallback` on SPM
  revert
  (`UnsupportedOperation`).
- `receiveExecutionLayerRewards`
  is permissionless
  payable — it increases
  raw balance only; the
  rate updates when the
  oracle reports. Not a
  finding.
- `transferETHToUserWithdrawManager`
  is UWM-only.
- `requestWithdraw`
  pulls ETHx from
  `msg.sender`; ticket
  `owner` can be a gift.
  `finalizeUserWithdrawalRequest`
  is permissionless,
  blocked in oracle
  `safeMode` or an
  unhealthy vault, pays
  `min(ethExpected,
  lockedEthX *
  currentRate)`, burns
  ETHx from UWM, and
  pulls ETH from SPM.
- `claim` requires
  `msg.sender ==
  request.owner`.
- `ETHx.mint` is
  `MINTER_ROLE`;
  `burnFrom` is
  `BURNER_ROLE`.

Do not file oracle-rate
/ permissionless EL-
reward donation as
inflation.

Not submitted. Remaining
Stader listed: oracle,
node registries,
validator / node EL
vaults, SD collateral,
socializing pool,
auction,
permissioned /
permissionless pools,
insurance, VaultFactory.

## 2026-09-03: Rocket Pool v1.4 minipool leftover (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Deposit / megapool /
vault / smoothing
slices on the same pin
`fb7d9c4` are already
logged. This slice is
classic minipool
create / distribute /
dissolve / bond
reduction. Local clone
`/tmp/rocketpool`. No
mainnet interaction.

Files:
`contracts/contract/minipool/RocketMinipoolDelegate.sol`,
`contracts/contract/minipool/RocketMinipoolBase.sol`,
`contracts/contract/minipool/RocketMinipoolFactory.sol`,
`contracts/contract/minipool/RocketMinipoolManager.sol`,
`contracts/contract/minipool/RocketMinipoolQueue.sol`,
`contracts/contract/minipool/RocketMinipoolBondReducer.sol`,
`contracts/contract/minipool/RocketMinipoolPenalty.sol`.

Checked for: a stranger
taking a minipool’s
ETH or rETH share;
user-distribute that
skips the wait window;
vacant promote that
mints credit without
oDAO scrub; bond
reduce that steals
user capital; factory
init race; queue
dequeue of someone
else’s minipool.

Result: no
user-exploitable
finding. Not submitted.

- Factory deploy is
  manager-only. The
  clone is initialised
  in the same
  transaction
  (`Undefined` →
  `Uninitialised` →
  delegate
  `initialise`). No
  front-run of
  `initialise`.
- `preDeposit` is
  `rocketNodeDeposit`
  only. `deposit` /
  `userDeposit` are
  `rocketDepositPool`
  only. Current
  `RocketNodeDeposit`
  no longer calls
  `createMinipool` /
  `createVacantMinipool`
  (megapool path).
  Remaining minipools
  are legacy.
- `stake` / `promote`
  / `close` /
  `reduceBondAmount`
  are owner-only.
  Promote still waits
  the promotion scrub
  period. Bond reducer
  mutators all revert
  (“no longer
  available”), so
  `reduceBondAmount`
  cannot change
  balances.
- `distributeBalance`
  while staking: ≥ 8
  ETH is treated as
  capital. The owner
  may finalise
  immediately; anyone
  else must have
  `beginUserDistribute`
  wait the DAO window.
  User share goes to
  rETH. Node share is
  refunded only to the
  withdrawal address.
  < 8 ETH is skimmed
  rewards split by
  capital ratio +
  commission. Dissolved
  distribute is
  owner-only and pays
  the whole balance to
  the withdrawal
  address.
- `dissolve` is
  permissionless after
  launch timeout in
  prelaunch. Scrub is
  trusted-node quorum.
  Penalty 2.4 ETH is
  recycled with user
  capital; if the
  contract is short
  the vote reverts
  (oDAO liveness, not
  a stranger extract).
- Queue enqueue is
  `rocketNodeDeposit`.
  Dequeue is
  `rocketDepositPool`.
  Remove is the
  registered minipool.
- Penalty max rate is
  guardian-only.
  Per-minipool rate is
  `onlyLatestNetworkContract`
  and clamped to the
  max. Zero max
  short-circuits to 0.
- Manager
  `eth.matched`
  decrements on
  finalise / destroy
  use 0.8 checked math.
  This tree never
  increments that
  snapshot (legacy
  state / megapool
  uses a different
  key). Underflow
  would revert
  finalise for a
  vacant that never
  had matched ETH;
  vacant create is
  not reachable from
  current NodeDeposit.

Not submitted. Remaining
Rocket Pool listed
GitHub: DAO settings /
voting.

## 2026-09-03: Stader oracle / factory / insurance / auction / socializing leftover (`9d4a921`)

Immunefi program
`staderforeth`
($1,000,000, `kyc: false`).
User deposit / withdraw
on the same pin
`9d4a921` is already
logged. This slice is
the remaining listed
control / reward path:
StaderOracle
`0xF64bAe65f6f2a5277571143A24FaaFDFC0C2a737`,
VaultFactory
`0x03ABEEC03BF39ac5A5C8886cF3496326d8164E1E`,
StaderInsuranceFund
`0xbe3781CE437Cc3fC8c8167913B4d462347D11F20`,
Auction
`0x85A22763f94D703d2ee39E9374616ae4C1612569`,
and both socializing
pools
`0x9d4C3166c59412CEdBe7d901f5fDe41903a1d6Fc`
/
`0x1DE458031bFbe5689deD5A8b9ed57e1E79EaB2A4`.
Local clone
`/tmp/stader-ethx`. No
mainnet interaction.

Files:
`StaderOracle.sol`,
`factory/VaultFactory.sol`,
`VaultProxy.sol`,
`StaderInsuranceFund.sol`,
`Auction.sol`,
`SocializingPool.sol`.

Checked for: a single
node or a stranger
pushing a fake ETHx
rate; factory clones
that a stranger can
re-init; insurance
withdraw that is not
manager / pool gated;
auction claim of
someone else’s bid or
SD; socializing claim
that pays a stranger.

Result: no
user-exploitable
finding. Not submitted.

- Oracle
  `submitExchangeRateData`
  is `trustedNodeOnly`,
  needs
  `trustedNodesCount/2+1`
  matching attestations,
  a past aligned
  reporting block, and
  `updateWithInLimitER`
  (default 5%). Over
  the cap enters
  inspection mode.
  `closeERInspectionMode`
  applies the inspected
  rate only after the
  7-day cooldown unless
  the caller is
  manager. Manager
  `disableERInspectionMode`
  during the window
  drops the update
  without applying it.
  Trusted-node add /
  remove is
  manager-gated with
  cooldown and a min of
  3.
- POR ER is a manager
  toggle
  (`togglePORFeedBasedERData`).
  Do not file a
  negative-`answer`
  wrap on the POR
  `int256` cast without
  proving that feed is
  the live source and
  can return
  `answer < 0`.
- VaultFactory deploy
  is
  `NODE_REGISTRY_CONTRACT`
  only. The
  implementation
  constructor sets
  `isInitialized`.
  Clones
  `initialise` once.
  Fallback
  `delegatecall`s the
  config
  implementation
  (admin of config, not
  a stranger).
- Insurance
  `depositFund` is a
  gift.
  `withdrawFund` is
  manager-only.
  `reimburseUserFund`
  is the permissioned
  pool only and pays
  that pool.
- Auction `createLot`
  pulls SD from the
  caller. `claimSD` is
  the highest bidder
  after end.
  `transferHighestBidToSSPM`
  sends ETH to SPM.
  Losing bidders
  withdraw their own
  bids.
  Unbid SD goes to the
  treasury.
- Socializing
  `handleRewards` is
  oracle-only and caps
  splits against idle
  ETH / SD minus
  reserved operator
  leftovers. `claim`
  verifies
  `keccak256(operator,
  amountSD, amountETH)`
  against that cycle’s
  root and pays
  `getOperatorRewardAddress
  (msg.sender)`.

Do not file majority-
oracle misreport as
user theft. That is a
trusted-node
assumption.

Not submitted.
Remaining Stader
listed: node
registries, validator /
node EL vaults, SD
collateral,
permissioned /
permissionless pools.

## 2026-09-03: ICHI oneToken leftover (`4873873`)

Immunefi program
`ichi` ($50,000,
`kyc: false`). Listed
leftover is
`ichifarm/ichi-oneToken`
plus four Etherscan
factory / V1 addresses.
Local clone
`/tmp/ichi-onetoken` at
`4873873` (“updated
readme”). No mainnet
interaction.

Files:
`contracts/OneTokenFactory.sol`,
`version/v1/OneTokenV1.sol`,
`version/v1/OneTokenV1Base.sol`,
`oracle/pegged/ICHIPeggedOracle.sol`,
`mintMaster/legacy/Incremental.sol`,
`strategy/StrategyCommon.sol`.

Checked for: mint that
credits oneTokens
without pulling member
+ collateral; redeem
that pays more than the
oracle’s
`amountRequired` after
the fee; factory deploy
that skips module
checks; strategy
`toVault` / `fromVault`
callable by a stranger.

Result: no
user-exploitable
finding. Not submitted.

- Factory
  `deployOneTokenProxy`
  is `onlyOwner`.
  Version / controller /
  mintMaster / oracle
  must be admitted
  modules of the right
  type. Member token is
  a registered foreign
  token; collateral
  must be marked
  collateral and have
  ≤18 decimals. The
  new proxy is admitted
  as collateral, then
  `init` + ownership
  transfer to
  governance.
- Mint updates the
  collateral and member
  oracles, reads
  `updateMintingRatio`,
  and requires
  `oneTokens <=
  maxOrderVolume`. It
  pulls
  `amountRequired`
  member + collateral
  (more collateral if
  the member allowance
  is short) then
  `_mint`s the
  requested amount.
- Redeem burns the
  caller’s oneTokens
  and pays
  `amountRequired
  (collateral, amount *
  (1 - fee))`. Pegged
  oracle is 1:1 after
  decimal normalize.
  Uniswap / composite
  oracles are
  governance-chosen;
  a bad oracle is
  trusted, not a
  third-party theft
  path.
- Strategy assignment,
  `toStrategy` /
  `fromStrategy` /
  `executeStrategy`,
  and allowance
  changes are owner or
  controller. The
  strategy must
  recognize this vault
  and share its owner.
  `StrategyCommon`
  `toVault` /
  `fromVault` are
  `strategyOwnerTokenOrController`.
- `liabilities` is
  unused on mint /
  redeem. Dead
  accounting, not a
  drain.

Not submitted. Remaining
ICHI listed: live
Etherscan factory / V1
addresses if a later
pass wants bytecode
vs this tree; Incremental
ratio step logic is
owner-parameterized.

## 2026-09-03: Rocket Pool v1.4 DAO settings / voting leftover (`fb7d9c4`)

Immunefi program
`Rocket Pool`
($150,000, `kyc: true`).
Deposit / megapool /
vault / smoothing /
minipool slices on the
same pin `fb7d9c4` are
already logged. This
slice is pDAO
proposals, optimistic
fraud-proof verifier,
settings, voting
snapshots, and
security-council
proposals. Local clone
`/tmp/rocketpool`. No
mainnet interaction.

Files:
`contracts/contract/dao/protocol/RocketDAOProtocol.sol`,
`contracts/contract/dao/protocol/RocketDAOProtocolProposal.sol`,
`contracts/contract/dao/protocol/RocketDAOProtocolProposals.sol`,
`contracts/contract/dao/protocol/RocketDAOProtocolVerifier.sol`,
`contracts/contract/dao/protocol/settings/RocketDAOProtocolSettings.sol`
plus Network / Node /
Minipool / Megapool /
Deposit / Rewards /
Inflation / Auction /
Proposals / Security
settings,
`contracts/contract/network/RocketNetworkVoting.sol`,
`contracts/contract/dao/security/RocketDAOSecurityProposals.sol`.

Checked for: a stranger
executing a treasury
spend; a lying merkle
root that steals RPL
bonds; double-claim of
a challenge or proposal
bond; voting-power
inflation after the
snapshot; settings
writes outside a passed
proposal.

Result: no
user-exploitable
finding. Not submitted.

- `propose` is a
  registered node only
  and locks an RPL
  proposal bond. The
  pollard is stored for
  challenge during
  `Pending` (vote
  delay). `execute`
  requires
  `Succeeded` and runs
  the payload only on
  `rocketDAOProtocolProposals`.
  `destroy` is
  verifier-only.
- Phase-1 `vote` checks
  a merkle witness
  against the submitted
  root. Phase-2
  `overrideVote` uses
  on-chain
  `getVotingPower` and
  can reverse a
  delegate. A lying
  root that is not
  challenged in
  `Pending` is the
  optimistic-oracle
  model, not a
  stranger extract.
- Verifier
  `createChallenge`
  locks the
  challenger’s bond
  and requires a
  witness under a
  `Responded` parent.
  `defeatProposal`
  needs the challenge
  period and then
  destroys. Claims
  mark each index
  `Paid` and require
  `msg.sender` is the
  challenger or
  proposer. Reward is
  `proposalBond *
  rewardedIndices /
  totalDefeatingIndices`
  with a 20% burn.
  Double-claim reverts
  on state.
- Settings writes are
  `onlyDAOProtocolProposal`
  after deploy, with
  per-path bounds
  (fees, quorums,
  timeouts, inflation).
  Network share
  adders also accept
  an allow-listed
  controller; the list
  is a DAO address
  setting and rETH
  commission is
  capped at 100%.
- Voting power is
  `sqrt` of RPL stake
  clamped by bonded
  ETH × max-percent /
  price at a past
  snapshot block.
  `setDelegate` is
  registered-node to
  registered-node.
- Bootstrap is
  guardian + bootstrap
  mode. Security
  propose/vote is
  council-member only
  and can only change
  allow-listed
  setting paths.
  Treasury
  `spend` /
  `newContract` /
  `updateContract` are
  `onlyExecutingContracts`.

Not submitted. Listed
Rocket Pool GitHub
leftover is exhausted.

## 2026-09-03: Stader registries / vaults / SD / pools leftover (`9d4a921`)

Immunefi program
`staderforeth`
($1,000,000, `kyc: false`).
User path and oracle /
factory / insurance /
auction / socializing
on the same pin
`9d4a921` are already
logged. This slice is
the remaining listed
operator / validator
path:
PermissionedNodeRegistry
`0xaf42d795A6D279e9DCc19DC0eE1cE3ecd4ecf5dD`,
PermissionedPool
`0x09134C643A6B95D342BdAf081Fa473338F066572`,
PermissionlessNodeRegistry
`0x4f4Bfa0861F62309934a5551E0B2541Ee82fdcF1`,
PermissionlessPool
`0xd1a72Bd052e0d65B7c26D3dd97A98B74AcbBb6c5`,
SDCollateral
`0x7Af4730cc8EbAd1a050dcad5c03c33D2793EE91f`,
OperatorRewardsCollector
`0x84ffDC9De310144D889540A49052F6d1AdB2C335`,
NodeELRewardVault
`0x97c92752DD8a8947cE453d3e35D2cad5857367af`,
ValidatorWithdrawalVault
`0x3073cC90aD39E0C30bb0d4c70F981FbD00f3458f`.
Local clone
`/tmp/stader-ethx`. No
mainnet interaction.

Files:
`PermissionlessNodeRegistry.sol`,
`PermissionedNodeRegistry.sol`,
`PermissionlessPool.sol`,
`PermissionedPool.sol`,
`SDCollateral.sol`,
`OperatorRewardsCollector.sol`,
`ValidatorWithdrawalVault.sol`,
`NodeELRewardVault.sol`.

Checked for: a stranger
settling a vault and
taking user ETH; SD
slash that is not the
withdraw vault; pool
deposit that sends ETH
to a fake credential;
collector claim that
pays a stranger;
permissionless EL /
reward withdraw that
inflates ETHx.

Result: no
user-exploitable
finding. Not submitted.

- Withdraw-vault
  `settleFunds` is the
  node registry only.
  `distributeRewards`
  is permissionless
  under the rewards
  threshold (manager
  above it). User share
  goes to SPM, protocol
  to treasury, operator
  to the collector.
- Node-EL `withdraw` is
  permissionless and
  splits the same way.
  User share is
  `receiveExecutionLayerRewards`
  (raw balance only).
  Not a finding.
- Registry
  `markValidatorReadyToDeposit`
  / `withdrawnValidators`
  are oracle-only.
  Front-run sends 3 ETH
  of the 4 ETH bond to
  insurance and
  deactivates the
  operator. Invalid
  signature refunds the
  leftover 3 ETH to the
  operator collector.
- Pool
  `stakeUserETHToBeaconChain`
  is SPM-only. Pre /
  full deposits go to
  the official deposit
  contract with the
  factory withdraw
  credential for that
  vault. `receive` /
  `fallback` revert.
  Permissioned
  defective-key refund
  is registry-only and
  pays SPM from
  insurance + pool
  ETH.
- SD
  `slashValidatorSD`
  requires
  `msg.sender` to be
  that validator’s
  withdraw vault.
  `withdrawOnBehalf` is
  permissionless but
  only excess above
  threshold and pays
  the operator reward
  address (or utility
  repay). A gift, not
  theft.
- Collector `claim` /
  `claimWithAmount`
  debit `msg.sender`
  and pay
  `getOperatorRewardAddress
  (msg.sender)`.
  `depositFor` is a
  gift.

Do not file
permissionless vault
reward split or
oracle-gated front-run
as user theft.

Not submitted.
Remaining Stader
listed: StaderConfig,
Penalty, PoolSelector,
PoolUtils.

## 2026-09-03: Harvest Convex / Aura / Aave fold leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Vault /
controller and 4626
lend on the same pin
`0364901` are already
logged. This slice is
the Convex / Aura
farms and the Aave
fold. Local clone
`/tmp/harvest-strategy`.
No mainnet interaction.

Files:
`contracts/strategies/convex/ConvexStrategy.sol`,
`ConvexLendStrategy.sol`,
`aura/AuraStrategy.sol`,
`aave/AaveFoldStrategy.sol`.

Checked for: a stranger
unstaking Convex / Aura
LP; withdraw that pays
more than staked plus
idle; flash-loan
callback that is not
the Balancer vault;
fold that borrows
above the collateral
factor.

Result: no
user-exploitable
finding. Not submitted.

- Convex booster
  `poolInfo` LP must
  match `underlying`.
  `depositAll` stakes.
  `withdrawAllToVault`
  / `withdrawToVault`
  are `restricted`.
  Partial unwrap is
  capped at the reward
  pool balance; the
  later transfer of the
  requested amount
  reverts if unwrap was
  short. `invested`
  is staked plus idle.
  Curve
  `add_liquidity`
  `min = 0` runs only
  on hard-work (keeper
  sandwich, known
  Harvest pattern).
- Aura matches the
  Balancer pool LP and
  the Aura booster LP
  to `underlying`.
  Withdraw / salvage /
  hard-work follow the
  same Convex gates.
- Convex lend supplies
  the 4626 lending
  vault (`asset` =
  underlying), then
  stakes the vault
  shares in Convex
  (`poolInfo` LP =
  lending vault).
  Withdraw redeems
  `min(requested,
  idle)` after a
  partial unwrap.
- Aave fold requires
  aToken and variable
  debt
  `UNDERLYING_ASSET_ADDRESS`
  = underlying.
  Borrow target is
  strictly below the
  collateral factor.
  `receiveFlashLoan`
  requires
  `msg.sender ==
  bVault` and exactly
  one of
  `makingFlashDeposit`
  / `makingFlashWithdrawal`.
  Deposit supplies the
  flash amount then
  borrows the repay.
  Withdraw repays then
  redeems, then pays
  Balancer
  `amount + fee`.
  `invested` is idle +
  stored net −
  `pendingFee`.

Not submitted. Remaining
Harvest is Penpie /
Notional / StakeDAO /
Yel / ZeroLend /
CompoundV3 / Idle /
inactive + MorphoVault
V2 + polygon /
arbitrum.

## 2026-09-03: Harvest Penpie / Notional / StakeDAO / Yel leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Vault /
4626 lend / Convex
slices on the same pin
`0364901` are already
logged. This slice is
the Pendle/Penpie,
Notional nToken,
StakeDAO, and Yel
MasterChef strategies.
Local clone
`/tmp/harvest-strategy`.
No mainnet interaction.

Files:
`contracts/strategies/penpie/PenpieStrategy.sol`,
`notional/NotionalStrategy.sol`,
`stakeDao/StakeDaoStrategy.sol`,
`yel/YelStrategy.sol`.

Checked for: a stranger
unstaking Penpie /
StakeDAO / Yel LP;
withdraw that pays the
vault more than idle
plus staked;
permissionless salvage
of underlying.

Result: no
user-exploitable
finding. Not submitted.

- Penpie
  `depositMarket` /
  `withdrawMarket` go
  through the fixed
  helper. Withdraw and
  hard-work are
  `restricted`.
  Salvage refuses
  underlying / reward.
  Extra rewards swap
  through the
  liquidator with
  `minOut = 1` (known
  Harvest keeper
  sandwich).
- Notional holds
  nTokens as
  `underlying` on the
  strategy. Withdraw
  is a
  `restricted`
  transfer of that
  balance.
  `doHardWork` claims
  nToken incentives
  then mints more
  nTokens via
  `batchBalanceAction`.
- StakeDAO stakes the
  Curve LP in the
  StakeVault. Partial
  withdraw unstakes
  `min(staked, need)`
  then transfers the
  requested amount
  (reverts if short).
  Claim is accountant
  `try/catch`.
- Yel uses
  MasterChef
  `withdraw(poolId,
  amount)`. Same
  restricted withdraw
  / salvage pattern.

Not submitted. Remaining
Harvest is ZeroLend /
CompoundV3 / Idle /
inactive + MorphoVault
V2 + polygon /
arbitrum.

## 2026-09-03: Harvest ZeroLend / CompoundV3 / Idle leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Prior
Harvest slices on pin
`0364901` are already
logged. This slice is
ZeroLend fold wrappers,
Compound III Comet,
and Idle. Local clone
`/tmp/harvest-strategy`.
No mainnet interaction.

Files:
`contracts/strategies/zerolend/ZerolendFoldStrategyMainnet_*.sol`,
`ZerolendFoldStrategyFIXMainnet_WBTC.sol`,
`compoundV3/CompoundStrategy.sol`,
`idle/IdleStrategy.sol`.

Checked for: a stranger
redeeming Comet /
idleTokens; withdraw
that pays more than
supplied minus fee;
fold callback that is
not Balancer; salvage
of aTokens / idle
receipts.

Result: no
user-exploitable
finding. Not submitted.

- ZeroLend Mainnet
  contracts inherit
  `AaveFoldStrategy`
  (already logged).
  They only set
  ZeroLend aToken /
  debtToken / ZERO
  reward and fold
  factors (e.g. 870 /
  899 / 1000). The
  FIX WBTC variant
  inherits
  `AaveFoldStrategyFIX`.
  No new money path.
- Compound III
  `baseToken` must
  match `underlying`.
  Supply / withdraw
  go to that Comet.
  Fee is a slice of
  `current − stored`
  supplied. Withdraw
  and hard-work are
  `restricted`.
  Salvage refuses
  underlying / reward
  / market.
- Idle mints
  `idleToken` whose
  `token()` must match
  `underlying`. Redeem
  uses helper
  `getRedeemPrice` + 1
  wei. When
  `protected`, a
  rising redeem price
  reverts (virtual-
  price guard).
  Withdraw / hard-work
  are `restricted`.
  Salvage refuses
  idle receipts.

Not submitted. Remaining
Harvest is inactive +
MorphoVault V2 +
polygon / arbitrum
trees.

## 2026-09-03: Harvest inactive / MorphoVault V2 leftover (`0364901`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Prior
Harvest slices on pin
`0364901` are already
logged. This slice is
the inactive-vault
ERC4626 parking
strategy, Morpho vault
V2 (including
`morpho/v2`), the Morpho
reward pre-pay helper,
and the leftover
mainnet extras on the
same tree (sDAI,
StakeDAO lend, cvxCRV).
Local clone
`/tmp/harvest-strategy`.
No mainnet interaction.

Files:
`contracts/strategies/inactive/InactiveVaultERC4626Strategy.sol`,
`InactiveVaultERC4626StrategyMainnet_USDC.sol`,
`morpho/MorphoVaultStrategyV2.sol`,
`morpho/v2/MorphoVaultV2Strategy.sol`,
`base/RewardPrePayMorpho.sol`,
`sky/SavingsDaiStrategy.sol`,
`stakeDao/StakeDAOLendStrategy.sol`,
`convex/ConvexStrategyCvxCRV.sol`.

Checked for: a stranger
redeeming the parked
4626 / Morpho / sDAI
shares; withdraw that
pays the vault more
than idle plus supplied
minus reserved fee;
permissionless
`morphoClaim` that
forwards arbitrary
calls; salvage of
receipt tokens by a
third party.

Result: no
user-exploitable
finding. Not submitted.

- Inactive
  `IERC4626.asset()`
  must match
  `underlying`. The
  whole 4626 increase
  is fee (depositors
  keep a flat share
  price). A dip nets
  against unpaid fee
  so a later recovery
  cannot mint fee from
  principal. User
  `_redeem` uses 4626
  `withdraw` and
  reverts if short.
  Fee redeem uses
  `maxWithdraw`.
  `invested` is idle +
  stored − pending
  fee. Withdraw /
  hard-work are
  `restricted`.
  Salvage refuses
  underlying / fToken.
- Morpho V2 /
  `MorphoVaultV2Strategy`
  require Morpho
  `asset()` =
  `underlying`.
  `currentSupplied` is
  `convertToAssets` of
  this strategy’s
  shares. Fee is a
  slice of
  `current − stored`.
  `withdrawToVault`
  transfers the
  requested amount
  (reverts if short).
  Reward swaps use
  `minOut = 1` (known
  Harvest keeper
  sandwich). Streaming
  only delays sale;
  it does not move
  principal.
- `morphoClaim` is an
  arbitrary call to
  `distr` that then
  forwards the MORPHO
  delta to
  `morphoPrePay`.
  Callers are
  `morphoPrePay` or
  governance.
  `RewardPrePayMorhpo`
  wraps that behind
  `onlyHardWorkerOrGovernance`
  and only adjusts
  its own earned /
  claimed ledger. Not
  a third-party drain.
- sDAI requires
  `IERC4626.asset()` =
  `underlying`. Same
  stored / pending-fee
  4626 pattern.
  Withdraw is
  `restricted`.
- StakeDAO lend
  requires the lending
  vault `asset()` =
  `underlying` and the
  StakeDAO vault
  `asset()` = lending
  vault LP. Unwrap
  previews the LP
  amount, withdraws
  that + 1 from the
  stake vault, then
  4626-withdraws
  underlying.
  Restricted; `minOut
  = 1` on reward
  swaps.
- cvxCRV requires the
  Convex reward pool
  `stakingToken` =
  `underlying`.
  Partial unwrap +
  transfer of the
  requested amount
  reverts if short.
  CRV is either
  Curve-swapped to
  cvxCRV with
  `min = crvIn` or
  deposited via
  `crvDeposit`.

Not submitted. Remaining
Harvest is the polygon
(`f24a06a`) and
arbitrum trees.

## 2026-09-03: Harvest polygon CompoundBlue / chef leftover (`f24a06a`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Listed
GitHub tree
`harvestfi/harvest-strategy-polygon`
(3 Apr 2023). Local
clone
`/tmp/harvest-strategy-polygon`
at `f24a06a`
(`Add merkl toggle`).
No mainnet interaction.

Files:
`contracts/strategies/compound-blue/CompoundBlueStrategy.sol`,
`base/masterchef-base/MasterChefStrategy.sol`,
`base/sushi-base/MiniChefV2Strategy.sol`,
`base/ape-base/MiniApeV2Strategy.sol`,
`base/noop/NoopStrategy.sol`.

Checked for: a stranger
redeeming MetaMorpho /
chef LP; withdraw that
pays more than idle
plus staked; chef
`deposit` to a
mismatched LP; salvage
of receipt tokens by a
third party.

Result: no
user-exploitable
finding. Not submitted.

- Compound Blue
  (MetaMorpho)
  `asset()` must match
  `underlying`. Supply
  deposits to
  `address(this)`.
  Fee is a slice of
  `current − stored`
  previewRedeem.
  Withdraw /
  hard-work are
  `restricted`.
  Transfer of the
  requested amount
  reverts if short.
  Salvage refuses
  underlying / reward
  / market. Reward
  swaps use
  `minOut = 1` (known
  Harvest keeper
  sandwich).
- MasterChef
  `poolInfo(poolId)`
  LP must equal
  `underlying`.
  MiniChef /
  MiniApe
  `lpToken(poolId)`
  must equal
  `underlying`.
  Deposit / withdraw
  go to
  `address(this)`.
  Partial unwrap is
  capped at the chef
  balance; transfer
  of the requested
  amount reverts if
  short. Router
  `amountOutMin = 1`
  and
  `addLiquidity`
  mins of 1 are the
  same trusted-keeper
  path. Routes start
  empty and are
  governance-set.
- Noop holds idle
  underlying only.
  Withdraw requires
  `balance >= amount`
  and is
  `restricted`.
  Salvage mapping
  marks underlying
  unsalvageable.

Not submitted. Remaining
Harvest polygon is
Aave / Aura /
Balancer / Convex /
Gamma / Idle / Quick
Gamma / Pearl /
Meshswap / Jarvis /
Complifi / compound-v2
wrappers. Remaining
Harvest listed tree is
`harvest-strategy-arbitrum`
`125270d`.

## 2026-09-03: Harvest polygon Aave / Aura / Balancer / Convex / Idle leftover (`f24a06a`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Listed
GitHub tree
`harvestfi/harvest-strategy-polygon`
(3 Apr 2023). CompoundBlue
/ chef leftover on pin
`f24a06a` is already
logged. Local clone
`/tmp/harvest-strategy-polygon`.
No mainnet interaction.

Files:
`contracts/strategies/aave/AaveSupplyStrategy.sol`,
`aura/AuraStrategy.sol`,
`balancer/BalancerStrategyV3.sol`,
`convex/base/ConvexStrategy.sol`,
`idle/IdleFinanceStrategy.sol`.

Checked for: a stranger
redeeming aTokens /
Aura BPT / Idle
receipts; withdraw that
pays more than idle
plus staked; booster
or Balancer pool that
does not match
`underlying`.

Result: no
user-exploitable
finding. Not submitted.

- Aave supply requires
  `aToken.UNDERLYING_ASSET_ADDRESS()`
  = `underlying`.
  Supply / withdraw
  go to
  `address(this)` via
  `aToken.POOL()`.
  Fee is a slice of
  `current − stored`
  aToken balance.
  Withdraw /
  hard-work are
  `restricted`.
  Transfer of the
  requested amount
  reverts if short.
  Salvage refuses
  underlying / aToken.
- Aura requires
  Balancer
  `getPool` LPT and
  Aura
  `poolInfo` LPT both
  equal `underlying`.
  Deposit uses
  `booster.depositAll`.
  Partial unwrap is
  capped at the Aura
  balance; transfer
  of the requested
  amount reverts if
  short. Reward swaps
  and Balancer join
  use `minOut = 1`
  (known Harvest
  keeper sandwich).
- Balancer V3
  `getPool(poolId)`
  LPT must equal
  `underlying`.
  Same restricted
  unwrap + exact
  transfer. Swap
  routes and Balancer
  hop pool IDs are
  governance-set.
- Convex booster
  `poolInfo` LP must
  equal `underlying`.
  Same restricted
  unwrap + exact
  transfer.
- Idle is a
  non-upgradeable
  strategy. Withdraw
  is `restricted`.
  `protected` blocks
  a falling Idle
  price. Redeem
  requires the
  underlying received
  ≥ requested (or ≥
  idle × stored
  virtual price on
  full exit). Salvage
  marks underlying
  and idle receipts.

Not submitted. Remaining
Harvest polygon is
Gamma / Quick Gamma /
Pearl / Meshswap /
Jarvis / Complifi /
compound-v2 / Yel /
Ape wrappers. Remaining
listed tree is
`harvest-strategy-arbitrum`
`125270d`.

## 2026-09-03: Harvest polygon Gamma / Pearl / Meshswap leftover (`f24a06a`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Aave /
Aura leftover on the
same pin `f24a06a` is
already logged. This
slice is Gamma Merkl,
Quick Gamma (V1/V2),
Uniswap Gamma, Pearl
hodl, Caviar, and
Meshswap. Local clone
`/tmp/harvest-strategy-polygon`.
No mainnet interaction.

Files:
`contracts/strategies/gamma-merkl/GammaMerklStrategy.sol`,
`quick-gamma/QuickGammaStrategy.sol`,
`quick-gamma/QuickGammaStrategyV2.sol`,
`uniswap-gamma/UniswapGammaStrategy.sol`,
`pearl/PearlHodlStrategy.sol`,
`pearl/CaviarStrategy.sol`,
`meshswap/MeshswapStrategy.sol`.

Checked for: a stranger
redeeming hypervisor /
gauge / chef LP;
withdraw that pays
more than idle plus
staked; chef or gauge
`deposit` to a
mismatched LP; salvage
of receipt tokens by a
third party.

Result: no
user-exploitable
finding. Not submitted.

- Gamma Merkl holds
  hypervisor LP idle
  (no stake). Withdraw
  is `restricted` and
  transfers the
  requested amount
  (reverts if short).
  Reward swaps and
  UniProxy deposit use
  `minOut = 1` / zero
  minIn (known Harvest
  keeper sandwich).
- Quick Gamma V1/V2
  require MasterChef
  `lpToken(poolId)` =
  `underlying`.
  Partial chef
  withdraw is capped;
  transfer of the
  requested amount
  reverts if short.
- Uniswap Gamma
  requires the
  staking-rewards
  `stakingToken` =
  `underlying`. Same
  restricted unwrap +
  exact transfer.
- Pearl hodl requires
  gauge `TOKEN()` =
  `underlying`.
  Rewards are swapped
  and deposited into a
  separate hodl vault,
  then notified to a
  PotPool (not
  returned as vault
  principal). Partial
  gauge withdraw is
  capped.
- Caviar requires
  chef `underlying()`
  = strategy
  `underlying`. Same
  restricted unwrap +
  exact transfer.
  Only the claimed
  underlying slice is
  treated as reward.
- Meshswap holds the
  Mesh pair LP idle
  and claims on the
  pair. Withdraw is
  `restricted`.
  `addLiquidity` mins
  of 1 are keeper-
  trusted. Token0 /
  token1 are read from
  the pair.

Not submitted. Remaining
Harvest polygon is
Jarvis / Complifi /
compound-v2 / Yel /
Ape wrappers. Remaining
Harvest listed tree is
`harvest-strategy-arbitrum`
`125270d`.

## 2026-09-03: Harvest polygon Jarvis / Complifi / Compound / Yel leftover (`f24a06a`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Gamma /
Pearl leftover on the
same pin `f24a06a` is
already logged. This
slice is Jarvis V3 +
hodl, Complifi +
derivative, Compound
Comet, Yel, and Ape
wrappers. Local clone
`/tmp/harvest-strategy-polygon`.
No mainnet interaction.

Files:
`contracts/strategies/jarvis/JarvisStrategyV3.sol`,
`jarvis/JarvisHodlStrategyV3.sol`,
`complifi/ComplifiStrategy.sol`,
`complifi/ComplifiDerivStrategy.sol`,
`compound/CompoundStrategy.sol`,
`yel/YelStrategy.sol`,
`ape/ApeStrategyMainnet_*.sol`.

Checked for: a stranger
redeeming chef / Comet
/ derivative positions;
withdraw that pays
more than idle plus
staked; chef `deposit`
to a mismatched LP;
salvage of receipt
tokens by a third
party.

Result: no
user-exploitable
finding. Not submitted.

- Jarvis V3 requires
  ElysianFields
  `poolInfo` LP =
  `underlying` and one
  DMM token = reward.
  Partial chef
  withdraw is capped;
  transfer of the
  requested amount
  reverts if short.
  Kyber zap uses
  `minLpQty = 1`
  (known keeper
  sandwich). Hodl
  zaps rewards into a
  separate LP, deposits
  a hodl vault, and
  notifies a PotPool
  (not vault
  principal).
- Complifi requires
  `poolInfo` LP =
  `underlying`. Same
  restricted unwrap +
  exact transfer.
  Router mins of 1
  are keeper-trusted.
- Complifi derivative
  stakes underlying +
  up/down tokens.
  `investedUnderlyingBalance`
  counts only the
  underlying pid +
  idle (up/down are
  extra). Partial
  withdraw unwraps
  only the underlying
  pid. `redeemDerivatives`
  is governance-only.
- Compound Comet
  `baseToken` must
  match `underlying`.
  Fee is a slice of
  `current − stored`.
  Withdraw /
  hard-work are
  `restricted`.
  Salvage refuses
  underlying / reward
  / market.
- Yel requires
  MasterChef
  `poolInfo` LP =
  `underlying`. Same
  restricted unwrap +
  exact transfer.
- Ape Mainnet files
  only set MiniApe
  pool + routes
  (chef leftover
  already logged).
  Genomes are Noop
  wrappers (already
  logged).

Not submitted. Listed
Harvest polygon GitHub
leftover is exhausted.
Remaining Harvest
listed tree is
`harvest-strategy-arbitrum`
`125270d`.

## 2026-09-03: Harvest Arbitrum Camelot / Silo / Venus leftover (`125270d`)

Immunefi program
`harvest` ($100,000,
`kyc: false`). Listed
GitHub tree
`harvestfi/harvest-strategy-arbitrum`
(3 Apr 2023; re-added
15 Mar 2024). Local
clone
`/tmp/harvest-strategy-arbitrum`
at `125270d`
(`Merge pull request #29
from Crypto-One-dev/stakedao-llama-vaults`).
No mainnet interaction.

Files:
`contracts/strategies/camelot/CamelotV3Strategy.sol`,
`silo/SiloLendStrategy.sol`,
`silo/SiloVaultStrategy.sol`,
`venus/VenusFoldStrategy.sol`.
Aave / Aura / Dolomite /
Euler / Fluid / Morpho /
Notional / StakeDAO on
this tree reuse the
already-logged mainnet
money paths.

Checked for: a stranger
redeeming Silo shares
or hypervisor LP;
Venus flash callback
that is not Balancer;
withdraw that pays more
than idle plus supplied
minus fee.

Result: no
user-exploitable
finding. Not submitted.

- Camelot holds Gamma
  hypervisor LP idle
  (`underlying` is the
  LP). Withdraw /
  hard-work are
  `restricted`.
  Transfer of the
  requested amount
  reverts if short.
  Reward swaps use
  `minOut = 1`. xGRAIL
  is deposited to a
  configured vault and
  notified to
  `potPool` (extra
  reward, not
  principal).
- Silo lend / vault
  require 4626
  `asset()` =
  `underlying`.
  Supply / redeem pay
  `address(this)`.
  Fee is a slice of
  `current − stored`.
  Withdraw is
  `restricted`.
  Transfer uses
  `min(requested,
  idle)` after redeem.
- Venus fold requires
  `cToken.underlying()`
  = `underlying`.
  Borrow target is
  strictly below the
  collateral factor.
  `receiveFlashLoan`
  requires
  `msg.sender ==
  bVault` and XOR of
  `makingFlashDeposit`
  / `makingFlashWithdrawal`.
  Deposit supplies
  then borrows the
  repay. Withdraw
  repays then redeems,
  then pays Balancer
  `amount + fee`.
  `invested` is idle +
  stored net −
  `pendingFee`.

Not submitted. Listed
Harvest GitHub leftover
(mainnet + polygon +
Arbitrum unique bases)
is exhausted.

## 2026-09-03: Marinade crank / withdraw-stake leftover (`b8fe3f8`)

Immunefi program
`marinade` ($250,000,
`kyc: false`). User /
LP leftover on the same
pin `b8fe3f8` is
already logged. This
slice is the crank and
`withdraw_stake_account`
path. Local clone
`/tmp/marinade-lsp`.
No mainnet interaction.

Files:
`instructions/crank/stake_reserve.rs`,
`deactivate_stake.rs`,
`merge_stakes.rs`,
`user/withdraw_stake_account.rs`,
`admin/emergency_pause.rs`.

Checked for: a crank
that stakes reserve
SOL to a stranger’s
stake account; merge
that sends active
stake to
`operational_sol`;
withdraw-stake that
pays more SOL than the
burned mSOL; pause
without the pause
authority.

Result: no
user-exploitable
finding. Not submitted.

- `stake_reserve` is
  permissionless. The
  new stake is
  initialized with the
  deposit / withdraw
  PDAs. Reserve
  transfers only to
  that account and
  only when the
  validator is under
  target and inside
  the epoch stake-
  delta window. Extra
  same-epoch runs
  consume
  `extra_stake_delta_runs`.
- `deactivate_stake`
  checks the stake
  list entry, vote, and
  last-update
  delegation. Split /
  deactivate is signed
  by the deposit PDA.
- `merge_stakes` merges
  two listed accounts
  for the same
  validator. Rent /
  leftover SOL on the
  source goes to
  `operational_sol_account`
  (the documented
  ops wallet), not a
  caller-chosen
  destination.
- `withdraw_stake_account`
  is feature-gated.
  It checks the token
  source, burns the
  caller’s mSOL (fee
  slice to treasury),
  splits
  `msol_to_sol − fee`
  with min-stake
  remainder, then
  authorizes the split
  account’s staker and
  withdrawer to
  `beneficiary`.
- Pause / resume
  require
  `pause_authority`.

Not submitted. Remaining
Marinade is admin
config / authority,
validator add-remove /
score / emergency
unstake, crank
`update` /
`create_canonical_stake`
/ delinquent upgrade.

## 2026-09-03: Marinade admin / validator / update leftover (`b8fe3f8`)

Immunefi program
`marinade` ($250,000,
`kyc: false`). User /
LP and crank /
withdraw-stake leftovers
on pin `b8fe3f8` are
already logged. This
slice is admin config,
validator management,
and the remaining crank
update / delinquent
paths. Local clone
`/tmp/marinade-lsp`.
No mainnet interaction.

Files:
`instructions/admin/change_authority.rs`,
`config_marinade.rs`,
`config_lp.rs`,
`config_validator_system.rs`,
`initialize.rs`,
`management/add_validator.rs`,
`remove_validator.rs`,
`set_validator_score.rs`,
`emergency_unstake.rs`,
`partial_unstake.rs`,
`crank/update.rs`,
`create_canonical_stake.rs`,
`finalize_delinquent_upgrade.rs`.

Checked for: a stranger
changing admin /
fees / authorities;
validator add that
skips the manager;
emergency unstake that
sends SOL to the
caller; update that
mints mSOL to a
stranger or withdraws
rewards off the reserve
PDA.

Result: no
user-exploitable
finding. Not submitted.

- `change_authority`,
  `config_marinade`,
  and `config_lp`
  require
  `admin_authority`.
  Reward / delayed-
  unstake / withdraw-
  stake / deposit fees
  are capped.
  `config_lp`
  re-validates min ≤
  max. `min_deposit`
  may be 0 or
  `u64::MAX` (deposit
  stop), documented.
- Validator manager
  (not a stranger)
  adds / removes /
  scores / emergency-
  unstakes / partial-
  unstakes.
  Add creates a
  0-space PDA flag.
  Remove sends the
  flag’s rent to
  `operational_sol_account`
  (`has_one`).
  Emergency unstake
  requires score 0,
  listed stake +
  vote, and
  deactivates via the
  deposit PDA. Partial
  unstake is capped at
  the validator’s
  score target; unused
  split rent returns
  to the payer.
- `initialize` takes
  a zeroed state,
  empty mSOL mint
  with PDA mint
  authority, and
  reserve PDA bump.
- Crank `update` is
  permissionless.
  Extra / deactivated
  lamports withdraw
  to the reserve PDA
  via the withdraw
  PDA. Protocol fee
  mints mSOL to the
  configured treasury
  at the pre-update
  price. Deactivated
  rent goes to
  `operational_sol_account`
  only.
- `finalize_delinquent_upgrade`
  only walks the
  upgrade cursor and
  writes validator
  active balances
  back from the
  snapshot. No SOL
  leaves the program.

Not submitted. Remaining
Marinade listed GitHub
is `create_canonical_stake`
split / list-realloc
details if a later
tree adds them.

## 2026-09-03: Marinade create-canonical / realloc leftover (`b8fe3f8`)

Immunefi program
`marinade` ($250,000,
`kyc: false`). Admin /
validator / update
leftover on pin
`b8fe3f8` is already
logged. This slice is
the remaining crank
split and list realloc.
Local clone
`/tmp/marinade-lsp`.
No mainnet interaction.

Files:
`instructions/crank/create_canonical_stake.rs`,
`admin/realloc_stake_list.rs`,
`admin/realloc_validator_list.rs`.

Checked for: a crank
that splits listed
stake to a caller-
chosen account; leftover
SOL on the canonical
PDA going to the
caller; realloc that
shrinks a list and
deletes records.

Result: no
user-exploitable
finding. Not submitted.

- `create_canonical_stake`
  is permissionless
  but the destination
  must be the PDA
  `find_canonical_stake_address(state,
  validator)`. Source
  must be listed,
  delegated, not
  deactivating, and
  `last_update_delegated_lamports`
  must equal the live
  delegation. The
  vote must match the
  validator index.
  Extra lamports on
  the canonical system
  account go to
  `operational_sol_account`
  (`has_one`). Split
  is signed by the
  deposit PDA and
  moves the whole
  source (stake +
  rent) onto that
  PDA. The list then
  adds the canonical
  account and removes
  the source. No SOL
  leaves to the
  caller.
- `realloc_stake_list`
  / `realloc_validator_list`
  require
  `admin_authority`.
  Capacity cannot
  shrink below the
  current count.

Not submitted. Listed
Marinade GitHub leftover
is exhausted.

## 2026-09-03: Instadapp DSA leftover (`fef062a`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Listed
smart-contract trees
are `dsa-contracts`,
`avocado-contracts-public`,
`fluid-contracts-public`,
and `inst-governance`.
This slice is DSA.
Local clone
`/tmp/instadapp-dsa` at
`fef062a`
(`Merge pull request #87
from Instadapp/security/harden-ci-pull-request-target`).
No mainnet interaction.

Files:
`contracts/registry/index.sol`,
`v2/accounts/module1/Implementation_m1.sol`,
`v2/accounts/default/implementation_default.sol`,
`v2/proxy/accountProxy.sol`,
`v2/registry/implementations.sol`,
`v2/registry/connectors.sol`.

Checked for: a stranger
`cast` on another
user’s DSA; adding a
malicious implementation
or connector; `enable`
that grants a stranger
auth.

Result: no
user-exploitable
finding. Not submitted.

- `cast` requires
  `_auth[msg.sender]`
  or `msg.sender ==
  instaIndex`. Spells
  `delegatecall` only
  connectors returned
  by
  `isConnectors`
  (name → address
  must be registered
  and non-zero).
- `enable` is
  `self` or
  `instaIndex`.
  `disable` /
  `toggleBeta` are
  `self` only.
- Implementations
  add / remove /
  default are
  `instaIndex.master`.
  Connectors add /
  update / remove are
  chief or master.
- `build` clones the
  versioned account
  module, `list.init`s
  it, and
  `enable`s the
  requested owner.
  `buildWithCast` only
  casts on the new
  account.

Not submitted. Remaining
Instadapp is Avocado,
Fluid, and
`inst-governance`.

## 2026-09-03: Instadapp Avocado leftover (`0bc1dd9`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). DSA on
the same program is
already logged. This
slice is Avocado.
Local clone
`/tmp/instadapp-avocado`
at `0bc1dd9`. No
mainnet interaction.

Files:
`contracts/AvoDepositManager.sol`,
`AvocadoMultisig/AvocadoMultisig.sol`,
`AvocadoMultisig/AvocadoMultisigCore.sol`,
`AvoForwarder.sol`,
`AvoFactory.sol`.

Checked for: a stranger
`cast` on another
user’s Avocado;
withdraw of pooled
deposit-token without
auth; flashloan
callback that runs
unsigned actions;
forwarder execute that
targets the wrong
wallet.

Result: no
user-exploitable
finding. Not submitted.

- `cast` requires
  `msg.sender ==
  avoForwarder`.
  Signatures recover
  allowed signers
  (ordered, enough
  for `requiredSigners`).
  Digest includes
  chain salt. Nonce
  −1 occupies a
  non-sequential slot.
  `castAuthorized`
  uses the same
  verifier without the
  forwarder.
- `executeOperation`
  requires a
  transient hash of
  the callback data +
  `initiator == this`.
  `_callTargets`
  requires its own
  transient hash.
- Forwarder
  `executeV1` is
  `onlyBroadcaster`
  and deploys /
  calls the Avocado
  for `from_` +
  `index_`.
- Deposit manager
  `depositOnBehalf`
  only pulls tokens
  in. `requestWithdraw`
  is `onlyAvocado`.
  Source / referral
  request is
  permissionless but
  `processWithdraw`
  is `onlyAuths` and
  pays the stored
  `to`. Balances are
  off-chain by
  design. Auths are
  trusted operators.
  `systemWithdraw`
  is `onlyAuths`.

Not submitted. Remaining
Instadapp is Fluid and
`inst-governance`.

## 2026-09-03: Stader Penalty / PoolSelector / PoolUtils / Config leftover (`9d4a921`)

Immunefi program
`staderforeth`
($1,000,000, `kyc: false`).
User path, oracle /
factory / insurance /
auction / socializing,
and registries / vaults
/ SD / pools on the
same pin `9d4a921` are
already logged. This
slice is the last
listed etherscan
leftover:
StaderConfig
`0x4ABEF2263d5A5ED582FC9A9789a41D85b68d69DB`,
Penalty
`0x84645f1B80475992Df2C65c28bE6688d15dc6ED6`,
PoolSelector
`0x62e0b431990Ea128fe685E764FB04e7d604603B0`,
PoolUtils
`0xeDA89ed8F89D786D816F8E14CF8d2F90c6BF763f`.
The last listed row is
Primacy of Impact
(`immunefi.com`). Local
clone `/tmp/stader-ethx`.
No mainnet interaction.

Files:
`Penalty.sol`,
`PoolSelector.sol`,
`PoolUtils.sol`,
`StaderConfig.sol`.

Checked for: a stranger
zeroing another
validator’s penalty
before settle; reward
share math that pays
the operator the user
leg; pool allocation
that a stranger can
redirect; config
setters that are not
role-gated.

Result: no
user-exploitable
finding. Not submitted.

- Penalty
  `updateTotalPenaltyAmount`
  is permissionless
  accounting from Rated
  MEV strikes plus
  oracle missed-
  attestation counts
  plus manager
  `additionalPenaltyAmount`.
  `markValidatorSettled`
  requires
  `msg.sender` to be
  that validator’s
  withdraw vault
  (`getPubkeyForValidSender`)
  and zeros that
  pubkey’s total.
  Additional / per-
  strike / Rated
  address updates are
  manager-only.
- PoolUtils
  `processValidatorExitList`
  is operator-role and
  only emits
  `ExitValidator`.
  `processOperatorExit`
  is SD utility pool
  only and also only
  emits.
  `calculateRewardShare`
  is view: user share
  is remainder after
  protocol fee on the
  user-ETH fraction and
  operator collateral +
  operator fee.
  `addNewPool` /
  `updatePoolAddress`
  are admin.
- PoolSelector
  `computePoolAllocationForDeposit`
  is view.
  `poolAllocationForExcessETHDeposit`
  is SPM-only and
  walks pools from
  `poolIdArrayIndexForExcessDeposit`.
  Weights update is
  manager and must sum
  to 10000.
- StaderConfig
  address / token /
  implementation
  setters are
  `DEFAULT_ADMIN_ROLE`.
  Amount / threshold
  setters are MANAGER
  or admin. Batch-size
  is OPERATOR.

Do not file
permissionless penalty
refresh or operator-
role exit events as
user theft.

Not submitted. Listed
Stader leftover is
exhausted (remaining
row is Primacy of
Impact).

## 2026-09-03: Symbiosis MetaRouter leftover (Sourcify)

Immunefi program
`symbiosis`
($100,000, `kyc: false`).
Listed leftover is
MetaRouter +
MetaRouterGateway on
Ethereum, BSC,
Avalanche, and Polygon
(2022 explorer rows).
Ethereum Sourcify
`exact_match` on
MetaRouter
`0xf621Fb08BBE51aF70e7E0F4EA63496894166Ff7F`
and Gateway
`0xfCEF2Fe72413b65d3F393d278A714caD87512bcd`
(solc 0.8.7, verified
2024-08-08). Other
chains returned
Sourcify 400; same
type labels. Extract
`/tmp/symbiosis`. No
mainnet interaction.

Files:
`contracts/synth-core/metarouter/MetaRouter.sol`,
`MetaRouterGateway.sol`,
`MetaRouteStructs.sol`.

Checked for: a stranger
using someone else’s
Gateway approval;
arbitrary DEX /
relay calldata that
spends a victim’s
tokens; leftover on
the router that a
stranger can take as
user funds at rest.

Result: no
user-exploitable
finding. Not submitted.

- Gateway
  `claimTokens` is
  `onlyMetarouter` and
  `transferFrom`s
  `_from`. `metaRoute`
  always claims
  `_msgSender()`. A
  Gateway approval
  cannot be spent by a
  third party.
- `metaRoute` then
  `call`s user-chosen
  DEX / relay
  contracts (not the
  Gateway) and
  patches swap /
  other-side amounts
  from this
  contract’s
  `balanceOf`. That is
  the caller’s own
  route.
- `externalCall`,
  `returnSwap`, and
  `metaMintSwap` are
  permissionless and
  only move tokens
  already on the
  router. Comments say
  Portal / Synthesis
  call them; there is
  no caller gate.
  Failed
  `externalCall`
  refunds `_amount` to
  `_to`. That can
  sweep leftover
  sitting on the
  router. Do not file
  without a proven
  official flow that
  parks user funds on
  MetaRouter across
  transactions.
- `metaMintSwap`
  leftover of the last
  `swapTokens` entry
  is sent to `to`.

Do not file leftover
sweep or user-supplied
router calldata as
theft of funds at
rest.

Not submitted. Listed
Symbiosis leftover is
exhausted.

## 2026-09-03: Benqi core markets leftover (Sourcify + `e0cfd24`)

Immunefi program
`benqi`
($500,000, `kyc: false`).
Dual Oracle leftover
is already logged.
This slice is the
core money path:
Unitroller
`0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`,
qiAVAX
`0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c`,
qiUSDC
`0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F`,
and Maximillion
`0xd78DEd803b28A5A9C860c2cc7A4d84F611aA4Ef8`.
Avalanche Sourcify
`match` (solc 0.5.17,
verified 2024-08-08).
Official tree
`Benqi-fi/BENQI-Smart-Contracts`
`e0cfd24`. Extract
`/tmp/benqi`. No
mainnet interaction.

Files:
`lending/QiToken.sol`,
`Comptroller.sol`,
`QiAvax.sol`,
`QiErc20Delegator.sol`,
`Maximillion.sol`,
`Unitroller.sol`.

Checked for: a
stranger minting to
themselves from a
victim’s tokens;
redeem that pays more
underlying than the
burned qiTokens;
liquidation / seize
that pulls collateral
without a listed
shortfall; Maximillion
that keeps excess
AVAX; Unitroller
implementation swap
without admin.

Result: no
user-exploitable
finding. Not submitted.

- Empty-market
  `exchangeRateStoredInternal`
  returns
  `initialExchangeRateMantissa`.
  Live listed markets
  have supply. Do not
  file vanilla
  Compound first-
  depositor inflation
  without proving a
  listed market is
  empty.
- `mintFresh` pulls
  from the minter and
  mints to the minter.
  `redeemFresh` burns
  the redeemer’s
  qiTokens and pays
  the redeemer.
  `mintAllowed`
  requires the market
  listed and not
  mint-paused.
- QiAvax fallback
  mints. `getCashPrior`
  subtracts `msg.value`
  so the incoming mint
  is not in the rate.
  `doTransferIn`
  requires
  `msg.sender == from`
  and
  `msg.value == amount`.
- Liquidate requires
  both markets listed,
  borrower shortfall,
  and repay ≤ close
  factor.
  `seize` uses
  `msg.sender` as
  seizerToken.
  `seizeAllowed`
  requires both
  markets listed and
  the same comptroller.
  Protocol seize share
  goes to reserves.
- Maximillion
  `repayBehalf` refunds
  excess AVAX to
  `msg.sender`.
  Delegator
  `_setImplementation`
  is admin.
  Unitroller
  `_setPendingImplementation`
  is admin;
  `_acceptImplementation`
  is the pending
  implementation.

Do not file Compound
first-depositor
inflation, Maximillion
excess refund, or
seize-via-msg.sender
as a finding.

Not submitted. Other
listed qiToken markets
(qiLINK / qiETH
Sourcify `match`,
same 0.5.17 type) are
the same QiAvax /
QiErc20Delegator
path. Remaining Benqi
listed: isolated
unitroller
`0xD7c4006d…763F`
(Sourcify 404), QI
token, gauges, sAVAX,
Ignite, veQI,
distributors, token
sale, staking proxies,
JumpRateModel
(Sourcify 404), Pause
Guardian.

## 2026-09-03: Benqi QI token leftover (Sourcify + `e0cfd24`)

Immunefi program
`benqi`
($500,000, `kyc: false`).
Core markets leftover
is already logged.
This slice is QI
`0x8729438EB15e2C8B576fCc6AeCdA6A148776C0F5`.
Avalanche Sourcify
`match` (solc 0.5.16,
verified 2024-08-08,
`Qi.sol:Qi`). Official
tree
`lending/Governance/Qi.sol`
at `e0cfd24` matches
aside from line
endings. Extract
`/tmp/benqi/src/QI.sol`.
No mainnet
interaction.

Files:
`lending/Governance/Qi.sol`.

Checked for: a mint
after construct; a
transfer / transferFrom
that credits more than
it debits; permit or
delegateBySig that
moves another user’s
tokens without their
signature.

Result: no
user-exploitable
finding. Not submitted.

- Constructor mints
  the constant
  `totalSupply`
  (7.2e9 × 1e18) to
  one account. There
  is no later mint.
  Balances are
  `uint96`; supply
  fits.
- `transfer` /
  `transferFrom` use
  `safe96` / `sub96` /
  `add96`. Zero
  address is blocked.
  Infinite allowance
  is `uint96(-1)`.
- `permit` hashes
  `rawAmount` and
  increments the
  nonce before
  `ecrecover`. Invalid
  signatures burn the
  nonce (COMP-token
  griefing). Do not
  file.
- `delegateBySig`
  binds chain id and
  consumes
  `nonces[signatory]`.
  Votes follow
  balances via
  `_moveDelegates`.

Do not file COMP-style
permit nonce griefing
or missing mint as a
finding.

Not submitted.
Remaining Benqi
listed: isolated
unitroller (Sourcify
404), gauges / sAVAX /
veQI (Sourcify is the
proxy only), Ignite /
MultiReward /
JumpRateModel / Pause
Guardian / sAVAX
timelock (Sourcify
404), token sale
(proxy `exact_match`),
staking proxies.

## 2026-09-03: Benqi token-sale distributor leftover (`e0cfd24`)

Immunefi program
`benqi`
($500,000, `kyc: false`).
QI token leftover is
already logged. This
slice is
QiTokenSaleDistributorProxy
`0x77533A0b34cd9Aa135EBE795dc40666Ca295C16D`.
Avalanche Sourcify
`exact_match` (solc
0.6.12, verified
2024-08-08). Official
tree
`token_sale/` at
`e0cfd24`. No mainnet
interaction.

Files:
`token_sale/QiTokenSaleDistributor.sol`,
`QiTokenSaleDistributorProxy.sol`,
`QiTokenSaleDistributorStorage.sol`.

Checked for: a
stranger claiming
another recipient’s
vested QI; claim that
pays more than vested
minus already claimed;
proxy implementation
swap without admin.

Result: no
user-exploitable
finding. Not submitted.

- `claim` is
  `nonReentrant` and
  only walks
  `msg.sender` rounds.
  It adds the newly
  claimable amount to
  `claimedTokens` then
  `transfer`s QI to
  `msg.sender`.
- Vesting uses
  constant
  `vestingScheduleEpoch`
  and monthly
  `releasePeriodLength`.
  Claimable is
  vested-to-date minus
  claimed. Admin
  `setPurchasedTokensByUser`
  pre-marks the
  initial-release
  slice as claimed
  (bookkeeping, not a
  stranger path).
- `setPurchasedTokensByUser`
  /
  `resetPurchasedTokensByUser`
  are
  `adminOrDataAdminOnly`.
  `withdrawQi` and
  `setQiContractAddress`
  are `adminOnly`.
- Proxy
  `setPendingImplementation`
  is admin;
  `acceptPendingImplementation`
  is the pending
  implementation.

Do not file admin
`withdrawQi` or
data-admin allocation
as a user finding.

Not submitted.
Remaining Benqi
listed: isolated
unitroller (Sourcify
404), gauges / sAVAX /
veQI (proxy-only),
Ignite / MultiReward /
JumpRateModel / Pause
Guardian / sAVAX
timelock / JLP staking
(Sourcify 404), PGL
staking proxy
(`match`).

## 2026-09-03: Benqi PGL staking leftover (`e0cfd24`)

Immunefi program
`benqi`
($500,000, `kyc: false`).
Token-sale leftover is
already logged. This
slice is
PglStakingContractProxy
`0x784DA19e61cf348a8c54547531795ECfee2AfFd1`.
Avalanche Sourcify
`match` (solc 0.5.17,
`PglStakingContractProxy.sol`).
Official tree
`pgl_staking/` at
`e0cfd24`. No mainnet
interaction.

Files:
`pgl_staking/PglStakingContract.sol`,
`PglStakingContractProxy.sol`,
`PglStakingContractStorage.sol`.

Checked for: a
stranger redeeming
another staker’s PGL;
claim that pays more
reward than accrued;
deposit that credits
more shares than
tokens received.

Result: no
user-exploitable
finding. Not submitted.

- `deposit` measures
  `balanceOf` before /
  after `transferFrom`
  and credits
  `msg.sender` with
  the received amount.
- `redeem` requires
  `pglAmount <=
  supplyAmount[msg.sender]`
  and transfers PGL
  to `msg.sender`.
- `claimRewards` only
  pays
  `accruedReward[msg.sender][QI]`
  via `claimErc20`.
  AVAX claimable is
  hardcoded 0 (comment:
  erroneously emitted
  AVAX). Do not file
  stuck AVAX as theft.
- Reward speeds and
  token addresses are
  `adminOnly`. Proxy
  implementation swap
  is admin / pending
  implementation.

Do not file admin
token-address changes
or the AVAX-zero
view as a user
finding.

Not submitted.
Remaining Benqi
listed: isolated
unitroller (Sourcify
404), gauges / sAVAX /
veQI (proxy-only),
Ignite / MultiReward /
JumpRateModel / Pause
Guardian / sAVAX
timelock / JLP staking
(Sourcify 404). Listed
Sourcify-open Benqi
leftover is exhausted.

## 2026-09-03: Beanstalk L2 diamond + tokens leftover (`8e22cd2`)

Immunefi program
`beanstalk`
($1,100,000, `kyc: false`).
Basin leftover
(Pipeline / Depot /
Well / Aquifer / CP2 /
MFP) is already
logged. This slice is
the L2 diamond and
listed tokens.
Arbitrum Sourcify
`exact_match`: L2
Beanstalk
`0xD1A0060b…15FB70`
(`Diamond.sol`, solc
0.8.25), Bean /
Unripe Bean / Unripe
LP
(`BeanstalkERC20.sol`),
Fertilizer impl
`0xFEFEFE2c…5f1490`,
Shipment Planner
`0x55555598…EEef5`.
L1 diamond
`0xC1E088fC…5624C5`
is Ethereum Sourcify
`match` (`Diamond.sol`
0.7.6). Fertilizer
proxy Sourcify 404.
Official tree
`BeanstalkFarms/Beanstalk`
`8e22cd2`. No mainnet
interaction.

Files:
`contracts/beanstalk/Diamond.sol`,
`silo/SiloFacet/SiloFacet.sol`,
`TokenSilo.sol`,
`ConvertFacet.sol`,
`field/FieldFacet.sol`,
`barn/FertilizerFacet.sol`,
`UnripeFacet.sol`,
`farm/TractorFacet.sol`,
`tokens/ERC20/BeanstalkERC20.sol`,
`tokens/Fertilizer/Fertilizer.sol`,
`ecosystem/ShipmentPlanner.sol`.

Checked for: a
stranger withdrawing
or transferring
another farmer’s Silo
deposit without
allowance; harvest of
another account’s
plots; Fertilizer mint
or rinse that pays
the caller someone
else’s Beans; chop
that burns a victim’s
Unripe; Tractor that
runs without a valid
publisher signature;
Bean mint without
`MINTER_ROLE`.

Result: no
user-exploitable
finding. Not submitted.

- Silo `deposit` /
  `withdrawDeposit`
  move tokens for
  `LibTractor._user()`.
  `transferDeposit`
  spends deposit
  allowance unless
  `sender == _user()`.
- Field `sow` /
  `harvest` credit
  `_user()`. Harvest
  deletes
  `s.accts[account].plots`
  for `_user()` only.
- Fertilizer
  `claimFertilized` /
  `mintFertilizer` use
  `_user()`.
  `payFertilizer`
  requires
  `msg.sender ==
  fertilizer`.
  Impl
  `beanstalkMint` /
  `beanstalkUpdate`
  are `onlyOwner`.
- `chop` burns Unripe
  from `_user()` and
  sends ripe to
  `_user()`.
- Tractor
  `activePublisher`
  is set only after
  EIP-712 recover of
  the blueprint
  publisher.
  `_user()` is that
  publisher, else
  `msg.sender`.
- Bean / Unripe
  `mint` is
  `MINTER_ROLE`.
  Planner getters are
  view. Diamond `cut`
  is owner.
- Anti-lambda convert
  is same-token BDV
  restem, documented
  as permissionless.
  Do not file as
  theft.

Do not file Tractor
operator paste or
anti-lambda restem
without a signed-
slot / token-move
bypass.

Not submitted.
Remaining Beanstalk
listed: Junctions,
Unwrap-and-Send-ETH,
LSD Chainlink Oracle,
Fertilizer proxy
(Sourcify 404),
marketplace / season /
pipeline-convert
facets.

## 2026-09-03: Beanstalk Junctions / UnwrapETH / LSD / marketplace leftover (`8e22cd2`)

Immunefi program
`beanstalk`
($1,100,000, `kyc: false`).
Basin and L2 diamond
+ tokens leftovers
are already logged.
This slice is the
remaining listed
Sourcify-open
contracts plus the
diamond marketplace /
pipeline-convert /
season leftover.
Arbitrum Sourcify
`exact_match`:
Junctions
`0x5A5A5ADe…E2cD`
(`src/Junction.sol`,
solc 0.8.26, verified
2026-01-20),
UnwrapAndSendETH
`0xD6Fc4a63…A4749`,
LSDChainlinkOracle
`0xCCCCCC35…5626`.
Official tree
`8e22cd2`. No mainnet
interaction.

Files:
`ecosystem/junction/Junction.sol`,
`MathJunction.sol`,
`LogicJunction.sol`,
`pipeline/junctions/UnwrapAndSendETH.sol`,
`ecosystem/oracles/LSDChainlinkOracle.sol`,
`libraries/Oracle/LibChainlinkOracle.sol`,
`market/MarketplaceFacet/MarketplaceFacet.sol`,
`silo/PipelineConvertFacet.sol`,
`sun/SeasonFacet/SeasonFacet.sol`.

Checked for: Junction
math that mints or
moves tokens; UnwrapETH
that takes a victim’s
WETH approval; oracle
that treats a stale or
zero feed as live;
marketplace fill that
spends another
farmer’s Beans or
plots; pipeline
convert that withdraws
a stranger’s deposit;
sunrise that pays user
funds.

Result: no
user-exploitable
finding. Not submitted.

- Junctions are
  `pure` add/sub/mul/
  div/cmp/`check`.
  No storage, no
  tokens.
- UnwrapAndSendETH
  unwraps WETH
  already on this
  helper and sends
  ETH to `to`. Same
  leftover-on-helper
  pattern as Pipeline.
  Do not file without
  a proven official
  park.
- LSD oracle
  multiplies two
  Chainlink feeds
  from caller `data`.
  `LibChainlinkOracle`
  returns 0 on
  revert, round 0,
  future/zero
  timestamp, timeout,
  or `answer <= 0`.
  This is an oracle,
  not a vault.
- Marketplace
  listings / orders
  require
  `lister`/`orderer ==
  _user()`. Fill
  transfers Beans
  from `_user()` to
  the lister. Plot
  transfer spends
  pod allowance
  unless
  `sender == _user()`.
- `pipelineConvert`
  withdraws and
  redeposits
  `_user()` only.
  Pipe calls are the
  already-logged
  Pipeline sandbox.
- `sunrise` is
  permissionless and
  `noOutFlow`.

Do not file UnwrapETH
leftover sweep or
caller-supplied
oracle feeds as
theft of funds at
rest.

Not submitted.
Listed Beanstalk
leftover is exhausted
aside from Fertilizer
proxy (Sourcify 404).

## 2026-09-03: Flux Finance leftover (Sourcify)

Immunefi program
`fluxfinance`
($550,000, `kyc: false`).
Unique no-KYC listed
slice not previously
logged. Ethereum
Sourcify `exact_match`:
Unitroller
`0x95Af143a…3A51`
(solc 0.5.17, verified
2026-02-14), fUSDC /
fDAI / fOUSG
`CErc20DelegatorKYC`
(solc 0.5.17),
OndoPriceOracleV2
`0xba9b10f9…7ef2`
(solc 0.8.16),
GovernorBravoDelegator,
Timelock. Extract
`/tmp/flux`. No mainnet
interaction.

Files:
`contracts/lending/compound/Unitroller.sol`,
`tokens/cToken.sol`,
`tokens/cErc20ModifiedDelegator.sol`,
`OndoPriceOracleV2.sol`,
`compound/governance/GovernanceBravoDelegator.sol`,
`Timelock.sol`.

Checked for: a
stranger minting from
a victim’s tokens;
oracle that treats a
stale or zero
Chainlink tick as
live; Unitroller
implementation swap
without admin.

Result: no
user-exploitable
finding. Not submitted.

- `CErc20DelegatorKYC`
  `mint` / `redeem` /
  `seize` delegate.
  `_setImplementation`
  is admin.
  Constructor inits
  KYC registry +
  group on the
  implementation.
- Extracted `cToken`
  `mintFresh` pulls
  from the minter and
  mints to the minter.
  Empty-market rate
  is
  `initialExchangeRateMantissa`.
  Do not file vanilla
  Compound first-
  depositor inflation
  without an empty
  listed market.
- OndoPriceOracleV2
  `setPrice` /
  `setOracle` /
  `setFTokenToOracleType`
  / caps are
  `onlyOwner`.
  Chainlink mode
  reverts if stale
  (`answeredInRound`
  / timeout) or
  `answer < 0`.
  Compound mode
  requires matching
  underlyings. Cap
  is `min`.
- Unitroller
  `_setPendingImplementation`
  is admin;
  `_acceptImplementation`
  is the pending
  implementation.

Do not file owner
`setPrice` or
Compound first-
depositor inflation
as a finding.

Not submitted.
Remaining Flux:
Comptroller
implementation (not
in this Sourcify
slice), KYC cToken
implementation
behind the
delegator, Governor
Bravo implementation.

## 2026-09-03: Instadapp Fluid liquidity + fToken leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). DSA
and Avocado leftovers
are already logged.
This slice is
`fluid-contracts-public`
liquidity + lending.
Local clone
`/tmp/instadapp-fluid`
at `a9949b4`
(`Merge pull request
#825 from
Instadapp/main`).
515 Solidity files.
No mainnet
interaction. DeFi
Saver Fluid leftovers
are DFS integrations,
not this tree.

Files:
`liquidity/userModule/main.sol`,
`liquidity/adminModule/main.sol`,
`liquidity/interfaces/iLiquidity.sol`,
`protocols/lending/fToken/main.sol`,
`protocols/lending/lendingFactory/main.sol`.

Checked for: a
stranger `operate`
that withdraws or
borrows another
protocol’s
accounting; skip /
net-transfer flags
that send tokens to
a caller-chosen
address; fToken
withdraw that burns
a victim’s shares
without allowance;
callback that pulls
from an arbitrary
`from`.

Result: no
user-exploitable
finding. Not
submitted.

- Liquidity
  `operate` is
  public but
  `_userSupplyData`
  / `_userBorrowData`
  are keyed by
  `msg.sender`.
  Undefined users
  revert
  `UserNotDefined`.
  Auths must
  `updateUserSupplyConfigs`
  / borrow configs
  first. Withdraw /
  borrow send to the
  caller-chosen
  `withdrawTo_` /
  `borrowTo_` from
  that protocol’s
  own balance.
- Transfers in go
  through
  `liquidityCallback`
  on `msg.sender`
  and require the
  contract balance
  increase to match
  (1% slack). Skip
  transfers need
  `SKIP_TRANSFERS`,
  `from ==
  msg.sender ==
  receiver`, and
  amounts that leave
  Liquidity even or
  better. Net
  transfers need
  `NET_TRANSFERS`
  and the same
  receiver match.
- Admin: governance
  sets auths /
  guardians /
  revenue.
  Auths set rates,
  user configs, and
  `collectRevenue`.
  Guardians pause
  class-0 users
  only.
- fToken deposit
  encodes
  `msg.sender` as
  callback `from`.
  `liquidityCallback`
  requires
  `msg.sender ==
  LIQUIDITY`,
  matching asset,
  and reentrancy
  entered, then
  `transferFrom`
  that `from`.
  Withdraw burns
  `owner_` shares
  first, then
  `operate`s a
  withdraw to
  `receiver_`.
  Non-owner
  withdraw/redeem
  spends allowance.
  Factory
  `createToken` is
  deployer/owner.

Not submitted.
Remaining Instadapp
is Fluid vault /
dex / dexLite /
steth and
`inst-governance`.

## 2026-09-03: Instadapp Fluid vault T1 leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Fluid
liquidity + fToken
leftover on pin
`a9949b4` is already
logged. This slice is
VaultT1 operate /
liquidate / factory
mint. Same clone
`/tmp/instadapp-fluid`.
No mainnet
interaction.

Files:
`protocols/vault/vaultT1/coreModule/main.sol`,
`vaultT1/adminModule/main.sol`,
`factory/main.sol`,
`factory/ERC721/ERC721.sol`.

Checked for: a
stranger withdraw or
borrow from another
user’s NFT; factory
mint of a position
NFT to the attacker;
callback that pulls
tokens from a victim;
admin fallback that
anyone can hit.

Result: no
user-exploitable
finding. Not
submitted.

- `operate` mints a
  new NFT to
  `msg.sender` when
  `nftId == 0`.
  Withdraw or borrow
  on an existing id
  requires
  `ownerOf ==
  msg.sender`.
  Deposit / payback
  on someone else’s
  NFT is a gift, not
  a drain. Payback
  callback encodes
  `msg.sender`.
  Withdraw / borrow
  `operate`s Liquidity
  to `to_` (or
  `msg.sender`).
- `liquidate` is
  permissionless for
  underwater ticks
  and pays the
  liquidator
  collateral for
  repaid debt at the
  oracle + penalty.
  Dead-address
  dry-run reverts
  with amounts.
- `liquidityCallback`
  requires
  `msg.sender ==
  LIQUIDITY` and
  reentrancy bit
  set, then
  `transferFrom` the
  decoded `from`.
- Factory `mint` is
  only the vault for
  that `vaultId`.
  Fallback admin
  delegatecall
  requires global or
  per-vault auth.
  Admin module is
  `_verifyCaller`
  (delegatecall
  only).

Not submitted.
Remaining Instadapp
is Fluid vault T2–T4
/ dex / dexLite /
steth and
`inst-governance`.

## 2026-09-03: Instadapp Fluid vault T2–T4 leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Fluid
liquidity / fToken
and vault T1 leftovers
on pin `a9949b4` are
already logged. This
slice is T2 (smart
col), T3 (smart debt),
T4 (both) plus the
shared operate /
secondary path. Same
clone
`/tmp/instadapp-fluid`.
No mainnet
interaction.

Files:
`vaultT2/coreModule/main.sol`,
`mainOperate.sol`,
`vaultT3/coreModule/main.sol`,
`vaultT4/coreModule/main.sol`,
`vaultTypesCommon/coreModule/mainOperate.sol`,
`helpers.sol`,
`main.sol`,
`main2.sol`.

Checked for: a
stranger withdraw of
DEX shares before the
NFT owner check;
`_dexFromAddress`
impersonation;
`dexCallback` pull
from a victim;
permissionless
`rebalance` that
drains reserve.

Result: no
user-exploitable
finding. Not
submitted.

- T2–T4 `operate` /
  `operatePerfect`
  delegatecall
  `OPERATE_IMPLEMENTATION`.
  Shared `_operate`
  still requires
  `ownerOf ==
  msg.sender` for
  withdraw or
  borrow. New NFT
  mints to
  `msg.sender`.
- T2 withdraw burns
  DEX supply shares
  before `_operate`;
  T2 perfect
  withdraw burns
  after. Either way
  the call is
  atomic: a failed
  owner check reverts
  the DEX move.
  T3/T4 wrap smart
  debt the same way.
- `_dexFromAddress`
  stores
  `msg.sender` and
  reverts if already
  set. `dexCallback`
  requires
  `msg.sender` is
  SUPPLY or BORROW
  and the reentrancy
  bit, then
  `transferFrom`
  `dexFromAddress`.
  `liquidityCallback`
  is LIQUIDITY-only
  as on T1.
- `rebalance` is
  `msg.sender ==
  rebalancer`.
  `absorb` /
  secondary admin
  are
  `_verifyCaller`
  (delegatecall).
  Liquidate remains
  permissionless
  for underwater
  ticks.

Not submitted.
Remaining Instadapp
is Fluid dex /
dexLite / steth and
`inst-governance`.

## 2026-09-03: Instadapp Fluid DEX T1 leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Fluid
liquidity / fToken
and vault leftovers
on pin `a9949b4` are
already logged. This
slice is DexT1 swap
and col / debt
operations. Same
clone
`/tmp/instadapp-fluid`.
No mainnet
interaction.

Files:
`protocols/dex/poolT1/coreModule/core/main.sol`,
`colOperations.sol`,
`debtOperations.sol`,
`protocols/dex/factory/main.sol`.

Checked for: a
callback swap that
pulls a victim’s
tokens; withdraw /
borrow of another
user’s DEX shares;
admin fallback
without auth.

Result: no
user-exploitable
finding. Not
submitted.

- `swapIn` /
  `swapOut` are
  permissionless
  AMM paths with
  `amountOutMin` /
  `amountInMax`.
  Liquidity
  `operate` for the
  in-leg encodes
  `(amount,
  isCallback,
  msg.sender)`.
  `liquidityCallback`
  is LIQUIDITY-only,
  reentrancy-on, 96
  bytes: callback
  hits
  `from_.dexCallback`
  or
  `transferFrom`
  `from_`. Out-leg
  withdraw / borrow
  goes to `to_`
  (msg.sender if
  unset).
- Col deposit /
  withdraw and debt
  borrow / payback
  delegatecall
  implementations.
  `_userSupplyData`
  / `_userBorrowData`
  first bit must be
  on (allow-listed
  protocols, e.g.
  vaults).
  Withdraw / borrow
  send to
  caller-chosen
  `to_` from that
  caller’s shares.
- Admin fallback
  requires factory
  global or per-dex
  auth. Factory
  deploy /
  deployer / auth
  writes are owner.

Not submitted.
Remaining Instadapp
is Fluid dexLite /
steth and
`inst-governance`.

## 2026-09-03: Instadapp Fluid dexLite leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Fluid
DEX T1 leftover on
pin `a9949b4` is
already logged. This
slice is DexLite
swap + admin
fallback. Same clone
`/tmp/instadapp-fluid`.
No mainnet
interaction.

Files:
`protocols/dexLite/core/main.sol`,
`core/coreInternals.sol`,
`core/helpers.sol`,
`adminModule/main.sol`.

Checked for: a
callback that pulls
a victim’s tokens;
`extraData` that
skips paying the
in-leg; fallback
delegatecall by a
stranger.

Result: no
user-exploitable
finding. Not
submitted.

- `swapSingle` /
  path swaps take
  `amountLimit_`.
  `_transferTokens`
  sends the out-leg
  first, then pulls
  the in-leg from
  `msg.sender`
  (`transferFrom`
  or
  `dexCallback` on
  `msg.sender` with
  a balance check).
  Native path
  requires
  `msg.value` or a
  callback that
  increases ETH
  balance. Unset
  `to_` is
  `msg.sender`.
- Non-empty
  `extraData_`
  skips the default
  transfer and
  delegatecalls
  `EXTRA_DATA_SLOT`.
  Unset slot
  reverts
  `ZeroAddress`.
  That hook is
  admin-configured.
- Fallback
  delegatecall
  requires `_isAuth`
  or Liquidity
  governance.
  `updateAuth` /
  `initialize` are
  `_onlyDelegateCall`.

Not submitted.
Remaining Instadapp
is Fluid steth and
`inst-governance`.

## 2026-09-03: Instadapp Fluid stETH leftover (`a9949b4`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). Fluid
DEX T1 and dexLite
leftovers on pin
`a9949b4` are already
logged. This slice is
the stETH queue.
Same clone
`/tmp/instadapp-fluid`.
No mainnet
interaction.

Files:
`protocols/steth/main.sol`,
`variables.sol`,
`proxy.sol`.

Checked for: a
stranger claim that
pays leftover ETH to
the caller instead of
`claimTo_`; queue that
borrows against another
user’s stETH; ERC721
callback that hijacks
the Lido NFT.

Result: no
user-exploitable
finding. Not
submitted.

- `queue` pulls
  stETH from
  `msg.sender` (allow
  list if active),
  queues Lido NFTs
  to this contract,
  borrows ETH to
  `borrowTo_`, and
  stores the claim
  under `claimTo_`.
  LTV is checked
  against `maxLTV`.
- `claim` is
  permissionless but
  leftover ETH after
  Liquidity repay
  goes to `claimTo_`,
  then the mapping
  is deleted. A
  stranger can only
  pay gas to settle
  someone else’s
  claim.
- `liquidityCallback`
  always reverts
  (native repay
  only).
  `onERC721Received`
  accepts only the
  Lido queue.

Not submitted.
Remaining Instadapp
is `inst-governance`.

## 2026-09-03: Instadapp inst-governance leftover (`3fc54af`)

Immunefi program
`instadapp` ($500,000,
`kyc: false`). DSA,
Avocado, and Fluid
leftovers are already
logged. This slice is
the last listed tree:
`inst-governance`.
Local clone
`/tmp/instadapp-gov`
at `3fc54af`. No
mainnet interaction.

Files:
`contracts/GovernorBravoDelegate.sol`,
`GovernorBravoDelegator.sol`,
`Timelock.sol`,
`TokenDelegate.sol`,
`TokenDelegator.sol`,
`payloads/common/main.sol`,
`payloads/IGP139/PayloadIGP139.sol`.

Checked for: a
stranger `execute`
of an unqueued
payload; payload
`propose` that
bypasses the
threshold; Timelock
`executePayload`
callable without a
queued admin tx;
token `mint` by a
non-master.

Result: no
user-exploitable
finding. Not
submitted.

- Governor Bravo
  `propose` requires
  prior votes above
  `proposalThreshold`.
  `queue` requires
  Succeeded.
  `execute` requires
  Queued, marks
  executed, then
  `timelock.executeTransaction`.
  `cancel` is the
  proposer or a
  proposer now below
  threshold.
- Timelock
  `queueTransaction`
  / `executeTransaction`
  are `admin` only
  (the Governor).
  `executePayload` is
  `msg.sender ==
  this` and
  `delegatecall`s the
  payload so
  `address(this)` is
  the Timelock.
- Payload
  `propose` is
  proposer / team /
  Avo multisigs.
  `execute` requires
  `address(this) ==
  TIMELOCK` and
  `isProposalExecutable`.
  Team can skip
  actions or toggle
  executable on the
  payload; that is
  operator privilege,
  not a stranger
  drain. IGP139
  `withdrawFunds` of
  155 stETH runs
  only after
  `super.execute()`.
- Token `mint` is
  `isMaster`, after
  `mintingAllowedAfter`,
  with a percent cap
  and a mint
  cooldown.

Not submitted.
Listed Instadapp
GitHub leftover is
exhausted.

## 2026-09-03: Gnosis Chain tokenbridge + Omnibridge leftover (`908a481` / `c814f68`)

Immunefi program
`gnosischain`
($2,000,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Four listed
addresses, all
Sourcify `match` on
`EternalStorageProxy`
only (solc 0.4.24):
XDaiForeignBridge
Ethereum
`0x4aa42145Aa6Ebf72e164C9bBC74fbD3788045016`,
HomeBridgeErcToNative
Gnosis
`0x7301CFA0e1756B71869E93d4e4Dca5c7d0eb0AA6`,
ForeignOmnibridge
Ethereum
`0x88ad09518695c6c3712AC10a214bE5109a655671`,
HomeOmnibridge Gnosis
`0xf6A78083ca3e2a662D6dd1703c939c8aCE2e268d`.
Extract
`/tmp/gnosis-bridge`.
Official trees
`/tmp/tokenbridge`
`omni/tokenbridge-contracts`
`908a481` and
`/tmp/omnibridge`
`omni/omnibridge`
`c814f68`. Do not
treat proxy-only
Sourcify as
exhausting the
implementation.
No mainnet
interaction.

Files:
`upgradeability/EternalStorageProxy.sol`,
`OwnedUpgradeabilityProxy.sol`,
`erc20_to_native/XDaiForeignBridge.sol`,
`ForeignBridgeErcToNative.sol`,
`HomeBridgeErcToNative.sol`,
`BasicForeignBridge.sol`,
`BasicHomeBridge.sol`,
`Validatable.sol`,
`libraries/Message.sol`,
`omnibridge` `BasicAMBMediator.sol`,
`BasicOmnibridge.sol`,
`components/common/TokensRelayer.sol`,
`FailedMessagesProcessor.sol`.

Checked for: a
stranger
`executeSignatures`
that unlocks DAI
without validator
quorum; Home mint
without a matching
Foreign lock;
Omnibridge
`handleBridgedTokens`
callable by anyone;
owner
`claimTokens`
sweeping the
bridged DAI /
native lock.

Result: no
user-exploitable
finding. Not
submitted.

- Proxy
  `upgradeTo` /
  `upgradeToAndCall`
  are
  `onlyProxyOwner`.
  Fallback
  `delegatecall`s
  the current
  implementation.
- Foreign
  `executeSignatures`
  requires
  `Message.hasEnoughValidSignatures`
  against
  `validatorContract()`,
  `contractAddress ==
  this`, and a fresh
  `txHash`. Then
  `onExecuteMessage`
  transfers DAI
  after
  `ensureEnoughTokens`
  (may withdraw cDAI
  interest).
- Home
  `executeAffirmation`
  is
  `onlyValidator`.
  Quorum marks the
  hash processed and
  `blockReward.addExtraReceiver`
  mints. Home
  `relayTokens` /
  fallback burns
  native xDAI
  (`address(0).transfer`)
  only within
  minted−burnt and
  daily limits.
  Payable
  `relayTokens` is
  the native lock,
  not a free mint.
- Foreign
  `relayTokens`
  `transferFrom`s
  the caller’s DAI
  into the lock.
  Receiver cannot
  be `0`, `this`,
  or the other-side
  bridge.
- Omnibridge
  `handleBridgedTokens`
  / `AndCall` /
  `fixFailedMessage`
  are
  `onlyMediator`:
  `msg.sender` is
  the AMB and
  `messageSender()`
  is the other-side
  mediator.
  `onTokenTransfer`
  / `relayTokens`
  pull the caller’s
  tokens.
- `claimTokens` is
  `onlyIfUpgradeabilityOwner`.
  XDaiForeign
  refuses DAI /
  cDAI / COMP when
  interest is on.
  `upgradeTo530` is
  `msg.sender ==
  this`.

Do not file owner
`claimTokens`, the
DAI / cDAI / COMP
restriction,
`upgradeTo530`
self-call, or
payable Home
`relayTokens` as
theft.

Not submitted.
Listed leftover is
the four proxies
plus the official
erc-to-native and
Omnibridge money
paths. Remaining
Gnosis: AMB /
other tokenbridge
trees if Immunefi
lists them later;
implementation
bytecode is not
independently
Sourcify-matched
on these rows.

## 2026-09-03: Ankr ETH pool + liquid tokens leftover (Sourcify)

Immunefi program
`ankr` ($500,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
Sourcify: ETH Pool
`0x84db6eE82b7Cf3b47E8F19270abdE5718B936670`
`AdminUpgradeabilityProxy`
(`match`) impl
`GlobalPool_R46`
`0xEcce8778214Fd9fe37C141a00cFf19853Ef5Bc4A`
(solc 0.6.11);
aETHc
`0xE95A203B1a91a908F9B9CE46459d101078c2c3cb`
proxy + `AETH_R21`
`0xE672E0E0101A7F58d728751E2a5e6Da5Ff1FDa64`;
aETHb
`0xd01ef7c0a5d8c432fc2d1a85c66cf2327362e5c6`
proxy + `FETH_R20`
`0x518d26405Ca06435227BB3E8de567a16fA8F8125`.
BSC Sourcify:
ankrBNB
`0x52F24a5e03aee338Da5fd9Df68D2b6FAe1178827`
`TransparentUpgradeableProxy`
(`exact_match`) impl
`aBNBc_R1`
`0x2c00CE1A935FF8c9e78580533e2E17c36281c26E`.
Extract `/tmp/ankr`.
BNB Pool and
BNBStakingConfig
Sourcify 404. No
mainnet interaction.

Files:
`GlobalPool_R46.sol`,
`AETH_R21.sol`,
`FETH_R20.sol`,
`aBNBc_R1.sol`,
`CertificateToken.sol`.

Checked for: a
stranger burn of
another user’s
aETH / aETHb;
claim of another
staker’s shares;
unstake that queues
more ETH than the
burned shares;
certificate mint
without the pool.

Result: no
user-exploitable
finding. Not
submitted.

- `stakeAndClaimAethC`
  / `B` mint aETH
  shares to the pool
  then credit
  `_claimableShares
  [msg.sender]`.
  `claimAETH` /
  `claimFETH` zero
  that mapping for
  `msg.sender` first.
- `unstakeAETH`
  burns
  `msg.sender` via
  pool-gated
  `AETH.burn`.
  `unstakeFETH`
  `unlockSharesFor`
  (pool/owner) then
  burns the
  unlocked aETH.
  Queue amount uses
  FETH
  `sharesToBonds`,
  which reads
  `AETH.ratio()`.
- `distributeRewards`
  is
  `onlyOperator`.
  Failed or marked
  claims stash ETH
  for
  `claimManually`,
  which pays
  `receiverAddress`.
  `receive` is the
  withdrawal pool
  only.
- `AETH.mint` /
  `burn` are global
  pool or BSC
  bridge.
  `updateRatio` is
  operator and
  cannot increase;
  `repairRatio` is
  owner.
- `aBNBc` mint /
  burn are the
  liquid staking
  pool or the
  stored Binance
  pool. Airdrop is
  one-shot
  governance.

Do not file owner
`updateClaimableShares`,
operator fee on
`distributeRewards`,
owner `refundPool`,
or operator
`claimTokens` on
AETH as theft.

Not submitted.
Listed leftover is
the ETH pool +
aETHc / aETHb +
ankrBNB token
paths. Remaining
Ankr: BNB Pool
`0x9e347Af3…E86E` and
BNBStakingConfig
Sourcify 404.

## 2026-09-03: UTIX crowdsale leftover (Sourcify)

Immunefi program
`utix` ($500,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Single
Ethereum asset
`0xc9d7bd1Fad7D5621DdA20335818E9575Ae07Ea03`
Sourcify
`exact_match`
`MintedTokenCappedCrowdsaleExtv1`
(solc 0.7.6, TokenMarket
ICO tree). Extract
`/tmp/utix`. No mainnet
interaction.

Files:
`MintedTokenCappedCrowdsaleExtv1.sol`,
`MintedTokenCappedCrowdsaleExt.sol`,
`CrowdsaleExt.sol`,
`MintableTokenExt.sol`,
`TokenVesting.sol`,
`Allocatable.sol`.

Checked for: a
stranger mint of
sale tokens; buy
that mints without
paying; withdraw of
raised ETH to the
caller; vesting
release to the
wrong wallet.

Result: no
user-exploitable
finding. Not
submitted.

- `buy` /
  `invest` run only
  in Funding.
  Tokens come from
  `pricingStrategy.
  calculatePrice`
  and
  `assignTokens` →
  mint-agent
  `mint`. ETH goes
  to the EOA
  multisig after
  the min goal
  (`extcodesize ==
  0`).
- `allocate` is
  `onlyAllocateAgent`
  (owner-set).
  `finalize` /
  whitelist /
  schedule /
  pricing writes
  are owner.
- Token `mint` is
  `onlyMintAgent
  canMint`.
  `setMintAgent` is
  owner.
- Vesting
  `releaseAllVestedTokens`
  is owner and
  pays each
  `_adr` on its
  schedule. Set /
  freeze / token
  pointer are
  allocate agents.

Do not file owner
rate / cap updates,
allocate-agent
preallocation, or
the unused
`investorCount.plus`
return as theft.

Not submitted.
Listed UTIX leftover
is this crowdsale
row (exhausted).

## 2026-09-03: 1inch token-plugins + farming leftover (`9b6de97` / `b1fca09`)

Immunefi program
`1inch-SmartContracts`
($500,000, `kyc:
true`). Fusion
settlement /
whitelist /
PowerPod / KycNFT
and FeeTaker are
already logged. This
slice is
`token-plugins` and
`farming`. Local
clones
`/tmp/1inch-token-plugins`
at `9b6de97` and
`/tmp/1inch-farming`
at `b1fca09`. No
mainnet interaction.

Files:
`token-plugins/contracts/ERC20Hooks.sol`,
`Hook.sol`,
`libs/ReentrancyGuard.sol`,
`farming/contracts/FarmingPool.sol`,
`FarmingHook.sol`,
`MultiFarmingHook.sol`,
`Distributor.sol`,
`FarmingLib.sol`,
`accounting/UserAccounting.sol`.

Checked for: a
stranger adding a
hook that drains
another holder;
`updateBalances`
callable without the
token; farming
`claim` of another
account’s rewards;
`rescueFunds` that
takes staked tokens
or the farmed
reserve.

Result: no
user-exploitable
finding. Not
submitted.

- `addHook` /
  `removeHook` /
  `removeAllHooks`
  are `msg.sender`
  only. The hook’s
  `TOKEN()` must be
  this ERC-20.
  `updateBalances` is
  `onlyToken`. Hook
  calls are gas-
  capped; a revert
  is swallowed
  unless the caller
  supplied too
  little gas (OOG
  bomb). Transfers
  are
  `nonReentrant`.
- `FarmingPool`
  `deposit` /
  `withdraw` /
  `claim` use
  `msg.sender`.
  `startFarming` /
  `stopFarming` /
  `rescueFunds` are
  `onlyDistributor`.
  Rescue of the
  staking token
  requires
  `balance >=
  totalSupply +
  amount`. Rescue of
  the rewards token
  requires
  `balance >=
  farmInfo.balance +
  amount`.
- `FarmingHook` /
  `MultiFarmingHook`
  `claim` uses
  `hookBalanceOf(this,
  msg.sender)`.
  `_updateBalances`
  is `onlyToken`.
  Multi-farm owner
  can add at most
  five reward
  tokens.

Not submitted.
Remaining 1inch
SmartContracts trees
are `cross-chain-swap`,
`solana-crosschain-protocol`,
and `solana-fusion`.

## 2026-09-03: Flux Comptroller / KYC cToken / Governor Bravo leftover (Sourcify)

Immunefi program
`fluxfinance`
($550,000, `kyc: false`).
Proxy leftover already
logged Unitroller /
`CErc20DelegatorKYC` /
OndoPriceOracleV2 /
GovernorBravoDelegator /
Timelock. This slice is
the live implementations
behind those proxies.
Read-only `eth_call` on
`https://ethereum-rpc.publicnode.com`
(no writes). Sourcify
`exact_match` extract
`/tmp/flux-impls`.

Resolved:
Unitroller
`0x95Af143a…3A51`
`comptrollerImplementation()`
`0xdc7b9059…9719`
(Comptroller, solc
0.5.17, verified
2026-01-23);
fOUSG
`0x1dD7950c…E018`
`implementation()`
`0x159d359b…2d0a`
(`CCashDelegate`,
verified 2024-08-08);
fUSDC
`0x465a5a63…19e5`
`0xb521dcf5…fbc5`
(`CTokenDelegate`,
verified 2026-02-14);
fDAI
`0xe2bA8693…530b`
`0x690ef7cd…7d82`
(same
`CTokenModified`
hash as fUSDC);
fFRAX
`0x1C9A2d6b…978B`
`0x89ca67ec…17f6`
(same hash);
fUSDT
`0x81994b96…27d7`
`0x48a56c40…e6bf`
(same hash);
GovernorBravoDelegator
`0x336505EC…465A`
`0x8886344a…c8e`
(`GovernorBravoDelegate`,
solc 0.5.17, verified
2024-08-08).

Files:
`Comptroller.sol`,
`CTokenModified.sol`,
`CTokenDelegate.sol`,
`CErc20.sol`,
`CTokenCash.sol`,
`CCash.sol`,
`CCashDelegate.sol`,
`GovernorBravoDelegate.sol`.

Checked for: a
stranger mint that
pulls a victim’s
underlying; Comptroller
`borrowAllowed` that
skips the liquidity
check; `seize` that
accepts a spoofed
seizer token;
Governor `execute`
without a queued
Succeeded proposal.

Result: no
user-exploitable
finding. Not submitted.

- Comptroller
  `enterMarkets` only
  adds `msg.sender`.
  `mintAllowed` is
  listed + not paused.
  `borrowAllowed`
  auto-enters only
  when `msg.sender`
  is the cToken,
  reverts on a zero
  oracle price, and
  requires no
  hypothetical
  shortfall.
  `liquidateBorrowAllowed`
  needs shortfall
  (unless the market
  is deprecated) and
  a close-factor cap.
  `seizeAllowed`
  requires both
  markets listed and
  the same
  Comptroller.
  `_setPriceOracle` /
  `_supportMarket` /
  `_setCollateralFactor`
  / `_become` /
  `fixBadAccruals`
  are admin.
- `CTokenModified`
  (identical source
  on fUSDC / fDAI /
  fFRAX / fUSDT)
  `mintFresh` pulls
  `transferFrom`
  the minter after a
  sanctions check.
  Borrow / repay
  require KYC.
  Transfer checks
  sanctions +
  allowance.
  `seize` passes
  `msg.sender` as the
  seizer cToken.
  KYC registry /
  group setters are
  admin.
- fOUSG `CTokenCash`
  additionally KYCs
  mint / redeem /
  transfer / seize.
  Missing KYC on
  stablecoin mint is
  the listed CASH vs
  USDC split, not a
  stranger drain.
- Governor Bravo
  `propose` needs
  prior votes above
  threshold or a
  whitelist.
  `queue` requires
  Succeeded.
  `execute` requires
  Queued, then
  `timelock.executeTransaction`.
  Voting delay /
  period / threshold
  / whitelist /
  `_initiate` are
  admin.

Do not file
admin `setKYCRegistry`
or vanilla Compound
first-depositor
inflation as a
finding.

Not submitted.
Listed Flux leftover
is exhausted.

## 2026-09-03: Mantle mETH staking leftover (Sourcify)

Immunefi program
`mETH` ($500,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
Sourcify proxies +
impls: Staking
`0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f`
impl
`0x01a360392c74b5b8bF4973F438FF3983507a06a2`
(`exact_match`
`Staking`); mETH
token impl
`0x052F52748109BAE13D6319A463D64B6a2A613e52`
(`exact_match`
`METH`); Unstake
Requests Manager
impl
`0x5A7b3CDe8aC8d780AF4797BF1517464aC54Ca033`;
Oracle
`0x7a6c874db238D7FdC84516cD940E97032271af69`;
OracleQuorumManager
`0x54c23E0D89DA943165c969d1AbDb65f0D64174b4`;
ReturnsAggregator
`0xf2Bc410fAd9Fc3140c4CDED7C6E5Bd56AC292c93`;
CL/EL ReturnsReceiver
impls. Extract
`/tmp/meth`. Mantle L2
mETH Sourcify 404.
Pauser impl Sourcify
404. No mainnet
interaction.

Files:
`Staking.sol`,
`METH.sol`,
`UnstakeRequestsManager.sol`,
`Oracle.sol`,
`OracleQuorumManager.sol`,
`ReturnsAggregator.sol`,
`ReturnsReceiver.sol`.

Checked for: a
stranger mint of
mETH; claim of
another user’s
unstake; first-stake
donation that
steals the next
depositor; oracle
record anyone can
push.

Result: no
user-exploitable
finding. Not
submitted.

- `stake` mints
  after
  `ethToMETH`.
  Bootstrap uses
  `mETH.totalSupply
  == 0` (not
  `totalControlled`)
  so a donation to
  a returns
  receiver cannot
  inflate the first
  mint. Later rate
  is
  `mulDiv` floor.
- `METH.mint` is
  the staking
  contract.
  `burn` is the
  unstake manager
  and burns
  `msg.sender`
  (the manager’s
  locked mETH).
  `forceMint` /
  `forceBurn` are
  roles.
- `unstakeRequest`
  pulls mETH from
  `msg.sender` into
  the manager.
  `claim` is
  staking-only and
  requires
  `requester ==
  request.requester`,
  finality, and
  allocated fill,
  then burns and
  `sendValue`s to
  the requester.
- `allocateETH` /
  `initiateValidators`
  / `topUp` are
  roles.
  `receiveReturns`
  is the
  aggregator.
  `receive()`
  reverts.
- Oracle
  `receiveRecord`
  is
  `oracleUpdater`
  only. Quorum
  `receiveRecord`
  is
  `SERVICE_ORACLE_REPORTER`.
  Aggregator
  `processReturns`
  is the oracle.
  Receiver
  `transfer` is
  `WITHDRAWER_ROLE`.

Do not file
manager
`setExchangeAdjustmentRate`,
role
`forceMint`,
initiator BLS
trust, or a
donation that
improves the rate
for existing
stakers.

Not submitted.
Listed leftover is
the L1 staking +
token + unstake +
oracle + returns
path. Remaining
mETH: L2 token
Sourcify 404,
Pauser impl
Sourcify 404,
LiquidityBuffer
(not a listed
row).

## 2026-09-03: 1inch cross-chain-swap leftover (`ada243b`)

Immunefi program
`1inch-SmartContracts`
($500,000, `kyc:
true`). token-plugins
+ farming leftover is
already logged. This
slice is
`cross-chain-swap`.
Local clone
`/tmp/1inch-ccs` at
`ada243b`. No mainnet
interaction.

Files:
`contracts/EscrowSrc.sol`,
`EscrowDst.sol`,
`BaseEscrow.sol`,
`Escrow.sol`,
`BaseEscrowFactory.sol`,
`MerkleStorageInvalidator.sol`,
`libraries/ImmutablesLib.sol`.

Checked for: a
stranger withdraw
with a wrong secret
or patched
immutables; cancel
before the
cancellation
window; `createDstEscrow`
that underpays;
Merkle leaf reuse
on a multi-fill
order.

Result: no
user-exploitable
finding. Not
submitted.

- Src / dst
  `withdraw` is
  taker-only in the
  private window,
  then
  `onlyValidSecret`
  (`keccak256` of
  the 32-byte
  secret) and
  `onlyValidImmutables`
  (CREATE2 of the
  immutables hash
  must be
  `address(this)`).
  Public withdraw /
  cancel require an
  access-token
  balance and still
  pay the taker /
  maker as
  designed.
- Src cancel after
  `SrcCancellation`
  returns tokens to
  the maker. Dst
  cancel after
  `DstCancellation`
  returns tokens to
  the taker (they
  funded dst).
  `rescueFunds` is
  taker-only after
  `RESCUE_DELAY`.
- Factory src
  deploy is LOP
  `postInteraction`.
  The clone must
  already hold the
  safety deposit
  and maker tokens.
  `createDstEscrow`
  requires
  `msg.value` equal
  to deposit (+
  amount if native)
  and dst cancel
  not after src
  cancel, then
  `transferFrom`
  the caller.
- Merkle
  invalidator is
  `onlyLOP` and
  stores
  `idx + 1` plus
  the proven leaf.

Not submitted.
Remaining 1inch
SmartContracts trees
are
`solana-crosschain-protocol`
and `solana-fusion`.

## 2026-09-03: eBTC Boost leftover (`c9b95ac`)

Immunefi program
`ebtc-boost`
($200,000, `kyc: false`).
Listed GitHub files on
`ebtc-protocol/ebtc`
`release-0.7`. Local
clone `/tmp/ebtc` at
`c9b95ac` (“Merge pull
request #796”). No
mainnet interaction.

Files:
`ActivePool.sol`,
`BorrowerOperations.sol`,
`CdpManager.sol`,
`LiquidationLibrary.sol`,
`CollSurplusPool.sol`,
`EBTCToken.sol`,
`Governor.sol`,
`PriceFeed.sol`,
`SortedCdps.sol`,
`EbtcFeed.sol`,
`ChainlinkAdapter.sol`,
`FixedAdapter.sol`.

Checked for: a
stranger `openCdpFor`
that mints eBTC
without the victim’s
approval; `withdrawColl`
from someone else’s
CDP; `liquidate` of a
healthy CDP in normal
mode; ActivePool
flashloan that skips
repay; surplus claim
that sends another
account’s stETH to
the caller.

Result: no
user-exploitable
finding. Not submitted.

- BorrowerOperations
  `openCdp` / adjust /
  `closeCdp` require
  the borrower or a
  position manager
  they approved.
  Collateral
  `transferFrom`s
  `msg.sender`. Debt
  mints to
  `msg.sender`. Close
  burns the caller’s
  eBTC then sends
  coll + liquidator
  reward shares to
  `msg.sender`.
- ActivePool
  coll / debt moves
  are Borrower
  Operations or
  CdpManager.
  Flashloan is
  stETH only, requires
  callback success,
  `transferFrom` of
  principal + fee,
  and post-balance /
  share / rate
  invariants.
  `sweepToken` is
  `requiresAuth` and
  cannot sweep
  collateral.
- CollSurplusPool
  `claimSurplusCollShares`
  is Borrower
  Operations only and
  pays `_account`.
  `increaseTotalSurplusCollShares`
  is ActivePool.
- EBTCToken `mint` /
  `burn` are Borrower
  Operations,
  CdpManager, or
  authority.
- Liquidation needs
  ICR < MCR, or
  recovery mode after
  the grace period.
  Redemption burns
  the caller’s eBTC
  and walks the
  lowest ICR ≥ MCR.
- SortedCdps `insert`
  is Borrower
  Operations or
  CdpManager.
- EbtcFeed falls
  back to
  `lastGoodPrice`
  when both oracles
  return 0. PriceFeed
  can return
  `INVALID_PRICE`.
  ChainlinkAdapter
  requires
  `answer > 0`.
  Do not file last-
  good-price or
  governor
  `requiresAuth`
  as a stranger drain.

Not submitted.
Listed eBTC Boost
GitHub leftover is
exhausted.

## 2026-09-03: 1inch Solana CCS + Fusion leftover (`58b8a42` / `0768267`)

Immunefi program
`1inch-SmartContracts`
($500,000, `kyc:
true`). EVM
cross-chain-swap is
already logged. This
slice is the last
listed trees:
`solana-crosschain-protocol`
and `solana-fusion`.
Local clones
`/tmp/1inch-sol-ccs`
at `58b8a42` and
`/tmp/1inch-sol-fusion`
at `0768267`. No
mainnet interaction.

Files:
`programs/cross-chain-escrow-src/src/{lib,utils}.rs`,
`programs/cross-chain-escrow-dst/src/{lib,utils}.rs`,
`programs/whitelist/src/lib.rs`,
`solana-fusion/programs/fusion-swap/src/lib.rs`.

Checked for: a
stranger withdraw
with a wrong secret;
cancel that pays
tokens to the
caller; Fusion
`fill` that skips
paying the maker;
whitelist
`register` by a
non-authority.

Result: no
user-exploitable
finding. Not
submitted.

- Src withdraw is
  taker-signed in
  the private
  window;
  `keccak256(secret)`
  must match
  `escrow.hashlock`.
  Tokens go to the
  taker ATA. Public
  withdraw / cancel
  award the safety
  deposit to the
  payer and still
  pay tokens to
  taker / maker.
  Src cancel after
  `SrcCancellation`
  returns tokens to
  the stored maker.
- Dst `create`
  pulls from the
  creator and
  requires dst
  cancel not after
  src cancel.
  Withdraw is
  creator-signed,
  secret-checked,
  and pays the
  stored
  `recipient`.
- Fusion `fill`
  requires a
  whitelist
  `ResolverAccess`
  PDA. Escrow seeds
  bind
  `order_hash`
  (config + mints +
  receiver). Src
  tokens go to the
  taker; dst tokens
  (minus fees) go
  to
  `maker_receiver`.
  `cancel` is
  maker-signed and
  returns remaining
  src to the maker.
  `cancel_by_resolver`
  is after expiry
  only.
- Whitelist
  `register` /
  `deregister` /
  `set_authority`
  require the
  stored authority.

Not submitted.
Listed 1inch
SmartContracts
GitHub leftover is
exhausted.

## 2026-09-03: Aevo deposit leftover (Sourcify)

Immunefi program
`Aevo` ($300,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
`0x4082C9647c098a6493fb499EaE63b5ce3259c574`
Sourcify `match`
`L1ChugSplashProxy`
only (solc 0.8.15).
Arbitrum
`0x80d40e32fad8be8da5c6a42b8af1e181984d137c`
Sourcify `match`
`Vault` (solc 0.8.13)
plus
`ConnectorPlug`.
Extract `/tmp/aevo`.
No mainnet
interaction.

Files:
`L1ChugSplashProxy.sol`,
`Vault.sol`,
`ConnectorPlug.sol`,
`Gauge.sol`.

Checked for: a
stranger
`receiveInbound`
that unlocks vault
tokens; pending
unlock paid to the
caller; ChugSplash
`setCode` by anyone.

Result: no
user-exploitable
finding. Not
submitted.

- Vault
  `depositToAppChain`
  `transferFrom`s
  `msg.sender` after
  a lock-limit
  consume, then
  `connector.outbound`.
  Unconfigured
  connectors have
  `maxLimit == 0`.
- `receiveInbound`
  requires
  `_unlockLimitParams
  [msg.sender].
  maxLimit != 0`
  (owner-set
  connector). Pays
  the payload
  `receiver`.
  `unlockPendingFor`
  is permissionless
  but transfers to
  `receiver_`.
- `ConnectorPlug.
  inbound` is
  Socket-only.
  `outbound` is the
  hub. `connect` /
  `disconnect` are
  owner.
- ChugSplash
  `setCode` /
  `setStorage` /
  `setOwner` run
  only for the
  owner (else
  `delegatecall`
  implementation).

Do not file owner
rate-limit writes
or Socket-trusted
inbound as theft.

Not submitted.
Listed leftover is
the Arb Vault +
Socket plug and the
ETH ChugSplash
proxy. ETH
ChugSplash
implementation
leftover is logged
(listed Aevo leftover
exhausted).

## 2026-09-03: Lido core submit / withdrawal leftover (`2da0f48`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Listed
tree
`lidofinance/core`
was not previously
logged (earlier “Lido”
mentions are DeFi
Saver / Origin
integrations). Local
sparse clone
`/tmp/lido-core` at
`2da0f48` (“Merge pull
request #1936”). No
mainnet interaction.

Files:
`contracts/0.4.24/Lido.sol`,
`StETH.sol`,
`0.6.12/WstETH.sol`,
`0.8.9/WithdrawalQueue.sol`,
`WithdrawalQueueBase.sol`,
`WithdrawalQueueERC721.sol`,
`WithdrawalVault.sol`,
`Accounting.sol`.

Checked for: a
stranger `submit` that
mints stETH without
`msg.value`;
`mintShares` callable
by a non-accounting
address; withdrawal
`claim` that pays a
request the caller
does not own;
`finalize` without
`FINALIZE_ROLE`;
oracle report applied
by a non-oracle.

Result: no
user-exploitable
finding. Not submitted.

- `submit` / `_submit`
  require non-zero
  `msg.value`, mint
  shares to
  `msg.sender`, and
  increase the buffer.
- `mintShares` is
  accounting.
  `burnShares` is
  burner and burns
  `msg.sender`.
  `mintExternalShares`
  is VaultHub and
  capped by the
  external-ratio
  limit.
  `receiveELRewards` /
  `receiveWithdrawals`
  are the EL rewards
  vault and withdrawal
  vault.
  `withdrawDepositableEther`
  is StakingRouter.
- WithdrawalQueue
  `requestWithdrawals`
  `transferFrom`s
  `msg.sender`.
  `_claim` requires
  `request.owner ==
  msg.sender` after
  finalization.
  `finalize` is
  `FINALIZE_ROLE`.
  `onOracleReport` is
  `ORACLE_ROLE`.
- WstETH `wrap`
  `transferFrom`s the
  caller then mints
  share-equivalent
  wstETH. `unwrap`
  burns the caller
  then pays
  `getPooledEthByShares`.
- WithdrawalVault
  `withdrawWithdrawals`
  is Lido-only.
  Permissionless
  `recoverERC20` sends
  to treasury, not the
  caller.
- Accounting
  `handleOracleReport`
  is
  `accountingOracle`.

Do not file
permissionless
treasury recover or
the known 1–2 wei
withdrawal rounding
dust as a finding.

Not submitted.
Remaining Lido listed
GitHub: StakingRouter /
CSM / dual-governance /
easy-track / L2 /
circuit-breaker /
oracle / 0.8.25 vaults
and the other listed
repos.

## 2026-09-03: Lido StakingRouter leftover (`2da0f48`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Submit /
withdrawal leftover
already logged on the
same pin. This slice
is `StakingRouter` +
`BeaconChainDepositor`.
Local sparse clone
`/tmp/lido-core` at
`2da0f48`. No mainnet
interaction.

Files:
`contracts/0.8.25/sr/StakingRouter.sol`,
`SRLib.sol`,
`SRStorage.sol`,
`SRUtils.sol`,
`lib/BeaconChainDepositor.sol`.

Checked for: a
stranger `deposit`
that pulls buffered
ETH to an attacker
key; `topUp` that
sends ETH off the
official deposit
contract;
`receiveDepositableEther`
callable by anyone;
module add that
redirects withdrawal
credentials.

Result: no
user-exploitable
finding. Not submitted.

- `receiveDepositableEther`
  is Lido only
  (`_checkAppAuth`).
- `deposit` is
  DepositSecurityModule
  only. It asks the
  active module for
  keys, caps count by
  allocation and
  `maxDepositsPerBlock`,
  updates last-deposit
  state, pulls ETH
  from Lido, and
  `makeBeaconChainDeposits32ETH`
  to the official
  deposit contract
  with stored
  withdrawal
  credentials.
  Post-balance must
  match pre-balance.
- `topUp` is
  TopUpGateway only,
  type-0x02 modules,
  allocations must be
  gwei-aligned and
  ≤ limits, then
  `makeBeaconChainTopUp`.
- `addStakingModule` /
  `updateStakingModule`
  / fee batch /
  max top-up are
  `STAKING_MODULE_MANAGE_ROLE`
  (share updates are
  `STAKING_MODULE_SHARE_MANAGE_ROLE`).
- `setWithdrawalCredentials`
  is
  `MANAGE_WITHDRAWAL_CREDENTIALS_ROLE`
  and requires a
  non-zero address
  plus a valid WC
  type. Reward /
  exit reports are
  their report roles.

Do not file DSM /
TopUpGateway
privilege as a
stranger drain.

Not submitted.
Remaining Lido listed
GitHub: CSM /
dual-governance /
easy-track / L2 /
circuit-breaker /
oracle / 0.8.25 vaults
and the other listed
repos.

## 2026-09-03: StakeWise Mainnet leftover (Sourcify)

Immunefi program
`StakeWise Mainnet`
($200,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
proxies + impls
Sourcify-open:
Pool
`0xC874b064f465bdD6411D45734b56fac750Cda29A`
`exact_match`
`AdminUpgradeabilityProxy`
impl
`0x481f28C0D733614aF87897E43d0D52C451799592`
`Pool` (solc 0.7.5);
PoolEscrow
`0x2296e122c1a20Fca3CAc3371357BdAd3be0dF079`
`match`;
PoolValidators
`0x002932e11E95DC84C17ed5f94a0439645D8a97BC`
impl
`0xfa00515082fe90430C80DA9B299f353929653d7B`;
sETH2
`0xFe2e637202056d30016725477c5da089Ab0A043A`
impl
`0x82FE8C78CaE0013471179e76224ef89941bAaa75`;
rETH2
`0x20BC832ca081b91433ff6c17f85701B6e92486c5`
impl
`0x01d34aeE72325F1d4A748f13C2169404523eCEE0`;
SWISE
`0x48C3399719B582dD63eB5AADf12A40B4C3f52FA2`
impl
`0xA28C2d79f0c5B78CeC699DAB0303008179815396`;
Oracles
`0x8a887282E67ff41d36C0b7537eAB035291461AcD`
impl
`0xF0C1670364d4b5c4e9dc8062cDd45068D9c678d6`;
VestingEscrow
`0xaE678D2A911400a55e06f4A1F0C0B363F3eE2e42`
`match`;
VestingEscrowFactory
`0x7B910cc3D4B42FEFF056218bD56d7700E4ea7dD5`
impl
`0xbeE3Eb97Cfd94ace6B66E606B8088C57c5f78fBf`;
MerkleDistributor
`0xA3F21010e8b9a3930996C8849Df38f9Ca3647c20`
impl
`0x1d873651c38D912c8A7E1eBfB013Aa96bE5AACBC`;
Roles
`0xC486c10e3611565F5b38b50ad68277b11C889623`
impl
`0x584E5D4bD0AE1EEF838796aEe8fb805BbB82439C`;
ProxyAdmin
`0x3EB0175dcD67d3AB139aA03165e24AA2188A4C22`
`exact_match`;
Gnosis Safe
`0x144a98cb1CdBb23610501fE6108858D9B7D24934`
`match` proxy.
rETH2 ctor vault
`0xac0f906e433d58fa868f936e8a43230473652885`
Sourcify
`ERC1967Proxy`
impl
`0xf113BfD6423291b1dD2cA76f897bFf54456e7c88`
`EthGenesisVault`
(solc 0.8.26).
Extract `/tmp/stakewise`.
No mainnet
interaction.

Files:
`Pool.sol`,
`PoolEscrow.sol`,
`PoolValidators.sol`,
`StakedEthToken.sol`,
`RewardEthToken.sol`,
`Oracles.sol`,
`MerkleDistributor.sol`,
`VestingEscrow.sol`,
`VestingEscrowFactory.sol`,
`StakeWiseToken.sol`,
`Roles.sol`,
`EthGenesisVault.sol`.

Checked for: a
stranger mint of
sETH2/rETH2; merkle
claim paid to the
caller; oracle root
with one signature;
`migrate` that burns
another account;
escrow `withdraw` by
anyone; genesis
`migrate` without
the rETH2 caller.

Result: no
user-exploitable
finding. Not
submitted.

- Current Pool impl
  is a post-v3 stub:
  `receiveFees` and
  permissionless
  `transferToPoolEscrow`
  (sweeps ETH to
  escrow, not the
  caller). No stake /
  mint / 
  `registerValidator`.
- PoolValidators
  `registerValidator`
  is oracles-only
  and merkle-checked;
  the current Pool
  no longer exposes
  that function (dead
  path).
- PoolEscrow
  `withdraw` is
  owner-only
  two-step
  ownership.
  Genesis vault
  `_pullWithdrawals`
  requires the vault
  to be escrow
  owner.
- rETH2
  `updateTotalRewards`
  is the immutable
  vault. `claim` is
  MerkleDistributor.
  `migrate` burns
  `msg.sender` then
  `vault.migrate`.
  Transfers blocked
  in the update
  block.
- sETH2 `burn` is
  rETH2-only.
  `toggleRewards` is
  admin.
- Oracles
  `submitMerkleRoot`
  needs `>2/3`
  unique oracle
  signatures plus
  nonce. Distributor
  `claim` pays
  `account`, not
  the caller.
  Bitmap is per
  root.
- Vesting `claim`
  is recipient-only.
  `stop` is admin
  and can pull
  unvested (admin
  trust). Factory
  `deployEscrow` is
  admin; listed
  escrow impl
  `initialize` is
  7-arg vs factory
  8-arg (admin path
  would miss /
  revert).
- Roles is
  event-only. SWISE
  mints 1B once to
  admin; no later
  mint.
- EthGenesisVault
  `migrate` requires
  `msg.sender ==
  rETH2` and escrow
  owner == vault.
  `receive` deposits
  unless the sender
  is the escrow.

Do not file admin
pause / fee /
escrow withdraw,
oracle or Keeper
harvest trust, or
the vault owning
PoolEscrow after
migration.

Not submitted.
Listed leftover is
the Sourcify-open
v2 proxies + impls
+ PoolEscrow +
Vesting + Safe +
the linked genesis
vault migrate hook.
Remaining listed:
DAO Module
`0xb5cf5363c3e766e64b37b2fb9554bfe8d48ed1a0`
Sourcify 404.
Remaining unlisted:
FeesEscrow storage
slot and V3 Keeper /
osToken / other
vaults.

## 2026-09-03: Rhino.fi deposit leftover (Sourcify)

Immunefi program
`Rhino.fi` /
`rhinofi` ($2,000,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Sourcify-open
listed proxies:
Optimism
`0x0bCa65bf4b4c8803d2f0B49353ed57CAAF3d66Dc`
impl
`0x87627c7E586441EeF9eE3C28B66662e897513f33`;
BSC
`0xB80A582fa430645A043bB4f6135321ee01005fEf`
impl
`0x5ab2790bE0ADe18af686f38C5321Af1D8daa3192`;
Arbitrum
`0x10417734001162ea139e8b044dfe28dbb8b28ad0`
impl
`0x2cA9f060e4A50434265dC38c7f539C5bC630E368`
all `exact_match`
`DVFDepositContract`
+ `BridgeVM` (solc
0.8.4, identical
source). ARB / BSC /
MATIC MultiSigs
Sourcify `match`
`GnosisSafeProxy` →
`GnosisSafeL2`.
Extract `/tmp/rhino`.
No mainnet
interaction.

Files:
`DVFDepositContract.sol`,
`BridgeVM.sol`.

Checked for: a
stranger withdraw
that pulls escrow
tokens; `withdrawVmFunds`
paid to the caller;
`BridgeVM.execute`
without owner;
deposit that credits
without
`transferFrom`.

Result: no
user-exploitable
finding. Not
submitted.

- `depositWithId` /
  `depositWithPermit`
  `safeTransferFrom`
  `msg.sender`.
  Native deposit
  only emits
  `msg.value`.
  `commitmentId` is
  off-chain; an
  invalid id does
  not move tokens
  back.
- All withdraw /
  `addFunds` /
  `removeFunds` /
  `swapWithData` /
  `withdrawWithData`
  paths are
  `authorized`.
  `authorize` is
  owner. Program
  text: no
  assumption of
  authorized-account
  access.
- `BridgeVM` is
  deployed by the
  deposit contract
  (`createVMContract`
  public only while
  `vm == 0`).
  `execute` is
  `onlyOwner` (the
  deposit contract).
- `withdrawVmFunds`
  is permissionless
  but transfers
  stuck VM tokens /
  ETH to the VM
  owner (escrow),
  not the caller.
- Unused storage
  `depositsDisallowed`
  / `maxDepositAmount`
  / `processedWithdrawalIds`
  are not checked
  on deposit (no
  on-chain limit
  advertised).

Do not file
authorized-operator
withdraws or
custodial-bridge
centralization.

Not submitted.
Listed leftover is
the OP / BSC / ARB
`DVFDepositContract`
impls + listed
Gnosis safes.
Remaining listed:
zkEVM bridge /
zkSync bridge
Sourcify 404;
Polygon bridge
impl
`0x717D0Bf97Ce58E14945F5e0320EE98381aeadDAf`
Sourcify 404 on
chain 137.

## 2026-09-03: Lido lido-l2 + circuit-breaker + vesting + stonks leftover (`badf17c` / `6829a5a` / `580f802` / `a7812a4`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Listed
GitHub trees include
`core`, `lido-l2`,
`lido-l2-with-steth`,
`circuit-breaker`,
`lido-vesting-escrow`,
`stonks`,
`dual-governance`,
CSM, easy-track, and
others. This slice is
the four leftover
trees that were not
yet in this log.
Local clones
`/tmp/lidofinance-lido-l2`
at `badf17c`,
`/tmp/lidofinance-circuit-breaker`
at `6829a5a`,
`/tmp/lidofinance-lido-vesting-escrow`
at `580f802`, and
`/tmp/lidofinance-stonks`
at `a7812a4`. No
mainnet interaction.

Files:
`lido-l2/contracts/{BridgingManager,BridgeableTokens}.sol`,
`optimism/{L1,L2}ERC20TokenBridge.sol`,
`optimism/CrossDomainEnabled.sol`,
`arbitrum/{L1,L2}ERC20TokenGateway.sol`,
`arbitrum/InterchainERC20TokenGateway.sol`,
`arbitrum/L1CrossDomainEnabled.sol`,
`arbitrum/libraries/{L1,L2}OutboundDataParser.sol`,
`token/{ERC20Bridged,ERC20Metadata}.sol`,
`circuit-breaker/src/{CircuitBreaker,Registry}.sol`,
`lido-vesting-escrow/contracts/{VestingEscrow,VestingEscrowFactory}.vy`,
`stonks/contracts/{Stonks,Order,AssetRecoverer}.sol`.

Checked for: a
stranger finalize
that unlocks L1
tokens without a
matching L2 burn;
Arbitrum `from`
spoof that pulls
another user’s
allowance; L2 mint
by a non-messenger;
circuit-breaker
pause by a
non-pauser; vesting
`recover_erc20` that
drains locked
tokens; Stonks
order that settles
to the caller or
skips the CoW
price check.

Result: no
user-exploitable
finding. Not
submitted.

- Optimism L1
  `depositERC20` is
  EOA-only;
  `depositERC20To`
  pulls
  `msg.sender`.
  Withdraw finalize
  requires the
  messenger and
  `xDomainMessageSender
  == l2TokenBridge`,
  then transfers
  locked L1 tokens
  to `to_`. L2
  withdraw burns
  `msg.sender` and
  messages L1.
  `finalizeDeposit`
  mints only after
  the same
  messenger check.
  Tokens are
  immutable pair
  filters.
- Arbitrum L1
  `outboundTransfer`
  decodes `from`
  from calldata
  only when
  `msg.sender` is
  the router;
  otherwise `from`
  is `msg.sender`.
  Finalize inbound
  requires the
  Inbox bridge +
  outbox
  `l2ToL1Sender ==
  counterpartGateway`.
  L2 outbound burns
  the decoded `from`
  (router-trusted
  or `msg.sender`)
  and inbound mint
  is
  counterpart-only.
- `BridgingManager.
  initialize` is
  once. Enable /
  disable deposits
  and withdrawals
  are role-gated.
  `ERC20Bridged`
  mint/burn is
  `onlyBridge`.
  Metadata set is
  empty-string
  once.
- CircuitBreaker
  `registerPauser`
  is admin-only.
  `pause` requires
  the live
  registered
  pauser, is
  single-use
  (unregisters),
  and reentrancy-
  guarded.
  `heartbeat` also
  requires a live
  registered
  pauser.
- Vesting
  implementation
  cannot be
  initialized.
  Clones require
  `balanceOf >=
  amount`. `claim`
  is recipient-only
  and caps at
  vested-unclaimed.
  `revoke_unvested`
  / `revoke_all`
  pay the factory
  owner.
  `recover_erc20`
  of the vesting
  token is limited
  to
  `balance -
  (locked +
  unclaimed)` and
  pays the
  recipient.
- Stonks
  `placeOrder` is
  admin/manager,
  non-reentrant,
  and transfers
  `TOKEN_FROM` into
  a clone. Order
  `initialize` is
  once (impl is
  pre-initialized).
  CoW
  `isValidSignature`
  checks hash,
  expiry,
  cancellation,
  global pause, and
  oracle price vs
  stored limit ±
  tolerance /
  improvement.
  `recoverTokenFrom`
  after expiry
  returns sell
  tokens to Stonks;
  `recoverERC20`
  cannot take
  `tokenFrom`.
  Receiver is
  baked at
  initialize
  (defaults to
  AGENT).

Not submitted.
Lido `core` submit /
withdrawal and
StakingRouter leftover
are already logged on
`2da0f48`. Remaining
Lido listed GitHub:
`lido-l2-with-steth`,
`aave-delivery-infrastructure`,
`governance-crosschain-bridges`,
`mev-boost-relay-allowed-list`,
`community-staking-module`,
`easy-track`,
`dual-governance`,
`aragon-apps`, and
0.8.25 vaults.
Oracle / keys-api /
validator-ejector /
council-daemon /
oz-merkle-tree /
onchain-mon are
ops or web, not
this leftover
slice.

## 2026-09-03: Lido lido-l2-with-steth leftover (`4fec842`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). `core`
submit / withdrawal /
StakingRouter and
`lido-l2` +
circuit-breaker +
vesting + stonks are
already logged. This
slice is
`lido-l2-with-steth`.
Local clone
`/tmp/lidofinance-lido-l2-with-steth`
at `4fec842`. No
mainnet interaction.

Files:
`optimism/{L1LidoTokensBridge,L1ERC20ExtendedTokensBridge,L2ERC20ExtendedTokensBridge,RebasableAndNonRebasableTokens,TokenRateOracle}.sol`,
`token/ERC20RebasableBridged.sol`,
`lib/DepositDataCodec.sol`.

Checked for: a
stranger finalize
that unlocks L1
stETH/wstETH without
a matching L2 burn;
rebasable mint that
skips wrapping
shares; `updateRate`
from a
non-messenger;
unwrap that pays
more shares than
were burned.

Result: no
user-exploitable
finding. Not
submitted.

- L1 deposit is
  EOA-only on
  `depositERC20`;
  `depositERC20To`
  pulls
  `msg.sender`.
  Rebasable
  deposits wrap to
  wstETH on the
  bridge before the
  L2 message.
  Amount in the
  message is always
  non-rebasable
  shares. Rate + L1
  timestamp are
  encoded from the
  L1 oracle, not
  the caller.
- L1 finalize
  requires the
  messenger and
  `xDomainMessageSender
  == L2 bridge`.
  Rebasable
  withdrawals
  unwrap the
  locked wstETH
  then transfer
  stETH to `to_`.
  Token pairs are
  immutable
  (stETH↔stETH,
  wstETH↔wstETH).
- L2
  `finalizeDeposit`
  is messenger +
  L1-bridge only.
  It updates the
  rate then mints
  wstETH (or mints
  to the bridge and
  `bridgeWrap`s
  stETH). Withdraw
  burns
  `msg.sender`
  (unwrap + burn
  shares for
  rebasable) and
  blocks transfers
  to the L1 token
  contracts.
- `TokenRateOracle.
  updateRate` is
  `onlyBridgeOrTokenRatePusher`.
  Stale L1
  timestamps are
  ignored. Same
  timestamp only
  bumps the L2
  receipt time.
  New rates must
  wait
  `MIN_TIME_BETWEEN`
  and stay inside
  the per-day
  deviation plus
  sane min/max.
  Pause / resume
  are role-gated.
- Rebasable wrap /
  unwrap is 1:1
  shares of the
  wrapped token.
  `bridgeWrap` /
  `bridgeUnwrap`
  are `onlyBridge`.
  User `wrap` /
  `unwrap` move
  `msg.sender`’s
  tokens only.

Not submitted.
Remaining Lido
listed GitHub:
`aave-delivery-infrastructure`,
`governance-crosschain-bridges`,
`mev-boost-relay-allowed-list`,
`community-staking-module`,
`easy-track`,
`dual-governance`,
`aragon-apps`, and
0.8.25 vaults.

## 2026-09-03: Lido 0.8.25 vault leftover (`2da0f48`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Submit /
withdrawal and
StakingRouter leftovers
are already logged on
the same pin. L2 /
circuit-breaker /
vesting / stonks are
logged on other trees.
This slice is the
stVault money path in
`lidofinance/core`
`contracts/0.8.25/vaults`.
Local sparse clone
`/tmp/lido-core` at
`2da0f48`. No mainnet
interaction.

Files:
`StakingVault.sol`,
`VaultHub.sol`,
`VaultFactory.sol`,
`OperatorGrid.sol`,
`LazyOracle.sol`,
`PinnedBeaconProxy.sol`,
`dashboard/{Dashboard,Permissions,NodeOperatorFee}.sol`,
`predeposit_guarantee/PredepositGuarantee.sol`,
`ValidatorConsolidationRequests.sol`.

Checked for: a
stranger `mintShares`
against another vault;
`withdraw` of locked
collateral after a
stale or crafted
report; factory
connect of a tampered
proxy; PDG
compensation that
pays the caller;
permissionless
`forceRebalance` /
`settleLidoFees` that
sends ETH off-treasury;
unguaranteed deposit
as a stranger.

Result: no
user-exploitable
finding. Not submitted.

- `StakingVault`
  `fund` / `withdraw`
  / pause / ossify /
  `collectERC20` /
  `setDepositor` /
  `triggerValidatorWithdrawals`
  are `onlyOwner`.
  Beacon deposits /
  `stage` / `unstage`
  are `onlyDepositor`
  (PDG on factory
  vaults). WC is
  `0x02 | address(this)`.
  `receive()` is a
  permissionless
  donation. `ejectValidators`
  is node-operator
  EIP-7002 full exit;
  ETH returns to the
  vault WC; only the
  fee surplus is
  refunded.
  `collectERC20`
  blocks the EIP-7528
  ETH sentinel.
  `depositFromStaged`
  ignores the pause
  when
  `_additionalAmount
  == 0` so a proved
  31 ETH activation
  can finish after
  Hub pauses deposits
  for obligations.
- `VaultFactory`
  deploys a
  `PinnedBeaconProxy`,
  marks
  `deployedByThisFactory`,
  sets Dashboard as
  vault owner and PDG
  as depositor, then
  either connects
  (needs
  `CONNECT_DEPOSIT`)
  or leaves the vault
  disconnected.
  Optional roles are
  granted while the
  factory still holds
  admin / NOM; that
  is the creator’s
  own vault.
- `VaultHub.connectVault`
  is permissionless
  but requires a
  factory-deployed
  vault, `msg.sender
  == vault.owner()`,
  Hub as pending
  owner, not
  ossified, PDG as
  depositor, staged
  ETH matching
  `pendingActivations
  * 31 ETH`, and
  `availableBalance
  >= 1 ETH`. Limits
  come from
  `OperatorGrid.vaultTierInfo`
  (default tier
  until a dual-
  confirmed change).
- `mintShares` is
  connection owner +
  fresh report +
  share limit +
  lockable value
  (TV minus
  unsettled fees) +
  `OperatorGrid.onMintedShares`
  (jail / tier /
  group caps), then
  `LIDO.mintExternalShares`.
  `withdraw` caps at
  unlocked ETH minus
  redemption shares
  minus unsettled
  Lido fees.
  `burnShares` /
  `transferAndBurnShares`
  decrease liability
  and burn from Hub.
  `fund` updates
  `inOutDelta`.
- `applyVaultReport`
  is LazyOracle only.
  `maxLiabilityShares`
  is not lowered when
  shares were minted
  after the refslot,
  which blocks the
  mint → apply-old-
  report → unlock →
  withdraw loop.
  Disconnect
  completes on a
  later report only
  if liability and
  slashing reserve
  are zero; otherwise
  it aborts.
- `forceRebalance`
  is permissionless
  and only burns
  obligation shares
  by pulling vault
  ETH to Hub and
  `rebalanceExternalEtherToInternal`.
  `settleLidoFees`
  is permissionless
  and pays treasury.
  `socializeBadDebt`
  / `internalizeBadDebt`
  are
  `BAD_DEBT_MASTER_ROLE`;
  socialize is
  same-operator and
  capacity-capped.
  `updateConnection`
  is OperatorGrid
  only.
  `decreaseInternalizedBadDebt`
  is Accounting only.
- `LazyOracle.updateReportData`
  is AccountingOracle
  only.
  `updateVaultData`
  is permissionless
  but Merkle-proved
  against that root,
  rejects a non-
  newer timestamp,
  caps fee growth,
  forbids fee
  decrease, and
  quarantines TV
  jumps above
  `maxRewardRatioBP`.
- `OperatorGrid`
  group / tier /
  jail / fee writes
  are `REGISTRY_ROLE`.
  `changeTier` /
  `syncTier` /
  `updateVaultShareLimit`
  need owner + node-
  operator
  confirmations.
  `onMintedShares` /
  `onBurnedShares` /
  `resetVaultTier`
  are VaultHub only.
- `PredepositGuarantee.predeposit`
  is the NO
  depositor: BLS-
  verifies the 1 ETH
  deposit, locks the
  same amount of
  guarantor
  collateral, and
  stages 31 ETH.
  `proveWCAndActivate`
  / `activateValidator`
  / `proveInvalidValidatorWC`
  are permissionless.
  Invalid-WC proof
  pays the vault
  from locked
  guarantee and
  unstages 31 ETH;
  it does not pay
  the caller.
  `topUpExistingValidators`
  is depositor-only
  and uses vault WC.
- Dashboard
  fund / withdraw /
  mint / burn /
  rebalance /
  disconnect /
  configuration are
  role-gated
  (`FUND` / `WITHDRAW`
  / `MINT` / `BURN`
  / `REBALANCE` /
  `VOLUNTARY_DISCONNECT`
  / `VAULT_CONFIGURATION`).
  `unguaranteedDepositToBeaconChain`
  needs
  `ALLOW_DEPOSIT_AND_PROVE`
  plus
  `NODE_OPERATOR_UNGUARANTEED_DEPOSIT_ROLE`
  and is documented
  as frontrunnable
  trusted-operator
  flow. `disburseFee`
  and
  `recoverFeeLeftover`
  are permissionless
  pulls to
  `feeRecipient`.
  `ValidatorConsolidationRequests`
  only encodes
  EIP-7251 calls; it
  does not hold
  vault ETH.

Do not file
`depositFromStaged`
pause bypass on a
zero additional
amount (intended
activation);
unguaranteed-deposit
frontrun (documented
trust + role);
permissionless
`forceRebalance` /
`settleLidoFees` /
`disburseFee` /
`recoverFeeLeftover`
(they pay Hub /
treasury /
`feeRecipient`);
node-operator
`ejectValidators`
(ETH returns to the
vault); LazyOracle
quarantine as a
stranger under-
report (it caps
mintable value);
`CONNECT_DEPOSIT`
lock; or
`BAD_DEBT_MASTER` /
`VAULT_MASTER` /
`VALIDATOR_EXIT` /
`REGISTRY_ROLE`
privilege as a
stranger drain.

Not submitted.
Remaining Lido listed
GitHub:
`aave-delivery-infrastructure`,
`governance-crosschain-bridges`,
`mev-boost-relay-allowed-list`,
`community-staking-module`,
`easy-track`,
`dual-governance`,
`aragon-apps`.
Oracle / keys-api /
validator-ejector /
council-daemon /
oz-merkle-tree /
onchain-mon are
ops or web.


## 2026-09-03: Lido dual-governance Escrow leftover (`ba9dfc9`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). `core`,
`lido-l2`,
`lido-l2-with-steth`,
circuit-breaker,
vesting, and stonks
are already logged.
This slice is the
Escrow money path in
`dual-governance`.
Local clone
`/tmp/lidofinance-dual-governance`
at `ba9dfc9`. No
mainnet interaction.

Files:
`contracts/Escrow.sol`,
`libraries/AssetsAccounting.sol`.

Checked for: a
stranger unlock that
returns another
vetoer’s stETH;
rage-quit
`withdrawETH` that
pays a caller who
did not lock;
unstETH claim that
credits the caller;
pro-rata withdraw
that can be drained
by a late lock.

Result: no
user-exploitable
finding. Not
submitted.

- Signalling
  `lockStETH` /
  `lockWstETH` pull
  `msg.sender` then
  credit that
  holder’s shares.
  `unlock*` require
  the min lock
  duration and pay
  only the holder’s
  accounted shares
  (wstETH wrap is
  after unlock
  accounting).
  `lockUnstETH` /
  `unlockUnstETH`
  transfer NFTs
  only after
  `accountUnstETH*`
  binds
  `lockedBy ==
  holder`.
  Finalized /
  already-locked
  NFTs revert.
- `startRageQuit`
  and
  `setMinAssetsLockDuration`
  are DualGovernance
  only. After rage
  quit, lock /
  unlock are
  blocked by
  `checkSignallingEscrow`.
- `withdrawETH()`
  is holder-only.
  It zeros that
  holder’s shares
  and pays
  `claimedETH *
  holderShares /
  totals.lockedShares`.
  Totals stay
  fixed so later
  holders cannot
  inflate the
  denominator.
  Dust stays in
  the contract.
- `withdrawETH(ids)`
  requires each
  record
  `Claimed` and
  `lockedBy ==
  msg.sender`, then
  marks
  `Withdrawn`.
  `claimUnstETH` is
  permissionless
  but ETH stays in
  the Escrow;
  accounting
  asserts the
  balance delta
  equals the
  claimable sum.

Not submitted.
Remaining
dual-governance:
`DualGovernance.sol`,
EmergencyProtectedTimelock,
committees,
ResealManager.
Remaining Lido
listed GitHub:
CSM / easy-track /
governance bridges.
0.8.25 vault leftover
is already logged on
`2da0f48`.

## 2026-09-03: Lido CSM bond leftover (`2824e21`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2, vesting, stonks,
and 0.8.25 vaults are
already logged. Dual-
governance Escrow is
logged on `ba9dfc9`.
This slice is the CSM
bond / fee / deposit
queue money path.
Local clone
`/tmp/lido-csm` at
`2824e21`. No mainnet
interaction.

Files:
`src/Accounting.sol`,
`src/abstract/BondCore.sol`,
`src/FeeDistributor.sol`,
`src/PermissionlessGate.sol`,
`src/CSModule.sol`,
`src/abstract/BaseModule.sol`
(`createNodeOperator`,
`addValidatorKeys*`,
`obtainDepositData`,
`allocateDeposits`).

Checked for: a
stranger claim of
another operator’s
bond; recover that
drains `totalBondShares`;
fee Merkle proof that
overpays the caller;
`obtainDepositData` by
a non-router; a gate
that bonds a victim
permit into the
caller’s operator.

Result: no
user-exploitable
finding. Not submitted.

- Public
  `depositETH` /
  `depositStETH` /
  `depositWstETH(noId)`
  credit that
  existing operator
  from `msg.sender`
  (`Lido.submit` or
  `transferSharesFrom`
  / unwrap). Anyone
  can top up another
  operator; that is a
  donation. The
  `from` overloads
  are `onlyModule`.
- `claimRewards*`
  require manager,
  reward address, or
  custom claimer, pay
  `rewardAddress`,
  and only transfer
  excess over
  required + locked +
  debt. Fee pulls go
  through
  `FeeDistributor.distributeFees`
  (Accounting-only,
  non-empty Merkle
  proof, cumulative
  shares must not
  decrease) and then
  optional fee-split
  transfers.
- `lockBond` /
  `releaseLockedBond` /
  `compensateLockedBond` /
  `settleLockedBond` /
  `penalize` /
  `chargeFee` are
  `onlyModule`.
  `recoverERC20`
  blocks stETH.
  `recoverStETHShares`
  is recoverer-only
  and subtracts
  `totalBondShares`.
- `FeeDistributor.processOracleReport`
  is oracle-only,
  caps
  `distributed+rebate`
  by contract shares,
  and pays rebate to
  `rebateRecipient`.
  stETH recover is
  blocked.
- `PermissionlessGate`
  creates an operator
  for `msg.sender`
  then adds keys with
  that sender’s ETH /
  stETH / wstETH.
  `CSModule._checkCanAddKeys`
  allows a gate only
  when
  `OperatorTracker`
  creator ==
  `msg.sender`.
- `obtainDepositData`
  and
  `allocateDeposits`
  are StakingRouter
  only. Deposit data
  requires up-to-date
  deposit info.
  Unbonded keys on a
  negative rebase are
  documented and
  expected to be
  exited by VEBO.

Do not file a
permissionless bond
top-up of another
operator (donation);
recoverer privilege;
CREATE-role as a
stranger drain; or
the documented
unbonded-key rebase
trade-off.

Not submitted.
Remaining CSM:
Vetted / Curated
gates and modules,
Verifier, Ejector,
ExitPenalties,
FeeOracle / HashConsensus.
Remaining Lido listed
GitHub: easy-track /
governance bridges /
aragon-apps /
dual-governance
timelock +
committees.

## 2026-09-03: Lido dual-governance submit / timelock leftover (`ba9dfc9`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Escrow
leftover is already
logged on the same
pin. This slice is
submit / schedule /
execute. Same clone
`/tmp/lidofinance-dual-governance`
at `ba9dfc9`. No
mainnet interaction.

Files:
`DualGovernance.sol`,
`EmergencyProtectedTimelock.sol`,
`Executor.sol`,
`libraries/{ExecutableProposals,Proposers,ExternalCalls}.sol`.

Checked for: a
stranger
`submitProposal`
that binds an
attacker executor;
`execute` that runs
calls before the
delays; cancel that
does not mark
later ids; emergency
execute by a
non-committee.

Result: no
user-exploitable
finding. Not
submitted.

- `submitProposal`
  requires a
  registered
  proposer
  (`getProposer`
  reverts
  otherwise) and
  a state that
  allows submit.
  The executor is
  the proposer’s
  stored executor,
  not caller-
  chosen.
  `registerProposer`
  / unregister /
  set executor are
  admin-executor
  only.
- `scheduleProposal`
  is permissionless
  after
  `canScheduleProposal`
  and the after-
  submit delay.
  `cancelAllPendingProposals`
  is the stored
  canceller and
  only in veto
  signalling /
  deactivation.
- Timelock
  `submit` /
  `schedule` /
  `cancelAll` are
  governance-only.
  `execute` is
  permissionless
  after after-
  schedule delay
  and
  `MIN_EXECUTION_DELAY`,
  and only if
  emergency mode
  is off. Status
  is set to
  `Executed`
  before the
  calls. Calls
  run through the
  proposal’s
  executor
  (`onlyOwner`).
  `cancelAll`
  raises
  `lastCancelledProposalId`
  to
  `proposalsCount`.
- Emergency
  activate is the
  activation
  committee.
  `emergencyExecute`
  is the execution
  committee and
  skips delays.
  `emergencyReset`
  is that
  committee and
  points
  governance at
  `emergencyGovernance`
  then cancels
  pending.
  Committee and
  delay setters
  are admin
  executor.

Not submitted.
Remaining
dual-governance:
committees,
ResealManager,
Tiebreaker.
Remaining Lido
listed GitHub:
easy-track /
governance bridges /
remaining CSM gates.
CSM bond leftover is
already logged on
`2824e21`.

## 2026-09-03: Lido dual-governance committees leftover (`ba9dfc9`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Escrow
and submit / timelock
leftovers are already
logged on this pin.
This slice is
HashConsensus,
TiebreakerCore, and
ResealManager. Same
clone
`/tmp/lidofinance-dual-governance`
at `ba9dfc9`. No
mainnet interaction.

Files:
`committees/{HashConsensus,TiebreakerCoreCommittee}.sol`,
`ResealManager.sol`.

Checked for: a
stranger vote that
schedules a hash;
execute before the
committee timelock;
reseal / resume by
a non-governance
caller; sealable
resume nonce reuse.

Result: no
user-exploitable
finding. Not
submitted.

- `HashConsensus.
  _vote` is
  internal.
  Tiebreaker
  `scheduleProposal`
  / `sealableResume`
  require a
  committee member.
  Quorum schedules
  the hash and
  snapshots
  support. Members
  add/remove and
  quorum / timelock
  setters are
  owner.
- `_markUsed`
  requires the hash
  scheduled, unused,
  and the committee
  timelock elapsed.
  `executeScheduleProposal`
  then calls Dual
  Governance
  `tiebreakerScheduleProposal`.
- `executeSealableResume`
  uses the current
  nonce in the key,
  marks used, then
  increments the
  nonce. A replay
  needs a new
  quorum on the
  next nonce.
- `ResealManager.
  reseal` /
  `resume` require
  `msg.sender ==
  timelock.
  getGovernance()`.
  Reseal only
  extends a pause
  that is still
  active and not
  already infinite.

Not submitted.
Listed dual-governance
GitHub leftover is
exhausted aside from
TiebreakerSubCommittee
/ DualGovernance
tiebreaker wrappers.
Remaining Lido:
easy-track /
governance bridges /
remaining CSM gates.

## 2026-09-03: Lido CSM gates leftover (`2824e21`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). CSM
bond leftover is
already logged on
this pin. Dual-
governance leftovers
are logged on
`ba9dfc9`. This slice
is Vetted / Curated
gates, Verifier,
Ejector, ExitPenalties,
and FeeOracle. Same
clone `/tmp/lido-csm`
at `2824e21`. No
mainnet interaction.

Files:
`src/VettedGate.sol`,
`src/CuratedGate.sol`,
`src/abstract/MerkleGate.sol`,
`src/CuratedModule.sol`,
`src/Verifier.sol`,
`src/Ejector.sol`,
`src/ExitPenalties.sol`,
`src/FeeOracle.sol`.

Checked for: a
stranger Merkle
consume that claims
another address’s
curve; `claimBondCurve`
for a non-owner;
Verifier report that
marks a live key
withdrawn without a
beacon proof;
`ejectBadPerformer`
by a non-strikes
caller; Curated
`obtainDepositData`
by a non-router.

Result: no
user-exploitable
finding. Not submitted.

- `MerkleGate._consume`
  verifies
  `hashLeaf(msg.sender)`
  and marks that
  address consumed.
  Tree root / CID
  writes are
  `SET_TREE_ROLE`.
- `VettedGate`
  create + add keys
  consume the caller’s
  leaf, create the
  operator for
  `msg.sender`, set
  the vetted curve,
  then deposit the
  caller’s ETH /
  stETH / wstETH.
  `claimBondCurve`
  is owner-only plus
  a fresh consume.
- `CuratedGate.createNodeOperator`
  is the same Merkle
  consume, then
  `MODULE.createNodeOperator`
  for `msg.sender`.
  Optional custom
  curve needs
  `SET_BOND_CURVE_ROLE`
  on the gate.
- `CuratedModule.obtainDepositData`
  / `allocateDeposits`
  are StakingRouter
  plus up-to-date
  deposit info.
  Weight notify is
  MetaRegistry only.
- `Verifier` proofs
  bind EIP-4788
  parent roots, SSZ
  gindices, module
  pubkeys, and
  withdrawal
  credentials ==
  `WITHDRAWAL_ADDRESS`.
  Slashed proofs
  require
  `validator.slashed`.
  Withdrawal proofs
  reject slashed /
  not-withdrawable /
  partial amounts.
- `Ejector.voluntaryEject`
  is owner-only,
  deposited +
  non-withdrawn keys,
  and forwards
  `msg.value` to the
  triggerable-
  withdrawals
  gateway.
  `ejectBadPerformer`
  is STRIKES only.
- `ExitPenalties`
  only records
  marked fees.
  Delay / triggered
  writes are module
  only; strikes
  writes are STRIKES
  only. It does not
  move bond.
- `FeeOracle.submitReportData`
  is a consensus
  member or
  `SUBMIT_DATA_ROLE`,
  checks the
  consensus hash,
  then calls
  `FeeDistributor.processOracleReport`
  and strikes.
  The oracle holds
  no user assets.

Do not file
`SET_TREE_ROLE` /
`SET_BOND_CURVE_ROLE`
/ STRIKES /
StakingRouter
privilege as a
stranger drain; or
permissionless
Verifier calls that
only apply a valid
beacon proof.

Not submitted.
Remaining CSM:
MerkleGateFactory,
ValidatorStrikes,
HashConsensus,
MetaRegistry.
Remaining Lido
listed GitHub:
easy-track /
governance bridges /
aragon-apps.

## 2026-09-03: USDN leftover (Sourcify)

Immunefi program
`USDN` ($50,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
Sourcify-open:
USDN
`0xde17a000ba631c5d7c2bd9fb692efea52d90dee2`
`exact_match` `Usdn`
(solc 0.8.26);
WUSDN
`0x99999999999999cc837c997b882957dafdcb1af9`
`exact_match` `Wusdn`;
Protocol proxy
`0x656cb8c6d154aad29d8771384089be5b5141f01a`
impl
`0x271df5517a4DaacB7caB988Aa64D23dEbda4c498`
`UsdnProtocolImpl`;
LiquidationRewardsManager
`0x9514D3496F46572e8461da381B200812D5Db202C`;
WstEthOracleMiddleware
`0xC1459fcFe23d5db9Ddb04935ab7a426Bd398EAb0`;
LongFarming
`0xF9D36078A248AF249AA57ae1D5D0c1033d6Bbe27`;
Router
`0x49f66b1616865b2a59caecb8352bbf2ac80983e1`
`match`
`UniversalRouter`;
Dip Accumulator
`0xaebcc85a5594e687f6b302405e6e92d616826e03`
`exact_match`
`Rebalancer`;
sUSDN
`0xf67e2dc041b8a3c39d066037d29f500757b1e886`
`VaultProxy` impl
`0x891dee0483eBAA922E274ddD2eBBaA2D33468A38`
`VaultLib`.
Extract `/tmp/usdn`.
No mainnet
interaction.

Files:
`Usdn.sol`,
`Wusdn.sol`,
`UsdnProtocolImpl.sol`,
`UsdnProtocolVaultLibrary.sol`,
`UsdnProtocolActionsLongLibrary.sol`,
`UsdnLongFarming.sol`,
`LiquidationRewardsManager.sol`,
`WstEthOracleMiddleware.sol`,
`UniversalRouter.sol`,
`Rebalancer.sol`.

Checked for: a
stranger mint of
USDN; rebase that
shrinks balances;
wrap that pulls
another account;
vault validate that
mints to the caller;
close that pays the
caller; farming
harvest that pays
the notifier on a
live position.

Result: no
user-exploitable
finding. Not
submitted.

- USDN `mint` /
  `mintShares` are
  `MINTER_ROLE`.
  `rebase` is
  `REBASER_ROLE` and
  only lowers the
  divisor (balances
  grow). `burn` /
  `burnShares` burn
  `msg.sender` (or
  allowance).
- WUSDN wrap
  `transferSharesFrom`
  `msg.sender`.
  Unwrap burns
  caller WUSDN then
  `transferShares`
  to `to`.
- Protocol deposit
  `safeTransferFrom`
  `msg.sender`
  (asset + SDEX
  burn). Validate
  `mintShares` to
  pending `to`.
  Withdrawal pulls
  shares from the
  initiator, burns
  them on validate,
  pays pending `to`
  capped by
  `_balanceVault`.
- Open long
  `transferFrom`
  initiator. Close
  requires
  `msg.sender ==
  pos.user` or
  EIP-712 owner
  sig. Payout is
  `long.to`.
- Farming
  `ownershipCallback`
  is protocol-only.
  Live `harvest`
  pays `owner`.
  Slash (tick
  version change)
  splits notifier
  BPS. `withdraw`
  is owner-only
  then transfers
  the position
  back.
- Rebalancer
  deposit
  `transferFrom`
  sender; validate /
  reset / withdraw
  are the pending
  `msg.sender`.
  `updatePosition`
  is protocol.
- Oracle applies
  `stEthPerToken`
  on ETH Pyth /
  Chainlink. Router
  is Uniswap-style
  dispatcher + USDN
  initiate/validate
  cmds (`lockedBy`
  / Permit2).

Do not file minter
/ rebaser roles,
oracle-feed trust,
or Enzyme VaultLib
as a stranger mint.

Not submitted.
Listed leftover is
the Sourcify-open
token / wrap /
protocol two-step /
farming / rewards
view / oracle /
router / rebalancer
deposit.
Remaining listed:
sUSDN Enzyme
`VaultLib`
internals.
## 2026-09-03: Lido easy-track leftover (`3183d1f`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2, vaults, CSM, and
dual-governance
leftovers are already
logged. This slice is
the Easy Track motion
and payout path.
Local clone
`/tmp/lido-easy-track`
at `3183d1f`. No
mainnet interaction.

Files:
`contracts/EasyTrack.sol`,
`EVMScriptExecutor.sol`,
`EVMScriptFactoriesRegistry.sol`,
`TrustedCaller.sol`,
`payouts/multi-token/TopUpAllowedRecipients.sol`,
`EVMScriptFactories/TopUpRewardPrograms.sol`.

Checked for: a
stranger `createMotion`
that binds an
attacker payout
script; `enactMotion`
with swapped calldata
that pays the caller;
`executeEVMScript` by
a non-EasyTrack
caller; top-up to an
unlisted recipient.

Result: no
user-exploitable
finding. Not submitted.

- `createMotion`
  requires a
  registered factory.
  The stored hash is
  `keccak256` of
  `factory.createEVMScript(msg.sender, calldata)`.
  Factory add/remove
  is admin-only.
  Resulting scripts
  must match the
  factory’s stored
  permissions.
- `enactMotion` is
  permissionless
  after `duration`,
  deletes the motion
  first, then
  recreates the
  script with the
  original creator
  and calldata and
  requires the same
  hash. The executor
  is EasyTrack-only
  and
  `delegatecall`s
  Aragon
  `CallsScript`.
- `objectToMotion`
  weights
  `governanceToken.balanceOfAt`
  at the snapshot
  and rejects the
  motion at the
  stored threshold.
  `cancelMotion` is
  creator-only.
- `TopUpAllowedRecipients`
  / `TopUpRewardPrograms`
  are
  `onlyTrustedCaller(_creator)`.
  Recipients must be
  on the allowed /
  reward-program
  registry, tokens
  must be allowed,
  and the sum must
  stay under the
  spendable balance.
  Scripts call
  Finance
  `newImmediatePayment`.

Do not file a
trusted-caller
payout motion
(designed operator);
admin factory
registration; or
permissionless
enact after the
wait (intended).

Not submitted.
Remaining
easy-track: NO
management factories,
MEV relay factories,
vault-hub /
OperatorGrid
factories, CSM
settle / vetted-tree
factories.
Remaining Lido
listed GitHub:
governance bridges /
aragon-apps.

## 2026-09-03: Lido governance-crosschain-bridges leftover (`659e236`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2 token bridges,
easy-track, CSM, and
dual-governance
leftovers are already
logged. This slice is
`governance-crosschain-bridges`.
Local clone
`/tmp/lidofinance-gov-bridges`
at `659e236`. No
mainnet interaction.

Files:
`bridges/{BridgeExecutorBase,L2BridgeExecutor,OptimismBridgeExecutor,ArbitrumBridgeExecutor,PolygonBridgeExecutor}.sol`.

Checked for: a
stranger `queue`
that binds attacker
targets; `execute`
before the delay;
Polygon
`processMessageFromRoot`
from a non-FxChild.

Result: no
user-exploitable
finding. Not
submitted.

- L2 `queue` is
  `onlyEthereumGovernanceExecutor`.
  Optimism requires
  the L2 messenger
  and
  `xDomainMessageSender
  == L1 executor`.
  Arbitrum requires
  the L1-to-L2
  alias of that
  executor.
  Polygon
  `processMessageFromRoot`
  is FxChild-only
  and
  `rootMessageSender
  == fxRootSender`.
- `execute` is
  permissionless
  after
  `executionTime`
  and only while
  `Queued`. The set
  is marked
  `executed` before
  the calls.
  `cancel` is
  guardian-only.
  Delay / guardian
  updates are
  `onlyThis`
  (self-queued).
  `executeDelegateCall`
  is `onlyThis`.
- Updating the L1
  executor address
  is `onlyThis`.

Not submitted.
Remaining Lido
listed GitHub:
aragon-apps /
aave-delivery-infrastructure /
mev-boost-relay-allowed-list.

## 2026-09-03: USDN sUSDN VaultLib leftover (Sourcify)

Immunefi program
`USDN` ($50,000,
`kyc: false`). Token /
wrap / protocol /
farming / rebalancer
leftover is already
logged. This slice is
the listed sUSDN
proxy
`0xf67e2dc041b8a3c39d066037d29f500757b1e886`
(`VaultProxy`) impl
`0x891dee0483eBAA922E274ddD2eBBaA2D33468A38`
`exact_match` Enzyme
`VaultLib` (solc
0.6.12). Extract
`/tmp/usdn/vaultlib`.
No mainnet
interaction.

Files:
`VaultLib.sol`,
`VaultLibBaseCore.sol`,
`VaultLibBase1.sol`,
`VaultLibBase2.sol`,
`SharesTokenBase.sol`,
`ProxiableVaultLib.sol`.

Checked for: a
stranger `mintShares`
of sUSDN; `withdrawAssetTo`
that pays the caller;
`callOnContract` /
external-position
dispatch without the
accessor; `init` /
`setAccessor` /
`setVaultLib` by a
non-creator;
`transfer` that skips
the Comptroller hook.

Result: no
user-exploitable
finding. Not
submitted.

- `mintShares` /
  `burnShares` /
  `transferShares` /
  `withdrawAssetTo` /
  `callOnContract` /
  `receiveValidatedVaultAction`
  / protocol-fee mint
  and MLN buyback are
  `onlyAccessor`
  (ComptrollerProxy).
  `notShares` blocks
  withdrawing the
  vault’s own shares
  token.
- `init` runs once
  (`creator == 0`).
  `setAccessor` and
  `setVaultLib` are
  creator-only
  (Dispatcher).
  `setVaultLib`
  requires a matching
  `proxiableUUID`.
- ERC20
  `transfer` /
  `transferFrom` call
  the accessor
  pre-transfer hook
  (or the freely-
  transferable
  variant). Owner
  `setFreelyTransferableShares`
  is one-way.
- Owner can add
  asset managers,
  nominate a new
  owner, and set a
  migrator. Those
  are privilege, not
  a stranger drain.
  `claimOwnership`
  is the nominated
  owner only.

Do not file
accessor-trusted
mint / withdraw /
`callOnContract` as
a stranger drain, or
Enzyme owner /
migrator privilege.

Not submitted.
Listed USDN leftover
is exhausted. The
Comptroller buy /
redeem share-price
path is not a listed
USDN asset.

## 2026-09-03: Lido aragon-apps leftover (`e44f928`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2, easy-track, CSM,
dual-governance, and
governance-crosschain-bridges
are already logged.
This slice is
`aragon-apps`. Local
clone
`/tmp/lidofinance-aragon-apps`
at `e44f928`. No
mainnet interaction.

Files:
`apps/vault/contracts/Vault.sol`,
`apps/finance/contracts/Finance.sol`,
`apps/agent/contracts/Agent.sol`,
`apps/token-manager/contracts/TokenManager.sol`.

Checked for: a
stranger Vault
`transfer`; Finance
`newImmediatePayment`
to the caller;
Agent `execute`
without
`EXECUTE_ROLE`;
TokenManager `mint`
without `MINT_ROLE`.

Result: no
user-exploitable
finding. Not
submitted.

- Vault `deposit`
  is permissionless
  and pulls
  `msg.sender`.
  `transfer` is
  `authP(TRANSFER_ROLE,
  arr(token, to,
  value))`.
- Finance
  `newImmediatePayment`
  /
  `newScheduledPayment`
  are
  `CREATE_PAYMENTS_ROLE`.
  `executePayment`
  is
  `EXECUTE_PAYMENTS_ROLE`.
  `receiverExecutePayment`
  is the stored
  receiver only and
  pays that
  receiver.
- Agent `execute` /
  `safeExecute` are
  `EXECUTE_ROLE` /
  `SAFE_EXECUTE_ROLE`.
  Safe execute
  reverts if a
  protected token
  balance drops or
  the protected
  list changes.
- TokenManager
  `mint` / `issue`
  / `assign` /
  `burn` are their
  respective roles.

Not submitted.
Remaining Lido
listed GitHub:
aave-delivery-infrastructure /
mev-boost-relay-allowed-list.
Remaining
aragon-apps:
Voting /
DisputableVoting /
Agreement.

## 2026-09-03: IPOR leftover (Sourcify)

Immunefi program
`IPOR` ($20,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
Sourcify-open:
ipUSDT
`0x9Bd2177027edEE300DC9F1fb88F24DB6e5e1edC6`
`match` `IpTokenUsdt`;
ipUSDC
`0x7c0e72f431FD69560D951e4C04A4de3657621a88`
`match` `IpTokenUsdt`;
ipweETH
`0xaC5B04988BC71bEE96f8D93040777Db3ef166125`
`match` `IpToken`;
ipstETH
`0xc40431b6C510AeB45Fbb5e21E40D49F12b0c1F0c`
`match` `IpToken`;
Router proxy
`0x16d104009964e694761C0bf09d7Be49B7E3C26fd`
impl
`0xCC735cAf5354415308dBD826e9734A70b69461d6`
`match`
`IporProtocolRouterEthereum`;
AmmStorage USDC/USDT
impls `AmmStorage`;
AmmTreasury USDC/USDT
impls `AmmTreasury`;
AmmTreasury weETH impl
`AmmTreasuryBaseV2`;
AmmStorage weETH
`AmmStorageBaseV1`.
Extract `/tmp/ipor`.
No mainnet
interaction.

Files:
`IpToken.sol`,
`IpTokenUsdt.sol`,
`IporProtocolRouterEthereum.sol`,
`IporProtocolRouterAbstract.sol`,
`AccessControl.sol`,
`AmmTreasury.sol`,
`AmmTreasuryBaseV2.sol`,
`AmmStorage.sol`,
`AmmStorageBaseV1.sol`.

Checked for: a
stranger mint of
ipTokens; treasury
withdraw to the
caller; storage
liquidity write
without the router;
router fallback that
delegatecalls an
unknown selector;
batch ETH refund
that steals another
user’s `msg.value`.

Result: no
user-exploitable
finding. Not
submitted.

- ipToken `mint` /
  `burn` are
  `onlyJoseph` (USDT
  / USDC) or
  `onlyTokenManager`
  (weETH / stETH).
  Manager / Joseph
  setters are owner.
- AmmTreasury AM
  deposit / withdraw
  are `onlyRouter`
  and pay
  `address(this)`.
  Owner
  `grantMaxAllowanceForSpender`
  is privilege.
- AmmStorage
  liquidity / swap /
  treasury writes are
  `onlyRouter` (AM
  vault updates
  `onlyAmmTreasury`).
- Router unknown
  selectors revert.
  Open / provide /
  redeem / close map
  to immutable or
  stored services.
  Governance writes
  and emergency
  close are
  `_onlyOwner`.
  `transferToTreasury`
  / Charlie are
  public and go to
  the governance
  service (pays the
  configured
  recipient, not
  `msg.sender`).
- `batchExecutor` is
  `nonReentrant`.
  Leftover ETH is
  returned to the
  current caller
  after a mutating
  dispatch.

Do not file Joseph /
token-manager mint,
owner allowance /
upgrade, or
permissionless
treasury sweep to
the configured
recipient.

Not submitted.
Listed leftover is
the Sourcify-open
ipToken / router /
storage / treasury
path.
Remaining listed:
AmmTreasury ETH impl
Sourcify 404. Pool /
open / close service
implementations are
not listed assets.

## 2026-09-03: Lido aave-delivery-infrastructure leftover (`27e7d4e`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2, easy-track, CSM,
dual-governance,
governance-crosschain-bridges,
and aragon-apps
leftovers are already
logged. This slice is
`aave-delivery-infrastructure`.
Local clone
`/tmp/lido-adi` at
`27e7d4e`. No
mainnet interaction.

Files:
`src/Lido/contracts/{CrossChainExecutor,BridgeExecutorBase}.sol`,
`src/contracts/{CrossChainReceiver,CrossChainForwarder,BaseCrossChainController,CrossChainController,CrossChainControllerWithEmergencyMode}.sol`,
`src/contracts/adapters/BaseAdapter.sol`,
`src/contracts/adapters/optimism/OpAdapter.sol`,
`src/contracts/adapters/arbitrum/ArbAdapter.sol`,
`src/contracts/adapters/sameChain/SameChainAdapter.sol`,
`src/contracts/emergency/{EmergencyConsumer,EmergencyRegistry}.sol`,
`src/contracts/libs/EncodingUtils.sol`.

Checked for: a
stranger
`receiveCrossChainMessage`
that queues attacker
targets; CCC
`forwardMessage`
without an approved
sender; an adapter
that registers a
payload without a
trusted remote; SameChain
shortcut that
impersonates the
Ethereum Agent.

Result: no
user-exploitable
finding. Not
submitted.

- Lido
  `CrossChainExecutor.receiveCrossChainMessage`
  is
  `onlyCrossChainController`
  and requires
  `originSender ==
  GOVERNANCE_EXECUTOR`
  and
  `originChainId ==
  GOVERNANCE_CHAIN_ID`
  before `_queue`.
  `execute` is
  permissionless
  after the delay
  and only while
  `Queued`.
  `cancel` is
  guardian-only.
  Delay / guardian
  updates and
  `executeDelegateCall`
  are `onlyThis`.
  `receiveFunds` is
  a donation.
- CCC
  `receiveCrossChainMessage`
  is
  `onlyApprovedBridges(originChainId)`.
  Envelope origin /
  dest chain must
  match. Delivery
  waits for
  `requiredConfirmation`
  distinct adapters.
  `deliverEnvelope`
  is permissionless
  only after
  `Confirmed` (failed
  first delivery).
  Confirmations /
  adapters /
  validity
  timestamps are
  owner-only.
- `forwardMessage`
  is
  `onlyApprovedSenders`
  and stamps
  `origin =
  msg.sender`.
  Retry envelope /
  transaction is
  owner or guardian.
  Adapter
  `forwardMessage`
  is
  `delegatecall`ed
  from the CCC.
- OpAdapter
  `ovmReceive` is
  messenger-only
  and
  `xDomainMessageSender
  == trusted remote`.
  ArbAdapter
  `arbReceive`
  requires
  `undoL1ToL2Alias(msg.sender)
  == trusted remote`.
  `BaseAdapter._registerReceivedMessage`
  forbids
  delegatecall.
- SameChainAdapter
  calls the
  destination
  directly. A
  stranger call
  hits
  `InvalidCaller`
  on the executor
  (msg.sender is
  not the CCC).
  The intended
  path is CCC
  `delegatecall`
  so the executor
  still sees the
  CCC and the
  stamped Agent
  origin.
- Emergency
  `solveEmergency`
  is guardian +
  Chainlink
  emergency oracle
  (`answer >
  emergencyCount`).
  `EmergencyRegistry.setEmergency`
  is owner-only.

Do not file
permissionless
`execute` after
the delay,
guardian cancel,
owner / guardian
retry or
invalidation,
approved-sender
forward, or
oracle /
guardian
emergency
reconfig.

Not submitted.
Remaining Lido
listed GitHub:
aave-delivery
adapters leftover
is now logged.
mev-boost-relay-allowed-list
is logged.

## 2026-09-03: Lido mev-boost-relay leftover (`47211c6`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core,
L2, easy-track, CSM,
dual-governance,
governance-crosschain-bridges,
aragon-apps, and
aave-delivery are
already logged. This
slice is
`mev-boost-relay-allowed-list`.
Local clone
`/tmp/lidofinance-mev-boost`
at `47211c6`. No
mainnet interaction.

File:
`contracts/MEVBoostRelayAllowedList.vy`.

Checked for: a
stranger
`add_relay` /
`remove_relay`;
`recover_erc20` to
the caller; ETH
receive that locks
user funds.

Result: no
user-exploitable
finding. Not
submitted.

- `add_relay` and
  `remove_relay` are
  owner or manager.
  URI must be
  non-empty. Duplicate
  URI reverts. Max 40
  relays.
- `change_owner`,
  `set_manager`,
  `dismiss_manager`,
  and `recover_erc20`
  are owner-only.
  Recovery transfers
  a listed ERC-20 from
  this contract to a
  non-zero recipient.
- `__default__`
  reverts, so the
  contract cannot
  receive ETH.
- The list is
  off-chain config.
  There is no
  on-chain user
  deposit or
  withdrawal.

Not submitted.
Listed Lido GitHub
repos in this pass
are opened.
Remaining
aave-delivery
adapters leftover
is logged.
Remaining
in already-opened
trees: aragon-apps
Voting /
DisputableVoting /
Agreement;
dual-governance
TiebreakerSubCommittee
/ wrappers; CSM
MerkleGateFactory /
ValidatorStrikes /
HashConsensus /
MetaRegistry;
easy-track NO /
MEV-relay / vault-hub
/ OperatorGrid / CSM
settle factories.

## 2026-09-03: Lido aave-delivery adapters leftover (`27e7d4e`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Core
CCC / executor /
Op / Arb / SameChain
are already logged.
This slice is the
remaining
`aave-delivery-infrastructure`
adapters. Local
clone
`/tmp/lidofinance-aave-delivery`
at `27e7d4e`. No
mainnet interaction.

Files:
`src/contracts/adapters/ccip/CCIPAdapter.sol`,
`src/contracts/adapters/layerZero/LayerZeroAdapter.sol`,
`src/contracts/adapters/wormhole/WormholeAdapter.sol`,
`src/contracts/adapters/polygon/PolygonAdapterBase.sol`,
`src/contracts/adapters/hyperLane/HyperLaneAdapter.sol`,
`src/contracts/adapters/zkEVM/ZkEVMAdapter.sol`,
`src/contracts/adapters/scroll/ScrollAdapter.sol`,
`src/contracts/adapters/metis/MetisAdapter.sol`,
`src/contracts/adapters/gnosisChain/GnosisChainAdapter.sol`,
`src/contracts/adapters/cBase/CBaseAdapter.sol`,
`src/contracts/adapters/BaseAdapter.sol`.

Checked for: a
stranger receive
that registers a
payload without
the official
messenger or a
trusted remote.
Result: no
user-exploitable
finding. Not
submitted.

- Every receive
  path is the
  official
  messenger /
  router /
  mailbox /
  relayer /
  tunnel /
  bridge only,
  then requires
  `_trustedRemotes[origin]
  == src && src
  != 0` before
  `_registerReceivedMessage`.
- CCIP
  `ccipReceive`
  is `onlyRouter`.
  LZ `lzReceive`
  is
  `onlyLZEndpoint`
  and
  `allowInitializePath`.
  Wormhole
  `receiveWormholeMessages`
  is `onlyRelayer`.
  HyperLane
  `handle` is
  `onlyMailbox`.
  zkEVM
  `onMessageReceived`
  is
  `onlyZkEVMBridge`.
  Polygon
  `processMessage`
  is `onlyFxTunnel`.
  Gnosis
  `receiveMessage`
  requires
  `msg.sender ==
  BRIDGE` and
  uses
  `messageSender()`
  /
  `messageSourceChainId()`.
- Scroll / Metis
  / CBase inherit
  OpAdapter
  `ovmReceive`
  (`onlyOVM` +
  `xDomainMessageSender
  == trusted
  remote`). They
  only override
  destination
  chain and
  `forwardMessage`.
- `_registerReceivedMessage`
  forbids
  delegatecall
  via `_selfAddress`.

Not submitted.
Listed
aave-delivery
adapter leftover
is exhausted.
Remaining
in already-opened
Lido trees:
aragon-apps
Voting /
DisputableVoting /
Agreement;
dual-governance
TiebreakerSubCommittee
/ wrappers; CSM
MerkleGateFactory /
ValidatorStrikes /
HashConsensus /
MetaRegistry;
easy-track NO /
MEV-relay /
vault-hub /
OperatorGrid / CSM
settle factories.
## 2026-09-03: Vesper leftover (Sourcify)

Immunefi program
`Vesper` ($50,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Ethereum
Sourcify-open vault
proxies share
`VPool`
`0x3CEDDEF5cbe54674fCBE1b4368a68b8D6a20Fc46`
(vaFrax / vaDAI /
vaUSDC / vaWBTC /
vaLINK) or
`0xd948ba1B50C474199DB204Ef128BA413c49Fd9b8`
(vastETH / varETH)
or
`0x91f92F75E547Db066c39DEa4d4a8B45f4B8EDE4a`
(vacbETH). vaETH
impl
`0xf296B1113CC49Ae4c6890E7B5dD3bed780407487`
`exact_match` `VETH`.
Optimism listed
vaults are the same
`VPool` / `VETH`
(solc 0.8.9). Extract
`/tmp/vesper`. No
mainnet interaction.

Files:
`VPool.sol`,
`VETH.sol`,
`PoolERC20.sol`,
`PoolStorage.sol`,
`Governable.sol`,
`Pausable.sol`.

Checked for: a
stranger mint of
vault shares;
withdraw that pays
the caller without
burning; `reportEarning`
that transfers
collateral to a
non-strategy;
`sweepERC20` of the
pool token; VETH
unwrap that sends
ETH to a third
party.

Result: no
user-exploitable
finding. Not
submitted.

- `deposit` /
  `depositWithPermit`
  `transferFrom`
  `msg.sender` then
  mint shares from
  `calculateMintage`.
  `withdraw` burns
  `_msgSender` then
  transfers
  collateral (or ETH
  on VETH
  `withdrawETH`) to
  that sender.
- `reportEarning` /
  `reportLoss` take
  `msg.sender` as the
  strategy and
  forward to
  `poolAccountant`.
  Token moves only
  between the pool
  and that caller.
- `sweepERC20` is
  `onlyKeeper` and
  blocks the
  collateral token.
  Governor / keeper
  setters are
  privilege.
- Empty-pool
  `pricePerShare` is
  `10**decimals`.
  `minDepositLimit`
  defaults to 1.

Do not file
first-depositor
share inflation on
an empty vault,
keeper / governor
privilege, or
`reportEarning` as a
stranger drain
without a listed
accountant that
accepts an
unregistered
strategy.

Not submitted.
Listed leftover is
the Sourcify-open
Ethereum + Optimism
`VPool` / `VETH`
vaults.
Remaining listed:
Base vaults Sourcify
404. PoolAccountant
and strategies are
not listed assets.

## 2026-09-03: Lido easy-track leftover factories leftover (`3183d1f`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Easy
Track motion /
payout leftover is
already logged on
the same pin. This
slice is the leftover
NO / MEV-relay /
vault-hub /
OperatorGrid / CSM
settle factories.
Local clone
`/tmp/lido-easy-track`
at `3183d1f`. No
mainnet interaction.

Files:
`contracts/EVMScriptFactories/{Add,Activate,Deactivate}NodeOperators.sol`,
`IncreaseNodeOperatorStakingLimit.sol`,
`IncreaseVettedValidatorsLimit.sol`,
`SetNodeOperator{Names,RewardAddresses}.sol`,
`ChangeNodeOperatorManagers.sol`,
`SetVettedValidatorsLimits.sol`,
`UpdateTargetValidatorLimits.sol`,
`{Add,Edit,Remove}MEVBoostRelays.sol`,
`CSMSettleELStealingPenalty.sol`,
`CSMSetVettedGateTree.sol`,
`{Curated,SDVT}SubmitExitRequestHashes.sol`,
`contracts/EVMScriptFactories/vaultFactories/{VaultsAdapter,ForceValidatorExitsInVaultHub,SocializeBadDebtInVaultHub,SetLiabilitySharesTargetInVaultHub,RegisterGroupsInOperatorGrid,RegisterTiersInOperatorGrid,AlterTiersInOperatorGrid,UpdateVaultsFeesInOperatorGrid,UpdateGroupsShareLimitInOperatorGrid,SetJailStatusInOperatorGrid}.sol`.

Checked for: a
stranger factory
that builds a
payout or staking-
limit script for
an attacker NO;
VaultsAdapter
`withdrawETH` /
`forceValidatorExit`
without the
executor.

Result: no
user-exploitable
finding. Not
submitted.

- Trusted-caller
  factories
  (`Add/Activate/DeactivateNodeOperators`,
  names / reward /
  managers, MEV
  relays, CSM
  settle / vetted
  tree, SDVT exit
  hashes, vault-hub
  / OperatorGrid)
  require
  `onlyTrustedCaller(_creator)`.
  Easy Track stores
  `keccak256(factory.createEVMScript(creator, calldata))`
  and
  `enactMotion`
  recreates with
  that same pair.
- `IncreaseNodeOperatorStakingLimit`
  is not a trusted
  caller. Creator
  must be the NO
  `rewardAddress`.
  Limit can only
  rise and cannot
  exceed
  `totalSigningKeys`.
- `IncreaseVettedValidatorsLimit`
  allows the
  reward address or
  a
  `MANAGE_SIGNING_KEYS`
  manager for that
  operator id.
  Same limit
  bounds.
- `CuratedSubmitExitRequestHashes`
  requires the
  first request’s
  NO reward
  address ==
  creator and
  validates the
  rest via
  `SubmitExitRequestHashesUtils`.
  Script only
  calls
  `submitExitRequestsHash`.
- `VaultsAdapter`
  mutators are
  `evmScriptExecutor`
  only.
  `withdrawETH` and
  `setValidatorExitFeeLimit`
  are trusted
  caller.
  `receive()` is a
  donation for
  EIP-7002 fees.
  Bad-debt
  socialize
  requires both
  vaults share a
  node operator.

Do not file
trusted-caller
privilege, a NO
raising its own
vetted limit up
to deposited keys,
permissionless
enact after the
wait, or
executor-only
VaultsAdapter
calls.

Not submitted.
Remaining
in already-opened
Lido trees:
aragon-apps
Voting /
DisputableVoting /
Agreement;
dual-governance
TiebreakerSubCommittee
/ wrappers; CSM
MerkleGateFactory /
ValidatorStrikes /
HashConsensus /
MetaRegistry.
Listed easy-track
leftover factories
are exhausted.

## 2026-09-03: Lido aragon-apps Voting leftover (`e44f928`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Vault /
Finance / Agent /
TokenManager leftover
is already logged on
the same pin. This
slice is Voting and
DisputableVoting.
Local clone
`/tmp/lido-aragon` at
`e44f928`. No mainnet
interaction.

Files:
`apps/voting/contracts/Voting.sol`,
`apps/voting-disputable/contracts/DisputableVoting.sol`.

Checked for: a
stranger `newVote`
that binds an
attacker script;
`executeVote` before
the vote closes or
with a swapped
script; a delegate
that votes without
assignment.
Result: no
user-exploitable
finding. Not
submitted.

- Voting `newVote`
  /
  `forward` are
  `CREATE_VOTES_ROLE`.
  `vote` uses
  `balanceOfAt` at
  `snapshotBlock =
  block.number - 1`.
  `executeVote` is
  permissionless
  after the vote is
  Closed, support
  and quorum pass
  (`>` of
  `PCT_BASE`), and
  the stored script
  runs via
  `runScript`.
- Support / quorum /
  vote-time changes
  are their roles.
  `unsafelyChangeVoteTime`
  is documented to
  affect open votes.
- `assignDelegate`
  is self-only.
  `attemptVoteForMultiple`
  skips voters who
  already voted
  directly and
  documents
  front-run
  undelegation.
  Token
  `balanceOfAt`
  reentrancy is an
  explicit LDO
  trust assumption.
- DisputableVoting
  `newVote` is
  `CREATE_VOTES_ROLE`.
  It stores
  `keccak256(script)`
  only.
  `executeVote`
  requires
  `_canExecute`
  (ended, execution
  delay finished,
  accepted, not
  paused /
  cancelled) and
  `keccak256(_executionScript)
  == stored hash`.
  `voteOnBehalfOf`
  requires
  `representatives[voter]
  == msg.sender`
  and skips
  already-cast
  votes.

Do not file
permissionless
`executeVote` after
pass, CREATE_VOTES
privilege, documented
delegate front-run,
or the `>`
threshold.

Not submitted.
Remaining
aragon-apps:
Agreement.
Remaining
in already-opened
Lido trees:
dual-governance
TiebreakerSubCommittee
/ wrappers; CSM
MerkleGateFactory /
ValidatorStrikes /
HashConsensus /
MetaRegistry.

## 2026-09-03: Lido dual-governance Tiebreaker leftover (`ba9dfc9`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Escrow
/ submit / timelock
and committees
leftovers are already
logged on the same
pin. This slice is
TiebreakerSubCommittee,
the Tiebreaker
library, and Dual
Governance
tiebreaker wrappers.
Local clone
`/tmp/lido-dg` at
`ba9dfc9`. No mainnet
interaction.

Files:
`contracts/committees/TiebreakerSubCommittee.sol`,
`contracts/libraries/Tiebreaker.sol`,
`contracts/DualGovernance.sol`
(tiebreaker wrappers).

Checked for: a
stranger
`scheduleProposal`
or
`sealableResume`
that unpauses or
schedules without
committee quorum
or outside a tie.
Result: no
user-exploitable
finding. Not
submitted.

- SubCommittee
  `scheduleProposal`
  /
  `sealableResume`
  are member-only
  HashConsensus
  votes. Execute
  is
  permissionless
  after the hash
  is scheduled
  (`_markUsed`).
  Constructor
  timelock is
  zero. Execute
  calls Core
  `scheduleProposal`
  /
  `sealableResume`
  so the
  subcommittee
  contract votes
  as a Core
  member, not
  Dual Governance
  itself.
- Core then
  executes to Dual
  Governance
  `tiebreakerScheduleProposal`
  /
  `tiebreakerResumeSealable`,
  which require
  `msg.sender ==
  tiebreakerCommittee`
  and
  `checkTie`
  (not Normal /
  VetoCooldown,
  and either the
  activation
  timeout has
  passed or Rage
  Quit plus a
  long-paused /
  faulty sealable
  blocker).
- Setup
  (`setTiebreakerCommittee`,
  blockers,
  timeout) is
  admin-executor
  only on Dual
  Governance.

Do not file
committee-member
votes, permissionless
execute after
quorum, or
tiebreaker action
only in the
documented
deadlock.

Not submitted.
Remaining
aragon-apps:
Agreement.
Remaining
in already-opened
Lido trees:
CSM
MerkleGateFactory /
ValidatorStrikes /
HashConsensus /
MetaRegistry.
Listed
dual-governance
leftover is
exhausted.

## 2026-09-03: Lido CSM leftover modules leftover (`2824e21`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). CSM
bond and gates
leftovers are already
logged on the same
pin. This slice is
MerkleGateFactory,
ValidatorStrikes,
HashConsensus, and
MetaRegistry. Local
clone `/tmp/lido-csm`
at `2824e21`. No
mainnet interaction.

Files:
`src/MerkleGateFactory.sol`,
`src/abstract/MerkleGate.sol`,
`src/ValidatorStrikes.sol`,
`src/lib/base-oracle/HashConsensus.sol`,
`src/MetaRegistry.sol`.

Checked for: a
stranger factory
that hijacks an
existing gate;
`processBadPerformanceProof`
that ejects without
a valid Merkle
leaf; HashConsensus
`submitReport` from
a non-member.

Result: no
user-exploitable
finding. Not
submitted.

- `MerkleGateFactory.create`
  is permissionless
  and deploys a new
  `OssifiableProxy`
  with the caller-
  supplied `admin`,
  then
  `initialize`s it.
  It cannot write
  an already-
  deployed gate.
  `MerkleGate._consume`
  requires
  `hashLeaf(msg.sender)`
  and marks that
  address consumed.
- `ValidatorStrikes.processOracleReport`
  is oracle-only.
  `processBadPerformanceProof`
  is
  permissionless
  but requires a
  multiproof against
  `treeRoot`,
  strikes ≥ the
  curve threshold,
  and even
  `msg.value` that
  is forwarded to
  `ejectBadPerformer`.
- HashConsensus
  `submitReport`
  resolves the
  caller via
  `_getMemberIndex`
  (non-members
  revert). Quorum
  must be
  `> totalMembers /
  2`. Member /
  quorum / processor
  changes are
  roles.
- MetaRegistry
  group / curve-
  weight writes are
  roles.
  `setOperatorMetadataAsOwner`
  is the NO owner
  only.
  `refreshOperatorWeight`
  only recomputes
  cache for an
  already-grouped
  operator.

Do not file
permissionless new
MerkleGate deploy,
oracle-set strike
trees, committee
HashConsensus, or
role privilege.

Not submitted.
Remaining
aragon-apps:
Agreement leftover
is logged.
Listed CSM leftover
modules are
exhausted.

## 2026-09-03: Lido aragon-apps Agreement leftover (`e44f928`)

Immunefi program
`lido` ($2,000,000,
`kyc: false`). Vault /
Finance / Agent /
TokenManager and
Voting /
DisputableVoting
leftovers are already
logged. This slice is
`Agreement`. Local
clone
`/tmp/lidofinance-aragon-apps`
at `e44f928`. No
mainnet interaction.

File:
`apps/agreement/contracts/Agreement.sol`.

Checked for: a
stranger `newAction`
that locks another
account's collateral;
`challengeAction`
without
`CHALLENGE_ROLE`;
`settleAction` that
pays the caller the
submitter's lock.

Result: no
user-exploitable
finding. Not
submitted.

- `newAction` is an
  activated
  Disputable app
  only
  (`msg.sender` must
  be in
  `disputableInfos`
  and active). It
  locks
  `_submitter` after
  that address has
  signed the current
  setting.
- `challengeAction`
  needs
  `CHALLENGE_ROLE` on
  the related
  Disputable app.
  Settlement offer
  cannot exceed
  action collateral.
- `settleAction` is
  the submitter, or
  anyone after the
  settlement period.
  Slash / unlock
  go to the stored
  submitter and
  challenger.
- `closeAction` is
  permissionless and
  only unlocks the
  submitter when
  `_canClose`.
  `sign` records
  `msg.sender` only.

Not submitted.
Remaining
aragon-apps leftover
is exhausted.

## 2026-09-03: Nexus Mutual cover / pool / staking leftover (`9e88562`)

Immunefi program
`Nexus Mutual`
($25,000, `kyc: false`).
Unique listed GitHub
leftover not previously
logged. Local clone
`/tmp/nexus-mutual` at
`9e88562`. No mainnet
interaction.

Files:
`contracts/modules/cover/Cover.sol`,
`contracts/modules/staking/StakingPool.sol`,
`contracts/modules/capital/Pool.sol`,
`contracts/modules/token/TokenController.sol`.

Checked for: a
stranger `buyCover`
that mints to the
caller; `withdraw`
that pays
`msg.sender` instead
of the NFT owner;
`sendPayout` without
the Claims module.

Result: no
user-exploitable
finding. Not
submitted.

- `buyCover` /
  `buyCoverWithRi`
  are `onlyMember`.
  Cover edits require
  NFT owner or
  approved.
  `executeCoverBuy`
  is LimitOrders
  only.
- `depositTo` pulls
  NXM from
  `msg.sender` via
  TokenController.
  New tokens mint to
  `destination` or
  the caller.
  Existing token
  deposits require
  owner or approved.
- `withdraw` pays
  `stakingNFT.ownerOf(tokenId)`
  (or the manager
  for token 0).
  Stake only after
  the tranche
  expires.
- Pool
  `sendPayout` is
  Claims only.
  `transferAssetToSafe`
  is SafeTracker
  only.
  `transferAssetToSwapOperator`
  is SwapOperator
  only.

Not submitted.
Remaining Nexus
listed GitHub:
Claims / Assessment
/ Ramm / LimitOrders
/ CoverBroker leftover
is logged.
Leftover modules leftover
is logged.
Governance leftover
is logged (listed
Nexus Mutual GitHub
leftover exhausted).

## 2026-09-03: Nexus Mutual claims leftover (`9e88562`)

Immunefi program
`Nexus Mutual`
($25,000, `kyc: false`).
Cover / pool / staking
leftover is already
logged. This slice is
Claims, Assessments,
Ramm, LimitOrders, and
CoverBroker. Local
clone `/tmp/nexus-mutual`
at `9e88562`. No
mainnet interaction.

Files:
`contracts/modules/assessment/Claims.sol`,
`contracts/modules/assessment/Assessments.sol`,
`contracts/modules/capital/Ramm.sol`,
`contracts/modules/cover/LimitOrders.sol`,
`contracts/external/cover/CoverBroker.sol`.

Checked for: a
stranger
`submitClaim` on
someone else's
cover; `redeemClaimPayout`
to the caller;
`executeOrder`
without a buyer
signature;
`swap` that mints
NXM without ETH.

Result: no
user-exploitable
finding. Not
submitted.

- `submitClaim` is
  a member and the
  cover NFT owner
  only. Deposit ETH
  goes to the Pool.
  `redeemClaimPayout`
  is the current
  cover owner and
  pays that owner
  after a
  redeemable
  assessment.
  `retrieveDeposit`
  is permissionless
  and always pays
  the cover owner.
- `castVote` is a
  member in the
  claim's assessor
  group. Group
  writes are
  Governor. 
  `startAssessment`
  is Claims only.
- Ramm `swap` takes
  ETH or NXM from
  `msg.sender` and
  mints / pays that
  sender with
  minOut and
  circuit breakers.
- LimitOrders
  `executeOrder` is
  `onlyInternalSolver`
  and recovers the
  buyer from the
  signature.
  Payment and
  refunds are the
  buyer. `cancelOrder`
  is the signer.
- CoverBroker
  `buyCover` pulls
  payment from
  `msg.sender` and
  refunds that
  sender.
  `rescueFunds` is
  owner-only.

Not submitted.
Remaining Nexus
listed GitHub:
leftover modules leftover
is logged.
Governance leftover
is logged (listed
Nexus Mutual GitHub
leftover exhausted).
## 2026-09-03: dHEDGE leftover (Sourcify)

Immunefi program
`dHEDGE` ($50,000,
`kyc: false`). Unique
no-KYC listed slice
not previously
logged. Listed
`PoolFactory and
linked contracts`
Sourcify-open on
Ethereum
`0x96D33bCF84DdE326014248E2896F79bbb9c13D6d`
impl
`0x5ee204C28217e30b45784ECd9e9aFDE029334a5F`
`exact_match`
`PoolFactory` (solc
0.7.6); same impl
source on Optimism
`0xC25bf381B2580211eE48813cD7c2119D5B015b62`,
Base
`0x7256070a6340E0A8d8a2b4eC3969bb4c5977Ec3c`,
Arbitrum
`0xD0EAe0fBa24FA2817BBa16fe5030a9a5B63946a3`.
Extract `/tmp/dhedge`.
No mainnet
interaction.

Files:
`PoolFactory.sol`,
`ProxyFactory.sol`,
`InitializableUpgradeabilityProxy.sol`,
`BaseUpgradeabilityProxy.sol`,
`SafeSignerAccess.sol`.

Checked for: a
stranger
`createFund` that
binds another
manager’s logic;
`deploy` that
re-initializes a
live pool; pause /
`setPoolsPaused`
by a non-owner;
`setLogic` that
swaps
implementations
without owner.

Result: no
user-exploitable
finding. Not
submitted.

- `createFund` is
  permissionless
  when unpaused. It
  deploys a new
  pool + manager
  proxy, then
  `setPoolManagerLogic`
  and marks
  `isPool`. Fee
  caps are stored
  for the manager
  initializer.
- `deploy` is
  public and
  creates an
  uninitialized-
  looking clone
  whose EIP-1967
  slot is the
  factory. It is
  not added to
  `isPool`.
  `onlyPool` /
  `onlyPoolManager`
  stay false.
- Proxies resolve
  logic via
  `HasLogic(factory).
  getLogic(type)`.
  `setLogic` is
  `onlyOwner`.
- Pause /
  `setPoolsPaused`
  are owner or Safe
  signer. Signers
  can only pause,
  not unpause.
  DAO / fee /
  asset-handler /
  validator writes
  are `onlyOwner`.

Do not file
permissionless
`createFund`,
public unregistered
`deploy` clones, or
owner `setLogic` /
pause as a stranger
drain.

Not submitted.
Listed leftover is
the Sourcify-open
ETH / OP / Base /
Arb `PoolFactory`.
Remaining listed:
Polygon factory
Sourcify 404.
PoolLogic /
PoolManagerLogic
implementations are
not independently
Sourcify-fetched.

## 2026-09-03: Hydration DCA leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
Unique listed GitHub
leftover not previously
logged. Local sparse
clone `/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/dca/src/lib.rs`,
`pallets/bonds/src/lib.rs`,
`pallets/circuit-breaker/src/lib.rs`.

Checked for: a
stranger `schedule`
that spends another
account's reserve;
`terminate` that
unreserves to the
caller; `redeem`
that pays without
burning the caller's
bonds.

Result: no
user-exploitable
finding. Not
submitted.

- DCA `schedule`
  requires
  `who ==
  schedule.owner`
  and
  `reserve_named`s
  `asset_in` from
  that signer. Buy
  orders are
  disabled.
  `terminate` is
  the owner or
  `TerminateOrigin`
  and unreserves to
  the stored owner.
  `execute_trade`
  runs as
  `schedule.owner`.
- Bonds `issue` is
  `IssueOrigin` and
  pulls from
  `IssuerAccount`.
  `redeem` burns
  the signer's
  bonds after
  maturity and pays
  that signer 1:1.
- Circuit-breaker
  limit / lockdown
  writes are
  authority.
  `release_deposit`
  is signed or
  authority and
  releases the
  named `who`
  after lockdown
  ends.

Not submitted.
Remaining Hydration
listed GitHub:
other pallets
(omnipool / stableswap
/ XYK leftover is
logged).

## 2026-09-03: Hydration pool leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
DCA / bonds /
circuit-breaker leftover
is already logged.
This slice is
omnipool, stableswap,
XYK, and OTC. Local
sparse clone
`/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/omnipool/src/lib.rs`,
`pallets/stableswap/src/lib.rs`,
`pallets/xyk/src/lib.rs`,
`pallets/otc/src/lib.rs`.

Checked for: a
stranger
`remove_liquidity`
on someone else's
position; `sell`
that pays the
caller without
taking `asset_in`;
OTC `cancel_order`
that unreserves to
the caller.

Result: no
user-exploitable
finding. Not
submitted.

- Omnipool
  `add_liquidity`
  pulls the signer
  and mints an NFT
  to that signer.
  `do_remove_liquidity`
  requires
  `NFTHandler::owner
  == who` and pays
  that owner.
  `withdraw_protocol_liquidity`
  is
  `AuthorityOrigin`.
  `sell` / `buy`
  transfer
  `asset_in` from
  the signer and
  `asset_out` to
  the signer.
- Stableswap
  `sell` / `buy`
  require the
  signer's free
  balance and
  transfer that
  signer.
- XYK
  `create_pool` /
  `add_liquidity`
  pull the signer.
  Shares mint to
  that signer.
- OTC
  `place_order`
  reserves
  `asset_out` from
  the signer.
  `fill_order` /
  `partial_fill_order`
  swap against the
  reserved owner
  amount.
  `cancel_order`
  is the stored
  owner only.

Not submitted.
Remaining Hydration
listed GitHub:
liquidity-mining /
staking / LBP /
referrals / route-
executor leftover is
logged.

## 2026-09-03: Hydration staking leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
DCA and pool leftovers
are already logged.
This slice is staking,
liquidity-mining, LBP,
referrals, and
route-executor. Local
sparse clone
`/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/staking/src/lib.rs`,
`pallets/liquidity-mining/src/lib.rs`,
`pallets/lbp/src/lib.rs`,
`pallets/referrals/src/lib.rs`,
`pallets/route-executor/src/lib.rs`.

Checked for: a
stranger `claim` /
`unstake` on someone
else's position;
LBP `remove_liquidity`
by a non-owner;
`claim_rewards` that
pays another
account's shares.

Result: no
user-exploitable
finding. Not
submitted.

- Staking `stake`
  locks the signer's
  native balance and
  mints an NFT to
  that signer.
  `increase_stake`,
  `claim`, and
  `unstake` require
  `is_owner`.
- Liquidity-mining
  has no public
  calls. Farm create
  pulls
  `total_rewards`
  from the owner
  account.
- LBP `create_pool`
  is
  `CreatePoolOrigin`
  and pulls
  `pool_owner`.
  `remove_liquidity`
  is the stored
  pool owner after
  the sale ends.
- Referrals
  `claim_rewards`
  converts the pot
  then pays the
  signer from that
  signer's
  `ReferrerShares`
  / `TraderShares`.
- Route-executor
  `sell` / `buy` /
  `sell_all` run as
  the signer.

Not submitted.
Remaining Hydration
listed GitHub:
EVM leftover is
logged.
Leftover pallets leftover
is logged.
Leftover adapters leftover
is logged (listed
Hydration leftover that
a public tree would
open is exhausted).

## 2026-09-03: Velvet Capital leftover (Sourcify)

Immunefi program
`Velvet Capital`
($51,000, `kyc: false`).
Unique no-KYC listed
slice not previously
logged. 28 of 30 BSC
listed addresses
Sourcify-open (chain
56). Extract
`/tmp/velvet`. No
mainnet interaction.

Listed Sourcify-open:
`IndexSwap` /
`OffChainIndexSwap` /
`Exchange` /
`Rebalancing` /
`OffChainRebalance` /
`RebalanceAggregator` /
`FeeModule` /
`VelvetSafeModule` /
`AssetManagerConfig` /
`PriceOracle` /
`IndexSwapLibrary` /
`FeeLibrary` /
`RebalanceLibrary` /
Pancake / Venus / Ape /
BiSwap / Wombat / Beefy
handlers /
`ZeroExHandler` /
`OneInchHandler` /
`ParaswapHandler`. Two
IndexSwap /
OffChainRebalance
instances share the
same impl source.

Checked for: stranger
`investInFund` that
mints to the caller
from another user's
transfer; `withdrawFund`
that pays without
burning the caller;
Exchange
`_pullFromVault`
without
INDEX_MANAGER_ROLE;
VelvetSafeModule
`executeWallet` by a
non-owner; handler
`redeem` that pulls
from a vault.

Result: no
user-exploitable
finding. Not
submitted.

- `investInFund` /
  `investInFundOffChain`
  pull `msg.sender` (or
  `msg.value`) then mint
  to that sender.
  `withdrawFund` /
  `redeemTokens` burn
  the caller and pay
  that caller (or hold
  redeemed underlyings
  in the caller's
  mapping).
- Exchange vault pulls
  and swaps are
  `onlyIndexManager`.
  VelvetSafeModule
  `executeWallet` /
  `executeWalletDelegate`
  are `onlyOwner`; setup
  transfers ownership
  to Exchange.
- Rebalance /
  aggregator vault
  pulls are
  `onlyAssetManager`.
  IndexSwap mint/burn
  shares are
  `MINTER_ROLE`.
- Handlers operate on
  tokens already on the
  handler. Public
  `redeem` / aggregator
  `swap` cannot pull
  the Gnosis Safe.
- `chargeFees` is
  public and mints fee
  shares to the
  configured
  treasuries.

Do not file first-
depositor inflation,
public fee mint to
treasury, handler
leftover grief, asset-
manager rebalance /
pause, owner UUPS
upgrade, or public
unpause after 15
minutes.

Not submitted.
Listed leftover is the
Sourcify-open BSC
IndexSwap / Exchange /
rebalance / fee / Safe
module / handlers.
Remaining listed:
`0xB9669646EBb93A03dB67CC05f2894487C9923775`
and
`0xE61472Ce45e559830ECF12F6a215Cd732F4D798B`
Sourcify 404.
Velvet Capital V2 is a
separate KYC program.

## 2026-09-03: Mars Ecosystem leftover (Sourcify)

Immunefi program
`Mars Ecosystem`
($10,000, `kyc: false`).
Unique no-KYC listed
slice. 7 of 9 BSC
listed addresses
Sourcify-open (chain
56). Extract
`/tmp/mars`. No
mainnet interaction.

Listed Sourcify-open:
`Core`
`0x00789Cfb69499c65ac9A3a68fb4917c9b4FcA2a7`
`exact_match`;
`MarsSwapFactory`
`0x6f12482D9869303B998C54D91bCD8bCcba81f3bE`;
`MarsSwapRouter`
`0xb68825C810E67D4e444ad5B9DeB55BA56A66e72D`;
`AirDrop`
`0x01D152fF991E76b6cb310387c07cAfdFda790a25`;
`LiquidityMiningMaster`
`0xc7B8285a9E099e8c21CA5516D23348D8dBADdE4a`
and
`0x22D8d50454203bd5a41B49ef515891f1aD9f3e53`;
`VestingMaster`
`0x381Facb9282770a5E3Ac6c8637096b442039C3dB`
`match`.

Checked for: stranger
farm `withdraw` of
another user's LP;
`claim` that pays a
zero-allocation
airdrop as a drain;
VestingMaster `lock`
by a non-farm;
router
`removeLiquidity`
that burns another
account's LP.

Result: no
user-exploitable
finding. Not
submitted.

- Farm `deposit`
  `transferFrom`
  `msg.sender` and
  credits
  `userInfo[pid]
  [msg.sender]`.
  `withdraw` /
  `emergencyWithdraw`
  pay that sender.
- VestingMaster
  `lock` is
  `onlyFarms`.
  `claim` pays
  `msg.sender`'s
  matured locks.
- AirDrop `claim`
  pays the stored
  `userClaimed
  [msg.sender].amount`
  once. `addList` /
  `recover` are
  `onlyGovernor`.
- Router
  `removeLiquidity`
  `transferFrom`
  `msg.sender` LP
  then `burn`s to
  `to`. Factory
  `setFeeTo` is
  `onlyGovernor`.
- Core
  `allocateToken` /
  XMS mint are
  `onlyGovernor`.

Do not file
governor treasury
allocate, MasterChef
reward math, or
Uniswap-style
router slippage as
a stranger drain.

Not submitted.
Listed leftover is
the Sourcify-open
BSC Core / factory /
router / farm /
vesting / airdrop.
Remaining listed:
`0x7859B01BbF675d67Da8cD128a50D155cd881B576`
and
`0xC35a8BdBB93A03dB362aF6dC3383cD2c6aEA6cBc`
Sourcify 404.

## 2026-09-03: Hydration EVM leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
DCA, pool, and staking
leftovers are already
logged. This slice is
evm-accounts, the
MultiCurrency
precompile, and
permit dispatch.
Local sparse clone
`/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/evm-accounts/src/lib.rs`,
`runtime/hydradx/src/evm/precompiles/multicurrency.rs`,
`runtime/hydradx/src/evm/permit.rs`.

Checked for: a
stranger
`claim_account`
that binds another
account; `transfer`
from a non-caller;
`transfer_from`
without allowance.

Result: no
user-exploitable
finding. Not
submitted.

- `bind_evm_address`
  binds the signer.
  `claim_account` is
  unsigned but
  `validate_signature`
  verifies the
  claimed account.
  Deployer /
  approved-contract
  / NTT minter
  writes are
  `ControllerOrigin`.
- MultiCurrency
  `transfer` pulls
  `handle.context().
  caller`.
  `approve` sets
  allowance for that
  caller.
  `transfer_from`
  requires allowance
  or an
  owner-approved
  contract.
- Permit
  `dispatch_permit`
  runs as the
  permit `source`
  and reverts if
  the account nonce
  changes.

Not submitted.
Hydration leftover
pallets leftover is
logged.
Leftover adapters leftover
is logged (listed
Hydration leftover that
a public tree would
open is exhausted).

## 2026-09-03: Beefy Finance leftover (Sourcify)

Immunefi program
`Beefy Finance`
($75,000, `kyc: false`).
Unique no-KYC listed
slice. All 243 listed
smart contracts are
Polygon vault /
strategy addresses.
First-30 Sourcify
sample: 23 open, 7
404. Extract
`/tmp/beefy`. No
mainnet interaction.

Listed Sourcify-open
sample:
`BeefyVaultV6` (11 in
sample, including
`0xfEcf784F48125ccb7d8855cdda7C5ED6b5024Cb3`
`match` and
`0x9f3B96a2Dd55aa904bC5476Ffe66E74a53f6b420`
`exact_match`);
`StrategyCommonChefLP`
`0x315324Bcd724b8CF01FfE6d04F029328f595e126`;
`StrategyCommonChefReferrerLP`
`0xC32CCCfF0777C145e7d658081D141ec8A38f8133`;
`StrategyCommonChefSingle`
`0xf2F5C13686b79b92dC73F6Bb1D2663329658EC87`;
`StrategyPolygonBifiMaxi`
`0xD126BA764D2fA052Fc14Ae012Aef590Bc6aE0C4f`;
`StrategyCurveATricrypto`
`0x0C0C75AF434519AB96E34EB3bbEea726324d6264`;
`StrategyCurveAaveRen`
`0xAccf2f81F8c13e8D97ee272D141b6f4B613aB46D`;
`StrategyDFYNDualFarmRewardPoolLP` (3);
`StrategyDFYNRewardPoolLP`;
`StrategyPolyCatDyfnLP`.

Checked for: stranger
vault `withdraw` that
pays without burning
the caller; strategy
`withdraw` /
`retireStrat` without
the vault; public
`earn` that sends
vault `want` to a
non-strategy.

Result: no
user-exploitable
finding. Not
submitted.

- Vault `deposit`
  `transferFrom`
  `msg.sender` then
  mints shares to
  that sender.
  `withdraw` burns
  the caller and
  pays that caller.
- Public `earn`
  forwards idle
  `want` to the
  configured
  `strategy` only.
- Strategy
  `withdraw` /
  `retireStrat` are
  `msg.sender ==
  vault`. Harvest
  `onlyEOA` takes
  the configured
  call fee from
  rewards.
- `proposeStrat` /
  `upgradeStrat`
  are `onlyOwner`.
  `panic` is
  `onlyManager`.

Do not file first-
depositor inflation,
public `earn`, owner
strat upgrade, or
harvest call-fee as
a stranger drain.

Not submitted.
Listed leftover is
the Sourcify-open
Polygon
`BeefyVaultV6` +
common chef / DFYN /
Curve / BIFI-maxi
strategies in the
sampled slice.
Remaining listed:
other Polygon vaults
(7 of first 30
Sourcify 404;
unsampled addresses
not fetched).

## 2026-09-03: Orca leftover (`3b47341` / `05fe66b`)

Immunefi program
`Orca` ($500,000,
`kyc: false`). Unique
no-KYC listed slice.
Listed `xORCA`
`StaKE6XNKVVhG8Qu9hDJBqCW3eRe7MDGLz17nJZetLT`
and `Orca Whirlpools`
`whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`.
Official clones
`/tmp/xorca` at
`05fe66b` and
`/tmp/whirlpools` at
`3b47341`. No mainnet
interaction.

Files:
`solana-program/src/instructions/{stake,unstake,withdraw,set,initialize}.rs`,
`programs/whirlpool/src/instructions/{swap,increase_liquidity,decrease_liquidity,collect_fees,close_position}.rs`
plus v2 variants.

Checked for: stranger
xORCA `withdraw` of
another unstaker's
pending; Whirlpool
`collect_fees` /
`decrease_liquidity`
without the position
NFT; `swap` that
pulls a non-signer
ATA.

Result: no
user-exploitable
finding. Not
submitted.

- xORCA `stake`
  transfers ORCA
  from the signer ATA
  and mints xORCA to
  that signer.
  `unstake` burns the
  signer xORCA and
  writes a pending
  PDA seeded with
  that unstaker.
  `withdraw` verifies
  that PDA against
  the signer and pays
  the signer ATA
  after cooldown.
  `set` is the stored
  update authority.
- Whirlpool
  `collect_fees` /
  `decrease_liquidity`
  /
  `increase_liquidity`
  /
  `close_position`
  call
  `verify_position_authority`
  (owner or
  delegate of the
  position NFT).
- `swap` /
  `swap_v2` transfer
  as `token_authority`
  from the supplied
  owner ATAs; SPL
  requires that
  signer.

Do not file first-
depositor vault
inflation (xORCA
virtual-assets math
and tests
disincentivize it),
authority cooldown
updates, or swap
slippage as a
stranger drain.

Not submitted.
Listed leftover is
exhausted.

## 2026-09-03: Threshold Bank leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
BOB cross-chain leftover
is already logged.
This slice is listed
Ethereum Sourcify
`Bank` plus Bank /
VendingMachine from
`keep-network/tbtc-v2`.
Local clone
`/tmp/threshold-tbtc`
at `502cd39`. Sourcify
`exact_match` for
`0x65Fbae61ad2C8836fFbFB502A0dA41b0789D9Fc6`.
No mainnet interaction.

Files:
`solidity/contracts/bank/Bank.sol`,
`solidity/contracts/bridge/VendingMachine.sol`.

Checked for: a
stranger
`increaseBalance`;
`transferBalance`
from another
account;
`VendingMachine.mint`
that credits the
caller without
taking TBTC v1.

Result: no
user-exploitable
finding. Not
submitted.

- Bank
  `transferBalance`
  moves the caller's
  balance.
  Allowance updates
  are the owner.
  `increaseBalance`
  /
  `increaseBalances`
  /
  `increaseBalanceAndCall`
  are `onlyBridge`.
  `decreaseBalance`
  burns the caller.
- VendingMachine
  `mint` pulls TBTC
  v1 from
  `msg.sender` and
  mints v2 to that
  sender.
  `receiveApproval`
  is TBTC v1 only
  and mints to
  `from`.
  `unmint` burns the
  caller's v2 and
  pays that caller
  v1.
  `withdrawFees` is
  governance.

Not submitted.
Remaining Threshold
listed leftover:
other explorer
addresses and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: Arkadiko leftover (Hiro)

Immunefi program
`Arkadiko` ($100,000,
`kyc: false`). Unique
no-KYC listed slice.
12 listed Clarity
contracts on
`SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR`
Hiro-open. Extract
`/tmp/arkadiko`. Official
clone `/tmp/arkadiko-dao`
at `62095e8`. No mainnet
interaction.

Files:
`arkadiko-vaults-operations-v1-3.clar`,
`arkadiko-vaults-manager-v1-2.clar`,
`arkadiko-vaults-pool-active-v1-1.clar`,
`arkadiko-vaults-pool-liq-v1-2.clar`,
`arkadiko-vaults-data-v1-1.clar`,
`arkadiko-vaults-sorted-v1-1.clar`,
`usda-token.clar`,
`wstx-token.clar`.

Checked for: stranger
`open-vault` that mints
USDA against another
account's collateral;
`close-vault` that
withdraws another
owner's collateral;
`liquidate-vault` that
pays leftover to the
caller; pool-active
`withdraw` without
operations / manager.

Result: no
user-exploitable
finding. Not
submitted.

- `open-vault` /
  `update-vault` /
  `close-vault` bind
  `owner` to
  `tx-sender`.
  Collateral deposit
  / USDA mint and
  burn go to that
  sender.
- pool-active
  `deposit` /
  `withdraw` require
  operations,
  manager, or DAO
  owner.
  `set-vault` /
  sorted insert
  remove are the
  same callers.
- `liquidate-vault`
  only when CR is
  invalid. Leftover
  collateral returns
  to the vault
  owner. Liquidation
  collateral goes to
  the liq pool.
- `redeem-vault` is
  the first sorted
  vault. Redeemer
  burns their USDA
  and receives
  collateral minus
  fee.
- USDA
  `mint-for-dao` is
  the DAO. wstx
  wrap / unwrap
  move `tx-sender`.
  Liq-pool stake /
  unstake credit
  `tx-sender`.

Do not file DAO
owner privilege,
permissionless
liquidation of
undercollateralized
vaults, or first-
vault redemption as
a stranger drain.

Not submitted.
Listed leftover is
the Hiro-open
vaults / tokens /
liq-pool slice.
Remaining listed:
the website only.

## 2026-09-03: Threshold vault + MaintainerProxy leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Bank / VendingMachine
and BOB leftover are
already logged.
This slice is listed
Ethereum Sourcify
`TBTCVault`
(`0x9C070027cdC9dc8F82416B2e5314E11DFb4FE3CD`),
`DonationVault`
(`0xa544b70dC6af906862f68eb8e68c27bb7150e672`),
and `MaintainerProxy`
(`0xcF29Ff894674775841F60Aa2a3c373DE27A8df2b`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39`.
No mainnet interaction.

Files:
`solidity/contracts/vault/TBTCVault.sol`,
`solidity/contracts/vault/TBTCOptimisticMinting.sol`,
`solidity/contracts/vault/DonationVault.sol`,
`solidity/contracts/maintainer/MaintainerProxy.sol`.

Checked for: a
stranger mint of TBTC
without Bank balance;
optimistic mint by a
non-minter; debt
repay that mints
twice; DonationVault
`decreaseBalance` of
someone else;
MaintainerProxy proof
submit without being
a listed maintainer.

Result: no
user-exploitable
finding. Not
submitted.

- `TBTCVault.mint`
  pulls the caller's
  Bank satoshis after
  checking balance
  and allowance.
  `receiveBalanceApproval`
  is `onlyBank`.
  `receiveBalanceIncrease`
  is `onlyBank` and
  mints only the
  swept amount after
  `repayOptimisticMintingDebt`.
  `unmint` burns the
  caller and returns
  that caller's Bank
  balance.
  `unmintAndRedeem`
  requires the
  decoded redeemer
  to equal the TBTC
  burner (rebate
  impersonation
  already patched;
  do not refile
  1308).
- Optimistic mint
  request / finalize
  are `onlyMinter`,
  require a revealed
  unswept deposit
  targeted at this
  vault, and wait
  `optimisticMintingDelay`.
  Cancel is
  `onlyGuardian`.
  Debt is repaid
  from later Bank
  increases so a
  sweep does not
  mint a second
  full amount.
- DonationVault
  `donate` /
  `receiveBalanceApproval`
  move the owner
  into the vault
  then
  `decreaseBalance`
  the vault.
  `receiveBalanceIncrease`
  burns the vault's
  newly credited
  Bank total.
- MaintainerProxy
  sweep / redemption
  / moving-funds
  proofs are
  `onlySpvMaintainer`.
  Wallet-lifecycle
  helpers are
  `onlyWalletMaintainer`.
  Auth and
  `updateBridge` are
  owner.
  Permissionless
  wrappers
  (`resetMovingFundsTimeout`,
  `defeatFraudChallenge*`)
  still have to
  succeed on Bridge
  before the
  reimbursement pool
  pays the caller.

Not submitted.
Remaining Threshold
listed leftover:
Bridge /
BridgeGovernance /
RedemptionWatchtower /
RebateStaking /
Wormhole L1
depositor/redeemer
proxies,
WalletProposalValidator,
LightRelay,
TokenholderGovernor,
ReimbursementPool,
and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: Threshold watchtower + Wormhole L1 leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Vault / MaintainerProxy
leftover is already
logged. This slice is
listed Ethereum
Sourcify
`RedemptionWatchtower`
impl
(`0xbfD04E3928923aD8C86256B9A8F64eBD01Cf1dAf`
behind
`0xB8dF0A949aC45ff8f401553A1dcb742Feb38E6D3`),
`BTCDepositorWormhole`
impl
(`0x9A5250c7beA10f7472eB9d50bB757B83d67FB5ED`
behind
`0xb810AbD43d8FCFD812d6FEB14fefc236E92a341A`),
`L1BTCDepositorWormholeV2Arbitrum`
impl
(`0x82FDDF79765Ed75325bCBdf65F67dF0879AAbe8C`
behind
`0x75A6e4A7C8fAa162192FAD6C1F7A6d48992c619A`),
and `L1BTCRedeemerWormhole`
impl
(`0x14D93D4c4e07130fFfE6083432b66b96D8eB9DC0`
behind
`0x5D4d83aaB53B7E7cA915AEB2d4d3f4e03823DbDe`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39`.
No mainnet interaction.

Files:
`solidity/contracts/bridge/RedemptionWatchtower.sol`,
`solidity/contracts/cross-chain/AbstractL1BTCDepositor.sol`,
`solidity/contracts/cross-chain/wormhole/BTCDepositorWormhole.sol`,
`solidity/contracts/cross-chain/wormhole/L1BTCDepositorWormholeV2Base.sol`,
`solidity/contracts/cross-chain/wormhole/L1BTCRedeemerWormhole.sol`,
`solidity/contracts/integrator/AbstractBTCDepositor.sol`,
`solidity/contracts/integrator/AbstractBTCRedeemer.sol`.

Checked for: a
stranger
`withdrawVetoedFunds`;
guardian-less veto;
finalize that bridges
tBTC to the caller
instead of extraData;
Wormhole redeem that
ignores
`allowedSenders`.

Result: no
user-exploitable
finding. Not
submitted.

- Watchtower
  `raiseObjection` is
  `onlyGuardian` and
  needs a pending
  Bridge redemption.
  Third objection
  finalizes, bans the
  redeemer, pulls
  Bank balance via
  `notifyRedemptionVeto`,
  and burns the
  penalty.
  `withdrawVetoedFunds`
  pays only
  `veto.redeemer`
  after the freeze.
  `disableWatchtower`
  is lifetime-gated.
- L1 depositor
  `initializeDeposit`
  reveals with
  extraData bound in
  the Bitcoin script.
  `finalizeDeposit`
  is one-shot
  Initialized →
  Finalized, reads
  extraData from the
  Bridge deposit, and
  `_transferTbtc`
  locks that amount
  to the configured
  Wormhole gateway
  with the recorded
  receiver as
  payload. Relayer
  `msg.sender` is not
  the L2 owner.
- L1 redeemer
  `requestRedemption`
  measures tBTC
  received from
  `completeTransferWithPayload`,
  requires
  `allowedSenders`,
  unmints through the
  vault, and requests
  Bridge redemption
  to the VAA payload
  script. VAA replay
  is Token Bridge
  plus
  `nonReentrant`.

Do not refile 1496
(cross-chain
redemption timeout)
or 1410
(TOB-TBTCACEXT-30).

Not submitted.
Remaining Threshold
listed leftover:
Bridge /
BridgeGovernance /
RebateStaking /
WalletProposalValidator /
LightRelay /
TokenholderGovernor /
ReimbursementPool,
and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: JustLend leftover (`f28f3b4`)

Immunefi program
`JustLend DAO` ($50,000,
`kyc: false`). Unique
no-KYC listed slice.
Official clone
`/tmp/justlend-protocol`
at `f28f3b4` (`justlend/
justlend-protocol`).
55 listed assets are
Tronscan `smart_contract`
URLs (Unitroller /
Comptroller / jToken
markets / GovernorBravo /
oracle / rate models).
No mainnet interaction.

Files:
`contracts/Unitroller.sol`,
`contracts/Comptroller.sol`,
`contracts/CToken.sol`,
`contracts/CErc20.sol`,
`contracts/CEther.sol`,
`contracts/CErc20Delegator.sol`,
`contracts/Maximillion.sol`.

Checked for: a stranger
`mint` that credits
another account without
pulling that account;
`redeem` / `borrow` that
pays the caller from
someone else's jTokens;
`liquidateBorrow` without
shortfall; `seize` that
moves collateral when
`msg.sender` is not the
borrowed jToken.

Result: no
user-exploitable
finding. Not
submitted.

- Unitroller
  `_setPendingImplementation`
  / `_setPendingAdmin` are
  admin. Accept is the
  pending implementation
  or pending admin.
  Other calls
  `delegatecall` the
  current implementation.
- `mintFresh` pulls the
  minter via
  `doTransferIn` and
  credits that minter.
  `redeemFresh` burns the
  redeemer's jTokens and
  pays that redeemer.
  `borrowFresh` pays the
  borrower after a
  liquidity check.
  `repayBorrowFresh`
  pulls the payer and
  reduces the named
  borrower.
- `liquidateBorrowFresh`
  uses `msg.sender` as
  liquidator, requires
  shortfall and
  closeFactor, and
  seizes via
  `seizeInternal` or
  `cTokenCollateral.seize`
  (`msg.sender` is the
  seizer). Borrower
  cannot be the
  liquidator.
- Comptroller
  redeem / borrow /
  transfer require
  listed markets and no
  hypothetical shortfall.
  Liquidation requires
  shortfall.
  `_setPriceOracle` /
  `_setCollateralFactor` /
  `_supportMarket` /
  pause are admin or
  pause guardian.
- CEther refunds surplus
  `msg.value` to the
  sender. CErc20 skips
  the USDT transfer
  return-value check
  (Tron USDT
  compatibility).
  Delegator
  `_setImplementation`
  is admin.
  Maximillion
  `repayBehalf` refunds
  excess TRX to
  `msg.sender`.

Do not file first-
depositor exchange-rate
inflation, admin /
reserveAdmin privilege,
permissionless
liquidation of an
undercollateralized
account, or the USDT
return-value skip as
theft.

Not submitted.
Listed leftover is the
official GitHub
Unitroller /
Comptroller / CToken
mint-redeem-borrow-
liquidate slice.
Remaining listed:
ComptrollerLegacy JST
rewards, GovernorBravo /
WJST / Timelock,
PriceOracle /
PriceOracleProxy,
interest-rate models,
and the other Tronscan
jToken markets (same
CToken / CErc20 /
CEther / Delegator
bytecode).

## 2026-09-03: Threshold RebateStaking leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Watchtower / Wormhole L1
leftover is already
logged. This slice is
listed Ethereum
Sourcify
`RebateStaking` impl
(`0x25aAF04229f77A9AE80430b3C89E3455Ab2ec22F`
behind
`0x0184739C32edc3471D3e4860c8E39a5f3Ff85A45`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39`.
No mainnet interaction.

Files:
`solidity/contracts/bridge/RebateStaking.sol`.

Checked for: a
stranger
`applyForRebate` that
zeros someone else's
treasury fee;
`finalizeUnstaking`
of another stake;
callback rebate
without
`setRebateAuthorization`.

Result: no
user-exploitable
finding. Not
submitted.

- `applyForRebate`
  and `cancelRebate`
  are `onlyBridge`.
  `getStaker` only
  redirects a
  zero-stake
  delegatee to the
  staker who set
  them.
- `stake` pulls T
  from the caller.
  `startUnstaking`
  and
  `finalizeUnstaking`
  move the caller's
  stake after
  `unstakingPeriod`.
- `setRebateAuthorization`
  is the caller's
  stake only.
  `isRebateAuthorized`
  is false when
  `getStake` is 0.
- `forceStakeTransfer`
  is owner.
  Same-block
  `cancelRebate`
  matching at most
  one rebate is a
  documented
  temporary cap
  denial, not a
  drain.

Do not refile 1308
(rebate timestamp /
impersonation).
Vault
`unmintAndRedeem`
already binds the
decoded redeemer.

Not submitted.
Remaining Threshold
listed leftover:
Bridge /
BridgeGovernance /
WalletProposalValidator /
LightRelay /
TokenholderGovernor /
ReimbursementPool,
and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: JustLend leftover governance leftover (`f28f3b4`)

Immunefi program
`JustLend DAO` ($50,000,
`kyc: false`). Unitroller /
Comptroller / CToken leftover
is already logged. This
slice is listed
GovernorBravo / WJST /
Timelock / PriceOracleProxy.
Official clone
`/tmp/justlend-protocol`
at `f28f3b4`. No mainnet
interaction.

Files:
`contracts/Governance/Bravo/GovernorBravoDelegate.sol`,
`contracts/Governance/WJST.sol`,
`contracts/Timelock.sol`,
`contracts/PriceOracleProxy.sol`.

Checked for: a stranger
`execute` that runs an
unqueued proposal;
`voteFresh` that locks
another account's WJST
without the governor;
`withdraw` of someone
else's wrapped JST;
`setSaiPrice` by a
non-guardian.

Result: no
user-exploitable
finding. Not
submitted.

- `propose` needs WJST
  votes above the
  threshold or a live
  whitelist. `queue` is
  Succeeded only.
  `execute` is Queued
  and goes through
  Timelock. `cancel` is
  the proposer or a
  proposer who fell
  below threshold.
- `castVoteInternal`
  requires an Active
  proposal, locks
  `votesAdded` via
  `wjst.voteFresh`, and
  credits the named
  voter. `voteFresh` is
  governor-only and
  subtracts that
  account.
- WJST `deposit` pulls
  `msg.sender` and
  credits that sender.
  `withdraw` burns and
  pays the sender.
  `withdrawVotes`
  unlocks the sender
  after proposal state
  ≥ 2.
  `setGovernorAlpha` /
  `transferOwnership`
  are owner.
- Timelock
  queue / cancel /
  execute are admin.
  `setDelay` /
  `setPendingAdmin` are
  self-calls.
- PriceOracleProxy
  `getUnderlyingPrice`
  is view.
  `setSaiPrice` is
  guardian, once, and
  bounded.

Do not file WJST
`getPriorVotes`
ignoring the block
(no checkpoint —
governance design),
admin / owner
privilege, or
whitelist guardian
as theft.

Not submitted.
Listed leftover is
GovernorBravo / WJST /
Timelock /
PriceOracleProxy.
Remaining listed:
ComptrollerLegacy JST
rewards, PriceOracleV1,
interest-rate models,
and the other Tronscan
jToken markets (same
CToken / CErc20 /
CEther / Delegator
bytecode).

## 2026-09-03: Threshold validator + ReimbursementPool leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
RebateStaking leftover
is already logged.
This slice is listed
Ethereum Sourcify
`WalletProposalValidator`
(`0x30019D85a86ABD3cDA1167F4C052690c32FBDEc2`)
and `ReimbursementPool`
(`0x8adF3f35dBE4026112bCFc078872bcb967732Ea8`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39` plus Sourcify
`exact_match` for the
pool. No mainnet
interaction.

Files:
`solidity/contracts/bridge/WalletProposalValidator.sol`,
Sourcify
`contracts/ReimbursementPool.sol`.

Checked for: a
write path on the
validator that
moves Bank / TBTC;
`refund` from an
unauthorized
caller; `withdraw`
to a stranger.

Result: no
user-exploitable
finding. Not
submitted.

- WalletProposalValidator
  has no write
  functions. Sweep /
  redemption /
  moving-funds /
  heartbeat helpers
  are `view` and
  revert on invalid
  proposals. They
  do not submit
  proofs or change
  Bridge state.
- ReimbursementPool
  `refund` is
  `nonReentrant` and
  requires
  `isAuthorized[msg.sender]`.
  Authorize /
  unauthorize /
  `setStaticGas` /
  `setMaxGasPrice` /
  `withdraw` /
  `withdrawAll` are
  owner.

Not submitted.
Remaining Threshold
listed leftover:
Bridge /
BridgeGovernance /
LightRelay /
TokenholderGovernor,
and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: JustLend leftover rewards leftover (`f28f3b4`)

Immunefi program
`JustLend DAO` ($50,000,
`kyc: false`). Unitroller /
CToken and GovernorBravo /
WJST leftovers are already
logged. This slice is
ComptrollerLegacy JST
rewards, PriceOracleV1,
and interest-rate models.
Official clone
`/tmp/justlend-protocol`
at `f28f3b4`. No mainnet
interaction.

Files:
`contracts/ComptrollerLegacy.sol`,
`contracts/PriceOracle/PriceOracleV1.sol`,
`contracts/JumpRateModel.sol`,
`contracts/JumpRateModelV2.sol`,
`contracts/BaseJumpRateModelV2.sol`,
`contracts/WhitePaperInterestRateModel.sol`.

Checked for: a stranger
`claimComp` that pays
the caller another
holder's JST;
`setPrice` without being
poster; `updateJumpRateModel`
by a non-owner.

Result: no
user-exploitable
finding. Not
submitted.

- `claimComp` updates
  supply / borrow
  indexes and
  `transferComp` sends
  JST to the named
  holder, not the
  caller. Speeds and
  market add/drop are
  admin or initializing.
  `refreshCompSpeeds`
  only rewrites speeds.
- PriceOracleV1
  `setPrice` /
  `setPrices` require
  `poster`. Reader
  assets cannot be
  overwritten. Swing
  is capped.
- JumpRate /
  WhitePaper models
  are view-only after
  construct.
  JumpRateModelV2
  `updateJumpRateModel`
  is owner.

Do not file poster /
admin / owner
privilege, permissionless
`claimComp` for another
holder (pays that
holder), or public
`refreshCompSpeeds`
as theft.

Not submitted.
Listed leftover that a
public tree would open
is exhausted. Remaining
listed: other Tronscan
jToken markets (same
CToken / CErc20 /
CEther / Delegator
bytecode).

## 2026-09-03: Threshold Bridge leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Bank / vault /
watchtower / Wormhole /
RebateStaking leftovers
are already logged.
This slice is listed
Ethereum Sourcify
`Bridge` (`match`
`0x8d014903bf7867260584d714e11809fea5293234`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39`.
No mainnet interaction.

Files:
`solidity/contracts/bridge/Bridge.sol`,
`solidity/contracts/bridge/Deposit.sol`,
`solidity/contracts/bridge/Redemption.sol`.

Checked for: a
stranger reveal that
credits another
depositor; sweep /
redemption proof
without SPV
maintainer;
callback redemption
that spends a Vault
and rebates a
stranger; timeout
payout to the
caller.

Result: no
user-exploitable
finding. Not
submitted.

- `revealDeposit` /
  `revealDepositWithExtraData`
  embed `msg.sender`
  in the expected
  P2(W)SH script and
  store
  `depositor = msg.sender`.
- `submitDepositSweepProof`
  and
  `submitRedemptionProof`
  are
  `onlySpvMaintainer`
  and require an SPV
  proof.
- Direct
  `requestRedemption`
  uses `msg.sender`
  as
  `balanceOwner`.
  `receiveBalanceApproval`
  is Bank-only.
  Callback rebate
  applies only when
  the named redeemer
  authorized that
  balance owner
  (do not refile
  1308).
- `notifyRedemptionTimeout`
  returns Bank
  balance to
  `request.redeemer`
  after
  `redemptionTimeout`.
  `notifyRedemptionVeto`
  is the watchtower
  only.

Do not refile 1494
(closeable wallets)
or 1320 (relayer
reimbursement).

Not submitted.
Remaining Threshold
listed leftover:
BridgeGovernance /
LightRelay /
TokenholderGovernor,
and
`keep-network/tbtc-v2`
typescript.

## 2026-09-03: Threshold leftover gov / relay leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Bridge leftover is
already logged.
This slice is listed
Ethereum Sourcify
`BridgeGovernance`
(`0xA94DD662E2A247493fACCeab9f2459AAF90778Ee`),
`LightRelay`
(`0x836cdFE63fe2d63f8Bdb69b96f6097F36635896E`),
and
`TokenholderGovernor`
(`0xd101f2b25bcbf992bdf55db67c104fe7646f5447`).
Local clone
`/tmp/threshold-tbtc`
at `502cd39` plus Sourcify
for the governor.
No mainnet interaction.

Files:
`solidity/contracts/bridge/BridgeGovernance.sol`,
`solidity/contracts/relay/LightRelay.sol`,
Sourcify
`contracts/governance/TokenholderGovernor.sol`.

Checked for: a
stranger
`setVaultStatus` /
`setRebateStaking`;
`retarget` that
skips header
checks; governor
`execute` without
a passed proposal.

Result: no
user-exploitable
finding. Not
submitted.

- BridgeGovernance
  param updates are
  `onlyOwner` and
  two-step with
  `governanceDelay`.
  `setVaultStatus` /
  `setSpvMaintainerStatus`
  /
  `setRedemptionWatchtower`
  /
  `setRebateStaking`
  are owner (the
  last two are
  documented one-off
  wiring).
- LightRelay
  `retarget` checks
  header length and
  pre/post targets.
  Auth of submitters
  /
  `setProofLength`
  are owner.
- TokenholderGovernor
  is an OZ Governor
  + timelock wrapper
  (1.5% quorum,
  0.25% proposal
  threshold). Votes
  come from liquid T
  plus staking
  checkpoints.

Not submitted.
Listed Threshold
explorer leftover in
this pass is
exhausted at the
opened-contract
level. Remaining
listed:
`keep-network/tbtc-v2`
typescript (not a
Solidity money path).

## 2026-09-03: Pareto Credit leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). Unique
no-KYC listed slice.
Listed asset is the
docs vault-address page.
Docs HTML lists Ethereum
vaults. Sourcify
`exact_match`
`TransparentUpgradeableProxy`
for
`0xf6223C567F21E33e859ED7A045773526E9E3c2D5`
and siblings;
`match` `IdleCDOTranche`
for
`0x45054c6753b4Bce40C5d54418DabC20b070F85bE`.
Official clone
`/tmp/idle-tranches`
at `19e7cde` (Idle
Perpetual Yield Tranches
/ Pareto credit vaults).
No mainnet interaction
(publicnode storage 403).

Files:
`contracts/IdleCDOCreditVault.sol`,
`contracts/IdleCDO.sol`,
`contracts/IdleCDOTranche.sol`,
`contracts/IdleCDOEpochVariant.sol`.

Checked for: a stranger
`depositAA` that mints
to the caller without
pulling that caller;
`withdrawAA` that pays
without burning the
caller; epoch
`claimWithdrawRequest`
that pays another
user's receipt.

Result: no
user-exploitable
finding. Not
submitted.

- CreditVault
  `depositAA` /
  `depositBB` pull
  `msg.sender` and mint
  tranche shares to
  that sender, then
  `strategy.deposit`.
- IdleCDO
  `withdrawAA` /
  `withdrawBB` burn
  the caller's tranche
  via `_withdrawOps`
  and pay that caller.
- Tranche `mint` /
  `burn` are minter
  (the CDO) only.
  First mint burns
  `MIN_LIQUIDITY` to
  `address(1)`.
- Epoch
  `requestWithdraw`
  burns the caller and
  records a strategy
  receipt for
  `msg.sender`.
  `claimWithdrawRequest`
  /
  `claimInstantWithdrawRequest`
  claim that sender.

Do not file junior
loss absorption /
default pause, owner
or guardian shutdown,
first-deposit
`MIN_LIQUIDITY`, or
Keyring allowlist as
theft.

Not submitted.
Listed leftover is
the IdleCDO /
CreditVault /
Tranche / epoch
request-claim slice.
Remaining listed:
IdleCreditVault
strategy, other epoch
admin, proxy
implementations not
independently
Sourcify-fetched, and
other docs addresses.

## 2026-09-03: Puffer Finance leftover (Sourcify)

Immunefi program
`pufferfinance-boost`
($200,000, `kyc: false`).
Unique no-KYC listed
Ethereum slice.
Sourcify `exact_match`
`PufferDepositor`
`0x7276925e42f9c4054afa2fad80fa79520c453d6a`,
`PufferVaultV5` impl
`0x3b2fdFdEFE919dBcCE0bc5ac426097d5523B8AFA`
behind pufETH proxy
`0xd9a442856c234a39a81a089c06451ebaa4306a72`,
and `Timelock`
`0x3C28B7c7Ba1A1f55c9Ce66b263B33B204f2126eA`.
Official clone
`/tmp/puffer-contracts`
at `5ebdeaa`.
No mainnet interaction.

Files:
`src/PufferDepositor.sol`,
`src/PufferVaultV5.sol`.

Checked for: a
stranger mint of
pufETH without ETH /
stETH; withdraw that
burns another owner
without allowance;
`mintRewards` by a
random caller;
`transferETH` of vault
ETH.

Result: no
user-exploitable
finding. Not
submitted.

- Depositor
  `depositStETH` /
  `depositWstETH` /
  swap-and-deposit
  pull from
  `msg.sender` and
  mint pufETH to that
  sender. All entry
  points are
  `restricted`
  (AccessManager
  pause-style).
- Vault
  `depositETH` mints
  to `receiver` for
  `msg.value`.
  `depositStETH`
  pulls the caller's
  stETH shares.
  `withdraw` /
  `redeem` burn
  `owner` shares
  (ERC4626 allowance)
  and wrap ETH for
  `receiver`.
- `mintRewards` /
  `depositRewards` /
  `revertMintRewards`
  /
  `initiateETHWithdrawalsFromLido`
  /
  `claimWithdrawalsFromLido`
  /
  `transferETH` /
  `burn` are
  `restricted` to
  their matching
  roles.

Not submitted.
Remaining listed
Puffer Timelock is
OZ-style delay, not a
user money path.

## 2026-09-03: Pareto Credit leftover strategy leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). IdleCDO /
CreditVault / Tranche /
epoch request-claim is
already logged. This
slice is the
IdleCreditVault strategy
receipt and APR=0
accounting. Official
clone `/tmp/idle-tranches`
at `19e7cde`. No mainnet
interaction.

Files:
`contracts/strategies/idle/IdleCreditVault.sol`.

Checked for: a stranger
`requestWithdraw` /
`claimWithdrawRequest`
that pays another user's
receipt; instant claim
without a request;
`mintStrategyTokens`
without being the CDO.

Result: no
user-exploitable
finding. Not
submitted.

- `deposit` /
  `mintStrategyTokens` /
  `requestWithdraw` /
  `claimWithdrawRequest` /
  instant request-claim /
  `collect*Funds` /
  `prepareStopEpochWithApr0`
  are `_onlyIdleCDO`.
- `requestWithdraw` burns
  principal from the CDO
  and mints a receipt to
  `_user`. Claim waits
  one epoch (unless
  `epochEndDate == 0`),
  settles APR=0, burns
  that user's receipt,
  and `safeTransfer`s
  underlyings to `_user`.
- Instant claim burns
  that user's receipt
  and pays that user.
  Collect pulls from
  the CDO only.
- `_transfer` is blocked
  unless the CDO or
  `canTransfer` after
  default (manager).
- `setApr` is CDO or
  manager. `transferToken`
  / `setWhitelistedCDO`
  are owner. `redeem` /
  `redeemUnderlying` /
  `redeemRewards` are
  unused no-ops.

Do not file owner
rescue, manager APR,
CDO-only mint, address-
bound receipts, unused
redeem stubs, or APR=0
stopEpoch revert when
APR is later set as
theft.

Not submitted.
Listed leftover is the
IdleCreditVault strategy
slice. Remaining listed:
other epoch admin, proxy
implementations not
independently
Sourcify-fetched, and
other docs addresses.

## 2026-09-03: Pareto Credit leftover epoch admin leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). IdleCDO
request-claim and
IdleCreditVault strategy
are already logged. This
slice is epoch start /
stop / instant-fund
pull and mid-epoch
deposit. Official clone
`/tmp/idle-tranches` at
`19e7cde`. No mainnet
interaction.

Files:
`contracts/IdleCDOEpochVariant.sol`.

Checked for: a stranger
`startEpoch` /
`stopEpoch` /
`getInstantWithdrawFunds`
that drains borrower
funds to the caller;
`depositDuringEpoch`
that mints without
pulling the caller;
`sendFundsToBorrower` /
`getFundsFromBorrower`
without being this
contract.

Result: no
user-exploitable
finding. Not
submitted.

- `setEpochParams` /
  `setInstantWithdrawParams`
  / `startEpoch` /
  `stopEpoch` /
  `getInstantWithdrawFunds`
  are owner or strategy
  manager. Epoch duration
  0 is reserved for
  pool close.
- `startEpoch` skims
  donations, pauses
  deposits, funds instant
  receipts on the
  strategy, then sends
  surplus to the
  borrower via
  `sendFundsToBorrower`
  (only self). Failed
  borrower transfer
  defaults.
- `stopEpoch` pulls
  interest + pending
  withdraws from the
  borrower via
  `getFundsFromBorrower`
  (only self),
  `collectWithdrawFunds`
  to the strategy, then
  accrues. Catch path
  defaults. `_interest
  == 1` closes the pool.
- `stopEpochWithDuration`
  burns `_lossAmount`
  only after pending
  receipts are funded
  (documented).
- `depositDuringEpoch`
  pulls `msg.sender`,
  mints that sender at
  a time-weighted price,
  mints strategy tokens
  to the CDO, and sends
  underlyings to the
  borrower. Disabled
  for programmable /
  AYS / first-tranche
  supply 0.
- `restoreOperations`
  is owner and reverts
  if `defaulted`.

Do not file owner /
manager epoch control,
borrower default pause,
minted-interest NAV
fronting, Keyring
allowlist, or pending
receipts not haircut by
`_lossAmount` as theft.

Not submitted.
Listed leftover is the
epoch start / stop /
mid-epoch deposit
slice. Remaining listed:
IdleCDOEpochQueue /
Prefunded and L2
variants, proxy
implementations not
independently
Sourcify-fetched, and
other docs addresses.

## 2026-09-03: Pareto Credit leftover queue leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). IdleCDO
request-claim, strategy,
and epoch admin leftovers
are already logged. This
slice is the buffer-period
queue and prefunded
variant. Official clone
`/tmp/idle-tranches` at
`19e7cde`. No mainnet
interaction.

Files:
`contracts/IdleCDOEpochQueue.sol`,
`contracts/IdleCDOEpochVariantPrefunded.sol`.

Checked for: a stranger
`claimDepositRequest` /
`claimWithdrawRequest`
that pays another user's
queue slot; `deleteRequest`
after funds already went
to the borrower;
`processPrefundedDeposits`
without being the CDO.

Result: no
user-exploitable
finding. Not
submitted.

- `requestDeposit` /
  `requestWithdraw` pull
  from `msg.sender` and
  credit that sender's
  next-epoch slot.
  `deleteRequest` /
  `deleteWithdrawRequest`
  refund that sender only
  if the epoch is not yet
  priced (and not already
  prefunded).
- `processDeposits` /
  `processDepositsToBorrower`
  / `processWithdrawRequests`
  / `processWithdrawalClaims`
  are owner or strategy
  manager. Prefunded
  settlement is CDO-only
  and AA-only.
- `claimDepositRequest`
  / `claimWithdrawRequest`
  pay `msg.sender` at the
  saved epoch price.
  APR=0 claim rebase
  updates that price from
  realized cash.
- Prefunded
  `setEpochQueue` is
  owner or manager.
  `depositDuringEpoch` is
  disabled. Stop mints AA
  to the queue for already-
  prefunded cash.

Do not file owner /
manager process, Keyring
allowlist, prefund lock
after `processDepositsToBorrower`,
or queue rounding dust as
theft.

Not submitted.
Listed leftover that a
public tree would open
is exhausted (L2 epoch
variants only set
`feeReceiver`). Remaining
listed: proxy
implementations not
independently
Sourcify-fetched, and
other docs addresses.

## 2026-09-03: Mars Ecosystem leftover timelock leftover (Sourcify)

Immunefi program
`Mars Ecosystem`
($10,000, `kyc: false`).
Core / factory / router /
farm leftover is already
logged. Remaining listed
`0xC35a8BdBB93abFAb362aF6dC3383cD2c6aEA6cBc`
was a prior checksum typo
(`A03dB`); Sourcify
`exact_match` `Timelock`
on BSC. Extract
`/tmp/mars-timelock`. No
mainnet interaction.

Files:
`contracts/dao/Timelock.sol`
(Compound fork).

Checked for: a stranger
`queueTransaction` /
`executeTransaction`
without being admin;
`setDelay` /
`setPendingAdmin`
without a self-call.

Result: no
user-exploitable
finding. Not
submitted.

- `queueTransaction` /
  `cancelTransaction` /
  `executeTransaction`
  require `admin`.
  Execute also requires
  a queued hash, `eta`
  delay, and 14-day
  grace.
- `setDelay` /
  `setPendingAdmin` must
  come from the timelock
  itself. `acceptAdmin`
  is `pendingAdmin`.
- `receive` can hold
  BNB. No user deposit
  or redeem path.

Do not file admin
queue / execute or
Compound-style delay
as theft.

Not submitted.
Listed leftover is the
BSC Timelock. Remaining
listed:
`0x7859B01BbF675d67Da8cD128a50D155cd881B576`
Sourcify 404. Other
listed VestingMaster /
LiquidityMiningMaster
rows are the same
bytecode already
logged.

## 2026-09-03: SushiSwap leftover RedSnwapper leftover (Sourcify)

Immunefi program
`SushiSwap` ($200,000,
`kyc: false`). Unique
no-KYC listed slice.
Listed assets are docs
deployment pages.
Docs name Ethereum
`RedSnwapper`
`0xAC4c6e212A361c968F1725b4d055b47E63F80b75`.
Sourcify `exact_match`
on Ethereum and the
same address on Arb /
OP / Base / Polygon /
BSC. Extract
`/tmp/sushi-redsnwapper`.
No mainnet interaction.

Files:
`contracts/RedSnwapper.sol`
(includes `SafeExecutor`).

Checked for: a stranger
`snwap` /
`snwapMultiple` that
`transferFrom`s another
user; leftover-token
sweep of someone else's
balance; `SafeExecutor`
calling with this
contract's token
allowance.

Result: no
user-exploitable
finding. Not
submitted.

- `snwap` /
  `snwapMultiple` pull
  ERC20 only from
  `msg.sender` (or this
  contract's leftover
  minus 1 when
  `amountIn == 0`).
  Native skips the
  pull and forwards
  `msg.value`.
- Output check is the
  recipient's balance
  delta versus
  `amountOutMin`.
  Executor is
  caller-chosen.
- `SafeExecutor` has
  no token approvals.
  Tokens are sent to
  the executor, not
  held here.

Do not file leftover
dust sweep (`balance-1`),
user-chosen executor
theft of the caller's
own tokens, or public
`SafeExecutor` leftover
ETH as theft.

Not submitted.
Listed leftover is the
Sourcify-open
RedSnwapper. Remaining
listed: CPAMM and CLAMM
docs deployments.

## 2026-09-03: SushiSwap leftover CPAMM / CLAMM leftover (Sourcify)

Immunefi program
`SushiSwap` ($200,000,
`kyc: false`). RedSnwapper
is already logged. Docs
CPAMM / CLAMM deployments
resolve via sushi@7.3.1
to Ethereum
`UniswapV2Factory`
`0xC0AEe4…f2Ac`
(`exact_match`),
`UniswapV2Router02`
`0xd9e1cE…8B9F`
(`match`),
`UniswapV3Factory`
`0xbACEB8…29C4F`
(`match`), and
`NonfungiblePositionManager`
`0x2214A4…A432`
(`match`). Extract
`/tmp/sushi-v2factory`,
`/tmp/sushi-v2router`,
`/tmp/sushi-v3factory`,
`/tmp/sushi-v3npm`. No
mainnet interaction.

Files:
`UniswapV2Factory` /
`UniswapV2Pair`,
`UniswapV2Router02`,
`UniswapV3Factory`,
`NonfungiblePositionManager`
/ `LiquidityManagement`.

Checked for: a stranger
router `transferFrom` of
another user's tokens;
pair `mint` that credits
the caller without
deposits; NPM `collect`
without NFT
authorization.

Result: no
user-exploitable
finding. Not
submitted.

- Router add / remove /
  swap pull from
  `msg.sender` (or
  `msg.value` for ETH),
  enforce deadline and
  `amountMin` /
  `amountOutMin`, and
  mint or pay `to`.
- Pair first mint locks
  `MINIMUM_LIQUIDITY`
  unless `msg.sender` is
  the factory migrator
  (`feeToSetter`). Burn
  pays `to` for LP
  sitting on the pair.
  Swap keeps K after
  0.3% fee.
- V3 factory
  `createPool` is
  permissionless.
  `setOwner` /
  `enableFeeAmount` are
  owner.
- NPM mint callback
  pays the recorded
  payer through a
  factory-verified
  pool. Decrease /
  collect / burn require
  `isAuthorizedForToken`.

Do not file first-
depositor
`MINIMUM_LIQUIDITY`,
`feeToSetter` migrator /
feeTo, public `skim` of
surplus, owner V3 fee
tiers, or Uniswap-style
slippage as theft.

Not submitted.
Listed leftover is the
Sourcify-open Ethereum
CPAMM factory / pair /
router and CLAMM factory
/ NPM. Remaining listed:
V3 TickLens / Quoter /
PositionHelper (view /
helper) and same-bytecode
other-chain factories.

## 2026-09-03: Aster leftover (Sourcify)

Immunefi program
`Aster` ($200,000,
`kyc: false`). Unique
no-KYC listed BSC slice.
Sourcify `exact_match`
`asBTC` / `USDF` /
`asUSDF` / `AsBNB` and
`match` ERC1967 proxies
whose implementations
are `Earn`,
`WithdrawVault`,
`USDFEarn`,
`asUSDFEarn`, and
`RewardDispatcher`.
Extract `/tmp/aster`.
No mainnet interaction.

Files:
`contracts/oft/asBTC.sol`,
`contracts/oft/USDF.sol`,
`contracts/oft/asUSDF.sol`,
`src/AsBNB.sol`,
`contracts/Earn.sol`,
`contracts/USDFEarn.sol`,
`contracts/asUSDFEarn.sol`,
`contracts/WithdrawVault.sol`,
`contracts/RewardDispatcher.sol`,
`contracts/Withdrawable.sol`.

Checked for: a stranger
`deposit` that mints to
the caller without
pulling that caller;
`claimWithdraw` of
another user's request;
role-less `mint` /
`burn` on asBTC / USDF /
asUSDF / AsBNB.

Result: no
user-exploitable
finding. Not
submitted.

- Earn `deposit` /
  `depositNative` pull
  `msg.sender` (or
  `msg.value`) and mint
  ass tokens to that
  sender. Request locks
  that sender's ass
  tokens. Claim requires
  `receipt == msg.sender`.
- USDFEarn /
  asUSDFEarn pull
  `msg.sender` and mint
  to that sender.
  `Withdrawable` request
  `transferFrom`s the
  caller; claim pays
  that receipt via the
  vault.
- Token `mint` / `burn`
  are
  `MINTER_AND_BURN_ROLE`
  or AsBNB `onlyMinter`.
  Vault `transfer` /
  `transferNative` are
  `TRANSFER_ROLE`.
  Exchange-rate upload
  and Ceffu sweep are
  `BOT_ROLE`.

Do not file minter /
bot / admin privilege,
custodial Ceffu sweep,
first-deposit
`exchangePrice` 1e18, or
signed rate updates as
theft.

Not submitted.
Listed leftover that
Sourcify opens is
exhausted. Remaining
listed: the website.

## 2026-09-03: Gamma leftover (Sourcify)

Immunefi program
`Gamma` ($50,000,
`kyc: false`). Unique
no-KYC listed Ethereum
slice (not GammaSwap).
Sourcify `exact_match`
`xGamma`
`0x26805021988F1a45dC708B5FB75Fc75F21747D8c`
and `match`
`Hypervisor`
`0xa8076ae31e4b6c64d07b1ed27889924a962a70d3`
+ `UniProxy`
`0x83de646a7125ac04950fea7e322481d4be66c71d`.
Extract `/tmp/gamma`.
No mainnet interaction.

Files:
`xGamma/xGamma.sol`,
`Hypervisor/Hypervisor.sol`,
`UniProxy/UniProxy.sol`.

Checked for: a stranger
`deposit` that pulls a
third party or mints
without a matching pull;
`withdraw` that burns
another user's shares;
`enter` / `leave` that
pays a caller other than
the staker.

Result: no
user-exploitable
finding. Not
submitted.

- Hypervisor `deposit`
  requires
  `msg.sender ==
  whitelistedAddress`
  (UniProxy). It
  `transferFrom`s the
  named `from` after
  that gate. First mint
  sizes shares from the
  deposit and the live
  tick price with no
  `MINIMUM_LIQUIDITY`
  lock.
- Hypervisor `withdraw`
  requires
  `from == msg.sender`
  and burns that sender
  after sending the
  proportional Uniswap
  collect plus unused
  balances to `to`.
  Rebalance / compound /
  `pullLiquidity` /
  whitelist / fee are
  owner.
- UniProxy `deposit`
  `transferFrom`s
  `msg.sender` on
  version < 3, then
  calls Hypervisor with
  `from` = proxy or
  `msg.sender`. Version
  ≥ 2 mints shares to
  `msg.sender` (the
  `to` argument is
  unused). `addPosition`
  infinite-approves the
  hypervisor; owner
  only.
- xGamma `enter` mints
  to `msg.sender` then
  `transferFrom`s that
  sender. `leave` burns
  `msg.sender` and pays
  that sender. SushiBar
  first-deposit /
  donation inflation
  applies.

Do not file first-
depositor share
inflation, owner
rebalance / whitelist /
fee, UniProxy ignoring
`to` on version ≥ 2, or
xGamma donation
inflation as theft.

Not submitted.
Listed leftover that
Sourcify opens is
exhausted (all three
listed addresses).

## 2026-09-03: SPOT leftover (Sourcify)

Immunefi program
`SPOT` ($10,000,
`kyc: false`). Unique
no-KYC listed Ethereum
slice. Sourcify
`exact_match`
`TransparentUpgradeableProxy`
`0xC1f33e0cf7e40a67375007104B929E49a581bafE`
→ impl `PerpetualTranche`
`0x62cbE9F24413485f04FA62F9548C7855ec4a5425`
(`exact_match`) and
`BondIssuer`
`0x2E2E49eDCd5ce08677Bab6d791C863f1361B52F2`;
`match` `RouterV1`
`0x38f600e08540178719BF656e6B43FC15A529c393`
+ `BondFactory`
`0x2b135C839d61808E1eC6F84151CD9429B0920374`.
Extract `/tmp/spot`.
No mainnet interaction.

Files:
`token_impl/contracts/PerpetualTranche.sol`,
`router/contracts/RouterV1.sol`,
`factory/contracts/BondFactory.sol`,
`factory/contracts/BondController.sol`,
`issuer/contracts/BondIssuer.sol`.

Checked for: a stranger
`deposit` that mints
perp or tranche tokens
without pulling that
caller; `redeem` that
pays a caller other
than the burner;
router helpers that
pull a third party.

Result: no
user-exploitable
finding. Not
submitted.

- PerpetualTranche
  `deposit` pulls
  `msg.sender` into the
  reserve and mints
  perp to that sender.
  `redeem` burns
  `msg.sender` (fee
  stays via
  `transfer` from that
  sender) and pays
  reserve tokens to
  that sender.
  `rollover` /
  `claimFees` /
  `payProtocolFee` /
  `rebalanceToVault`
  are `onlyVault`.
- RouterV1
  `trancheAndDeposit`
  / `trancheAndRollover`
  `transferFrom`
  `msg.sender` and
  return leftover
  collateral / fee /
  unused tranches /
  minted perp to that
  sender. The listed
  Router still calls
  `perp.rollover`,
  which is `onlyVault`
  on the listed
  PerpetualTranche
  impl (reverts).
- BondController
  `deposit` pulls
  `msg.sender` and
  mints tranches to
  that sender.
  `redeem` /
  `redeemMature` burn
  or redeem
  `msg.sender` and pay
  that sender. First
  deposit requires
  `MINIMUM_FIRST_DEPOSIT`.
- BondIssuer `issue`
  is a timed factory
  poke. BondFactory
  `createBond` clones
  a new controller.

Do not file first-
deposit minimum,
owner fee / mature,
vault-only rollover
or debasement mint,
keeper pause / mint
caps, or leftover
tokens sitting on
the router as theft.

Not submitted.
Listed leftover that
Sourcify opens is
exhausted. Remaining
listed: the website.

## 2026-09-03: DeGate leftover (Sourcify)

Immunefi program
`boosteddegatebugbounty`
($400,000, `kyc: false`).
Unique no-KYC listed
Ethereum slice. Sourcify
`exact_match` Compound
`Timelock`
`0xf2991507952d9594E71A44A54fb19f3109D213A5`
+
`0x0D2eC0a5858730E7D49f5B4aE6f2C665e46c1d9d`
and `match`
`OwnedUpgradabilityProxy`
deposit
`0x54D7aE423Edb07282645e740C046B9373970a168`
→ impl
`DefaultDepositContract`
`0x8CCc06C4C3B2b06616EeE1B62F558f5b9C08f973`
+ exchange
`0x9C07A72177c5A05410cA338823e790876E79D73B`
→ impl `ExchangeV3`
`0xc56C1dfE64D21A345E3A3C715FFcA1c6450b964b`
+ `MultiSigWallet`
`0x2028834B2c0A36A918c10937EeA71BE4f932da52`.
Extract `/tmp/degate`.
No mainnet interaction.

Files:
`tl_dep/contracts/TimelockCompound.sol`,
`gnosis/MultiSigWallet.sol`,
`dep_impl/contracts/core/impl/DefaultDepositContract.sol`,
`ex_impl/contracts/core/impl/ExchangeV3.sol`,
`ex_impl/contracts/core/impl/libexchange/ExchangeDeposits.sol`,
`ex_impl/contracts/core/impl/libexchange/ExchangeWithdrawals.sol`.

Checked for: a stranger
`deposit` that credits
another account or pulls
a third party without
agent rights; on-chain
withdrawals that pay the
caller instead of the
owner; unguarded
`onchainTransferFrom`.

Result: no
user-exploitable
finding. Not
submitted.

- ExchangeV3 `deposit`
  is
  `onlyFromUserOrAgent(from)`
  and the library
  requires `from == to`.
  The deposit contract
  `transferFrom`s that
  `from` and credits
  `pendingDeposits[to]`.
- `forceWithdraw` /
  `setWithdrawalRecipient`
  /
  `onchainTransferFrom`
  /
  `approveTransaction`
  use the same gate.
  Batch
  `approveTransactions`
  requires the caller
  is an agent of every
  listed owner.
- `withdrawFromMerkleTree`
  /
  `withdrawFromDepositRequest`
  /
  `withdrawFromApprovedWithdrawals`
  are permissionless
  helpers that pay the
  account owner, not
  the caller.
- Deposit-contract
  `deposit` / `withdraw`
  / `transfer` are
  `onlyExchange`.
- Timelock queue /
  cancel / execute are
  admin; `setDelay` /
  `setPendingAdmin` are
  self-only. Multisig
  confirm is owner-
  gated.

Do not file
permissionless owner-
paying withdraw
helpers, registered-
agent deposits, owner
`submitBlocks` / fee
sweep, or timelock /
multisig admin as
theft.

Not submitted.
Listed leftover that
Sourcify opens is
exhausted (all five
listed addresses plus
the two proxy impls).

## 2026-09-03: boost-lido leftover (Sourcify)

Immunefi program
`boost-lido` ($100,000,
`kyc: false`). Unique
no-KYC listed Ethereum
slice (Mellow DVV /
DVstETH). Sourcify
`exact_match` vault
proxy
`0x5E362eb2c0706Bd1d134689eC75176018385430B`
→ impl `DVV`
`0x0000007563180c9066693110667e2232962d93a1`
plus listed
VaultConfigurator /
ERC20TvlModule /
StakingModule /
oracles / Initializer /
SimpleDVTStakingStrategy
/ ManagedValidator.
Extract `/tmp/boost-lido`.
No mainnet interaction.

Files:
`DVV_000000/src/vaults/DVV.sol`,
`DVV_000000/src/vaults/ERC4626Vault.sol`,
`DVV_000000/src/vaults/MellowVaultCompat.sol`,
`Initializer_969A0c/src/Vault.sol`,
`StakingModule_D570E1/src/modules/obol/StakingModule.sol`,
`SimpleDVTStakingStrategy_078b1C/src/strategies/SimpleDVTStakingStrategy.sol`,
`ManagedValidator_A1b3a3/src/validators/ManagedValidator.sol`.

Checked for: a stranger
ERC-4626 `deposit` that
mints without pulling
the caller; `withdraw` /
`redeem` that burns
another owner without
allowance; Mellow
`registerWithdrawal`
that locks another
user's LP.

Result: no
user-exploitable
finding. Not
submitted.

- DVV ERC-4626
  `deposit` / `mint`
  pull `msg.sender` and
  mint to `receiver`.
  `withdraw` / `redeem`
  burn `owner` (caller
  or approved) and pay
  `receiver`. Pause /
  whitelist / limit
  only shrink
  `maxDeposit`.
- `DVV.submit` is a
  permissionless poke
  that wraps vault WETH
  into wstETH.
  `migrate` /
  `migrateApproval` are
  public storage-slot
  pokes.
- Bundled Mellow
  `Vault.deposit` pulls
  `msg.sender` and mints
  LP to `to`.
  `registerWithdrawal`
  locks that sender's
  LP. `processWithdrawals`
  is operator and pays
  `request.to`.
- StakingModule
  `convert` /
  `convertAndDeposit`
  are `onlyDelegateCall`.
  Strategy
  `processWithdrawals`
  is operator.
  `convertAndDeposit`
  still goes through
  `vault.delegateCall`
  (operator + validator
  on the Mellow vault).

Do not file
permissionless
`submit` / `migrate`,
operator withdrawal
processing, admin
pause / whitelist, or
ERC-4626 first-deposit
inflation as theft.

Not submitted.
Listed leftover that
Sourcify opens is
exhausted (all twelve
listed addresses plus
the DVV impl).

## 2026-09-03: alchemix-boost leftover (`f100743`)

Immunefi program
`alchemix-boost`
($125,000, `kyc: false`).
Unique no-KYC listed
`alchemix-v2-dao` slice
(not the already-logged
Alchemix V3 tree). Public
raw sources from
`alchemix-finance/alchemix-v2-dao`
`f100743`. Extract
`/tmp/alchemix-boost`.
No mainnet interaction.

Files:
`RevenueHandler.sol`,
`RewardsDistributor.sol`,
`VotingEscrow.sol`,
`Minter.sol`,
`Voter.sol`,
`RewardPoolManager.sol`,
`FluxToken.sol`,
`BaseGauge.sol`,
`Bribe.sol`,
`CurveMetaPoolAdapter.sol`,
`CurveEthPoolAdapter.sol`,
`AlchemixGovernor.sol`.

Checked for: a stranger
`claim` that pays the
caller instead of the
veNFT owner; `withdraw`
that unlocks another
tokenId; unguarded
`mint` on Flux / ALCX.

Result: no
user-exploitable
finding. Not
submitted.

- RevenueHandler /
  RewardsDistributor /
  FluxToken claims
  require
  `isApprovedOrOwner`
  and pay the veNFT
  owner (or a
  recipient the owner
  chose).
- VotingEscrow
  `createLock` /
  `depositFor` pull
  `msg.sender` BPT.
  `withdraw` is owner-
  or-approved and
  transfers BPT to
  `ownerOf`.
- RewardPoolManager
  deposit / withdraw
  are `veALCX`-only.
  Voter
  `notifyRewardAmount`
  is minter-only.
  Bribe
  `getRewardForOwner`
  is voter-only and
  pays `ownerOf`.
- Minter
  `updatePeriod` is
  voter-only. Flux
  `mint` is
  `onlyMinter`. Curve
  adapters `melt` to
  `msg.sender` (the
  RevenueHandler after
  it moved tokens in).

Do not file
permissionless
checkpoint / donate-
to-lock, leftover
adapter dust `melt`,
admin treasury
routing, or veNFT
approval letting the
approved address
claim as theft.

Not submitted.
Listed leftover that
a public tree would
open is exhausted.
Remaining listed: the
website.

## 2026-09-03: GMX leftover (Sourcify)

Immunefi program
`gmx` ($5,000,000,
`kyc: false`). Unique
no-KYC listed slice
(not GMTrade / Mux
GmxV2 leftovers).
Sourcify Arbitrum
`match` `Vault`
`0x489ee077994B6658eAfA855C308275EAd8097C4A`
+ `Router`
`0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064`
+ `GlpManager`
`0x321F653eED006AD1C29D174e17d96351BDe22649`
+ `GLP` / `GMX`, and
`exact_match`
`RewardRouterV2`
`0x5E4766F932ce00aA4a1A82d3Da85adf15C5694A1`.
Extract `/tmp/gmx`.
No mainnet interaction.

Files:
`vault/Vault.sol`,
`router/Router.sol`,
`glpManager/GlpManager.sol`,
`rewardRouter/contracts/staking/RewardRouterV2.sol`,
`glp/GLP.sol`,
`gmx/GMX.sol`.

Checked for: a stranger
`increasePosition` /
`decreasePosition` on
another account;
Router `pluginTransfer`
without that user's
plugin approval;
`addLiquidityForAccount`
without handler;
RewardRouter redeem
that unstakes another
account.

Result: no
user-exploitable
finding. Not
submitted.

- Vault
  `increasePosition` /
  `decreasePosition`
  require the caller is
  the account, the
  configured router, or
  an
  `approvedRouters`
  entry for that
  account. `buyUSDG` /
  `sellUSDG` are
  manager-only.
  `_transferIn` credits
  the balance delta.
- Router swaps and
  `directPoolDeposit`
  pull `_sender()`.
  Position open/close
  pass `_sender()` as
  the account.
  `pluginTransfer` /
  plugin position calls
  require the plugin is
  gov-listed and the
  user called
  `approvePlugin`.
- GlpManager public
  add/remove use
  `msg.sender`.
  `*ForAccount` is
  handler-only.
- RewardRouter stake /
  mint-and-stake /
  unstake-and-redeem /
  claim bind to
  `msg.sender`. GLP /
  GMX `mint` is
  `onlyMinter`.

Do not file manager
`buyUSDG`, gov mint,
user-approved plugin
pulls, permissionless
liquidation, or
handler-only GLP
account mint as theft.

Not submitted.
Remaining listed:
Avalanche V1 twins,
reward trackers /
vesters /
distributors, and the
listed GMX V2
ExchangeRouter /
DepositVault /
DataStore / Oracle
rows (Arb + Avax).

## 2026-09-03: GMX leftover V2 ExchangeRouter leftover (Sourcify)

Immunefi program
`gmx` ($5,000,000,
`kyc: false`). Sourcify
Arbitrum `match`
`ExchangeRouter`
`0x674Ee2FFe588c4b1Fde6D5481c55Ef6133004cbA`
and `exact_match`
`DepositVault`
`0xF89e77e8Dc11691C9e8757e84aaFbCD8A67d7A55`
+ `DataStore`
`0xFD70de6b91282D8017aA4E741e9Ae325CAb992d8`.
Extract `/tmp/gmx-v2`.
No mainnet interaction.

Files:
`exRouter/contracts/router/ExchangeRouter.sol`,
`exRouter/contracts/router/BaseRouter.sol`,
`exRouter/contracts/router/Router.sol`,
`exRouter/contracts/deposit/DepositUtils.sol`,
`depositVault/contracts/bank/Bank.sol`,
`depositVault/contracts/bank/StrictBank.sol`.

Checked for: a stranger
`createDeposit` that
credits another
account's vault
transfer-in;
`cancelDeposit` that
refunds the caller
instead of the
depositor;
unguarded
`pluginTransfer`.

Result: no
user-exploitable
finding. Not
submitted.

- ExchangeRouter
  `createDeposit` /
  `createWithdrawal` /
  `createOrder` /
  `executeAtomicWithdrawal`
  pass `account =
  msg.sender`.
  `cancelDeposit` /
  `cancelWithdrawal`
  require
  `account ==
  msg.sender`.
- `sendTokens` pulls
  `msg.sender` through
  `Router.pluginTransfer`
  (`onlyRouterPlugin`).
- DepositUtils records
  vault balance deltas
  into a deposit owned
  by that account.
  Cancel refunds
  `deposit.account()`.
- DepositVault
  `transferOut` /
  `recordTransferIn`
  are
  `onlyController`.

Do not file keeper
execute / cancel of
an aged request,
controller vault
sweeps, or leftover
tokens sent to the
vault without a
matching create as
theft.

Not submitted.
Remaining listed:
Avalanche V1/V2 twins,
V1 trackers / vesters,
and V2 Oracle /
Reader / GlvReader
rows.

## 2026-09-03: zerolend-boost leftover (`60d255a`)

Immunefi program
`zerolend-boost`
($200,000, `kyc:
false`). Ended 2024-03-14
audit competition
(`Audit Comp | ZeroLend`);
logged so the custom
governance tree is not
re-opened. Public
`zerolend/governance` at
`60d255aca56f46fe9b26f012eee683e1aede2b33`.
Extract `/tmp/zerolend-gov`.
Sourcify 404 on zkSync
chain 324 for sample Pool
impl / proxy. No mainnet
interaction.

Files:
`contracts/ZeroLend.sol`,
`contracts/locker/BaseLocker.sol`,
`contracts/locker/staking/OmnichainStakingBase.sol`,
`OmnichainStakingToken.sol`,
`OmnichainStakingLP.sol`,
`contracts/vesting/VestedZeroNFT.sol`,
`contracts/vesting/StakingBonus.sol`,
`contracts/airdrop/AirdropRewarder.sol`,
`contracts/voter/PoolVoter.sol`,
`contracts/zaps/ZapLockerLP.sol`,
`contracts/emissions/EmissionsMainnet.sol`.

Checked for: a stranger
`unstakeToken` /
`unstakeAndWithdraw` that
sends another staker's
NFT or underlying to the
caller; locker
`withdraw` that pays a
non-owner; vest `claim`
that pays the caller;
airdrop `claim` that
pays the prover.

Result: no
user-exploitable
finding. Not
submitted.

- `_unstakeToken`
  reverts
  `InvalidUnstaker`
  unless
  `msg.sender ==
  lockedByToken[tokenId]`.
  `unstakeToken` then
  transfers the NFT to
  that sender.
  `unstakeAndWithdraw`
  withdraws the locker
  NFT (staking is
  owner) and pays
  `locked.amount` to
  `msg.sender`.
- BaseLocker
  `increaseAmount` /
  `increaseUnlockTime` /
  `withdraw(uint256)`
  require owner or
  approved.
  `withdraw` pays
  `msg.sender`.
  `withdraw(address)`
  still requires
  authorization on
  each token.
  `depositFor` can
  donate into an
  existing lock.
- VestedZeroNFT `mint`
  pulls
  `msg.sender` and
  mints to `_who`.
  `claim(uint256)`
  pays `ownerOf(id)`.
  `claimUnvested` is
  `stakingBonus`-only.
- AirdropRewarder
  `claim` pays / locks
  the merkle-proven
  `_user`.
- PoolVoter `vote`
  binds to
  `msg.sender`.
  `reset` is self or
  `votingPowerCombined`.
- ZeroLend `mint` is
  `MINTER_ROLE`.
  Emissions `execute`
  is owner.

Do not file
permissionless vest /
airdrop poke that
pays the owner, lock
donations, public
`ZapLockerLP.sweep`
dust, owner
emissions / bonus
BPS, or Aave-fork
first-depositor
inflation on the
listed zkSync / Manta
markets.

Not submitted.
Listed leftover that
a public tree would
open is exhausted
(ended audit-comp
governance repo).
Remaining listed:
zkSync / Manta
Aave-fork addresses
(Sourcify 404 last
check). Do not take
remaining
`zerolend-boost`
Aave-fork rows.

## 2026-09-03: GMX leftover V1 RewardTracker leftover (Sourcify)

Immunefi program
`gmx` ($5,000,000,
`kyc: false`). Sourcify
Arbitrum `exact_match`
`RewardTracker`
`0x4d268a7d4C16ceB5a606c173Bd974984343fea13`
+
`0x0755D33e45eD2B874c9ebF5B279023c8Bd1e5E93`
+
`0xd2D1162512F927a7e282Ef43a362659E4F2a728F`
+
`0x4e971a87900b931fF39d1Aad67697F49835400b6`
+ `RewardDistributor`
`0x5C04a12EB54A093c396f61355c6dA0B15890150d`
+ `Vester`
`0x199070DDfd1CFb69173aa2F7e20906F26B363004`,
and `match`
`RewardTracker`
`0x908C4D94D34924765f1eDc22A1DD098397c59dD4`
+
`0x1aDDD80E6039594eE970E5872D247bf0414C8903`
+ `RewardDistributor`
`0x23208B91A98c7C1CD9FE63085BFf68311494F193`
+ `BonusDistributor`
`0x03F349b3CC4f200D7FAE4d8DdaF1507f5A40D356`
+ `EsGMX`
`0xf42Ae1D54fd613C9bb14810b0588FaAa09a426cA`.
Extract `/tmp/gmx-trackers`.
No mainnet interaction.

Files:
`bonus-tracker/contracts/staking/RewardTracker.sol`,
`fee-glp-dist/contracts/staking/RewardDistributor.sol`,
`gmx-vester/contracts/staking/Vester.sol`,
`bonus-dist/BonusDistributor.sol`,
`esgmx/EsGMX.sol`,
`staked-gmx-tracker/RewardTracker.sol`.

Checked for: a stranger
`unstake` /
`unstakeForAccount`
that sends another
account's deposit
tokens to the caller;
`claim` /
`claimForAccount`
that pays the caller
another account's
rewards; Vester
`withdraw` that
releases another
account's esGMX;
distributor
`distribute` that
anyone can drain.

Result: no
user-exploitable
finding. Not
submitted.

- RewardTracker
  `stake` /
  `unstake` bind
  funding and
  receiver to
  `msg.sender`.
  `stakeForAccount` /
  `unstakeForAccount` /
  `claimForAccount`
  require
  `isHandler`.
  Public `claim`
  pays a named
  receiver from
  `msg.sender`'s
  `claimableReward`.
- RewardDistributor
  and
  BonusDistributor
  `distribute` require
  `msg.sender ==
  rewardTracker`.
- Vester `deposit`
  pulls `esToken`
  (and pair token)
  from `_account`.
  Public `deposit` /
  `claim` /
  `withdraw` use
  `msg.sender`.
  `depositForAccount` /
  `claimForAccount` /
  `transferStakeValues`
  are handler-only.
- EsGMX `mint` /
  `burn` are
  `onlyMinter`.
  `claim` asks each
  yield tracker for
  `msg.sender`.

Do not file gov
`withdrawToken`,
handler-only
`ForAccount` pulls,
private staking /
claiming mode,
or admin
`recoverClaim`.

Not submitted.
Remaining listed:
Avalanche V1 twins
(same RewardTracker /
Vester / distributor
types), Sourcify-404
Glp Vester + Staked
Glp Distributor, and
V2 Oracle / Reader /
GlvReader rows.
Do not re-review
same-bytecode Avax
twins.

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
POSITIVE_SLIPPAGE, Stargate / LayerZero /
CCIP / Mayan / DeBridge, UniV4 / Relay /
SETTLER_SWAP, Maverick / Dodo /
BalancerV3, Bebop / EulerSwap / Curve,
Pancake / Renegade / Ekubo / Hanji /
Nucleus, and MakerPSM (`1df9087`) are
logged. 0x leftover DEX / teller mixins
are exhausted. Extra Finance LYF LendingPool +
VeloPositionManager + RewardDistributor
(Sourcify, 2024-08 verified) plus ExtraX
factory / creators / live proxy, the
Aave-fork Pool skim, and VeToken
(`0xe0Be…1466`) are logged;
remaining Extra Finance listed
Solidity (EXTRA token, Sourcify)
is logged; Aave-fork ACL / config
/ aToken / debt already logged.
Vault factory ids 101–105
are **not** listed. Index Coop
Set Protocol V2 (all five in-scope
addresses) is logged. Lista DAO Moolah
+ PublicLiquidator (`ce72699`, newest
2026-05-29 assets) plus leftover PSM /
LisUSD / clip-join / slisBNB
(`3e120da` + `67e524c`), Moolah vault
+ Credit/Lending brokers, SlisBNB /
BNB / ERC20-LP providers, MasterVault
+ yield strategies, leftover
OFT / distributors / providers
(`28a3c02` + `fa5dfa5`), Extra
Finance Aave-fork leftover (ACL /
config / aToken / debt), and
`lista-new-contracts` RWA / slisXAUE /
LisAster / leftover distributors
(`fa5dfa5`) plus CDP ResilientOracle
+ listed pips (`3e120da`) are logged.
Enzyme Blue BebopBlend / ThreeOneThird /
SharesSplitter (`da3b870` + Sourcify) are
logged. Extra Finance EXTRA token
(Sourcify), Hashflow Wormhole
messenger (listed 8 Jun row,
Sourcify), Magpie
WombatPoolHelper (Sourcify), and
SparkLend Ethereum sUSDC vault +
PSM Variant1 actions (Sourcify)
plus the Spark ALM controller
tree (`ce5cbd9`: Mainnet /
Foreign / proxy / rate limits)
and SparkVault V2
(`51c6d7a`) plus PSM3
(`2b1a72a`; live pools
seeded) are logged. Listed Extra Finance
and Hashflow Solidity are
exhausted. Magpie leftover is
Primacy of Impact only.
Remaining SparkLend:
13 Jul Robinhood / X Layer
executor / receiver rows are
the same gov-relay contracts
already logged (`6218d57`);
do not re-review. DSR / SSR
`xchain-ssr-oracle` (`4a23d1f`)
plus leftover
`SSRRateSource` /
`KillSwitchOracle` /
`SavingsDaiOracle` (Sourcify)
plus 15 Jul Ethereum
sUSDC / `UsdcVault` and
L2 `UsdcVaultL2` (Base /
Arb / OP Sourcify) are
logged. `AAVE_ORACLE` is the
already-logged Aave V3 price
oracle. Listed Spark leftover
oracle rows are exhausted.
X Layer
`SPARK_SAVINGS_INTENTS`
`0x5bCD…1865` (Sourcify)
is logged. GammaSwap May
2026 vault + PositionManager
and 2024 factory +
DeltaSwap (Sourcify) plus
staking / GS token proxy
`0xb08d…3e83` +
`GSTimelockController`
`0x3f7c…73f8` + airdrop
`0x4c02…0f98` (Sourcify;
listing labels swapped)
are logged. Listed
GammaSwap Solidity is
exhausted.
KeeperHub #2105 is claimed by
`tenk-earn` PR #2275
(do not duplicate).
Immunefi ENS audit
competition (web-only,
KYC, ends 14 Sep) is
out of this track.
Zest Protocol V2
`v0-6-market` +
market-vault + sBTC vault
(`f2fce52` / Hiro) plus
DAO executor / multisig /
treasury and the zvstBTC
strategy vault / engine /
ops / state (`f2fce52`)
are logged. Listed Zest
Clarity leftover is
exhausted. StackingDAO
`stacking-dao-core-stbtc-v1`
+ `stacking-dao-core-stx-v2`
+ `stacking-dao-core-ststxbtc-v2`
plus stBTC token / reserve /
data and STX reserve / data
(Hiro, 13 Aug 2026 assets)
are logged. StackingDAO
strategy-v6 + STX/sBTC
stakers + commission +
rewards-stx plus
native-pool / signer-
managers / payout /
admin are logged.
Listed StackingDAO
Clarity leftover is
exhausted.
Next
unreviewed Immunefi
GitHub-or-recent trees:
Olympus V1Migrator + Cooler
V2 + CCIP + CD Facility +
DepositManager /
RedemptionVault /
Clearinghouse / Heart +
Governor Bravo / Timelock +
BondTeller / BondCallback /
BondManager + CD Auctioneer
/ LimitOrders + Cooler
factory / LTV / Treasury
Borrower / Composites +
RANGE / YRF / CHREG /
RGSTY / DLGTE / RolesAdmin
(`3f918a0`) are logged.
Olympus leftover CDEPO
`0x0233…9F1c` is the
DEPOS
`OlympusDepositPositionManager`
in `3f918a0` and is
logged. Spark 15
Jul Ethereum `UsdcVault` +
L2 `UsdcVaultL2` are
logged. Sky StarGuard
(`707c84d`) +
SubProxyMethods
(`8ab9daf`) +
DefaultPAUAssembler
(`c13e80f`) +
AdministeredAgent
(`5e6b52f`) are logged.
Remaining Sky leftover
`sky-oapp-oft` + LZ/OP
relays + Optimism /
Arbitrum / Starknet
DAI-bridges are logged
below. Listed Sky
leftover that a public
tree would open is
exhausted.
Yearn Accountant
`0x5A74…DE69` (Sourcify)
plus 3.0.4 Tokenized
Strategy `0xD377…139c`
and 3.0.4 Vault V3
`0xd806…00d` (Sourcify)
are logged. Listed
Yearn leftover impls
are exhausted. 
Twyne June-2026 Aave V3
operators (Sourcify) are logged;
remaining Twyne vaults /
wrappers / EVC / factories are
still Sourcify 404. TermMax TMX
token (Sourcify BSC `MyOFT`)
is logged; remaining TermMax
adapters are logged
below. Yearn stYFI
July leftover + February
StakedYFI / LL depositor
(`69e262e`) plus leftover
stYFIx / middleware / main
RewardDistributor (Sourcify)
and leftover LL redemption /
LL+veYFI distributors
(`69e262e`) plus Vault /
TokenizedStrategy /
Factory V3.1.0 (Sourcify)
plus leftover Jan 2026
yYB token / operator /
locker / staker /
distributor (Sourcify)
plus AuctionFactory
`0xbC58…7526` (Sourcify)
plus splitter factory
`0xe28f…614D` + ORIGINAL
impl `0x8e8e…6f69` and
3.0.4 Vault Factory
`0x770D…812F` (Sourcify)
plus Accountant
`0x5A74…DE69` (Sourcify)
plus 3.0.4 Tokenized
Strategy `0xD377…139c`
and 3.0.4 Vault V3
`0xd806…00d` (Sourcify)
are logged. Listed
Yearn leftover impls
are exhausted.
Balancer V3
Router + CompositeLiquidityRouter
+ ProtocolFeeController +
LBPoolFactory + ReClamm +
LP oracle factories (23 Jun,
Sourcify) plus leftover
Sourcify-404 factories
(FixedPrice LBP / Gyro2CLP /
GyroECLP / StableSurge /
Weighted / Stable, official
monorepo `create()` only)
are logged. Remaining
Lista leftover slices (new-contracts
oracles / VeLista lock / airdrop /
CDP ResilientOracle + pips at
`3e120da`) are logged.
Jito `jito-solana` /
`mev-programs` ($250k, KYC; interceptor
`dbd8ce4` and restaking `vault_*` /
`restaking_*` at `db90840` are exhausted).
Superteam API rechecked ~04:34 UTC
3 Sep: still 28 open listings
(`earn.superteam.fun/api/listings?status=open`).
`AGENT_ALLOWED` is still only Steve Arena and ZNS —
do not execute. Mermail skill is built
(`mermail-onchain-receipts/`); remaining work is the
participant's PR, Mermail MCP, and X demo. T3N Vendor
Receipts is built (`t3n-vendor-receipts/`); remaining
work is Terminal 3 SSO. NectarFi is a creator campaign.
Manic $1k bug bounty is `HUMAN_ONLY`.
the402.ai still paused. 1inch Fusion settlement /
whitelist / PowerPod / KycNFT and FeeTaker are exhausted.
1inch token-plugins + farming leftover
(`9b6de97` / `b1fca09`) is logged;
1inch cross-chain-swap leftover
(`ada243b`) is logged;
1inch Solana CCS + Fusion leftover
(`58b8a42` / `0768267`) is logged
(listed 1inch SmartContracts
leftover exhausted).
Lido `lido-l2` + circuit-breaker +
vesting-escrow + stonks leftover
(`badf17c` / `6829a5a` / `580f802` /
`a7812a4`) is logged.
Lido `lido-l2-with-steth` leftover
(`4fec842`) is logged.
Lido dual-governance Escrow leftover
(`ba9dfc9`) is logged.
Lido dual-governance submit /
timelock leftover (`ba9dfc9`) is
logged.
Lido dual-governance committees
leftover (`ba9dfc9`) is logged
(remaining dual-governance is
TiebreakerSubCommittee /
tiebreaker wrappers).
Lido CSM bond leftover
(`2824e21`) is logged.
Lido CSM gates leftover
(`2824e21`) is logged.
Lido easy-track leftover
(`3183d1f`) is logged.
Lido governance-crosschain-bridges
leftover (`659e236`) is logged.
Lido aragon-apps leftover
(`e44f928`) is logged.
Lido aave-delivery-infrastructure
leftover (`27e7d4e`) is logged.
Lido mev-boost-relay leftover
(`47211c6`) is logged.
Lido aave-delivery adapters
leftover (`27e7d4e`) is
logged (listed Lido
aave-delivery leftover
exhausted).
Lido easy-track leftover
factories leftover
(`3183d1f`) is logged
(listed easy-track leftover
factories exhausted).
Lido aragon-apps Voting leftover
(`e44f928`) is logged.
Lido aragon-apps Agreement leftover
(`e44f928`) is logged
(remaining aragon-apps leftover
exhausted).
Nexus Mutual cover / pool /
staking leftover (`9e88562`) is
logged.
Nexus Mutual claims leftover
(`9e88562`) is logged.
Nexus Mutual leftover
modules leftover
(`9e88562`) is logged.
Nexus Mutual
governance leftover
(`9e88562`) is logged
(listed Nexus Mutual
GitHub leftover
exhausted).
Hydration DCA leftover
(`672e02f`) is logged.
Hydration pool leftover
(`672e02f`) is logged.
Hydration staking leftover
(`672e02f`) is logged.
Hydration EVM leftover
(`672e02f`) is logged.
Hydration leftover
pallets leftover
(`672e02f`) is logged.
Hydration leftover
adapters leftover
(`672e02f`) is logged
(listed Hydration leftover
that a public tree
would open is
exhausted).
Lido dual-governance Tiebreaker leftover
(`ba9dfc9`) is logged
(listed dual-governance leftover
exhausted).
Lido CSM leftover modules leftover
(`2824e21`) is logged
(listed CSM leftover modules
exhausted).
StakeWise Mainnet leftover
(Sourcify Pool / sETH2 / rETH2 /
Oracles / MerkleDistributor /
Vesting / genesis vault migrate)
is logged (remaining listed is
DAO Module Sourcify 404).
Rhino.fi deposit leftover
(Sourcify OP / BSC / ARB
`DVFDepositContract`) is logged
(remaining listed is zkEVM /
zkSync / Polygon impl Sourcify
404).
USDN leftover (Sourcify token /
wrap / protocol two-step /
farming / rebalancer) is logged.
USDN sUSDN VaultLib leftover is
logged (listed USDN leftover
exhausted).
IPOR leftover (Sourcify ipToken /
router / AmmStorage / AmmTreasury)
is logged (remaining listed is
AmmTreasury ETH impl Sourcify 404).
Vesper leftover (Sourcify Ethereum
+ Optimism `VPool` / `VETH`) is
logged (remaining listed is Base
vaults Sourcify 404).
dHEDGE leftover (Sourcify ETH / OP /
Base / Arb `PoolFactory`) is logged
(remaining listed is Polygon factory
Sourcify 404).
Velvet Capital leftover (Sourcify BSC
IndexSwap / Exchange / rebalance /
fee / Safe module / handlers) is
logged (remaining listed is two BSC
addresses Sourcify 404).
Mars Ecosystem leftover (Sourcify BSC
Core / factory / router / farm /
vesting / airdrop) is logged.
Mars Ecosystem leftover timelock
leftover (Sourcify BSC `Timelock`)
is logged (remaining listed is
`0x7859B01B…B576` Sourcify 404).
SushiSwap leftover RedSnwapper
leftover (Sourcify `exact_match`
`0xAC4c6e21…80b75`) is logged.
SushiSwap leftover CPAMM / CLAMM
leftover (Sourcify ETH V2 factory
/ router + V3 factory / NPM) is
logged (remaining listed is V3
TickLens / Quoter /
PositionHelper and same-bytecode
other-chain factories).
Aster leftover (Sourcify BSC
asBTC / USDF / asUSDF / AsBNB +
Earn / USDFEarn / asUSDFEarn /
WithdrawVault) is logged (listed
leftover that Sourcify opens is
exhausted; remaining listed is
the website).
Gamma leftover (Sourcify ETH
xGamma / Hypervisor / UniProxy)
is logged (listed leftover that
Sourcify opens is exhausted).
Beefy Finance leftover (Sourcify
Polygon `BeefyVaultV6` + common
chef / DFYN / Curve / BIFI-maxi
strategies) is logged.
Beefy leftover remaining Polygon
vaults leftover (Sourcify zaps +
Aave / Wault / Fish / Curve /
PZAP / Cometh / MiniChef /
RewardPool) is logged
(remaining listed is Sourcify
404 wexpoly / some Aave-Cometh
and same-type unsampled vaults).
Orca leftover (`3b47341` /
`05fe66b` xORCA + Whirlpools) is
logged (listed leftover
exhausted).
Threshold Bank leftover
(`502cd39`) is logged.
Threshold vault +
MaintainerProxy leftover
(`502cd39`) is logged.
Threshold watchtower +
Wormhole L1 leftover
(`502cd39`) is logged.
Threshold RebateStaking leftover
(`502cd39`) is logged.
Threshold validator +
ReimbursementPool leftover
(`502cd39`) is logged.
Threshold Bridge leftover
(`502cd39`) is logged.
Threshold leftover gov /
relay leftover
(`502cd39`) is logged.
Puffer Finance leftover
(Sourcify depositor +
pufETH vault) is logged.
Threshold leftover
wallet registry leftover
(Sourcify) is logged.
Threshold leftover
StarkNet depositor leftover
(`502cd39` Sourcify
`StarkNetBitcoinDepositor`
impl) is logged.
Threshold leftover L2
Wormhole gateway leftover
(Sourcify OP / Base / Arb /
Polygon `L2TBTC` /
`L2WormholeGateway` /
`L2BTCRedeemerWormhole`
plus Base/Arb upgraded
children) is logged
(remaining Threshold is
keep-network typescript,
Starkscan Cairo, and
Sui / Solana explorer
rows).
Aspida leftover (Sourcify
aETH / saETH / CorePrimary /
RewardOracle / StETHMinter)
is logged (listed leftover
exhausted at the five
Ethereum addresses).
Balancer Foundation leftover
V2 Vault + V3 BatchRouter
(Sourcify) is logged
(remaining Foundation-listed
is V3 Vault and other
unopened routers / helpers).
Arkadiko leftover (Hiro vaults /
tokens / liq-pool) is logged
(remaining listed is the website).
JustLend leftover (`f28f3b4`
Unitroller / Comptroller /
CToken mint-redeem-borrow-
liquidate) is logged.
JustLend leftover
governance leftover
(`f28f3b4` GovernorBravo /
WJST / Timelock /
PriceOracleProxy) is logged.
JustLend leftover rewards
leftover (`f28f3b4`
ComptrollerLegacy JST /
PriceOracleV1 / rate
models) is logged (listed
leftover that a public
tree would open is
exhausted; remaining
listed is other Tronscan
jToken markets).
Pareto Credit leftover
(`19e7cde` IdleCDO /
CreditVault / Tranche /
epoch request-claim) is
logged.
Pareto Credit leftover
strategy leftover
(`19e7cde`
IdleCreditVault receipt
/ APR=0) is logged.
Pareto Credit leftover
epoch admin leftover
(`19e7cde` startEpoch /
stopEpoch /
depositDuringEpoch) is
logged.
Pareto Credit leftover
queue leftover
(`19e7cde`
IdleCDOEpochQueue /
Prefunded) is logged.
Pareto Credit leftover
factory leftover
(`19e7cde` factory /
write-off escrow /
orchestrator / implied
price / programmable
borrower) is logged.
Pareto Credit leftover
wrappers leftover
(`19e7cde` TrancheWrapper /
IdleTokenWrapper /
wstETH Balancer /
Keyring) is logged.
Pareto Credit leftover
Fulcrum leftover (Sourcify
`IdleFulcrumV2` plus live
CDO / queue / strategy
impls of already-reviewed
types) is logged
(remaining listed is
Sourcify 404 docs
addresses).
Synthetix deposit leftover
(Blockscout
`SynthetixDepositContract` /
lens / PermissionsRegistry)
is logged (listed leftover
exhausted at the three
Ethereum addresses).
RootstockLabs RIF token leftover
(Sourcify `match` `RIFToken`)
is logged (KYC).
RootstockLabs leftover PegIn /
PegOut / Collateral (Blockscout)
is logged (KYC; Flyover leftover
exhausted at the opened-contract
level; remaining listed is
GitHub DLT / web).
Remaining OZ hooks: none of the money-moving
general/fee/base files. Leather still requires a
working PoC against the published store build; do not
file theoretical reports. USDT0’s 1 Sep add is Stellar
explorer, not a Solidity GitHub tree. Sherlock
`https://audits.sherlock.xyz/api/contests` is paginated
(301 items); page 1 as of ~04:10 UTC 3 Sep still shows
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
~05:20 UTC 3 Sep: KeeperHub #2105 still `open` +
`accepted` + `confirmed`, 1 comment and
PR #2275 (`tenk-earn`, `staging`, mergeable,
`mergeable_state: unstable`) — do not
duplicate; #2240 still `open` + `accepted`, 1
design comment (`edycutjong`), 0 PRs — do not
implement or claim; Twyne vaults / wrappers /
EVC / factories still Sourcify 404;
Uniswap/sdks#720 still `open`, 0 comments, 0 PRs;
Hedera Harness #8 still `open`, 0 comments;
CreditPassport deployer still 0 Sepolia ETH
(Tenderly `sepolia.gateway.tenderly.co`;
publicnode 403)
/ 0 tCTC
(`rpc.cc3-testnet.creditcoin.network`);
Superteam still 27 open listings,
`AGENT_ALLOWED` still only Steve Arena and ZNS;
Sherlock page 1 still only contest `1234` (Tare)
in `SHERLOCK_JUDGING`; no programs launched
Sep 2026 in the unofficial Immunefi dump;
one new listed SC since 2026-09-02
(RootstockLabs RIF token,
KYC, unofficial dump still
246 programs);
Olympus DEPOS / CDEPO is
logged (Sourcify still
404; official tree);
Sky StarGuard +
SubProxyMethods + PAU
assembler, Yearn
Accountant leftover, and
Yearn 3.0.4 Tokenized
Strategy + Vault V3
leftover are logged
(listed Yearn leftover
impls exhausted);
Sky PAUFactory + Kicker
+ `sky-oapp-oft` + LZ/OP
governance relays and
StackingDAO strategy /
native-pool / signers /
swap / rewards-pox5 are
logged; TermMax leftover
adapters (`e314f3f`) are
logged; Sky Optimism /
Arbitrum / Starknet
DAI-bridge leftover is
logged (listed Sky
leftover that a public
tree would open is
exhausted); listed
StackingDAO and
TermMax leftover
adapters are exhausted;
Lombard EVM strategy
shard / blocklist /
merkle validator /
converters (`7fe83e5`,
15 Jul leftover) are
logged;
Enzyme Onyx
`CreWorkflowConsumer`
(`7b48d24`) is logged;
Silo Finance V3 vaults,
core Actions, and
config / router /
leverage / hooks
(`silofinance-v2`,
`31b98b3`) are logged
(listed Silo GitHub
Solidity leftover
exhausted);
PancakeSwap Infinity
core / periphery /
universal-router
(`pancakeswap`,
`61cd131` / `8261f8d` /
`33dbf5a`) are logged;
Pancake V3 MasterChef /
LmPool + V2 periphery
(`9868479` / `d769a6d`)
and v3-core pool/factory
+ v3-periphery (`9868479`)
are logged (listed Pancake
GitHub leftover exhausted);
Mux3 core trade / pool /
orderbook (`8674f2b`) is
logged; Mux aggregator
proxyFactory + GmxV2 +
LendingPool (`0f36131`),
Mux degen pool
(`c5bfe81`), and Mux
protocol v1 core
(`0f70a70`) are logged
(remaining Mux listed
Solidity is mux-staking,
GitHub 404);
Threshold tBTC BOB
cross-chain leftover
(`502cd39`) is logged
Threshold Bank leftover
(`502cd39`) is logged;
Threshold vault +
MaintainerProxy leftover
(`502cd39`) is logged;
Threshold watchtower +
Wormhole L1 leftover
(`502cd39`) is logged;
Threshold RebateStaking leftover
(`502cd39`) is logged;
Threshold validator +
ReimbursementPool leftover
(`502cd39`) is logged;
Threshold Bridge leftover
(`502cd39`) is logged;
Threshold leftover gov /
relay leftover
(`502cd39`) is logged;
Threshold leftover
wallet registry leftover
(Sourcify) is logged.
Threshold leftover
StarkNet depositor leftover
(`502cd39` Sourcify
`StarkNetBitcoinDepositor`
impl) is logged.
Threshold leftover L2
Wormhole gateway leftover
(Sourcify OP / Base / Arb /
Polygon `L2TBTC` /
`L2WormholeGateway` /
`L2BTCRedeemerWormhole`
plus Base/Arb upgraded
children) is logged
(remaining Threshold is
keep-network typescript,
Starkscan Cairo, and
Sui / Solana explorer
rows);
Aspida leftover (Sourcify
aETH / saETH / CorePrimary /
RewardOracle / StETHMinter)
is logged (listed leftover
exhausted at the five
Ethereum addresses);
Balancer Foundation leftover
V2 Vault + V3 BatchRouter
(Sourcify) is logged
(remaining Foundation-listed
is V3 Vault and other
unopened routers / helpers);
Pancake MasterChefV3 +
LmPool + V2 periphery
and v3-core / v3-periphery
(`9868479` / `d769a6d`)
are logged (listed Pancake
GitHub leftover exhausted);
Obyte Coop AA
(`d7d5e57`), Friends AA
(`45019f9`),
prediction-markets AA
(`1292a09`), and
Counterstake EVM+AA
claim path and
assistants / factories /
governance (`530fb8b`)
are logged (listed
Counterstake leftover
exhausted; `evm-v1.0` is
the old pin; City AA
(`4a0a53f`) and perpetual
AA (`126cdd0`) and OSWAP
token AA (`461e860`) are
logged; cascading-
donations AA (`2f48482`)
and token-registry AA
(`8d37f20`) are logged
(listed Obyte AAs
exhausted);
MtPelerin bridge-v2
core + leftover wrappers
/ KYC rules (`1126cfc`)
are logged (listed
MtPelerin GitHub
Solidity leftover
exhausted);
Orderly Vault, Ledger
withdraw, Operator / Fee
/ Market + LedgerImpl
B/C/D (`462e129`), and
`evm-cross-chain`
(`9a8ba76`) are logged
(listed Orderly GitHub
leftover exhausted);
Compound Finance PR 127 /
2.9 (`ae4388e`) is logged
(listed Compound GitHub
leftover exhausted;
remaining assets are
explorer addresses +
PoI);
Raydium CLMM leftover
(`ed7c84a`) plus classic
AMM leftover (`27f461d`)
plus cp-swap leftover
(`244e124`) are logged
(listed Raydium GitHub
leftover exhausted);
Marinade liquid-staking
leftover (`b8fe3f8`) is
logged; Marinade crank /
withdraw-stake leftover
and admin / validator /
update leftover
(`b8fe3f8`) are logged
and create-canonical /
realloc leftover
(`b8fe3f8`) are logged
(listed Marinade GitHub
leftover exhausted);
Instadapp DSA leftover
(`fef062a`) is logged
and Avocado leftover
(`0bc1dd9`) is logged;
Instadapp Fluid
liquidity + fToken leftover
(`a9949b4`) is logged;
Instadapp Fluid vault T1 leftover
(`a9949b4`) is logged;
Instadapp Fluid vault T2–T4 leftover
(`a9949b4`) is logged;
Instadapp Fluid DEX T1 leftover
(`a9949b4`) is logged;
Instadapp Fluid dexLite leftover
(`a9949b4`) is logged;
Instadapp Fluid stETH leftover
(`a9949b4`) is logged;
Instadapp inst-governance leftover
(`3fc54af`) is logged
(listed Instadapp leftover
exhausted);
Gnosis Chain tokenbridge +
Omnibridge leftover
(`908a481` / `c814f68`,
Sourcify proxy + official
money path) is logged
(listed leftover
exhausted; remaining is
AMB / other tokenbridge
trees if Immunefi lists
them later);
Ankr ETH pool + liquid
tokens leftover (Sourcify
`GlobalPool_R46` /
`AETH_R21` / `FETH_R20` /
`aBNBc_R1`) is logged
(remaining Ankr is BNB
Pool / BNBStakingConfig
Sourcify 404);
UTIX crowdsale leftover
(Sourcify `exact_match`
`MintedTokenCappedCrowdsaleExtv1`)
is logged (listed leftover
exhausted);
Rocket Pool v1.4 deposit
/ rETH / megapool queue,
dissolve / rewards /
exit, vault + RPL
auction, smoothing /
rewards leftover,
minipool leftover, and
DAO settings / voting
(`fb7d9c4`) are logged
(listed Rocket Pool
GitHub leftover
exhausted);
Beanstalk Basin leftover
(Pipeline / Depot / Well
/ Aquifer / CP2 / MFP,
Sourcify + `ecf6923`) is
logged. Beanstalk L2
diamond + tokens
leftover (`8e22cd2`,
Sourcify `exact_match`)
is logged. Beanstalk
Junctions / UnwrapETH /
LSD / marketplace
leftover (`8e22cd2`,
Sourcify `exact_match`)
is logged (listed
Beanstalk leftover
exhausted aside from
Fertilizer proxy
Sourcify 404);
Flux Finance leftover
(Sourcify `exact_match`
Unitroller / fToken
delegator / Ondo
oracle) is logged.
Flux Comptroller / KYC
cToken / Governor Bravo
implementation leftover
(Sourcify `exact_match`)
is logged (listed Flux
leftover exhausted);
Mantle mETH staking leftover
(Sourcify `Staking` / `METH` /
UnstakeRequestsManager /
Oracle / ReturnsAggregator)
is logged (remaining mETH is
L2 token + Pauser impl
Sourcify 404 and unlisted
LiquidityBuffer);
eBTC Boost leftover
(`c9b95ac`, listed
`release-0.7` files)
is logged (listed eBTC
Boost GitHub leftover
exhausted);
Aevo deposit leftover
(Sourcify Arb `Vault` + ETH
`L1ChugSplashProxy`) is logged.
Aevo ETH ChugSplash
implementation leftover is
logged (listed Aevo leftover
exhausted);
Lido core submit /
withdrawal leftover
(`2da0f48`) is logged.
Lido StakingRouter leftover
(`2da0f48`) is logged.
Lido `lido-l2` +
circuit-breaker +
vesting-escrow + stonks
leftover is logged.
Lido `lido-l2-with-steth`
leftover (`4fec842`) is
logged.
Lido 0.8.25 vault leftover
(`2da0f48`) is logged.
Lido dual-governance Escrow
leftover (`ba9dfc9`) is
logged. Lido dual-governance
submit / timelock leftover
is logged. Lido
dual-governance committees
leftover is logged.
Lido CSM bond leftover
(`2824e21`) is logged.
Lido CSM gates leftover
(`2824e21`) is logged.
Lido easy-track leftover
(`3183d1f`) is logged.
Lido governance-crosschain-bridges
leftover (`659e236`) is logged.
Lido aragon-apps leftover
(`e44f928`) is logged.
Lido aave-delivery-infrastructure
leftover (`27e7d4e`) is logged.
Lido mev-boost-relay leftover
(`47211c6`) is logged.
Lido aave-delivery adapters
leftover (`27e7d4e`) is
logged (listed Lido
aave-delivery leftover
exhausted).
Lido easy-track leftover
factories leftover
(`3183d1f`) is logged
(listed easy-track leftover
factories exhausted).
Lido aragon-apps Voting leftover
(`e44f928`) is logged.
Lido aragon-apps Agreement leftover
(`e44f928`) is logged
(remaining aragon-apps leftover
exhausted).
Nexus Mutual cover / pool /
staking leftover (`9e88562`) is
logged.
Nexus Mutual claims leftover
(`9e88562`) is logged.
Nexus Mutual leftover
modules leftover
(`9e88562`) is logged.
Nexus Mutual
governance leftover
(`9e88562`) is logged
(listed Nexus Mutual
GitHub leftover
exhausted).
Hydration DCA leftover
(`672e02f`) is logged.
Hydration pool leftover
(`672e02f`) is logged.
Hydration staking leftover
(`672e02f`) is logged.
Hydration EVM leftover
(`672e02f`) is logged.
Hydration leftover
pallets leftover
(`672e02f`) is logged.
Hydration leftover
adapters leftover
(`672e02f`) is logged
(listed Hydration leftover
that a public tree
would open is
exhausted).
Lido dual-governance Tiebreaker leftover
(`ba9dfc9`) is logged
(listed dual-governance leftover
exhausted).
Lido CSM leftover modules leftover
(`2824e21`) is logged
(listed CSM leftover modules
exhausted);
StakeWise Mainnet leftover
(Sourcify Pool / sETH2 /
rETH2 / Oracles /
MerkleDistributor /
Vesting / genesis vault
migrate) is logged
(remaining listed is DAO
Module Sourcify 404);
Rhino.fi deposit leftover
(Sourcify OP / BSC / ARB
`DVFDepositContract`) is
logged (remaining listed
is zkEVM / zkSync /
Polygon impl Sourcify
404);
USDN leftover (Sourcify
token / wrap / protocol
two-step / farming /
rebalancer) is logged.
USDN sUSDN VaultLib leftover
is logged (listed USDN
leftover exhausted);
IPOR leftover (Sourcify
ipToken / router /
AmmStorage / AmmTreasury)
is logged (remaining listed
is AmmTreasury ETH impl
Sourcify 404);
Vesper leftover (Sourcify
Ethereum + Optimism `VPool`
/ `VETH`) is logged
(remaining listed is Base
vaults Sourcify 404);
dHEDGE leftover (Sourcify
ETH / OP / Base / Arb
`PoolFactory`) is logged
(remaining listed is
Polygon factory Sourcify
404);
Velvet Capital leftover
(Sourcify BSC IndexSwap /
Exchange / rebalance /
fee / Safe module /
handlers) is logged
(remaining listed is two
BSC addresses Sourcify
404);
Mars Ecosystem leftover
(Sourcify BSC Core /
factory / router / farm /
vesting / airdrop) is
logged;
Mars Ecosystem leftover
timelock leftover
(Sourcify BSC `Timelock`)
is logged (remaining
listed is `0x7859B01B…B576`
Sourcify 404);
SushiSwap leftover
RedSnwapper leftover
(Sourcify `exact_match`
`0xAC4c6e21…80b75`) is
logged;
SushiSwap leftover
CPAMM / CLAMM leftover
(Sourcify ETH V2 factory
/ router + V3 factory /
NPM) is logged
(remaining listed is V3
TickLens / Quoter /
PositionHelper and
same-bytecode other-chain
factories);
Aster leftover (Sourcify
BSC asBTC / USDF / asUSDF
/ AsBNB + Earn / USDFEarn
/ asUSDFEarn /
WithdrawVault) is logged
(listed leftover that
Sourcify opens is
exhausted; remaining
listed is the website);
Gamma leftover (Sourcify
ETH xGamma / Hypervisor /
UniProxy) is logged
(listed leftover that
Sourcify opens is
exhausted);
SPOT leftover (Sourcify
ETH PerpetualTranche /
RouterV1 / BondFactory /
BondIssuer) is logged
(listed leftover that
Sourcify opens is
exhausted; remaining
listed is the website);
DeGate leftover (Sourcify
ETH Timelock /
DepositContract /
ExchangeV3 / MultiSig)
is logged (listed leftover
that Sourcify opens is
exhausted);
boost-lido leftover
(Sourcify ETH DVV /
StakingModule /
SimpleDVTStakingStrategy)
is logged (listed leftover
that Sourcify opens is
exhausted);
alchemix-boost leftover
(`f100743` veALCX /
RevenueHandler /
RewardsDistributor) is
logged (listed leftover
that a public tree would
open is exhausted;
remaining listed is the
website);
GMX leftover (Sourcify Arb
Vault / Router /
GlpManager /
RewardRouterV2) is logged.
GMX leftover V2
ExchangeRouter leftover
(Sourcify Arb
ExchangeRouter /
DepositVault / DataStore)
is logged (remaining listed
is Avax twins, V1 trackers
/ vesters, and V2 Oracle /
Reader rows);
Kelp DAO leftover (Sourcify
deposit / withdraw; KYC)
is logged (remaining listed
is the website Restaking
page);
Aera leftover (Sourcify Base
MultiDepositorVault /
Provisioner; KYC) is logged
(listed leftover exhausted
at the opened-contract
level);
SSV Network leftover
(Sourcify Network / Views;
KYC) is logged (listed
leftover exhausted at the
opened-contract level);
Derive leftover matching +
cash leftover (`f6c20f4` /
`96796a6` Deposit /
Withdrawal / Transfer /
Trade / Matching +
CashAsset) is logged.
Derive leftover auction +
security leftover
(`96796a6` DutchAuction /
SecurityModule) is logged.
Derive leftover assets leftover
(`96796a6` WrappedERC20 /
Option / Perp) is logged
(remaining listed is
StandardManager / PMRM /
feeds);
Royco leftover (Sourcify
factory + Makina strategy;
KYC) is logged (remaining
listed is srRoyUSDC /
Multisig Strategy Sourcify
404);
zerolend-boost leftover
(`60d255a` locker /
omnichain staking /
VestedZeroNFT /
AirdropRewarder /
PoolVoter) is logged
(ended 2024-03-14
audit-comp; listed
leftover that a public
tree would open is
exhausted; remaining
listed is zkSync /
Manta Aave-fork
Sourcify 404);
GMX leftover V1
RewardTracker leftover
(Sourcify Arb
RewardTracker /
RewardDistributor /
BonusDistributor /
Vester / EsGMX) is
logged (remaining listed
is Avax twins,
Sourcify-404 Glp Vester
/ Staked Glp
Distributor, and V2
Oracle / Reader rows);
SSV Network leftover
(Sourcify Network /
Views / Clusters /
Operators / Staking;
KYC) is logged
(listed leftover
exhausted at the
opened-contract level);
CapyFi leftover (Sourcify
Comptroller / CEther /
CErc20; KYC) is logged
(remaining listed is
Unitroller Sourcify 404
and same-type other-market
CErc20Delegate impls);
Beefy Finance leftover
(Sourcify Polygon
`BeefyVaultV6` + common
chef / DFYN / Curve /
BIFI-maxi strategies) is
logged.
Beefy leftover remaining
Polygon vaults leftover
(Sourcify zaps + Aave /
Wault / Fish / Curve /
PZAP / Cometh / MiniChef /
RewardPool) is logged
(remaining listed is
Sourcify 404 wexpoly /
some Aave-Cometh and
same-type unsampled
vaults);
Orca leftover (`3b47341` /
`05fe66b` xORCA +
Whirlpools) is logged
(listed leftover
exhausted);
Arkadiko leftover (Hiro
vaults / tokens /
liq-pool) is logged
(remaining listed is the
website);
JustLend leftover
(`f28f3b4` Unitroller /
Comptroller / CToken
mint-redeem-borrow-
liquidate) is logged.
JustLend leftover
governance leftover
(`f28f3b4` GovernorBravo /
WJST / Timelock /
PriceOracleProxy) is logged.
JustLend leftover rewards
leftover (`f28f3b4`
ComptrollerLegacy JST /
PriceOracleV1 / rate
models) is logged (listed
leftover that a public
tree would open is
exhausted; remaining
listed is other Tronscan
jToken markets);
Pareto Credit leftover
(`19e7cde` IdleCDO /
CreditVault / Tranche /
epoch request-claim) is
logged;
Pareto Credit leftover
strategy leftover
(`19e7cde`
IdleCreditVault receipt
/ APR=0) is logged;
Pareto Credit leftover
epoch admin leftover
(`19e7cde` startEpoch /
stopEpoch /
depositDuringEpoch) is
logged;
Pareto Credit leftover
queue leftover
(`19e7cde`
IdleCDOEpochQueue /
Prefunded) is logged;
Pareto Credit leftover
factory leftover
(`19e7cde` factory /
write-off escrow /
orchestrator / implied
price / programmable
borrower) is logged;
Pareto Credit leftover
wrappers leftover
(`19e7cde` TrancheWrapper /
IdleTokenWrapper /
wstETH Balancer /
Keyring) is logged;
Pareto Credit leftover
Fulcrum leftover (Sourcify
`IdleFulcrumV2` plus live
CDO / queue / strategy
impls of already-reviewed
types) is logged
(remaining listed is
Sourcify 404 docs
addresses);
Synthetix deposit leftover
(Blockscout
`SynthetixDepositContract` /
lens / PermissionsRegistry)
is logged (listed leftover
exhausted at the three
Ethereum addresses);
RootstockLabs RIF token leftover
(Sourcify) is logged (KYC).
RootstockLabs leftover PegIn /
PegOut / Collateral (Blockscout)
is logged (KYC; Flyover leftover
exhausted at the opened-contract
level; remaining listed is
GitHub DLT / web);
Beets stS
(`877087b`) + token
leftover is logged
(migrator Sourcify 404);
Yearn YFI token leftover
is logged (yvUSD / Woofy
still Sourcify 404);
Benqi Dual Oracle leftover
is logged. Benqi core
markets leftover
(unitroller / qiAVAX /
qiUSDC / Maximillion,
Sourcify `match` +
`e0cfd24`) is logged.
Benqi QI token leftover
is logged. Benqi token-
sale leftover
(`exact_match` +
`e0cfd24`) is logged.
Benqi PGL staking
leftover (`match` +
`e0cfd24`) is logged
(remaining Benqi is
isolated unitroller
Sourcify 404 / gauges /
sAVAX / veQI proxy-only
/ Ignite / MultiReward /
JumpRateModel / Pause
Guardian / sAVAX
timelock / JLP staking
Sourcify 404; listed
Sourcify-open leftover
exhausted);
Harvest vault / controller
leftover (`0364901`) and
4626 / Dolomite lend
leftover and Convex /
Aura / Aave fold leftover
and Penpie / Notional /
StakeDAO / Yel leftover
and ZeroLend /
CompoundV3 / Idle
leftover and inactive /
MorphoVault V2 / sDAI /
StakeDAO lend / cvxCRV
leftover and polygon
CompoundBlue / chef
leftover (`f24a06a`)
and polygon
Aave / Aura / Balancer /
Convex / Idle leftover
(`f24a06a`) and polygon
Gamma / Pearl / Meshswap
leftover (`f24a06a`)
and polygon Jarvis /
Complifi / Compound /
Yel leftover
(`f24a06a`) are logged
and Arbitrum Camelot /
Silo / Venus leftover
(`125270d`) are logged
(listed Harvest GitHub
leftover exhausted);
ICHI oneToken leftover
(`4873873`) is logged;
Yearn yCRV token +
Boosted Staker /
distributor leftover
is logged (yvUSD still
Sourcify 404);
Hermetica hBTC vault
leftover is logged
(listed Clarity
exhausted);
Twyne vaults / wrappers /
EVC / factories still
Sourcify 404 (lowercase
recheck ~05:35 UTC);
CoW GPv2 leftover
(`6ebbd81`, all 19
listed blobs) is logged
(listed CoW GitHub
leftover exhausted);
Stader ETHx user deposit
/ withdraw leftover
(`9d4a921`) plus oracle /
factory / insurance /
auction / socializing
plus registries / vaults
/ SD / pools plus Penalty
/ PoolSelector /
PoolUtils / Config
leftover is logged
(listed Stader leftover
exhausted; remaining row
is Primacy of Impact);
Symbiosis MetaRouter +
Gateway leftover
(Sourcify Ethereum
`exact_match`) is
logged (listed
Symbiosis leftover
exhausted);
GammaSwap listed leftover (factory /
DeltaSwap / staking / GS / timelock /
airdrop) is exhausted;
official CTC HTML still blocked by DoraHacks “Human
Verification” (last good count 47 BUIDLs / 203 hackers,
deadline 13 Sep 2026 23:59 ET). No KeeperHub
implementation before the 6 Sep build window. No
ETHOnline project code before 4 Sep 16:00 UTC.

## 2026-09-03: Nexus Mutual leftover modules leftover (`9e88562`)

Immunefi program
`Nexus Mutual`
($25,000, `kyc: false`).
Cover / pool / staking
and Claims / Assessments /
Ramm / LimitOrders /
CoverBroker leftovers
are already logged.
This slice is leftover
modules plus TokenController,
CoverProducts, SwapOperator,
SafeTracker, and NXMToken.
Local clone
`/tmp/nexusmutual` at
`9e88562` (“feat: symbiotic
setup and slash tests
(#1507)”). No mainnet
interaction.

Files:
`contracts/modules/legacy/LegacyClaimProofs.sol`,
`contracts/modules/legacy/LegacyMCR.sol`,
`contracts/modules/legacy/LegacyAssessment.sol`,
`contracts/modules/legacy/LegacyClaimsData.sol`,
`contracts/modules/legacy/LegacyMemberRoles.sol`,
`contracts/modules/token/TokenController.sol`,
`contracts/modules/token/NXMToken.sol`,
`contracts/modules/cover/CoverProducts.sol`,
`contracts/modules/capital/SwapOperator.sol`,
`contracts/modules/capital/SafeTracker.sol`.

Checked for: a
stranger
`unstakeAllForBatch`
that steals NXM;
`withdrawRewards` to
the caller;
`mint` / `operatorTransfer`
without a listed
module; `placeOrder`
without a governor
swap request;
`transferAssetToSafe`
from a stranger;
`setProducts` without
the advisory board.

Result: no
user-exploitable
finding. Not
submitted.

- `LegacyClaimProofs.addProof`
  only emits
  `ProofAdded`.
- `LegacyMCR.updateMCR`
  is permissionless
  and only writes
  the MCR snapshot.
  `updateMCRInternal`
  is `onlyInternal`.
- `LegacyAssessment.stake`
  pulls NXM from
  `msg.sender`.
  `unstake` pays
  `to` from the
  caller’s stake.
  `unstakeAllFor` is
  TokenController
  only.
  `unstakeAllForBatch`
  is permissionless
  but always pays
  each listed
  staker, not the
  caller.
  `STAKE_LOCKUP_PERIOD`
  is a view-only
  leftover constant
  and is not a
  theft path.
  `withdrawRewards`
  mints to the
  staker.
  `withdrawRewardsTo`
  mints to a
  destination chosen
  by the staker.
  `startAssessment`
  is `onlyInternal`.
  `castVotes` is
  `onlyMember`.
  `submitFraud` is
  governance.
  `processFraud`
  needs a stored
  merkle root.
- `LegacyClaimsData`
  writers are
  `onlyInternal`
  except
  `setUserClaimVotePausedOn`
  and
  `updateUintParameters`,
  which require
  governance.
- `LegacyMemberRoles.switchMembership`
  moves the caller’s
  NXM to
  `newAddress`.
  `migrateMembers`
  only copies
  already-stored
  members into the
  registry.
  `recoverETH` sends
  ETH to the Pool.
- TokenController
  `operatorTransfer`
  is Cover only.
  `burnFrom` is
  Cover / Ramm.
  `mint` is Ramm
  only and only
  to a member.
  `switchMembership`
  is Registry only.
  `withdrawNXM`
  calls
  `stakingPool.withdraw`
  with the caller’s
  token ids.
  Ownership offers
  are the current
  manager / proposed
  manager.
  Reward and stake
  mint / burn /
  deposit / withdraw
  are the matching
  staking pool.
- NXMToken `mint` /
  `operatorTransfer` /
  whitelist writes
  are `onlyOperator`.
  `burn` burns
  `msg.sender`.
  `burnFrom` uses
  allowance.
- CoverProducts
  product / type
  writes are
  `onlyAdvisoryBoard`.
- SwapOperator
  `requestAssetSwap`
  is Governor.
  `placeOrder` /
  `closeOrder` /
  Enzyme swaps /
  `recoverAsset` are
  `onlyController`.
  Supported recoveries
  go to the Pool.
- SafeTracker
  `updateCoverReInvestmentUSDC`
  is the Safe.
  `transferAssetToSafe`
  is Governor.
  `transfer` /
  `transferFrom` only
  emit when
  `amount == 0` or
  the caller is the
  Pool.

Not submitted.
Remaining Nexus
listed GitHub:
governance leftover
is logged (listed
Nexus Mutual GitHub
leftover exhausted).

## 2026-09-03: Nexus Mutual governance leftover (`9e88562`)

Immunefi program
`Nexus Mutual`
($25,000, `kyc: false`).
Cover / pool / staking,
claims, and leftover
modules leftovers are
already logged. This
slice is governance
plus CoverNFT /
StakingNFT / viewers.
Local clone
`/tmp/nexusmutual` at
`9e88562`. No mainnet
interaction.

Files:
`contracts/modules/governance/Governor.sol`,
`contracts/modules/governance/Registry.sol`,
`contracts/modules/governance/NXMaster.sol`,
`contracts/modules/governance/TemporaryGovernance.sol`,
`contracts/modules/governance/VotePower.sol`,
`contracts/modules/governance/Governance.sol`,
`contracts/modules/governance/UpgradeableProxy.sol`,
`contracts/modules/cover/CoverNFT.sol`,
`contracts/modules/cover/CoverViewer.sol`,
`contracts/modules/cover/CoverNFTDescriptor.sol`,
`contracts/modules/staking/StakingNFT.sol`,
`contracts/modules/assessment/AssessmentLib.sol`.

Checked for: a
stranger
`join` without KYC
that drains the
Pool; `execute` that
runs unpassed
transactions;
`migrate` /
`migrateMembers`
from a random
caller; CoverNFT
`mint` without the
operator.

Result: no
user-exploitable
finding. Not
submitted.

- `join` needs the
  exact `JOIN_FEE`
  and a KYC-auth
  EIP-712
  signature. Fee
  goes to the Pool.
- `switchTo` moves
  the caller’s
  membership.
  `switchFor` is
  MemberRoles only.
  `leave` is the
  member and cannot
  be an AB seat.
- Pause propose /
  confirm needs two
  different
  emergency admins.
  Contract deploy /
  upgrade / add /
  remove and AB
  swap are
  Governor.
- `Registry.migrate`
  and
  `NXMaster.migrate`
  /
  `transferOwnershipToRegistry`
  are the live GV
  address.
  `migrateMembers`
  is MemberRoles.
- `Governor.propose`
  is AB.
  `proposeAdvisoryBoardSwap`
  is a member over
  the threshold.
  `execute` is
  permissionless
  after the
  timelock only if
  For > Against and
  quorum /
  threshold hold.
  AB execute still
  requires an AB
  caller.
- `TemporaryGovernance.execute`
  is the AB
  multisig.
- Legacy
  `Governance.createProposal`
  is a member.
  `triggerAction`
  is
  permissionless
  after Accepted +
  wait. `rejectAction`
  is AB.
- CoverNFT `mint` is
  operator.
  Transfers need
  owner or
  approval.
  StakingNFT `mint`
  is the matching
  staking pool.
- VotePower,
  CoverViewer,
  CoverNFTDescriptor,
  and AssessmentLib
  are views /
  metadata.

Not submitted.
Listed Nexus Mutual
GitHub leftover is
exhausted.

## 2026-09-03: Hydration leftover pallets leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
DCA, pool, staking,
and EVM leftovers are
already logged. This
slice is leftover
listed pallets:
omnipool / XYK
liquidity-mining,
liquidation,
otc-settlements,
dispatcher, NFT,
asset-registry, and
collator-rewards.
Local sparse clone
`/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/omnipool-liquidity-mining/src/lib.rs`,
`pallets/xyk-liquidity-mining/src/lib.rs`,
`pallets/liquidation/src/lib.rs`,
`pallets/otc-settlements/src/lib.rs`,
`pallets/dispatcher/src/lib.rs`,
`pallets/nft/src/lib.rs`,
`pallets/asset-registry/src/lib.rs`,
`pallets/collator-rewards/src/lib.rs`,
`pallets/broadcast/src/lib.rs`.

Checked for: a
stranger
`claim_rewards` on
someone else's
deposit NFT;
`liquidate` that
pays the caller
from a healthy
position;
`dispatch_as_treasury`
from a random
origin.

Result: no
user-exploitable
finding. Not
submitted.

- Omnipool / XYK
  LM farm create is
  `CreateOrigin`.
  `deposit_shares`
  locks the
  signer's LP
  position / shares.
  `claim_rewards`
  and withdraws
  require
  `ensure_nft_owner`.
- Liquidation
  `liquidate` is
  permissionless
  and runs the
  money-market
  liquidation path.
  `set_borrowing_contract`
  is
  `AuthorityOrigin`.
- `settle_otc_order`
  fills through the
  pallet account
  and requires min
  profit.
- Dispatcher
  treasury / Aave
  / emergency
  wrappers are
  their matching
  origins.
- NFT `mint` is
  the collection
  owner.
  `transfer` /
  `burn` require
  the item owner.
- Asset-registry
  `register` is
  `RegistryOrigin`.
- Collator-rewards
  pays on session
  rotation.
  Broadcast is
  event context
  only.

Not submitted.
Remaining Hydration
listed GitHub:
leftover adapters leftover
is logged (listed
Hydration leftover that
a public tree would
open is exhausted).

## 2026-09-03: Hydration leftover adapters leftover (`672e02f`)

Immunefi program
`Hydration`
($222,222, `kyc: false`).
DCA, pool, staking,
EVM, and leftover
pallets leftovers are
already logged. This
slice is leftover
listed adapters /
fees / oracle /
tx-payment /
xcm-rate-limiter.
Local sparse clone
`/tmp/hydration-node`
at `672e02f`. No
mainnet interaction.

Files:
`pallets/dynamic-fees/src/lib.rs`,
`pallets/dynamic-evm-fee/src/lib.rs`,
`pallets/ema-oracle/src/lib.rs`,
`pallets/transaction-multi-payment/src/lib.rs`,
`pallets/transaction-pause/src/lib.rs`,
`pallets/xcm-rate-limiter/src/lib.rs`,
`runtime/adapters/src/lib.rs`,
`runtime/adapters/src/xcm_exchange.rs`,
`runtime/adapters/src/price.rs`.

Checked for: a
stranger
`set_asset_fee` or
`set_external_oracle`
that rewrites
prices; `set_currency`
that changes another
account; unsigned
`dispatch_permit`
without a valid
signature that
spends someone
else.

Result: no
user-exploitable
finding. Not
submitted.

- Dynamic-fees
  `set_asset_fee` /
  `remove_asset_fee`
  are
  `AuthorityOrigin`.
  Dynamic EVM fee
  has no public
  calls.
- EMA oracle
  whitelist /
  register /
  authorize writes
  are
  `AuthorityOrigin`.
  `set_external_oracle`
  needs
  `AuthorizedAccounts`
  for that
  `(source, pair)`.
- `set_currency`
  writes only the
  signer.
  `add_currency` /
  `remove_currency`
  /
  `reset_payment_currency`
  are
  `AcceptedCurrencyOrigin`.
  Unsigned
  `dispatch_permit`
  validates the
  permit first and
  charges `from`.
  Signed
  `dispatch_permit`
  is a paymaster
  and still
  validates the
  permit.
- Transaction-pause
  is `UpdateOrigin`.
  XCM rate-limiter
  has no
  extrinsics.
- Adapters are
  runtime hooks.
  `XcmAssetExchanger`
  trades from the
  configured temp
  account after the
  XCM executor
  deposits `give`.

Not submitted.
Listed Hydration
leftover that a
public tree would
open is exhausted.

## 2026-09-03: Aevo ETH ChugSplash implementation leftover (Sourcify)

Immunefi program
`Aevo` ($300,000,
`kyc: false`).
Deposit leftover
already logged the
ETH
`L1ChugSplashProxy`
`0x4082…c574` as
proxy-only. EIP-1967
implementation
`0xb37a11aadf167b2f0b8dd85372de4bc66cd4a891`
is now Sourcify
`match` `L1StandardBridge`
(solc 0.8.15,
`verifiedAt`
2026-06-17). Extract
`/tmp/aevo-l1bridge`.
Read-only `eth_getStorageAt`
on publicnode; no
other mainnet
interaction.

Files:
`src/L1/L1StandardBridge.sol`,
`src/universal/StandardBridge.sol`.

Checked for: a
stranger
`finalizeBridgeETH`
that pays the
caller; `depositERC20`
that pulls another
user without
allowance;
`finalizeBridgeERC20`
without the other
bridge.

Result: no
user-exploitable
finding. Not
submitted.

- `depositETH` /
  `depositETHTo` /
  `bridgeETH` take
  `msg.value` from
  the caller.
  `depositERC20` /
  `bridgeERC20` set
  `_from` to
  `msg.sender` and
  `transferFrom` /
  burn that sender.
- `finalizeBridgeETH`
  / `finalizeERC20`
  are
  `onlyOtherBridge`
  (`msg.sender` is
  the messenger and
  `xDomainMessageSender`
  is the other
  bridge). ETH pays
  `_to`. ERC20 mints
  or transfers to
  `_to`.
- `initialize` is
  initializer /
  proxy-admin owned.
  `paused` reads
  SuperchainConfig.

Do not file
messenger-trusted
finalize, documented
failed-L2-ETH lock,
or owner pause as
theft.

Not submitted.
Listed Aevo leftover
is exhausted.

## 2026-09-03: Beefy leftover remaining Polygon vaults leftover (Sourcify)

Immunefi program
`Beefy Finance`
($75,000, `kyc: false`).
First-30 Sourcify
sample leftover is
already logged. This
slice is later
Sourcify-open
Polygon vault /
strategy families
plus the six listed
zaps. Extract
`/tmp/beefy-remaining`.
No mainnet
interaction.

Listed Sourcify-open
this slice:
`BeefyUniV2Zap`
(`0x540a9f99bb730631bf243a34b19fd00ba8cf315c`
QuickSwap,
`0x872c9dce4b107042933afd51e8a704631f7ee076`
Cometh,
`0xf039fe26456901f863c873556f40fb207c6c9c18`
Sushi);
`BeefyZapUniswapV2`
(`0x0ea7b115d96c4df61b3e7d6757f0050f23492929`
Wault,
`0xaaa3477c6b326e2e416af7506a30f4519bc9960f`
ApeSwap,
`0x1a53c6fca349c23f573cedd3f8afe70c02ccec39`
DYFN);
`StrategyAave`
(`0x55a10618c7e9489cee047705cd003df6d9e09195`);
`StrategyAaveMatic`
(`0x57fdeb65b71e6ad212088e63e85825e314f2ea62`);
`StrategyAaveSupplyOnly`
(`0x8f755873546f4d0edf7d41ff8604c8a632113eb7`);
`StrategyWexPolyLP`
(`0x6a440102015bf4d81d56fbc2fd4f27797d183931`);
`StrategyWexPolySingle`
(`0xcb6e386ad643a6d77c940bf69303cebd34c04757`);
`StrategyFish`
(`0x53f816063523d9883c83863cbd5d8eaf9ffc4641`);
`StrategyCurveAave`
(`0x748f243931b841f2c4d6f298abb85d7a23fe7c2a`);
`StrategyPolyzapLP`
(`0x9e75f8298e458b76382870982788988a0799195b`);
`StrategyRewardPoolPolygonLP`;
`StrategyCommonMiniChefLP`;
`StrategyPolygonMiniChefLP`;
`StrategyCommonRewardPoolLP`
(`exact_match`
`0xa7377cdb25bfa2889b6e4c9463cd0858a57ab315`).
PZAP vault is
`BeefyVaultV6` (already
logged).

Checked for: stranger
zap `beefOut` of
another depositor's
vault shares; zap
`beefIn` that mints
shares to the
caller without
pulling `tokenIn`;
strategy `withdraw`
/ `retireStrat`
without the vault;
Aave `deposit` /
`_leverage` that
borrows to a
stranger.

Result: no
user-exploitable
finding. Not
submitted.

- `beefIn` /
  `beefInETH` pull
  `msg.sender` /
  `msg.value` then
  mint vault shares
  to that sender.
  `_getVaultPair`
  requires the vault
  `want` pair factory
  to match the
  configured router.
  Leftovers return
  to `msg.sender`.
- `beefOut` /
  `beefOutAndSwap`
  pull the caller's
  vault shares, burn
  them on the vault,
  and send pair
  tokens / the
  desired token to
  that caller.
- Strategy
  `withdraw` /
  `retireStrat` are
  `msg.sender ==
  vault`. Public
  `deposit` only
  stakes idle `want`
  into the
  configured chef /
  Aave / gauge.
- Aave leverage
  `rebalance` /
  `deleverageOnce`
  are `onlyManager`.
  Harvest `onlyEOA`
  (or vault /
  `tx.origin` on
  Fish / Curve
  harvest-on-deposit)
  takes the
  configured call
  fee from rewards.

Do not file first-
depositor inflation,
public `deposit`,
owner strat upgrade,
harvest call-fee,
zap leftover
donation, or
addLiquidity min
`1,1` sandwich as a
stranger drain.

Not submitted.
Listed leftover is
the Sourcify-open
later Polygon
strategy families
and the six listed
zaps.
Remaining listed:
most `wexpoly` LP
strategies plus
some Aave / Cometh
addresses Sourcify
404; unsampled
vaults of already-
reviewed types.

## 2026-09-03: Threshold leftover wallet registry leftover (Sourcify)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
Bank / vault / watchtower /
Wormhole / RebateStaking /
validator / ReimbursementPool /
Bridge / gov-relay leftovers
are already logged. This
slice is listed Ethereum
Sourcify `WalletRegistry`
impl (`match`
`0xfbae130e06bbc8ca198861beecae6e2b830398fb`;
`0x46d52E41C2F300BC82217Ce22b920c34995204eb`
is the transparent proxy),
`SortitionPool`
(`exact_match`
`0xc2731fb2823af3Efc2694c9bC86F444d5c5bb4Dc`),
`EcdsaDkgValidator`
(`exact_match`
`0x0125c8977a02b2Fa3970b1ED9AF02f5Bedd4eF27`),
and
`WalletRegistryGovernance`
(`exact_match`
`0x6aed6cC30D1b2770771052555d257Da86eD47fe8`).
Extract
`/tmp/threshold-wallet`.
No mainnet interaction.

Files:
`contracts/WalletRegistry.sol`,
`contracts/WalletRegistryGovernance.sol`,
`contracts/EcdsaDkgValidator.sol`,
`contracts/libraries/EcdsaAuthorization.sol`,
`@keep-network/sortition-pools/contracts/SortitionPool.sol`.

Checked for: a
stranger
`withdrawRewards` that
pays the caller;
`seize` without the
wallet owner;
`insertOperator` on
the pool without
being owner;
`registerOperator`
for another staking
provider.

Result: no
user-exploitable
finding. Not
submitted.

- `registerOperator`
  binds
  `msg.sender` as
  the staking
  provider.
  `joinSortitionPool`
  is the registered
  operator.
- `withdrawRewards`
  pays the staking
  provider's
  beneficiary, not
  the caller.
  `withdrawIneligibleRewards`
  is governance.
- SortitionPool
  insert / update /
  lock / withdraw
  are `onlyOwner`
  (WalletRegistry).
  `receiveApproval`
  pulls the reward
  token from the
  sender.
- `requestNewWallet`
  /
  `closeWallet` /
  `seize` are
  `onlyWalletOwner`.
  Authorization
  increase / decrease
  are
  `onlyStakingContract`.
- DKG submit /
  challenge /
  approve complete
  the stored result.
  Inactivity notify
  verifies a majority
  claim.
- WalletRegistryGovernance
  begin / finalize
  writes are
  `onlyOwner` and
  wait the stored
  delay.

Do not file
permissionless
`withdrawRewards`
(pays the
beneficiary),
governance
ineligible sweep,
or DKG timeout
refund as theft.

Not submitted.
Remaining Threshold
listed leftover:
`keep-network/tbtc-v2`
typescript and
Starknet / Sui /
Solana explorer
rows.

## 2026-09-03: RootstockLabs RIF token leftover (Sourcify)

Immunefi program
`RootstockLabs`
($200,000, `kyc: true`).
Unique listed SC added
2026-09-03. Rootstock
Sourcify `match`
`RIFToken`
`0x2aCc95758f8b5F583470bA265Eb685a8f45fC9D5`.
Extract `/tmp/rif-token`.
No mainnet interaction.

Files:
`RIFToken.sol`.

Checked for: a
stranger
`redeem` that moves
another contributor
without that
contributor's
signature;
`transferFrom`
without allowance;
`setAuthorizedManagerContract`
by a non-owner after
the manager is set.

Result: no
user-exploitable
finding. Not
submitted.

- Fixed supply is
  minted to the
  token then moved
  once to the
  authorized manager.
  `setAuthorizedManagerContract`
  is `onlyOwner` and
  only while the
  manager is still
  zero.
- `transferToContributor`
  /
  `transferToShareholder`
  /
  `transferBonus` /
  `delegate` are
  manager-only.
- `redeem` requires
  an original
  contributor, an
  unused destination,
  and
  `acceptLinkedRskAddress`
  for that
  contributor.
  `contingentRedeem`
  is `onlyOwner` plus
  a DELEGATION
  signature.
- `transfer` /
  `transferFrom` /
  `approve` spend
  the caller or
  allowance after
  distribution.
  `transferAndCall`
  is the caller's
  ERC-677 send.

Do not file ERC-20
approve race,
ERC-677 callback on
a user-chosen `_to`,
owner
`contingentRedeem`,
or unredeemed
contributor lock as
a stranger drain.

Not submitted.
Remaining listed:
PegIn / PegOut /
Collateral /
Flyover / Pause /
Quotes / BtcUtils /
SignatureValidator
(2026-07-03 rows)
plus GitHub DLT /
web assets (KYC).

## 2026-09-03: Synthetix deposit leftover (Blockscout)

Immunefi program
`Synthetix`
($100,000, `kyc: false`).
Unique no-KYC listed
Ethereum slice.
Sourcify has no
match on the three
listed proxies.
Blockscout verified
`SynthetixDepositContract`
impl
`0xff6611190b48Cc920EF3c5DCbD356bF2C20D731F`
behind
`0xD62595c3c23B690BAEE0935e107A209Cb1Dbd37B`,
`SynthetixDepositContractLens`
`0x99E61877aF9Bc6805BCc3813F655D94Ed5f3782A`,
and
`PermissionsRegistry`
impl
`0xF06E7b50A214D8437221BAADD04e0878F232db5e`
behind
`0x45F91031b33Da2585932c8f1cdFF0faa6cD329ae`.
Extract
`/tmp/synthetix-src`.
No mainnet
interaction.

Files:
`src/SynthetixDepositContract.sol`,
`src/SynthetixDepositContractLens.sol`,
`src/PermissionsRegistry.sol`,
`src/libraries/CowProtocol.sol`.

Checked for: a
stranger
`deposit` that pulls
another owner
without allowance
or that owner's
Permit2; a
permissionless
`requestWithdrawal`
or `disburse` that
pays the caller;
`cancelWithdrawal`
of another user's
request; ERC-1271
`isValidSignature`
that lets a stranger
settle CoW against
custody; registry
grants that mutate
another owner's
delegatees.

Result: no
user-exploitable
finding. Not
submitted.

- `deposit` pulls
  `msg.sender` via
  `safeTransferFrom`
  or Permit2
  (`owner` is the
  caller). Credit
  goes to
  `beneficiary`.
- `requestWithdrawal`
  is
  `RELAYER_ROLE`.
  The request user
  is
  `entry.beneficiary`.
  `disburseWithdrawals`
  is `TELLER_ROLE`
  and
  `safeTransfer`s to
  that user, not the
  caller.
- `cancelWithdrawal`
  requires
  `req.user ==
  msg.sender`.
  Reject / dispute /
  watcher vote /
  guardian resolve
  are role-gated.
- CoW
  `isValidSignature`
  requires an
  `AUTHORIZED_TRADER_ROLE`
  EOA, sell
  collateral, buy
  USDT, and
  `receiver ==
  address(this)`.
  VaultRelayer /
  SLP approvals are
  `OWNER_ROLE`.
- Lens is view-only.
  PermissionsRegistry
  `_grant` /
  `_revoke` bind
  `msg.sender` as
  owner. Contract
  owner can only
  pause / upgrade.

Do not file
relayer-created
withdrawals, negative
internal balances,
guardian `limit == 0`
(no cap), or CoW
`appData` / kind
trust as stranger
theft.

Not submitted.
Listed Synthetix
leftover is
exhausted at the
three Immunefi
Ethereum addresses.
Remaining unused
no-KYC docs /
audit-comp rows:
Sushi (docs-only
deployments), DeGate
and IDEX 2024 audit
comps (testnet /
closed window).

## 2026-09-03: Pareto Credit leftover factory leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). IdleCDO
request-claim, strategy,
epoch admin, and queue /
Prefunded leftovers are
already logged. This
slice is the remaining
credit-vault factory,
write-off escrow,
manager orchestrator,
implied-price helper,
and programmable
borrower on the official
clone `/tmp/idle-tranches`
at `19e7cde`. No mainnet
interaction.

Files:
`contracts/IdleCreditVaultFactory.sol`,
`contracts/IdleCreditVaultWriteOffEscrow.sol`,
`contracts/IdleCreditVaultManagerOrchestrator.sol`,
`contracts/IdleCreditVaultImpliedPrice.sol`,
`contracts/strategies/idle/ProgrammableBorrower.sol`.

Checked for: a
stranger factory
`deployCreditVault` that
mints into an existing
vault; write-off
`fullfillWriteOffRequest`
that pays another user's
request without paying
underlyings; orchestrator
`startEpoch` /
`stopEpochWithDuration`
that drains to the
caller; programmable
`borrow` that sends
funds to the caller
instead of the borrower.

Result: no
user-exploitable
finding. Not
submitted.

- Factory
  `deployCreditVault` /
  `deployRevolvingCreditVault`
  deploy new proxies
  only. Strategy and
  CDO ownership move
  to `treasury`.
  `setFeeSplit` is
  treasury-only.
  Factory never mints
  strategy tokens.
- Write-off
  `createWriteOffRequest`
  pulls the caller's
  tranche tokens.
  `deleteWriteOffRequest`
  returns that
  caller's tranches.
  `fullfillWriteOffRequest`
  pulls underlyings
  from the fulfiller,
  pays the listed
  lender minus exit
  fee, and sends
  escrowed tranches
  to the fulfiller.
- Orchestrator
  `startEpoch` /
  `stopEpochWithDuration`
  / queue process /
  APR / transfer
  flags are operator
  or owner and only
  for allowlisted
  CDOs. No payout to
  the caller.
- Implied price is a
  view helper.
- Programmable
  `onStartEpoch` /
  `onStopEpoch` /
  `settleBorrowerInterest`
  / `onDefault` are
  CDO-only. `borrow`
  / `repay` are the
  configured
  borrower.
  `executeBorrow` /
  `executeRepay` are
  authorized
  executors but still
  pay / pull the
  borrower.

Do not file
permissionless new
vault deploy, owner
write-off
`emergencyWithdraw`,
operator epoch
control, borrower
draw of reserved
liquidity, or
Keyring allowlist as
theft.

Not submitted.
Listed leftover is
the factory /
write-off /
orchestrator /
implied-price /
programmable
borrower slice.
Remaining listed:
`TrancheWrapper` /
`IdleTokenWrapper` /
Keyring whitelist,
proxy
implementations not
independently
Sourcify-fetched,
and other docs
addresses.

## 2026-09-03: Aspida leftover (Sourcify)

Immunefi program
`Aspida`
($50,000, `kyc: false`).
Unique no-KYC listed
Ethereum slice.
Sourcify
`exact_match` on the
five listed
TransparentUpgradeableProxy
rows. Blockscout
implementations:
`aETH`
`0x5f898DC62d699ecBeD578E4A9bEf46009EA8424b`
behind
`0xFC87753Df5Ef5C368b5FBA8D4C5043b77e8C5b39`,
`saETH`
`0xc69809947E6EDaf21fF7F2e3784727a15a09DE3d`
behind
`0xF1617882A71467534D14EEe865922de1395c9E89`,
`CorePrimary`
`0x55b6aF0e89eAd974a80b70C5B30589B088113e24`
behind
`0x5341864D99B50155F782C562Bd15Ac4a0A3C117e`,
`RewardOracle`
`0xD3aFE58031998EAf2b0cCeE76dBd8ca50B19DCCa`
behind
`0xD691b1c47a578f51aDa825A8565cAfceB401EdaC`,
`StETHMinter`
`0x76a444fa85d8DA2209D45c6f89D7f51b54FcdDF9`
behind
`0x25a01dBde45cc5Bb7071EB3c3b2F983ea923bec5`.
Extract
`/tmp/aspida-impl`.
No mainnet
interaction.

Files:
`contracts/aETH.sol`,
`contracts/saETH.sol`,
`contracts/CorePrimary.sol`,
`contracts/RewardOracle.sol`,
`contracts/StETHMinter.sol`,
`contracts/core/Submit.sol`,
`contracts/core/WithdrawalQueue.sol`,
`contracts/strategy/model/aETHMinter.sol`.

Checked for: a
stranger
`minterMint` of aETH
with cap 0;
`submit` that mints
without ETH;
`withdraw` /
`claim` of another
user's queue;
StETH deposit that
pulls another owner
without allowance;
`submitEpochReward`
by a random caller.

Result: no
user-exploitable
finding. Not
submitted.

- `aETH.mint` is
  `onlyManager`.
  `minterMint`
  requires
  `mintAmounts +
  amount <=
  mintCaps`
  (default cap 0).
  `minterBurn` burns
  the caller.
  `burnFrom` is
  manager-only and
  spends allowance
  when the account
  is not the caller.
- `submit` /
  `submit(address)`
  mint aETH for
  `msg.value`.
  `submitAndStake`
  mints to the core
  then deposits into
  saETH for
  `_receiver`.
- Core
  `withdraw` /
  `withdrawWithPermit`
  burn the caller's
  aETH (permit owner
  is `msg.sender`)
  and queue that
  sender. `claim`
  uses
  `userQueueIds_[msg.sender]`.
- saETH is ERC-4626
  `sync`.
  `depositWithPermit`
  permits the
  caller. `withdraw`
  / `redeem` use
  OZ allowance when
  `owner != caller`.
- StETHMinter
  `deposit` /
  `depositWithPermit`
  `safeTransferFrom`
  the caller and
  `minterMint` to
  the chosen
  receiver.
- `deposit` /
  `depositCheck`
  are
  `onlyManager`.
  `supplyReward` is
  `onlyRewardOracle`.
  `submitEpochReward`
  is `onlyManager`.

Do not file
owner
`_transferOut`,
manager beacon
deposits, or
reward-oracle mint
as stranger theft.

Not submitted.
Listed Aspida
leftover is
exhausted at the
five Immunefi
Ethereum addresses.

## 2026-09-03: Balancer Foundation leftover V2 Vault + V3 BatchRouter (Sourcify)

Immunefi program
`Balancer Foundation`
($1,000,000, `kyc: false`).
V3 Router /
CompositeLiquidityRouter
/ ProtocolFeeController
/ factory leftovers are
already logged (23 Jun
slice exhausted; Jan
2025 BatchRouter /
BufferRouter rows were
left). This slice is
the Foundation-listed
V2 Vault + Authorizer
+ AuthorizerAdaptor +
BatchRelayerLibrary and
the Sourcify-open V3
`BatchRouter`. Official
V2 clone
`/tmp/balancer-v2-monorepo`
at `e91a2b6`. Blockscout
extract `/tmp/bal-found`.
No mainnet interaction.

Listed this slice:
V2 `Vault`
`0xBA12222222228d8Ba445958a75a0704d566BF2C8`,
V2 `Authorizer`
`0xA331D84eC860Bf466b4CdCcFb4aC09a1B43F3aE6`,
`AuthorizerAdaptor`
`0x8F42aDBbA1B16EaAE3BB5754915E0D06059aDd75`,
`BatchRelayerLibrary`
`0xeA66501dF1A00261E3bB79D1E90444fc6A186B62`,
V3 `BatchRouter`
`0x136f1EFcC3f8f88516B9E94110D56FDBfB1778d1`.

Files:
`pkg/vault/contracts/{Vault,Swaps,PoolBalances,UserBalance,FlashLoans,VaultAuthorization}.sol`,
`contracts/BatchRouter.sol`,
`contracts/BatchRouterCommon.sol`,
`contracts/admin/AuthorizerAdaptor.sol`,
`contracts/vault/Authorizer.sol`,
`contracts/BatchRelayerLibrary.sol`.

Checked for: a
stranger
`swap` / `joinPool` /
`exitPool` /
`manageUserBalance`
that spends another
user without relayer
approval; a
`flashLoan` that
keeps Vault tokens;
BatchRouter
`swapExactIn` that
settles to the
caller instead of
the sender;
`performAction`
without Authorizer
permission.

Result: no
user-exploitable
finding. Not
submitted.

- V2 `swap` /
  `batchSwap` use
  `authenticateFor(funds.sender)`.
  `joinPool` /
  `exitPool` use
  `authenticateFor(sender)`
  inside
  `_joinOrExit`.
  Relayers also need
  per-user
  `setRelayerApproval`
  or a signed extra
  calldata permit.
- `manageUserBalance`
  validates each op
  `sender` the same
  way. Internal
  withdraw / transfer
  debit that sender.
- `flashLoan` pays
  the recipient then
  requires
  `post >= pre` and
  fee. Tokens stay
  in the Vault.
- V3 BatchRouter
  `swapExactIn` /
  `swapExactOut`
  pass
  `sender: msg.sender`
  into the Vault
  unlock hook.
  `_settlePaths`
  `_takeTokenIn` /
  `_sendTokenOut` /
  `_returnEth` that
  sender. Hooks are
  `onlyVault`.
- Authorizer
  `grantRole` is
  OZ AccessControl.
  Adaptor
  `performAction`
  checks
  `canPerform` on
  the inner
  selector +
  target.
- BatchRelayerLibrary
  is not a relayer
  by itself; calls
  go through the
  entrypoint after
  Vault relayer
  approval.

Do not file
approved-relayer
spends, flash-loan
recipient hooks, or
governance
`setAuthorizer` as
stranger theft.

Not submitted.
Remaining
Foundation-listed:
V3 Vault
`0xbA1333333333a1BA1108E8412f11850A5C319bA9`
and the other
listed routers /
helpers not opened
this slice.

## 2026-09-03: Threshold leftover StarkNet depositor leftover (`502cd39`)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
WalletRegistry /
SortitionPool leftovers
are already logged.
This slice is listed
Ethereum
`StarkNetBitcoinDepositor`
proxy
`0xC9031f76006da0BD4bFa9E02aDf0d448dB3BC155`
(Sourcify
`TransparentUpgradeableProxy`)
and impl
`0xd3585922b7f6b30953fc81726f48046826b8b2ca`
(Sourcify
`exact_match`
`StarkNetBitcoinDepositor`).
Official clone
`/tmp/threshold-tbtc`
at `502cd39`. Listed
`0x2111A49ebb717959059693a3698872a0aE9866b9`
is official StarkGate
`ProxyV5`, not
Threshold source.
Read-only
`eth_getStorageAt`
for the impl slot.
No other mainnet
interaction.

Files:
`solidity/contracts/cross-chain/starknet/StarkNetBitcoinDepositor.sol`,
`solidity/contracts/cross-chain/starknet/interfaces/IStarkGateBridge.sol`.

Checked for: a
stranger
`finalizeDeposit`
that bridges minted
tBTC to the caller
instead of the
Bitcoin-script
extraData owner;
`_transferTbtc`
that approves the
caller; initialize
that rebinds another
deposit's L2 owner.

Result: no
user-exploitable
finding. Not
submitted.

- Parent
  `initializeDeposit`
  / `finalizeDeposit`
  (already logged in
  the Wormhole L1
  leftover) bind
  extraData in the
  Bitcoin script and
  one-shot
  Initialized →
  Finalized.
- StarkNet
  `_transferTbtc`
  requires
  `msg.value >=
  estimateFee()`,
  rejects a zero L2
  recipient, and
  `deposit`s tBTC to
  `starkGateBridge`
  for
  `uint256(destinationChainReceiver)`.
  Relayer
  `msg.sender` is
  not the L2 owner.
  Excess `msg.value`
  is forwarded to
  StarkGate (no
  refund).
- Gas
  reimbursements
  pay the recorded
  initialize
  receiver and an
  authorized
  finalize caller
  from the pool,
  not user tBTC.

Do not file
permissionless
finalize (relayer
path), leftover
bridge fee, owner
gas-offset writes,
or official
StarkGate `ProxyV5`
as Threshold theft.

Not submitted.
Listed leftover is
the Ethereum
StarkNet depositor
impl. Remaining
Threshold listed:
`keep-network/tbtc-v2`
typescript, Starkscan
Cairo rows, and Sui /
Solana explorer
rows.

## 2026-09-03: Balancer Foundation leftover V3 Vault (Sourcify)

Immunefi program
`Balancer Foundation`
($1,000,000, `kyc: false`).
V2 Vault + V3
BatchRouter leftover
already logged. This
slice is the listed
V3 Vault singleton
`0xbA1333333333a1BA1108E8412f11850A5C319bA9`.
Sourcify
`exact_match`. Official
clone
`/tmp/balancer-v3-monorepo`
at `449f7e0`. Blockscout
extract
`/tmp/bal-found/src/bA1333…`.
No mainnet interaction.

Files:
`contracts/Vault.sol`,
`contracts/VaultCommon.sol`,
`contracts/token/ERC20MultiToken.sol`.

Checked for: a
stranger
`sendTo` that pays
the caller without
credit; `settle`
that credits unsent
reserves as theft;
`removeLiquidity`
that burns another
owner's BPT without
allowance;
`transfer` that
moves another pool's
BPT by calling the
Vault directly.

Result: no
user-exploitable
finding. Not
submitted.

- `unlock` is
  `transient` and
  calls back
  `msg.sender`.
  Non-zero token
  deltas revert
  `BalanceNotSettled`.
- `settle` credits
  the unlocker from
  the reserve
  increase, capped
  by `amountHint`.
  `sendTo` takes
  debt from that
  same unlocker then
  transfers.
- `swap` /
  `addLiquidity` /
  `removeLiquidity` /
  `erc4626BufferWrapOrUnwrap`
  are
  `onlyWhenUnlocked`.
  Swap debts
  `tokenIn` and
  credits
  `tokenOut` to the
  unlocker.
- Add liquidity
  mints BPT to
  `params.to`.
  Remove spends
  allowance
  (`from`,
  `msg.sender`) then
  burns `params.from`.
- Vault
  `transfer` /
  `transferFrom`
  key balances by
  `msg.sender` as
  the pool token.
  Only that pool
  contract can move
  its BPT.

Do not file
router-mediated
user pulls, hook
reentrancy that
still settles, or
query-mode balance
increase as
stranger theft.

Not submitted.
Remaining
Foundation-listed:
the other unopened
routers / helpers
after Vault +
BatchRouter (e.g.
later listed
factory / fee /
buffer rows).

## 2026-09-03: Balancer Foundation leftover VaultAdmin / Extension / BufferRouter (Sourcify)

Immunefi program
`Balancer Foundation`
($1,000,000, `kyc: false`).
V2 Vault, V3 Vault,
and V3 BatchRouter
leftovers already
logged. V3 Router
`0xAE56…8Ea2`,
CompositeLiquidityRouter,
ProtocolFeeController,
and the 23 Jun factory
set are already logged.
This slice is the
remaining Foundation
money-path helpers:
`VaultAdmin`
`0x35fFB749B273bEb20F40f35EdeB805012C539864`,
`VaultExtension`
`0x0E8B07657D719B86e06bF0806D6729e3D528C9A9`,
`BufferRouter`
`0x9179C06629ef7f17Cb5759F501D89997FE0E7b45`,
and V2
`BalancerRelayer`
`0x35Cea9e57A393ac66Aaa7E25C391D52C74B5648f`.
Sourcify
`exact_match`. Extract
`/tmp/bal-found2`. Clone
`/tmp/balancer-v3-monorepo`
at `449f7e0`. No mainnet
interaction.

Files:
`contracts/VaultAdmin.sol`,
`contracts/VaultExtension.sol`,
`contracts/BufferRouter.sol`,
`contracts/relayer/BalancerRelayer.sol`.

Checked for: a
stranger
`removeLiquidityFromBuffer`
that burns another
owner's shares;
`addLiquidityToBuffer`
that pulls another
user without Permit2;
`removeLiquidityRecovery`
that burns without
allowance;
`collectAggregateFees`
by a random caller;
relayer `multicall`
that spends a user
without Vault relayer
approval.

Result: no
user-exploitable
finding. Not
submitted.

- VaultAdmin
  pause / query /
  buffer pause are
  `authenticate`.
  `collectAggregateFees`
  is
  `onlyProtocolFeeController`.
  Buffer init / add
  are
  `onlyWhenUnlocked`
  and take debt from
  the unlocker.
  `removeLiquidityFromBuffer`
  forwards
  `msg.sender` as
  `sharesOwner` and
  burns that
  owner's shares.
- BufferRouter
  init / add pass
  `msg.sender` as
  sharesOwner.
  Hooks are
  `onlyVault` and
  `_takeTokenIn`
  that owner.
  Queries use
  `quote` and do
  not settle to a
  stranger.
- VaultExtension
  `initialize` is
  `onlyWhenUnlocked`
  and mints BPT to
  `to` after taking
  debt. Recovery
  exit spends
  allowance
  (`from`,
  `msg.sender`) then
  burns `from`.
- BalancerRelayer
  `multicall`
  delegatecalls the
  library and
  refunds leftover
  ETH to
  `msg.sender`.
  Vault still
  requires
  per-user relayer
  approval. ETH
  `receive` is
  Vault-only.

Do not file
governance pause,
protocol-fee
controller collect,
or query-mode share
increase as
stranger theft.

Not submitted.
Listed Balancer
Foundation leftover
is exhausted at the
opened-contract
level (Vault /
routers / admin /
extension / buffer
/ relayer /
already-logged
factories).

## 2026-09-03: Pareto Credit leftover wrappers leftover (`19e7cde`)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). IdleCDO
request-claim, strategy,
epoch admin, queue, and
factory leftovers are
already logged. This
slice is the remaining
4626 wrappers and
Keyring whitelist on
the official clone
`/tmp/idle-tranches` at
`19e7cde`. No mainnet
interaction.

Files:
`contracts/TrancheWrapper.sol`,
`contracts/IdleTokenWrapper.sol`,
`contracts/TrancheWrapperWSTETHBalancer.sol`,
`contracts/KeyringIdleWhitelist.sol`.

Checked for: a
stranger
`deposit` that mints
without pulling the
caller; `withdraw` /
`redeem` that burns
another owner
without allowance;
wstETH wrap that
pays a stranger;
Keyring whitelist
mutation by a
non-admin.

Result: no
user-exploitable
finding. Not
submitted.

- `TrancheWrapper`
  / `IdleTokenWrapper`
  `deposit` /
  `mint` pull
  `msg.sender` and
  mint wrapper
  shares to
  `receiver`.
  `withdraw` /
  `redeem` burn
  `owner` with
  allowance when
  `owner != caller`
  and pay
  `receiver`.
- wstETH Balancer
  variant unwraps
  the caller's
  wstETH to stETH
  before
  `depositAA` /
  `depositBB`, then
  wraps stETH back
  to wstETH on
  redeem for
  `receiver`.
- Keyring
  `setWhitelistStatus`
  / `changeAdmin`
  are admin-only.
  `checkCredential`
  is a view.

Do not file ERC-4626
receiver mint,
allowance redeem,
wstETH wrap
rounding, or
Keyring allowlist as
theft.

Not submitted.
Listed leftover is
the wrapper /
Keyring slice.
Remaining listed:
proxy
implementations not
independently
Sourcify-fetched,
and other docs
addresses.

## 2026-09-03: RootstockLabs leftover PegIn / PegOut / Collateral (Blockscout)

Immunefi program
`RootstockLabs`
($200,000, `kyc: true`).
RIF token leftover is
already logged. This
slice is the remaining
listed Flyover money
path: PegIn /
PegOut /
CollateralManagement
proxies plus
FlyoverDiscovery /
PauseRegistry /
Quotes / BtcUtils /
SignatureValidator.
Sourcify has no
match on the proxies.
Rootstock Blockscout
implementations:
`PegInContract`
`0x2aA0F7054066319A97E077Ab7Ce27B0f8b1dc002`
behind
`0x9270733402dc7c5730ea24268fc11039fd75e189`,
`PegOutContract`
`0xe8F4a2c1Db0B7E8081287aA42f37956dcea4B9a2`
behind
`0x9a0678742cfb567874eb4e99df2106bded78f5e4`,
`CollateralManagementContract`
`0xC9Aab2407E14d412d7aF35dfcb1360917551EC1F`
behind
`0xbe4d93b3afd9921cac66704ffd3caf662886fb73`,
`FlyoverDiscovery`
`0x1b5B100B7CaAca4E4eB56acF0290588bB887a495`
behind
`0x9a48c6b18aa000d0bd35d55616bcc98ad3553e7a`,
`PauseRegistry`
`0x179A7A091c43b272ec6a2270E1695aB91e70212F`
behind
`0xb2c65bbf276cc5ccae73c0ab29b609a129080639`.
Libraries
`Quotes`
`0xAAFF2c6D3185ccd03d9781e689005c314b936AC1`,
`BtcUtils`
`0xd8D956312222d8acaBB58569cc960a93b1aa2f7a`,
`SignatureValidator`
`0xB0824559dF4a0872A61b228466bAd12E733f7dEC`.
Extract `/tmp/rsk-impl`.
No mainnet
interaction.

Files:
`PegInContract`,
`PegOutContract`,
`CollateralManagementContract`.

Checked for: a
stranger
`withdraw` that
pays another
provider's balance;
`refundUserPegOut`
that pays the
caller; `registerPegIn`
that mints without
a bridge result;
`slash*` by a
non-slasher;
collateral withdraw
before resign delay.

Result: no
user-exploitable
finding. Not
submitted.

- PegIn `deposit` /
  `callForUser` are
  registered LPs.
  `withdraw` pays
  `msg.sender` from
  that sender's
  `_balances`.
  `registerPegIn`
  requires a signed
  quote and a
  bridge register
  result; slash
  punisher is the
  caller.
- PegOut
  `depositPegOut`
  takes `msg.value`,
  verifies the LP
  EIP-712 signature,
  and refunds change
  to
  `quote.rskRefundAddress`.
  `refundPegOut`
  pays
  `quote.lpRskAddress`
  after a validated
  BTC proof.
  `refundUserPegOut`
  after expiry pays
  `rskRefundAddress`,
  not the caller.
  `withdraw` debits
  the caller.
- Collateral
  `slashPegIn` /
  `slashPegOut` are
  `COLLATERAL_SLASHER`.
  Rewards / collateral
  withdraw debit
  `msg.sender` after
  resign delay.
- Quotes / BtcUtils /
  SignatureValidator
  are libraries.
  PauseRegistry is
  pause state.
  FlyoverDiscovery
  `register` is
  provider onboarding.

Do not file
permissionless
expired-quote
refund (pays the
quote refund
address), LP
`callForUser`, or
slasher reward as
stranger theft.

Not submitted.
Payment requires
user KYC.
Listed Rootstock
Flyover leftover is
exhausted at the
opened-contract
level. Remaining
listed: GitHub DLT
/ web assets
(KYC).

## 2026-09-03: Pareto Credit leftover Fulcrum leftover (Sourcify)

Immunefi program
`Pareto Credit` ($50,000,
`kyc: false`). Official
clone leftovers through
wrappers are already
logged. This slice is
the remaining listed
docs vault-address
page: EIP-1967 impls
behind live Ethereum
vault / queue /
strategy proxies, plus
the one Sourcify-open
docs address that is
not that family.
Read-only
`eth_getStorageAt` for
impl slots. No other
mainnet interaction.
Extract
`/tmp/idle-fulcrum`.

Live impls Sourcify-
open as already-
reviewed types:
`IdleCDOEpochVariant`
(`0xdd59…a18d`,
`0x6de6…a53f`,
`0xf70e…8754`),
`IdleCreditVault`
(`0x5557…a4a7`,
`0x6256…e489`,
`0xc499…855a`),
`IdleCDOEpochQueue`
(`0x49ba…1933`,
`0xc05b…14e4`,
`0x420d…2057`),
and `IdleCDOTranche`
(`0x4505…85bE` and
siblings). Unique
new file is
`IdleFulcrumV2`
`0x463465c334742D72907CA5fB97db44688B4EC3dC`
(Sourcify `match`).

Files:
`IdleFulcrumV2.sol`.

Checked for: a
stranger `mint` that
credits the caller
without being
IdleToken; `redeem`
that pays an
arbitrary account
without `onlyIdle`.

Result: no
user-exploitable
finding. Not
submitted.

- `mint` /
  `redeem` are
  `onlyIdle`.
  `mint` spends
  this contract's
  underlying and
  Fulcrum-mints
  iTokens to
  `msg.sender`
  (IdleToken).
  `redeem` burns
  this contract's
  iTokens to
  `_account`.
- `setIdleToken`
  is `onlyOwner`
  and once.
  Remaining
  methods are
  views.

Do not file owner
IdleToken bind,
Fulcrum liquidity
require, or same-
bytecode live CDO /
queue / strategy
impls as a new
finding.

Not submitted.
Listed leftover is
the docs-page
Fulcrum adapter and
the confirmation
that live vault
proxy impls match
already-reviewed
types. Remaining
listed: Sourcify
404 docs addresses
and other docs
rows.

## 2026-09-03: CapyFi Comptroller / CEther / CErc20 leftover (Sourcify)

Immunefi program
`CapyFi`
($1,000,000, `kyc: true`).
Unique unused standing
program. Not previously
logged. Ethereum
Sourcify `exact_match`
on Comptroller
`0x00dc4965916e03A734190fA382633657c71f867E`,
CEther caETH
`0x37DE57183491Fa9745d8Fa5DCd950f0c3a4645c9`,
CErc20Delegator markets
caUSDC / caUSDT /
caWBTC / caRPC /
caWARS / caLAC, and
CErc20Delegate
`0x0f1adffffd84749e816066348d4c1256d285965f`
behind caUSDC.
Unitroller
`0x0b9af1fd73885aD52680A1aeAa7A3f17AC702afA`
is Sourcify 404; its
admin / fallback source
is in the Comptroller
extract. Read-only
`eth_call` on
`https://ethereum.publicnode.com`
and
`https://rpc.mevblocker.io`
(no writes). Extract
`/tmp/capyfi-src`.

Files:
`src/contracts/Comptroller.sol`,
`src/contracts/Unitroller.sol`,
`src/contracts/CToken.sol`,
`src/contracts/CEther.sol`,
`src/contracts/CErc20.sol`,
`src/contracts/CErc20Delegate.sol`,
`src/contracts/CErc20Delegator.sol`,
`src/contracts/Access/WhitelistAccess.sol`.

Checked for: a
stranger mint that
credits the caller
without pulling that
caller; redeem /
borrow that pays the
caller from another
account's cTokens;
`seize` that accepts a
spoofed seizer token;
`_setWhitelist` by a
non-admin.

Result: no
user-exploitable
finding. Not
submitted.

- Comptroller
  `enterMarkets` only
  adds `msg.sender`.
  `mintAllowed` is
  listed + not paused.
  `borrowAllowed`
  auto-enters only
  when `msg.sender`
  is the cToken,
  reverts on a zero
  oracle price, and
  requires no
  hypothetical
  shortfall.
  `liquidateBorrowAllowed`
  needs shortfall
  (unless the market
  is deprecated) and
  a close-factor cap.
  `seizeAllowed`
  requires both
  markets listed and
  the same
  Comptroller.
  `_setPriceOracle` /
  `_supportMarket` /
  `_setCollateralFactor`
  / `_become` /
  pause / borrow-cap
  setters are admin
  or named guardians.
- `CToken.mintInternal`
  is
  `_checkWhitelist(msg.sender)`
  then `mintFresh`
  for that sender.
  `doTransferIn` on
  CErc20
  `transferFrom`s the
  minter; CEther
  requires
  `msg.sender == from`
  and
  `msg.value == amount`.
  Redeem burns the
  redeemer's tokens
  and pays that
  redeemer. Borrow
  pays the borrower
  after a liquidity
  check. Repay pulls
  the payer.
- `seize` passes
  `msg.sender` as the
  seizer cToken.
  Transfer spends
  allowance when
  `spender != src`.
- `_setWhitelist`
  requires admin and
  `isWhitelistAccess()`.
  The modifier is a
  no-op when
  whitelist is unset
  or inactive.
  `_setImplementation`
  / `_becomeImplementation`
  are admin.
  Unitroller
  pending-impl /
  pending-admin
  accept is the
  pending address.

Do not file first-
depositor exchange-rate
inflation, admin /
pause-guardian
privilege, optional
mint whitelist, or
permissionless
liquidation of an
undercollateralized
account as theft.

Not submitted.
Payment requires
user KYC.
Listed CapyFi
Comptroller / CEther /
CErc20 leftover is
exhausted at the
opened-contract
level. Remaining
listed: Unitroller
proxy (Sourcify 404)
and other-market
CErc20Delegate
implementations not
independently
Sourcify-fetched
(same CErc20Delegate
type as caUSDC).
The listed website
is out of this
slice.

## 2026-09-03: Threshold leftover L2 Wormhole gateway leftover (Sourcify)

Immunefi program
`thresholdnetwork`
($150,000, `kyc: false`).
StarkNet depositor /
WalletRegistry leftovers
are already logged.
This slice is listed
Optimism / Base /
Arbitrum / Polygon
Wormhole L2 proxies.
Official clone
`/tmp/threshold-tbtc`
at `502cd39`. Sourcify
extract `/tmp/threshold-l2`.
No mainnet interaction
beyond Sourcify
`proxyResolution`.

Listed this slice:
OP
`0x1293…A15458` →
`L2WormholeGateway`
`0xC08d…e5FdA6`,
OP
`0x6c84…dE40` →
`L2TBTC`
`0xDa53…f681365`,
Base
`0xe931…d88B` →
`L2BTCRedeemerWormhole`
`0x7926…7AEA2E`,
Base
`0x236a…794b` →
`L2TBTC`
`0x41C9…d91A`,
Base
`0x0995…99eab` →
`BaseWormholeGatewayUpgraded`
`0x40fa…05A0c`,
Arb
`0x1293…A15458` →
`ArbitrumWormholeGatewayUpgraded`
`0x7Ff0…eb9a5`,
Arb
`0xd7Cd…34D9b7` →
`L2BTCRedeemerWormhole`
`0x03E3…ee0F6`,
Arb
`0x6c84…dE40` →
`L2TBTC`
`0xDa53…f681365`,
Polygon
`0x236a…794b` →
`L2TBTC`
`0x41C9…d91A`,
Polygon
`0x0995…99eab` →
`L2WormholeGateway`
`0x0467…c197`.
Listed etherscan
`0x03E3…ee0F6`
is that Arb redeemer
impl checksum.

Files:
`L2TBTC.sol`,
`L2WormholeGateway.sol`,
`L2BTCRedeemerWormhole.sol`,
`BaseWormholeGatewayUpgraded.sol`,
`ArbitrumWormholeGatewayUpgraded.sol`.

Checked for: a
stranger `receiveTbtc`
that mints to the
caller; `sendTbtc`
that burns another
account; redeemer
`requestRedemption`
that pays the caller
BTC script; upgraded
gateway override that
skips `burnFrom`.

Result: no
user-exploitable
finding. Not
submitted.

- `L2TBTC.mint` is
  `onlyMinter` (same
  type already logged
  in the BOB leftover).
  `burn` / `burnFrom`
  are holder /
  allowance.
  `recover*` is owner.
  Guardian pause.
- `L2WormholeGateway.sendTbtc`
  `burnFrom`s
  `msg.sender`, then
  Token-Bridge
  transfers wormhole
  tBTC to the dest
  gateway or recipient.
  `receiveTbtc` measures
  `bridgeToken` delta
  after
  `completeTransferWithPayload`
  and mints (or, over
  `mintingLimit`,
  transfers wormhole
  tBTC) to the payload
  receiver, not the
  caller. Token Bridge
  VAA replay plus
  `nonReentrant`.
- `sendTbtcWithPayloadToNativeChain`
  (clone + Base/Arb
  upgraded child)
  requires no dest
  gateway, then the
  same burn-and-send.
- `L2BTCRedeemerWormhole.requestRedemption`
  pulls tBTC from
  `msg.sender`,
  approves the
  gateway, and sends
  the Bitcoin output
  script as payload
  to the configured
  L1 redeemer. It
  does not mint.

Do not file owner
gateway / limit
updates, guardian
pause, minting-limit
wormhole-tBTC
fallback, or the
"testing purposes"
comment on the live
upgraded child
impls.

Not submitted.
Listed leftover is
the Sourcify-open
L2 Wormhole gateway /
L2TBTC / L2 redeemer
proxies. Remaining
listed: keep-network
typescript, Starkscan
Cairo, and Sui /
Solana explorer
rows.
## 2026-09-03: Kelp DAO deposit / withdraw leftover (Sourcify)

Immunefi program
`Kelp DAO`
($250,000, `kyc: true`).
Unique unused standing
program. Not previously
logged. Ethereum
Sourcify proxies are
`TransparentUpgradeableProxy`
(`match`). Implementations
are `exact_match` /
`match`: LRTConfig
`0xd4F475A7DF199b3106F622A3A825Ff399D4dafCe`
behind
`0x947Cb49334e6571ccBFEF1f1f1178d8469D65ec7`,
RSETH
`0x7159107483e623707C18C6E06cBc095bd0717783`
behind
`0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7`,
LRTDepositPool
`0xEA38dFa108318288f36F13d06e821a64AcDA8320`
behind
`0x036676389e48133B63a802f8635AD39E752D375D`,
LRTOracle
`0xC59110239240761cCd3E670288443316e10Dd271`
behind
`0x349A73444b1a310BAe67ef67973022020d70020d`,
EthXPriceOracle
`0x3f258821a5ad28391e9Bb0B69A705fdf545BCab0`
behind
`0x3D08ccb47ccCde84755924ED6B0642F9aB30dFd2`,
FeeReceiver
`0x868ceF33E29bF3037b5d4CF5C408EAEF29d96b33`
behind
`0xdbc3363de051550d122d9c623cbaff441afb477c`,
LRTConverter
`0x70dAf8B0BFc846cc98b71D2F8FfdC91f4D2bbd51`
behind
`0x598dbcb99711e5577ff76ef4577417197b939dfa`,
LRTWithdrawalManager
`0x0eCde3F414D1A245246D121e37191d9a63684E19`
behind
`0x62De59c08eB5dAE4b7E6F7a8cAd3006d6965ec16`,
LRTUnstakingVault
`0x1fC8eEBd7E1E61cc2CCa005Ee0F0d08417E5a2a4`
behind
`0xc66830e2667bc740c0bed9a71f18b14b8c8184ba`,
NodeDelegator
`0x50F88fBbc50629b8B37F68C4dC28f712A8bf679b`
behind
`0x07b96cf1183c9bff2e43acf0e547a8c4e4429473`.
No mainnet writes.
Extract `/tmp/kelp-impl`.

Files:
`contracts/LRTDepositPool.sol`,
`contracts/RSETH.sol`,
`contracts/LRTWithdrawalManager.sol`,
`contracts/LRTUnstakingVault.sol`,
`contracts/LRTConverter.sol`,
`contracts/NodeDelegator.sol`,
`contracts/FeeReceiver.sol`,
`contracts/LRTOracle.sol`,
`contracts/LRTConfig.sol`.

Checked for: a
stranger deposit that
mints rsETH without
pulling the caller;
`initiateWithdrawal`
that burns another
user's rsETH;
`completeWithdrawal`
that pays a stranger
the queued amount;
`redeem` of the
unstaking vault by a
random caller;
`mint` / `burnFrom`
without a role.

Result: no
user-exploitable
finding. Not
submitted.

- `depositETH` /
  `depositAsset` pull
  `msg.value` or
  `safeTransferFrom`
  `msg.sender`, then
  `mint` rsETH to
  `msg.sender`.
  Transfers to NDC /
  unstaking vault are
  `onlyAssetTransferRole`.
  Operator LST/ETH
  swaps pull the
  operator and pay
  that operator.
- rsETH `mint` is
  `MINTER_ROLE` +
  daily cap.
  `burnFrom` is
  `BURNER_ROLE`.
- `initiateWithdrawal`
  pulls rsETH from
  `msg.sender` and
  queues that sender.
  `completeWithdrawal`
  pays the named
  request user after
  unlock + delay.
  `instantWithdrawal`
  burns the caller's
  rsETH and pays that
  caller minus fee.
- Vault `redeem` is
  `onlyLRTWithdrawalManager`.
  NodeDelegator
  `completeUnstaking`
  is `onlyLRTOperator`
  and requires
  `withdrawal.staker
  == address(this)`.
- Converter claims
  are operator.
  FeeReceiver
  `sendFunds` forwards
  ETH to the deposit
  pool. Oracle asset
  setters are admin.
  `updateRSETHPrice`
  is a computed
  refresh.

Do not file first-
depositor share
inflation, operator /
manager privilege,
the documented
last-asset slash
edge, manager-set
instant-withdraw
fee, or the ETH
deposit-limit check
that compares TVL
without adding the
current `msg.value`
as stranger theft.

Not submitted.
Payment requires
user KYC.
Listed Kelp DAO
deposit / withdraw
leftover is
exhausted at the
opened-contract
level. Remaining
listed: the website
Restaking page.

## 2026-09-03: Aera Base vault leftover (Sourcify)

Immunefi program
`Aera`
($500,000, `kyc: true`).
Unique unused standing
program. Not previously
logged. Base chain
8453 Sourcify `match`
on the five listed
contracts (no proxy
resolution):
TransferBlacklistHook
`0x6e5430C10fce10e5c6F67dC54506e4564dD7A6E5`,
PriceAndFeeCalculator
`0x69dd4d44eed6bbc33b8a0bdfe17897ab9044372e`,
MultiDepositorVault
`0x000000000001CdB57E58Fa75Fe420a0f4D6640D5`,
Provisioner
`0x18cf8d963e1a727f9bbf3aeffa0bd04fb4dbda07`,
Whitelist
`0xdDfd960a7150520548dD1F6E53CC2f201b364692`.
No mainnet writes.
Extract `/tmp/aera-src`.

Files:
`src/core/MultiDepositorVault.sol`,
`src/core/Provisioner.sol`,
`src/core/PriceAndFeeCalculator.sol`,
`src/core/Whitelist.sol`,
`src/periphery/hooks/transfer/TransferBlacklistHook.sol`.

Checked for: a
stranger `enter` that
mints units without
pulling the sender;
`exit` that burns
another user's units
without the
provisioner;
`requestDeposit` /
`requestRedeem` that
credit a stranger;
`refundRequest` that
pays the solver the
queued tokens;
`setWhitelisted` by
a random caller.

Result: no
user-exploitable
finding. Not
submitted.

- Vault `enter` /
  `exit` are
  `onlyProvisioner`.
  `enter` pulls
  `token` from
  `sender` and mints
  units to
  `recipient`.
  `exit` burns
  `sender` and pays
  `recipient`.
  `setProvisioner` /
  hook setter are
  `requiresAuth`.
- Sync `deposit` /
  `mint` convert via
  the price
  calculator, then
  `_syncDeposit`
  calls
  `enter(msg.sender,
  …, msg.sender)`.
  `refundDeposit` is
  `requiresAuth` and
  returns tokens to
  the original
  sender.
- `requestDeposit`
  pulls tokens from
  `msg.sender`.
  `requestRedeem`
  pulls vault units
  from `msg.sender`.
  `refundRequest`
  after deadline
  (or auth) pays
  `request.user`.
- Authorized vault
  solve mints units
  to `request.user`
  or pays that user
  after `exit`.
  Permissionless
  direct solve
  swaps the solver's
  other side for the
  queued tokens /
  units; the user
  still receives
  their side.
- `setUnitPrice` is
  `onlyVaultAccountant`.
  Whitelist mutation
  is `requiresAuth`.
  Transfer hook
  blocks sanctioned
  `from` / `to`.

Do not file
accountant price
privilege, auth
sync-deposit refund,
permissionless
direct solve with a
solver tip, or
sanctions blocking
as stranger theft.

Not submitted.
Payment requires
user KYC.
Listed Aera Base
vault leftover is
exhausted at the
opened-contract
level.

## 2026-09-03: Derive leftover matching + cash leftover (`f6c20f4` / `96796a6`)

Immunefi program
`derive`
($50,000, `kyc: false`).
Unique unused standing
program. Not previously
logged. Listed assets are
Lyra-explorer addresses
(explorer 403 from this
VM; Sourcify 404 on
common L2 chain ids).
This slice is the official
GitHub of the listed
matching money modules
plus CashAsset
deposit / withdraw.
Clones `/tmp/derive-v2-matching`
at `f6c20f4` and
`/tmp/derive-v2-core`
at `96796a6`.
No mainnet interaction.

Files:
`src/Matching.sol`,
`src/ActionVerifier.sol`,
`src/SubAccountsManager.sol`,
`src/modules/{Base,Deposit,Withdrawal,Transfer,Trade}Module.sol`,
`src/assets/CashAsset.sol`.

Checked for: a
stranger deposit that
credits the caller
without pulling that
owner; withdraw that
pays the caller from
another subaccount;
transfer that moves
a stranger's
balances; matching
execute that skips
the owner signature;
CashAsset withdraw
by a non-owner.

Result: no
user-exploitable
finding. Not
submitted.

- Matching
  `verifyAndMatch` is
  `onlyTradeExecutor`
  and an allowed
  module. Actions
  share one module.
  `_verifyAction`
  requires an unexpired
  EIP-712 signature
  from `owner` or a
  live session key, and
  `subAccountToOwner[id]
  == owner` (or unset
  for id 0).
- Deposit pulls
  `wrappedAsset` from
  `action.owner` and
  credits that owner's
  subaccount (or a new
  one mapped to
  `action.owner`).
  Withdraw calls
  `CashAsset.withdraw`
  to `action.owner`.
  Transfer requires
  both signed actions
  to share `owner`.
- TradeModule fills
  signed limit orders
  within
  `limitPrice` /
  `worstFee` /
  `desiredAmount`.
  Recipient must be
  the signed account
  or another account
  mapped to the same
  owner. Fee and fill
  price are
  executor-chosen
  inside those bounds.
- CashAsset `deposit`
  pulls `msg.sender`
  and credits the
  named account
  (donation).
  `withdraw` is
  `ownerOf(accountId)`
  only and pays
  `recipient`.
- SubAccountsManager
  maps deposited NFTs
  to `msg.sender` (or
  a named recipient).
  Complete-withdraw
  returns the NFT to
  that mapped owner
  after cooldown.

Do not file
permissioned trade
executor matching
inside signed
limits, owner
session-key
register, or
permissionless
donation deposit
as stranger theft.

Not submitted.
Listed leftover is
the matching
deposit / withdraw /
transfer / trade
path plus CashAsset.
Remaining listed:
DutchAuction /
SecurityModule /
StandardManager /
PMRM / Option /
Perp / BaseAsset /
feeds.
## 2026-09-03: SSV Network leftover (Sourcify)

Immunefi program
`SSV Network`
($250,000, `kyc: true`).
Unique unused standing
program. Not previously
logged. Ethereum
Sourcify `exact_match`
ERC1967 proxies:
SSV Network
`0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1`
impl
`0xa72a8F31163d74D708664493d09167dfa13008E9`
(`SSVNetworkSSVStakingUpgrade`),
SSV Network View
`0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4`
impl
`0xAdEb99eb2307F874D72b1F814fCa106f6BFaA8E9`
(`SSVNetworkViews`,
`match`). The Views
extract includes the
full module tree
used by the Network
proxy. No mainnet
writes. Extract
`/tmp/ssv-impl`.

Files:
`project/contracts/SSVNetwork.sol`,
`project/contracts/SSVNetworkViews.sol`,
`project/contracts/modules/SSVClusters.sol`,
`project/contracts/modules/SSVOperators.sol`,
`project/contracts/modules/SSVStaking.sol`,
`project/contracts/modules/SSVDAO.sol`,
`project/contracts/libraries/OperatorLib.sol`,
`project/contracts/libraries/CoreLib.sol`.

Checked for: a
stranger cluster
`withdraw` that pays
the caller from
another owner's
balance; operator
earnings withdraw
without
`checkOwner`;
`stake` that mints
CSSV without pulling
SSV; `withdrawUnlocked`
of another user's
cooldown queue;
DAO earnings
withdraw without
owner.

Result: no
user-exploitable
finding. Not
submitted.

- Cluster `deposit`
  adds `msg.value`
  to a named
  cluster (can fund
  another owner).
  `withdraw`
  validates the
  hashed cluster for
  `msg.sender` and
  pays that sender.
  `liquidate` pays
  the liquidator
  only when the
  caller is the
  owner or the
  cluster is
  liquidatable.
- Operator earnings
  withdraws call
  `checkOwner`
  (`operator.owner
  == msg.sender`).
- `stake` pulls SSV
  from `msg.sender`
  and mints CSSV to
  that sender.
  `requestUnstake`
  burns the caller's
  CSSV and queues
  that caller.
  `withdrawUnlocked`
  pays only that
  caller's matured
  requests.
  `claimEthRewards`
  pays
  `accrued[msg.sender]`.
- `rescueERC20`,
  `withdrawNetworkSSVEarnings`,
  fee / liquidation
  setters, and
  module upgrades
  are `onlyOwner` on
  `SSVNetwork`.
  Views has no
  money path.

Do not file
permissionless
liquidation of a
liquidatable
cluster, depositing
ETH into another
owner's cluster, or
owner DAO privilege
as stranger theft.

Not submitted.
Payment requires
user KYC.
Listed SSV Network
leftover is
exhausted at the
opened-contract
level.

## 2026-09-03: Derive leftover auction + security leftover (`96796a6`)

Immunefi program
`derive`
($50,000, `kyc: false`).
Matching + cash leftover
is already logged.
This slice is listed
`DutchAuction` and
`SecurityModule`.
Official clone
`/tmp/derive-v2-core`
at `96796a6`.
No mainnet interaction.

Files:
`src/liquidation/DutchAuction.sol`,
`src/SecurityModule.sol`.

Checked for: a
stranger `bid` that
uses another account
as bidder; solvent
bid that pulls cash
from the liquidated
account to the
caller; insolvent
payout that pays
`msg.sender`;
`requestPayout` by
a non-whitelisted
module; ownerless
`withdraw` from the
security module.

Result: no
user-exploitable
finding. Not
submitted.

- `startAuction`
  requires a
  whitelisted manager
  and
  maintenanceMargin
  < 0. Solvent start
  may pay a
  liquidation fee
  to the security
  module account.
- `bid` requires
  `ownerOf(bidderId)
  == msg.sender`,
  same manager, and
  a live auction
  that cannot yet
  terminate.
  Solvent bids pay
  `cashFromBidder`
  into the
  liquidated account
  via `executeBid`
  and reserve that
  cash. Insolvent
  bids request SM
  payout to
  `bidderId`; a
  shortfall calls
  `cash.socializeLoss`
  to that bidder.
- `terminateAuction`
  is permissionless
  once MM/BM is
  restored.
  `convertToInsolventAuction`
  requires the
  solvent bid price
  <= 0 and MM < 0.
- SecurityModule
  `withdraw` /
  `recoverERC20` are
  owner.
  `donate` pulls
  `msg.sender`.
  `requestPayout`
  is
  `onlyWhitelistedModule`
  and transfers cash
  to `targetAccount`.
  `payCashInsolvency`
  donates the SM
  cash balance.

Do not file
permissionless
undercollateralized
liquidation,
security-module
socialize-loss
print, or owner
whitelist / withdraw
as stranger theft.

Not submitted.
Listed leftover is
DutchAuction +
SecurityModule.
Remaining listed:
StandardManager /
PMRM / Option /
Perp / BaseAsset /
feeds.
## 2026-09-03: Royco factory + Makina strategy leftover (Sourcify)

Immunefi program
`Royco`
($250,000, `kyc: true`).
Unique unused standing
program. Not previously
logged. Ethereum
Sourcify `match`
ERC1967 Factory
`0x7cC6fB28eC7b5e7afC3cB3986141797ffc27253C`
impl
`0x34DB2f4215e55ec8e2c3dE0a826935EBF158be77`
(`RoycoFactory`);
same impl behind the
Arbitrum factory
proxy. Makina
strategy
`0xc5FeF644d59415cec65049e0653CA10eD9Cba778`
is Sourcify `match`
`RoycoVaultMakinaStrategy`.
srRoyUSDC
`0xcD9f5907…` and
Multisig Strategy
`0xd3F8Edff…` are
Sourcify 404. Official
clone
`/tmp/royco-makina`
`3ba424d`. No mainnet
writes. Extract
`/tmp/royco-src`.

Files:
`src/factory/RoycoFactory.sol`,
`src/RoycoVaultMakinaStrategy.sol`.

Checked for: a
stranger
`deployMarket` that
takes over an
existing tranche;
`allocateFunds` that
pulls a victim's
USDC; `onWithdraw`
that pays the
caller instead of
the vault;
`rescueToken` of the
machine share
token.

Result: no
user-exploitable
finding. Not
submitted.

- Factory
  `deployMarket` is
  `onlyAuthorized`
  and CREATE3-
  deploys new
  proxies. Role /
  upgrade setters
  are authorized.
- Strategy
  `allocateFunds` /
  `deallocateFunds` /
  `onWithdraw` are
  `onlyRoycoVault`.
  Allocate pulls
  the vault and
  deposits into the
  Makina machine
  for this
  strategy.
  Deallocate /
  withdraw redeem
  to `ROYCO_VAULT`.
  `rescueToken` is
  `restricted` and
  cannot sweep the
  machine share
  token.

Do not file
authorized market
deploy, vault-only
allocate /
deallocate, or
admin rescue of
non-share tokens
as stranger theft.

Not submitted.
Payment requires
user KYC.
Listed Royco
factory + Makina
strategy leftover
is exhausted at
the opened-contract
level. Remaining
listed: srRoyUSDC /
Multisig Strategy
(Sourcify 404),
the Safe, and the
website.

## 2026-09-03: Derive leftover assets leftover (`96796a6`)

Immunefi program
`derive`
($50,000, `kyc: false`).
Matching / cash /
auction leftovers
are already logged.
This slice is listed
`BaseAsset` /
`OptionAsset` /
`PerpAsset`.
Official clone
`/tmp/derive-v2-core`
at `96796a6`.
No mainnet interaction.

Files:
`src/assets/WrappedERC20Asset.sol`,
`src/assets/WLWrappedERC20Asset.sol`,
`src/assets/OptionAsset.sol`,
`src/assets/PerpAsset.sol`.

Checked for: a
stranger
`WrappedERC20`
withdraw that pays
the caller; option
`handleAdjustment`
that skips
allowance; perp
`settleRealizedPNLAndFunding`
by a non-manager;
whitelist deposit
that credits a
blocked account.

Result: no
user-exploitable
finding. Not
submitted.

- `WrappedERC20Asset.deposit`
  pulls
  `wrappedAsset`
  from `msg.sender`
  and credits the
  named account
  (donation).
  `withdraw` is
  `ownerOf(accountId)`
  only and pays
  `recipient`.
  `handleAdjustment`
  is `onlyAccounts`,
  rejects a
  negative balance,
  and always needs
  allowance.
- `WLWrappedERC20Asset.deposit`
  also requires a
  whitelisted
  recipient when
  `wlEnabled`.
- `OptionAsset.handleAdjustment`
  is `onlyAccounts`
  and always needs
  allowance.
  `calcSettlementValue`
  is a view; owner
  sets the
  settlement feed.
- `PerpAsset.handleAdjustment`
  is `onlyAccounts`
  and always needs
  allowance.
  `settleRealizedPNLAndFunding`
  is
  `onlyManagerForAccount`.
  `realizeAccountPNL`
  only updates
  stored pnl /
  funding, not cash.

Do not file
permissionless
donation deposit,
owner feed /
whitelist setters,
or manager-only
perp cash settle
as stranger theft.

Not submitted.
Listed leftover is
Base / Option /
Perp assets.
Remaining listed:
StandardManager /
PMRM / feeds.
