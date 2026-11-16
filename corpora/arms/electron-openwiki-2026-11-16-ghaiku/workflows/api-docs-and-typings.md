---
type: workflow
title: API Documentation, Typings, and API History
description: How the Markdown under docs/api is the source of truth for Electron's public API. Explains how it is parsed into electron-api.json, turned into electron.d.ts with @electron/typescript-definitions, type-checked by the ts-smoke suite, linted for code samples and API-history blocks, and what to change when adding or altering an API.
tags: [api-docs, typescript-definitions, electron-d-ts, api-history, docs-parser, lint-roller, ts-smoke]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-3635ba5b4e23ba6ddc84f932
    resource: repo://docs/api-history.schema.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
  - id: openwiki-source-75744acc431a23f51a13b556
    resource: repo://spec/ts-smoke/tsconfig.json
  - id: openwiki-source-6df3aa8f774cb78796e1f986
    resource: repo://spec/types-spec.ts
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# API Documentation, Typings, and API History

Electron's public API is documented in Markdown, not in TypeScript. The files under `docs/api/` (one per module, plus `docs/api/structures/` for object shapes) are parsed by tooling that produces the TypeScript definitions shipped with Electron. Consistency checks run on the same Markdown: code samples, relative links, and API-history blocks. A change to a public API is therefore a documentation change first, and a typing change as a result.

## Pipeline

The `package.json` scripts define the pipeline:

1. **`create-api-json`** runs `script/create-api-json.mjs`. It calls `parseDocs` from `@electron/docs-parser` on the repository, in `single` package mode, with `useReadme: false`, and the Electron version from `script/lib/get-version.js`. The output is `electron-api.json` at the repository root.
2. **`create-typescript-definitions`** runs step 1 and then `electron-typescript-definitions --api=electron-api.json`, which writes `electron.d.ts`. It then runs `spec/ts-smoke/runner.js`.
3. **`gn-typescript-definitions`** runs step 2 and then copies `electron.d.ts` with `script/cp.mjs`.

`npm test` runs `pretest`, which runs step 2 first. The generated definitions are therefore always up to date before the spec suite runs (see [Test Suite (spec/) and Test Runners](testing-spec-suite.md)).

## Type-checking the generated definitions

`spec/ts-smoke/runner.js` runs `tsc` on `spec/ts-smoke/tsconfig.json`. That project includes three smoke files, `electron/main.ts`, `electron/renderer.ts`, and `electron/utility.ts`, together with the generated `electron.d.ts`. The config uses `noImplicitAny` and `noImplicitThis`, with `strictNullChecks` disabled. A type error in the generated declarations, or in the way the smoke files use them, fails the run.

Separately, `typings/internal-electron.d.ts` and `typings/internal-ambient.d.ts` augment the `Electron` namespace with internal-only types, such as the `ProcessType` enum, that are not in the public docs. The root `tsconfig.json` maps `@electron/internal/*` to `lib/*` and `@node/*` to `../third_party/electron_node/*`, so `lib/` code can type-check against both.

`spec/types-spec.ts` is a separate check. It asserts that the bundled `@types/node` major version in `npm/package.json` matches the Node.js version that Electron bundles.

## Documentation structure

- `docs/api/<module>.md` documents a module, with its methods, properties, and events.
- `docs/api/structures/<name>.md` documents an object shape that the API accepts or returns, such as `web-preferences.md`. Each property is a bullet with its type, an optional marker, and a default.
- `docs/api-history.schema.json` defines the API-history blocks that document when a feature was added, changed, or deprecated. A block must contain `pr-url` (pointing at a main-repository pull request), and it may contain `breaking-changes-header` (an anchor in `docs/breaking-changes.md`) and `description` (up to 120 characters). Its header comment says that the matching TypeScript interfaces live in the linting script, so schema changes must be made in both places.
- `docs/development/creating-api.md` is the checklist for a new native API. It covers adding sources to `filenames.gni`, writing the Markdown page, and wiring `ObjectTemplateBuilder` and `Wrappable` (see [Native Bindings](../architecture/native-bindings.md)).
- `docs/development/api-history-migration-guide.md` explains where to find API history for existing features, and it gives the format of the history block.

## Lint checks on the docs

The `lint:docs` script in `package.json` runs, in order:

1. `remark docs` (Markdown formatting).
2. `lint:js-in-markdown` (`lint-roller-markdown-standard`), which checks JavaScript code samples in the docs against the Standard style.
3. `create-typescript-definitions`, so later checks see fresh definitions.
4. `lint:ts-check-js-in-markdown` (`lint-roller-markdown-ts-check`), which type-checks code samples in Markdown, excluding `breaking-changes.md`.
5. `lint:docs-fiddles` (`standard` on `docs/fiddles/**/*.js`), which checks the example apps.
6. `lint:docs-relative-links` (`lint-roller-markdown-links`), which checks relative links under `docs/`.
7. `lint:markdown` (`script/lint.js --md`).
8. `lint:api-history` (`lint-roller-markdown-api-history`), which checks the history blocks against the schema and with `--check-placement` and `--check-strings`.

Consequence: a sample that does not type-check, or a history block that does not match the schema, fails the docs lint, even if the code itself is correct.

## Adding or changing an API

1. Edit the module page in `docs/api/` (or the structure page under `docs/api/structures/`). Document the signature, options, events, and platform notes in the same style as the surrounding pages.
2. Add or update the history block for the change. A new feature needs an `added` entry; a breaking change needs a `breaking-changes-header` that points at an entry in `docs/breaking-changes.md`.
3. Implement the native and `lib/` sides (see [JavaScript API Layer](../architecture/js-api-layer.md)).
4. Run `npm run create-typescript-definitions` to regenerate and type-check, then `npm run lint:docs` for the Markdown checks.

## Failure behavior

- If `electron-typescript-definitions` fails, `pretest` fails, so spec runs stop before any test executes.
- Schema violations in history blocks are reported by `lint:api-history`, not by `create-api-json`.

## Related pages

- [JavaScript API Layer](../architecture/js-api-layer.md)
- [Linting and Formatting](linting.md)
- [Test Suite (spec/) and Test Runners](testing-spec-suite.md)
- [Native Bindings](../architecture/native-bindings.md)
