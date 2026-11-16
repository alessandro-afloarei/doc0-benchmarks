---
type: operations
title: Testing Strategy and Runtime Tests
description: How Hono is tested - Vitest projects (main, JSX runtimes, per-runtime), the shared router conformance suite, type-level tests, runtime-tests for Bun, Deno, Node, workerd, Fastly and Lambda, coverage thresholds, and commands for focused runs.
tags: [testing, vitest, runtime-tests, coverage, type-tests, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-5f7022cb75865b779a5792a0
    resource: repo://codecov.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a62fbf327e96c858a8af0b2d
    resource: repo://runtime-tests/fastly/vitest.config.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-86d2a3b40a9ba67ac42a59d7
    resource: repo://src/router/common.case.test.ts
  - id: openwiki-source-ee6f9e0e88c16e0a26b8cdb5
    resource: repo://src/router/trie-router/router.test.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Testing Strategy and Runtime Tests

Because Hono promises identical behaviour across runtimes, testing is layered: fast unit tests run in Node via Vitest, and a separate set of **runtime tests** exercise real Bun, Deno, workerd, Fastly Compute and Lambda environments. Type behaviour (the RPC/validator generics) is tested as code, not just by documentation.

## Vitest layout (`vitest.config.ts`)

A single config defines multiple Vitest **projects**:

| Project | Scope | Notes |
| --- | --- | --- |
| `main` | `src/**`, `build/**`, `scripts/**` files named `*.test.ts(x)` / `*.spec.*` | Excludes `**/sandbox/**` and `**/*.case.test.*` (shared case files are imported, not run directly). JSX compiled with the automatic runtime and `importSource: ./src/jsx` |
| `jsx-runtime-default` | `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` | JSX import source `./src/jsx` |
| `jsx-runtime-dom` | the same DOM tests | JSX import source `./src/jsx/dom`, so the DOM suite verifies both entry runtimes ([JSX](../features/jsx.md)) |
| `node`, `lambda`, `lambda-edge`, `workerd`, `fastly` | `runtime-tests/<name>/vitest.config.ts` | Each is a `defineProject` with `globals: true`; the Node/Lambda ones set `NAME=Node`; Fastly uses `vite-plugin-fastly-js-compute`; workerd starts a worker with wrangler's `unstable_dev` |

`globals: true` means `describe/it/expect/vi` are ambient. Coverage uses `v8`, enabled by default, writing to `coverage/raw/default`, excluding benchmarks, runtime-tests, `build/build.ts`, `src/test-utils`, `perf-measures`, and compile-time-only files (`src/**/types.ts`, `src/jsx/intrinsic-elements.ts`, `src/utils/http-status.ts`). `codecov.yml` targets 75% project coverage (1% threshold) and 80% patch coverage as informational only.

## Commands

- `bun run test`: `tsc -p tsconfig.spec.json && vitest --run`. The `tsc` step type-checks all of `src` including tests (JSX via `hono/jsx`), so type errors fail the test run even though Vitest itself does not type-check.
- Focused: `vitest --run --project main src/compose.test.ts`; per runtime: `bun run test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` (all `vitest --run --project <name>`).
- `bun run test:deno` (Deno test runner with `runtime-tests/deno*/deno*.json`, including the Deno JSX precompile and react-jsx configs) and `bun run test:bun` (`bun test --jsx-import-source ../../src/jsx runtime-tests/bun/*`, coverage via `bunfig.toml`).
- `bun run test:all` runs the Vitest suite, Deno and Bun.
- `bun run coverage`: Vitest with coverage.

## Test styles

- **Co-located unit tests** (`foo.ts` next to `foo.test.ts`) drive the app through `app.request(...)`, so each test exercises the real dispatch path ([Request Lifecycle](../architecture/request-lifecycle.md)). Middleware tests assert headers and status; `compose.test.ts` pins pipeline semantics ([Middleware Composition](../architecture/middleware-composition.md)).
- **Router conformance suite.** `src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`, a shared set of routing cases (static, params, wildcards, optional params, regex params, ordering). Each router's own test (`trie-router`, `linear-router`, `pattern-router`, `reg-exp-router` including the prepared variant, and `smart-router`) calls it, with a `skip` list carrying a human-readable reason where a router intentionally lacks a feature (e.g. patterns the PatternRouter or LinearRouter reject) ([Router Contract](../routing/router-contract-and-smart-router.md)).
- **Type tests.** Files like `src/types.test.ts`, `src/client/types.test.ts` and the preset tests use `expectTypeOf`, `@ts-expect-error` and inferred route schemas to lock down `Env`, `Input`, `Schema`, `hc` client typing and validator inference ([Validator and RPC client](../features/validation-and-rpc-client.md)). They only fail through `tsc`, which is why `bun run test` starts with it.
- **Runtime tests** (`runtime-tests/*`): small apps imported from `src` running inside the target runtime. For example, `runtime-tests/workerd/index.ts` defines routes returning `getRuntimeKey()`, `env(c)` values and a WebSocket echo through the Cloudflare `upgradeWebSocket`, and `index.test.ts` starts the worker via wrangler and asserts on responses; the Deno suite includes `hono.test.ts`, `middleware.test.tsx`, `ssg.test.tsx` and `stream.test.ts`, the Bun suite has `index.test.tsx` and `color.test.ts`, with static-file fixtures for `serveStatic` ([Runtime Adapters](../platform/adapters.md)). Lambda suites use mock events (`mock.ts`, `stream-mock.ts`).
- **Performance checks** live outside the test suite: `perf-measures/` (type-check cost and bundle size, run on PRs in CI) and `benchmarks/` (routers, HTTP server, JSX, query params).

## CI mapping

Each runtime has its own CI job (see [Build and Packaging](build-and-packaging.md)); the Main job runs formatting, linting, build and the Node Vitest suite, and per-job coverage artifacts are merged before upload to Codecov.
