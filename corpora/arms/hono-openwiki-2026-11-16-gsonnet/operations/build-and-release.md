---
type: operations
title: Build, Packaging and CI
description: How Hono is built (esbuild ESM + CJS plus tsc declarations), how package.json and jsr.json exports are cross-validated, how private fields are stripped from d.ts files, and what the CI, autofix, release and OpenWiki workflows do.
tags: [build, esbuild, packaging, jsr, npm, ci, release]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
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
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Build, Packaging and CI

The package manager and script runner is **Bun** (`bun install --frozen-lockfile`, `bun run <script>`; see `docs/CONTRIBUTING.md`). The package is `"type": "module"` with ESM as the primary output and a CJS twin.

## Build pipeline (`build/build.ts`, `bun run build`)

`bun run build` = remove `dist/` → `bun ./build/build.ts` → `copy:package.cjs.json` (copies `package.cjs.json`, `{"type":"commonjs"}`, into `dist/cjs/` and `dist/types/` so Node treats those subtrees as CommonJS). `postbuild` runs `publint`.

Steps inside `build.ts`:

1. **Validate exports** — reads `exports` from `package.json` and `jsr.json` and runs `validateExports` both ways (`build/validate-exports.ts`). An entry in one file must exist in the other, either exactly or via a wildcard (`./utils/*`) match; otherwise the build throws `Missing "<entry>" in '<file>'`. This keeps npm and JSR (which maps names directly to `src/*.ts`) in lock-step. See [Architecture Overview](../architecture/overview.md) for the entry list.
2. **Collect entry points** — every `src/**/*.ts` (tests, `src/mod.ts`, `src/middleware.ts`, `src/deno/**` excluded). Each source file becomes its own output file, which is what enables per-feature subpath exports and tree-shaking.
3. **Three parallel builds**:
   - ESM: esbuild with `bundle: true`, `format: 'esm'`, `outdir: dist`, and a custom `add-extension` plugin that marks every relative import external and rewrites it to include `.js` (or `/index.js` for directories), so output is valid native ESM without bundling modules together.
   - CJS: esbuild `format: 'cjs'` into `dist/cjs` without bundling.
   - Types: `tsc --emitDeclarationOnly --declaration --project tsconfig.build.json` into `dist/types` (excludes tests; `noUnusedLocals/Parameters` enabled for the shipped code; base config targets ES2022, `moduleResolution: Bundler`, strict).
4. **Strip private fields from `.d.ts`** — `removePrivateFields` (`build/remove-private-fields.ts`) parses every `dist/types/**/*.d.ts` with `oxc-parser`, finds class `PropertyDefinition`s whose key is a `#private` identifier, and blanks them with spaces (preserving offsets). This keeps `#private` members out of the published type surface; the source comments in `hono-base.ts` ("Cannot use `#` because it requires visibility at JavaScript runtime") mark the few members that must remain TypeScript-`private` instead, because other modules (such as `route()` reading `app.errorHandler`) need runtime access.
5. `--watch` mode uses esbuild contexts and `tsc -w`.

Source-level constraints implied by this pipeline: relative imports must resolve to `.ts`/`index.ts` files; no non-Web-standard globals in core; each public feature must have a `package.json` export (plus matching `dist/types/...` path) and a `jsr.json` export.

## Type-checking

`tsconfig.json` is a solution file referencing `tsconfig.build.json`, `tsconfig.spec.json`, `perf-measures/type-check`, and `runtime-tests/*/tsconfig.json`. `bun run test` runs `tsc -p tsconfig.spec.json` before Vitest, so type errors in tests (including type-level tests like `types.test.ts`) fail the run. See [Testing Strategy](../testing/testing.md).

## Lint / format

`eslint` and `prettier --check` cover `src`, `runtime-tests`, `build`, `perf-measures`, `benchmarks`; `editorconfig-checker` runs in CI. `lint:fix` / `format:fix` fix them.

## CI workflows (`.github/workflows`)

- **`ci.yml`** (push to `main`/`next`, PRs except docs-only): jobs run in parallel — `main` (format, lint, editorconfig, build, `bun run test` on Linux with coverage artifact), JSR dry-run (`bunx jsr publish --dry-run`), Deno, Bun (Linux and Windows), Fastly Compute, Node.js (version matrix, after build), workerd, AWS Lambda and Lambda@Edge. A final `coverage` job merges artifacts from main, bun and deno and uploads to Codecov (`fail_ci_if_error: true`). Per-runtime jobs correspond to the `runtime-tests/*` suites and `test:*` scripts.
- **`autofix.yml`**: runs `format:fix` and `lint:fix` and pushes fixes (autofix.ci).
- **`release.yml`**: on any pushed tag, builds and publishes to npm with provenance (`npm stage publish --provenance --access public`) and to JSR (`@david/publish-on-tag`). `np` is the local release helper (`bun run release`, `--no-publish`), and `prerelease` runs `test:deno` and a build.
- **`openwiki-update.yml`**: scheduled daily (and manual) job that regenerates the OpenWiki documentation, with full git history so the update can diff against the last documented commit.
- **`cr.yml`**: publishes preview packages via pkg.pr.new on `main` and on PRs labelled `cr-tracked`.
- `no-response.yml`: daily job that closes stale issues carrying the "not bug" label.
- `ci.yml` also has PR-only performance jobs: type/bundle-size checks (`perf-measures`) and an HTTP speed benchmark (`benchmarks/http-server`), plus a bundle/type check on `main`.

## Contribution conventions (`docs/CONTRIBUTING.md`)

- PRs must pass `bun run test`; core stays dependency-free and Web-Standards-based. Runtime-specific or third-party-integrated middleware (GraphQL, Firebase Auth, Sentry) belongs in the separate `honojs/middleware` monorepo, not in this repo.
- An AI-usage policy lets maintainers close PRs that waste their time.
- `docs/MIGRATION.md` records breaking changes (e.g. v3→v4 removals, `deno.land/x` → JSR).
