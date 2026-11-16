---
title: "Building and Releasing"
---
## Overview

The `svelte` package is published mostly as source: its `exports` point directly at the ES modules in `src/`, so there is no build step for the runtime. `pnpm build` in `packages/svelte` produces only the artefacts that cannot come from source: the generated error and warning modules, a CommonJS/UMD bundle of the compiler, the bundled TypeScript declarations and the version file, and it finishes by checking that every entry point is tree-shakeable. Releases are driven by Changesets from the repository root and a GitHub Actions workflow.

Sources: [packages/svelte/package.json:10-45](repo://packages/svelte/package.json#L10-L45), [packages/svelte/package.json:140-150](repo://packages/svelte/package.json#L140-L150)

## The build script

### Steps

`pnpm build` runs four steps in order:

Sources: [packages/svelte/package.json:141-141](repo://packages/svelte/package.json#L141-L141)

1. `node scripts/process-messages` regenerates `errors.js` and `warnings.js` from `messages/` ([[Errors and Warnings]]).
2. `rollup -c` bundles the compiler; importing the config also regenerates `src/version.js`.
3. `pnpm generate:types` bundles the type declarations and type-checks the result.
4. `node scripts/check-treeshakeability.js` verifies that importing any entry point has no side effects.

Sources: [packages/svelte/package.json:140-150](repo://packages/svelte/package.json#L140-L150), [packages/svelte/rollup.config.js:6-7](repo://packages/svelte/rollup.config.js#L6-L7)

`pnpm dev` runs the message generator in watch mode alongside `rollup -cw`. `pnpm check` type-checks the runtime (`tsconfig.runtime.json`), the rest of the package, and the type tests in `tests/types`; `check:tsgo` does the same with the native TypeScript preview.

Sources: [packages/svelte/package.json:142-145](repo://packages/svelte/package.json#L142-L145)

### The compiler bundle

`rollup.config.js` takes `src/compiler/index.js` as input and writes a single minified UMD file to `compiler/index.js` (global name `svelte`), resolving and inlining its npm dependencies with the node-resolve and CommonJS plugins. This is what `require('svelte/compiler')` loads, for CommonJS consumers and in-browser use; ES module imports of `svelte/compiler` use the source directly.

Sources: [packages/svelte/rollup.config.js:1-17](repo://packages/svelte/rollup.config.js#L1-L17), [packages/svelte/package.json:41-45](repo://packages/svelte/package.json#L41-L45), [CONTRIBUTING.md:77-79](repo://CONTRIBUTING.md#L77-L79)

### Version

`scripts/generate-version.js` writes `src/version.js` with `VERSION` (the full version from `package.json`) and `PUBLIC_VERSION` (the major version). The compiler stamps `VERSION` into module output, and `svelte/internal/disclose-version` adds `PUBLIC_VERSION` to `window.__svelte.v` ([[Svelte Overview]]). The root `changeset:version` script runs `generate:version` in every package after bumping versions, so the file always matches.

Sources: [packages/svelte/scripts/generate-version.js:1-16](repo://packages/svelte/scripts/generate-version.js#L1-L16), [packages/svelte/src/version.js:1-8](repo://packages/svelte/src/version.js#L1-L8), [package.json:21-23](repo://package.json#L21-L23)

## Type declarations

The source is JavaScript with JSDoc types plus hand-written `.d.ts` files for the public API. `scripts/generate-types.js` uses `dts-buddy` to bundle them into one `types/index.d.ts` that declares every public module (`svelte`, `svelte/compiler`, `svelte/store`, `svelte/reactivity`, `svelte/motion`, `svelte/events`, ...), each mapped to its source entry. `stripInternal` removes anything marked `@internal`, and the package's `#client`/`#compiler` import aliases are resolved through `paths`.

Sources: [packages/svelte/scripts/generate-types.js:23-57](repo://packages/svelte/scripts/generate-types.js#L23-L57)

It also writes small stub files (`action.d.ts`, `store.d.ts`, `compiler.d.ts`, `types/compiler/preprocess.d.ts`, ...) that import `types/index.js`, for TypeScript setups that do not use `moduleResolution: 'bundler'` and for older tooling. After bundling it fails the build when a JSDoc link starts with `/` instead of `https://svelte.dev`, or when the output contains `export { ... }` statements, which the comment explains TypeScript handles badly in downstream declaration generation. `tsc -p tsconfig.generated.json` then type-checks the bundled file.

Sources: [packages/svelte/scripts/generate-types.js:9-21](repo://packages/svelte/scripts/generate-types.js#L9-L21), [packages/svelte/scripts/generate-types.js:59-85](repo://packages/svelte/scripts/generate-types.js#L59-L85), [packages/svelte/tsconfig.generated.json:1-4](repo://packages/svelte/tsconfig.generated.json#L1-L4)

`types/index.d.ts` is committed. CI and the release workflow run `pnpm build` and fail if `git status` shows changes, with a message asking contributors to run `pnpm generate:types` and commit the result.

Sources: [.github/workflows/ci.yml:91-100](repo://.github/workflows/ci.yml#L91-L100), [CONTRIBUTING.md:134-137](repo://CONTRIBUTING.md#L134-L137)

## Tree-shakeability check

Svelte's runtime relies on bundlers dropping unused code: hydration paths, legacy-mode support and tracing are all behind flags that should vanish from apps that do not use them ([[Svelte Overview]]). `check-treeshakeability.js` enforces this in two ways, using Rollup with a resolver that maps `svelte/*` to the package's `browser` (or `default`) entries and `production` export conditions.

Sources: [packages/svelte/scripts/check-treeshakeability.js:1-48](repo://packages/svelte/scripts/check-treeshakeability.js#L1-L48)

First, for every subpath in `exports` (except the compiler and the side-effect-only flag modules), it bundles `import "<entry>"` for each of the `browser` and `default` conditions and requires the output to be empty: merely importing a module must not leave code behind.

Sources: [packages/svelte/scripts/check-treeshakeability.js:55-81](repo://packages/svelte/scripts/check-treeshakeability.js#L55-L81)

Second, it compiles a runes component that uses `mount`, `<svelte:head>`, bindings, spreads, dynamic components and elements, and every block type, bundles it, and searches the output for markers of code that should be absent: `hydrate_node`/`hydrate_next` (hydration, since only `mount` is used), `component_context.l` (legacy mode) and `'CreatedAt'` (`$inspect.trace`). On failure it prints the surrounding lines, writes the full bundle to `scripts/_bundle.js` and exits with an error.

Sources: [packages/svelte/scripts/check-treeshakeability.js:83-163](repo://packages/svelte/scripts/check-treeshakeability.js#L83-L163)

## Releasing

Changes that should appear in the changelog come with a changeset: a markdown file in `.changeset/` naming the package and bump type (`'svelte': patch`) followed by the description. Changesets is configured to publish publicly from `main`, generate GitHub-linked changelog entries with `@svitejs/changesets-changelog-github-compact`, and ignore everything except `svelte` and `@sveltejs/*` packages.

Sources: [.changeset/config.json:1-11](repo://.changeset/config.json#L1-L11), [.changeset/wise-schools-report.md:1-5](repo://.changeset/wise-schools-report.md#L1-L5)

The `Release` workflow runs on every push to `main` in the `sveltejs/svelte` repository. It installs dependencies, runs `pnpm build` with the generated-types check, and then uses `changesets/action`: when unreleased changesets exist it opens or updates a "version packages" pull request (`pnpm changeset:version`, which also regenerates `version.js`); when that pull request is merged it publishes to npm (`pnpm changeset:publish`) with provenance. `prepublishOnly` in the package runs `pnpm build` once more before publishing.

Sources: [.github/workflows/release.yml:1-48](repo://.github/workflows/release.yml#L1-L48), [package.json:21-23](repo://package.json#L21-L23), [packages/svelte/package.json:148-148](repo://packages/svelte/package.json#L148-L148)

## CI checks and linting

The `CI` workflow runs the full test suite (with Chromium installed for browser tests), a separate run of `runtime-runes`, type checks with `tsc` and `tsgo`, `pnpm lint` (ESLint and Prettier), the build with the generated-types check, and the benchmarks. Locally, `pnpm lint` and `pnpm format` run the same linters from the root ([[Testing]]).

Sources: [.github/workflows/ci.yml:41-113](repo://.github/workflows/ci.yml#L41-L113), [package.json:15-20](repo://package.json#L15-L20)

## Benchmarks

`pnpm bench` runs `benchmarking/run.js` with `--allow-natives-syntax`. It imports the client runtime from source, opens a runes component context, and runs the reactivity benchmarks and the server-side rendering benchmarks in turn, printing each benchmark's time and garbage-collection time and the totals per suite; any failure exits with an error. `pnpm bench:debug` runs the same under the inspector.

Sources: [benchmarking/run.js:1-55](repo://benchmarking/run.js#L1-L55), [package.json:24-26](repo://package.json#L24-L26)

`pnpm bench:compare [branch...]` compares branches: with no arguments it compares the current branch with `main`, checking out each branch in turn, running the benchmarks in a forked `runner.js`, storing results in `benchmarking/compare/.results`, and checking the original branch out again on exit.

Sources: [benchmarking/compare/index.js:1-50](repo://benchmarking/compare/index.js#L1-L50)
