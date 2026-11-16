---
title: "Process Types and JavaScript Bootstraps"
---
## Overview

Every Electron process that runs JavaScript starts from one of a handful of bootstrap scripts in `lib/`. Each directory under `lib/` is one webpack bundle with a single `init.ts` entry, compiled into the binary and run by C++ at the right moment: `browser`, `renderer`, `sandboxed_renderer`, `isolated_renderer`, `preload_realm`, `worker`, `utility` and `node`. This page explains what differs between them. The C++ that creates each Node environment is in [[Node.js Integration and the Event Loop]]; the `require('electron')` object each bootstrap gets is in [[Module Loading and Linked Bindings]].

Sources: [build/webpack/webpack.config.base.js:21-34](repo://build/webpack/webpack.config.base.js#L21-L34), [docs/development/source-code-directory-structure.md:25-47](repo://docs/development/source-code-directory-structure.md#L25-L47)

## Bundle configuration

All bundles are produced by one factory in `webpack.config.base.js`; each `webpack.config.<target>.js` file only passes options to it. The options decide what the bundle can assume about its environment:

Sources: [build/webpack/webpack.config.base.js:21-34](repo://build/webpack/webpack.config.base.js#L21-L34)

| Bundle | `alwaysHasNode` | Other options |
| --- | --- | --- |
| `browser` | yes | none |
| `node` | yes | none |
| `utility` | yes | none |
| `renderer` | yes | deletes Node globals, profiling timeout, try/catch wrapper |
| `worker` | yes | deletes Node globals, loads `electron` from the `renderer` target, try/catch wrapper |
| `sandboxed_renderer` | no | profiling timeout, try/catch wrapper |
| `preload_realm` | no | profiling timeout, try/catch wrapper |
| `isolated_renderer` | no | try/catch wrapper |

Sources: [build/webpack/webpack.config.renderer.js:1-7](repo://build/webpack/webpack.config.renderer.js#L1-L7), [build/webpack/webpack.config.sandboxed_renderer.js:1-6](repo://build/webpack/webpack.config.sandboxed_renderer.js#L1-L6), [build/webpack/webpack.config.worker.js:1-7](repo://build/webpack/webpack.config.worker.js#L1-L7), [build/webpack/webpack.config.preload_realm.js:1-6](repo://build/webpack/webpack.config.preload_realm.js#L1-L6), [build/webpack/webpack.config.isolated_renderer.js:1-5](repo://build/webpack/webpack.config.isolated_renderer.js#L1-L5), [build/webpack/webpack.config.utility.js:1-4](repo://build/webpack/webpack.config.utility.js#L1-L4), [build/webpack/webpack.config.browser.js:1-4](repo://build/webpack/webpack.config.browser.js#L1-L4), [build/webpack/webpack.config.node.js:1-4](repo://build/webpack/webpack.config.node.js#L1-L4)

The shared factory resolves `@electron/internal/*` to the `lib/` folder, and `electron`, `electron/main`, `electron/renderer`, `electron/common` and `electron/utility` all to `lib/<target>/api/exports/electron.ts` (the worker borrows the renderer's). The `target` is `node` when the bundle always has Node and `web` otherwise. `BUILDFLAG` values from the generated buildflag header are injected through `DefinePlugin`, so `if (BUILDFLAG(ENABLE_X))` becomes a constant. When a bundle deletes the Node globals, a `ProvidePlugin` rewrites uses of `process`, `global` and `Buffer` to a provider module so internal code keeps working after the page-visible globals are removed; for bundles without Node, `Buffer` and `process` come from the browser polyfills.

Sources: [build/webpack/webpack.config.base.js:34-83](repo://build/webpack/webpack.config.base.js#L34-L83), [build/webpack/webpack.config.base.js:109-134](repo://build/webpack/webpack.config.base.js#L109-L134)

The optional wrappers either run the init code in `setTimeout` when `--profile-electron-init` is on the command line, or wrap it in `try { ... } catch` that logs "Electron <file> script failed to run". The list of files each bundle touches is recorded in the generated `filenames.auto.gni`; see [[Build System]].

Sources: [build/webpack/webpack.config.base.js:85-107](repo://build/webpack/webpack.config.base.js#L85-L107)

## Who runs which bundle

Each bundle is compiled into the binary under a `electron/js2c/` name and invoked by a specific piece of C++:

Sources: [shell/common/node_bindings.cc:702-704](repo://shell/common/node_bindings.cc#L702-L704)

| Script name | Run by |
| --- | --- |
| `electron/js2c/<type>_init` (`browser`, `renderer`, `worker`, `utility`) | `NodeBindings::CreateEnvironment`, as Node's entry script |
| `electron/js2c/node_init` | the Node preload code in `shell/common/node_bindings.cc` |
| `electron/js2c/sandbox_bundle` | `ElectronSandboxedRendererClient` |
| `electron/js2c/isolated_bundle` | `RendererClientBase`, in the isolated world |
| `electron/js2c/preload_realm_bundle` | `preload_realm_context.cc` |

Sources: [shell/common/node_bindings.cc:702-704](repo://shell/common/node_bindings.cc#L702-L704), [shell/common/node_bindings.cc:1015-1022](repo://shell/common/node_bindings.cc#L1015-L1022), [shell/renderer/electron_sandboxed_renderer_client.cc:133](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L133), [shell/renderer/renderer_client_base.cc:601-608](repo://shell/renderer/renderer_client_base.cc#L601-L608), [shell/renderer/preload_realm_context.cc:179-186](repo://shell/renderer/preload_realm_context.cc#L179-L186)

Because Node is started with the init script spliced in as `argv[1]`, every Node-based bootstrap begins by undoing that with `process.argv.splice(1, 1)`. The utility bootstrap instead replaces the entry with the service's startup script.

Sources: [lib/browser/init.ts:11-12](repo://lib/browser/init.ts#L11-L12), [lib/renderer/init.ts:42-44](repo://lib/renderer/init.ts#L42-L44), [lib/utility/init.ts:8-11](repo://lib/utility/init.ts#L8-L11)

## Browser

`lib/browser/init.ts` is the main-process bootstrap, described in [[Main Process Startup]]. Its distinguishing steps are loading the RPC server and the guest view manager, finding the app, and calling `appCodeLoaded()`.

Sources: [lib/browser/init.ts:75-80](repo://lib/browser/init.ts#L75-L80), [lib/browser/init.ts:201-227](repo://lib/browser/init.ts#L201-L227)

## Renderer (non-sandboxed)

`lib/renderer/init.ts` runs in a renderer with Node available (that is, `sandbox: false`). It:

Sources: [lib/renderer/init.ts:56-66](repo://lib/renderer/init.ts#L56-L66)

1. warns when the Node `vm` module is loaded, because it conflicts with Blink's contexts;
2. overrides `Module.wrapper` so `process`, `global` and `Buffer` remain visible to preload scripts even after they are deleted from the page's globals (relying on a Node patch, as the comment notes);
3. runs the shared `common/init` and `common-init` and defines `process.getProcessMemoryInfo` through internal IPC;
4. if `nodeIntegration` is on, exposes `require` and `module` on `global`, sets `__filename`/`__dirname` from the page URL for `file:` pages and routes `window.onerror` to `uncaughtException`; otherwise, when context isolation is off, deletes `process`, `Buffer`, `setImmediate`, `clearImmediate` and `global` once `loaded` fires;
5. asks the browser for the preload list with a synchronous internal IPC (`BROWSER_NONSANDBOX_LOAD`) and loads CommonJS preloads with `Module._load` and `.mjs` preloads through the ESM loader, reporting failures with `BROWSER_PRELOAD_ERROR`;
6. calls `appCodeLoaded()` when preloads are done. Preload semantics, world separation and the context bridge are covered in [[Renderer, Preload Scripts and Context Isolation]].

Sources: [lib/renderer/init.ts:10-64](repo://lib/renderer/init.ts#L10-L64), [lib/renderer/init.ts:66-131](repo://lib/renderer/init.ts#L66-L131), [lib/renderer/init.ts:133-168](repo://lib/renderer/init.ts#L133-L168)

## Sandboxed renderer and preload realm

A sandboxed renderer has no Node. Its bundle is compiled with `alwaysHasNode: false` and starts with `sandboxed_renderer/pre-init`, which exposes the C++ `binding.get` as `process._linkedBinding`, copies `binding.process` onto `process`, stores `Buffer` as a hidden value for C++ deserialization, and turns the webpack `process` into an `EventEmitter`.

Sources: [lib/sandboxed_renderer/pre-init.ts:1-30](repo://lib/sandboxed_renderer/pre-init.ts#L1-L30)

`lib/sandboxed_renderer/init.ts` then fetches the preload scripts and the process properties with `BROWSER_SANDBOX_LOAD`, builds a small allow-list of modules a preload may `require` (`electron`, `events`, plus lazily `timers` and `url`), registers the `emit-process-event` hook that C++ calls, and runs the preloads with `executeSandboxedPreloadScripts`.

Sources: [lib/sandboxed_renderer/init.ts:14-71](repo://lib/sandboxed_renderer/init.ts#L14-L71)

`lib/preload_realm/init.ts` is nearly the same, with a smaller module list (no `timers`) and `ipc-native-setup` instead of `common-init`. It runs in a separate V8 context (a shadow realm) created next to a service worker's context when the service-worker-preload switch is present.

Sources: [lib/preload_realm/init.ts:1-58](repo://lib/preload_realm/init.ts#L1-L58), [shell/renderer/electron_sandboxed_renderer_client.cc:185-194](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L185-L194)

## Isolated renderer

`lib/isolated_renderer/init.ts` is tiny. It runs in the isolated world when context isolation is on and, if the `guestViewInternal` hook exists, sets up the `<webview>` element in the main world, since the custom element must be registered there.

Sources: [lib/isolated_renderer/init.ts:1-9](repo://lib/isolated_renderer/init.ts#L1-L9)

## Worker

`lib/worker/init.ts` gives web workers a Node environment. It exposes `require` and `module`, restores Blink's `fetch` family when `blinkfetch` is set (the code references `WebWorkerObserver::WorkerScriptReadyForEvaluation`), and sets `__filename` from the worker's URL for `file:` URLs, faking an `electron.asar/worker/init.js` path otherwise. See [[Utility Processes and Workers]].

Sources: [lib/worker/init.ts:1-50](repo://lib/worker/init.ts#L1-L50)

## Utility

`lib/utility/init.ts` boots processes created by `utilityProcess.fork`. It reads the hidden `_serviceStartupScript`, builds a `ParentPort` and defines it as `process.parentPort`, starts and pauses the port as `message` listeners come and go, and finally imports the entry script through the ESM loader, turning an import failure into an uncaught exception. Details are in [[Utility Processes and Workers]].

Sources: [lib/utility/init.ts:1-50](repo://lib/utility/init.ts#L1-L50)

## Shared code

Three pieces are shared between bundles: `lib/common/init.ts` (timer wrappers, see [[Node.js Integration and the Event Loop]]), `lib/node/init.ts` (the `fs` ASAR wrapper and `child_process.fork` hook, see [[ASAR Archives]]), and `lib/common/define-properties.ts`, which defines API getters on the `electron` object.

Sources: [lib/common/init.ts:8-62](repo://lib/common/init.ts#L8-L62), [lib/node/init.ts:1-59](repo://lib/node/init.ts#L1-L59)
