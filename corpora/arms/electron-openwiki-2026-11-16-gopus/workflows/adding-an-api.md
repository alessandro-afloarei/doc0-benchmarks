---
type: workflow
title: "Workflow: adding or changing an API"
description: Checklist for adding or changing a public Electron API across all layers — C++ gin binding and linked-module registration, filenames.gni, internal typings, the lib/ wrapper and module list, docs/api Markdown that generates electron.d.ts, API history blocks, deprecation helpers and breaking-changes notes, and specs.
tags: [workflow, api, docs, typescript, deprecation, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-3635ba5b4e23ba6ddc84f932
    resource: repo://docs/api-history.schema.json
  - id: openwiki-source-4e498dbea5e2534a900616dc
    resource: repo://docs/breaking-changes.md
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-239321880d72bdb70fefc892
    resource: repo://lib/browser/api/module-list.ts
  - id: openwiki-source-679a9885164a8fc067771310
    resource: repo://lib/common/deprecate.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Workflow: adding or changing an API

A public Electron API is the sum of several artifacts that must stay in sync.
The canonical guide is `docs/development/creating-api.md`; this page maps it
onto the architecture described in
[JS bundles, module lists and native bindings](../architecture/js-bundles-and-native-bindings.md).

## 1. Native implementation (if needed)

Not every API needs C++ — some are pure TypeScript over existing bindings.
When native code is required:

1. Create `shell/browser/api/electron_api_<name>.{h,cc}` (or under
   `shell/common/api/` for APIs usable from several processes,
   `shell/renderer/api/` for renderer-only). Platform variants use
   `_mac.mm`, `_win.cc`, `_linux.cc` suffixes.
2. Model the object with gin:
   - a singleton/module: a plain `Initialize(exports, …)` that sets methods
     on a `gin_helper::Dictionary`;
   - an object with methods/events: subclass `gin::Wrappable<T>` (newer code)
     with `GetObjectTemplateBuilder`, or `gin_helper::EventEmitter<T>` /
     `TrackableObject<T>` when it emits events or must be found by id
     (see `shell/common/gin_helper/`);
   - add argument/return marshalling to `shell/common/gin_converters/` rather
     than hand-converting inside the API.
3. Register the binding at the bottom of the `.cc` with
   `NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_<name>, Initialize)`.
4. Add the name to the right list in `shell/common/node_bindings.cc`
   (`ELECTRON_BROWSER_BINDINGS`, `ELECTRON_COMMON_BINDINGS`,
   `ELECTRON_RENDERER_BINDINGS` or `ELECTRON_UTILITY_BINDINGS`) — this also
   decides **which processes can load it**.
5. Add the source files to `filenames.gni` (`lib_sources` or the platform /
   feature-specific list). GN won't compile unlisted files.
6. Guard optional features with build flags (`#if BUILDFLAG(...)`) when the
   API depends on one ([Fuses and build flags](../systems/fuses-and-build-flags.md)).

## 2. TypeScript wrapper

1. Type the binding for internal code: add a
   `_linkedBinding(name: 'electron_browser_<name>'): …` overload in
   `typings/internal-ambient.d.ts`; private members used by `lib/` go in
   `typings/internal-electron.d.ts`.
2. Create `lib/browser/api/<name>.ts` (or `lib/common/api/`,
   `lib/renderer/api/`, `lib/utility/api/`) that fetches the binding with
   `process._linkedBinding`, sets up `EventEmitter` prototypes if needed,
   adds JS-only conveniences/validation, and exports the module.
3. Add `{ name: '<publicName>', loader: () => require('./<name>') }` to the
   matching module list (`lib/browser/api/module-list.ts`, etc.), kept
   alphabetical. Sandboxed renderers, preload realms and utility processes
   have their own lists — add entries there if the API should exist in those
   environments.
4. Run the pre-commit step (or `ts-node script/gen-filenames.ts`) so
   `filenames.auto.gni` picks up the new file in the bundle dependency lists.

## 3. Documentation and typings

Public typings are **generated from the docs**:

1. Add or edit `docs/api/<name>.md` following the existing structure
   (title, `> description`, `Process: [Main](../glossary.md#main-process)`,
   `## Methods`, `### \`module.method(arg)\``, argument bullet lists with
   types, `Returns \`type\``, `## Events`, `## Properties`). The docs parser
   is strict about this format. New structures go in `docs/api/structures/`.
2. `npm run create-api-json` (`script/create-api-json.mjs`) parses the docs
   with `@electron/docs-parser` into `electron-api.json`;
   `npm run create-typescript-definitions` turns that into `electron.d.ts`
   with `@electron/typescript-definitions` and runs the TS smoke test
   (`spec/ts-smoke/`). The GN target `build_electron_definitions` runs the
   same during builds, and `filenames.auto.gni` lists the docs as inputs.
3. Add an **API history** block for new or changed APIs — a YAML block in an
   HTML comment directly under the heading:

   ```markdown
   <!--
   ```YAML history
   added:
     - pr-url: https://github.com/electron/electron/pull/12345
   ```
   -->
   ```

   The schema (`docs/api-history.schema.json`) allows `added`, `deprecated`
   and `changes` entries with `pr-url` (main PR, not backports), optional
   `breaking-changes-header` and a `description` (required for `changes`).
   `npm run lint:api-history` validates placement and that referenced
   breaking-change headers exist. See
   `docs/development/api-history-migration-guide.md`.
4. `npm run lint:docs` runs all docs linters (Markdown style, JS/TS snippets
   in docs, relative links, typings generation, API history).

## 4. Deprecations and breaking changes

- Use helpers in `lib/common/deprecate.ts` — `warnOnce`, `renameFunction`,
  `removeFunction`, `renameProperty`, `removeProperty`, `event` (renamed
  events), `moveAPI` — so warnings are consistent and respect
  `process.noDeprecation` / custom handlers.
- Document the change in `docs/breaking-changes.md` under the planned major
  version, using one of the categories **API Changed**, **Behavior Changed**,
  **Default Changed**, **Deprecated** or **Removed**, and link it from the
  API's history block via `breaking-changes-header`.
- Release notes are generated from PR descriptions; see
  [Releases and npm distribution](../operations/release-and-npm-distribution.md).

## 5. Tests

Add or extend `spec/api-<name>-spec.ts`. Gate platform-specific tests with
`ifdescribe`/`ifit`, clean up windows with `closeAllWindows`/`defer`, and use
fixture apps for process-level behavior. See
[Testing: spec runner and test suites](../testing/spec-runner.md).

## Checklist

| Layer | Files |
| --- | --- |
| Native | `shell/*/api/electron_api_<name>.*`, `shell/common/node_bindings.cc`, `filenames.gni`, converters |
| JS | `lib/<process>/api/<name>.ts`, `lib/<process>/api/module-list.ts`, `typings/internal-*.d.ts`, `filenames.auto.gni` (generated) |
| Docs | `docs/api/<name>.md` (+ `structures/`), API history block, `docs/breaking-changes.md` when applicable |
| Tests | `spec/api-<name>-spec.ts`, fixtures |

Also consider security: new renderer-facing surfaces should respect context
isolation and sandboxing
([Renderer processes, sandboxing and context isolation](../architecture/renderer-processes-and-sandboxing.md)),
and internal IPC handlers must validate the sender ([IPC between main and renderer](../systems/ipc.md)).
