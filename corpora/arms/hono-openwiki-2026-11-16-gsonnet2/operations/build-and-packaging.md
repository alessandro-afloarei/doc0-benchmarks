---
type: operations
title: Build, Exports and Packaging
description: How the Hono package is built (esbuild ESM and CJS plus tsc declarations with private-field stripping), how package.json and jsr.json exports are kept in sync, CI checks, and how to add a new subpath entrypoint.
tags: [build, esbuild, exports, jsr, npm, ci, packaging]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
  - id: openwiki-source-7a06072801a3639bbb757eb0
    resource: repo://build/remove-private-fields.ts
  - id: openwiki-source-9da6b2729ff1e4995454efe6
    resource: repo://build/validate-exports.ts
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-d0e5c88136f69ed3070d47cf
    resource: repo://package.cjs.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Build, Exports and Packaging

Hono is published to npm (`hono`) and JSR (`@hono/hono`) from the same `src/` tree. There is no bundle: every source file becomes its own module so consumers can import only the subpaths they need (`hono/cors`, `hono/jsx`, `hono/utils/*`), which is central to its small-footprint pitch ([Quickstart](../quickstart.md)).

## Build pipeline (`build/build.ts`, run by `bun run build`)

`bun run build` removes `dist/`, executes `bun ./build/build.ts`, then copies `package.cjs.json` (`{"type": "commonjs"}`) into `dist/cjs/` and `dist/types/` so Node treats those trees as CommonJS even though the root package is `"type": "module"`. After the build, `publint` runs as the `postbuild` hook.

`build.ts` performs, in order:

1. **Export parity validation.** It reads `exports` from `package.json` and `jsr.json` and calls `validateExports` in both directions. A missing entry throws `Missing "<entry>" in '<file>'`, failing the build. Wildcard entries are honoured: `./utils/*` in package.json satisfies any `./utils/<name>` listed in jsr.json, and vice-versa via prefix matching (`build/validate-exports.ts`, tested in `validate-exports.test.ts`).
2. **Entry discovery.** All `src/**/*.ts` files are entry points except tests, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`.
3. **Three parallel outputs:**
   - **ESM** (`dist/`): `esbuild` with `format: 'esm'`, `bundle: true` but with every import marked external by a custom `addExtension('.js')` plugin that rewrites relative imports to explicit `.js` (or `/index.js`) paths, i.e. file-by-file transpilation that is Node-ESM compatible.
   - **CJS** (`dist/cjs/`): plain `esbuild` transform with `format: 'cjs'`.
   - **Types** (`dist/types/`): `tsc --emitDeclarationOnly --declaration -p tsconfig.build.json`.
4. **Private field removal.** `removePrivateFields` (`build/remove-private-fields.ts`) parses every emitted `.d.ts` with `oxc-parser` and blanks out class properties whose key is a `#private` identifier. The edit replaces the property text with spaces, preserving offsets. (Presumably this is done because `#private` members make classes nominally typed in declarations, so copies of Hono from different package installs would not be assignable to each other; the source does not state the reason.)

`--watch` switches esbuild to its watch context and `tsc -w`.

Targets: `tsconfig.base.json` uses `ES2022`, `moduleResolution: Bundler`, `strict`. The build config adds `noUnusedLocals`/`noUnusedParameters` and excludes tests.

## Exports map conventions

`package.json#exports` gives every entry three conditions: `types` (`dist/types/...d.ts`), `import` (`dist/...js`) and `require` (`dist/cjs/...js`); a parallel `typesVersions` block supports older `moduleResolution: node` consumers. `jsr.json` maps the same subpaths directly to `./src/...ts` (with `unstable: ["sloppy-imports"]` because sources import extensionless paths). `./utils/*` and a few other groups use wildcards.

**Adding a new entrypoint** (e.g. a middleware `src/middleware/foo/index.ts`): add the export to *both* `package.json` (all three conditions plus `typesVersions`) and `jsr.json`; the parity check fails the build otherwise. No change to `build.ts` is needed because entry discovery is glob-based. Keep implementation free of Node-only imports unless the module is documented as Node-specific (like `context-storage`, which needs `node:async_hooks`), since runtimes vary ([Runtime Adapters](../platform/adapters.md)).

## Scripts and CI

- `bun run lint` (ESLint over `src runtime-tests build perf-measures benchmarks`), `bun run format` / `format:fix` (Prettier), `editorconfig-checker`.
- `bun run test` runs `tsc -p tsconfig.spec.json && vitest --run`, so type tests run as part of testing; see [Testing](testing.md) for runtime-specific scripts.
- `release` uses `np --no-publish`; `prerelease` runs the Deno tests and a build.
- CI (`.github/workflows/ci.yml`) runs on pushes to `main`/`next` and PRs: a **Main** job (format, lint, editorconfig, build, test on Node), plus jobs for Bun (Linux and Windows), Deno, a JSR dry-run, Fastly Compute, a Node version matrix, workerd, AWS Lambda and Lambda@Edge, type/bundle-size and HTTP-benchmark checks on PRs, and a coverage-merge job uploading to Codecov. Tool versions come from `.tool-versions` (Node 24.7.0, Bun 1.2.19, Deno 2.4.5).
- `.github/workflows/openwiki-update.yml` is a scheduled workflow that refreshes the generated wiki; its generated outputs under `openwiki/` should not be hand-edited.
