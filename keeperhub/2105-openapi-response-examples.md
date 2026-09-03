# KeeperHub #2105 — OpenAPI workflow-call response examples

**Do not implement against `keeperhub/keeperhub` before 6 September 2026.**
The official Agent Economy build window is 6–18 Sep. This file is the patch
spec so the first commit on the 6th is a failing test, not a design debate.

**Rechecked:** 3 September 2026 04:34 UTC

**Stop.** `tenk-earn` claimed this issue at 04:27 UTC and opened
[PR #2275](https://github.com/KeeperHub/keeperhub/pull/2275) against
`staging` (`Closes #2105`, OpenAPI route + unit tests). Do not open a
second #2105 PR. Keep this file as historical spec only.

| Fact | Evidence |
| --- | --- |
| Issue | https://github.com/KeeperHub/keeperhub/issues/2105 — still `open`, labels `accepted` + `confirmed`, last update 2026-09-03 |
| Competing PR | **#2275** by `tenk-earn` (open, mergeable, targets `staging`) |
| Target branch | `staging` |
| Focused suite | `tests/unit/openapi-route.test.ts` (27 tests on `d249519`) |

Already have PRs — do not duplicate: #2208→#2215, #2211→#2217, #2206→#2213, #2230→#2228, #2196→#2197.

## Gap

`app/api/openapi/route.ts`, `buildPathEntry`, hardcodes two 200-response schemas
and never sets `example` / `examples`:

- Write: `{ type, to, data, value }`
- Read: `{ executionId, status }`

Issue #2105 asks for values on **both** schemas. One change covers every
`/api/mcp/workflows/{slug}/call` route.

## OpenAPI 3.1 rule

A Schema Object uses a bare `examples` **array**. A Media Type Object uses
`example` or a named `examples` map. KeeperHub already uses schema-level
`examples` arrays (`ERROR_SCHEMA.properties.error.examples`). Stay consistent:
put the array on the Schema Object, not on the media type.

## Exact examples to add

Write (unsigned calldata):

```json
{
  "type": "calldata",
  "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "data": "0xa9059cbb000000000000000000000000111111111111111111111111111111111111111100000000000000000000000000000000000000000000000000000000000f4240",
  "value": "0x0"
}
```

Read (execution started):

```json
{
  "executionId": "exec_01JEXAMPLE0000000000000000",
  "status": "running"
}
```

`status` is already `const: "running"` in the schema. Do not invent extra
fields (`output`, `transactionHashes`) — the issue asks for the **hardcoded**
response shapes only.

## Failing tests to add first

Append to `tests/unit/openapi-route.test.ts`. Reuse the existing mock-db
pattern. Suggested names:

```ts
it("adds example values to write-type 200 response schemas", async () => {
  // listed write workflow
  const schema = body.paths["/api/mcp/workflows/free-write/call"].post
    .responses["200"].content["application/json"].schema;
  expect(schema.examples).toEqual([
    {
      type: "calldata",
      to: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/),
      data: expect.stringMatching(/^0x[0-9a-fA-F]+$/),
      value: expect.stringMatching(/^0x/),
    },
  ]);
});

it("adds example values to read-type 200 response schemas", async () => {
  const schema = body.paths["/api/mcp/workflows/paid-workflow/call"].post
    .responses["200"].content["application/json"].schema;
  expect(schema.examples[0]).toEqual({
    executionId: expect.any(String),
    status: "running",
  });
});
```

Watch them fail because `examples` is undefined. Then add the arrays in
`buildPathEntry` only. Do not touch discovery paths or error responses.

## Implementation sketch

Inside the write and read `schema` objects in `buildPathEntry`:

```ts
examples: [WRITE_CALL_EXAMPLE], // or READ_STARTED_EXAMPLE
```

Hoist the two constants next to `ERROR_SCHEMA`. No new dependencies.

## PR

- Branch from current `origin/staging` on 6 Sep (re-fetch; do not assume `d249519`).
- Title: `fix(openapi): #2105 add workflow response examples`
- Body: `Closes #2105` plus a one-paragraph note that examples are schema-level
  arrays to match OpenAPI 3.1 and existing `Error` examples.
- Target: `staging`
- Commands after the green test:

```bash
export PATH="$(dirname "$(nvm which 24)"):$PATH"
corepack prepare pnpm@10.33.3 --activate
pnpm exec vitest run tests/unit/openapi-route.test.ts
pnpm discover-plugins   # if type-check misses generated registries
pnpm fix
pnpm type-check
```

- Comment on #2105 to claim it **before** pushing, after confirming no new PR
  appeared overnight.
- Separate DoraHacks BUIDL for the feature bounty, using the participant's
  GitHub and DoraHacks accounts. This VM cannot open that PR.

## What this is not

Not source for KeeperHub. Not a submission. Not earnings. The bounty pays after
an official winner result and a stablecoin transfer to the participant's wallet.
