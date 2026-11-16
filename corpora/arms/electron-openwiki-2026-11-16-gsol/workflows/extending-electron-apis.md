---
type: workflow
title: Extending Electron APIs
description: A source-grounded path from a native Electron binding through process-specific exports, build registration, generated declarations, and behavioral tests.
tags: [api, bindings, typescript, development, native]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-239321880d72bdb70fefc892
    resource: repo://lib/browser/api/module-list.ts
  - id: openwiki-source-22f71033603f07143365eb70
    resource: repo://lib/browser/api/native-theme.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
  - id: openwiki-source-fe72b4a07f9600f4bce49a1e
    resource: repo://shell/browser/api/electron_api_native_theme.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Extending Electron APIs

An Electron API commonly spans a native implementation, a linked-binding registration, a TypeScript wrapper, process-specific export lists, public Markdown documentation, and tests. Updating only the native method or a declaration can leave the public surface incomplete.

## Choose the owner and process boundary

Start with the runtime owner: window behavior belongs near BrowserWindow/WebContents, session policy near the browser context, and renderer-only world operations near the renderer. Check whether an existing API can express the behavior before introducing another module.

The native binding lists and JavaScript module lists are process-specific. A browser API is not automatically a sandbox-preload or utility API. For operations requested by web content, design a narrow IPC contract and follow [preload isolation and IPC](../concepts/preload-isolation-and-ipc.md).

## Trace an existing module end to end

`nativeTheme` is a compact example:

1. `shell/browser/api/electron_api_native_theme.cc` wraps Chromium native themes, observes UI-theme changes, and emits `updated` on the UI task runner. Its destructor removes the observer.
2. Its object-template builder exposes properties including `themeSource` and `shouldUseDarkColors`. Initialization creates the instance and exports it.
3. `NODE_LINKED_BINDING_CONTEXT_AWARE` declares the linked module, while `shell/common/node_bindings.cc` explicitly registers it in the browser binding list.
4. `lib/browser/api/native-theme.ts` obtains the native object through `process._linkedBinding`.
5. The browser module list exposes it as `nativeTheme`; browser exports combine common and browser entries through `defineProperties`.

This route separates object lifetime, native conversion, public naming, and JavaScript ergonomics. The wrapper can stay small while native implementation owns platform integration.

## Implement and register

Use neighboring implementations to select the current wrapper base, event behavior, converters, threading, and cleanup pattern. Implement invalid-input behavior and failure propagation alongside successful calls. Native callbacks and observers must stop referring to JavaScript-backed objects after destruction.

Add the new linked binding to the appropriate `ELECTRON_*_BINDINGS` list in node_bindings.cc. `RegisterBuiltinBindings` chooses browser, renderer, and utility lists by process and registers common bindings separately. Add an overload in `typings/internal-ambient.d.ts` for the binding's internal TypeScript shape.

Add or update a TypeScript module and the corresponding process module list. Public export properties are enumerable getters that call the loader and unwrap a default ES-module export when present. Existing Node/webpack caching participates in module lifetime; the property helper itself does not replace the getter with a cached value.

The [new module guide](../../docs/development/creating-api.md) gives useful background, but compare its examples to current source: this checkout's macro is `ELECTRON_BROWSER_BINDINGS`, and the nativeTheme wrapper filename is `lib/browser/api/native-theme.ts`.

## Build and declaration contracts

Add native files to the appropriate platform/common arrays in `filenames.gni`. Regenerate `filenames.auto.gni` with `npx ts-node script/gen-filenames.ts` when API docs or JavaScript dependency graphs change. That generator measures webpack targets and writes generated documentation and dependency lists; do not manually maintain those generated lists.

Public definitions come from API documentation. Describe the API under `docs/api/`, adding structures and API history where required by neighboring documentation. `script/create-api-json.mjs` parses docs into `electron-api.json`; `npm run create-typescript-definitions` converts that model into declarations and runs TypeScript smoke checks. Editing a generated `electron.d.ts` alone will not preserve the change through regeneration.

## Validate the behavior

For nativeTheme-like changes, begin with `spec/api-native-theme-spec.ts` and `docs/api/native-theme.md`. A useful API test checks observable state or events and covers failure/lifecycle behavior, not just method availability.

After rebuilding the affected runtime:

```sh
npm run create-typescript-definitions
npm run test -- --files spec/api-native-theme-spec.ts
```

Use the relevant lint commands, GN checks for build-file changes, and additional platform tests when OS-specific implementation changes. The [testing guide](../testing/runtime-and-api-tests.md) explains test setup and file selection; [runtime architecture](../architecture/runtime-and-bootstrap.md) explains how bundles and native startup make the API available.
