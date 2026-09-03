# ETHOnline: 1inch “Build an Aqua App” (AquaFloor)

Read-only prep. No Aqua / SwapVM product code until the ETHOnline
window is open (4 Sep 2026 16:00 UTC).

**Rechecked:** 3 September 2026 ~03:30 UTC

| Fact | Evidence |
| --- | --- |
| Prize page | https://ethglobal.com/events/ethonline2026/prizes/1inch (HTTP 200). Start Fresh $2,500 / $1,500 / $1,000. Continuity $1,500 / $500 is a **separate** prize. |
| Qualification | Official Aqua/SwapVM; modified SwapVM redeploy allowed; on-chain token transfers (local forks ok); no single-commit dump on the last day. SwapVM use is scored higher. |
| Aqua tree | local `/tmp/aqua` at `9c5c42e`. Live registry `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`. |
| SwapVM tree | local `/tmp/swap-vm`. Live router `0x111111338c5091e8440b67b168bae16a668ac0de`. |
| Design | [`../aqua-app/DESIGN.md`](../aqua-app/DESIGN.md). Kickoff: [`../aqua-app/KICKOFF.md`](../aqua-app/KICKOFF.md). |

## Why this position

Official Aqua opcodes already do XYC, concentrate, pegged, Decay, and
fees. They do not enforce a **maker reserve**: a floor that must
remain after a fill. Treasuries shipping shared inventory want that
constraint on-chain, not in an off-chain bot.

`OpcodeList` marks `0x27` as `_27` in the conditions bank (“take the
next free `_Ix` slots of their family bank”). `TWAPSwap` (`0x9d`)
already exists in `src/instructions/TWAPSwap.sol` but is **not**
wired in `AquaOpcodes._runOpcode`. Both are in-window work.

## Opcode sketch (do not implement yet)

`ReserveFloor` encoding: `[uint256 floorA][uint256 floorB]`,
`tokenA < tokenB`, same sort as `StaticBalances` / `MakerTraits`.

`exec` (after the curve opcode has set amounts):

- map `(floorA, floorB)` onto `(floorIn, floorOut)` by token order
- `require(ctx.swap.balanceOut >= ctx.swap.amountOut + floorOut)`
- revert `FloorBreached(tokenOut, remaining, floorOut)` otherwise

Do not call `runLoop`. `XYCSwap.exec` only writes amounts;
`SwapVM` settles Aqua `pull` / `push` after the program.

## Immunefi (do not confuse with this prize)

`1inch-aqua` ($100k, KYC) and `1inch-aqua-improvement` ($25k, KYC)
already had their Aqua-listed solidity-utils + opcode pass: no
finding, no improvement proposal. `ReserveFloor` is a new mechanic.
The improvement program’s own OOS list rejects “new features or
protocol mechanics”. Ship it as an ETHOnline app, not an Immunefi
report.

## Competing work

None in this repo. Do not start a second Aqua App. If 1inch publishes
a starter during the kickoff, prefer their official Aqua + SwapVM
imports and keep the floor opcode.
