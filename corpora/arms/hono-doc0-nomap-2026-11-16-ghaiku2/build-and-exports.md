---
title: "Build and Exports"
---
## Overview

The package is built from `src` into two module trees, ESM in `dist` and CommonJS in `dist/cjs`, plus declaration files in `dist/types`. The build script also checks that `package.json` and `jsr.json` declare the same entry points. This page covers the build steps, the export check, the private-field pass on the declarations, and the test projects that the Vitest config runs. The source layout the build walks is described in [[Overview]].

Sources: [build/build.ts:103-114](repo://build/build.ts#L103-L114), [package.json:38-50](repo://package.json#L38-L50), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

## Entry points

`build/build.ts` collects every `src/**/*.ts` file as an entry point, except test files, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`. Each file becomes its own output module, so a deep import such as `hono/jsx` maps to one file under `dist`.

Sources: [build/build.ts:28-41](repo://build/build.ts#L28-L41)

The ESM build bundles each entry with esbuild and rewrites relative imports to include `.js`, or `/index.js` for a directory. The CommonJS build does not set `bundle`, so it transpiles each file on its own into `dist/cjs`. The `package.cjs.json` file that is copied next to it marks that folder as `commonjs` for Node.

Sources: [build/build.ts:45-70](repo://build/build.ts#L45-L70), [build/build.ts:72-93](repo://build/build.ts#L72-L93), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

The declarations come from `tsc` with `tsconfig.build.json`, emitting only `.d.ts` files into `dist/types`. The three steps run in parallel inside one `Promise.all`.

Sources: [build/build.ts:94-110](repo://build/build.ts#L94-L110)

## Private fields

After the declarations are written, the build reads every `dist/types/**/*.d.ts` file and calls `removePrivateFields`. The function parses each file with `oxc-parser`, collects the class property definitions whose key is a private identifier, and removes them from the source text.

Sources: [build/build.ts:111-114](repo://build/build.ts#L111-L114), [build/remove-private-fields.ts:5-26](repo://build/remove-private-fields.ts#L5-L26), [build/remove-private-fields.ts:27-57](repo://build/remove-private-fields.ts#L27-L57)

## Export check

`validateExports(source, target, fileName)` checks that each entry in `source` exists in `target`. A wildcard entry such as `./utils/*` is matched by its prefix, so `./utils` counts. The build calls it in both directions, so an entry added to `package.json` must also appear in `jsr.json`, and the reverse.

Sources: [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [build/build.ts:18-26](repo://build/build.ts#L18-L26)

The `exports` map in `package.json` lists each subpath with `types`, `import` and `require` conditions. The `./request` entry, for example, points to `dist/types/request.d.ts` for types, `dist/request.js` for ESM and `dist/cjs/request.js` for CommonJS.

Sources: [package.json:38-50](repo://package.json#L38-L50)

## Scripts

`bun run build` runs `remove-dist`, then the build script, then `copy:package.cjs.json`. The `postbuild` hook runs `publint` on the result, and `prerelease` runs the Deno tests before the build.

Sources: [package.json:29-36](repo://package.json#L29-L36), [package.json:34-34](repo://package.json#L34-L34)

`bun run test` runs `tsc -p tsconfig.spec.json` to type-check the tests, and then `vitest --run`. The `lint` script runs ESLint over `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks`.

Sources: [package.json:14-14](repo://package.json#L14-L14), [package.json:24-24](repo://package.json#L24-L24)

## Test projects

`vitest.config.ts` has a `main` project that runs the `src` tests with the automatic JSX runtime from `./src/jsx`. Further projects cover the other JSX runtime modes, and the config also includes every `runtime-tests/*/vitest.config.ts`, so the workerd, Node, Lambda and other runtime tests run in their own environments.

Sources: [vitest.config.ts:25-45](repo://vitest.config.ts#L25-L45), [vitest.config.ts:46-70](repo://vitest.config.ts#L46-L70)

The Deno and Bun suites are separate scripts. `test:deno` runs `deno test` on `runtime-tests/deno`, `runtime-tests/deno-jsx`, and their precompile and react-jsx configurations, and `test:bun` runs `bun test` on `runtime-tests/bun`.

Sources: [package.json:16-17](repo://package.json#L16-L17)
