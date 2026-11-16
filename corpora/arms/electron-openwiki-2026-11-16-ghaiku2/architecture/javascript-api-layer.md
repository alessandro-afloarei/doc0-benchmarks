---
type: architecture
title: JavaScript API Layer
description: How the TypeScript sources under lib/ implement Electron's public modules for each process type, how webpack bundles them into per-process init scripts, how those scripts are embedded into the binary as natives, and how the electron module is assembled from lazy module lists.
tags: [electron, javascript, typescript, webpack, bundling, js2c, module-list, lib, initialization]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-01574e95ef8bbb2973e5c060
    resource: repo://build/js2c.py
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-b63cd99a26c5ff7b460c305e
    resource: repo://build/webpack/webpack.gni
  - id: openwiki-source-239321880d72bdb70fefc892
    resource: repo://lib/browser/api/module-list.ts
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-b590f9b923c89bac137bd0aa
    resource: repo://lib/renderer/init.ts
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-3d7a5d9e34be7b2e4cc3e775
    resource: repo://shell/renderer/electron_sandboxed_renderer_client.cc
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# JavaScript API Layer

Most of Electron's public API surface is written in TypeScript under `lib/`, not in C++. The C++ shell in `shell/` supplies the native bindings and the V8 and Node.js environment, while `lib/` decides what `require('electron')` returns in each process. This page covers the path from a TypeScript file to code running in a process: the per-process entry points, the webpack bundling step, how the bundles are embedded into the executable, and how the `electron` module is assembled from lazily loaded module lists.

## Layout of lib/

`lib/` is organized by process and by audience:

- `lib/browser/` holds main-process code. `lib/browser/init.ts` is its entry point, and `lib/browser/api/` implements the main-process modules such as `app`, `BrowserWindow`, `ipcMain`, `session`, and `webContents`.
- `lib/renderer/` holds renderer-process code. `lib/renderer/init.ts` is its entry point, and `lib/renderer/api/` implements modules such as `ipcRenderer`, `contextBridge`, `webFrame`, and `webUtils`. It also contains `web-view/`, which backs the `<webview>` tag, and `security-warnings.ts`.
- `lib/common/` holds code shared by the main and renderer processes. `lib/common/init.ts` runs first in every process, and `lib/common/api/` holds the modules available everywhere, currently `nativeImage` and `shell`.
- `lib/sandboxed_renderer/`, `lib/isolated_renderer/`, `lib/preload_realm/`, `lib/utility/`, `lib/worker/`, and `lib/node/` contain the entry points for the other process and realm types. `lib/node/` is a wrapper around Node's `fs` for ASAR archives (`asar-fs-wrapper.ts`).
- `lib/*/api/exports/electron.ts` files define the object that `require('electron')` resolves to in each process type.

Each process type therefore has its own `init.ts` or bundle entry. Code is shared through `lib/common/` and through the module lists.

## Per-process entry points and bundles

The GN file `BUILD.gn` declares one `webpack_build` target per process type. Each target uses a webpack configuration from `build/webpack/` and produces one bundle, which lands in `$target_gen_dir/js2c/`:

| Target | Config | Output |
| --- | --- | --- |
| `electron_browser_bundle` | `webpack.config.browser.js` | `browser_init.js` |
| `electron_renderer_bundle` | `webpack.config.renderer.js` | `renderer_init.js` |
| `electron_worker_bundle` | `webpack.config.worker.js` | `worker_init.js` |
| `electron_sandboxed_renderer_bundle` | `webpack.config.sandboxed_renderer.js` | `sandbox_bundle.js` |
| `electron_isolated_renderer_bundle` | `webpack.config.isolated_renderer.js` | `isolated_bundle.js` |
| `electron_utility_bundle` | `webpack.config.utility.js` | `utility_init.js` |
| `electron_preload_realm_bundle` | `webpack.config.preload_realm.js` | `preload_realm_bundle.js` |
| `electron_node_bundle` | `webpack.config.node.js` | `node_init.js` |

The `webpack_build` template in `build/webpack/webpack.gni` runs webpack through `npm_action` with `--env mode=development` or `production` depending on `is_official_build`. It passes `buildflags.h` as an environment variable, and it lists `webpack.config.base.js`, `tsconfig.json`, `yarn.lock`, and the two typings files as inputs, so editing a typing or the shared config re-runs every bundle.

`build/webpack/webpack.config.base.js` is the shared factory. For each target it chooses the entry point `lib/<target>/init.ts` (falling back to `init.js`), and it sets the `target` to `node` or `web` from the `alwaysHasNode` flag. Its aliases matter to every import in `lib/`:

- `@electron/internal` maps to `lib/`, so `lib` modules import each other with that prefix.
- `electron`, `electron/main`, `electron/renderer`, `electron/common`, and `electron/utility` all map to the `api/exports/electron.ts` file of the target (or of `loadElectronFromAlternateTarget` when set). This is how one source string resolves to a different object in each process.
- `timers` is redirected to `timers-browserify` so that renderer bundles do not use `window.postMessage`.

Flags from the generated `buildflags.h` are read into a webpack `DefinePlugin` as `BUILDFLAG(...)` values, so feature checks in `lib/` are constant-folded at bundle time. The base config also provides Node globals through `ProvidePlugin` where the target lacks them: `Buffer`, `global`, and `process` for renderer targets that delete Node globals, and `Promise` for all targets. Init wrappers are optional: renderer and sandboxed renderer bundles wrap the init in a try/catch that logs `Electron <file> script failed to run`, and renderer bundles can wrap init in a profiling timeout keyed to the `--profile-electron-init` switch.

## Embedding the bundles into the binary

The `electron_js2c` action in `BUILD.gn` depends on all of the bundles and on Node's own `node_js2c` target. It runs `build/js2c.py`, which invokes the js2c tool with `--only-js`, and it writes `electron_natives.cc` under `$root_gen_dir`. That generated C++ file embeds every bundle as a native JavaScript source string, so the executable carries its JavaScript and no separate lib files are needed at runtime. `build/js2c_toolchain.gni` selects the toolchain that builds this generator, which is the host toolchain when cross-compiling.

At runtime, `shell/common/node_bindings.cc` chooses the init script from the process type. It maps the browser, renderer, worker, and utility environments to the strings `browser`, `renderer`, `worker`, and `utility`, sets `process.type` to the same value, and builds the init script name `electron/js2c/<type>_init`. The init is then compiled and called through Node's bootstrap. Shell code in `shell/renderer/` loads the other bundles by name, for example `electron/js2c/sandbox_bundle` in `electron_sandboxed_renderer_client.cc`, `electron/js2c/isolated_bundle` in `renderer_client_base.cc`, and `electron/js2c/preload_realm_bundle` in `preload_realm_context.cc`.

## The init sequence

Each process-level init runs in a fixed order.

1. The bundle's `init.ts` imports `@electron/internal/common/init`. That module wraps `setImmediate` and `process.nextTick` so their callbacks activate the libuv loop, which otherwise would not run them promptly.
2. The browser init (`lib/browser/init.ts`) removes the placeholder entry from `process.argv`, installs an `uncaughtException` handler that shows a dialog only when no other handler is registered, and emits `process` `exit` when `app` emits `quit`. On Windows it sets the app user model ID for Squirrel-installed apps.
3. The renderer init (`lib/renderer/init.ts`) sets `Module.wrapper` so that preload scripts keep `process`, `global`, and `Buffer` even after the page deletes them. It also warns when a module requires `vm`, which the renderer does not support.
4. The `electron` module becomes available. Each `api/exports/electron.ts` calls `defineProperties` from `lib/common/define-properties.ts` on its module list.

## Module lists and lazy loading

`lib/browser/api/module-list.ts` exports `browserModuleList`, an array of `{ name, loader }` entries sorted alphabetically. Each loader is a `require` call, for example `{ name: 'app', loader: () => require('./app') }`. `lib/common/api/module-list.ts` exports `commonModuleList` with `nativeImage` and `shell`. The renderer, sandboxed renderer, preload-realm, and utility targets each have their own `api/module-list.ts` that follows the same pattern. The isolated renderer has an `init.ts` but no module list of its own.

`defineProperties` turns each entry into an enumerable getter on the exports object. Modules are therefore loaded on first access, not at startup, so `require('electron').BrowserWindow` executes the browser-window module only when that property is read. The getter also unwraps `default` exports from ES modules through `handleESModule`, so both CommonJS and ES module implementations work.

Because each exports file includes only the lists for its process, a module listed in `browserModuleList` does not appear in the renderer's `electron` object. The common list is included in every process.

## Typings and internal declarations

<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The lib code is type-checked against two declaration sources. The public surface comes from the generated `electron.d.ts` described in [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md). The internal surface, such as `ElectronInternal.ModuleEntry`, `BUILDFLAG`, and the `_linkedBinding` overloads, is declared in `typings/internal-electron.d.ts` and `typings/internal-ambient.d.ts`. Those two files are also GN inputs to every bundle, so a change to them rebuilds all bundles.

## Invariants and failure behavior

- The `electron_js2c` action lists each bundle as a source, so a bundle that fails to build stops the natives generation rather than producing a partial `electron_natives.cc`. The init name each process requests at runtime has to match a bundle name in that file.
- A failure while loading a module in the list surfaces at the first property access, not at startup. A broken module therefore affects only callers that reach it.
- The GN template passes `--env mode=production` when `is_official_build` is set, but the base config returns webpack `mode: 'development'` regardless. The `env.mode` value only turns on Terser minification (`minimize: env.mode === 'production'`), so official builds are minified without changing webpack's mode.
- The renderer init replaces `Module.wrapper` with an Electron-specific wrapper for all modules loaded through Node's CommonJS loader in that process, which is the mechanism that keeps `process`, `global`, and `Buffer` available to preload scripts.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) gives the wider process layout.
<!-- openwiki: broken internal link [/openwiki/architecture/native-shell.md] link "/openwiki/architecture/native-shell.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Native Shell (C++)](/openwiki/architecture/native-shell.md) describes the C++ bindings that these modules call.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md) explains how the processes communicate.
<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Building Electron](/openwiki/workflows/building.md) covers the GN and webpack steps that produce the bundles.
