---
title: "Build and Package Layout"
---
## Overview

The `hono` package ships one source tree under `src/` as many small modules, and publishes each feature as its own import path. `package.json` lists those paths, `build/build.ts` produces the ESM, CommonJS and type outputs that they point at, and vitest projects test the same sources on the Node-compatible default plus several other runtimes. This page covers that packaging; what each import does is on the feature pages such as [[Built-in Middleware Catalogue]] and [[Runtime Adapters]].

Sources: [package.json:1-48](repo://package.json#L1-L48), [build/build.ts:72-114](repo://build/build.ts#L72-L114)

## Subpath exports

The package is `"type": "module"`, with `main` pointing at the CommonJS entry and `module` at the ESM one. Its `exports` map has one entry per feature, each with three conditions: `types` under `dist/types`, `import` under `dist`, and `require` under `dist/cjs`. For example `hono/tiny` resolves to `dist/preset/tiny.js`, and the source for `hono/tiny` is `src/preset/tiny.ts` (see [[Quickstart]]).

Sources: [package.json:1-12](repo://package.json#L1-L12), [package.json:13-48](repo://package.json#L13-L48)

Most entries name one file. `./utils/*` is a wildcard that maps every module in `src/utils` to its own import path (`hono/utils/cookie` and so on), while `./utils/jwt` is listed separately because that module is a folder with an `index`. A `typesVersions` map repeats the entries for older TypeScript module resolution. A small `jsr.json` repeats the list for JSR, pointing at the `.ts` sources.

Sources: [package.json:314-324](repo://package.json#L314-L324), [package.json:415-420](repo://package.json#L415-L420), [jsr.json:8-20](repo://jsr.json#L8-L20)

> [!NOTE]
> Because the two lists must agree, `build/validate-exports.ts` checks them in both directions at the start of every build and throws `Missing "<entry>" in '<file>'` for an entry that one file has and the other lacks. A wildcard entry such as `./utils/*` matches any more specific entry under it.

Sources: [build/build.ts:20-26](repo://build/build.ts#L20-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

The consequence for readers of this documentation is that every page's import paths (`hono/cors`, `hono/jsx/dom/client`, `hono/utils/jwt`) correspond to files listed in these maps, not to a single bundle. An app imports only the modules it uses, which is how the `hono/tiny` preset stays small ([[Hono Overview]]).

Sources: [package.json:13-48](repo://package.json#L13-L48), [jsr.json:8-20](repo://jsr.json#L8-L20)

## The build

`bun run build` removes `dist`, runs `bun ./build/build.ts`, then copies `package.cjs.json` (which says `"type": "commonjs"`) into `dist/cjs` and `dist/types`, so Node treats the CommonJS output as CJS even though the root package is ESM. `postbuild` runs `publint`.

Sources: [package.json:13-36](repo://package.json#L13-L36), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

`build.ts` first collects every `src/**/*.ts` file as an entry point, except tests, `src/mod.ts`, `src/middleware.ts` and `src/deno`. Three outputs then run in parallel:

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39), [build/build.ts:103-107](repo://build/build.ts#L103-L107)

| Output | Tool | Settings |
| --- | --- | --- |
| `dist/` | esbuild | ESM, `bundle: true` with an `add-extension` plugin that rewrites each relative import to its `.js` (or `/index.js`) file and marks it external, so modules stay separate |
| `dist/cjs/` | esbuild | CommonJS, not bundled |
| `dist/types/` | `tsc` | `--emitDeclarationOnly` with `tsconfig.build.json`, which excludes test files |

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39), [build/build.ts:45-107](repo://build/build.ts#L45-L107), [tsconfig.build.json:1-19](repo://tsconfig.build.json#L1-L19)

When the `--watch` flag is given, esbuild uses a watch context and `tsc` runs with `-w`.

Sources: [build/build.ts:18](repo://build/build.ts#L18), [build/build.ts:94-107](repo://build/build.ts#L94-L107)

After the declarations exist, `removePrivateFields` parses each `dist/types/**/*.d.ts` with `oxc-parser` and cuts class properties whose names are `#private` identifiers out of the file. This is why classes such as `HonoBase` in the source can keep `#`-prefixed fields (see [[Application and Request Dispatch]]) without them leaking into the published type declarations.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:1-50](repo://build/remove-private-fields.ts#L1-L50)

## Tests

`bun run test` type-checks `tsconfig.spec.json` and runs `vitest --run`. The root `vitest.config.ts` defines several projects: the per-runtime projects from `runtime-tests/*/vitest.config.ts`, a `main` project that includes all `*.test.*` and `*.spec.*` files under `src`, `scripts` and `build` (skipping `sandbox` folders and `*.case.test.*`), and two projects for the JSX renderers that compile test JSX with the automatic runtime against `./src/jsx` or `./src/jsx/dom`. Coverage uses V8 and excludes benchmarks, runtime tests, type-only files and a few generated files.

Sources: [package.json:13-15](repo://package.json#L13-L15), [vitest.config.ts:1-73](repo://vitest.config.ts#L1-L73)

Runtime-specific suites live in `runtime-tests/`: `node`, `workerd`, `fastly`, `lambda` and `lambda-edge` are vitest projects (for example the Node one just sets a name and an env variable), while `bun`, `deno` and `deno-jsx` are run by their own test runners. The package scripts expose each: `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge`, `test:deno` and `test:bun`, and `test:all` runs the default suite, Deno and Bun.

Sources: [package.json:13-23](repo://package.json#L13-L23), [runtime-tests/node/vitest.config.ts:1-11](repo://runtime-tests/node/vitest.config.ts#L1-L11)

## Tooling and contribution

The repository uses Bun as its package manager (`packageManager: bun@1.2.20`), with `bun install --frozen-lockfile` for setup, and lists Node 16.9.0 or later as the engine. Lint, format and editor-config checks are separate scripts (`lint`, `format`, `editorconfig-checker`). A PR must pass `bun run test`, and per the contribution guide third-party middleware that depends on other libraries belongs in the separate `honojs/middleware` repository, not in the core.

Sources: [package.json:24-30](repo://package.json#L24-L30), [package.json:696-699](repo://package.json#L696-L699), [docs/CONTRIBUTING.md:27-55](repo://docs/CONTRIBUTING.md#L27-L55)
