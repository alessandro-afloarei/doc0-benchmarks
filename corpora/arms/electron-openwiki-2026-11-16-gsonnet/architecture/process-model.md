---
type: architecture
title: Process Model and Startup Sequence
description: How an Electron executable boots - the main() entrypoints, run-as-node mode, ElectronMainDelegate and its content clients, the ordered BrowserMainParts hooks, and the Browser object's launch and quit lifecycle that hand control to the app's JavaScript.
tags: [startup, process-model, content-api, main-parts, lifecycle, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-b326c72eb64dde6d23fbe693
    resource: repo://shell/app/node_main.cc
  - id: openwiki-source-756d224c2262dce17547ccc2
    resource: repo://shell/browser/browser.cc
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Process Model and Startup Sequence

Electron is a Chromium "content shell"-style embedder. It implements Chromium's content API delegates (`ContentMainDelegate`, `ContentBrowserClient`, `ContentRendererClient`, ...) and layers Node.js and the Electron JS API on top. The same executable is launched for every process type (browser/main, renderer, GPU, utility, zygote on Linux, relauncher); the `--type` switch selects the role.

## Entrypoints (`shell/app/`)

Each OS has its own `main` (`electron_main_linux.cc`, `electron_main_win.cc`, `electron_main_mac.cc`; macOS also has `electron_library_main.mm` for the framework). On Linux the sequence is: fix stdio, `uv_setup_args`, initialize `base::CommandLine` and `ElectronCommandLine`, then:

- If the **`run_as_node` fuse** is enabled *and* `ELECTRON_RUN_AS_NODE` is set, call `electron::NodeMain()` (`node_main.cc`) and never start Chromium. This turns the binary into a plain Node.js runtime. Before starting it strips `NODE_OPTIONS` and `NODE_EXTRA_CA_CERTS` when the `node_options` fuse is off, and on macOS also removes hijackable environment variables when the parent process is not signed as the same app, closing a way to sidestep macOS sandbox restrictions through node mode. It rejects disallowed Node flags and runs Node on a libuv-driven task runner (`UvTaskRunner`) with Electron's bindings registered.
- Otherwise build an `ElectronMainDelegate` and call `content::ContentMain`.

## ElectronMainDelegate

`ElectronMainDelegate` (`shell/app/electron_main_delegate.cc`) is Chromium's hook into every process:

- `BasicStartupComplete`: enables in-process stack dumping when `ELECTRON_ENABLE_STACK_DUMPING` is set and appends `--no-sandbox` when `ELECTRON_DISABLE_SANDBOX` is set, registers path providers, and on Linux refuses to run as root unless the sandbox is disabled (crbug.com/638180).
- `PreSandboxStartup`: applies `--user-data-dir`, initializes logging and crash keys, loads the resource bundle for process types that need it, and initializes crashpad early in renderers (the main process waits for JS to call `crashReporter.start()`). Separately, when the `embedded_asar_integrity_validation` fuse is on, a helper `ValidateV8Snapshot` checks the V8 snapshot's SHA-256 against a build-time checksum.
- `PreBrowserMain`: initializes the feature list and Mojo core early because Chromium services read features.
- `GetBrowserV8SnapshotFilename`: returns `browser_v8_context_snapshot.bin` in the browser process when the `load_browser_process_specific_v8_snapshot` fuse is enabled.
<!-- openwiki: broken internal link [/openwiki/architecture/renderer-preload-and-isolation.md] link "/openwiki/architecture/renderer-preload-and-isolation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Client factories: `CreateContentBrowserClient` returns `ElectronBrowserClient`, `CreateContentGpuClient` returns `ElectronGpuClient`, `CreateContentUtilityClient` returns `ElectronContentUtilityClient`, and `CreateContentRendererClient` chooses between `ElectronSandboxedRendererClient` (when the renderer sandbox is enabled) and `ElectronRendererClient` (see [renderer, preload and isolation](/openwiki/architecture/renderer-preload-and-isolation.md)).
- `RunProcess` diverts the `relauncher` process type to `relauncher::RelauncherMain`; everything else proceeds normally.

## ElectronBrowserClient and per-process wiring

<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`ElectronBrowserClient::CreateBrowserMainParts` returns `ElectronBrowserMainParts`. The browser client also customizes child process launch: `AppendExtraCommandLineSwitches` verifies that the executable about to be launched is the expected child binary (aborting on unexpected helpers) and appends crashpad and other switches; `OverrideWebPreferences` and `RenderProcessWillLaunch` feed per-WebContents preferences into renderers; `ElectronApiIPCHandlerImpl` and other Mojo interfaces are registered here (see [IPC](/openwiki/architecture/ipc.md)).

## BrowserMainParts: the ordered hooks

`ElectronBrowserMainParts` (`shell/browser/electron_browser_main_parts.cc`) implements content's startup phases for the browser process. Its constructor already creates the `NodeBindings` (kind `kBrowser`), `ElectronBindings`, the `Browser` object and a fake `BrowserProcessImpl` (a stand-in for Chrome's `g_browser_process`). In order:

1. `PreEarlyInitialization`: field trial list, SIGCHLD handling, Ozone/screen pre-init, color mixers.
<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. `PostEarlyInitialization`: creates `JavascriptEnvironment`, initializes Node and loads the browser JS bundle, then **blocks in `JoinAppCode()`** until the app's main script has finished its synchronous top-level execution ([details](/openwiki/architecture/node-chromium-integration.md)). This is why `lib/browser/init.ts` can run before Chromium's UI is up and why code such as `app.commandLine.appendSwitch` and `app.disableHardwareAcceleration()` in the main script takes effect.
3. `PreCreateThreads`: locale and resource bundle (`--lang`), the desktop screen, `MediaCaptureDevicesDispatcher`; notifies `Browser` observers via `PreCreateThreads`.
4. `PostCreateThreads`: registers internal plugins and tracing on the IO thread.
5. `PreCreateMainMessageLoop` / `PostCreateMainMessageLoop`: macOS main nib and URL handler, Windows OSCrypt, Linux Ozone and shutdown callback.
6. `PreMainMessageLoopRun`: starts the Node embed thread and polling, locks URL scheme registries, sets up the extensions client, WebUI factory, remote debugging (`--remote-debugging-pipe` / `--remote-debugging-port`), and then, outside macOS, calls `Browser::WillFinishLaunching` and `DidFinishLaunching` (on macOS the app delegate does this). `WillRunMainMessageLoop` hands the quit closure to `Browser`.
7. `PostMainMessageLoopRun`: shuts down download managers, shuts down `utilityProcess` children first so their `exit` events can fire, stops Node (`node::Stop`), clears the uv env, destroys all `ElectronBrowserContext`s and stops the debugging pipe.

## Browser lifecycle object

`Browser` (`shell/browser/browser.cc`) is the C++ core of `app`:

- `WillFinishLaunching` notifies observers (fires `will-finish-launching`). `DidFinishLaunching` creates the user data directory, sets `is_ready_`, resolves `app.whenReady()`'s promise and notifies observers (fires `ready`).
- `Quit()` first runs `before-quit` handling (`HandleBeforeQuit`); if windows exist it closes them all (so `close` handlers can veto), otherwise it shuts down. `Exit(code)` is the forced variant: it stores the exit code in `ElectronBrowserMainParts`, destroys windows without asking, and calls `Shutdown`. If the message loop isn't running yet, it just calls `exit(code)`.
- `OnWindowAllClosed` routes to `Shutdown` when exiting, `NotifyAndShutdown` when quitting, or fires `window-all-closed` otherwise; `lib/browser/init.ts` registers the default listener that calls `app.quit()` when the app didn't add its own.

## What JavaScript does at boot

<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
From the JS side the boot order (default menu on `will-finish-launching`, preloading modules, main script) is described in [JS bundles and internal modules](/openwiki/architecture/js-bundles-and-internal-modules.md). If no app is found (`app/`, `app.asar`, or `default_app.asar` via `appSearchPaths`), `init.ts` throws `Unable to find a valid app` and exits; `default_app/` is the app used when Electron is started without one.

## Other processes

- **Renderer**: Chromium launches renderers with the `--type=renderer` switch; the renderer client in `shell/renderer/` creates Node environments per frame if nodeIntegration is on.
<!-- openwiki: broken internal link [/openwiki/architecture/utility-processes-and-asar.md] link "/openwiki/architecture/utility-processes-and-asar.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Utility**: Chromium utility processes use `ElectronContentUtilityClient`; `utilityProcess.fork` runs the Node service ([utility processes and ASAR](/openwiki/architecture/utility-processes-and-asar.md)).
- **GPU**: `ElectronGpuClient` customizes the GPU process.
- **Relauncher**: a special `--type=relauncher` mode used to restart the app.
