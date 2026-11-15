---
type: testing
title: Testing Strategy
description: How Hono is tested — the type-check-then-Vitest test script, Vitest projects (main, two JSX DOM runtimes, per-runtime projects), Deno and Bun native test runs, runtime-tests for Node, workerd, Fastly, Lambda and Lambda@Edge, coverage and Codecov targets, lint/format checks, and benchmark and perf-measure tooling in CI.
tags: [testing, vitest, ci, runtime-tests, benchmarks, coverage]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-5f7022cb75865b779a5792a0
    resource: repo://codecov.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-939c9255fe164ffbc010d463
    resource: repo://perf-measures/bundle-check/scripts/check-bundle-size.ts
  - id: openwiki-source-c8b098b38b0fd299820db61c
    resource: repo://perf-measures/type-check/scripts/generate-app.ts
  - id: openwiki-source-33324115ee2aa60ceff3fd10
    resource: repo://runtime-tests/node/index.test.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-45c189606212900216c608d7
    resource: repo://src/client/client.test.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Testing Strategy

Hono must behave the same on many runtimes, and much of its API surface is type-level. The test setup therefore has three layers: compile-time type tests, unit tests in Vitest, and runtime integration tests executed on (or emulating) each real platform.

## Commands

| Command | Runs |
| --- | --- |
| `bun run test` | `tsc -p tsconfig.spec.json` (type-check all of `src`, no emit) **then** `vitest --run` (all projects, coverage enabled). |
| `bun run test:watch` | Vitest in watch mode. |
| `bun run test:node` / `test:workerd` / `test:fastly` / `test:lambda` / `test:lambda-edge` | Single Vitest project for that runtime. |
| `bun run test:deno` | `deno test` for `runtime-tests/deno`, plus `runtime-tests/deno-jsx` with both the precompile and react-jsx configs. |
| `bun run test:bun` | `bun test` for `runtime-tests/bun/*` with JSX from `src/jsx`. |
| `bun run test:all` | `test` + `test:deno` + `test:bun`. |
| `bun run coverage` | Vitest with coverage. |
| `bun run lint` / `format` / `editorconfig-checker` | ESLint (`@hono/eslint-config`), Prettier check, EditorConfig. |

`docs/CONTRIBUTING.md` asks contributors to install with `bun install --frozen-lockfile` and make sure `bun run test` passes.

## Vitest projects (`vitest.config.ts`)

- **`main`** – `src/**/*.test.{ts,tsx}`, `build/**/*.test.ts`, `scripts/**`; excludes `**/sandbox/**` and `*.case.test.*` files (shared suites such as `src/router/common.case.test.ts` and `src/helper/css/common.case.test.tsx` are imported by real tests rather than run directly). JSX uses the automatic runtime with import source `./src/jsx`.
- **`jsx-runtime-default`** and **`jsx-runtime-dom`** – run `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` twice, with JSX import sources `./src/jsx` and `./src/jsx/dom`, verifying both [client runtimes](../jsx/client-dom.md).
- **`./runtime-tests/*/vitest.config.ts`** – one project per runtime directory (`node`, `workerd`, `fastly`, `lambda`, `lambda-edge`).

`globals: true` is enabled, so `describe`/`it`/`expect`/`vi` are used without imports in most files (`tsconfig.spec.json` adds `vitest/globals` types).

## Kinds of tests

- **Colocated unit tests** – each module has `*.test.ts(x)` next to it, typically driving a real `Hono` app with `app.request()` (see [Request Lifecycle](../architecture/request-lifecycle.md#dispatch)) rather than mocking internals.
- **Type tests** – `src/types.test.ts`, `src/client/types.test.ts` and many `expectTypeOf` / `@ts-expect-error` assertions throughout, enforced by the `tsc` step (see [Type System](../concepts/type-system.md#testing-types)).
- **Shared behavioral suites** – e.g. `runTest()` in `src/router/common.case.test.ts`, executed by every router with per-router skip lists ([Routers](../routing/routers.md#tests)).
- **DOM tests** – JSDOM-based tests for `hono/jsx/dom`.
- **Client tests** – MSW (`msw`) intercepts `fetch` for `hc` client tests.
- **Runtime tests** (`runtime-tests/`):
  - `node` – runs apps under `@hono/node-server` (with `undici`) to check streaming, compression, auth etc. on Node.
  - `workerd` – starts `runtime-tests/workerd/index.ts` with Wrangler's `unstable_dev` and exercises it over HTTP/WebSocket.
  - `fastly` – uses `vite-plugin-fastly-js-compute`.
  - `lambda`, `lambda-edge` – feed mock API Gateway/ALB/CloudFront events to the [adapters](../integrations/runtime-adapters.md), including streaming (`stream-mock.ts`).
  - `bun`, `deno`, `deno-jsx` – run with the native test runners to check `serveStatic`, `toSSG`, WebSocket, conninfo and JSX transforms.

## Coverage

Coverage uses the V8 provider (`reportsDirectory: coverage/raw/default`) and excludes benchmarks, runtime tests, the build script, `perf-measures`, and compile-time-only files (`src/**/types.ts`, `src/jsx/intrinsic-elements.ts`, `src/utils/http-status.ts`). Bun writes its own coverage (`bunfig.toml` → `coverage/raw/bun`) and Deno its own LCOV. `codecov.yml` targets 75% project coverage (1% threshold) and an informational 80% patch target.

## CI (`.github/workflows/ci.yml`)

- **Main**: format, lint, editorconfig check, build, `bun run test`.
- **JSR dry run**: `jsr publish --dry-run`.
- **Runtime jobs**: Deno (with coverage), Bun (Linux and Windows), Fastly, Node.js 20/22/24 matrix, workerd, AWS Lambda, Lambda@Edge — each builds then runs its project.
- **Performance on PRs**: the `perf-measures` action compares type-check cost and bundle size against the target branch, and an HTTP benchmark (bombardier) comments results on the PR; equivalent jobs record baselines on `main`.

## Benchmarks and perf measures

- `benchmarks/routers`, `benchmarks/routers-deno` – router match benchmarks against other routers.
- `benchmarks/http-server`, `benchmarks/jsx`, `benchmarks/query-param`, `benchmarks/utils` – focused micro/macro benchmarks; each is a separate package with its own dependencies.
- `perf-measures/type-check` – generates an app with 200 chained `.get('/routeN/:id')` routes and measures TypeScript checking cost of the [RPC client](../integrations/rpc-client.md) types.
- `perf-measures/bundle-check` – bundles `dist/index.js` with esbuild (minified ESM) and reports its size.

## Practical guidance

- Add tests beside the module you change; use `app.request()` for behavior and `expectTypeOf` for types.
- If you touch runtime-specific code (adapters, streaming, serve-static, WebSocket), also run the matching `test:<runtime>` script; most of them require `bun run build` first, as CI does.
- Router changes must keep `common.case.test.ts` passing for all routers.
