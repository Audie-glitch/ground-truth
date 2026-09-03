# ETHOnline 2026 — AquaFloor kickoff

Event window: **4–16 September 2026**. Start Fresh: no AquaFloor
Solidity, tests, or UI before the official start.

**Checked:** 3 September 2026 ~03:30 UTC. Official prize page
https://ethglobal.com/events/ethonline2026/prizes/1inch HTTP 200.
`1inch/aqua` at `9c5c42e`, `1inch/swap-vm` at local `/tmp/swap-vm`.
npm is not involved; this is Foundry.

First commit is allowed from **16:00 UTC on 4 September 2026** after
the ETHGlobal schedule still says the hackathon has opened. If their
kickoff is later that day, wait. Small frequent commits inside the
window.

## Minute-one scaffold (run only after the window is open)

```bash
cd /workspace
mkdir -p tmp-aquafloor && cd tmp-aquafloor
forge init --no-commit
# add 1inch/aqua and 1inch/swap-vm as remappings / deps
# First commit: README + ReserveFloor.sol + one revert test.
# Then move the tree to /workspace/aqua-app/ (this folder is design-only today).
```

Do **not** copy CreditPassport, SignLens, or `1inch/aqua/examples/apps/XYCSwap.sol`
into the product tree. Disclose `@1inch/aqua`, `@1inch/swap-vm`,
`@1inch/solidity-utils`, and OpenZeppelin as pre-existing libraries.

## Day-1 file list (from DESIGN.md)

| Path | Purpose |
| --- | --- |
| `src/instructions/ReserveFloor.sol` | New opcode at `Opcode._27` |
| `src/opcodes/AquaFloorOpcodes.sol` | Aqua set + ReserveFloor + TWAPSwap |
| `src/routers/AquaFloorRouter.sol` | Redeployable SwapVM router |
| `test/ReserveFloor.t.sol` | Floor holds / floor breach |
| `README.md` | What it is, how to run |

Wire `ReserveFloor` **after** `XYCSwap` / `TWAPSwap` in the maker
program. Do not call `ctx.runLoop()` from the new opcode.

## Parallel ETHOnline work that day

1. x402 statement API scaffold (`x402-api/KICKOFF.md`) — Hedera / Bazantic / Arc.
2. This router + one test — 1inch Aqua App.
3. If capacity: Uniswap/sdks#720 and Hedera Harness #8 (open PR is enough).

Do not collapse AquaFloor into the x402 repo. Separate public repo or
a clearly separate directory with its own commit history.

## Human blockers still open

- ETHGlobal hacker application + 0.01 ETH stake (refunded on submit).
- Public GitHub repo for the ETHGlobal form.
