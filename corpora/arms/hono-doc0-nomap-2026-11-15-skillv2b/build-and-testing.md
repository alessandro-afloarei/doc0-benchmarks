---
title: "Build, Package Exports and Testing"
---
## Overview

Hono is written in TypeScript under `src/` and published twice: to npm as `hono`, compiled to ESM, CommonJS and declaration files, and to JSR as `@hono/hono`, as TypeScript source. Bun is the project's package manager and script runner. Tests run with Vitest for the shared suite and with each runtime's own test runner (or a Vitest project emulating it) to check that the same code behaves the same everywhere.

Sources: [package.json:1-37](repo://package.json#L1-L37), [jsr.json:1-12](repo://jsr.json#L1-L12), [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39)

## Local setup

```bash
git clone git@github.com:honojs/hono.git && cd hono
bun install --frozen-lockfile
bun run test     # type-check the tests, then run Vitest
bun run build    # build dist/
bun run lint && bun run format
```

Sources: [docs/CONTRIBUTING.md:27-60](repo://docs/CONTRIBUTING.md#L27-L60), [package.json:11-36](repo://package.json#L11-L36)

Pull requests must pass `bun run test`. Third-party middleware that depends on other libraries or on one platform belongs in the separate `honojs/middleware` monorepo, not in this package, which keeps the core dependency-free.

Sources: [docs/CONTRIBUTING.md:37-54](repo://docs/CONTRIBUTING.md#L37-L54)

## Package exports

Every public module is a subpath export listed in `package.json`: the root, `hono/tiny` and `hono/quick` presets, each middleware (`hono/cors`, `hono/jwt`, ...), each helper (`hono/cookie`, `hono/streaming`, ...), JSX entry points, routers, `hono/client`, each adapter, and `hono/utils/*`. Each entry maps `types`, `import` and `require` to `dist/types`, `dist` and `dist/cjs`. A `typesVersions` block repeats the map for TypeScript configurations that ignore `exports`.

Sources: [package.json:38-120](repo://package.json#L38-L120), [package.json:319-323](repo://package.json#L319-L323), [package.json:415-420](repo://package.json#L415-L420)

`jsr.json` maps the same subpaths directly to `.ts` files under `src/`. Separate entry points are what let an application import one middleware without pulling in the others, and what keeps `hono/tiny` small ([[Hono Overview]]).

Sources: [jsr.json:1-20](repo://jsr.json#L1-L20)

## The build script

### Validating exports

`bun ./build/build.ts` (run by `bun run build` after deleting `dist`) first reads the `exports` of `package.json` and `jsr.json` and checks each against the other with `validateExports`. An entry is accepted if it exists in the other file, or if a wildcard there covers it (`./utils/*` covers `./utils/jwt`); otherwise the build fails with `Missing "<entry>" in '<file>'`. This prevents a module from being published to npm but not JSR, or the reverse.

Sources: [build/build.ts:18-26](repo://build/build.ts#L18-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

### Compiling

Every `src/**/*.ts` file except tests becomes an entry point. Three jobs run in parallel.

Sources: [build/build.ts:103-107](repo://build/build.ts#L103-L107)

| Job | Output | Notes |
| --- | --- | --- |
| esbuild, ESM | `dist/` | `bundle: true` with the `addExtension` plugin, which marks every import external and rewrites it to a `.js` path (or `/index.js` for directories), so files stay separate but get the explicit extensions Node's ESM loader requires |
| esbuild, CJS | `dist/cjs/` | One file per source file |
| `tsc --emitDeclarationOnly` | `dist/types/` | Uses `tsconfig.build.json` |

Sources: [build/build.ts:28-107](repo://build/build.ts#L28-L107)

`--watch` switches esbuild to `context().watch()` and `tsc` to `-w` for `bun run watch`. After the build, `package.cjs.json` (`{ "type": "commonjs" }`) is copied into `dist/cjs` and `dist/types`, so Node treats those folders as CommonJS despite the package's `"type": "module"`. `publint` then checks the package for publishing mistakes.

Sources: [build/build.ts:94-101](repo://build/build.ts#L94-L101), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3), [package.json:29-32](repo://package.json#L29-L32)

### Removing private fields from declarations

Finally, `removePrivateFields` parses every emitted `.d.ts` with `oxc-parser`, finds class properties whose key is a `#private` identifier, and overwrites them with spaces, keeping every other character offset unchanged. `Hono` keeps internals such as `#path` and `#notFoundHandler` in `#` fields, and this step keeps them out of the published declarations. Fields that other instances must reach at run time, such as `errorHandler` (read by `route()` on a sub-app), use TypeScript's `private` instead, as the comments in `hono-base.ts` note.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:1-57](repo://build/remove-private-fields.ts#L1-L57), [src/hono-base.ts:118-124](repo://src/hono-base.ts#L118-L124), [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188)

## Tests

### The Vitest workspace

`vitest.config.ts` defines several projects.

Sources: [vitest.config.ts:25-27](repo://vitest.config.ts#L25-L27)

| Project | Includes | JSX import source |
| --- | --- | --- |
| `main` | `src/**/*.test.*`, `build/**/*.test.*` | `./src/jsx` |
| `jsx-runtime-default` | DOM renderer and DOM hooks tests | `./src/jsx` |
| `jsx-runtime-dom` | The same tests | `./src/jsx/dom` |
| `runtime-tests/*/vitest.config.ts` | One project per runtime folder | |

Sources: [vitest.config.ts:1-73](repo://vitest.config.ts#L1-L73)

Running the DOM tests under both JSX import sources checks that components behave the same whether compiled against `hono/jsx` or `hono/jsx/dom` ([[Client-Side JSX and Hooks]]). Coverage is collected with V8, excluding type-only files such as `types.ts` and `intrinsic-elements.ts`. Files named `*.case.test.*` (for example `src/router/common.case.test.ts`) are shared suites imported by each router's own tests, not run directly ([[Routers and Presets]]).

Sources: [vitest.config.ts:5-24](repo://vitest.config.ts#L5-L24), [vitest.config.ts:36-36](repo://vitest.config.ts#L36-L36)

`bun run test` first runs `tsc -p tsconfig.spec.json`, so type-level tests in files such as `src/types.test.ts` and `src/client/types.test.ts` fail the run when an inferred type changes ([[Env, Handler and Schema Types]], [[RPC Client]]).

Sources: [package.json:14-14](repo://package.json#L14-L14)

### Runtime tests

| Script | Runs | Covers |
| --- | --- | --- |
| `test:deno` | `deno test` on `runtime-tests/deno` and `runtime-tests/deno-jsx` (precompile and react-jsx configs) | Deno adapter, SSG, streaming, JSX transforms |
| `test:bun` | `bun test` on `runtime-tests/bun` | Bun adapter, static files, WebSockets |
| `test:node` | Vitest project using `@hono/node-server` | Node.js through the external adapter |
| `test:workerd` | Vitest project for `runtime-tests/workerd` | Cloudflare Workers runtime |
| `test:fastly` | Vitest project with the Fastly Compute plugin | Fastly |
| `test:lambda`, `test:lambda-edge` | Vitest projects with mocked events and streams | [[AWS Lambda and Lambda@Edge]] |

Sources: [package.json:14-23](repo://package.json#L14-L23), [runtime-tests/workerd/vitest.config.ts:1-8](repo://runtime-tests/workerd/vitest.config.ts#L1-L8)

The `ci` workflow runs formatting, lint, editorconfig, build and `bun run test`, a JSR publish dry run, and one job per runtime (Node.js over a version matrix, Bun on Linux and Windows). On pull requests it also measures type-check time, bundle size and HTTP throughput against `main`, using the scripts in `perf-measures/` and `benchmarks/`.

Sources: [.github/workflows/ci.yml:38-70](repo://.github/workflows/ci.yml#L38-L70), [.github/workflows/ci.yml:116-200](repo://.github/workflows/ci.yml#L116-L200)

## Releasing

Pushing a version tag triggers the `release` workflow, which publishes to npm with provenance and to JSR. Locally, `bun run release` uses `np --no-publish` to bump the version and tag, after `prerelease` has run the Deno tests and a build.

Sources: [.github/workflows/release.yml:1-51](repo://.github/workflows/release.yml#L1-L51), [package.json:34-35](repo://package.json#L34-L35)
