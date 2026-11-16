---
type: testing
title: Testing Strategy
description: How Hono is tested — colocated Vitest tests in the main project, JSX runtime variants, shared router conformance tests, per-runtime suites (Node, workerd, Fastly, Lambda, Deno, Bun), type-level tests, and the benchmarks and perf-measures tooling.
tags: [testing, vitest, runtime-tests, benchmarks, coverage, routers]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-451635167f48e4ef8830590d
    resource: repo://benchmarks/http-server/README.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-939c9255fe164ffbc010d463
    resource: repo://perf-measures/bundle-check/scripts/check-bundle-size.ts
  - id: openwiki-source-a62fbf327e96c858a8af0b2d
    resource: repo://runtime-tests/fastly/vitest.config.ts
  - id: openwiki-source-872f10012b7231aab44aaf27
    resource: repo://runtime-tests/lambda/vitest.config.ts
  - id: openwiki-source-33324115ee2aa60ceff3fd10
    resource: repo://runtime-tests/node/index.test.ts
  - id: openwiki-source-8a57a920a18d524b9c5ab242
    resource: repo://runtime-tests/node/vitest.config.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-86d2a3b40a9ba67ac42a59d7
    resource: repo://src/router/common.case.test.ts
  - id: openwiki-source-9cec9357b7e8b5786653a61b
    resource: repo://src/router/linear-router/router.test.ts
  - id: openwiki-source-c473e43628b09e3860c1573f
    resource: repo://src/router/reg-exp-router/router.test.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Testing Strategy

Because Hono promises identical behaviour across runtimes, testing is layered: fast colocated unit tests under Node/Vitest, a shared conformance suite for routers, and separate **runtime test suites** that run the built package in each real runtime. CI wiring is in [Build, Packaging and CI](../operations/build-and-release.md).

## Main Vitest workspace (`vitest.config.ts`)

`bun run test` = `tsc -p tsconfig.spec.json && vitest --run`. The type-check step (`jsx: react-jsx`, `jsxImportSource: hono/jsx`, `vitest/globals`) makes type errors in tests fail the run, which matters because many tests (`types.test.ts`, `client/types.test.ts`, `jsx/...`) assert **compile-time** behaviour of the generic types that power the [RPC client](../core/validation-and-client.md).

Vitest `projects`:

| project | what it runs |
| --- | --- |
| `main` | `src/**/*.test.{ts,tsx}`, `scripts/**`, `build/**` tests (excludes `**/sandbox/**` and `*.case.test.*`, which are helpers). JSX compiled with `importSource: ./src/jsx`. |
| `jsx-runtime-default`, `jsx-runtime-dom` | the JSX DOM tests (`src/jsx/dom/**`, `src/jsx/hooks/dom.test.tsx`) executed **twice**: once with the default JSX import source and once with `./src/jsx/dom`, validating both compilation modes of the client runtime (see [Hono JSX](../jsx/jsx-system.md)). |
| `runtime-tests/*/vitest.config.ts` | `node`, `workerd`, `lambda`, `lambda-edge`, `fastly` projects (below). |

Coverage is V8-based and enabled by default (`reportsDirectory: ./coverage/raw/default`), excluding benchmarks, runtime-tests, `build/build.ts`, `perf-measures`, and type-only files (`src/**/types.ts`, `jsx/intrinsic-elements.ts`, `utils/http-status.ts`). CI merges coverage from the main, Bun and Deno jobs.

Tests are colocated (`foo.ts` + `foo.test.ts`; about 120 test files under `src`). Examples of focused suites: `compose.test.ts`, `context.test.ts`, `hono.test.ts` (routing/dispatch behaviour), `request.test.ts`, per-middleware `index.test.ts`, per-adapter `handler.test.ts`/`conninfo.test.ts`/`websocket.test.ts`, `helper/ssg/*.test.tsx`, `jsx/context-isolation.test.ts`, and `build/*.test.ts` for the build scripts themselves.

## Router conformance suite

`src/router/common.case.test.ts` exports `runTest({ skip, newRouter })`, a large suite of `describe/it` cases (basic usage, reserved words such as a param named `constructor`, named/optional params, regex params, wildcards, trailing slashes, multi-match ordering, capture groups, duplicate param names…). It normalises both result shapes — indexed (`stash` + index map) and direct (`params`) — so any `Router` implementation can be checked uniformly. Each router's `router.test.ts` calls it with a `newRouter` factory and a `skip` list that records, per test name and with a reason, the cases that router intentionally can't support (e.g. `RegExpRouter` skips ambiguous or `UnsupportedPath` cases; `LinearRouter` skips cases where it deliberately accepts a trailing slash). Router-specific tests (`trie-router/node.test.ts`, `prepared-router.test.ts`, `smart-router/router.test.ts`) cover internals such as the SmartRouter fallback. When adding a router or changing routing semantics, extend `runTest` and update skip lists rather than writing router-specific copies. See [Router Implementations](../routing/routers.md).

## Runtime suites (`runtime-tests/*`)

- **node, lambda, lambda-edge**: `defineProject` Vitest projects (`NAME=Node` env), run with `test:node`, `test:lambda`, `test:lambda-edge`. They import directly from `src` (e.g. `../../src/helper/adapter`); the `node` suite serves the app with `@hono/node-server` and talks to it over HTTP with `undici` (covering streaming, SSE, compression and JWT end to end). `lambda` includes mocks and streaming mocks for `awslambda` APIs.
- **workerd**: `unstable_dev('./runtime-tests/workerd/index.ts')` from Wrangler boots a real worker with vars; tests hit it with `worker.fetch` including WebSocket checks (`test:workerd`).
- **fastly**: Vitest with `vite-plugin-fastly-js-compute` (`test:fastly`).
- **deno** (`deno.json`, `deno.lock`) and **deno-jsx** (`deno.precompile.json`, `deno.react-jsx.json`): `deno test` with permissions; the JSX variants verify Deno's precompiled JSX transform and `react-jsx` transform against Hono JSX (`test:deno`).
- **bun**: `bun test --jsx-import-source ../../src/jsx runtime-tests/bun/*` (`test:bun`); includes static-file fixtures for `serveStatic`.
- `test:all` runs main + Deno + Bun locally.
These mirror the adapter implementations in [Runtime Adapters](../runtimes/adapters.md): runtime-specific features (static serving, websocket upgrade, runtime key, env) are exercised in the runtime that provides them.

## Performance tooling

- `benchmarks/routers` (and `routers-deno`): micro-benchmarks comparing Hono RegExpRouter/TrieRouter against find-my-way, express, koa-router, etc. Each benchmark directory has its own `package.json` and lockfile, separate from the root.
- `benchmarks/http-server/benchmark.ts`: HTTP throughput comparison of main vs the PR using `bombardier` and Bun; CI runs it on pull requests and comments the result.
- `benchmarks/jsx`, `benchmarks/query-param`, `benchmarks/utils`: targeted micro-benchmarks.
- `perf-measures/bundle-check`: bundles `dist/index.js` with esbuild (minified, ES2022) and reports the bundle size as a metric; `perf-measures/type-check`: generates large apps (`scripts/generate-app.ts`) and measures TypeScript instantiation/check cost of the type machinery (`process-results.ts`). Both feed PR checks in CI and guard against size or type-performance regressions.

## Practical commands
- Single file: `bunx vitest --run src/path/to/file.test.ts`; project: `bunx vitest --run --project <name>`.
- Lint/format before PR: `bun run lint`, `bun run format` (see build page).
- Runtime suites require their toolchain (Deno, Bun, Wrangler/workerd, Fastly's Vite plugin); CI runs `bun run build` before the Fastly, Node and workerd jobs.
