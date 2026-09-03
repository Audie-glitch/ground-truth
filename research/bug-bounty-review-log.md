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

Time spent: roughly 70 minutes. No Immunefi report. Next Immunefi candidate is
1inch Aqua (KYC required to be paid).
## 2026-09-03: 1inch Aqua core and swap-vm entry (KYC program, $100k max)

Read in full: `aqua/src/*` (Aqua.sol, AquaApp.sol, AquaRouter.sol, Balance.sol,
IAqua.sol; 342 lines) and `swap-vm/src/SwapVM.sol` (order hashing, quote/swap
entry, transfer-in path with Aqua push/pull and native ETH handling), plus the
`TransientLock`/`TransientLockUnsafe` libraries from solidity-utils.

Checked for: virtual-balance accounting bounds (ship/dock/pull/push), duplicate
tokens in ship/dock, docked-strategy behaviour, checks-effects-interactions
around `transferFrom`, uint248 packing overflow/underflow, reentrancy on
per-order transient locks, signature vs Aqua-mode hashing consistency, msg.value
handling with WETH.

Result: no finding at this depth.

- `pull` and `push` update packed balances before any token movement; checked
  arithmetic bounds pulls to what the maker shipped and blocks pushes to docked
  or non-existent strategies. Docking requires the full token list, so partial
  docks and duplicates revert. Shipped strategies are immutable per
  (maker, app, hash) forever, including after docking.
- "Unsafe" in `TransientLockUnsafeLib` refers only to slot addressing for
  mapping-derived slots; `lock()` still reverts when already held, so a taker
  callback cannot re-enter the same order.
- Aqua-mode orders hash as `keccak256(abi.encode(order))` without a domain
  separator; that is consistent with `Aqua.ship` hashing the same bytes and
  needs no signature, so cross-domain replay is not a concern for them.
- Not reviewed: the opcode instruction set (XYC curves, pegged-swap math, TWAP
  decay, fee accounting, invalidators, whitelist), roughly 6,000 lines. That is
  where a real finding would live and it needs a multi-day pass with the test
  suite, not a time-box.

Useful for the ETHOnline "Build an Aqua App" bounty ($5,000): an Aqua app is a
contract that (1) inherits `AquaApp`, (2) is the `app` makers `ship` a strategy
to while keeping tokens in their own wallets, (3) prices and settles swaps
against `AQUA.safeBalances`, pulling maker tokens with `AQUA.pull` and requiring
the taker's `AQUA.push` inside a `nonReentrantStrategy` lock via
`_safeCheckAquaPush`. The swap-vm router is the reference app; a smaller
purpose-built app (a fixed-spread stablecoin pair, or an RFQ-style strategy) is
a realistic hackathon deliverable.

## Next candidates

Reviewed so far without a finding: Enzyme Onyx ACE scope, GMTrade builder-fee,
treasury and LP paths, 1inch Aqua core and the swap-vm entry. Remaining
candidates with real depth: the swap-vm opcode set (multi-day budget), GMTrade
`programs/store` order execution and liquidation paths (Rust, multi-day), sBTC
(Rust/Clarity, KYC). Sherlock had no active contests as of 3 Sep 2026. No
implementation on the KeeperHub feature bounty before the 6 Sep build window.
