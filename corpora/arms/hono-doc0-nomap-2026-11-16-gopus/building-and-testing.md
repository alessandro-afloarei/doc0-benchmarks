---
title: "Building and Testing Hono"
---
## Overview

This page is for working on Hono itself. The repository is a TypeScript package built with Bun, esbuild and `tsc`, tested with Vitest on Node and in per-runtime projects, and published both to npm as `hono` and to JSR as `@hono/hono`. Everything under `src/` is the library the other pages describe; `build/` holds the build script, `runtime-tests/` the tests that run Hono on each runtime, and `benchmarks/` and `perf-measures/` the performance tooling.

Sources: [package.json:1-37](repo://package.json#L1-L37), [jsr.json:1-12](repo://jsr.json#L1-L12)

## Setting up

The contribution guide asks for Bun as the package manager and a frozen install, and for every pull request to pass `bun run test`:

Sources: [docs/CONTRIBUTING.md:27-60](repo://docs/CONTRIBUTING.md#L27-L60)

```bash
git clone git@github.com:honojs/hono.git && cd hono && bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:27-60](repo://docs/CONTRIBUTING.md#L27-L60)

The same guide states the project's AI policy: AI may be used, but a pull request that wastes a maintainer's time may be closed without notice. Middleware that depends on other libraries or on one platform belongs in the `honojs/middleware` repository rather than in the core.

Sources: [docs/CONTRIBUTING.md:21-54](repo://docs/CONTRIBUTING.md#L21-L54)

## Scripts

| Script | Runs |
| --- | --- |
| `test` | `tsc -p tsconfig.spec.json`, then `vitest --run` |
| `test:watch` | Vitest in watch mode |
| `test:deno` | `deno test` on `runtime-tests/deno` and on `runtime-tests/deno-jsx` with the precompile and react-jsx configurations |
| `test:bun` | `bun test` on `runtime-tests/bun` with `src/jsx` as the JSX import source |
| `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | One Vitest project each |
| `test:all` | `test`, then `test:deno`, then `test:bun` |
| `lint`, `lint:fix` | ESLint on `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks` |
| `format`, `format:fix` | Prettier on the same folders |
| `build` | Removes `dist`, runs `build/build.ts`, copies `package.cjs.json` |
| `watch` | The build in watch mode |
| `coverage` | Vitest with coverage |

Sources: [package.json:13-37](repo://package.json#L13-L37)

`postbuild` runs `publint` to check the package, and `prerelease` runs the Deno tests and the build before `release` prepares a version with `np --no-publish`.

Sources: [package.json:30-36](repo://package.json#L30-L36)

## The build

### Exports must agree

`build/build.ts` first reads the `exports` maps of `package.json` and `jsr.json` and checks each against the other with `validateExports`. Every entry must exist in the other file, directly or through a `/*` wildcard entry, or the build stops with `Missing "<entry>" in '<file>'`. A new subpath such as `hono/foo` must therefore be added to both files.

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

### Outputs

Every `src/**/*.ts` file except tests and a few Deno-specific entry files is an entry point. Three builds run in parallel:

Sources: [build/build.ts:28-107](repo://build/build.ts#L28-L107)

1. esbuild in ESM format into `dist/`, with a plugin that keeps each import external and rewrites it to the `.js` file, or `/index.js` for a folder, that it will resolve to;
2. esbuild in CommonJS format into `dist/cjs/`;
3. `tsc --emitDeclarationOnly` with `tsconfig.build.json` for the declaration files under `dist/types/`.

Sources: [build/build.ts:28-107](repo://build/build.ts#L28-L107)

Each output keeps the source layout, which is what lets `package.json` map every subpath export to one file per format. `package.cjs.json` is copied into `dist/cjs` and `dist/types` afterwards.

Sources: [build/build.ts:78-92](repo://build/build.ts#L78-L92), [package.json:29-30](repo://package.json#L29-L30), [package.json:38-47](repo://package.json#L38-L47)

### Private fields in declarations

After the declarations are written, `removePrivateFields` parses every `.d.ts` file with `oxc-parser` and removes class members declared with `#`, so the published types do not mention private state such as `HonoBase`'s `#path`.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:1-30](repo://build/remove-private-fields.ts#L1-L30), [src/hono-base.ts:119-122](repo://src/hono-base.ts#L119-L122)

## Tests

### Vitest projects

`vitest.config.ts` enables globals and V8 coverage and defines projects:

Sources: [vitest.config.ts:1-73](repo://vitest.config.ts#L1-L73)

| Project | Files | JSX import source |
| --- | --- | --- |
| `main` | `src/**`, `scripts/**` and `build/**` test files | `./src/jsx` |
| `jsx-runtime-default` | `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` | `./src/jsx` |
| `jsx-runtime-dom` | The same files | `./src/jsx/dom` |
| One per `runtime-tests/*/vitest.config.ts` | That runtime's tests | — |

Sources: [vitest.config.ts:1-73](repo://vitest.config.ts#L1-L73)

The two JSX projects run the DOM tests once against each runtime, so components behave the same whether they are compiled for `hono/jsx` or `hono/jsx/dom`, the two runtimes on [[JSX Server Rendering]] and [[JSX DOM Runtime and Hooks]].

Sources: [vitest.config.ts:45-70](repo://vitest.config.ts#L45-L70)

Coverage leaves out the benchmarks, the runtime tests, the build script and type-only files, which the comment notes cannot be measured at runtime.

Sources: [vitest.config.ts:5-24](repo://vitest.config.ts#L5-L24)

### Runtime tests

`runtime-tests/` has one folder per runtime: `node`, `workerd`, `fastly`, `lambda` and `lambda-edge` run as Vitest projects; `bun`, `deno` and `deno-jsx` run under their own test runners through `test:bun` and `test:deno`. They exercise the adapters on [[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]] where the platform objects exist. The `node` project, for example, sets an environment variable `NAME` for the `env()` helper to read.

Sources: [package.json:16-23](repo://package.json#L16-L23), [runtime-tests/node/vitest.config.ts:1-11](repo://runtime-tests/node/vitest.config.ts#L1-L11), [runtime-tests/node/index.test.ts:45-46](repo://runtime-tests/node/index.test.ts#L45-L46), [runtime-tests/workerd/vitest.config.ts:1-8](repo://runtime-tests/workerd/vitest.config.ts#L1-L8)

Type tests live next to the unit tests: `test` type-checks them with `tsconfig.spec.json` before running Vitest, and tests such as the preset tests use `expectTypeOf` and `@ts-expect-error`.

Sources: [package.json:14-14](repo://package.json#L14-L14), [src/preset/tiny.test.ts:1-42](repo://src/preset/tiny.test.ts#L1-L42)

## Performance tooling

`benchmarks/` holds standalone projects with their own dependencies: `routers` and `routers-deno` compare Hono's `RegExpRouter` and `TrieRouter` with other routers such as find-my-way, koa-router and trek-router; `jsx` compares `hono/jsx` with React, Preact and nano-jsx; `query-param` compares query parsing; `http-server` measures a server end to end.

Sources: [benchmarks/routers/README.md:1-20](repo://benchmarks/routers/README.md#L1-L20)

`perf-measures/` tracks two numbers in CI. `bundle-check` bundles `dist/index.js` with esbuild, minified ESM for ES2022, and reports its size. `type-check` generates an app with 200 chained `.get('/routeN/:id')` routes and a client typed from it with `hc<typeof app>`; `process-results.ts` turns the compiler's `name: value` diagnostic lines into metrics. It guards the cost of the type machinery on [[Typed Routes and Schemas]].

Sources: [perf-measures/bundle-check/scripts/check-bundle-size.ts:1-30](repo://perf-measures/bundle-check/scripts/check-bundle-size.ts#L1-L30), [perf-measures/type-check/scripts/generate-app.ts:1-27](repo://perf-measures/type-check/scripts/generate-app.ts#L1-L27), [perf-measures/type-check/client.ts:1-5](repo://perf-measures/type-check/client.ts#L1-L5), [perf-measures/type-check/scripts/process-results.ts:1-30](repo://perf-measures/type-check/scripts/process-results.ts#L1-L30)
