---
title: "Building and Testing Hono"
---
## Overview

Hono is published twice from the same TypeScript sources: to npm as the `hono` package, built into `dist/` as ESM, CommonJS and type declarations, and to JSR as `@hono/hono`, which publishes the `.ts` files directly. Its tests run under Vitest for the shared code and under each supported runtime for the adapters. The project uses Bun as its package manager and to run the build script, as the contribution guide says.

Sources: [package.json:1-12](repo://package.json#L1-L12), [jsr.json:1-8](repo://jsr.json#L1-L8), [jsr.json:107-110](repo://jsr.json#L107-L110), [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39)

```bash
git clone git@github.com:honojs/hono.git && cd hono && bun install --frozen-lockfile
bun run test
bun run build
```

Sources: [docs/CONTRIBUTING.md:56-60](repo://docs/CONTRIBUTING.md#L56-L60), [package.json:13-35](repo://package.json#L13-L35)

## Package scripts

| Script | Runs |
| --- | --- |
| `test` | `tsc -p tsconfig.spec.json` for type tests, then `vitest --run` |
| `test:deno`, `test:bun` | The Deno and Bun runtime tests with each runtime's own test runner |
| `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | One Vitest project each |
| `test:all` | `test`, `test:deno` and `test:bun` |
| `lint`, `format` | ESLint and Prettier over `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks` |
| `build` | Removes `dist`, runs `build/build.ts`, copies `package.cjs.json`; `postbuild` runs `publint` |
| `coverage` | Vitest with coverage |
| `prerelease`, `release` | Deno tests and a build, then `np --no-publish` |

Sources: [package.json:13-35](repo://package.json#L13-L35)

The contribution guide asks that a PR passes `bun run test`.

Sources: [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39)

## The build script

`build/build.ts` runs on Bun and has four steps:

Sources: [build/build.ts:18-114](repo://build/build.ts#L18-L114)

1. It reads the `exports` maps of `package.json` and `jsr.json` and checks them against each other with `validateExports`, in both directions.
2. It collects every `src/**/*.ts` file as an entry point, except tests, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`.
3. It runs three jobs in parallel: esbuild to ESM in `dist/`, esbuild to CommonJS in `dist/cjs/`, and `tsc --emitDeclarationOnly` for declarations in `dist/types/`.
4. It removes `#private` fields from the generated declaration files.

Sources: [build/build.ts:18-114](repo://build/build.ts#L18-L114)

Each source file stays its own output file; nothing is bundled into one file. The ESM build sets `bundle: true` only so that esbuild runs the `add-extension` plugin, which marks every import as external and rewrites it to a path with `.js`, or `/index.js` for a directory import. A comment credits an esbuild issue for the idea, and the script header credits the build script of `@kaze-style/react`.

Sources: [build/build.ts:1-6](repo://build/build.ts#L1-L6), [build/build.ts:41-92](repo://build/build.ts#L41-L92)

`--watch` switches both esbuild jobs to watch mode and passes `-w` to `tsc`. After the build, the `copy:package.cjs.json` script writes a `package.json` with `"type": "commonjs"` into `dist/cjs` and `dist/types`, so Node.js treats those `.js` files as CommonJS despite the root package's `"type": "module"`.

Sources: [build/build.ts:18-18](repo://build/build.ts#L18-L18), [build/build.ts:94-107](repo://build/build.ts#L94-L107), [package.json:29-30](repo://package.json#L29-L30), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

## Export maps

Every public module has an entry in `package.json` `exports`, with `types`, `import` and `require` paths into `dist`, and an entry in `jsr.json` `exports` pointing at the `.ts` source. `typesVersions` repeats the type paths for TypeScript setups that do not read `exports`, and `engines` requires Node.js 16.9.0 or later.

Sources: [package.json:38-60](repo://package.json#L38-L60), [package.json:415-430](repo://package.json#L415-L430), [package.json:696-698](repo://package.json#L696-L698), [jsr.json:8-20](repo://jsr.json#L8-L20)

`validateExports(source, target, fileName)` throws `Missing "<entry>" in '<fileName>'` for any entry of one map missing from the other. A wildcard entry such as `./utils/*` counts as present when the other map has at least one entry under `./utils/`, and a concrete entry counts as present when the other map has a wildcard covering one of its parent paths. Adding a module therefore means adding it to both files, or the build stops.

Sources: [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [build/build.ts:22-26](repo://build/build.ts#L22-L26)

## Removing private fields

`tsc` writes `#private` class fields into declaration files. `removePrivateFields` parses each `.d.ts` file with `oxc-parser`, finds `PropertyDefinition` nodes whose key is a `PrivateIdentifier` in class declarations, and overwrites their text with spaces, which keeps every other position in the file unchanged. Files without such fields are left untouched.

Sources: [build/remove-private-fields.ts:1-57](repo://build/remove-private-fields.ts#L1-L57), [build/build.ts:109-114](repo://build/build.ts#L109-L114)

This is also why `HonoBase` keeps `_basePath` and `errorHandler` as `private` TypeScript fields rather than `#` fields: comments there say they must stay visible at JavaScript runtime, because `route()` reads them on another instance ([[Hono Application]]).

Sources: [src/hono-base.ts:119-122](repo://src/hono-base.ts#L119-L122), [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188), [src/hono-base.ts:218-229](repo://src/hono-base.ts#L218-L229)

## Vitest projects

`vitest.config.ts` defines the projects `vitest --run` executes:

Sources: [vitest.config.ts:25-71](repo://vitest.config.ts#L25-L71)

| Project | Covers | JSX import source |
| --- | --- | --- |
| `main` | `src/**`, `scripts/**` and `build/**` tests, except `*.case.test.*` and sandboxes | `./src/jsx` |
| `jsx-runtime-default` | `src/jsx/dom/**` tests and `src/jsx/hooks/dom.test.tsx` | `./src/jsx` |
| `jsx-runtime-dom` | The same tests | `./src/jsx/dom` |
| `runtime-tests/*/vitest.config.ts` | One project per runtime directory | per project |

Sources: [vitest.config.ts:25-71](repo://vitest.config.ts#L25-L71)

The DOM tests run twice, once with each JSX runtime, so components work whether compiled for `hono/jsx` or `hono/jsx/dom` ([[Client-Side DOM Rendering]]). Coverage uses V8 and excludes benchmarks, runtime tests, the build script and the type-only files, whose coverage, a comment notes, cannot be measured.

Sources: [vitest.config.ts:45-70](repo://vitest.config.ts#L45-L70), [vitest.config.ts:4-24](repo://vitest.config.ts#L4-L24)

## Runtime tests

`runtime-tests/` holds one directory per runtime:

Sources: [package.json:14-23](repo://package.json#L14-L23), [runtime-tests/node/vitest.config.ts:1-11](repo://runtime-tests/node/vitest.config.ts#L1-L11)

| Directory | Runner | What it exercises |
| --- | --- | --- |
| `node`, `workerd`, `fastly`, `lambda`, `lambda-edge` | Vitest projects | The adapter and helpers on that runtime, for example `env()` with a `NAME` variable on Node |
| `bun` | `bun test` | Bun adapter, static files, colours |
| `deno` | `deno test` | Deno adapter, middleware, SSG, streaming |
| `deno-jsx` | `deno test` twice | JSX with Deno's precompile and react-jsx settings |

Sources: [package.json:14-23](repo://package.json#L14-L23), [runtime-tests/node/vitest.config.ts:1-11](repo://runtime-tests/node/vitest.config.ts#L1-L11)

The `deno-jsx` run with `deno.precompile.json` is what tests the `jsxTemplate`, `jsxAttr` and `jsxEscape` exports of the JSX runtime ([[JSX Server Rendering]]).

Sources: [package.json:17-17](repo://package.json#L17-L17), [src/jsx/jsx-runtime.ts:9-51](repo://src/jsx/jsx-runtime.ts#L9-L51)

## Benchmarks and measurements

`benchmarks/` contains standalone projects with their own dependencies: router comparisons against other routers such as `find-my-way`, `koa-tree-router` and Express (on Node and on Deno), JSX rendering, query parsing, an HTTP server benchmark and utility benchmarks.

Sources: [benchmarks/routers/README.md:1-20](repo://benchmarks/routers/README.md#L1-L20)

`perf-measures/` tracks two numbers. `bundle-check/scripts/check-bundle-size.ts` bundles and minifies `dist/index.js` with esbuild and reports its size. `type-check/scripts/generate-app.ts` writes an app with 200 chained routes, each adding to the app's schema type ([[Route Types and Schema]]), and `process-results.ts` turns `name: value` lines read from standard input, labelled with the TypeScript implementation in `BENCHMARK_TS_IMPL_LABEL`, into metrics.

Sources: [perf-measures/bundle-check/scripts/check-bundle-size.ts:1-30](repo://perf-measures/bundle-check/scripts/check-bundle-size.ts#L1-L30), [perf-measures/type-check/scripts/generate-app.ts:1-27](repo://perf-measures/type-check/scripts/generate-app.ts#L1-L27), [perf-measures/type-check/scripts/process-results.ts:1-30](repo://perf-measures/type-check/scripts/process-results.ts#L1-L30)
