---
title: "Internal JavaScript Bundles"
---
## Overview

Most of Electron's public API is TypeScript in `lib/`, running on top of native bindings. That code is not shipped as loose files. Webpack compiles it into one bundle per kind of JavaScript context, Node's `js2c` tool embeds the bundles into the executable as `electron_natives.cc`, and the C++ side runs a bundle by its id (`electron/js2c/browser_init`, `electron/js2c/sandbox_bundle` and so on) when it sets up a context.

Sources: [BUILD.gn:165-273](repo://BUILD.gn#L165-L273), [shell/common/node_util.cc:23-59](repo://shell/common/node_util.cc#L23-L59)

This page follows a bundle from its webpack target to the running process. It also covers how `require('electron')` resolves inside the bundles and in app code, and the timer patches every Node-enabled bundle installs. The native modules the bundles call are described in [[Native API Bindings with gin]]. When each bundle runs is described on the pages for its process.

Sources: [lib/common/init.ts:1-117](repo://lib/common/init.ts#L1-L117)

## The bundles

`webpack.config.base.js` is a factory. Each `webpack.config.<target>.js` calls it with a target name and a few options. The entry is `lib/<target>/init.ts`, and the target decides which `lib/<target>/api/exports/electron.ts` the `electron` import resolves to.

Sources: [build/webpack/webpack.config.base.js:21-34](repo://build/webpack/webpack.config.base.js#L21-L34)

| Target | Output | `alwaysHasNode` | Other options | Run by |
| --- | --- | --- | --- | --- |
| `browser` | `browser_init.js` | yes | none | Node bootstrap in the main process |
| `renderer` | `renderer_init.js` | yes | deletes Node globals, profiling wrapper, try/catch | Node bootstrap in a Node-enabled renderer frame |
| `worker` | `worker_init.js` | yes | `electron` from `renderer`, deletes Node globals, try/catch | Node bootstrap in a Node-enabled web worker |
| `sandboxed_renderer` | `sandbox_bundle.js` | no | profiling wrapper, try/catch | `ElectronSandboxedRendererClient` |
| `isolated_renderer` | `isolated_bundle.js` | no | try/catch | `RendererClientBase` in the isolated world |
| `preload_realm` | `preload_realm_bundle.js` | no | profiling wrapper, try/catch | `PreloadRealmContext` for service workers |
| `utility` | `utility_init.js` | yes | none | Node bootstrap in a utility process |
| `node` | `node_init.js` | yes | none | `OnNodePreload` in every Node environment |

Sources: [build/webpack/webpack.config.browser.js:1-4](repo://build/webpack/webpack.config.browser.js#L1-L4), [build/webpack/webpack.config.renderer.js:1-7](repo://build/webpack/webpack.config.renderer.js#L1-L7), [build/webpack/webpack.config.worker.js:1-7](repo://build/webpack/webpack.config.worker.js#L1-L7), [build/webpack/webpack.config.sandboxed_renderer.js:1-6](repo://build/webpack/webpack.config.sandboxed_renderer.js#L1-L6), [build/webpack/webpack.config.isolated_renderer.js:1-5](repo://build/webpack/webpack.config.isolated_renderer.js#L1-L5), [build/webpack/webpack.config.preload_realm.js:1-6](repo://build/webpack/webpack.config.preload_realm.js#L1-L6), [build/webpack/webpack.config.utility.js:1-4](repo://build/webpack/webpack.config.utility.js#L1-L4), [build/webpack/webpack.config.node.js:1-4](repo://build/webpack/webpack.config.node.js#L1-L4), [BUILD.gn:165-235](repo://BUILD.gn#L165-L235)

The `*_init` bundles run because `NodeBindings::CreateEnvironment` inserts `electron/js2c/<type>_init` as the script argument, so Node's bootstrap runs it as the main module, as [[Node.js Integration and the Event Loop]] describes. The other bundles are compiled and called directly through `util::CompileAndCall`.

Sources: [shell/common/node_bindings.cc:702-704](repo://shell/common/node_bindings.cc#L702-L704), [shell/renderer/electron_sandboxed_renderer_client.cc:130-136](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L130-L136), [shell/renderer/renderer_client_base.cc:605-609](repo://shell/renderer/renderer_client_base.cc#L605-L609), [shell/renderer/preload_realm_context.cc:182-186](repo://shell/renderer/preload_realm_context.cc#L182-L186)

## From TypeScript to the executable

The `webpack_build` GN template runs webpack as an npm action. It passes the config, the output name and path, the generated `buildflags.h`, and a mode that is `production` only for official builds. Its inputs include the per-bundle source lists from `filenames.auto.gni`, so ninja rebuilds a bundle whenever one of its files changes.

Sources: [build/webpack/webpack.gni:1-46](repo://build/webpack/webpack.gni#L1-L46), [BUILD.gn:165-171](repo://BUILD.gn#L165-L171)

Those lists are not written by hand. `script/gen-filenames.ts` runs every webpack config with `--env PRINT_WEBPACK_GRAPH`. In that mode the base config adds `AccessDependenciesPlugin`, which prints each module's path, and the script writes the result into `filenames.auto.gni`. The `lint-staged` hook runs it on every staged JavaScript or TypeScript file.

Sources: [script/gen-filenames.ts:18-66](repo://script/gen-filenames.ts#L18-L66), [build/webpack/webpack.config.base.js:10-19](repo://build/webpack/webpack.config.base.js#L10-L19), [filenames.auto.gni:1-2](repo://filenames.auto.gni#L1-L2), [package.json:99-101](repo://package.json#L99-L101)

The `electron_js2c` action then feeds all eight bundles to Node's `js2c` binary through `build/js2c.py` with `--only-js`, producing `electron_natives.cc`. At run time, `CompileAndCall` uses Node's `BuiltinLoader` to look up and compile a bundle by id, calls it with the given parameters, and logs an error if it fails to compile or throws.

Sources: [BUILD.gn:237-273](repo://BUILD.gn#L237-L273), [build/js2c.py:7-14](repo://build/js2c.py#L7-L14), [shell/common/node_util.cc:23-59](repo://shell/common/node_util.cc#L23-L59)

## What the base config does

The webpack factory shapes every bundle the same way.

Sources: [build/webpack/webpack.config.base.js:21-36](repo://build/webpack/webpack.config.base.js#L21-L36)

- **Build flags.** It reads `#define BUILDFLAG_INTERNAL_X() (0|1)` lines from `buildflags.h` and defines each flag as a boolean, so `BUILDFLAG(ENABLE_...)` checks in TypeScript are fixed at build time.
- **Aliases.** `@electron/internal` maps to `lib/`. `electron`, `electron/main`, `electron/renderer`, `electron/common` and `electron/utility` all map to the target's `exports/electron.ts`. `timers` maps to `timers-browserify`, whose `setImmediate` does not use `window.postMessage`.
- **Globals.** Bundles without Node get `Buffer` and `process` polyfills. Bundles whose target deletes Node globals get `Buffer`, `global` and `process` from `webpack-provider.ts`, which captured them before the deletion. Every bundle gets `Promise` from `webpack-globals-provider.ts`, so later changes to `global.Promise` by app code do not reach Electron.
- **Wrappers.** `wrapInitWithTryCatch` wraps the bundle in `try`/`catch` and logs `Electron <file> script failed to run`. `wrapInitWithProfilingTimeout` defers the bundle with `setTimeout` when `--profile-electron-init` is passed, so a profiler can attach first.
- **Minification.** Terser runs only in production mode and keeps class and function names.

Sources: [build/webpack/webpack.config.base.js:36-102](repo://build/webpack/webpack.config.base.js#L36-L102), [build/webpack/webpack.config.base.js:104-171](repo://build/webpack/webpack.config.base.js#L104-L171), [lib/common/webpack-provider.ts:1-18](repo://lib/common/webpack-provider.ts#L1-L18), [lib/common/webpack-globals-provider.ts:1-8](repo://lib/common/webpack-globals-provider.ts#L1-L8)

The renderer's `Module.wrapper` override is the other half of the globals trick. It makes preload scripts receive `process`, `global` and `Buffer` as wrapper arguments even after the page's globals are deleted. Its comment asks that any extra variable added there also be added to the ProvidePlugin. [[Renderer Process Initialization]] covers when the globals are deleted.

Sources: [lib/renderer/init.ts:20-39](repo://lib/renderer/init.ts#L20-L39)

## The electron module

Each target's `exports/electron.ts` builds the module object from module lists. A module list is an array of `{ name, loader }` entries. `defineProperties` turns each entry into an enumerable getter that calls the loader on first access and unwraps an ES module's `default`. Nothing is loaded until the app touches it.

Sources: [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8), [lib/common/define-properties.ts:1-17](repo://lib/common/define-properties.ts#L1-L17)

| List | Modules |
| --- | --- |
| `commonModuleList` | `nativeImage`, `shell` |
| `browserModuleList` | `app`, `BrowserWindow`, `ipcMain`, `session`, `webContents`, `utilityProcess` and the other main-process APIs |
| `rendererModuleList` | `clipboard`, `contextBridge`, `crashReporter`, `ipcRenderer`, `webFrame`, `webUtils` |

Sources: [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5), [lib/browser/api/module-list.ts:1-43](repo://lib/browser/api/module-list.ts#L1-L43), [lib/renderer/api/module-list.ts:1-9](repo://lib/renderer/api/module-list.ts#L1-L9), [lib/renderer/api/exports/electron.ts:1-8](repo://lib/renderer/api/exports/electron.ts#L1-L8)

Inside a bundle, `require('electron')` is resolved by webpack's alias. App code is not bundled, so `lib/common/init.ts` patches Node's module system instead. `makeElectronModule` puts fake `Module` objects for `electron`, `electron/common` and the process's own entry point (`electron/main`, `electron/renderer` or `electron/utility`) into `Module._cache`, each with an `exports` getter that returns the bundle's export object. `Module._resolveFilename` maps all five names to `electron`. As the comment says, the sub-paths exist only for TypeScript and can be required from any process.

Sources: [lib/common/init.ts:78-117](repo://lib/common/init.ts#L78-L117)

## Linked bindings

The TypeScript reaches native code through `process._linkedBinding(name)`, which returns a module registered from C++ under names such as `electron_browser_session` or `electron_common_v8_util`. The internal typings declare overloads per name, so each call is typed.

Sources: [lib/browser/api/session.ts:7-8](repo://lib/browser/api/session.ts#L7-L8), [typings/internal-ambient.d.ts:219-223](repo://typings/internal-ambient.d.ts#L219-L223), [shell/common/node_bindings.cc:53-113](repo://shell/common/node_bindings.cc#L53-L113)

## Common init: keeping libuv awake

Node schedules `process.nextTick` and `setImmediate` callbacks with `uv_check` and `uv_prepare`. In Electron the libuv loop only turns when the embed thread sees I/O, so those callbacks could wait for an arbitrarily long time. `lib/common/init.ts` therefore wraps `process.nextTick`, `setImmediate`, `setTimeout` and `setInterval` so each call first runs `process.activateUvLoop()`. The wrapper copies `util.promisify.custom` so promisified timers keep working.

Sources: [lib/common/init.ts:8-51](repo://lib/common/init.ts#L8-L51)

`activateUvLoop` is defined by `ElectronBindings`. It records the current environment once in `pending_next_ticks_` and sends a `uv_async` signal, which wakes the loop and runs the pending ticks.

Sources: [shell/common/api/electron_bindings.cc:73-97](repo://shell/common/api/electron_bindings.cc#L73-L97)

The global `setTimeout` and `setInterval` are replaced only in browser and utility processes. Renderers with Node integration delete Node's globals, so their DOM timers stay untouched. On Windows, `process.stdin` is replaced with a stream that always returns EOF.

Sources: [lib/common/init.ts:53-76](repo://lib/common/init.ts#L53-L76)

## The node bundle

`node_init.js` runs in every Node environment before the process's own init bundle.

Sources: [shell/common/node_bindings.cc:1014-1021](repo://shell/common/node_bindings.cc#L1014-L1021)

1. It patches `fs` with ASAR support, described in [[ASAR Archives]].
2. If Blink stashed its `fetch`, `Response`, `FormData`, `Request`, `Headers` and `EventSource` under `blink*` names, it restores them over Node's.
3. It wraps `child_process.fork` so the child gets `ELECTRON_RUN_AS_NODE=1` and, on macOS, runs in the helper executable.
4. It limits `Module._nodeModulePaths` for files inside `process.resourcesPath` to search paths that are also inside it, so a packaged app cannot pick up `node_modules` from outside its bundle.

Sources: [lib/node/init.ts:1-59](repo://lib/node/init.ts#L1-L59)
