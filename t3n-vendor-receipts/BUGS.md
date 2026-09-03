# Bugs and doc mismatches found while building Vendor Receipts

Filed for the T3N challenge’s “bug submission quality” criterion. Checked against https://docs.terminal3.io (markdown pages) and https://github.com/Terminal-3/z-tenant-flight on 3 Sep 2026. None of these are security exploits; they are the things that cost time.

## 1. Flight README contradicts the crate (PII path)

`z-tenant-flight` README (still titled v0.3.0) says `book-offer` takes a `passengers[]` array with passport / DoB / email, and that “PII enters T3 Network here.”

The crate at v0.4.1 and [write-contract.md](https://docs.terminal3.io/developers/adk/get-started/walkthrough/write-contract) use `http-with-placeholders` and `{{profile.*}}`. `book_offer` deserialises `{ offer_id, passenger_id, total_amount, total_currency }` and a payload with `passengers` fails at parse (“bad input”).

The sequence diagram in the README is the old, less-safe design.

## 2. Documented `cargo test` vs default WASM target

The flight repo’s `.cargo/config.toml` sets `build.target = "wasm32-wasip2"`. The README and [test.md](https://docs.terminal3.io/developers/adk/get-started/walkthrough/test.md) say to run `cargo test` / `cargo test --lib` on the native target.

On a machine without that default, `cargo test` is native and works. With the file as shipped, `cargo test` tries to run tests on `wasm32-wasip2` and the host-only functions error. Workaround: `cargo test --lib --target x86_64-unknown-linux-gnu`. This repo does **not** set a default target.

## 3. `create-kv-maps` assumes every contract has `secrets`

[Create Tenant KV Maps](https://docs.terminal3.io/developers/adk/tips/create-kv-maps) opens with “A TEE contract needs one map before it can run: `secrets`.” That is true for Duffel. A KV-only enterprise contract needs a different tail (`receipts` here). The ACL rule is the useful part: omit `readers` and the governor denies, including to the contract that just wrote.

## 4. Re-register allocates a new `contract_id` with no fetch API

Documented in [register-contract.md](https://docs.terminal3.io/developers/adk/get-started/walkthrough/register-contract). Hitting this during a demo looks like “the map is empty” or `AccessDenied` after a version bump. Operators must log every `contract_id` and `maps.update` the ACL. There is still no “get current id for tail” helper.

## 5. Two claim URLs, one “shown once” key

The Superteam listing sends builders to https://go.terminal3.io/adk-community. The docs send them to https://www.terminal3.io/claim-page. Both are official. The key is shown once. An agent needs a **second** visit and a **second** key; reusing `T3N_API_KEY` is the documented cause of `InsufficientCreditError`.

## 6. Latest crates.io + wit-bindgen 0.49 wants Rust ≥ 1.85

Resolving `wit-bindgen 0.49` today pulls `hashbrown 0.17` / `indexmap 2.14`, whose manifests use `edition2024`. Cargo 1.83 (still common) dies at lockfile parse. Pin a 1.85+ toolchain (`rust-toolchain.toml` in `contract/`) or the official walkthrough fails on older rustup defaults.

## 7. Docs still say “append everything to one quickstart.ts”

That is correct for first-time teaching and wrong for anything you want to re-run. Missing `tenant` / `tenantDid` in a second file is in the official pitfalls table. This repo splits `quickstart` / `register` / `invoke` and repeats `connect()` at the top of each.

## Not bugs (worked as documented)

- `crate-type = ["cdylib", "lib"]` + `wasm32-wasip2` emits a component without `cargo-component`.
- `tenant_did()` is raw bytes; hex-encode once when building `z:<tid>:<map>`.
- `T3nClient` does not take `baseUrl`; `TenantClient` should get `baseUrl: getNodeUrl()`.
- `@terminal3/t3n-sdk@5.7.0` (2 Sep 2026) still exports the symbols the walkthrough names.
