---
type: architecture
title: Node.js and Chromium Event Loop Integration
description: How Electron embeds Node.js into Chromium processes - the shared V8 isolate, per-process Node environments, the libuv embed thread that wakes Chromium's message loop, microtask policy differences, and how the main process blocks until app code has loaded.
tags: [node, libuv, v8, event-loop, nodebindings, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-ed351709652fc770f66629c8
    resource: repo://shell/browser/javascript_environment.cc
  - id: openwiki-source-621f4c935fc5eddbc2bdd42e
    resource: repo://shell/browser/microtasks_runner.cc
  - id: openwiki-source-cc4b02f3a5ab48fd724308d8
    resource: repo://shell/common/node_bindings_linux.cc
  - id: openwiki-source-ad63950cd895c81f99480b6c
    resource: repo://shell/common/node_bindings_mac.cc
  - id: openwiki-source-b05145bd3aa867bc93533bc9
    resource: repo://shell/common/node_bindings_win.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-a24378d8ea89c1ac619c961c
    resource: repo://shell/renderer/electron_renderer_client.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Node.js and Chromium Event Loop Integration

Electron runs Node.js *inside* Chromium processes rather than next to them. Chromium owns the process, the main thread and its message loop; Node's libuv loop is a guest that is polled on demand. The integration lives in `NodeBindings` (`shell/common/node_bindings.{h,cc}` with per-OS subclasses) and `JavascriptEnvironment` (`shell/browser/javascript_environment.cc`).

## Ownership and environment kinds

`NodeBindings::Create(BrowserEnvironment)` returns a platform subclass (`NodeBindingsLinux`, `NodeBindingsMac`, `NodeBindingsWin`) for one of four kinds: `kBrowser`, `kRenderer`, `kUtility`, `kWorker`. The kind decides almost everything below:

- **Which libuv loop.** Browser, renderer and utility processes use `uv_default_loop()`; each Web Worker gets its own `uv_loop_t` (`worker_loop_`), which is torn down by `stop_and_close_uv_loop`. All loops are configured with `UV_LOOP_INTERRUPT_ON_IO_CHANGE` so that starting a handle interrupts embed polling.
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Which init script.** `CreateEnvironment` picks `electron/js2c/<type>_init` (see [JS bundles](/openwiki/architecture/js-bundles-and-internal-modules.md)) and sets `process.type`.
<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Which bindings** are registered ([native bindings](/openwiki/architecture/native-api-bindings.md)).

## Initialization sequence

1. `Initialize()` registers built-in bindings, applies `NODE_OPTIONS` handling, parses Node CLI flags and calls `node::InitializeOncePerProcess` with flags that stop Node from initializing V8, cppgc or its own V8 platform (Chromium already did). The WASM trap handler is disabled in Node because V8 allows enabling it only once. The `node_options` fuse controls whether `NODE_OPTIONS` is honored, and renderers skip Node's default signal handling.
2. `CreateEnvironment()` builds Node `IsolateData` (stored in the V8 context's embedder data) and a `node::Environment` with flags such as `kNoGlobalSearchPaths` and `kNoRegisterESMLoader`. In renderers and workers it also adds `kNoBrowserGlobals` and `kNoCreateInspector`, because Blink already provides those globals, the module loader and the inspector. The `node_cli_inspect` fuse additionally disables the SIGUSR1 debug handler.
3. It then customizes isolate behavior: custom fatal and OOM callbacks that record crash keys, a callback that stops Node from aborting on uncaught exceptions (except in utility processes, which behave like a standard Node runtime), and Chromium-aware WASM and `eval` code-generation callbacks. In renderers it keeps Blink's promise-rejection, message-listener and prepareStackTrace callbacks instead of Node's.
4. `LoadEnvironment()` runs the init script via `node::LoadEnvironment` and emits a `loaded` event on `process`.

The main process runs these steps in `ElectronBrowserMainParts::PostEarlyInitialization` (`electron_browser_main_parts.cc`): create `JavascriptEnvironment`, `Initialize`, `CreateEnvironment`, bind Electron's extra process APIs, `CreateMicrotasksRunner`, `set_uv_env`, `LoadEnvironment`, then `JoinAppCode()`. The embed thread and polling are started later, in `PreMainMessageLoopRun`. Renderers do the equivalent in `ElectronRendererClient::DidCreateScriptContext` (`shell/renderer/electron_renderer_client.cc`), which only makes the *first* environment the "uv env" that drives the loop (`set_uv_env`, then `StartPolling`).

## JavascriptEnvironment

`JavascriptEnvironment` creates the V8 platform used before Chromium's task scheduler exists. Because gin's V8 platform depends on Chromium task scheduling that has not started yet, it uses Node's `MultiIsolatePlatform` and registers the isolate with the uv loop. On destruction it must deinitialize the `gin::IsolateHolder` before the isolate is unregistered from the Node platform. It also owns the `MicrotasksRunner`, created and destroyed around isolate holder hooks.

## Merging the two event loops

Chromium never blocks in `uv_run`. Instead a dedicated **embed thread** waits for libuv activity and posts a task to the UI thread:

- `PrepareEmbedThread()` adds a dummy `uv_async` handle (so the loop never reports "nothing to do") and starts `EmbedThreadRunner`. It runs only once per process because on Windows the IOCP is fixed at loop creation.
- `EmbedThreadRunner` loops: wait on `embed_sem_`, call the platform-specific `PollEvents()`, then `WakeupMainThread()`, which posts `UvRunOnce` to the saved Chromium task runner.
- `PollEvents()` blocks on the libuv backend for up to `uv_backend_timeout`: `epoll_wait` on Linux, `select` on macOS, `GetQueuedCompletionStatus` on Windows (re-posting the completion so libuv still sees it; on single-core Windows machines the IOCP concurrency is set to 2 to avoid a busy loop).
- `UvRunOnce()` runs on the main thread: it enters the Node context, runs `uv_run(UV_RUN_NOWAIT)` inside an explicit microtask scope, quits the Chromium loop if libuv has nothing left, and finally posts `embed_sem_` so the embed thread polls again.
- `StartPolling()` performs the first `UvRunOnce` and records the current Chromium task runner. `WakeupEmbedThread()` pokes the dummy async handle, which is what shutdown uses to unblock the thread.

This is why `lib/common/init.ts` wraps `process.nextTick`, `setImmediate`, `setTimeout` and `setInterval` to call `process.activateUvLoop()`: libuv's check/prepare handles only fire when the loop is actually run, so scheduling a callback must kick the embed machinery.

## Microtasks

The browser and utility processes use `v8::MicrotasksPolicy::kExplicit`, as Node expects. In `MicrotasksRunner::DidProcessTask` (registered as a Chromium task observer), the browser process opens a `node::CallbackScope` after each UI-thread task so that Node performs the microtask checkpoint itself, which avoids contention between Node's own checkpoint and Chromium's. Renderers share an isolate with Blink, which expects `kScoped`, so the isolate policy is left as is and `UvRunOnce` temporarily switches to explicit microtasks via `ExplicitMicrotasksScope`.

## Blocking until app code loads

`JoinAppCode()` (browser process only) pumps `uv_run(UV_RUN_ONCE)` in a loop until `process.appCodeLoaded()` has been called (it sets `app_code_loaded_`), the browser is shutting down, or libuv has no work left. `lib/browser/init.ts` calls `appCodeLoaded()` right after (CJS) or when (ESM) the app's main script finishes its synchronous load. This ensures the app's top-level code, including `app.on('ready')` registrations, has run before Chromium's main loop starts delivering events. The renderer exposes `appCodeLoaded` too, called when preload scripts finish.

## Teardown

The destructor sets `embed_closed_`, posts the semaphore, wakes the embed thread, joins it and destroys libuv handles. Environments are returned as `shared_ptr<node::Environment>` with a deleter that clears the context's embedder pointer before freeing the environment and isolate data. `ElectronBrowserMainParts::PostMainMessageLoopRun` clears the uv env before destroying things.

## Implications

- Node code in the main process runs on the Chromium UI thread; blocking it blocks UI.
<!-- openwiki: broken internal link [/openwiki/build/upstream-patches.md] link "/openwiki/build/upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Node is patched (see [upstream patches](/openwiki/build/upstream-patches.md)) to cooperate with this embedding; changes to Node upgrades commonly touch this code.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model.md] link "/openwiki/architecture/process-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- See [process model](/openwiki/architecture/process-model.md) for where these calls sit in startup.
