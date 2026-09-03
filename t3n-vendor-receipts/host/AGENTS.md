# T3N host (Vendor Receipts)

Official ADK skill: https://docs.terminal3.io/developers/adk/support/ai-coding-assistants

Order we already followed: ESM `package.json`, keys only in the environment, `quickstart` before register, contract in a sibling folder, WASM path across folders.

Do not write `T3N_API_KEY` or `T3N_AGENT_KEY` into a file. Do not derive `did:t3n:` from a wallet. Tenant key ≠ agent key.

This contract has no outbound HTTP. Do not add `http` / `http-with-placeholders` or a `secrets` map unless the product changes.
