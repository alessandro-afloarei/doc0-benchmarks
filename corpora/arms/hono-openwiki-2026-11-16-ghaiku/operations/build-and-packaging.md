---
type: workflow
title: Build and Packaging
description: How the hono package is built and published - the build script (per-file esbuild ESM and CJS outputs, the import-extension plugin, declaration emit and private-field stripping), the dual package.json and jsr.json export maps and their validation, the CommonJS marker file, the publint check, and the release workflows for npm and JSR.
tags: [build, esbuild, packaging, exports, jsr, npm, declarations, release]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
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
  - id: openwiki-source-d0e5c88136f69ed3070d47cf
    resource: repo://package.cjs.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Build and Packaging

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono is published twice: to npm as `hono` (the `package.json` in the repository root) and to JSR as `@hono/hono` (`jsr.json`). Both publish the same source tree under the same subpath names, and the build is organized so that every module under `src/` is a separately importable entry point. This page explains the build script, the export maps, and the release path. The module layout that these entry points expose is covered in [Architecture Overview](/openwiki/architecture/overview.md).

## Build Entry Points

`build/build.ts` (run by `bun run build`) starts by validating the export maps (described below). It then collects its entry points with a glob over `src/**/*.ts`, excluding test files, `src/mod.ts`, `src/middleware.ts`, and `src/deno/**`. Every remaining file becomes an entry, so new modules are picked up automatically without editing the build configuration.

Three build tasks run in parallel with `Promise.all`:

- **ESM output (`dist/`).** An esbuild configuration with `bundle: true`, `platform: node`, `format: esm`, and `outbase: ./src`. Its `add-extension` plugin resolves each relative import against the file system: a path that resolves to `<path>.ts` is rewritten to `<path>.js`, and a directory import is rewritten to `<path>/index.js`. Those imports are marked external, so each entry keeps its own relative structure in `dist/` rather than being folded into one bundle.
- **CommonJS output (`dist/cjs/`).** The same entries built with `format: cjs`, without bundling and without the extension plugin. `copy:package.cjs.json` copies `package.cjs.json` (containing `{"type": "commonjs"}`) into `dist/cjs` and `dist/types`, so that CommonJS files are interpreted correctly inside a package whose root `package.json` declares `"type": "module"`.
- **Declarations (`dist/types/`).** `tsc --emitDeclarationOnly --declaration --project tsconfig.build.json`. That configuration includes `src/**/*.ts` (and `.mts`) minus test files, uses the `Bundler` module resolution, and emits to `dist/types`.

After declarations are emitted, `removePrivateFields` (`build/remove-private-fields.ts`) parses every file under `dist/types/**/*.d.ts` with `oxc-parser` and removes class members whose names are ECMAScript `#private` identifiers. The source uses `#` fields extensively, but the published declarations keep only the public shape, which avoids leaking internal names and keeps declarations compatible across TypeScript consumers.

The `postbuild` script runs `publint` to check the packed package's metadata. The `build` script first runs `remove-dist`, so each build starts from an empty `dist/`.

## Export Maps

`package.json` declares the npm `exports` map. Each subpath has three conditions: `types` (for `dist/types/...d.ts`), `import` (for `dist/...js`), and `require` (for `dist/cjs/...js`). Examples include `.`, `./request`, `./types`, `./hono-base`, `./tiny`, `./quick`, `./router/*`, `./utils/*`, and every middleware and helper. `jsr.json` declares the equivalent map pointing at the TypeScript sources (`./src/index.ts`, and so on), because JSR consumes source directly.

`build/validate-exports.ts` enforces that the two maps stay in sync. `validateExports(source, target, fileName)` throws `Missing "<entry>" in '<fileName>'` when an entry in one map has no counterpart in the other. Wildcard entries such as `./utils/*` are matched against any target entry under the same prefix. The build calls the validator in both directions, so an entry added to either file must be added to the other.

The `publish` section of `jsr.json` controls what the JSR package contains: `jsr.json`, `LICENSE`, `README.md`, and `src/**/*.ts`, excluding test files. The npm package includes only the `dist` directory (with `*.tsbuildinfo` excluded), as declared in the `files` field of `package.json`.

The two manifests carry different version fields: `package.json` holds the release version (currently `4.12.30`), while `jsr.json` holds the placeholder `0.0.0`, so the JSR version is not maintained by hand in this file.

## Typecheck Configurations

- `tsconfig.base.json` sets `strict`, `composite`, `ES2022` target, `Bundler` module resolution, and `skipLibCheck`.
- `tsconfig.build.json` extends it for declaration output and enables `noUnusedLocals` and `noUnusedParameters` for the build.
<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `tsconfig.spec.json` type-checks everything under `src` including tests, with `jsxImportSource` set to `hono/jsx`, and it is the first step of `bun run test` (see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md)).

## Release Path

- `bun run release` invokes `np --no-publish`, which prepares a version bump and tag without publishing from a developer machine.
- `.github/workflows/release.yml` publishes to npm with `npm stage publish --provenance --access public` after `bun run build`, and publishes to JSR with `deno run -A jsr:@david/publish-on-tag`.
- `.github/workflows/ci.yml` checks the JSR package with `bunx jsr publish --dry-run` as a separate job, so JSR-specific problems surface before a release tag.
- `prerelease` runs the Deno runtime tests and the build before `release`.

## Failure Modes

- An export added to one map without the other fails `validateExports` at the beginning of the build, before any output is written.
- A new source file that must not be public (for example a test fixture) has to match one of the build exclusions or the `publish` excludes; otherwise it becomes an entry point.

## Extension Seams

To add a public module, create it under `src/`, add a subpath entry to both `package.json` and `jsr.json`, and add a runtime test if the module depends on a platform. The build discovers the source file automatically, while the validator enforces the matching export entries.
