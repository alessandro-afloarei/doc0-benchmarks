---
title: "Build, Test and Release"
---
## Overview

Hono is developed with Bun as the package manager and task runner, built with esbuild and the TypeScript compiler, tested with Vitest plus each runtime's own test runner, and published to both npm and JSR. Because the framework promises that one app runs on every runtime, a large part of the test setup exists to run the same code under Node.js, Bun, Deno, workerd (Cloudflare), Fastly Compute and the two AWS adapters. This page follows a change from installation to release.

Sources: [package.json:11-37](repo://package.json#L11-L37), [docs/CONTRIBUTING.md:27-41](repo://docs/CONTRIBUTING.md#L27-L41)

## Setting up

Install Bun, then the dependencies from the lockfile. The pinned tool versions in `.tool-versions` (Node.js, Bun and Deno) are the ones CI uses.

Sources: [docs/CONTRIBUTING.md:27-37](repo://docs/CONTRIBUTING.md#L27-L37), [.tool-versions:1-3](repo://.tool-versions#L1-L3)

```bash
bun install --frozen-lockfile
bun run test      # type-check the tests, then run Vitest
bun run build     # produce dist/
```

Sources: [package.json:11-37](repo://package.json#L11-L37)

## Scripts

| Script | What it runs |
| --- | --- |
| `test` | `tsc -p tsconfig.spec.json`, then `vitest --run` (all Vitest projects) |
| `test:watch` | Vitest in watch mode |
| `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge` | One runtime project from `runtime-tests` |
| `test:deno` | `deno test` on `runtime-tests/deno` and both Deno JSX configurations |
| `test:bun` | `bun test` on `runtime-tests/bun` with `src/jsx` as the JSX source |
| `test:all` | `test`, `test:deno` and `test:bun` |
| `lint`, `lint:fix` | ESLint over `src`, `runtime-tests`, `build`, `perf-measures`, `benchmarks` |
| `format`, `format:fix` | Prettier over the same folders |
| `build`, `watch` | Clean `dist`, run `build/build.ts`, copy the CJS `package.json` |
| `coverage` | Vitest with coverage |
| `release` | `np --no-publish` (tags the version; CI publishes) |

Sources: [package.json:11-37](repo://package.json#L11-L37)

## The build

### Validating exports

`build/build.ts` first compares the `exports` maps of `package.json` (npm) and `jsr.json` (JSR) in both directions with `validateExports`. Every entry must exist in the other file, either exactly or through a `/*` wildcard, so a new subpath such as a new middleware cannot be published to one registry and forgotten in the other. The build fails with `Missing "<entry>" in '<file>'`.

Sources: [build/build.ts:20-26](repo://build/build.ts#L20-L26), [build/validate-exports.ts:1-37](repo://build/validate-exports.ts#L1-L37)

### Compiling

Every `src/**/*.ts` file except tests and a few legacy entry points becomes its own entry point, which is what makes each subpath import individually tree-shakeable. Three jobs then run in parallel:

Sources: [build/build.ts:28-39](repo://build/build.ts#L28-L39)

| Output | Tool | Notes |
| --- | --- | --- |
| `dist/` (ESM) | esbuild, `bundle: true` | The `add-extension` plugin marks every import external and rewrites it to a `.js` file or `/index.js`, so files stay separate but have Node-compatible specifiers |
| `dist/cjs/` (CommonJS) | esbuild | One file per source file |
| `dist/types/` | `tsc --emitDeclarationOnly` with `tsconfig.build.json` | Declaration files |

Sources: [build/build.ts:41-107](repo://build/build.ts#L41-L107)

The `copy:package.cjs.json` script then places a `package.json` declaring CommonJS into `dist/cjs` and `dist/types`, and `postbuild` runs `publint` to check the package layout.

Sources: [package.json:30-33](repo://package.json#L30-L33)

### Removing private fields from declarations

`tsc` writes ECMAScript `#private` fields into the `.d.ts` files. They carry no type information for users and can make a `Hono` type from one copy of the package incompatible with another. `removePrivateFields` parses each declaration file with `oxc-parser`, finds `PropertyDefinition` nodes with a `PrivateIdentifier` key, and blanks them out with spaces so every other offset in the file stays valid.

Sources: [build/build.ts:109-114](repo://build/build.ts#L109-L114), [build/remove-private-fields.ts:5-57](repo://build/remove-private-fields.ts#L5-L57)

## Tests

### Vitest projects

`vitest.config.ts` enables V8 coverage (excluding type-only files such as `types.ts` and `http-status.ts`) and defines several projects:

Sources: [vitest.config.ts:1-24](repo://vitest.config.ts#L1-L24)

| Project | Files | JSX source |
| --- | --- | --- |
| `main` | `src/**/*.test.ts(x)`, `build/**` tests | `src/jsx` |
| `jsx-runtime-default` | `src/jsx/dom` tests and the DOM hooks test | `src/jsx` |
| `jsx-runtime-dom` | The same files | `src/jsx/dom` |
| one per `runtime-tests/*/vitest.config.ts` | `node`, `workerd`, `fastly`, `lambda`, `lambda-edge` | |

Sources: [vitest.config.ts:25-71](repo://vitest.config.ts#L25-L71)

Running the DOM tests twice, once with each JSX import source, checks that components behave the same whether they were compiled for `hono/jsx` or for `hono/jsx/dom` (see [[JSX DOM Runtime and Hooks]]). Files named `*.case.test.*` are shared test cases imported by other tests, such as the router suites that run the same cases against every router in [[Routers]], so they are excluded from direct runs.

Sources: [vitest.config.ts:35-70](repo://vitest.config.ts#L35-L70)

### Runtime tests

`runtime-tests/` holds one folder per runtime: `bun`, `deno`, `deno-jsx`, `fastly`, `lambda`, `lambda-edge`, `node` and `workerd`. The Vitest-based ones run inside emulated environments; Deno and Bun use their own runners, and Deno's JSX tests run under both the precompiled and the `react-jsx` transforms.

Sources: [package.json:12-23](repo://package.json#L12-L23)

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and `next` and on every pull request (except documentation-only changes):

Sources: [.github/workflows/ci.yml:1-16](repo://.github/workflows/ci.yml#L1-L16)

| Job | Steps |
| --- | --- |
| Main | Install, format check, lint, EditorConfig check, build, test; uploads coverage |
| JSR dry run | `jsr publish --dry-run` |
| Deno | Runtime and both JSX test suites with coverage |
| Bun, Bun on Windows | `test:bun` |
| Fastly, Node.js (matrix), workerd, AWS Lambda, Lambda@Edge | Build, then the runtime's test project |
| Coverage | Merges coverage from Main, Bun and Deno and uploads it to Codecov |
| PR checks | Type-check time, bundle size and an HTTP benchmark compared with `main` |

Sources: [.github/workflows/ci.yml:17-120](repo://.github/workflows/ci.yml#L17-L120), [.github/workflows/ci.yml:120-200](repo://.github/workflows/ci.yml#L120-L200)

A pull request should pass `bun run test` locally; the other jobs catch runtime-specific differences.

Sources: [docs/CONTRIBUTING.md:39-41](repo://docs/CONTRIBUTING.md#L39-L41)

## Releasing

A maintainer runs `bun run release`, which uses `np --no-publish` to bump the version and push a tag; `prerelease` runs the Deno tests and a build first. The tag triggers `.github/workflows/release.yml`, which publishes in two jobs with OpenID Connect credentials instead of stored tokens: the npm job builds and runs `npm stage publish --provenance --access public`, and the JSR job publishes the TypeScript sources with `publish-on-tag`.

Sources: [package.json:34-36](repo://package.json#L34-L36), [.github/workflows/release.yml:1-51](repo://.github/workflows/release.yml#L1-L51)

## Contributing middleware

Middleware that depends on other libraries or on a single platform (GraphQL servers, Firebase Auth, Sentry and the like) does not belong in the core package, which keeps no runtime dependencies. It is published separately as third-party middleware, as described in `docs/CONTRIBUTING.md`; the [[Validator]] adapters for schema libraries are an example.

Sources: [docs/CONTRIBUTING.md:43-55](repo://docs/CONTRIBUTING.md#L43-L55)
