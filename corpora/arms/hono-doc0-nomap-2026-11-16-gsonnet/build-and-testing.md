---
title: "Build, Exports and Testing"
---
## Overview

This page is for contributors. The package is TypeScript compiled three ways at once (ESM, CommonJS and declaration files) from the same `src` tree, and its public entry points are the `exports` map in `package.json`, mirrored in `jsr.json`. Tests run through Vitest for the main code and for Node, Workers, Fastly and Lambda runtimes, and through the Bun and Deno test runners for those runtimes. The scripts live in `package.json`; `build/build.ts` runs under Bun.

Sources: [package.json:6-31](repo://package.json#L6-L31), [build/build.ts:10-26](repo://build/build.ts#L10-L26)

## The build

### Build steps

`bun run build` first removes `dist`, runs `build/build.ts`, then copies `package.cjs.json` (`{"type": "commonjs"}`) into `dist/cjs` and `dist/types` so Node treats those folders as CommonJS. `postbuild` runs `publint`.

Sources: [package.json:25-27](repo://package.json#L25-L27), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

`build/build.ts` does these steps:

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26)

1. Reads the `exports` of `package.json` and `jsr.json` and calls `validateExports` both ways, so an entry in one that is missing from the other fails the build.
2. Collects every `src/**/*.ts` file as an entry point, except tests, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`. Because each file is an entry, the output mirrors the source layout and each export path maps to one built file.
3. Runs three jobs in parallel: an ESM build into `dist` (bundled, with an `add-extension` esbuild plugin that rewrites relative imports to end in `.js` or `/index.js` and leaves them external), a CJS build into `dist/cjs`, and `tsc --emitDeclarationOnly` with `tsconfig.build.json` into `dist/types`.
4. Scans `dist/types/**/*.d.ts` and runs `removePrivateFields`.

Sources: [build/build.ts:18-114](repo://build/build.ts#L18-L114)

With `--watch` (`bun run watch`) the esbuild jobs and `tsc` watch instead of running once.

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26), [build/build.ts:28-107](repo://build/build.ts#L28-L107), [build/build.ts:109-114](repo://build/build.ts#L109-L114), [tsconfig.build.json:1-17](repo://tsconfig.build.json#L1-L17)

### Export validation

`validateExports(source, target, fileName)` checks that every key of `source` exists in `target`. A key counts as present if it is there exactly, if a wildcard key such as `./utils/*` covers it, or if the key itself ends in `/*` and some target key starts with that prefix. Failures throw `Missing "<entry>" in '<file>'`.

Sources: [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

### Private field removal

Hono classes use `#private` fields at runtime, and those leak into generated `.d.ts` files, where they add noise. `removePrivateFields` parses each declaration file with `oxc-parser`, finds class properties whose key is a private identifier, and overwrites their source range with spaces, preserving the offsets of the rest of the file. The constructor comments in `HonoBase` explain the related choice: fields that must be visible to JavaScript across modules use the `private` keyword instead of `#`.

Sources: [build/remove-private-fields.ts:5-57](repo://build/remove-private-fields.ts#L5-L57), [src/hono-base.ts:120-122](repo://src/hono-base.ts#L120-L122)

## The exports map

Each public module has an entry in `package.json` of the form `{ types, import, require }` pointing into `dist/types`, `dist` and `dist/cjs`. This is why importing `hono/tiny`, `hono/jwt` or `hono/jsx` pulls only that module. Wildcard entries such as `./utils/*` cover helper modules, and `jsr.json` repeats the map for JSR with source paths.

Sources: [package.json:33-60](repo://package.json#L33-L60), [package.json:314-325](repo://package.json#L314-L325), [jsr.json:8-20](repo://jsr.json#L8-L20)

## Running tests

| Script | What it runs |
| --- | --- |
| `test` | `tsc -p tsconfig.spec.json` for type checks, then `vitest --run` |
| `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | A single Vitest project by name |
| `test:deno` | `deno test` over `runtime-tests/deno` and the two `deno-jsx` configurations |
| `test:bun` | `bun test` over `runtime-tests/bun` with the JSX import source set to `src/jsx` |
| `test:all` | `test`, then Deno, then Bun |
| `coverage` | `vitest --run --coverage` |

Sources: [package.json:12-24](repo://package.json#L12-L24), [package.json:30](repo://package.json#L30-L30)

`vitest.config.ts` turns on globals and V8 coverage (excluding benchmarks, runtime tests, build script, perf measures and type-only files) and defines the projects:

Sources: [vitest.config.ts:3-35](repo://vitest.config.ts#L3-L35)

- The runtime projects found by `./runtime-tests/*/vitest.config.ts`. For example, the Lambda project sets `NAME: 'Node'` and its project name.
- `main`: `src/**`, `scripts/**` and `build/**` test files, excluding `sandbox` folders and `*.case.test.*` files (which are shared case files imported by other tests, such as the router cases). It compiles JSX with the automatic runtime and `./src/jsx` as the import source.
- `jsx-runtime-default` and `jsx-runtime-dom`: the same JSX DOM and hooks tests, run twice, once with `./src/jsx` and once with `./src/jsx/dom` as the JSX import source, so that both renderer entry points are exercised.

Sources: [vitest.config.ts:3-73](repo://vitest.config.ts#L3-L73), [runtime-tests/lambda/vitest.config.ts:1-11](repo://runtime-tests/lambda/vitest.config.ts#L1-L11)

Bun's own runner writes coverage to `coverage/raw/bun` with `text` and `lcov` reporters, per `bunfig.toml`. In CI the `main` job runs format, lint, editorconfig, build and `bun run test`; the Deno job runs `deno test` with coverage, and `coverage` waits for the main, Bun and Deno jobs before uploading. A `jsr-dry-run` job checks that the package is valid for JSR.

Sources: [bunfig.toml:1-4](repo://bunfig.toml#L1-L4), [.github/workflows/ci.yml:17-80](repo://.github/workflows/ci.yml#L17-L80)

## Tests next to code

Unit tests sit beside the source (`router.test.ts` next to `router.ts`), and `src/router/common.case.test.ts` holds cases shared by all router implementations (see [[Routers and Router Selection]]). Build scripts have tests too: `build/validate-exports.test.ts` and `build/remove-private-fields.test.ts`, picked up by the `main` project's `build/**` pattern.

Sources: [vitest.config.ts:36-42](repo://vitest.config.ts#L36-L42)

## Performance measures

`perf-measures` holds two checks that report metrics: `bundle-check` bundles and minifies `dist/index.js` with esbuild and reports its size in bytes, and `type-check` generates an app with 200 chained `get('/route<n>/:id')` routes to measure type-checking cost, which relates to the typed schema described in [[Type System and Typed Routes]]. Separately, `benchmarks` has router, JSX, query-param, HTTP server and utility benchmarks.

Sources: [perf-measures/bundle-check/scripts/check-bundle-size.ts:6-30](repo://perf-measures/bundle-check/scripts/check-bundle-size.ts#L6-L30), [perf-measures/type-check/scripts/generate-app.ts:1-25](repo://perf-measures/type-check/scripts/generate-app.ts#L1-L25)
