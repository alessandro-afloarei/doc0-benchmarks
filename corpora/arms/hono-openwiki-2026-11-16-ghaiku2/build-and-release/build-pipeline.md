---
type: operations
title: Build, Exports, and Release Pipeline
description: How the Hono package is built from src/ into ESM, CommonJS, and type declarations, how export maps in package.json and jsr.json are validated against each other, how #private fields are stripped from declarations, and how release jobs publish to npm and JSR.
tags: [hono, build, esbuild, exports, jsr, npm, typescript, release, publint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
  - id: openwiki-source-7a06072801a3639bbb757eb0
    resource: repo://build/remove-private-fields.ts
  - id: openwiki-source-9da6b2729ff1e4995454efe6
    resource: repo://build/validate-exports.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Build, Exports, and Release Pipeline

Hono ships one source tree to two registries: npm (as `hono`) and JSR (as `@hono/hono`). The build script in `build/build.ts` produces the npm artifacts under `dist/`. The same source is also consumed directly by JSR through `jsr.json`, which points at `src/*.ts`. The build therefore has to keep two export maps consistent, and it has to emit declarations that do not leak JavaScript `#private` fields.

## Entry points and inputs

`bun run build` runs `remove-dist`, then `bun ./build/build.ts`, then copies `package.cjs.json` into `dist/cjs` and `dist/types`. `package.cjs.json` contains only `{"type": "commonjs"}`, which tells Node that the CommonJS output is CJS even though the root package is `"type": "module"`. The `postbuild` script runs `publint` to lint the package metadata.

`build/build.ts` discovers entry points by globbing `src/**/*.ts` and removing:

- `src/**/*.test.ts`,
- `src/mod.ts`,
- `src/middleware.ts`,
- `src/deno/**/*.ts`.

Every remaining file is an esbuild entry point, so each subpath module (`src/router/linear-router/index.ts`, `src/middleware/cors/index.ts`, and so on) becomes its own output file. This is why the package export map can address any module directly.

## Export validation

Before compiling, `build.ts` loads `exports` from both `./package.json` and `./jsr.json` and calls `validateExports` in both directions:

- `validateExports(packageJsonExports, jsrJsonExports, 'jsr.json')`,
- `validateExports(jsrJsonExports, packageJsonExports, 'package.json')`.

`validateExports` (`build/validate-exports.ts`) checks that every source key exists in the target map. It accepts wildcard keys such as `./utils/*`: an entry is satisfied by an exact key, by a wildcard that covers its prefix, or by a parent wildcard. If a key is missing, it throws `Missing "<entry>" in '<file>'` and the build stops before emitting anything. Changing the public surface therefore means editing both `package.json` and `jsr.json`.

## Three compile outputs

After validation, the script runs three tasks in parallel with `Promise.all`:

1. **ESM** (`esmConfig`): esbuild with `bundle: true`, `format: 'esm'`, `outbase: './src'`, and `outdir: './dist'`. The custom `addExtension('.js')` plugin rewrites relative imports to include `.js` (or `/index.js` for directory imports) by checking for the matching `.ts` file on disk. Imports are marked `external`, so each module stays separate and no bundle is produced per entry.
2. **CJS** (`cjsConfig`): the same entry points, `format: 'cjs'`, output in `dist/cjs`, without the extension plugin.
3. **Declarations**: `tsc --emitDeclarationOnly --declaration --project tsconfig.build.json`, which writes `.d.ts` files to `dist/types`. `tsconfig.build.json` excludes test files and sets `noUnusedLocals` and `noUnusedParameters` on. `tsconfig.base.json` sets `strict`, `moduleResolution: Bundler`, and `composite`.

In watch mode (`bun run watch`, which passes `--watch`), esbuild uses `context().watch()` and `tsc -w` runs instead.

## Removing `#private` fields from declarations

Hono classes such as `HonoBase` and `Context` use ECMAScript `#private` fields for internal state. Their declarations are not valid for consumers in every toolchain, and they bloat types. After `tsc` runs, `removePrivateFields` (`build/remove-private-fields.ts`) parses each `dist/types/**/*.d.ts` file with `oxc-parser`, finds `PropertyDefinition` nodes whose key is a `PrivateIdentifier`, and overwrites their source range with spaces. Overwriting with spaces keeps the rest of the file's offsets unchanged, which is why the function does not re-print the file. Only `#` fields are removed; TypeScript `private` members (without `#`) are left in place. The source comments in `hono-base.ts` explain that some fields, such as `_basePath` and `errorHandler`, are declared `private` rather than `#private` because `#` fields would need visibility at JavaScript runtime.

## Release jobs

`.github/workflows/release.yml` has two publishing jobs:

- `publish-to-npm` installs npm 11.17.0, runs `bun install --frozen-lockfile` and `bun run build`, then runs `npm stage publish --provenance --access public`.
- `publish-to-jsr` runs `deno run -A jsr:@david/publish-on-tag@0.1.4`, which publishes the `jsr.json` package from the tag.

The `prerelease` script runs the Deno tests and the build before a release. The `release` script uses `np --no-publish`, so `np` handles versioning and tagging while publishing is left to the workflow.

## Consequences for contributors

- Adding a new public module requires a `package.json` export and a `jsr.json` export with matching keys, or the build will fail on validation.
- A new file under `src/` that is not a test is compiled automatically, even if it is not exported; it is only reachable if an export entry points to it.
- The `dist/` directory is produced only by the build and is removed at the start of each build. Do not edit files in `dist/` by hand.

## Representative tests

- `build/validate-exports.test.ts` covers the export-matching rules, including wildcards.
- `build/remove-private-fields.test.ts` covers the declaration rewrite.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
