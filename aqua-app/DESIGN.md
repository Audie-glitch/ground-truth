# AquaFloor — reserved-inventory AMM on Aqua + SwapVM

Design only. ETHOnline 2026 Start Fresh: no project-specific Solidity,
tests, or UI before **4 September 2026 16:00 UTC**. This document is
the plan the first in-window commits follow.

Official prize: [Build an Aqua App](https://ethglobal.com/events/ethonline2026/prizes/1inch)
($2,500 / $1,500 / $1,000). Continuity-track $2,000 is a **separate**
prize — do not enter this as Continuity.

## Problem

Aqua lets a maker ship one inventory across many strategies without
custody. Official examples (`XYCSwap`, concentrate, pegged, Decay) can
still sell the book to zero. Treasuries, market-makers, and payroll
wallets want a **hard floor**: a slice of each token that swaps must
not pull, while the remainder still quotes.

That is a position, not a feature request against 1inch: a maker-chosen
program that the existing Aqua registry already understands.

## Why SwapVM (judges score this higher)

The official page: *“If you use SwapVM, you may modify SwapVM opcodes
and define your own instructions. Projects that utilize SwapVM will be
scored higher.”* Redeploying a modified SwapVM router is allowed.
Official Aqua must stay the registry.

Live addresses (same on every supported chain; from `1inch/aqua`
README):

| Contract | Address |
| --- | --- |
| Aqua registry | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a` |
| Production SwapVM router | `0x111111338c5091e8440b67b168bae16a668ac0de` |

The demo **redeploys** a forked router. Makers ship to the new router
as `app`. Production Aqua is unchanged. Local-fork token transfers
satisfy the on-chain-execution rule.

## Position

A maker ships `tokenA < tokenB` with virtual amounts `(amountA, amountB)`
and a program:

```
Deadline(ts)
Decay(period)            # existing; inventory that just traded is stale
XYCSwap                  # existing constant-product, maker-favorable rounding
ReserveFloor(floorA, floorB)   # NEW — 0x27
Stop
```

Alternate book (wire the already-written opcode that AquaOpcodes omits):

```
Deadline(ts)
TWAPSwap(...)            # 0x9d exists in swap-vm, not dispatched by AquaOpcodes
ReserveFloor(floorA, floorB)
Stop
```

`ReserveFloor` runs **after** the curve has written `ctx.swap.amountIn`
/ `amountOut`. It does not call `runLoop`. It asserts the outgoing
token still has `balanceOut - amountOut >= floorOut`. Incoming token
balance only grows, so its floor is a no-op on that hop.

Encoding matches `StaticBalances`: `[uint256 floorA][uint256 floorB]`,
sorted `tokenA < tokenB`. Header is the standard 2-byte
`InstructionBuilder` record (`opcode`, `argsLength`).

```
error FloorBreached(address token, uint256 remaining, uint256 floor);
```

## File-level plan (write only after the window)

Clone `1inch/swap-vm` and `1inch/aqua` as git submodules or Foundry
deps. Do **not** copy CreditPassport, SignLens, or XYCSwap.sol from
`1inch/aqua/examples` as the product — the product is the new opcode
plus a shipped program.

| Path | Purpose |
| --- | --- |
| `src/instructions/ReserveFloor.sol` | `Opcode._27` (`0x27`, next free slot in the conditions bank). `build` / `parse` / `exec`. |
| `src/opcodes/AquaFloorOpcodes.sol` | Copy of `AquaOpcodes._runOpcode` plus `ReserveFloor` and `TWAPSwap`. |
| `src/routers/AquaFloorRouter.sol` | `Simulator + SwapVM + AquaFloorOpcodes`, same constructor args as `AquaSwapVMRouter`. |
| `src/libs/OpcodeList.sol` | Only if we vendor the enum; prefer importing upstream and using `Opcode._27`. |
| `script/ShipFloorBook.s.sol` | Anvil: mint mocks, `approve` official-or-local Aqua, `ship` the program, fill exact-in both directions. |
| `test/ReserveFloor.t.sol` | Floor holds; a fill that would breach reverts; opposite hop still works; Decay + floor together. |
| `web/` | One page: ship amounts + floors, quote, swap. Optional on day 2. |
| `README.md` | What it is, how to run, which files changed vs upstream SwapVM. |

Qualification checklist from the prize page:

- Official Aqua (or a local deploy of unmodified `Aqua.sol` / `AquaRouter`)
- Modified SwapVM router redeployed
- Token transfers in tests or UI (anvil / local fork is enough)
- Proper commit history (no single-commit dump on 16 Sep)

## What not to do

- Do not submit this as Continuity.
- Do not touch production SwapVM `0x1111…c0de` with a malicious
  program; ship against the **new** router.
- Do not inherit `Simulator` onto a new contract that holds maker
  allowances beyond what upstream already does. The Immunefi review of
  `Simulator` (`research/bug-bounty-review-log.md`, 3 Sep) concluded
  the outer `revert Simulated` unwinds the frame. Still: do not add
  new allowance surfaces.
- Do not file `ReserveFloor` to Immunefi `1inch-aqua-improvement`.
  That program rejects new protocol mechanics / feature requests.
- Do not write Aqua / SwapVM source in this repo before 4 Sep 16:00 UTC.

## Day-1 (4 Sep, after kickoff) vs later

Day 1: Foundry root, `ReserveFloor.sol`, opcode wire-up, one passing
test that a 1000/1000 book with floors 200/200 rejects a fill that
would leave 199. Commit small.

Day 2: Decay + TWAP variants, ship script, README.

Day 3+: one-page UI, demo video ≤ 5 minutes, ETHGlobal submission
pointing at the public repo.

## Human blockers

Same as the other ETHOnline tracks: ETHGlobal hacker application +
0.01 ETH stake. No extra API keys. Anvil is enough for the demo.
A public GitHub repo is required for the submission.
