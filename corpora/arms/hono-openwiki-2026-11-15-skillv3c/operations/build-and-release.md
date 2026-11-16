---
type: operations
title: Build, Exports, and Release
description: How Hono is built and published — the Bun/esbuild build script producing ESM, CJS and declaration outputs, private-field stripping from .d.ts files, package.json/jsr.json export validation, publint, CI checks, and the tag-triggered npm and JSR release workflow.
tags: [build, esbuild, exports, jsr, npm, release, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
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
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Build, Exports, and Release

Hono is published to **npm** as `hono` (built JavaScript + types in `dist/`) and to **JSR** as `@hono/hono` (TypeScript sources from `src/`). Both registries expose the same set of subpath exports, which the build verifies.

## Build pipeline (`bun run build`)

`package.json` scripts: `build` = `remove-dist` → `bun ./build/build.ts` → copy `package.cjs.json`; then the `postbuild` hook runs `publint`. `bun run watch` runs the same script with `--watch`.

`build/build.ts` (run by Bun) does:

1. **Export validation** — reads `exports` from `package.json` and `jsr.json` and calls `validateExports` in both directions. Any subpath present in one file but not the other throws `Missing "<entry>" in '<file>'` and aborts the build. Wildcard entries (`./utils/*`) are matched against concrete entries and vice versa.
2. **Entry points** — every `src/**/*.ts` file except tests (`*.test.ts`), `src/mod.ts`, `src/middleware.ts`, and `src/deno/**` is an entry point, so the output mirrors the source tree file-for-file.
3. **Three parallel outputs:**
   - **ESM** → `dist/` via esbuild with `bundle: true` plus an `add-extension` plugin that marks every import as external and rewrites it to an explicit `.js` (or `/index.js`) path. The effect is unbundled per-file ESM with Node-compatible specifiers.
   - **CJS** → `dist/cjs/` via esbuild `format: 'cjs'` (not bundled).
   - **Types** → `dist/types/` via `tsc --emitDeclarationOnly` with `tsconfig.build.json` (excludes tests; `noUnusedLocals`/`noUnusedParameters`).
4. **Private-field stripping** — `build/remove-private-fields.ts` parses each emitted `.d.ts` with `oxc-parser` and blanks out `#private` property declarations (replacing them with spaces to keep offsets stable). This keeps ECMAScript private fields out of the public type surface.

After esbuild, `package.cjs.json` (`{ "type": "commonjs" }`) is copied into `dist/cjs/package.json` and `dist/types/package.json`, so Node treats those trees as CommonJS even though the package root is `"type": "module"`.

### Package entry points

`package.json` declares `main` (`dist/cjs/index.js`), `module` (`dist/index.js`), `types`, a large `exports` map with `types`/`import`/`require` conditions for every subpath (core, presets, each middleware, helper and adapter, JSX runtimes), and a mirrored `typesVersions` map for older TypeScript resolution. Only `dist` (minus `*.tsbuildinfo`) is published. The package declares `engines.node >= 16.9.0`. See [Architecture Overview](../overview/architecture.md) for what each subpath contains.

`jsr.json` maps the same subpaths directly to `src/**/*.ts`, enables Deno's `sloppy-imports` (extensionless imports), and publishes `src/**/*.ts` (excluding tests) plus `LICENSE`, `README.md`, and `jsr.json`.

### Adding a new public module

1. Create the module under `src/`.
2. Add the subpath to **both** `package.json` `exports` (and `typesVersions`) and `jsr.json` `exports`; otherwise the build fails validation.
3. `build/validate-exports.test.ts` and `publint` catch mismatches; the CI `jsr-dry-run` job runs `bunx jsr publish --dry-run`.

## CI (`.github/workflows/ci.yml`)

The main job runs `format` (Prettier check), `lint` (ESLint), `editorconfig-checker`, `build`, and `test`. Additional jobs run the JSR dry-run, Deno (runtime and two JSX modes) with coverage, Bun (Linux and Windows), Fastly, Node.js 20/22/24, workerd, AWS Lambda, and Lambda@Edge test projects (see [Testing, Runtime Tests, and Benchmarks](../testing/testing-strategy.md)). Pull requests also get type-check/bundle-size measurements (`.github/actions/perf-measures`) and an HTTP speed benchmark comment.

## Release

- Locally, `bun run release` uses `np --no-publish` to bump the version and tag; `prerelease` runs the Deno tests and a build first.
- Pushing a tag triggers `.github/workflows/release.yml`:
  - **npm**: install, `bun run build`, then `npm stage publish --provenance --access public` using OIDC (`id-token: write`).
  - **JSR**: `deno run -A jsr:@david/publish-on-tag`, which publishes the tagged version from sources.
- Tool versions (Node, Bun, Deno) come from `.tool-versions`.
