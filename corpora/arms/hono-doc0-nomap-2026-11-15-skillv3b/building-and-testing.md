---
title: "Building and Testing Hono"
---
## Overview

Hono is developed with Bun as package manager and script runner, built with esbuild and `tsc`, and tested with Vitest plus each runtime's own test runner. Because the framework promises the same behaviour on every runtime, the test suite runs both the unit tests in `src` and a set of `runtime-tests` that start Hono on Deno, Bun, Node.js, Cloudflare's workerd, Fastly and AWS Lambda emulation. This page is for contributors; users of the package need none of it.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [package.json:13-36](repo://package.json#L13-L36)

## Getting started

Install Bun, clone the repository and install with the lockfile:

Sources: [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35)

```bash
git clone git@github.com:honojs/hono.git && cd hono && bun install --frozen-lockfile
bun run test
```

Sources: [docs/CONTRIBUTING.md:56-60](repo://docs/CONTRIBUTING.md#L56-L60), [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39)

A pull request must pass `bun run test`. CI additionally runs `format`, `lint`, `editorconfig-checker` and `build`, so running those locally avoids a failed check.

Sources: [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39), [.github/workflows/ci.yml:37-53](repo://.github/workflows/ci.yml#L37-L53)

| Script | Does |
| --- | --- |
| `bun run test` | Type-checks the specs with `tsc -p tsconfig.spec.json`, then runs every Vitest project once |
| `bun run test:watch` | Vitest in watch mode |
| `bun run test:deno`, `test:bun` | The Deno and Bun runtime tests with their native runners |
| `bun run test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | One Vitest runtime project each |
| `bun run test:all` | `test`, `test:deno` and `test:bun` |
| `bun run lint`, `format` | ESLint and Prettier over `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks`; `lint:fix` and `format:fix` repair |
| `bun run build`, `watch` | Build `dist`, once or continuously |
| `bun run coverage` | Vitest with coverage |

Sources: [package.json:13-36](repo://package.json#L13-L36)

## The build

### Outputs

`build/build.ts` produces three outputs in parallel. Every `src/**/*.ts` file except tests becomes an entry point, so each module is importable on its own and unused ones are never bundled into an application.

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39), [build/build.ts:103-107](repo://build/build.ts#L103-L107)

| Output | Tool | Notes |
| --- | --- | --- |
| `dist/*.js` (ESM) | esbuild | An `add-extension` plugin keeps imports external and rewrites them to explicit `.js` or `/index.js` paths, as Node's ESM resolver requires |
| `dist/cjs/*.js` (CommonJS) | esbuild | `package.cjs.json` is copied in so Node treats the folder as CommonJS |
| `dist/types/*.d.ts` | `tsc --emitDeclarationOnly` with `tsconfig.build.json` | `#private` fields are then stripped from the declarations |

Sources: [build/build.ts:41-107](repo://build/build.ts#L41-L107), [package.json:25-27](repo://package.json#L25-L27)

`removePrivateFields` parses each declaration file with `oxc-parser` and deletes `#private` class fields from the emitted types. After `build`, `publint` checks the package layout.

Sources: [build/remove-private-fields.ts:1-30](repo://build/remove-private-fields.ts#L1-L30), [build/build.ts:109-114](repo://build/build.ts#L109-L114), [package.json:27-28](repo://package.json#L27-L28)

### Export maps

Hono is published both to npm (`package.json`) and to JSR as `@hono/hono` (`jsr.json`, which points directly at the TypeScript sources). Before building, `validateExports` checks the two maps against each other in both directions, accepting wildcard entries such as `./utils/*`, and fails the build when a subpath exists in one but not the other. Adding a new module therefore means adding it to both files. CI also runs `jsr publish --dry-run`.

Sources: [build/build.ts:20-26](repo://build/build.ts#L20-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [jsr.json:1-12](repo://jsr.json#L1-L12), [.github/workflows/ci.yml:59-70](repo://.github/workflows/ci.yml#L59-L70)

## Tests

### Vitest projects

`vitest.config.ts` enables globals and V8 coverage and defines several projects:

Sources: [vitest.config.ts:1-25](repo://vitest.config.ts#L1-L25)

| Project | Runs | JSX import source |
| --- | --- | --- |
| `main` | `src/**/*.test.*`, `build/**` and `scripts/**` tests | `./src/jsx` |
| `jsx-runtime-default` | DOM renderer and hook tests | `./src/jsx` |
| `jsx-runtime-dom` | The same tests again | `./src/jsx/dom` |
| One per `runtime-tests/*/vitest.config.ts` | Runtime integration tests (node, workerd, fastly, lambda, lambda-edge) | per project |

Sources: [vitest.config.ts:25-73](repo://vitest.config.ts#L25-L73)

Running the DOM tests under both import sources checks that components behave the same whether compiled against `hono/jsx` or `hono/jsx/dom` (see [[Client-side JSX (hono/jsx/dom)]]). Type-only files (`types.ts`, `intrinsic-elements.ts`, `http-status.ts`) are excluded from coverage, since they contain no runtime code; type behaviour is tested with `expectTypeOf` inside the regular tests and by the `tsc` step of `bun run test`.

Sources: [vitest.config.ts:11-23](repo://vitest.config.ts#L11-L23), [vitest.config.ts:45-70](repo://vitest.config.ts#L45-L70), [package.json:14-14](repo://package.json#L14-L14)

### Runtime tests

`runtime-tests/` holds one directory per runtime: `bun`, `deno`, `deno-jsx`, `fastly`, `lambda`, `lambda-edge`, `node` and `workerd`. Each exercises the adapter for that platform, such as `getConnInfo`, `serveStatic` and WebSockets (see [[Runtime Adapters]]). Deno tests run with `deno test`, including the JSX tests under both precompile and `react-jsx` modes; Bun's with `bun test`; the others as Vitest projects. In CI each runtime is a separate job, and the Node, workerd, Fastly and Lambda jobs build first because they test the compiled `dist`.

Sources: [package.json:16-23](repo://package.json#L16-L23), [.github/workflows/ci.yml:72-182](repo://.github/workflows/ci.yml#L72-L182), [runtime-tests/workerd/vitest.config.ts:1-8](repo://runtime-tests/workerd/vitest.config.ts#L1-L8)

## Performance checks

Performance is guarded in two places. `benchmarks/` contains standalone projects comparing routers (on Node and Deno), the JSX renderer, query parsing, utilities and a full HTTP server against other libraries; they are run by hand or, for the HTTP server, by a CI job on pull requests. `perf-measures/` holds two automated checks run in CI on pull requests and on `main`: `bundle-check` bundles and minifies `dist/index.js` with esbuild and records its size, and `type-check` generates an app with 200 chained routes plus an RPC client for it and records `tsc` and `typescript-go` diagnostics, so changes to the type system in `src/types.ts` that slow down type checking show up in review (see [[Type System and Route Schemas]]).

Sources: [.github/workflows/ci.yml:184-267](repo://.github/workflows/ci.yml#L184-L267), [.github/actions/perf-measures/action.yml:1-40](repo://.github/actions/perf-measures/action.yml#L1-L40), [perf-measures/type-check/scripts/generate-app.ts:1-20](repo://perf-measures/type-check/scripts/generate-app.ts#L1-L20), [perf-measures/bundle-check/scripts/check-bundle-size.ts:1-20](repo://perf-measures/bundle-check/scripts/check-bundle-size.ts#L1-L20)

## Third-party middleware

Middleware that depends on other libraries or works on only one platform (GraphQL, Firebase Auth, Sentry) does not belong in this repository. It lives in the `honojs/middleware` monorepo and is published under the honojs organisation's namespace; propose one by opening an issue there.

Sources: [docs/CONTRIBUTING.md:41-54](repo://docs/CONTRIBUTING.md#L41-L54)
