---
type: "Reference"
title: "Test Strategy and Runtime Test Matrix"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---


# Test Strategy and Runtime Test Matrix

<!-- openwiki: broken internal link [/openwiki/operations/ci-and-automation.md] link "/openwiki/operations/ci-and-automation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono runs most of its tests in one Node-hosted Vitest process, and it runs adapter and runtime behaviour in separate environments that mirror the real platforms. This page covers how the suites are arranged, which command runs each one, and how CI maps onto them. The commands come from `package.json`; the CI jobs are described in [CI, Automation, and OpenWiki Maintenance](/openwiki/operations/ci-and-automation.md).

## Unit tests under src/

Unit tests sit next to the code they test, as `*.test.ts` or `*.test.tsx` files in the same directory. Examples include `src/hono.test.ts`, `src/compose.test.ts`, `src/context.test.ts`, `src/request.test.ts`, and the per-router `router.test.ts` files under `src/router/`. The JSX tests are in `src/jsx/` alongside the implementation.

Some files use a `*.case.test.ts` naming pattern, such as `src/router/common.case.test.ts`. The main Vitest project excludes `**/*.case.test.*` (see below), so these files are not collected as ordinary test files by the default configuration. Treat them as shared case data for several implementations rather than as standalone unit tests.

`tsconfig.spec.json` type-checks the test sources with `jsx: react-jsx` and `jsxImportSource: hono/jsx`, and includes `src/middleware/jwk/keys.test.json`. The `test` script runs that check before Vitest, so a type error in a test fails the run even when assertions pass.

## Vitest configuration

`vitest.config.ts` at the repository root defines four kinds of project:

- **`main`** runs `src/**/*.test.{ts,tsx,js}`, plus `scripts/**` and `build/**` specs. It excludes `**/sandbox/**` and `*.case.test.*` files. Its JSX is compiled with the automatic runtime and `importSource: './src/jsx'`.
- **`jsx-runtime-default`** runs `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` with the same JSX settings.
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`jsx-runtime-dom`** runs the same DOM tests with `importSource: './src/jsx/dom'`, so the DOM JSX types are the ones exercised. This project and `jsx-runtime-default` cover the two entry points of the DOM renderer (see [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md)).
- **`./runtime-tests/*/vitest.config.ts`** pulls in each runtime project listed below.

Coverage uses the V8 provider and writes to `coverage/raw/default`. Coverage excludes `benchmarks`, `runtime-tests`, `build/build.ts`, `perf-measures`, `src/test-utils`, and pure type files (`src/**/types.ts`, `src/jsx/intrinsic-elements.ts`, `src/utils/http-status.ts`), because they have no runtime code to measure.

## Runtime projects

Each directory under `runtime-tests/` tests one platform. Its `vitest.config.ts` defines a Vitest project with that platform's name, and the `test:*` scripts select it with `--project`.

| Project | Directory | Command | Notes |
| --- | --- | --- | --- |
| `node` | `runtime-tests/node` | `bun run test:node` | Node.js adapter and helper behaviour. |
| `workerd` | `runtime-tests/workerd` | `bun run test:workerd` | Cloudflare Workers runtime tests, with an `index.ts` fixture next to `index.test.ts`. |
| `fastly` | `runtime-tests/fastly` | `bun run test:fastly` | Uses `vite-plugin-fastly-js-compute` to build for Fastly Compute. |
| `lambda` | `runtime-tests/lambda` | `bun run test:lambda` | AWS Lambda handler tests with `mock.ts` and `stream-mock.ts` event fixtures. |
| `lambda-edge` | `runtime-tests/lambda-edge` | `bun run test:lambda-edge` | Lambda@Edge handler tests. |

The Bun suite (`runtime-tests/bun`, run with `bun test`) and the Deno suite (`runtime-tests/deno`) are not Vitest projects. The Bun suite contains a color test, an index test, and static-file fixtures. The Deno suite covers the core app, the middleware, SSG, and streaming under Deno's own test runner; `runtime-tests/deno-jsx` runs two JSX configurations, a precompiled one and a React-JSX one, each with its own deno config.

`bun run test:all` runs the main Vitest suite, the Deno suite, and the Bun suite in sequence. Individual runtime projects are the usual choice when a change affects one adapter.

## Type and bundle checks

`perf-measures/` holds checks that the public surface stays small and type-correct:

- `perf-measures/type-check/` contains `client.ts`, generated type fixtures under `generated/`, scripts, and its own `tsconfig.build.json`, for type-level measurements of how public types are consumed.
- `perf-measures/bundle-check/` contains `scripts/check-bundle-size.ts` and generated output under `generated/` for bundle-size measurements.

These directories are excluded from coverage and from the main test project. They are measurements rather than behaviour tests.

## Benchmarks

`benchmarks/` is a set of separate projects, not part of the test suite. They compare Hono with other frameworks and routers:

- `benchmarks/routers` and `benchmarks/routers-deno` compare route matching with find-my-way, express, koa-router, koa-tree-router, trek-router, and @medley/router.
- `benchmarks/http-server` measures end-to-end HTTP throughput.
- `benchmarks/jsx` and `benchmarks/query-param` cover JSX rendering and query-parameter handling.
- `benchmarks/utils` holds shared helpers.

Each benchmark has its own `package.json` or `deno.json` and lock file, so dependencies do not leak into the main package. The `lint` script covers `benchmarks` and `perf-measures` as well as `src` and `runtime-tests`.

## Choosing a test command

- Changing core dispatch, routing, or context: run `bun run test` (type check plus main project).
- Changing one adapter: run its `test:<runtime>` script, and `bun run test` if shared code changed.
- Changing Deno-specific code or SSG output: run `bun run test:deno`.
- Changing JSX DOM rendering or hooks: run the `main` project, which includes the `jsx-runtime-*` projects.
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Changing public types or exports: run `bun run build` before the tests, because the build validates the export maps (see [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)).

## Invariants and consequences

- The main project excludes `*.case.test.*` files, so a router change must be checked by the router harness as well as the unit tests.
- Runtime projects use the platform's own module resolution and globals, so a test that passes in Node can still fail in workerd or Deno. CI runs all runtime jobs for that reason.
- Benchmarks and perf checks do not gate correctness; a failing benchmark is a performance regression signal, not a test failure.

## Related pages

<!-- openwiki: broken internal link [/openwiki/operations/ci-and-automation.md] link "/openwiki/operations/ci-and-automation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CI, Automation, and OpenWiki Maintenance](/openwiki/operations/ci-and-automation.md)
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
