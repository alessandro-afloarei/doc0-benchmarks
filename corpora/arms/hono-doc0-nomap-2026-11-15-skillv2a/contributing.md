---
title: "Building and Testing Hono"
---
## Overview

This page is for working on Hono itself: how the source in `src/` becomes the published `hono` npm package and the `@hono/hono` JSR package, how the test suites are organized, and what the CI checks before a change is merged. The repository uses Bun as its package manager and script runner; the framework code it builds has no runtime dependencies (see [[Hono Overview]]).

Sources: [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35), [package.json:13-36](repo://package.json#L13-L36)

```bash
git clone git@github.com:honojs/hono.git && cd hono
bun install --frozen-lockfile
bun run test     # type-check the tests, then run vitest
bun run build    # produce dist/
```

Sources: [docs/CONTRIBUTING.md:56-60](repo://docs/CONTRIBUTING.md#L56-L60), [package.json:14-14](repo://package.json#L14-L14), [package.json:30-31](repo://package.json#L30-L31)

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | The framework; every module is a public entry point |
| `build/` | The build script and its helpers |
| `runtime-tests/` | One test suite per runtime: `bun`, `deno`, `deno-jsx`, `fastly`, `lambda`, `lambda-edge`, `node`, `workerd` |
| `benchmarks/` | Router, JSX, query-string and HTTP server benchmarks against other libraries |
| `perf-measures/` | Bundle-size and type-check performance measurements used in CI |
| `docs/` | Contribution guide and migration guide |

Sources: [vitest.config.ts:7-23](repo://vitest.config.ts#L7-L23), [benchmarks/routers/README.md:1-15](repo://benchmarks/routers/README.md#L1-L15)

## Building

### The build script

`bun run build` removes `dist`, runs `build/build.ts`, copies `package.cjs.json` (`{ "type": "commonjs" }`) into `dist/cjs` and `dist/types`, and finally runs `publint` to check the package. `bun run watch` does the same in watch mode.

Sources: [package.json:29-36](repo://package.json#L29-L36), [package.cjs.json:1-3](repo://package.cjs.json#L1-L3)

`build/build.ts` collects every `src/**/*.ts` file except tests as an entry point and runs three jobs in parallel:

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39), [build/build.ts:103-107](repo://build/build.ts#L103-L107)

| Job | Output | Notes |
| --- | --- | --- |
| esbuild, ESM | `dist/` | `bundle: true` with the `add-extension` plugin, which marks every import external and rewrites it to a `.js` path, so each file stays a separate module |
| esbuild, CJS | `dist/cjs/` | Plain transpilation |
| `tsc --emitDeclarationOnly` | `dist/types/` | Uses `tsconfig.build.json` |

Sources: [build/build.ts:41-101](repo://build/build.ts#L41-L101)

Keeping one output file per source file is what lets each subpath export (`hono/cors`, `hono/jsx`, ...) be imported without pulling in the rest, and lets bundlers tree-shake.

Sources: [build/build.ts:45-70](repo://build/build.ts#L45-L70), [package.json:38-70](repo://package.json#L38-L70)

### Post-processing declarations

After `tsc`, `removePrivateFields` parses every `.d.ts` with `oxc-parser` and blanks out class properties declared with `#private` names. It replaces them with spaces of the same length rather than deleting them, so the offsets of everything else in the file stay valid during the edit.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:5-57](repo://build/remove-private-fields.ts#L5-L57)

### Keeping npm and JSR in sync

The package is published twice: to npm from `dist/` per `package.json`'s `exports`, and to JSR as `@hono/hono` straight from the TypeScript sources per `jsr.json`'s `exports`. Before building, `validateExports` checks both directions and throws `Missing "<entry>" in '<file>'` for any subpath present in one file and absent from the other. A `./utils/*` wildcard counts as covering its sub-entries.

Sources: [build/build.ts:20-26](repo://build/build.ts#L20-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37), [jsr.json:1-20](repo://jsr.json#L1-L20)

> [!IMPORTANT]
> A new public module needs an entry in `package.json` `exports` (and `typesVersions`) and in `jsr.json` `exports`, or the build fails.

Sources: [build/validate-exports.ts:32-37](repo://build/validate-exports.ts#L32-L37), [package.json:415-420](repo://package.json#L415-L420)

JSR publishes `src/**/*.ts` with tests excluded, and CI runs `jsr publish --dry-run` on every change.

Sources: [jsr.json:107-111](repo://jsr.json#L107-L111), [.github/workflows/ci.yml:59-70](repo://.github/workflows/ci.yml#L59-L70)

## Testing

### Unit tests

`bun run test` first type-checks the test files with `tsc -p tsconfig.spec.json`, since many tests assert types (`expectTypeOf`, `@ts-expect-error`), then runs vitest. Tests live next to the code as `*.test.ts(x)`.

Sources: [package.json:14-14](repo://package.json#L14-L14), [src/preset/quick.test.ts:12-20](repo://src/preset/quick.test.ts#L12-L20)

`vitest.config.ts` defines several projects:

Sources: [vitest.config.ts:3-73](repo://vitest.config.ts#L3-L73)

| Project | Runs | JSX import source |
| --- | --- | --- |
| `main` | All `src/**` tests except shared `*.case.test.*` files | `src/jsx` |
| `jsx-runtime-default` | DOM renderer tests | `src/jsx` |
| `jsx-runtime-dom` | The same DOM tests again | `src/jsx/dom` |
| One per `runtime-tests/*/vitest.config.ts` | Runtime suites run through vitest | per suite |

Sources: [vitest.config.ts:23-73](repo://vitest.config.ts#L23-L73)

Running the DOM tests under both JSX runtimes checks that components behave the same whether compiled for `hono/jsx` or `hono/jsx/dom` ([[JSX DOM and Hooks]]). Coverage is collected with V8 and excludes type-only files such as `types.ts`.

Sources: [vitest.config.ts:5-22](repo://vitest.config.ts#L5-L22), [vitest.config.ts:51-71](repo://vitest.config.ts#L51-L71)

Shared router behaviour is written once in `src/router/common.case.test.ts` and run against every router, which is how the five routers stay interchangeable ([[Routing and Router Selection]]).

Sources: [src/router/common.case.test.ts:24-60](repo://src/router/common.case.test.ts#L24-L60)

### Runtime tests

| Script | Runtime |
| --- | --- |
| `test:deno` | Deno, plus the Deno JSX suites with precompiled and `react-jsx` transforms |
| `test:bun` | Bun's own test runner |
| `test:node` | Node.js through `@hono/node-server` |
| `test:workerd` | Cloudflare's runtime through `wrangler`'s `unstable_dev` |
| `test:fastly` | Simulated Fastly globals |
| `test:lambda`, `test:lambda-edge` | Simulated AWS events |
| `test:all` | Unit tests, Deno and Bun |

Sources: [package.json:16-23](repo://package.json#L16-L23), [runtime-tests/workerd/index.test.ts:1-12](repo://runtime-tests/workerd/index.test.ts#L1-L12), [runtime-tests/node/index.test.ts:1-15](repo://runtime-tests/node/index.test.ts#L1-L15)

Most runtime suites import from `src/` directly; the Node, workerd, Fastly and Lambda jobs in CI build first.

Sources: [.github/workflows/ci.yml:115-182](repo://.github/workflows/ci.yml#L115-L182)

## Continuous integration

The `main` job runs, in order: `bun install --frozen-lockfile`, `format` (Prettier check), `lint` (ESLint over `src`, `runtime-tests`, `build`, `perf-measures` and `benchmarks`), `editorconfig-checker`, `build` and `test`. Separate jobs run Deno, Bun (also on Windows), Fastly, Node.js, workerd, Lambda and Lambda@Edge, the JSR dry run, and performance checks on pull requests.

Sources: [.github/workflows/ci.yml:37-53](repo://.github/workflows/ci.yml#L37-L53), [.github/workflows/ci.yml:72-113](repo://.github/workflows/ci.yml#L72-L113), [package.json:24-28](repo://package.json#L24-L28)

The performance checks track two numbers. `check-bundle-size.ts` bundles and minifies `dist/index.js` with esbuild and reports its size. The type-check measurement generates an app with 200 chained routes as its input, since chained route types are the expensive part of the type system ([[Type System: Env, Schema and Handlers]]).

Sources: [perf-measures/bundle-check/scripts/check-bundle-size.ts:1-30](repo://perf-measures/bundle-check/scripts/check-bundle-size.ts#L1-L30), [perf-measures/type-check/scripts/generate-app.ts:1-26](repo://perf-measures/type-check/scripts/generate-app.ts#L1-L26)

## Contributing a change

The pull request template asks contributors to:

Sources: [.github/pull_request_template.md:1-6](repo://.github/pull_request_template.md#L1-L6)

1. add tests;
2. run the tests;
3. run `bun run format:fix && bun run lint:fix`;
4. document new code with TSDoc or JSDoc.

Sources: [.github/pull_request_template.md:1-6](repo://.github/pull_request_template.md#L1-L6)

Middleware that depends on other libraries or works only on one platform does not go into this repository: it belongs in the `honojs/middleware` monorepo and the `@hono` namespace. The guide also allows AI-assisted contributions as long as they do not waste maintainers' time, and states that a maintainer may close a PR without notice to enforce this.

Sources: [docs/CONTRIBUTING.md:21-25](repo://docs/CONTRIBUTING.md#L21-L25), [docs/CONTRIBUTING.md:41-54](repo://docs/CONTRIBUTING.md#L41-L54)
