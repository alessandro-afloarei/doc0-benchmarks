---
type: architecture
title: Browser Main Process (shell/browser)
description: Responsibilities and internal structure of shell/browser, the C++ side of Electron's browser (main) process. Covers the startup and shutdown lifecycle, the Browser singleton, window creation through NativeWindow, the browser-side content client, network and protocol handling, and platform-specific code.
tags: [browser-process, main-process, native-window, lifecycle, shell-browser]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-a18b21a4de8ba6a29d39ffdd
    resource: repo://shell/browser/api/electron_api_base_window.cc
  - id: openwiki-source-756d224c2262dce17547ccc2
    resource: repo://shell/browser/browser.cc
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-0ee6d56d164b00df4e86177b
    resource: repo://shell/browser/native_window_mac.mm
  - id: openwiki-source-552f048e007fd908814d9f45
    resource: repo://shell/browser/native_window_views.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Browser Main Process (shell/browser)

`shell/browser/` contains the C++ implementation of Electron's browser process: the process that runs `app`, `BrowserWindow`, `session`, the menus, the tray, and the other main-process APIs. It sits between Chromium's browser-side layer (`content::BrowserMainParts`, `content::ContentBrowserClient`) and the JavaScript API layer in `lib/browser/`. The directory is large (over 1,500 files, counting platform variants), so this page covers the structure and the main flows rather than every class.

## Module map

| Area | Location | Role |
| --- | --- | --- |
| Lifecycle | `electron_browser_main_parts.{h,cc}` | `ElectronBrowserMainParts` implements Chromium's `BrowserMainParts` hooks: early initialization, thread creation, main loop start, and shutdown. |
| Application state | `browser.{h,cc}` | The `Browser` singleton that backs the `app` API. It handles quit, exit, and version/name state, and it notifies `BrowserObserver`s. |
| Content client | `electron_browser_client.{h,cc}` | `ElectronBrowserClient` implements `content::ContentBrowserClient`. It supplies browser-side policy and configuration, such as network context parameters and preferences. |
| Browser contexts | `electron_browser_context.{h,cc}` | Per-profile state behind `session` objects, including storage and download management. |
| Windows | `native_window.{h,cc}`, `native_window_views.cc`, `native_window_mac.mm`, `native_window_views_win.cc` | The platform window abstraction. `NativeWindow::Create` returns a `NativeWindowViews` on Linux and Windows and a `NativeWindowMac` on macOS. |
| JS-facing APIs | `api/electron_api_*.{h,cc,mm}` | Native implementations of the main-process APIs (`app`, `BaseWindow`, `BrowserWindow`, `WebContents`, `session`, `Menu`, `Tray`, `dialog`, and others) that `lib/browser/api/` wraps. |
| UI | `ui/` | Views and GTK/Cocoa/Win32 UI pieces: menus, dialogs, tray icons, drag-and-drop, DevTools UI, and the accelerator utilities. |
| Networking | `net/` | URL loader factories, proxying URL loaders and WebSockets, the `web_request` interface, cert verification, and the network context service. |
| Extensions | `extensions/` | Chromium extension support, enabled by `ENABLE_ELECTRON_EXTENSIONS`. It installs extension clients during main-loop setup. |
| Other subsystems | `notifications/`, `printing/`, `serial/`, `hid/`, `usb/`, `bluetooth/`, `file_system_access/`, `media/`, `osr/` | Feature implementations, several of them behind build flags or platform checks. |
| Platform code | `mac/`, `win/`, `linux/`, `*_mac.mm`, `*_win.cc`, `*_linux.cc` | Platform integration: application delegates, dark mode, relaunch, and window details. |

## Startup and the main loop

`ElectronBrowserMainParts` is the bridge between Chromium's startup and Electron's embedded Node.js and JavaScript environment.

1. Early initialization (`PreEarlyInitialization`, `PostEarlyInitialization`) prepares the platform and logging.
2. Thread creation (`PreCreateThreads`, `PostCreateThreads`) sets up the idle monitor and related services.
3. `PreMainMessageLoopRun` (`shell/browser/electron_browser_main_parts.cc`, around line 425) is the critical step. Its source comment says that the user's main script runs before most things are initialized. It calls `node_bindings_->PrepareEmbedThread()` and `StartPolling()`, locks URL scheme registries, and initializes the extension clients if extensions are enabled. It registers `ElectronWebUIControllerFactory` and handles `--remote-debugging-pipe` and `--remote-debugging-port`. On non-macOS platforms it then calls `Browser::Get()->WillFinishLaunching()` and `DidFinishLaunching(...)`. macOS sends these from `ElectronApplicationDelegate` instead.
4. The Chromium main loop runs. On macOS the application delegate drives the `app` lifecycle events.
5. `PostMainMessageLoopRun` (around line 549) shuts down in a fixed order: it frees the macOS app delegate, shuts down each `DownloadManager` before Node is destroyed (to avoid download callbacks running after teardown), and stops utility processes created through the Electron API so their `exit` events can be emitted while Node is still alive.

Consequence: any code that depends on Node running must finish before `PostMainMessageLoopRun`. Download and utility-process teardown is ordered explicitly for this reason.

## Quit flow

`Browser::Quit` (`shell/browser/browser.cc`, around line 86) is the single entry point for quitting:

- It returns early if already quitting.
- It calls `HandleBeforeQuit()`, which notifies `BrowserObserver::OnBeforeQuit`. If an observer sets `prevent_default`, the quit is cancelled and nothing is closed.
- If no windows are open, it calls `NotifyAndShutdown()` directly. Otherwise it calls `WindowList::CloseAllWindows()`, and shutdown proceeds as windows close.

`Browser::Exit` and `Browser::Shutdown` are the lower-level paths. Quit ordering is therefore a combination of observer notification and native window closure.

## Window creation

A JavaScript `BrowserWindow` or `BaseWindow` is created by the native `electron_api_base_window.cc` (around line 112). It calls `NativeWindow::Create(options, parent)`, attaches itself as an observer, and then creates its content view. The platform-specific `NativeWindow` is chosen at compile time:

- Views-based platforms (Linux and Windows) use `NativeWindowViews` (`native_window_views.cc`, around line 1950).
- macOS uses `NativeWindowMac` (`native_window_mac.mm`, around line 1879).

`NativeWindow` is the stable interface that API code uses. Platform differences should stay inside the platform subclasses.

## Browser client and network policy

`ElectronBrowserClient` (`electron_browser_client.cc`) implements Chromium's browser-side hooks. Its `ConfigureNetworkContextParams` (around line 824) is where Electron sets network-level parameters for each context. Requests issued through `session` and protocol handlers go through `shell/browser/net/`, which proxies URL loaders so that `webRequest` and custom protocol handlers can observe and intercept traffic.

## Invariants and failure behavior

- Shutdown order matters. Downloads and utility processes are torn down before Node is destroyed, so changes to shutdown should preserve that order.
- `Browser::Quit` can be cancelled by a `BrowserObserver` that sets `prevent_default`. Native code should not assume that a quit request always leads to shutdown.

## Extension seams

- New main-process APIs are added as `api/electron_api_*.cc` files with a matching `lib/browser/api/` wrapper (see [Native Bindings](native-bindings.md)).
- Platform behavior belongs in the platform-specific `NativeWindow` subclass or in a `*_mac.mm`/`*_win.cc`/`*_linux.cc` file, not in shared code.
- Browser-side Chromium hooks are reached through `ElectronBrowserClient` and `ElectronBrowserMainParts`. Patches to Chromium that affect these hooks are tracked in the patch stack (see [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md)).

## Related pages

- [Overview](overview.md) places this process within the wider system.
- [Process Model and Startup](process-model.md) covers the other processes.
- [IPC Between Main, Renderer, and Utility Processes](ipc.md) covers messaging with this process.
- [Native Bindings](native-bindings.md) covers how these C++ objects are exposed to JavaScript.

## Focused tests

- `spec/api-browser-window-spec.ts` exercises window creation and options.
- `spec/api-session-spec.ts` and `spec/api-web-request-spec.ts` cover browser-context and network behavior.
