---
type: testing
title: Testing strategy
description: How Hono is tested — the root Vitest config with its main, jsx-runtime-default and jsx-runtime-dom projects plus per-runtime projects, type tests run through tsc, Deno and Bun suites, the workerd/Fastly/Lambda/Node runtime tests, coverage, and the benchmarks and perf-measures used to guard speed, bundle size and type-check cost.
tags: [testing, vitest, runtime-tests, benchmarks, coverage, type-tests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-728208cbdbb03765b6b1dc11
    resource: repo://benchmarks/routers/README.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-57d4599e82e0045d598eb220
    resource: repo://perf-measures/type-check/client.ts
  - id: openwiki-source-c8b098b38b0fd299820db61c
    resource: repo://perf-measures/type-check/scripts/generate-app.ts
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
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Testing strategy

Hono runs on many JavaScript runtimes, so it is tested in three layers:

1. Colocated unit tests and type tests, run under Vitest on Node.
2. Per-runtime integration suites in `runtime-tests/`.
3. Performance and size guards in `benchmarks/` and `perf-measures/`.

## Commands

| Command | What runs |
| --- | --- |
| `bun run test` | `tsc -p tsconfig.spec.json` (type-checks every test, including the `expectTypeOf` type tests) followed by `vitest --run` (all projects) |
| `bun run test:watch` | Vitest in watch mode |
| `bun run test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | `vitest --run --project <name>` |
| `bun run test:deno` | `deno test` for `runtime-tests/deno`, then `runtime-tests/deno-jsx` under both `deno.precompile.json` and `deno.react-jsx.json` |
| `bun run test:bun` | `bun test --jsx-import-source ../../src/jsx runtime-tests/bun/*` |
| `bun run test:all` | `test`, then `test:deno`, then `test:bun` |
| `bun run coverage` | Vitest with v8 coverage |

`docs/CONTRIBUTING.md` asks contributors to install dependencies with `bun install --frozen-lockfile` and to make sure `bun run test` passes before opening a PR.

## Vitest configuration (`vitest.config.ts`)

`globals: true` is set, so test files use `describe`, `it` and `expect` without importing them. Coverage uses the v8 provider and is enabled by default. It excludes:

- `benchmarks`, `runtime-tests` and `perf-measures`;
- the build script;
- type-only files (`src/**/types.ts`, `intrinsic-elements.ts`, `http-status.ts`).

`projects`:

- **`./runtime-tests/*/vitest.config.ts`**: one project per runtime directory that has a Vitest config (`node`, `workerd`, `fastly`, `lambda`, `lambda-edge`).
- **`main`** runs `src/**`, `scripts/**` and `build/**` test files. JSX is compiled by oxc with `importSource: ./src/jsx`. It excludes `**/*.case.test.*` files, because those are shared case suites that other tests import.
- **`jsx-runtime-default`** and **`jsx-runtime-dom`** run the same DOM tests (`src/jsx/dom/**`, `src/jsx/hooks/dom.test.tsx`) twice: once with JSX compiled against `src/jsx` and once against `src/jsx/dom`. This checks that both JSX import sources behave identically in the browser renderer. Those tests create their own `JSDOM` instances.

`tsconfig.spec.json` type-checks all of `src` (with `react-jsx` and `jsxImportSource: hono/jsx`) without emitting output. A type regression in `src/types.ts` or `src/client/types.ts` therefore fails `bun run test` even if no runtime assertion does (see [Type system and RPC client](../concepts/types-and-rpc-client.md)).

## Colocated test conventions

- Every module has a sibling `*.test.ts` or `*.test.tsx`.
- Core behavior is tested in `src/hono.test.ts`, `src/compose.test.ts`, `src/context.test.ts` and `src/request.test.ts`.
- Most tests drive a real app through `app.request(path, init, env)`, so no server is started. `hono/testing`'s `testClient` gives the same in-process approach with typed RPC calls (see [Helpers](../helpers/helpers.md)).
- **Shared case suites**: `src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`, which each router imports with a list of skipped cases and reasons (see [Routers](../architecture/routers.md)). `src/helper/css/common.case.test.tsx` follows the same pattern for the CSS helpers.
- Network-dependent code (the RPC client, JWKS fetching) is tested against `msw` handlers.

## Runtime tests (`runtime-tests/`)

| Directory | How it runs | Focus |
| --- | --- | --- |
| `node` | Vitest project `node` (env `NAME=Node`) | A minimal set of patterns on Node through `@hono/node-server`: env and runtime key, basic auth, JWT, `stream`/`streamSSE`, `compress` and buffers |
| `workerd` | Vitest project. It starts `runtime-tests/workerd/index.ts` with wrangler's `unstable_dev` (vars `NAME=Hono`) and calls `worker.fetch` | Workers runtime: `getRuntimeKey`, env bindings, WebSocket |
| `fastly` | Vitest project with `vite-plugin-fastly-js-compute` | Fastly Compute |
| `lambda`, `lambda-edge` | Vitest projects with mocked events (`mock.ts`, `stream-mock.ts`) | The AWS adapters, including `streamHandle` |
| `deno` | `deno test -c runtime-tests/deno/deno.json` | Deno adapter, middleware, SSG, streaming and `serveStatic` with static fixtures |
| `deno-jsx` | `deno test` under the `precompile` and `react-jsx` configs | JSX precompile runtime parity |
| `bun` | `bun test` | Bun adapter, `serveStatic`, color detection, and so on |

CI runs every one of these as a separate job. Bun is tested on Windows as well, and Node is tested across a version matrix. See [Build and release](../operations/build-and-release.md). The adapters these suites exercise are described in [Runtime adapters](../integrations/runtime-adapters.md).

## Benchmarks and performance guards

- **`benchmarks/routers`** (Node/Bun) and **`benchmarks/routers-deno`** compare Hono's RegExpRouter and TrieRouter with find-my-way, koa-tree-router, trek-router, @medley/router, rou3, memoirist and others.
- **`benchmarks/http-server`** runs an HTTP throughput benchmark with bombardier. CI runs it on PRs and comments the results.
- **`benchmarks/jsx`**, **`benchmarks/query-param`** and **`benchmarks/utils`** are micro-benchmarks for JSX rendering, query parsing and utilities. Each has its own `package.json`.
- **`perf-measures/type-check`**: `scripts/generate-app.ts` writes an app with 200 chained `.get('/routeN/:id', ...)` routes, and `client.ts` builds `hc<typeof app>` over it. The CI action measures how long the compiler takes to check this, which guards the cost of the heavy overloads in `types.ts`.
- **`perf-measures/bundle-check`** bundles and minifies `dist/index.js` and reports its size in bytes and KB.
