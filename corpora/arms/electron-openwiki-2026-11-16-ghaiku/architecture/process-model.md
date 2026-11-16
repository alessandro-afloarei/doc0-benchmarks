---
type: architecture
title: Process Model and Startup
description: How Electron starts and divides work across the browser (main) process, renderer, utility process, sandboxed renderer, preload realm, isolated renderer, and worker processes. Covers the entry points, the process type each runs as, and the per-process init modules in lib/ that set up Node.js and Electron APIs for each.
tags: [process-model, startup, renderer, utility-process, sandbox, preload, worker, init]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-3870e9df1305cc5d679a8730
    resource: repo://lib/browser/rpc-server.ts
  - id: openwiki-source-0b7fa519832032182e66e802
    resource: repo://lib/node/init.ts
  - id: openwiki-source-b590f9b923c89bac137bd0aa
    resource: repo://lib/renderer/init.ts
  - id: openwiki-source-a887f89c61604389673127b5
    resource: repo://lib/sandboxed_renderer/init.ts
  - id: openwiki-source-93a818e87ad1df553e29d207
    resource: repo://lib/sandboxed_renderer/pre-init.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Process Model and Startup

Electron inherits Chromium's multi-process architecture and adds an embedded Node.js environment to some of those processes. Every process starts from the same executable, and Chromium's `ContentMainDelegate` decides which role it plays. Electron then selects a JavaScript bundle for that role and runs it inside the process's Node.js environment.

## Process types

The `BrowserEnvironment` enum in `shell/common/node_bindings.cc` (around lines 662-676) names the process types that host Node.js and Electron's JavaScript:

| Process type | Environment | Init bundle (`js2c/<type>_init`) | Typical role |
| --- | --- | --- | --- |
| `browser` | `kBrowser` | `browser_init` | Main process: `app`, windows, sessions, and the main-process APIs. |
| `renderer` | `kRenderer` | `renderer_init` | Web page renderers, and the Node environment for preload scripts that are not sandboxed. |
| `worker` | `kWorker` | `worker_init` | Service and web workers that get Electron's APIs. |
| `utility` | `kUtility` | `utility_init` | Utility processes started by `utilityProcess.fork`. |

Other process roles reuse these bundles through their own init modules. The sandboxed renderer and preload realm run `lib/sandboxed_renderer/init.ts` and `lib/preload_realm/init.ts`, and the isolated renderer runs `lib/isolated_renderer/init.ts`. Each of these modules is bundled separately (see [JavaScript API Layer](js-api-layer.md)).

## Start-up sequence

1. **Executable entry.** `main` in the platform file (for example `shell/app/electron_main_linux.cc`) prepares the command line. If the `run_as_node` fuse is on and `ELECTRON_RUN_AS_NODE` is set, it runs `electron::NodeMain()` from `shell/app/node_main.cc` and never starts Chromium. This is how forked children run as plain Node.js.
2. **Chromium start.** Otherwise `content::ContentMain` starts with an `ElectronMainDelegate` (`shell/app/electron_main_delegate.cc`). The delegate initializes the feature list and Mojo in `PreBrowserMain`, and it supplies the browser, renderer, and utility clients through `CreateContentBrowserClient`, `CreateContentRendererClient`, and `CreateContentUtilityClient`.
3. **Role selection.** Chromium's sub-process launch passes a process type. The renderer client chooses `ElectronSandboxedRendererClient` when the sandbox is enabled and `ElectronRendererClient` otherwise.
4. **Node environment.** `NodeBindings` (`shell/common/node_bindings.h`) creates the Node environment for the process. It passes the `electron/js2c/<process_type>_init` script to Node, which runs the bundle as the process's entry (`shell/common/node_bindings.cc`, around line 702).
5. **Init bundle.** The bundle's init module runs before any user code:
   - `lib/browser/init.ts` loads common settings, installs an uncaught-exception dialog, emits `exit` on `app`'s `quit`, and sets the Windows app user model ID when the app was installed by Squirrel.
   - `lib/renderer/init.ts` replaces `Module.wrapper` so that module code receives `process`, `global`, and `Buffer` as parameters, which lets preload scripts keep them after the renderer removes Node globals. It also warns when `vm` is required in the renderer.
   - `lib/utility/init.ts` restores the entry script path, loads common settings, and creates the `parentPort` object for message passing.
   - `lib/worker/init.ts` loads common settings and sets up `require` for the worker's global scope.
   - `lib/common/init.ts` (loaded by every init) wraps `process.nextTick` and `setImmediate` so the Node event loop wakes when callbacks are queued, and it overrides timer functions in the processes that run Node's loop next to Chromium's loop.
6. **User code.** The app's entry script runs in the browser process, and preload scripts run in each renderer frame.

## Sandboxed renderers and the preload realm

When sandboxing is on, the renderer cannot use Node directly. `lib/sandboxed_renderer/pre-init.ts` exposes `process._linkedBinding` through a binding getter, makes `process` an `EventEmitter`, and attaches a `Buffer` shim used by native deserialization. `lib/sandboxed_renderer/init.ts` then calls `ipcRendererUtils.invokeSync` with `BROWSER_SANDBOX_LOAD` to fetch the preload scripts and the `process` properties from the browser (`lib/browser/rpc-server.ts`, around line 89). It provides a restricted `require` that resolves only `electron`, `events`, `timers`, and `url`.

`lib/preload_realm/init.ts` follows the same pattern for the preload realm context. The native side is `shell/renderer/preload_realm_context.{h,cc}`, which hosts the preload realm context.

Consequence: in a sandboxed renderer, preload code sees only the modules that the init loads. Adding a Node module to that list is a change to the sandbox boundary.

## Utility processes

A utility process is started from the browser process by `utilityProcess` (`shell/browser/api/electron_api_utility_process.cc`). Its init reads the service startup script from a hidden value on `process`, rewrites `process.argv` to point at that script, and creates `parentPort`. Messages from the parent arrive on `parentPort`. Shutdown is coordinated from the browser process: `PostMainMessageLoopRun` stops utility processes created through the Electron API before Node is destroyed (see [Browser Main Process](browser-main-process.md)).

## Forked Node children

`lib/node/init.ts` replaces `child_process.fork` so that children set `ELECTRON_RUN_AS_NODE=1`. On macOS the child uses the helper executable. The child then takes the `run_as_node` path described in step 1 above. This is how the same binary can serve as the app and as a plain Node.js runtime. The fuse can disable it (see [Fuses and ASAR Integrity](../concepts/fuses-and-integrity.md)).

## Invariants

- The bundle used depends on the process type. Code placed in `lib/browser/` is not available in renderers, and vice versa.
- Node globals (`process`, `Buffer`, `global`) are deleted in renderers after init. The webpack providers and the `Module.wrapper` hook in `lib/renderer/init.ts` exist to give internal code and preload scripts access to them.
- Sandboxed processes receive only the module list defined in their init. The preload realm gets preload scripts only through the browser's `BROWSER_SANDBOX_LOAD` response.

## Related pages

- [Architecture Overview](overview.md)
- [Browser Main Process](browser-main-process.md)
- [IPC Between Main, Renderer, and Utility Processes](ipc.md)
- [ASAR Archives and Module Loading](asar-and-module-loading.md)
- [JavaScript API Layer](js-api-layer.md)

## Focused tests

- `spec/api-utility-process-spec.ts` covers utility process startup and messaging.
- `spec/api-subframe-spec.ts` and `spec/api-web-frame-spec.ts` cover renderer frame behavior.
- `spec/api-process-spec.ts` covers process-level APIs.
