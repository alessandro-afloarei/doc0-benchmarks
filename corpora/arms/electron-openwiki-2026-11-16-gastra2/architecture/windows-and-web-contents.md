---
type: architecture
title: Windows, views and web contents
description: Window and web-content ownership, navigation promise semantics, child-window policy and webview attachment in Electron.
tags: [windows, web-contents, navigation, views, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-b5a72c5fec66e3a7a6ec16c2
    resource: repo://docs/api/base-window.md
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-5c4b3547e5f4ed54e10f671a
    resource: repo://lib/browser/guest-view-manager.ts
  - id: openwiki-source-17814a035fd19191252adbb4
    resource: repo://lib/browser/guest-window-manager.ts
  - id: openwiki-source-4eda8a1b2c13c32d30ea74c8
    resource: repo://shell/browser/api/electron_api_browser_window.cc
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Windows, views and web contents

Electron separates a desktop window from the web content displayed inside it. `BaseWindow` supplies a native window and view composition; `WebContents` controls a Chromium page; `WebContentsView` displays a WebContents; `BrowserWindow` joins those pieces with coordinated lifecycle behavior. When investigating a UI problem, first identify whether it belongs to the native window, the view hierarchy, or the page/navigation state.

## Ownership and closing

The native BrowserWindow constructor creates a WebContentsView, retains its WebContents, observes it, and associates it with the native owner window. It inserts the primary web view behind the BaseWindow content view, so additional content-view children paint over it. The JavaScript wrapper establishes BaseWindow inheritance and forwards focus/blur to application events.

BrowserWindow coordinates native and page destruction. Clicking close first attempts to close the web page, dispatching `beforeunload` when required. A cancelled unload cancels the window close. Once its WebContents is destroyed, BrowserWindow closes immediately; direct native wrapper destruction also destroys surviving web contents.

With a manually composed BaseWindow, closing the window does **not** automatically close the WebContents of attached WebContentsViews. Explicitly close those contents when finished, as the [BaseWindow resource-management contract](../../docs/api/base-window.md#resource-management) explains. The native WebContentsView destructor has a cleanup fallback, but it is not a substitute for managing the page's lifetime when the containing window closes.

For platform presentation issues, follow `shell/browser/native_window*` and `shell/browser/ui/`; the API wrappers in `lib/browser/api/` and `shell/browser/api/` connect application calls to those implementations.

## Loading and navigation completion

`WebContents.loadURL` installs completion listeners **before** invoking native `_loadURL`, returning a promise for that load. Its `_awaitNextLoad` helper tracks main-frame navigation and removes all installed listeners on settlement.

The promise resolves on successful completion and rejects with an error containing `errno`, `code`, and `url` on failure. Starting another unrelated main-frame document navigation aborts the previous promise with `ERR_ABORTED`; same-document URL changes do not automatically count as that replacement. If loading stops or the contents is destroyed without a more specific failure, the helper supplies `ERR_FAILED`. A no-op rejection handler suppresses an unhandled-rejection warning internally, but the returned promise still rejects for callers awaiting it.

Network selection and storage belong to the WebContents' [session](../concepts/sessions-and-networking.md). Frame identity also matters for [IPC dispatch](ipc-and-message-ports.md); a window is not a permanent proxy for a particular render frame.

## Child windows and opener policy

`setWindowOpenHandler` is the main-process interception point. Its response must be an object with `action: 'allow'` or `'deny'`; malformed responses deny creation and log an error. An allow response can supply constructor overrides, a custom creation function, and `outlivesOpener`.

`guest-window-manager.ts` implements the resulting child-window creation. It reuses live windows with matching frame names, otherwise creates a BrowserWindow or calls the custom creator. If Chromium supplied guest web contents, a custom creator must return those same contents. Unless `outlivesOpener` is true, deletion of the opener's current render view destroys the child. Destruction removes frame-name tracking.

Preference merge order is deliberate: renderer-parsed features come first, then restrictive values inherited from the parent, then trusted main-process overrides. Renderer input cannot override inherited restrictions such as enabled context isolation or disabled Node integration. The main-process override has higher authority, so applications must not pass unvalidated renderer preferences into that slot.

## Embedded webviews

The `<webview>` guest path uses `guest-view-manager.ts`, separate from the child-window manager. It parses element preferences, inherits selected restrictive embedder settings and emits `will-attach-webview` before creating a guest. The application can edit those preferences or prevent attachment. The first successful attachment loads `src`; subsequent attachments do not repeat initial navigation. Guest events and host IPC are forwarded to the embedder through internal channels, and destruction cleans up guest tracking.

See [renderer security](../concepts/renderer-security.md) for preload and sandbox implications. These attachment and window-open hooks are policy boundaries, not merely presentation callbacks.

## Focused validation

`spec/api-web-contents-spec.ts` exercises load promises, interruption, bad URLs and unload cancellation. `spec/api-browser-window-spec.ts` covers window creation and lifecycle; `spec/api-web-contents-view-spec.ts` covers view behavior. Use these neighboring tests when changing ownership, and test cancellation/destruction as well as the successful load path.
