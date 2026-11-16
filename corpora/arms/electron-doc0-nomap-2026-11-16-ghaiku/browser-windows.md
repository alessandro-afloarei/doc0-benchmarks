---
title: "Windows and WebContents"
---
## Overview

A `BrowserWindow` in the app is two objects that the browser process keeps in step: a native window, created by C++ in `BrowserWindow`, and a `WebContents`, which owns the page and its renderer. `BaseWindow` is the window without a page. This page follows one `new BrowserWindow()` and one `loadURL()` call through both layers. How the page's messages reach `ipcMain` is on [[Inter-process Communication]], and the session the `WebContents` uses is on [[Sessions and Browser Context]].

Sources: [lib/browser/api/browser-window.ts:1-10](repo://lib/browser/api/browser-window.ts#L1-L10), [lib/browser/api/base-window.ts:1-10](repo://lib/browser/api/base-window.ts#L1-L10)

## Base window

`BaseWindow` is looked up from the `electron_browser_base_window` binding. The JavaScript prototype inherits from `EventEmitter`, so every window emits events. Its `_init` sets the application menu on the window on each platform except macOS.

Sources: [lib/browser/api/base-window.ts:6-19](repo://lib/browser/api/base-window.ts#L6-L19)

The properties `autoHideMenuBar`, `visibleOnAllWorkspaces` and `fullScreen` are getters and setters that call the matching methods, so assigning one has the same effect as calling its setter.

Sources: [lib/browser/api/base-window.ts:27-40](repo://lib/browser/api/base-window.ts#L27-L40)

## BrowserWindow construction

`BrowserWindow::New` runs when JavaScript calls `new BrowserWindow`. It refuses to run before the app is ready, and it accepts at most one argument, which is the options object. A missing options argument is replaced with an empty dictionary.

Sources: [shell/browser/api/electron_api_browser_window.cc:293-310](repo://shell/browser/api/electron_api_browser_window.cc#L293-L310)

The prototype's methods are the window-specific ones, `focusOnWebView`, `blurWebView` and `isWebViewFocused`, plus a `webContents` property. Every other method is inherited from `BaseWindow`, which is set up in the JavaScript module.

Sources: [shell/browser/api/electron_api_browser_window.cc:313-322](repo://shell/browser/api/electron_api_browser_window.cc#L313-L322), [lib/browser/api/browser-window.ts:4-8](repo://lib/browser/api/browser-window.ts#L4-L8)

The JavaScript `_init` for `BrowserWindow` calls `BaseWindow`'s `_init` first. It then forwards the window's `blur` and `focus` events to the app as `browser-window-blur` and `browser-window-focus`, with the window as the second argument.

Sources: [lib/browser/api/browser-window.ts:32-38](repo://lib/browser/api/browser-window.ts#L32-L38)

Responsiveness is tracked through the page. When the page reports `unresponsive`, the window starts a 50 ms timer and emits `unresponsive` when it fires, if the window still exists and is enabled. When `close` fires without being prevented and no timer is pending, a 5-second timer is started. A `responsive` event from the page cancels a pending timer.

Sources: [lib/browser/api/browser-window.ts:40-60](repo://lib/browser/api/browser-window.ts#L40-L60)

## WebContents initialization

Each `WebContents` runs its own prototype `_init`. It reads the last web preferences and logs a deprecation when a window has a preload script and no `sandbox` value. It then makes the `id` property read-only, so it stays readable after the native object is destroyed.

Sources: [lib/browser/api/web-contents.ts:537-549](repo://lib/browser/api/web-contents.ts#L537-L549)

The same `_init` creates an `IpcMainImpl` and exposes it as `webContents.ipc`. This is the emitter that `ipc-dispatch` checks for each frame's messages, which is why a listener on `webContents.ipc` receives only that page's traffic.

Sources: [lib/browser/api/web-contents.ts:551-557](repo://lib/browser/api/web-contents.ts#L551-L557), [lib/browser/ipc-dispatch.ts:36-51](repo://lib/browser/ipc-dispatch.ts#L36-L51)

## loadURL

The JavaScript `loadURL` first creates a promise that waits for the next load. It attaches a no-op rejection handler so that an unused promise does not report an unhandled error, then calls the native `_loadURL` and returns the promise.

Sources: [lib/browser/api/web-contents.ts:427-434](repo://lib/browser/api/web-contents.ts#L427-L434)

The native `LoadURL` checks the URL first. An invalid URL, or one longer than the maximum, emits `did-fail-load` with `ERR_INVALID_URL` and returns without navigating. Otherwise it builds the navigation parameters, takes the referrer from the `httpReferrer` option, and sets the user agent from the `userAgent` option.

Sources: [shell/browser/api/electron_api_web_contents.cc:2331-2352](repo://shell/browser/api/electron_api_web_contents.cc#L2331-L2352)

The native method is registered on the `WebContents` prototype under the name `_loadURL`, which is the name the JavaScript wrapper calls.

Sources: [shell/browser/api/electron_api_web_contents.cc:4415](repo://shell/browser/api/electron_api_web_contents.cc#L4415)

## Base window binding

`BaseWindow::New` is the constructor for a window without a page. Like `BrowserWindow::New` it reads one optional options dictionary, and the JavaScript prototype it returns shares the methods that `BrowserWindow` inherits.

Sources: [shell/browser/api/electron_api_base_window.cc:1147-1150](repo://shell/browser/api/electron_api_base_window.cc#L1147-L1150), [lib/browser/api/browser-window.ts:4-8](repo://lib/browser/api/browser-window.ts#L4-L8)
