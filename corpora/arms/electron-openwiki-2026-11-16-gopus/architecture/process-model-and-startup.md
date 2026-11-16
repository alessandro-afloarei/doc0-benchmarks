---
type: architecture
title: Process model and main-process startup
description: How an Electron executable starts — platform main(), the ELECTRON_RUN_AS_NODE path, ElectronMainDelegate and per-process clients, ElectronBrowserMainParts creating the Node environment, the libuv/Chromium message-loop integration, lib/browser/init.ts loading the app, and the quit lifecycle.
tags: [architecture, startup, main-process, node, libuv, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-7ca9d05ab2240d0c837898d6
    resource: repo://default_app/main.ts
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-b326c72eb64dde6d23fbe693
    resource: repo://shell/app/node_main.cc
  - id: openwiki-source-756d224c2262dce17547ccc2
    resource: repo://shell/browser/browser.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Process model and main-process startup

Electron is a Chromium *content embedder* that also embeds Node.js. A single
executable acts as every process type: the browser (main) process, renderer,
GPU, utility and other Chromium helpers, plus a pure Node.js mode. The process
type is chosen by Chromium's `--type=` switch, and Electron plugs in through
`content::ContentMainDelegate` and the per-process `Content*Client`
interfaces.

## Platform entrypoints

`shell/app/electron_main_linux.cc`, `electron_main_mac.cc` and
`electron_main_win.cc` contain `main()` / `wWinMain()`. On Linux the flow is:

1. Fix stdio, call `uv_setup_args`, initialise `base::CommandLine` and
   `ElectronCommandLine`.
2. If the **RunAsNode fuse** is enabled *and* `ELECTRON_RUN_AS_NODE` is set,
   initialise ICU and return `electron::NodeMain()` — Chromium is never
   started.
3. Otherwise run `content::ContentMain` with an `ElectronMainDelegate`.

### Node mode (`ELECTRON_RUN_AS_NODE`)

`shell/app/node_main.cc` runs the binary as a plain Node.js runtime. It
removes `NODE_OPTIONS`/`NODE_EXTRA_CA_CERTS` from the environment if the
NodeOptions fuse is disabled, and on macOS it strips hijackable environment
variables when the parent process is not part of the same signed app, so the
node mode cannot be abused to inject scripts into a sandboxed app. It
registers Electron's builtin bindings, creates a Node environment, adds a
minimal `process.crashReporter`, runs `node::LoadEnvironment` with
`OnNodePreload` (which executes the `node_init` bundle, e.g. ASAR support), and
spins Node's own event loop until exit. `child_process.fork` from Electron
processes sets `ELECTRON_RUN_AS_NODE=1` automatically (`lib/node/init.ts`), and
on macOS uses the helper executable. Fuses are described in
[Fuses and build flags](../systems/fuses-and-build-flags.md).

## ElectronMainDelegate

`shell/app/electron_main_delegate.cc` handles cross-process startup:
`BasicStartupComplete`, `PreSandboxStartup` (resource bundle loading for
processes that need it, crashpad initialisation), `PreBrowserMain`, V8 snapshot
selection, and creation of the per-process clients:

| Client | Class | Process |
| --- | --- | --- |
| `ContentClient` | `ElectronContentClient` | all (schemes, plugins) |
| `ContentBrowserClient` | `ElectronBrowserClient` | browser |
| `ContentRendererClient` | `ElectronSandboxedRendererClient` if the sandbox switch is set, otherwise `ElectronRendererClient` | renderer |
| `ContentUtilityClient` | `ElectronContentUtilityClient` | utility |
| `ContentGpuClient` | `ElectronGpuClient` | GPU |

`RunProcess` also intercepts Electron's own `relauncher` process type used
by `app.relaunch()`. Renderer and utility details are in
[Renderer processes, sandboxing and context isolation](renderer-processes-and-sandboxing.md)
and [Utility processes](../systems/utility-process.md).

## ElectronBrowserMainParts: bringing Node into the browser process

`ElectronBrowserClient` creates `ElectronBrowserMainParts`
(`shell/browser/electron_browser_main_parts.cc`), which owns `NodeBindings`
(browser flavour), `ElectronBindings`, the `JavascriptEnvironment` (V8
isolate + platform) and the Node environment. The important hooks, in order:

1. **`PreEarlyInitialization`** — feature list and platform (Ozone) setup.
2. **`PostEarlyInitialization`** — create the `JavascriptEnvironment` on the
   uv loop, initialise Node, `CreateEnvironment` (which selects
   `electron/js2c/browser_init` as the entry script; see
   [JS bundles, module lists and native bindings](js-bundles-and-native-bindings.md)),
   set `unhandled_rejections = "warn-with-error-code"`, bind
   `ElectronBindings` to `process`, create the microtasks runner, then
   **`LoadEnvironment`** — this executes `lib/browser/init.ts` and therefore the
   app's main script — and finally **`JoinAppCode`**.
3. `PreCreateThreads` / `PostCreateThreads` / `ToolkitInitialized`.
4. **`PreMainMessageLoopRun`** — start the uv embed thread and polling, lock
   URL scheme registries (so custom schemes must be registered before
   `ready`), set up extensions, WebUI and DevTools remote debugging, and on
   non-mac platforms call `Browser::WillFinishLaunching` and
   `DidFinishLaunching` (macOS does this from its application delegate).
5. **`PostMainMessageLoopRun`** — destroy the microtasks runner, `node::Stop`
   the environment, and tear down Chromium state.

Because the app's main script runs inside `PostEarlyInitialization`, user code
executes *before* the Chromium main message loop exists. That is why most APIs
require `app.whenReady()` / the `ready` event.

### Waiting for ESM entrypoints: `appCodeLoaded`

For the browser and renderer, `CreateEnvironment` installs a one-shot
`process.appCodeLoaded` function. `lib/browser/init.ts` removes it from
`process` and calls it after the app's entry finishes loading — immediately for
CommonJS (`Module._load` is synchronous), or after the asynchronous ESM import
resolves (or rejects) for `type: "module"` / `.mjs` entrypoints.
`NodeBindings::JoinAppCode` pumps `uv_run(UV_RUN_ONCE)` until that signal
arrives (or the browser is shutting down), so top-level `await` in an ESM main
script completes before Chromium continues startup.

## Integrating libuv with Chromium's message loop

Node's libuv loop and Chromium's message loop must share the main thread.
`NodeBindings` (`shell/common/node_bindings.cc`, with
`node_bindings_{linux,mac,win}.cc` providing `PollEvents`) does this with an
**embed thread**:

- `PrepareEmbedThread` adds a dummy `uv_async` handle (so the loop never
  thinks it is idle), initialises a semaphore, and starts
  `EmbedThreadRunner`.
- The embed thread waits on the semaphore, blocks in the platform-specific
  `PollEvents()` (epoll/kqueue/IOCP on the uv backend fd), and then posts
  `UvRunOnce` to the main-thread task runner via `WakeupMainThread`.
- `UvRunOnce` (main thread) enters the Node context, runs
  `uv_run(UV_RUN_NOWAIT)` inside an explicit microtasks scope, and posts the
  semaphore so the embed thread resumes polling.
- `StartPolling` records the main-thread task runner and runs the loop once.
  Both functions are guarded by `initialized_` so only one polling thread
  exists per process (important for IOCP concurrency limits on Windows).

The same mechanism is reused by renderer and worker Node environments.

## lib/browser/init.ts: locating and running the app

`lib/browser/init.ts` is the browser bundle's entry. In order it:

- removes the injected init-script argument from `process.argv`;
- loads `lib/common/init.ts` (the `electron` module hook, timers, etc.);
- installs a default `uncaughtException` handler that shows an error dialog
  only if no user handler is registered;
- maps `process.exit` to `app.exit` and emits `process 'exit'` on `app 'quit'`;
- loads the RPC server and guest-view manager (internal IPC handlers);
- searches `process.resourcesPath` for the app using the hidden
  `appSearchPaths` set by C++ — `app.asar`, `app`, `default_app.asar`, or only
  `app.asar` when the OnlyLoadAppFromAsar fuse is on — and throws
  `Unable to find a valid app` if no `package.json` loads;
- applies `version`, `productName`/`name`, `desktopName` and `v8Flags` from
  `package.json` and calls `app.setAppPath`;
- pre-loads modules (`protocol`, `web-contents`, `web-frame-main`,
  `web-contents-view`, …) so they are populated before `ready`;
- installs the default `window-all-closed` → `app.quit()` behavior (only when
  the user registered no listener) and sets the default application menu on
  `will-finish-launching`;
- runs the entry script (`main`, default `index.js`) via CommonJS or the ESM
  loader, signalling `appCodeLoaded` as described above.

### default_app

When no app is packaged, `default_app.asar` (source in `default_app/`) is
loaded. `default_app/main.ts` parses CLI arguments (`electron path/to/app`,
`--app=`, `-i/--interactive` REPL, `-r/--require`, `-v`, `--abi`), sets
`process.defaultApp = true`, loads the target package's `package.json`
metadata, and either runs that package, loads a URL/file into a window via
`default_app.ts`, or shows the welcome page (`index.html`, `preload.ts`).

## Ready and quit lifecycle

`shell/browser/browser.cc` is the C++ owner of app-wide lifecycle state used by
the `app` API:

- `DidFinishLaunching` creates the userData directory, sets `is_ready_`,
  resolves the `whenReady()` promise and notifies observers (the `ready`
  event).
- `Quit()` emits `before-quit` (cancellable); if not cancelled it closes all
  windows, or immediately calls `NotifyAndShutdown` when there are none. A
  window's `beforeunload` cancellation (`OnWindowCloseCancelled`) also cancels
  the pending quit.
- When the last window closes during a quit, `NotifyAndShutdown` emits
  `will-quit` (cancellable) and then `Shutdown` emits `quit` and runs the main
  message-loop quit closure.
- `Exit(code)` skips the events: it records the exit code, destroys all
  windows without asking, and shuts down (or calls `exit()` directly if the
  message loop is not running yet).
- If not quitting, closing the last window emits `window-all-closed`.

Window lifetime is covered in
[Windows, views and WebContents](../systems/windows-and-web-contents.md).
