---
type: operations
title: Build, Packaging and Release
description: How Hono is built into ESM, CJS and type declarations with esbuild and tsc, how package.json and jsr.json export maps are kept in sync, which CI jobs gate changes (lint, format, tests on many runtimes, bundle/type/HTTP performance checks), and how tagged releases publish to npm and JSR.
tags: [build, release, ci, packaging, jsr, npm, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
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
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Build, Packaging and Release

The tooling is Bun-centred. `bun install --frozen-lockfile` is used everywhere. Node, Bun and Deno versions are pinned in `.tool-versions`, which the CI setup actions read.

## Build (`build/build.ts`)

`bun run build` runs `remove-dist`, then `bun ./build/build.ts`, then copies `package.cjs.json` (`{"type": "commonjs"}`) into `dist/cjs` and `dist/types`. A `postbuild` step runs `publint`.

The build script:

1. **Validates exports** in both directions: every `package.json` export must exist in `jsr.json` and vice versa (`build/validate-exports.ts`). Wildcards such as `./utils/*` are matched against the prefixes of concrete entries. A mismatch aborts the build.
2. **Collects entry points.** Every `src/**/*.ts` file except tests becomes its own entry point. There is no single bundled file, so each module maps one-to-one to a `dist` file and tree-shaking works per subpath.
3. **Builds in parallel:**
   - **ESM** → `dist/`. This uses `bundle: true` with a custom `add-extension` plugin that marks every relative import as external and rewrites it to a `.js` path, `/index.js` for directories. The result is per-file ESM with fully specified import paths.
   - **CJS** → `dist/cjs/`, without bundling.
   - **Types** → `tsc --emitDeclarationOnly --project tsconfig.build.json` into `dist/types/`.
4. **Strips `#private` fields** from all generated `.d.ts` files (`build/remove-private-fields.ts`, which uses `oxc-parser`). This keeps internal state out of the public type surface.

`bun run watch` runs the same pipeline with esbuild `context().watch()` and `tsc -w`.

## Package surface

- `package.json` `exports` has a `types`/`import`/`require` triple for each subpath. `typesVersions` mirrors it for `moduleResolution: node`. `files` ships only `dist` (without `.tsbuildinfo`). `engines.node` is `>=16.9.0`.
- `jsr.json` publishes `@hono/hono` straight from the TypeScript sources. Its `exports` point at `src/**/*.ts`.
- Adding a module therefore means adding it to `package.json` (`exports` and `typesVersions`) **and** `jsr.json`. The build enforces the first two maps against each other. See [Architecture Overview](../architecture/overview.md).

## CI (`.github/workflows/ci.yml`)

The workflow runs on pushes to `main`/`next` and on pull requests, except for doc-only changes:

| Job | What it runs |
| --- | --- |
| Main | `format` (prettier check), `lint` (eslint), `editorconfig-checker`, `build`, `test` (`tsc -p tsconfig.spec.json && vitest --run`), and uploads coverage |
| JSR dry run | `bunx jsr publish --dry-run` |
| Deno | `runtime-tests/deno` and both `runtime-tests/deno-jsx` configs, with coverage |
| Bun / Bun - Windows | `bun run test:bun` |
| Fastly, workerd, AWS Lambda, Lambda@Edge | `build` then `test:<runtime>` (Vitest projects under `runtime-tests/`) |
| Node.js 20 / 22 / 24 | `build` then `test:node` |
| Coverage | Merges the coverage artifacts from main, bun and deno and uploads them to Codecov (`fail_ci_if_error`) |
| Type & Bundle size check (PR / main) | The local `.github/actions/perf-measures` action |
| HTTP Speed Check on PR | `benchmarks/http-server/benchmark.ts` with `bombardier`. Posts a results comment on PRs from the same repository and hides older ones |

See [Testing Strategy](../testing/testing-strategy.md) for what each test suite covers.

## Performance measurements

- **`perf-measures/bundle-check`** bundles and minifies `dist/index.js` with esbuild (ESM, es2022) and reports the size in bytes. This tracks the cost of the default `hono` import.
- **`perf-measures/type-check`** generates a large app (`scripts/generate-app.ts`), type-checks it together with an RPC client (`client.ts`), and processes the compiler diagnostics (`process-results.ts`). Changes to `src/types.ts` or `src/client/types.ts` can make inference much slower, and this check catches that.
- **`benchmarks/`** holds manual benchmarks: routers (Node and Deno), JSX rendering, query parsing, utils, and the HTTP server benchmark used in CI. Each has its own `package.json` and is not part of the main install.

## Release

- Maintainers run `bun run release` (`np --no-publish`) to bump the version, tag and push. `prerelease` runs the Deno tests and a build first.
- `.github/workflows/release.yml` triggers on **any tag push**:
  - **npm**: build, then `npm stage publish --provenance --access public` with OIDC (`id-token: write`).
  - **JSR**: `deno run -A jsr:@david/publish-on-tag`, which publishes `jsr.json` with the tag's version. The version in `jsr.json` is `0.0.0` in the repository.
- `.github/workflows/cr.yml` publishes preview builds through `pkg.pr.new` for `main` and for PRs labelled `cr-tracked`.
