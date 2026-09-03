# KeeperHub main track plan: KeeperHub as the execution layer for elizaOS agents

Track: Best Integration into a Live Project ($2,000 / $1,200 / $800, ranked).
Build phase Sep 6-18, submissions close Sep 18 12:00 CEST. Separate BUIDL from
the #2240 feature bounty (one BUIDL per track).

## Why elizaOS

The brief asks for a real, running project on the other side and an
integration specific to it, with value actually moving through KeeperHub.
elizaOS is a widely deployed open-source agent framework with a plugin system
(`@elizaos/core`: actions with `validate`/`handler`, providers, services,
routes) and a public plugin registry. Its agents already hold wallets and move
funds through ad-hoc plugins; none of them gets nonce management, MEV-protected
routing, retries, dry runs, or an audit trail. A `plugin-keeperhub` gives every
Eliza agent exactly that, which is the pitch KeeperHub itself makes.

## What the plugin does

Package: `plugin-keeperhub` (TypeScript, `@elizaos/core` peer dependency,
scaffolded with `elizaos create --type plugin`).

Actions (each with a `validate` that checks the API key and parses intent, and
a `handler` that returns a structured result the agent can speak):

| Action | Behaviour |
| --- | --- |
| `KEEPERHUB_DRY_RUN` | Compose a transfer or protocol action from natural language (token, amount, recipient, chain) into a KeeperHub workflow and run KeeperHub's simulation. Returns the exact workflow JSON, estimated gas, and the audit-trail link. Nothing touches the chain. |
| `KEEPERHUB_EXECUTE` | Execute a previously dry-run workflow by id with an idempotency key derived from the conversation, so a repeated instruction cannot double-send. Returns the execution id and transaction hash. |
| `KEEPERHUB_STATUS` | Fetch an execution's status and audit trail (retries, gas used, routing) and summarise it. |
| `KEEPERHUB_BALANCES` | Read the agent's KeeperHub non-custodial wallet balances per chain. |

Provider: `keeperhubContext` injects the wallet address, supported chains, and
any pending dry run into the agent's state so the model can reason about it.

Service: `KeeperHubService` wraps the REST API (`docs.keeperhub.com`) with
auth, rate-limit backoff, and typed errors; the MCP server is used where the
API is only exposed there.

Safety model, which is also the demo story: the agent can never execute what
it did not dry-run first; the dry run output is shown to the user verbatim; the
idempotency key makes "send it again" a no-op; and every execution links to
KeeperHub's audit trail.

## Deliverables

- The plugin repository with tests (action validation, request shaping,
  idempotency key derivation, error mapping) run with the elizaOS test
  harness plus Vitest.
- A demo character config: an agent that pays a testnet USDC invoice on
  request. The demo video shows the conversation, the dry run, the execution,
  the transaction on an explorer, and the audit trail in KeeperHub.
- A PR adding the plugin to the elizaOS plugin registry (open PR is enough
  for the demo; acceptance is a bonus).
- Submission form answers: project integrated (elizaOS), KeeperHub surfaces
  used (REST API, MCP, audit trail, dry run), testnet, candid list of what is
  unfinished.

## What only you can do

- A KeeperHub account with an organization API key, stored as the Cloud Agent
  secret `KEEPERHUB_API_KEY` (never pasted in chat). KeeperHub wallets are
  non-custodial via Turnkey; the account setup is a human flow.
- Fund the agent's KeeperHub wallet with testnet gas and testnet USDC on the
  chain we demo (Base Sepolia or Sepolia).
- A model API key for the Eliza agent in the demo (`OPENAI_API_KEY` or
  `ANTHROPIC_API_KEY`), or I run the demo with a local small model if none.

## Schedule inside the window

- Sep 6-8: #2240 feature bounty implementation (priority; smaller and the
  maintainers' Tier 1 ask).
- Sep 9-14: plugin: service, actions, provider, tests, demo character.
- Sep 15-16: registry PR, demo recording, submission text.
- Sep 17: buffer; Sep 18: submit both BUIDLs before 12:00 CEST.

If the KeeperHub API key is not available by Sep 9, the main-track entry is
dropped and the time goes to hardening #2240.
