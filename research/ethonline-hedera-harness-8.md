# ETHOnline backup: Hedera Harness issue #8

Read-only prep. No harness source edits and no PR until the
ETHOnline window is open (4 Sep 2026 16:00 UTC). An open PR
is enough for the Hedera OSS bounty.

**Rechecked:** 3 September 2026 03:20 UTC

| Fact | Evidence |
| --- | --- |
| Issue | https://github.com/hedera-dev/hedera-harness/issues/8 — `open`, authored by maintainer `kantorcodes` on 2026-08-13, 0 comments |
| Competing PR | GitHub search `HOL Guard type:pr` = **0**. Do not start a PR before 4 Sep. |
| Tree used for this map | local clone `/tmp/hedera-harness` at `e045b10` (2026-08-16, “Merge pull request #10 … tier3-mcp-delivery”). Do not copy this note into that repo. |
| Bounty | Hedera “Open Source, Improve the Hedera Harness” — $1,000 × 2; open PR counts |

## What to build

The harness already treats ASSERT as the cheap gate and
converts those checks into native `ValidationFinding`
records. Issue #8 asks for an **opt-in** HOL Guard /
`plugin-scanner` validator in that same stage.

Suggested recipe shape (do not ship enabled by default):

```yaml
validators:
  holGuard:
    enabled: true
    profile: strict-security
    failOnSeverity: high
```

Local scanner command the issue names:

```bash
uvx --from hol-guard plugin-scanner scan . --format json
```

Implementation rules the maintainer already wrote:

1. Run only when `enabled: true`.
2. ASSERT, after existing static/secret checks, before SMOKE/EVALUATE.
3. Convert scanner findings to `ValidationFinding` with ids `hol-guard::<id>`.
4. Missing binary or malformed JSON is a **harness/infrastructure** abort, not
   an app finding the agent should “repair”.
5. No HOL Guard Cloud, telemetry, or GitHub workflow.
6. Existing recipes unchanged unless the validator is enabled.
7. `doctor` reports whether the configured scanner is on PATH.

## File-level map (`e045b10`) — open these first on 4 Sep

Current `validators` schema is **three path strings only**.
`src/specLoader.ts` `readValidators` returns
`{ staticPath, commandsPath, playwrightPath? }`. Unknown
keys are ignored, so an object `holGuard:` is backward
compatible if we add an optional reader.

| File | Why |
| --- | --- |
| `src/types.ts` | `TemplateSpec.validators` (~213) and `ValidationFinding.category` union (~276). Add optional `holGuard` config. Prefer a new category `hol-guard` (or reuse `static` if you want a smaller diff). |
| `src/specLoader.ts` | `readValidators` (~179). Parse `validators.holGuard` as an **object**, not via `readOptionalValidatorPath` (that helper requires a string path and would reject the object). |
| `src/specDefaults.ts` | Default `holGuard.enabled = false`. Do not bump `SPEC_SCHEMA_VERSION` (additive field). |
| `src/validation/index.ts` | `runDeterministicValidation` (~79) already runs files → static → secrets → commands → optional Playwright. Call HOL Guard after secrets (or after commands) **only if enabled**. |
| `src/validation/holGuard.ts` | **New.** Spawn the scanner, parse JSON, map to `ValidationFinding` ids `hol-guard::<id>`. Missing binary / bad JSON → infrastructure failure, not an open app finding. |
| `src/attemptStages.ts` | `runAssertStage` (~176) already delegates to `runDeterministicValidation`. No stage-order change if the hook is inside that function. Stages are GENERATE → ASSERT → SMOKE → EVALUATE. |
| `src/doctor.ts` | `checkOptionalDeps` (~259). When the recipe has `holGuard.enabled`, report whether `uvx` / the configured scanner is on PATH. |
| `src/optionalDeps.ts` | Pattern for optional peer deps (`importPlaywright`). HOL Guard is a CLI, not an npm import — PATH check belongs in doctor, not here. |
| `skeletons/project-harness/spec.yaml` | Comment-only default next to the existing `validators:` block (~34). Do not enable it. |
| `docs/authoring-a-recipe.md` | One short subsection under validators. |
| `test/spec-schema.test.mjs`, `test/slices.test.mjs`, `test/doctor.test.mjs` | Follow existing fixtures: disabled by default; enabled + missing binary is infra; enabled + fixture JSON maps ids. |

Do not touch `prompts/` unless ASSERT output is mentioned
to the agent (issue says existing recipes stay unchanged).

Do not copy this note into the harness repo. Recheck the
issue and PRs immediately before coding.
