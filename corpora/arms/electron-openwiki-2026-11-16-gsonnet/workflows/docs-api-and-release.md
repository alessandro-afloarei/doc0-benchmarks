---
type: workflow
title: API Docs, Typings, Linting and Release Tooling
description: How docs/api markdown drives the generated electron.d.ts and API history checks, how script/lint.js and lint-staged enforce style across languages, the breaking-changes policy, the default_app shipped inside the binary, the npm package that downloads Electron, and the staged release scripts.
tags: [docs, typings, lint, release, npm, workflow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-7ca9d05ab2240d0c837898d6
    resource: repo://default_app/main.ts
  - id: openwiki-source-4e498dbea5e2534a900616dc
    resource: repo://docs/breaking-changes.md
  - id: openwiki-source-e5c62cbef7351d2b5a9177d6
    resource: repo://docs/development/api-history-migration-guide.md
  - id: openwiki-source-0664adc5042eb460fb4a27ca
    resource: repo://npm/cli.js
  - id: openwiki-source-e7b1983e42c3f99277ea13f3
    resource: repo://npm/install.js
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-6c52842c07ac95748b2a27ae
    resource: repo://script/lint.js
  - id: openwiki-source-f9485028fff0ad1258242c71
    resource: repo://script/release/bin/README.md
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# API Docs, Typings, Linting and Release Tooling

Electron treats its API **documentation as the source of truth**: the public TypeScript definitions are generated from `docs/api/*.md`, linted for correctness, and shipped with every release. This page covers that chain plus the lint pipeline, the default app, the `electron` npm package, and the release scripts.

## docs/api as the API source of truth

- `docs/api/` holds one markdown file per module or class (`app.md`, `browser-window.md`, `tray.md`, ...) and `docs/api/structures/` holds option/result object types. A class page uses a strict heading structure: `## Class: Name`, a `>` summary, `Process:` tag, then `### Static Methods`, `### Instance Methods` and `### Instance Properties`, and `#### Event: 'x'` headings. Platform notes such as _macOS_ or _Deprecated_ are encoded in headings.
- `script/create-api-json.mjs` runs `@electron/docs-parser` (`parseDocs` in `single` package mode) over the repository and writes `electron-api.json`, tagging it with the version from `script/lib/get-version`.
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `npm run create-typescript-definitions` then runs `electron-typescript-definitions` to produce `electron.d.ts` and executes `spec/ts-smoke/runner.js` to type-check the output; `gn-typescript-definitions` additionally copies it into the build tree. `pretest` runs this step, so `npm test` always regenerates types, and the build's `build_electron_definitions` target does too ([build system](/openwiki/build/build-system.md)).
<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Because the native/JS API is only declared in docs, adding or changing a public API requires a docs edit; `script/gen-filenames.ts` lists the docs as inputs and is re-run by lint-staged whenever `docs/api/**/*.md` changes. See [native bindings](/openwiki/architecture/native-api-bindings.md) for the implementation side.

## API history and breaking changes

- Each API heading may carry an HTML-comment YAML block (` ```YAML history `) recording `added`, `changed` and `deprecated` entries with a `pr-url` and, for breaking items, a `breaking-changes-header` that must match a heading in `docs/breaking-changes.md`. The format is validated against `docs/api-history.schema.json`; `docs/development/api-history-migration-guide.md` explains how to back-fill history using `breaking-changes.md`, `git blame` and release notes, and `docs/development/style-guide.md` documents the block format.
- `npm run lint:api-history` (from `@electron/lint-roller`) enforces schema validity, block placement and strings.
- `docs/breaking-changes.md` is the canonical list, organized by planned breaking API changes per major version (currently up to 39.0), plus deprecations and removals; any behavior change visible to apps must be recorded there and flagged in the PR.

## Linting

`script/lint.js` is the single entry for linters; `npm run lint` runs it plus doc linting. A `LINTERS` table (key, root directories, filename test, `run` function) covers:

- `cpp` and `objc`: `cpplint` with Chromium-aligned filters and `clang-format` (`script/run-clang-format.py`), plus `clang-tidy` via `script/run-clang-tidy.ts` (`lint:clang-tidy`) with `docs/development/clang-tidy.md`;
- `python` (pylint-style) and `javascript` (ESLint with the standard config and TypeScript parser);
- `gn` (`gn format` check via `script/run-gn-format.py`) and `gn-check` (`script/gn-check.js`);
<!-- openwiki: broken internal link [/openwiki/build/upstream-patches.md] link "/openwiki/build/upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `patches`: verifies `patches/config.json` exists, every `patch_dir` exists and has `.patches`, and that listed files match ([upstream patches](/openwiki/build/upstream-patches.md));
- `md`: markdownlint of docs.

`lint:docs` additionally runs remark, lints JavaScript examples embedded in markdown (`standard`, `ts-check`), docs fiddles, relative links and API history. Lint-staged (`package.json`) wires these to a husky pre-commit hook per file type: JS/TS lint with `--fix`; `ts-node script/gen-filenames.ts` for JS/TS and docs changes; clang-format for C/C++/ObjC; `gn-check` and `gn-format` for GN; docs lint for markdown; patch checks (`check-patch-diff.ts`) for patch files; and a check for `DEPS` changes. The coding style (`docs/development/coding-style.md`) follows Chromium for C++ and Python and a standard-style convention for JS (require ordering, `path.join`, plain `return`).

## default_app

<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`default_app/` (TypeScript: `main.ts`, `default_app.ts`, `preload.ts`, plus `index.html`) is the app Electron runs when started without an application: it is built into `resources/default_app.asar` by the GN `asar` template. `main.ts` parses the command line (`--version`, `--abi`, `--interactive`/REPL, `--require`, `--app=<path>`, a path to a script or folder) and, if a path is given, loads it as the real app: marks `process.defaultApp`, reads its `package.json` (name, version, `desktopName`, `v8Flags`), calls `app.setAppPath`, and runs the entry. Otherwise it shows the default welcome page in a `BrowserWindow`; with `--interactive` it starts a Node REPL with the `electron` API modules pre-bound (this is what `npm run repl` and `script/start.js` use). It is also the fallback in the app search order `app.asar -> app -> default_app.asar` unless the `only_load_app_from_asar` fuse is set ([fuses](/openwiki/security/fuses-and-security-model.md)).

## The `electron` npm package (`npm/`)

`npm/` is the template of the published `electron` package. Its `postinstall` runs `install.js`, which (unless `ELECTRON_SKIP_BINARY_DOWNLOAD` is set) checks whether `dist/version` and `path.txt` already match, and otherwise downloads the platform zip with `@electron/get` (honoring `npm_config_platform`, `npm_config_arch`, a Rosetta check on macOS, cache controls, and bundled `checksums.json` unless remote checksums are requested), extracts it into `dist/`, moves `electron.d.ts` out of the zip, and writes `path.txt`. `index.js` exports the path to the executable; `cli.js` is the `electron` bin that spawns it with `stdio: inherit` and forwards `SIGINT`/`SIGTERM` and the exit code. `ELECTRON_OVERRIDE_DIST_PATH` points at an existing build.

## Release tooling (`script/release/`)

Releases are driven by a bot (Sudowoodo), not manually; `script/release/bin/README.md` describes each stage (it warns that these scripts are old and only loosely documented):

- `print-next-version` / `version-bumper.ts` compute the next version for `patch`, `nightly`, `alpha`, `beta` or stable bumps using `semver` and helpers in `version-utils.ts`.
- `prepare-for-release` (via `prepare-release.ts`) bumps the version, generates release notes (`script/release/notes/`), creates the git tag and kicks off release builds on GitHub Actions (`run-release-ci-jobs.ts`); `run-release-builds` re-triggers failed builds.
- `validate-before-publish` / `release.ts` check that a single draft release exists with real notes (no `(placeholder)`), that all required assets exist for the version (`assetsForVersion`), that checksums match, and that Node headers and symbols were uploaded.
- `publish-to-github` uploads header checksums and updates `index.json` on the assets CDN, then publishes the draft; `publish-to-npm` publishes the npm package; `cleanup-release` deletes a failed draft and its tag (the only place a tag is deleted).
- `uploaders/` contains the Python and TS uploaders for symbols, Node headers and checksums, and GitHub assets.
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Version information for builds comes from `script/lib/get-version.js` and the GN `electron_version_args` action ([build system](/openwiki/build/build-system.md)).

## Tests

<!-- openwiki: broken internal link [/openwiki/testing/spec-suite.md] link "/openwiki/testing/spec-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Docs and release code are validated mostly by lint and CI; behavior covered in [spec suite](/openwiki/testing/spec-suite.md). Changes to docs should be accompanied by `npm run lint:docs` locally.
