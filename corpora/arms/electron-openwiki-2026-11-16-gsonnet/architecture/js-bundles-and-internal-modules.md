---
type: architecture
title: JavaScript Bundles and Internal Module Loading
description: How Electron's TypeScript in lib/ is compiled by webpack into eight per-process bundles, embedded into the binary with js2c, loaded by name through Node, and how the lazily populated 'electron' module is assembled from module lists.
tags: [webpack, js2c, lib, electron-module, build, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-01574e95ef8bbb2973e5c060
    resource: repo://build/js2c.py
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-b44bd304bb68a1c147157a67
    resource: repo://build/webpack/webpack.config.renderer.js
  - id: openwiki-source-3e52dc1c6cde48adc6623b50
    resource: repo://build/webpack/webpack.config.sandboxed_renderer.js
  - id: openwiki-source-dfd047ad1d5b3aa1fd48fc4f
    resource: repo://build/webpack/webpack.config.worker.js
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
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
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-3d7a5d9e34be7b2e4cc3e775
    resource: repo://shell/renderer/electron_sandboxed_renderer_client.cc
  - id: openwiki-source-caf1d66fdda3f5575ee740de
    resource: repo://shell/renderer/preload_realm_context.cc
  - id: openwiki-source-716a2a2e8bfb52ac62f2cd25
    resource: repo://shell/renderer/renderer_client_base.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# JavaScript Bundles and Internal Module Loading

Electron's own JavaScript (everything under `lib/`) is not shipped as loose files. It is bundled per process type with webpack, converted to C++ with Node's `js2c` tool, linked into the binary, and executed at startup as a built-in Node module named `electron/js2c/<type>_init`.

## Bundles and targets

Each bundle has a tiny config in `build/webpack/` that calls the shared factory in `webpack.config.base.js` with a `target` (the entry is `lib/<target>/init.ts`, or `init.js`) and a few flags:

| Target | Output (`$target_gen_dir/js2c/`) | Node present? | Notes |
| --- | --- | --- | --- |
| `browser` | `browser_init.js` | yes | main process |
| `renderer` | `renderer_init.js` | yes | deletes Node globals, profiling and try/catch wrappers |
| `worker` | `worker_init.js` | yes | loads the `electron` module from the `renderer` target |
| `sandboxed_renderer` | `sandbox_bundle.js` | no | profiling and try/catch wrappers |
| `isolated_renderer` | `isolated_bundle.js` | no | try/catch wrapper |
| `node` | `node_init.js` | yes | `ELECTRON_RUN_AS_NODE` / node mode |
| `utility` | `utility_init.js` | yes | utility processes |
| `preload_realm` | `preload_realm_bundle.js` | no | profiling and try/catch wrappers |

`alwaysHasNode` selects webpack's `node` vs `web` target; when false, `Buffer` and `process` are polyfilled via `ProvidePlugin`. `targetDeletesNodeGlobals` (renderer and worker) instead routes `Buffer`, `global` and `process` through `lib/common/webpack-provider`, so Electron's internal code keeps working after the page-visible globals are deleted. The `wrapInitWithProfilingTimeout` flag defers the entire init until the next tick when `--profile-electron-init` is passed, and `wrapInitWithTryCatch` logs a failure of the bundle to the console rather than crashing.

Shared resolution rules (in the base config):

- `@electron/internal` aliases `lib/`, so internal modules are imported as `@electron/internal/browser/...`.
- `electron`, `electron/main`, `electron/renderer`, `electron/common` and `electron/utility` all alias a single `lib/<target>/api/exports/electron.ts` for the bundle.
- `timers` resolves to `timers-browserify`, to avoid code that uses `window.postMessage`.
- `BUILDFLAG(...)` identifiers are replaced with literal booleans by `DefinePlugin`, by parsing `BUILDFLAG_INTERNAL_*` defines out of the generated `buildflags.h`, so build-time features (e.g. extensions, spellchecker) are compiled out of JS too.
- In production (`is_official_build`) Terser minifies with class and function names kept.

## From webpack to the binary

`BUILD.gn` declares one `webpack_build` target per bundle (template in `build/webpack/webpack.gni`, run through `npm_action`) whose `inputs` come from `auto_filenames.<bundle>_deps` in `filenames.auto.gni`. That file is generated by `script/gen-filenames.ts`, which runs webpack with `PRINT_WEBPACK_GRAPH` to list each bundle's dependency graph, so GN knows when a changed `lib/` file requires a rebundle. All outputs feed the `electron_js2c` action, which runs `build/js2c.py` (a wrapper over Node's `node_js2c` tool with `--only-js`) to generate `electron_natives.cc`, compiled into Electron.

## Runtime loading

In `NodeBindings::CreateEnvironment` (`shell/common/node_bindings.cc`), the process type (`browser`, `renderer`, `worker`, `utility`) selects an init script id `electron/js2c/<type>_init` and inserts it into Node's `argv` at index 1. Node then runs it as the "main script" of the environment. The sandboxed renderer, isolated-world and preload-realm bundles are not Node environments; C++ (`electron_sandboxed_renderer_client.cc`, `renderer_client_base.cc`, `preload_realm_context.cc`) compiles and calls `electron/js2c/sandbox_bundle`, `isolated_bundle` and `preload_realm_bundle` directly. `lib/browser/init.ts` and `lib/renderer/init.ts` both start with `process.argv.splice(1, 1)` to undo that insertion, then require `lib/common/init.ts`.

`lib/common/init.ts` is the shared first step: it wraps `process.nextTick`, `setImmediate` and the timers to call `process.activateUvLoop()` (Electron only runs the libuv loop on demand), neutralizes `process.stdin` on Windows, and installs fake cached modules for `electron`, `electron/common`, plus `electron/main`, `electron/renderer` or `electron/utility` according to `process.type`. A patched `Module._resolveFilename` maps all those specifiers to the single `electron` module, so the sub-paths exist for TypeScript typing only.

## The lazy `electron` module

Each target's `lib/<target>/api/exports/electron.ts` starts with `module.exports = {}` and calls `defineProperties` (`lib/common/define-properties.ts`) with module lists:

- `lib/common/api/module-list.ts`: `nativeImage`, `shell`.
- `lib/browser/api/module-list.ts`: `app`, `BrowserWindow`, `ipcMain`, `session`, `Menu`, `Tray`, `net`, `protocol`, `utilityProcess`, `webContents`, and the rest of the main-process API.
- `lib/renderer/api/module-list.ts`: the renderer set (e.g. `ipcRenderer`, `contextBridge`, `webFrame`).

Each entry is `{ name, loader: () => require('./x') }` and is installed as an enumerable getter, so a module's file (and any native binding it pulls in) is only evaluated when first accessed; ES-module defaults are unwrapped by `handleESModule`. This keeps startup cheap. The browser module list carries a TODO that adding a module also requires updating the module-keys file, and the lists are kept alphabetical by convention.

## Boot order in the main process

After `common/init`, `lib/browser/init.ts` installs the `uncaughtException` dialog, maps `process.exit` to `app.exit`, loads `rpc-server` and `guest-view-manager`, finds and loads the app's `package.json` from the search paths set by C++, sets app name/version/desktop name, force-loads the `protocol`, `service-worker-main`, `web-contents`, `web-frame-main` and `web-contents-view` modules so they are populated before app ready, and finally loads the app's main script (CommonJS via `Module._load`, or ESM via `runEntryPointWithESMLoader` for `"type": "module"` / `.mjs`) after calling `appCodeLoaded()`.

## Practical consequences

- Adding or renaming an internal module can change a bundle's dependency graph; regenerate `filenames.auto.gni` with `script/gen-filenames.ts` (it is wired into the lint-staged hooks in `package.json`) so it stays in sync.
- Code in the sandboxed/isolated/preload-realm bundles cannot assume Node built-ins; it must use polyfills or explicit linked bindings (`process._linkedBinding('electron_...')`).
<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Internal code uses `process._linkedBinding` to reach C++ bindings; see [native API bindings](/openwiki/architecture/native-api-bindings.md).

<!-- openwiki: broken internal link [/openwiki/architecture/process-model.md] link "/openwiki/architecture/process-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Related: [process model and startup](/openwiki/architecture/process-model.md), [build system](/openwiki/build/build-system.md).
