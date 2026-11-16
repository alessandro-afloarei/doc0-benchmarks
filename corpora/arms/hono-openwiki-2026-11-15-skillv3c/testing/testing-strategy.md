---
type: testing
title: Testing, Runtime Tests, and Benchmarks
description: How Hono is tested and measured — Vitest projects (main, JSX runtime variants, per-runtime projects), type tests compiled with tsc, Deno and Bun runtime suites, the shared router test harness, coverage, router/JSX/HTTP benchmarks, and the type-check and bundle-size measurements run on pull requests.
tags: [testing, vitest, runtime-tests, benchmarks, coverage, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-4ad7f19fbe567666e4b1c2dc
    resource: repo://.github/actions/perf-measures/action.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-939c9255fe164ffbc010d463
    resource: repo://perf-measures/bundle-check/scripts/check-bundle-size.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Testing, Runtime Tests, and Benchmarks

Unit tests live next to the code (`src/**/*.test.ts(x)`); integration tests that need a real runtime live in `runtime-tests/`. Bun is the package manager and script runner (`bun install --frozen-lockfile`); `docs/CONTRIBUTING.md` asks contributors to make sure `bun run test` passes.

## Commands

| Command | What it runs |
| --- | --- |
| `bun run test` | `tsc -p tsconfig.spec.json` (type-checks all sources **and tests**, no emit) then `vitest --run` (all Vitest projects). |
| `bun run test:watch` | Vitest in watch mode. |
| `bun run test:node` / `test:workerd` / `test:fastly` / `test:lambda` / `test:lambda-edge` | A single runtime Vitest project. |
| `bun run test:deno` | `deno test` for `runtime-tests/deno`, plus `runtime-tests/deno-jsx` twice (precompile JSX and react-jsx configs). |
| `bun run test:bun` | `bun test` for `runtime-tests/bun` with `--jsx-import-source ../../src/jsx`. |
| `bun run test:all` | `test` + `test:deno` + `test:bun`. |
| `bun run coverage` | Vitest with coverage. |
| `bun run lint` / `format` | ESLint / Prettier over `src`, `runtime-tests`, `build`, `perf-measures`, `benchmarks`. |

## Vitest configuration (`vitest.config.ts`)

Globals are enabled (tests use `describe`/`it`/`expect` without imports) and **coverage is always on** (V8 provider, reports in `coverage/raw/default`; type-only files such as `src/**/types.ts`, `intrinsic-elements.ts` and `http-status.ts` are excluded). Projects:

- **`main`** — `src/**`, `scripts/**`, `build/**` tests, with JSX compiled by oxc using `./src/jsx` as the automatic runtime. `*.case.test.*` files are excluded because they are shared harnesses imported by other tests.
- **`jsx-runtime-default`** and **`jsx-runtime-dom`** — run `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` twice, once with `./src/jsx` and once with `./src/jsx/dom` as the JSX import source, so client components are verified under both runtimes (see [JSX DOM Runtime and Hooks](../jsx/dom-runtime.md)).
- **`./runtime-tests/*/vitest.config.ts`** — one project per runtime that has a Vitest config:
  - `node` — uses `@hono/node-server` and `undici` against a real HTTP server (only minimal patterns; the node-server repo has the rest).
  - `workerd` — starts the worker in `runtime-tests/workerd/index.ts` with Wrangler's `unstable_dev` and tests it over HTTP and WebSocket.
  - `fastly` — runs under `vite-plugin-fastly-js-compute`.
  - `lambda` / `lambda-edge` — exercise the AWS adapters with mocked events and a mocked `awslambda` streaming global.

Bun and Deno have no Vitest config; they use their native test runners (`runtime-tests/bun`, `runtime-tests/deno`, `runtime-tests/deno-jsx`), covering static file serving (`static`, `static-absolute-root` fixtures), SSG, streaming, middleware, websockets and JSX. Adapter behavior is described in [Runtime Adapters](../adapters/runtime-adapters.md).

## Type tests

The public API is largely type-level (route schema, RPC client, validator inference). These are tested with Vitest's `expectTypeOf` and `@ts-expect-error` assertions in files such as `src/types.test.ts`, `src/client/types.test.ts`, `src/preset/*.test.ts` and `src/validator/validator.test.ts`. Because `bun run test` first runs `tsc` over `tsconfig.spec.json` (which includes all test files), a type regression fails the test command even if runtime assertions pass. See [Type System and Route Schema](../typing/type-system.md).

## Shared harnesses

- `src/router/common.case.test.ts` — `runTest({ newRouter, skip })` runs the same routing cases against every router; each router declares skips with reasons (see [Router Contract and SmartRouter](../routing/router-interface.md#shared-test-suite)).
- `src/helper/css/common.case.test.tsx` — shared css-helper cases for the server and DOM variants.

## Benchmarks (`benchmarks/`)

Standalone packages, not part of `bun run test`:

- `routers` (Node/Bun, mitata) and `routers-deno` — compare Hono's routers with other routers.
- `jsx` — rendering throughput vs. other JSX implementations.
- `query-param`, `utils` — micro-benchmarks for parsing helpers.
- `http-server` — HTTP throughput benchmark (used by the CI "HTTP Speed Check" with bombardier).

## Performance measures (`perf-measures/`)

Run by the composite action `.github/actions/perf-measures` on PRs and on `main`, and reported via octocov:

- **type-check** — generates a large app (`scripts/generate-app.ts`) and records `tsc --diagnostics` (and `tsgo`) metrics, catching type-inference slowdowns in the RPC/schema types.
- **bundle-check** — bundles and minifies `dist/index.js` with esbuild (ESM, ES2022) and records the size, guarding Hono's small-bundle goal.

## CI

`.github/workflows/ci.yml` runs format, lint, editorconfig check, build and `bun run test` (with coverage upload), plus dedicated jobs for Deno, Bun (Linux and Windows), Fastly, Node.js 20/22/24, workerd, Lambda and Lambda@Edge, a JSR publish dry run, and the performance measures. See [Build, Exports, and Release](../operations/build-and-release.md).
