---
type: architecture
title: JavaScript APIs, native bindings, and desktop integration
description: How Electron exposes process-specific JavaScript APIs over native bindings, using menus to trace platform behavior and the documentation-to-types pipeline.
tags: [architecture, api, bindings, desktop]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-96165dedc59657c2fc0b9d21
    resource: repo://lib/browser/api/menu.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-04fd26813cc07bc2d73af308
    resource: repo://shell/browser/api/electron_api_menu_mac.mm
  - id: openwiki-source-27a64998785b21e6ba720d8c
    resource: repo://shell/browser/api/electron_api_menu_views.cc
  - id: openwiki-source-2653b38464b14bba2ed23bea
    resource: repo://shell/browser/api/electron_api_menu.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# JavaScript APIs, native bindings, and desktop integration

Electron's public API is assembled across JavaScript and native code. Start with the JavaScript wrapper to find argument normalization and event behavior, then follow its linked binding to the C++ implementation and platform backend. A native method list alone does not describe the complete public contract.

## Export and binding layers

The browser export entry merges common and browser module lists. `defineProperties` installs enumerable getters that load modules on access and unwrap default exports. This makes the module lists an API exposure boundary; adding a C++ implementation does not itself expose a new JavaScript module. See [browser exports](../../lib/browser/api/exports/electron.ts), [module list](../../lib/browser/api/module-list.ts), and [getter construction](../../lib/common/define-properties.ts).

Common initialization installs Electron module-cache entries and redirects resolution of `electron`, `electron/main`, `electron/renderer`, `electron/common`, and `electron/utility` to the Electron module. Those import names support type selection; they do not grant another process's capabilities. The process-specific export bundle remains the relevant implementation boundary. See [common initialization](../../lib/common/init.ts).

Wrappers obtain embedded native modules with `process._linkedBinding`. For example, `menu.ts` loads `electron_browser_menu`, augments the native constructor's prototype, and keeps JavaScript item and command maps. C++ registers that binding with `NODE_LINKED_BINDING_CONTEXT_AWARE` and exposes native methods through Gin object templates. Follow both halves when changing behavior.

## A menu request through the layers

`Menu.buildFromTemplate` validates the array and item shapes, sorts entries, removes redundant separators, and appends existing or newly constructed MenuItems. Invalid templates fail in JavaScript before native presentation. `popup` normalizes coordinates and callbacks, selects a valid BaseWindow, and throws if none exists before calling native `popupAt`.

The native Menu owns an ElectronMenuModel. Model queries call back into JavaScript for checked, enabled, and visible state; command execution reaches the item's JavaScript click handler with the focused window and WebContents. The flow therefore crosses the binding in both directions, rather than merely converting a static template once.

Platform constructors select MenuMac on macOS and MenuViews for the Views implementation, then call the JavaScript `_init` hook. `setApplicationMenu` invokes the native application menu binding on macOS and sets the menu on existing BaseWindows elsewhere. This is why a desktop behavior change needs inspection of both shared policy and the selected platform implementation.

Native menu visibility also affects lifetime: `OnMenuWillShow` pins the wrapper and emits an event; `OnMenuWillClose` unpins it and emits the closing event. Preserve that lifetime relationship when changing asynchronous presentation or callbacks.

## Extending the API

Trace a proposed change through these review points:

1. Locate the process module list, wrapper, native object template, and any platform implementation.
2. Preserve argument checks, event conversion, and object lifetime across the binding.
3. Update the relevant public reference under `docs/api/`; check internal consumers and typings separately.
4. Regenerate public API types and run focused behavior tests.

The API reference participates in the build: `script/create-api-json.mjs` parses repository docs into `electron-api.json`. The root `create-typescript-definitions` script generates declarations from that JSON and runs TypeScript smoke tests. Editing only a generated declaration bypasses its source of truth.

## Verification and neighboring systems

[Menu specs](../../spec/api-menu-spec.ts) cover template preservation and invalid template rejection, alongside sorting and menu behavior. Use the [validation workflow](../testing/validation.md) for focused execution and declaration checks. See [process startup](process-lifecycle.md) for initialization ordering and [window ownership](../concepts/windows-and-web-contents.md) for the BaseWindow/WebContents objects passed through desktop APIs.
