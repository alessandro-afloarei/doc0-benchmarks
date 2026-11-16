---
title: "Test Suites"
---
## Overview

The repository has three kinds of test. Unit tests sit next to the source they test, as `*.test.ts` files under `src`, and run in Vitest on Node. Runtime tests live in `runtime-tests`, one folder per runtime, so that the same app is exercised on Deno, Bun, Node, workerd, Lambda, Lambda@Edge and Fastly. Benchmarks and bundle-size checks live in `benchmarks` and `perf-measures`. This page lists which command runs which suite, and how the CI workflow runs them. Writing a test with the helper that calls an app is on [[Testing Apps]].

Sources: [package.json:14-24](repo://package.json#L14-L24), [vitest.config.ts:25-27](repo://vitest.config.ts#L25-L27)

## Unit tests with Vitest

`bun run test` first type-checks the specs with `tsc -p tsconfig.spec.json`, which includes everything under `src` and the JWK key fixture, and then runs `vitest --run`. The `test:watch` script runs the same tests in watch mode.

Sources: [package.json:14-15](repo://package.json#L14-L15), [tsconfig.spec.json:10-10](repo://tsconfig.spec.json#L10-L10)

`vitest.config.ts` defines the projects. The first project pattern pulls in every `runtime-tests/*/vitest.config.ts`. The main project includes the spec and test files under `src`, `scripts` and `build`, and it excludes the `*.case.test.*` files. Further projects, named `jsx-runtime-default` and `jsx-runtime-dom`, run the JSX tests with the automatic JSX runtime; the first includes the `src/jsx/dom` tests. Coverage is collected with V8, and the output goes to `coverage/raw/default`.

Sources: [vitest.config.ts:1-24](repo://vitest.config.ts#L1-L24), [vitest.config.ts:25-70](repo://vitest.config.ts#L25-L70)

Coverage excludes the type-only files, the benchmark and runtime-test folders, and `build/build.ts`, because types have no runtime to measure.

Sources: [vitest.config.ts:11-23](repo://vitest.config.ts#L11-L23)

## Runtime suites

Each runtime folder has its own config, and the package script runs one project by name. `test:node`, `test:workerd`, `test:lambda`, `test:lambda-edge` and `test:fastly` each call `vitest --run --project` with that name. The Node project sets `NAME` to `Node`.

Sources: [package.json:18-22](repo://package.json#L18-L22), [runtime-tests/node/vitest.config.ts:1-11](repo://runtime-tests/node/vitest.config.ts#L1-L11), [runtime-tests/lambda/vitest.config.ts:1-11](repo://runtime-tests/lambda/vitest.config.ts#L1-L11)

The Deno suite runs three `deno test` commands: the `runtime-tests/deno` folder with its config, and the `deno-jsx` folder twice, once with the precompile config and once with the React JSX config. `test:bun` runs `bun test` on the `runtime-tests/bun` files with the Hono JSX import source. These run outside Vitest, and their own config files point at the source through `imports` entries.

Sources: [package.json:16-17](repo://package.json#L16-L17), [runtime-tests/deno/deno.json:1-12](repo://runtime-tests/deno/deno.json#L1-L12)

`test:all` runs the unit suite, the Deno suite and the Bun suite in that order. The runtime suites for Node, workerd, Lambda, Lambda@Edge and Fastly are not part of it; in CI they run after `bun run build`.

Sources: [package.json:23-23](repo://package.json#L23-L23)

## CI

The `Main` job in the CI workflow installs with the frozen lockfile, then runs format and lint checks, the editor-config check, the build, and `bun run test`. The job uploads the main coverage report.

Sources: [.github/workflows/ci.yml:38-57](repo://.github/workflows/ci.yml#L38-L57)

Separate jobs run each runtime. Deno runs its three `deno test` commands and writes an LCOV coverage file. Bun runs `test:bun` on Linux and Windows. Node, workerd, Lambda, Lambda@Edge and Fastly each build the package and then run their script. A `jsr-dry-run` job checks that the package can be published to JSR.

Sources: [.github/workflows/ci.yml:59-72](repo://.github/workflows/ci.yml#L59-L72), [.github/workflows/ci.yml:73-115](repo://.github/workflows/ci.yml#L73-L115), [.github/workflows/ci.yml:116-184](repo://.github/workflows/ci.yml#L116-L184)

The `lint` script runs ESLint on `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks`, and `format` runs Prettier in check mode over the same folders. The benchmarks in `benchmarks/` are separate from these suites, and the CI job for the HTTP speed check posts its results as a comment on a pull request.

Sources: [package.json:24-26](repo://package.json#L24-L26), [.github/workflows/ci.yml:195-260](repo://.github/workflows/ci.yml#L195-L260)
