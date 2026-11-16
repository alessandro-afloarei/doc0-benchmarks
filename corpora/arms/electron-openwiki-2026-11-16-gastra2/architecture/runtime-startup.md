---
type: architecture
title: Runtime startup and process ownership
description: Native Chromium entrypoints, browser Node initialization, application entry loading, event-loop integration and ordered shutdown in Electron.
tags: [runtime, startup, node, chromium, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-756d224c2262dce17547ccc2
    resource: repo://shell/browser/browser.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Runtime startup and process ownership

Electron embeds Node.js into a Chromium application. The browser process owns application lifecycle and desktop APIs; renderer clients execute web content and preload code; utility processes can host separate Node services. The public `electron` module is assembled for the executing process, so availability of an API depends on where code runs.

## From executable to application entry

The platform entrypoints are `shell/app/electron_main_linux.cc`, `electron_main_win.cc`, and the macOS main/library entrypoints. On Linux, the run-as-Node fuse plus a nonempty `ELECTRON_RUN_AS_NODE` selects `NodeMain`; otherwise startup passes an `ElectronMainDelegate` to Chromium's `ContentMain`. The delegate installs browser, renderer, GPU and utility clients. Renderer selection chooses either `ElectronSandboxedRendererClient` or `ElectronRendererClient` according to sandbox state.

Browser startup proceeds through `ElectronBrowserMainParts`:

1. Create a JavaScript environment and Node environment during `PostEarlyInitialization`.
2. Bind Electron's process extensions, establish the explicit microtask runner, and associate Node with the libuv loop.
3. Load the environment, entering `lib/browser/init.ts`, and join application-code loading.
4. Reinitialize feature configuration after application code has had a chance to alter command-line switches.
5. Complete platform launching and make `app.whenReady()` resolvable through `Browser::DidFinishLaunching`.

This ordering explains why synchronous startup configuration can affect browser initialization, while APIs guarded by readiness must wait. macOS delivers launch notifications through its application delegate; other platforms invoke them in the browser main-parts startup hook.

## Package discovery and module loading

The native Node bindings supply an ordered resource search list: `app.asar`, `app`, then `default_app.asar`. The only-load-app-from-ASAR fuse narrows it to `app.asar`. Browser initialization searches for a readable `package.json`, sets application name/version/path, and chooses `packageJson.main || 'index.js'`. If no valid package is found, initialization schedules exit code 1 and throws.

The entry is loaded as ESM when it ends in `.mjs`, or when package type is `module` and the entry does not end in `.cjs`. That path imports through Node's ESM loader and signals `appCodeLoaded` on either success or failure; errors are routed to `uncaughtException`. The CommonJS path signals before its synchronous `Module._load`. See [ASAR and application loading](../concepts/asar-and-application-loading.md) for filesystem behavior.

The common initializer injects cached modules for `electron` and `electron/common`, plus the applicable main/renderer/utility alias. Browser exports combine common and browser module lists using property getters. A public wrapper may then call a native linked binding such as `process._linkedBinding('electron_browser_window')`. For the extension workflow, see [extending an API](../workflows/extending-electron-api.md).

## Event-loop integration

Node's libuv loop runs alongside Chromium's message loop. `NodeBindings` starts a polling thread and schedules libuv work on the main task runner; `UvRunOnce` runs without blocking and skips work when the environment has gone away. `JoinAppCode` pumps libuv while waiting for the browser application's loading signal, stopping if startup shuts down or the loop has no more work.

`lib/common/init.ts` wraps `nextTick`, `setImmediate`, and timer APIs to activate libuv. Without this wake-up, work scheduled from Chromium callbacks could remain pending until some unrelated activity wakes Node. Preserve these activation and teardown relationships when changing scheduling behavior.

## Quit, exit and destruction

`Browser::Quit` asks observers whether quitting is allowed, closes windows, and later allows `will-quit` cancellation. `Browser::Exit` records the exit code and destroys windows without asking them to close; very early exit uses the platform exit directly. These are different lifecycle operations.

Browser JavaScript maps `process.exit` to `app.exit` and emits Node's `exit` event when the application emits `quit`. Its default `window-all-closed` listener calls `app.quit()` only when no application listener is also installed.

After the main loop finishes, native teardown shuts download managers down first and terminates Electron Node utility services while Node can still emit their exit events. It then stops Node, clears the environment, and destroys browser contexts. Reordering these stages can leave native callbacks targeting already-destroyed JavaScript state.

## Where to investigate

Use `spec/api-app-spec.ts` for application metadata, module resolution, exit and single-instance behavior, and `spec/esm-spec.ts` for ESM entry/preload cases. Follow [window ownership](windows-and-web-contents.md) for close handling, [renderer security](../concepts/renderer-security.md) for preload environments, and [utility processes](utility-processes.md) for child Node lifetimes.
