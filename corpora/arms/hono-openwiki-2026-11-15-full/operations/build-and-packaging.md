---
type: operations
title: Build and Packaging
description: How Hono is built and published — build/build.ts with esbuild (ESM and CJS) plus tsc declarations, export-map validation between package.json and jsr.json, stripping private class fields from .d.ts files, publint, package layout under dist/, and the npm/JSR/pkg.pr.new release workflows.
tags: [build, packaging, esbuild, jsr, npm, release]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
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
  - id: openwiki-source-493ba14a90823e29eec8dfdf
    resource: repo://tsconfig.build.json
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Build and Packaging

Hono ships as one npm package (`hono`) with ~75 subpath exports, and as `@hono/hono` on JSR. The build is driven by Bun running `build/build.ts`.

## Commands

| Script | What it does |
| --- | --- |
| `bun run build` | `rm -rf dist`, run `bun ./build/build.ts`, copy `package.cjs.json` into `dist/cjs/package.json` and `dist/types/package.json`. |
| `postbuild` | `publint` checks the package metadata/exports against `dist/`. |
| `bun run watch` | Same build in watch mode (`--watch`). |
| `prerelease` | `bun test:deno && bun run build`. |
| `release` | `np --no-publish` (version bump/tag; publishing happens in CI). |

## build/build.ts

1. **Validate export maps** – reads `exports` from `package.json` and `jsr.json` and calls `validateExports` in both directions. Every subpath in one file must exist in the other (a wildcard like `./utils/*` is satisfied by any entry under that prefix, and an entry is satisfied by a matching parent wildcard). A mismatch throws `Missing "<entry>" in '<file>'` and aborts the build.
2. **Collect entry points** – every `src/**/*.ts` file except tests (`src/**/*.test.ts`) and a few legacy paths (`src/mod.ts`, `src/middleware.ts`, `src/deno/**`). Every module is therefore its own output file, which keeps imports tree-shakable.
3. **Run three builds in parallel**:
   - **ESM** → `dist/` with esbuild `bundle: true` but an `add-extension` plugin that marks every import as external and rewrites it to an explicit `.js` path (`./foo` → `./foo.js`, `./dir` → `./dir/index.js`). The result is unbundled ESM with Node-compatible specifiers.
   - **CJS** → `dist/cjs/` with esbuild `format: 'cjs'` (no bundling).
   - **Types** → `tsc --emitDeclarationOnly --declaration -p tsconfig.build.json` into `dist/types/` (`noUnusedLocals`/`noUnusedParameters` enabled; tests excluded).
4. **Strip private fields from declarations** – `build/remove-private-fields.ts` parses each `dist/types/**/*.d.ts` with `oxc-parser`, finds class `PropertyDefinition`s whose key is a `PrivateIdentifier` (`#field`), and blanks them out with spaces (so source offsets stay valid). Published typings therefore contain no `#private` members.

Both esbuild builds use `platform: 'node'`. `package.cjs.json` (`{"type": "commonjs"}`) marks `dist/cjs` (and `dist/types`) as CommonJS scopes because the root package is `"type": "module"`.

## Package layout and exports

```
dist/
  *.js            ESM (import)
  cjs/*.js        CommonJS (require)
  types/*.d.ts    declarations
```

Each `exports` entry in `package.json` maps `types`, `import` and `require` conditions to these trees. `typesVersions` duplicates the subpath → `dist/types/...` mapping for TypeScript configurations that do not understand `exports`. The `files` field publishes `dist` only (excluding `.tsbuildinfo`). `engines.node` is `>=16.9.0`.

`jsr.json` maps the same subpaths directly to `src/*.ts` files (JSR publishes TypeScript sources), with Deno compiler options (`dom`, `deno.ns` libs) and `sloppy-imports` enabled.

### Adding a new public module

1. Create `src/<area>/<name>/index.ts`.
2. Add the subpath to `package.json` `exports` (all three conditions) and `typesVersions`.
3. Add the same subpath to `jsr.json` `exports`.
4. Run `bun run build`; export validation and `publint` will fail if something is missing.

## Release and preview publishing (CI)

- `.github/workflows/release.yml` runs on tag pushes: it builds with Bun and publishes to npm with provenance (`npm stage publish --provenance`), and in a separate job publishes to JSR from the tag.
- `.github/workflows/cr.yml` publishes preview builds of `main` and labelled PRs to pkg.pr.new.
- `.github/workflows/ci.yml` runs lint, format, tests and runtime tests (see [Testing Strategy](../testing/testing-strategy.md)).

## Tests

- `build/validate-exports.test.ts` – wildcard and missing-entry behavior of `validateExports`.
- `build/remove-private-fields.test.ts` – removal of `#private` fields from declaration source.

Both run in the `main` Vitest project, which includes `build/**/*.test.ts`.
