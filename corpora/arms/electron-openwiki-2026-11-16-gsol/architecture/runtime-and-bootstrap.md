---
type: architecture
title: Runtime architecture and bootstrap
description: How Electron selects process clients, embeds Node into Chromium, loads application code, and shuts down dependent services.
tags: [architecture, bootstrap, processes, node, chromium]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-f0fd38de25eeb7a8f5bbd940
    resource: repo://lib/utility/init.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Runtime architecture and bootstrap

Electron combines Chromium's content embedding interfaces with Node environments and process-specific JavaScript APIs. Native code under `shell/` owns process integration and object lifetimes; TypeScript under `lib/` initializes those environments and wraps linked native bindings. The public API is assembled separately for each process.

## Process ownership

`ElectronMainDelegate` supplies browser, GPU, renderer, and utility clients to Chromium. Its renderer factory chooses `ElectronSandboxedRendererClient` or `ElectronRendererClient` according to sandbox state. A utility process is another content-process integration point, rather than a renderer with a different window.

The build makes separate browser, renderer, sandboxed renderer, isolated renderer, Node, worker, utility, and preload-realm bundles. `electron_js2c` embeds those bundles into generated native source. A TypeScript change therefore reaches runtime through the GN/webpack dependency graph, not through loading the repository's `lib/` files directly.

## Main-process startup

1. `ElectronBrowserMainParts` creates a JavaScript environment after Chromium's proxy resolver has initialized its V8 environment.
2. It initializes Node, creates an environment, binds Electron's process extensions, creates the explicit microtask runner, and associates the libuv loop with that environment.
3. Loading the Node environment executes Electron initialization. Native startup then joins application loading before continuing browser initialization.

`lib/browser/init.ts` restores arguments and common settings, installs the EventEmitter prototype and default exception handler, and initializes internal RPC and guest-view infrastructure. Native code supplies application search paths: normally `app.asar`, `app`, then `default_app.asar`; the ASAR-only fuse restricts this to `app.asar`.

The browser initializer loads the first usable package under `process.resourcesPath`, applies application metadata, and selects `packageJson.main || 'index.js'`. Failure to find a package schedules exit with code 1 and throws. This explains why a malformed distribution can fail before any application window exists.

## CommonJS, ESM, and readiness

CommonJS entry loading signals `appCodeLoaded` before synchronous `Module._load`. ESM entry loading uses Node's ESM loader and signals completion after the import succeeds or fails; failure is emitted as an uncaught exception. Native `JoinAppCode` pumps libuv until completion, shutdown, or an exhausted loop. This loading barrier participates in launch ordering; an import's completion and a page's load completion are different milestones.

The initializer installs a default `window-all-closed` handler that quits only when it is the sole listener, and creates the default application menu at `will-finish-launching`. Application listeners can therefore change the default window lifecycle policy.

## Event loops and shutdown

NodeBindings runs libuv without blocking through `UV_RUN_NOWAIT` on the owning thread. A polling thread waits for libuv activity and posts work back to that thread; it does not execute application JavaScript itself. `UvRunOnce` exits early when its Node environment has gone away, which matters during renderer navigation.

Shutdown ordering protects callbacks: browser main parts shuts down download managers and Electron Node utility processes while Node is still available, then stops Node and clears its environment, and finally destroys browser contexts. Moving work across these boundaries can cause callbacks into already-destroyed JavaScript state.

The utility initializer exposes a read-only `process.parentPort`, starts or pauses it as message listeners appear or disappear, and imports the service entry script through Node's ESM loader.

## Where to investigate

Use `spec/api-app-spec.ts` for application events, `spec/esm-spec.ts` for module startup, and `spec/api-utility-process-spec.ts` for utility lifecycle behavior. For a UI failure, continue with [windows and navigation](windows-and-navigation.md); for renderer access, see [preload isolation and IPC](../concepts/preload-isolation-and-ipc.md); for application resolution, see [ASAR and module loading](../concepts/asar-and-module-loading.md).
