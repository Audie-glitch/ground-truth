# KeeperHub #2105 prep (OpenAPI response examples)

**Issue:** [keeperhub/keeperhub#2105](https://github.com/keeperhub/keeperhub/issues/2105)  
**Participant:** Audie-glitch  
**Build window opens:** 6 September 2026 — **do not push the fix before then**  
**Target branch:** `staging`  
**Primary test:** `pnpm exec vitest run tests/unit/openapi-route.test.ts`

## Problem

`buildPathEntry` in `app/api/openapi/route.ts` hardcodes 200-response schemas for workflow `/call` routes without `example` or `examples`. Live spec at `https://app.keeperhub.com/openapi.json` has **zero** example values across all workflow routes.

## Fix (implement on or after 6 Sep)

In `buildPathEntry`, add schema-level `examples` arrays (matches existing pattern in the same file, e.g. rate-limit header enums):

**Write branch (lines ~259–267):**

```typescript
schema: {
  type: "object",
  properties: {
    type: { type: "string", const: "calldata" },
    to: { type: "string" },
    data: { type: "string" },
    value: { type: "string" },
  },
  examples: [
    {
      type: "calldata",
      to: "0x0000000000000000000000000000000000000001",
      data: "0x",
      value: "0",
    },
  ],
},
```

**Read branch (lines ~277–283):**

```typescript
schema: {
  type: "object",
  properties: {
    executionId: { type: "string" },
    status: { type: "string", const: "running" },
  },
  examples: [
    {
      executionId: "exec_01HZZZZZZZZZZZZZZZZZZZZZZZ",
      status: "running",
    },
  ],
},
```

Adjust example IDs/addresses if maintainers prefer different placeholders.

## Failing test to add first (test-first)

Append to `tests/unit/openapi-route.test.ts`:

```typescript
describe("#2105 workflow-call 200-response examples", () => {
  it("free read workflow 200 schema includes examples with executionId and status", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "wf-read",
            name: "Read Workflow",
            description: null,
            listedSlug: "read-wf",
            inputSchema: null,
            priceUsdcPerCall: "0",
            workflowType: "read",
            category: null,
            chain: null,
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/openapi/route");
    const response = await GET(new Request("https://app.keeperhub.com/api/openapi"));
    const body = await response.json();
    const schema =
      body.paths["/api/mcp/workflows/read-wf/call"].post.responses["200"].content[
        "application/json"
      ].schema;

    expect(schema.examples).toEqual([
      expect.objectContaining({
        executionId: expect.any(String),
        status: "running",
      }),
    ]);
  });

  it("free write workflow 200 schema includes calldata examples", async () => {
    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: "wf-write",
            name: "Write Workflow",
            description: null,
            listedSlug: "write-wf",
            inputSchema: null,
            priceUsdcPerCall: null,
            workflowType: "write",
            category: null,
            chain: null,
          },
        ]),
      }),
    });

    const { GET } = await import("@/app/api/openapi/route");
    const response = await GET(new Request("https://app.keeperhub.com/api/openapi"));
    const body = await response.json();
    const schema =
      body.paths["/api/mcp/workflows/write-wf/call"].post.responses["200"].content[
        "application/json"
      ].schema;

    expect(schema.examples).toEqual([
      expect.objectContaining({
        type: "calldata",
        to: expect.any(String),
        data: expect.any(String),
        value: expect.any(String),
      }),
    ]);
  });
});
```

Run before fix — expect **FAIL**. After fix — **PASS**.

## PR checklist (after 6 Sep)

1. Comment on #2105: “Claiming for Agent Economy bounty — PR incoming.”
2. Branch from `staging`: `fix/openapi-2105-response-examples`
3. Title: `fix(openapi): #2105 add workflow response examples`
4. Body: `Closes #2105`
5. `pnpm exec vitest run tests/unit/openapi-route.test.ts`
6. `pnpm fix && pnpm type-check`
7. Open PR against **`staging`** (not `main`)
8. Register separate DoraHacks BUIDL with source link + demo if required

## Bounty submission artifacts

- GitHub PR URL
- Short demo (screen recording of OpenAPI JSON showing examples) — optional but helps judging
- DoraHacks registration: [Agent Economy hackathon](https://dorahacks.io/hackathon/agent-economy/detail)
- Payout wallet: **your** EVM address (never share seed phrase)

## Status (3 Sep 2026)

- [x] Issue read; staging cloned locally
- [x] Failing test drafted above
- [x] Fork pushed with **failing test only** (pre-Sep-6): [Audie-glitch/keeperhub `prep/2105-failing-test`](https://github.com/Audie-glitch/keeperhub/tree/prep/2105-failing-test)
- [ ] Implementation + PR to upstream `staging` (on or after 6 Sep)
- [ ] DoraHacks BUIDL submitted
