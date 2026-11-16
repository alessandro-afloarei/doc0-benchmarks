---
type: architecture
title: JavaScript API Layer (lib/)
description: How the TypeScript sources under lib/ implement the public Electron JavaScript API for each process type, how webpack bundles them into per-process init scripts compiled into the binary, and how they bind to the native objects exposed by shell/.
tags: [javascript-api, lib, webpack, bundles, native-bindings, module-list]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-c28f038bb528a5af99aad5c0
    resource: repo://lib/browser/api/app.ts
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# JavaScript API Layer (lib/)

The public Electron API (`app`, `BrowserWindow`, `ipcRenderer`, `net`, and the rest) is written in TypeScript under `lib/`, not in C++. The C++ code in `shell/` provides the native objects, and the `lib/` modules wrap them with argument handling, event emission, and option parsing. Each process type gets its own bundle, and the bundles are compiled into the Electron binary.

## Directory layout

| Path | Contents |
| --- | --- |
| `lib/browser/` | Main-process init (`init.ts`), IPC dispatch, and `api/` for main-process modules. |
| `lib/renderer/` | Renderer init (`init.ts`, `common-init.ts`, `window-setup.ts`), `api/` for renderer modules, and `web-view/`. |
| `lib/common/` | Code shared across process types: `init.ts`, `define-properties.ts`, `webpack-provider.ts`, `webpack-globals-provider.ts`, and `api/` for common modules (`nativeImage`, `shell`, and the net client request). |
| `lib/node/` | Node.js integration, including the ASAR `fs` wrapper and module hooks. |
| `lib/sandboxed_renderer/`, `lib/isolated_renderer/`, `lib/preload_realm/`, `lib/utility/`, `lib/worker/` | Per-process init and `api/` for sandboxed renderer, isolated renderer, preload realm, utility process, and worker contexts. |

Each process directory has an `init.ts` entry point. For example, `lib/browser/init.ts` runs `require('@electron/internal/common/init')`, sets up the uncaught-exception dialog, emits `exit` on `app`'s `quit` event, and installs the Windows app user model ID. The init entry points are the first JavaScript that runs in each process.

## Module exports

`electron` is not a file on disk. Webpack resolves `electron`, `electron/main`, `electron/renderer`, `electron/common`, and `electron/utility` to a per-target `api/exports/electron.ts` file (see the `resolve.alias` block in `build/webpack/webpack.config.base.js`). That file calls `defineProperties` for the common module list and the browser or renderer module list.

- `lib/common/api/module-list.ts` lists the shared modules.
- `lib/browser/api/module-list.ts` lists the main-process modules in alphabetical order. Its first line notes that the list must be kept in sync with a module-keys file.
- `defineProperties` (`lib/common/define-properties.ts`) installs an enumerable getter for each entry. The getter calls the entry's loader when read and unwraps an ES module's `default` export. Because each loader is a `require(...)`, a module is evaluated only when user code first reads its property, and Node's module cache serves later reads.

## Binding to native objects

Each `lib/` module reads its native counterpart with `process._linkedBinding(...)`. For example, `lib/browser/api/app.ts` binds `electron_browser_app` and `electron_common_command_line`, then wraps methods such as `app.getName`, `app.setBadgeCount`, and `app.isAccessibilitySupportEnabled` in JavaScript. The binding names are registered in C++:

- `ELECTRON_BROWSER_BINDINGS` in `shell/common/node_bindings.cc` lists the browser binding names, such as `electron_browser_app`.
- The binding is created in the matching C++ module, for example `NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_app, Initialize)` in `shell/browser/api/electron_api_app.cc`.

The division of labor is consistent. C++ owns the state and platform behavior. `lib/` owns the public signature, overload handling, events, and deprecation shims.

## Bundling and how it reaches the binary

The build turns `lib/` into one init script per process type:

1. `BUILD.gn` declares a `webpack_build` target for each bundle (`electron_browser_bundle`, `electron_renderer_bundle`, `electron_worker_bundle`, `electron_sandboxed_renderer_bundle`, `electron_isolated_renderer_bundle`, `electron_node_bundle`, `electron_utility_bundle`, `electron_preload_realm_bundle`). Each one points at a config under `build/webpack/`.
2. `build/webpack/webpack.config.base.js` builds the entry from `lib/<target>/init.ts`, aliases `@electron/internal` to `lib/`, and uses `ts` and `js` extensions. It also injects `process`, `Buffer`, and `Promise` through ProvidePlugin where Node globals are removed, and it applies build flags from the generated `buildflags.h` through DefinePlugin. Official builds use production mode; other builds use development mode.
3. Bundle outputs are written to `js2c/<name>_init.js` and then converted to C++ source by `build/js2c.py`.
4. At startup, `shell/common/node_bindings.cc` selects `electron/js2c/<process_type>_init` (line 702) and runs it.

Consequence: a change under `lib/` requires a rebuild of the bundles and the binary. There is no hot reload of the API layer inside a shipped Electron binary.

## Process-specific constraints

- In the renderer, Node globals are removed after init, so bundles use the webpack providers in `lib/common/webpack-provider.ts` to reach `process` and `Buffer`. The provider captures `globalThis.global` before the globals are removed.
- `lib/common/init.ts` wraps `process.nextTick`, `setImmediate`, and the timer functions so that they activate the Node event loop. This is needed only in processes that run Node's loop alongside Chromium's loop, and the file applies the timer override only for `browser` and `utility` process types.

## Extension seams

- New public modules are added in `lib/<process>/api/`, listed in that process's `module-list.ts`, and backed by a native binding in `shell/`. See [Native Bindings](native-bindings.md) for the C++ side.
- New API documentation and TypeScript definitions are generated from `docs/api` (see [API Documentation, Typings, and API History](../workflows/api-docs-and-typings.md)).
- Build changes to bundles go in `build/webpack/` and `BUILD.gn`. See [Building Electron with GN and Ninja](../workflows/build-and-gn.md).

## Related pages

- [Process Model and Startup](process-model.md) lists which processes load which bundle.
- [IPC Between Main, Renderer, and Utility Processes](ipc.md) describes the messages the `ipcMain` and `ipcRenderer` modules send.
- [Native Bindings](native-bindings.md) covers the `shell/` side of each binding.

## Focused tests

- `spec/api-app-spec.ts`, `spec/api-web-contents-spec.ts`, and `spec/api-session-spec.ts` exercise `lib/browser/api/` modules through the public API.
- `spec/api-ipc-spec.ts` covers the `ipcMain` and `ipcRenderer` modules.
- `spec/esm-spec.ts` covers ES module support.
