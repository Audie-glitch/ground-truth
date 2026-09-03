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

## Next candidates

1inch Aqua (Solidity, KYC, overlaps with ETHOnline Aqua work) or a later pass
on `programs/treasury` / `programs/liquidity-provider` after the hackathon
windows close.
