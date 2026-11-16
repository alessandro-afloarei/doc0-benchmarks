---
type: workflow
title: Testing, Runtime Matrix and Quality Gates
description: How Hono is verified - the Vitest projects and colocated test layout, the runtime-tests matrix that runs the package on Bun, Deno, Node, workerd, Fastly Compute, AWS Lambda, and Lambda@Edge, the type and bundle-size and HTTP benchmark checks, lint, format and editorconfig gates, and the contributor workflow from docs/CONTRIBUTING.md.
tags: [testing, vitest, runtime-tests, ci, benchmarks, lint, format, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-872f10012b7231aab44aaf27
    resource: repo://runtime-tests/lambda/vitest.config.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Testing, Runtime Matrix and Quality Gates

<!-- openwiki: broken internal link [/openwiki/operations/build-and-packaging.md] link "/openwiki/operations/build-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's correctness depends on running the same behavior on many JavaScript runtimes. Testing therefore has three layers: colocated unit tests that run on Node through Vitest, a runtime matrix in `runtime-tests/` that builds the package and runs platform tests on each target, and quality gates (type checks, linting, formatting, bundle size, and HTTP benchmarks) that run in CI. This page describes each layer and the commands that drive them. Build outputs that these tests consume are described in [Build and Packaging](/openwiki/operations/build-and-packaging.md).

## Unit Tests: Vitest Projects

The root `vitest.config.ts` defines the main test project and several JSX projects, and it includes the runtime projects through a glob (`./runtime-tests/*/vitest.config.ts`).

- **`main`** includes `src/**/*.test.ts(x)`, `scripts/**`, and `build/**` tests, and excludes files under `**/sandbox/**` and names matching `*.case.test.*`. These run in Node with the JSX import source set to `./src/jsx`.
- **`jsx-runtime-default`** covers `src/jsx/dom/**` and `src/jsx/hooks/dom.test.tsx` with the same JSX import source.
- **`jsx-runtime-dom`** covers the same DOM tests with `importSource` set to `./src/jsx/dom`, so the DOM renderer's own JSX runtime is exercised.

Coverage is enabled by default with the V8 provider, writing reports to `coverage/raw/default`. Coverage excludes `benchmarks`, `runtime-tests`, `build/build.ts`, `perf-measures`, and type-only modules such as `src/**/types.ts`, which cannot be measured at runtime. The tests live next to the code they cover (for example `src/hono.test.ts`, `src/router/trie-router/router.test.ts`, `src/middleware/jwt/index.test.ts`), so a change and its tests are reviewed together.

Two root scripts orchestrate these projects:

- `bun run test` runs `tsc -p tsconfig.spec.json` first, which type-checks all of `src` including tests, and then `vitest --run`. A type error in a test is therefore a failure even if the runtime test passes.
- `bun run coverage` runs Vitest with coverage.

## The Runtime Matrix

Each directory under `runtime-tests/` tests the built package on one platform. The CI workflow runs the build first, then the platform-specific command:

| Target | Directory | Command (package script) | Notes |
| --- | --- | --- | --- |
| Deno | `runtime-tests/deno`, `runtime-tests/deno-jsx` | `test:deno` | Runs `deno test` with explicit permissions; includes JSX precompile and React-JSX configurations. The Deno suite covers SSG, streaming, and middleware. |
| Bun | `runtime-tests/bun` | `test:bun` | Runs `bun test` on the Bun runtime; includes static-file and color tests. CI also runs it on Windows. |
| Node.js | `runtime-tests/node` | `test:node` | Vitest project `node`. CI runs it on Node 20, 22, and 24 in a matrix. |
| Cloudflare workerd | `runtime-tests/workerd` | `test:workerd` | Vitest project `workerd` against the workerd runtime. |
| Fastly Compute | `runtime-tests/fastly` | `test:fastly` | Vitest project built with a Fastly JS Compute Vite plugin. |
| AWS Lambda | `runtime-tests/lambda` | `test:lambda` | Vitest project with mock events (`mock.ts`) and a streaming variant (`stream-mock.ts`, `stream.test.ts`). |
| Lambda@Edge | `runtime-tests/lambda-edge` | `test:lambda-edge` | Vitest project for CloudFront events. |

<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The adapters exercised by these targets are described in [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md). `bun run test:all` chains the main test script with the Deno and Bun suites. The Node.js target in `runtime-tests/node` is a separate Vitest project and does not depend on a platform adapter directory in `src/adapter/`.

Deno uses its own configuration files (`deno.json`, `deno.precompile.json`, `deno.react-jsx.json`) and a `deno.lock`. The CI jobs read Node, Bun, and Deno versions from `.tool-versions` (currently Node 24.7.0, Bun 1.2.19, and Deno 2.4.5).

## Quality Gates in CI

The main CI workflow (`.github/workflows/ci.yml`) runs the following jobs and checks:

- **Main.** Installs with `bun install --frozen-lockfile`, then runs `bun run format` (Prettier check on `src`, `runtime-tests`, `build`, `perf-measures`, and `benchmarks`), `bun run lint` (ESLint over the same directories, configured in `eslint.config.mjs`), `bun run editorconfig-checker`, `bun run build`, and `bun run test`.
- **JSR dry run.** Runs `bunx jsr publish --dry-run` to catch JSR-specific packaging problems before release.
- **Runtime jobs.** Deno, Bun (Linux and Windows), Fastly Compute, Node.js, workerd, AWS Lambda, and Lambda@Edge. The platform jobs that test the built package run `bun run build` before their suite.
- **Performance measures.** The composite action in `.github/actions/perf-measures` runs on pull requests and on `main`. It measures type-check time for a generated application with `tsc` and with `tsgo` (typescript-go), using the scripts in `perf-measures/type-check`, and it measures the bundle size of `dist/index.js` with `perf-measures/bundle-check/scripts/check-bundle-size.ts`. The results are reported with octocov.
- **HTTP speed check.** On pull requests, a job installs `bombardier`, runs `benchmarks/http-server/benchmark.ts`, and posts the results to the pull request through `actions/github-script`.

The format and lint scripts name the directories they check (`src`, `runtime-tests`, `build`, `perf-measures`, and `benchmarks`), so a new top-level directory with TypeScript code must be added to those scripts to be checked.

## Benchmarks

`benchmarks/` contains standalone projects rather than tests: `http-server` (end-to-end request throughput), `routers` and `routers-deno` (router comparison), `jsx` (JSX rendering), `query-param`, and `utils`. Each has its own package manifest, and several use separate lock files. They are run by hand or by the CI benchmark job and are not part of `bun run test`.

## Contributor Workflow

`docs/CONTRIBUTING.md` asks contributors to use Bun for package management, run `bun install --frozen-lockfile`, and make sure `bun run test` passes before opening a pull request. It also states that third-party middleware is not part of the core and is maintained in a separate repository. The root `AGENTS.md` adds guidance for automated agents: prefer the narrowest validation that proves the changed behavior, and keep failure output intact when reporting it.

## Practical Commands

- Run one test file: `bunx vitest --run src/compose.test.ts`.
- Run the type check only: `bunx tsc -p tsconfig.spec.json`.
- Run the DOM JSX tests only: `bunx vitest --run --project jsx-runtime-dom`.
- Run a platform suite locally: `bun run build` followed by `bun run test:node` (or the matching `test:*` script).

## Failure Modes

- The platform suites run against build output, so running them without `bun run build` first can test stale or missing files; CI always builds first.
- Type errors in test files fail the `test` script before Vitest starts.
- A new runtime-tests project must be added to the matching CI job; the Vitest glob picks up its configuration automatically, but CI jobs are listed explicitly.
