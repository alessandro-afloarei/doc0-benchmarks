---
type: architecture
title: API Documentation and Typings
description: How Electron's Markdown API docs in docs/api are the source of truth for the public surface, how they are parsed into electron-api.json and turned into electron.d.ts, how the typings and ts-smoke tests check the result, and how a new API is documented.
tags: [electron, api-docs, typescript, typings, docs-parser, api-history, lint]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-ea70eb6c045047448e446296
    resource: repo://.gitignore
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-3635ba5b4e23ba6ddc84f932
    resource: repo://docs/api-history.schema.json
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-6e7e12784707db2047a4c4d5
    resource: repo://filenames.auto.gni
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-a451af1020481deef77be531
    resource: repo://script/release/release.ts
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
  - id: openwiki-source-6df3aa8f774cb78796e1f986
    resource: repo://spec/types-spec.ts
  - id: openwiki-source-0a3d5c576a42616c3417b0ca
    resource: repo://typings/internal-ambient.d.ts
  - id: openwiki-source-89a74bc5c5aa38586d746b73
    resource: repo://typings/internal-electron.d.ts
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# API Documentation and Typings

Electron's public JavaScript API is documented in Markdown under `docs/api/`. Those files are not just prose: a build-time pipeline parses them into a machine-readable description of the API and generates the TypeScript definitions (`electron.d.ts`) that application developers consume. Internal, undocumented surface is typed separately under `typings/`. This page explains how these pieces connect, what is generated versus hand-written, and which checks keep them in sync.

## Responsibilities

| Artifact | Owner | Role |
| --- | --- | --- |
| `docs/api/*.md` and `docs/api/structures/*.md` | Hand-written | Source of truth for public modules, methods, events, and structures. |
| `docs/api-history.schema.json` | Hand-written | JSON Schema for the API History block that documents when and how an API was added, changed, or deprecated. |
| `electron-api.json` | Generated | Parsed API model produced by `@electron/docs-parser`. Git-ignored. |
| `electron.d.ts` | Generated | Public TypeScript definitions produced by `@electron/typescript-definitions`. Git-ignored at the repository root. |
| `typings/internal-electron.d.ts` | Hand-written | Augments the `Electron` namespace with internal, undocumented members used by Electron's own `lib/` code. |
| `typings/internal-ambient.d.ts` | Hand-written | Ambient declarations for internal globals such as `process._linkedBinding` overloads, `BUILDFLAG`, and `NodeJS.ModuleInternal`. |
| `spec/ts-smoke/` | Hand-written | Compile-time smoke tests that type-check sample main, renderer, and utility code against the generated `electron.d.ts`. |
| `spec/types-spec.ts` | Hand-written | Runtime spec asserting the bundled `@types/node` major version matches the Node.js version Electron ships. |

Two lists in `filenames.auto.gni` name the API inputs. The `api_docs` list (starting at `filenames.auto.gni:3`) enumerates every `docs/api` file that feeds the generator, and GN uses it as the input set for the typings target.

## Generation pipeline

The pipeline has three stages, each runnable on its own through npm scripts in `package.json`:

1. **Parse docs to a model.** `script/create-api-json.mjs` calls `parseDocs` from `@electron/docs-parser` with `packageMode: 'single'`, `useReadme: false`, and a module version taken from `getElectronVersion()`. It writes the result to `electron-api.json` at the repository root. The script exits non-zero on any parse error.
2. **Generate definitions.** The `create-typescript-definitions` script runs `create-api-json`, then `electron-typescript-definitions --api=electron-api.json` to write `electron.d.ts`, then `node spec/ts-smoke/runner.js` to type-check the smoke tests.
3. **Build-system hook.** In `BUILD.gn`, the `build_electron_definitions` target (around line 152) is an `npm_action` that runs the `gn-typescript-definitions` script. That script writes the definitions into `$target_gen_dir/tsc/typings/electron.d.ts`, which the TypeScript build of `lib/` consumes. The same script also copies a copy to the repository root for IDE use. The `electron_browser_bundle` and `electron_renderer_bundle` webpack targets depend on this target, so the `lib/` bundles are compiled against the generated types.

Test and CI entry points reuse the same stage. `script/spec-runner.js` (around line 111) runs `npm run create-typescript-definitions` before the spec suite, and the `pretest` npm hook does the same. The docs-only pipeline and the build action also call `create-typescript-definitions` (`.github/workflows/pipeline-electron-docs-only.yml` and `.github/actions/build-electron/action.yml`).

The archaeology and historical-types path (`.github/actions/generate-types/action.yml`) runs the same two CLIs (`electron-docs-parser`, then `electron-typescript-definitions`) against an old commit SHA, then renames the resulting `electron.d.ts`. It checks out the SHA, installs dependencies with `--ignore-scripts`, and restores the tree afterwards with `git checkout .`. This is a separate, one-shot use of the same generator.

Release packaging also ships the parsed model. `script/release/release.ts` (around line 172) includes `electron-api.json` among the release artifacts, and `script/release/uploaders/upload.py` (around line 84) uploads it.

## Linting the docs that feed the generator

`package.json` defines the documentation lint chain under `lint:docs`. The steps that matter for API accuracy are:

- `create-typescript-definitions` regenerates the typings, so a malformed docs block fails here.
- `lint:ts-check-js-in-markdown` runs `lint-roller-markdown-ts-check` over `docs/**/*.md` (excluding `breaking-changes.md`), which type-checks code blocks that opt into TypeScript checking.
- `lint:api-history` runs `lint-roller-markdown-api-history` with `--schema ./docs/api-history.schema.json`, `--breaking-changes-file ./docs/breaking-changes.md`, `--check-placement`, and `--check-strings`. It validates each API History block against the schema and checks that every change links to a breaking-changes heading.

`docs/development/style-guide.md` describes the intent of the API History block: it records when an API was added, changed, or deprecated, and each change links to the pull request that made it. The schema forbids unknown properties in change entries, so a misspelled key fails validation rather than being silently ignored.

Locally, `lint:docs-fiddles` runs `standard` against `docs/fiddles/**/*.js`. The fiddle snippets are runnable examples and are linted separately from the prose.

## Internal typings versus public typings

`typings/internal-electron.d.ts` begins by referencing `../electron.d.ts` and then declares a `declare namespace Electron` block. It adds members that are used by Electron's own `lib/` code but are not documented for users, such as `App._clientCertRequestPasswordHandler`, the `-touch-bar-interaction` event on `BaseWindow`, and the `ProcessType` enum. Because these declarations augment the public namespace, lib code can call them without a cast. Internal types are kept out of the public docs and out of the parser's input, so they do not appear in `electron.d.ts`.

`typings/internal-ambient.d.ts` supplies globals that are not part of the `Electron` namespace. It declares the `BUILDFLAG` function used by lib code, extends the `Process` interface with the `_linkedBinding` overloads for each internal Electron binding, and describes Node's internal module system through `NodeJS.ModuleInternal`. Adding a new browser binding therefore touches this file: `docs/development/creating-api.md` instructs contributors to add a `_linkedBinding(name: 'electron_browser_<name>')` overload here.

## Type-level smoke tests

`spec/ts-smoke/runner.js` spawns `tsc --project ./ts-smoke/tsconfig.json` from the `spec/` directory. The tsconfig compiles three sample files (`electron/main.ts`, `electron/renderer.ts`, `electron/utility.ts`) together with `../../electron.d.ts` and runs with `noImplicitAny`, `noImplicitThis`, and `strictNullChecks` disabled. A non-zero `tsc` exit fails the runner. The check therefore catches regressions where a documented API is removed or changed incompatibly, because the smoke samples stop type-checking.

`spec/types-spec.ts` is a separate runtime test. It reads `npm/package.json` and asserts that the `@types/node` range starts with `^` and that its major version matches `process.versions.node`. This keeps the bundled Node typings aligned with the Node.js version embedded in the binary.

## Adding or changing an API

The steps below combine `docs/development/creating-api.md` with the pipeline above:

1. Document the API in the right file under `docs/api/` (or `docs/api/structures/`) using the existing style. The generator derives signatures from the Markdown headings and lists, so a method documented in prose only does not appear in `electron.d.ts`.
2. Add an API History block when the change is user-visible, following the schema. Run `npm run lint:api-history` locally.
3. For a new browser-side native module, register the native source files in `filenames.gni` and declare the binding in `typings/internal-ambient.d.ts`. The binding name also goes into `ELECTRON_BROWSER_MODULES` in `shell/common/node_bindings.cc`.
4. Regenerate and check: `npm run create-typescript-definitions` regenerates `electron-api.json` and `electron.d.ts` and runs the smoke tests.

## Failure behavior and invariants

- The generated files are build products. Editing `electron.d.ts` or `electron-api.json` by hand has no lasting effect, because the next `create-typescript-definitions` run overwrites them.
- Docs parse errors stop `create-api-json.mjs` with exit code 1, which stops `create-typescript-definitions` and therefore the spec runner's pretest step.
- A documented API that the smoke samples or lib code no longer type-check against fails `ts-smoke`, not the docs parser. Failures in this stage usually mean a signature drifted between the docs and the lib implementation.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md) explains how the lib implementations these typings describe are bundled and exported.
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md) covers the wider lint chain that these docs checks belong to.
