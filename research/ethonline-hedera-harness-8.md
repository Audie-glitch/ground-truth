# ETHOnline backup: Hedera Harness issue #8

Read-only prep. No harness source until the ETHOnline window is open
(4 Sep 2026 16:00 UTC). Open PR is enough for the Hedera OSS bounty.

**Rechecked:** 3 September 2026 02:41 UTC

| Fact | Evidence |
| --- | --- |
| Issue | https://github.com/hedera-dev/hedera-harness/issues/8 — `open`, authored by maintainer `kantorcodes` on 2026-08-13, 0 comments |
| Competing PR | No linked PR on the issue. Do not start a PR before 4 Sep. |
| Bounty | Hedera “Open Source, Improve the Hedera Harness” — $1,000 × 2; open PR counts |

## What to build (from the issue, mapped onto the repo)

The harness already treats ASSERT as the cheap gate (files, static
assertions, secret scanning, command validation) and converts those into
native `ValidationFinding` records. Issue #8 asks for an **opt-in** HOL
Guard / `plugin-scanner` validator in that same stage.

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

## First files to open on 4 Sep

From the published tree: `src/` (ASSERT + `ValidationFinding`), `test/`,
`docs/authoring-a-recipe.md`, `skeletons/project-harness` (recipe comments),
`prompts/` only if ASSERT output is mentioned to the agent.

Do not copy this note into the harness repo. Recheck the issue and PRs
immediately before coding.
