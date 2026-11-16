---
type: operations
title: Build and release
description: How the hono package is built into dist/ (esbuild ESM and CJS outputs plus tsc declarations), how package.json and jsr.json exports are cross-validated, how #private fields are stripped from .d.ts files, and how CI publishes to npm, JSR and pkg.pr.new.
tags: [build, release, esbuild, exports, jsr, npm, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-d911799c5c93f053614af9f3
    resource: repo://.github/workflows/cr.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
  - id: openwiki-source-7a06072801a3639bbb757eb0
    resource: repo://build/remove-private-fields.ts
  - id: openwiki-source-9da6b2729ff1e4995454efe6
    resource: repo://build/validate-exports.ts
  - id: openwiki-source-d0e5c88136f69ed3070d47cf
    resource: repo://package.cjs.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-939c9255fe164ffbc010d463
    resource: repo://perf-measures/bundle-check/scripts/check-bundle-size.ts
  - id: openwiki-source-493ba14a90823e29eec8dfdf
    resource: repo://tsconfig.build.json
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Build and release

The package ships two artifacts from one source tree (see [Architecture overview](../architecture/overview.md)):

- **npm** (`hono`): compiled JavaScript and declarations in `dist/`, wired up through the `exports` and `typesVersions` fields of `package.json`.
- **JSR** (`@hono/hono`): the raw TypeScript in `src/`, wired up through `jsr.json`. JSR needs no build.

## `bun run build`

`package.json` defines `build` as `remove-dist`, then `bun ./build/build.ts`, then `copy:package.cjs.json`. `postbuild` runs `publint`.

`build/build.ts` (run by Bun) performs these steps:

1. **Export validation.** It reads `exports` from `package.json` and from `jsr.json` and calls `validateExports` in both directions. The build fails with `Missing "<entry>" in '<file>'` when a subpath exists in one manifest and not the other. Wildcard handling (`build/validate-exports.ts`):
   - an entry like `./utils/*` is satisfied when the target contains any `./utils/...` entry;
   - a concrete entry is satisfied by any ancestor `.../*` pattern in the target.

   **Adding a new subpath export therefore means editing `package.json` (`exports` and `typesVersions`) and `jsr.json` together.**
2. **Entry points.** Every `src/**/*.ts` file becomes an entry point, except `*.test.ts`, `src/mod.ts`, `src/middleware.ts` and `src/deno/**`.
3. **Three parallel builds:**
   - ESM goes to `dist/`. It runs esbuild with `bundle: true` and an `add-extension` plugin that marks every relative import as external and rewrites it to `./x.js` or `./x/index.js`. The result is one output file per source file, with Node-compatible ESM specifiers.
   - CJS goes to `dist/cjs/`, using esbuild with `format: 'cjs'`.
   - Declarations go to `dist/types/`, produced by `tsc --emitDeclarationOnly --declaration -p tsconfig.build.json`. That config uses `rootDir: src`, excludes tests, and enables `noUnusedLocals` and `noUnusedParameters`.
4. **Private-field stripping.** `build/remove-private-fields.ts` parses each `dist/types/**/*.d.ts` with `oxc-parser`. It finds class `PropertyDefinition`s keyed by a `PrivateIdentifier` (`#field`) and blanks them out with spaces, which preserves offsets. Public `.d.ts` files then do not expose ECMAScript private fields.
5. `copy:package.cjs.json` writes `{"type":"commonjs"}` into `dist/cjs/package.json` and `dist/types/package.json`. Node then treats the `.js` files under `dist/cjs/` as CommonJS, even though the root package is `"type": "module"`.

`bun run watch` performs the same steps with `--watch` (esbuild contexts and `tsc -w`).

## CI (`.github/workflows/ci.yml`)

- **Main**: `format` (Prettier check), `lint` (ESLint), `editorconfig-checker`, `build`, then `test`. The `test` script is `tsc -p tsconfig.spec.json && vitest --run`.
- **JSR dry run**: `bunx jsr publish --dry-run` verifies that the source can be published to JSR.
- **Runtime jobs**: Deno (including both JSX modes), Bun (Linux and Windows), Fastly Compute, the Node.js version matrix, workerd, AWS Lambda and Lambda@Edge. Most of these jobs run `bun run build` before their test project. See [Testing strategy](../testing/test-strategy.md).
- **On pull requests only**:
  - `perf-measures` reports type-check time and bundle size. `perf-measures/bundle-check` bundles and minifies `dist/index.js` with esbuild (ES2022) and records its size.
  - An HTTP benchmark runs `benchmarks/http-server` with bombardier and comments the results on the PR.

## Release

- `bun run release` runs `np --no-publish`, which bumps the version and creates the tag. `prerelease` runs the Deno tests and a build first.
- Pushing any tag triggers `.github/workflows/release.yml`:
  - **npm**: `bun install --frozen-lockfile`, `bun run build`, then `npm stage publish --provenance --access public`.
  - **JSR**: `jsr:@david/publish-on-tag` publishes `jsr.json`. The `version` field in `jsr.json` is a `0.0.0` placeholder.
- `.github/workflows/cr.yml` publishes preview builds through `pkg.pr.new`. It runs for pushes to `main` and for PRs labeled `cr-tracked`.

## Operational gotchas

- A new module that is not listed in `exports` cannot be imported by consumers, except through the `./utils/*` wildcard.
- Only `src/**/*.ts` files are entry points. Every non-test source file under `src/` is a `.ts` file (`.tsx` is used only in tests), so new runtime modules must also be `.ts`.
- CI builds before running the Node, workerd, Fastly, Lambda and Lambda@Edge projects. Do the same locally to match CI.
