---
title: "Build, Exports and Testing"
---
## Overview

Hono is published as one package whose source files are also its entry points: each `src/**/index.ts` or module becomes a file under `dist`, and `package.json` maps import paths such as `hono/cors` onto them. `build/build.ts` produces ESM and CommonJS output plus type declarations, and checks that the npm and JSR export lists agree. Tests run under Vitest for most targets, and per-runtime projects under `runtime-tests` run the same behaviour in Node, workerd, Fastly, Lambda, Deno and Bun. Behaviour of the runtimes themselves is on [[Runtime Adapters]].

Sources: [build/build.ts:18-37](repo://build/build.ts#L18-L37), [package.json:23-35](repo://package.json#L23-L35), [package.json:59-68](repo://package.json#L59-L68)

## Exports map

`package.json` has an `exports` entry for each public module. Each entry gives three targets: `types` in `dist/types`, `import` in `dist` (ESM) and `require` in `dist/cjs` (CommonJS). For example, `hono/tiny` points to the compiled `src/preset/tiny.ts`, and `hono/quick` to `src/preset/quick.ts` ([[Quickstart]]). The `files` list publishes only `dist` and excludes `tsbuildinfo` files.

Sources: [package.json:36-69](repo://package.json#L36-L69), [package.json:1-10](repo://package.json#L1-L10)

```json
"./tiny": {
  "types": "./dist/types/preset/tiny.d.ts",
  "import": "./dist/preset/tiny.js",
  "require": "./dist/cjs/preset/tiny.js"
}
```

Sources: [package.json:1-10](repo://package.json#L1-L10), [package.json:36-69](repo://package.json#L36-L69)

`jsr.json` lists the same entries for JSR, where an export maps straight to the TypeScript source (`"./tiny": "./src/preset/tiny.ts"`). It also names the package `@hono/hono` and enables the `sloppy-imports` unstable option.

Sources: [jsr.json:1-23](repo://jsr.json#L1-L23)

## The build script

`bun ./build/build.ts` runs these steps:

Sources: [build/build.ts:14-114](repo://build/build.ts#L14-L114)

1. Read the `exports` of `package.json` and `jsr.json` and call `validateExports` in both directions. It throws `Missing "<entry>" in '<file>'` when an entry of one is absent in the other; a wildcard entry such as `./utils/*` is satisfied by any entry beneath that prefix, and an entry is satisfied by a wildcard parent.
2. Collect every `src/**/*.ts` file as an entry point, except tests, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`.
3. Run three jobs in parallel: an ESM esbuild (`bundle: true`, `outdir: ./dist`), a CommonJS esbuild (`outdir: ./dist/cjs`), and `tsc --emitDeclarationOnly` with `tsconfig.build.json` into `dist/types`.
4. Post-process the declaration files with `removePrivateFields`.

Sources: [build/build.ts:14-37](repo://build/build.ts#L14-L37), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [build/build.ts:72-114](repo://build/build.ts#L72-L114)

Because each source file is its own entry, the output keeps the source layout, and a bundler can import just the module it needs. The ESM config uses an `addExtension` plugin that marks every relative import as external and rewrites it to carry the `.js` extension (or `/index.js` for a directory import), so the emitted ESM files can be loaded directly by Node and other runtimes that require explicit extensions.

Sources: [build/build.ts:39-70](repo://build/build.ts#L39-L70), [build/build.ts:85-92](repo://build/build.ts#L85-L92)

`removePrivateFields` parses each `.d.ts` file with `oxc-parser` and blanks out class property declarations whose key is a `#private` identifier (replacing them with spaces so offsets stay put). `HonoBase` uses `#` fields such as `#path`; the script strips such property declarations from the generated declaration files.

Sources: [build/remove-private-fields.ts:5-57](repo://build/remove-private-fields.ts#L5-L57), [src/hono-base.ts:120-122](repo://src/hono-base.ts#L120-L122)

`tsconfig.build.json` limits type output to `src` (rootDir `./src/`, outDir `./dist/types/`), excludes test files, and turns on `noUnusedLocals` and `noUnusedParameters`. `postbuild` runs `publint`, and `copy:package.cjs.json` copies `package.cjs.json` into `dist/cjs` and `dist/types`.

Sources: [tsconfig.build.json:1-17](repo://tsconfig.build.json#L1-L17), [package.json:27-33](repo://package.json#L27-L33)

## Test setup

The root `vitest.config.ts` defines several projects. `main` runs `src/**/*.test.*` (plus `scripts` and `build` tests) with JSX compiled by the automatic runtime against `./src/jsx`; it excludes `sandbox` folders and `*.case.test.*` files. Two more projects, `jsx-runtime-default` and `jsx-runtime-dom`, run the DOM tests under `src/jsx/dom` and `src/jsx/hooks/dom.test.tsx` with the JSX import source set to `./src/jsx` and `./src/jsx/dom` respectively, so the DOM runtime is checked with both configurations ([[JSX DOM Runtime and Hooks]]). Coverage uses the v8 provider and excludes benchmarks, runtime tests and type-only files.

Sources: [vitest.config.ts:1-72](repo://vitest.config.ts#L1-L72)

The root config also includes `./runtime-tests/*/vitest.config.ts`, so each runtime-specific directory with its own Vitest config is a project: `node`, `workerd`, `fastly`, `lambda` and `lambda-edge`. Scripts such as `test:node` and `test:workerd` select one with `--project`. Deno and Bun directories have no Vitest config; they use their own test runners through `test:deno` and `test:bun`, which also cover the JSX behaviour on Deno with its two JSX transform configurations.

Sources: [vitest.config.ts:20-21](repo://vitest.config.ts#L20-L21), [runtime-tests/workerd/vitest.config.ts:1-8](repo://runtime-tests/workerd/vitest.config.ts#L1-L8), [package.json:12-26](repo://package.json#L12-L26)

`bun run test` runs `tsc -p tsconfig.spec.json` first, so the type-level tests fail the run before Vitest starts, then `vitest --run`. `test:all` runs the Vitest suite and then the Deno and Bun suites.

Sources: [package.json:13-23](repo://package.json#L13-L23)

## Lint and format

`lint` runs ESLint over `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks`. `format` checks Prettier formatting for the same folders' `js`, `ts` and `tsx` files, and `format:fix` rewrites them. `editorconfig-checker` is also a script. `prerelease` runs the Deno tests and a full build, and `release` calls `np` without publishing.

Sources: [package.json:12-36](repo://package.json#L12-L36)
