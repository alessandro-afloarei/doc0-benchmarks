---
type: testing
title: Testing Strategy
description: How Hono is tested — co-located Vitest unit tests, type-level tests checked by tsc, separate JSX runtime projects, per-platform runtime-tests (Node, workerd, Fastly, Lambda, Lambda@Edge, Deno, Bun), coverage aggregation, and commands for running focused tests.
tags: [testing, vitest, deno, bun, coverage, type-tests]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-7dc952d611a75d93fb9b2fb5
    resource: repo://bunfig.toml
  - id: openwiki-source-5f7022cb75865b779a5792a0
    resource: repo://codecov.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-585671c68dce8c7625bdb550
    resource: repo://runtime-tests/lambda/stream-mock.ts
  - id: openwiki-source-33324115ee2aa60ceff3fd10
    resource: repo://runtime-tests/node/index.test.ts
  - id: openwiki-source-5ca635b054b8dce946b0251d
    resource: repo://runtime-tests/workerd/index.test.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Testing Strategy

Hono has to behave the same on many runtimes, so it is tested at three levels:

1. **Unit and integration tests** co-located with the source (`src/**/*.test.ts(x)`). They run under Vitest on Node and cover almost all behaviour.
2. **Type-level tests** that check inference with `expectTypeOf`. They are type-checked with `tsc`.
3. **Runtime tests** (`runtime-tests/<platform>`) that run small apps on, or simulate, the real platform.

## Commands

| Command | What it does |
| --- | --- |
| `bun run test` | `tsc -p tsconfig.spec.json && vitest --run`: type-checks all of `src` (tests included), then runs every Vitest project |
| `bun run test:watch` | Vitest watch mode |
| `npx vitest --run src/middleware/cors` | A focused run, filtered by path |
| `bun run test:node` / `test:workerd` / `test:fastly` / `test:lambda` / `test:lambda-edge` | One runtime project (`vitest --run --project <name>`). CI runs `bun run build` first |
| `bun run test:deno` | Deno runtime tests, plus the Deno JSX tests in precompile and react-jsx modes |
| `bun run test:bun` | `bun test --jsx-import-source ../../src/jsx runtime-tests/bun/*` |
| `bun run test:all` | test + deno + bun |
| `bun run coverage` | Vitest with v8 coverage |

Contributors are expected to make `bun run test` pass (`docs/CONTRIBUTING.md`). CI also runs `format`, `lint` and `editorconfig-checker` (see [Build, Packaging and Release](../operations/build-and-release.md)).

## Vitest projects (`vitest.config.ts`)

`globals: true` is set, so tests use `describe`/`it`/`expect` without imports. The projects are:

- **`main`**: `src/**`, `scripts/**` and `build/**` tests. JSX is compiled with the automatic runtime and `importSource: ./src/jsx`. Files matching `*.case.test.*` are excluded, because they are shared suites imported by other tests, such as the router conformance suite `src/router/common.case.test.ts` (see [Routers](../routing/routers.md)).
- **`jsx-runtime-default`** and **`jsx-runtime-dom`**: run `src/jsx/dom/**` and `src/jsx/hooks/dom.test.tsx` again with `importSource` set to `./src/jsx` and `./src/jsx/dom` respectively, so the client renderer is verified under both runtimes (see [JSX Runtime](../jsx/jsx-runtime.md)). DOM tests create a jsdom environment.
- **`runtime-tests/*/vitest.config.ts`**: one project per platform:
  - **node**: serves apps through `@hono/node-server` and checks streaming, compression, auth, and so on with `undici`/`fetch`;
  - **workerd**: starts `runtime-tests/workerd/index.ts` with Wrangler's `unstable_dev` and tests env bindings and WebSockets;
  - **fastly**: runs under `vite-plugin-fastly-js-compute`;
  - **lambda** / **lambda-edge**: drive the AWS adapters with mock events and a mock `awslambda` streaming global (`mock.ts`, `stream-mock.ts`).

Deno (`runtime-tests/deno`, `runtime-tests/deno-jsx`) and Bun (`runtime-tests/bun`) use their native test runners, because their adapters call `Deno.*` and `Bun.*` APIs. These suites cover `serveStatic` against real files (`static/`, `static-absolute-root/`), SSG and streaming. See [Runtime Adapters](../integrations/runtime-adapters.md).

## Type tests

Type behaviour is part of the public contract, especially RPC inference (see [Type System and RPC Client](../concepts/types-and-rpc-client.md)). `expectTypeOf` assertions appear in more than a dozen test files. The largest are `src/types.test.ts` and `src/hono.test.ts`. `tsc -p tsconfig.spec.json` (with `noEmit`, `jsxImportSource: hono/jsx`, and `vitest/globals` types) compiles all of `src`, so a type regression fails `bun run test` even when the runtime assertions pass. The `// @ts-expect-error` lines in tests are negative type assertions. Compile-time performance is tracked separately by `perf-measures/type-check`.

## Coverage

- Vitest uses v8 coverage written to `coverage/raw/default`. The configuration excludes benchmarks, runtime-tests, the build script, perf-measures, and compile-time-only files (`src/**/types.ts`, `src/jsx/intrinsic-elements.ts`, `src/utils/http-status.ts`).
- Bun writes lcov to `coverage/raw/bun` (`bunfig.toml`). Deno writes to `coverage/raw/deno-*` and converts the result to lcov in CI.
- CI merges the three artifacts and uploads them to Codecov. `codecov.yml` sets a 75% project target with a 1% threshold, and an informational 80% patch target. Coverage exclusions belong in `vitest.config.ts`, not in `codecov.yml`, so that local results and CI agree.

## Writing tests

- Put tests next to the code as `<name>.test.ts(x)`. Exercise behaviour through `app.request(...)` or `testClient(app)` (see [Helpers](../helpers/helpers.md)) instead of calling internals.
- For a new router, call `runTest({ newRouter })` from `common.case.test.ts`.
- For a new adapter, add unit tests with synthetic events in `src/adapter/<name>/`. If platform behaviour matters, add a `runtime-tests/<platform>` project, register it through the `./runtime-tests/*/vitest.config.ts` glob, and add a CI job.
