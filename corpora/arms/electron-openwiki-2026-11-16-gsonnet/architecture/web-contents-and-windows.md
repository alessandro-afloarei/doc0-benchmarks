---
type: architecture
title: WebContents, Windows and Views
description: How the WebContents API object wraps Chromium's content::WebContents, how BrowserWindow/BaseWindow, WebContentsView and View compose a native window with platform backends, and how window.open, popups and <webview> guests are created and governed.
tags: [webcontents, browserwindow, views, nativewindow, webview, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-3da1fe8dec5a72cb4c5bfde6
    resource: repo://lib/browser/api/browser-view.ts
  - id: openwiki-source-e14ed5e3704652dc0067b09f
    resource: repo://lib/browser/api/browser-window.ts
  - id: openwiki-source-acb3e8b6a88c7d87c1d9d06b
    resource: repo://lib/browser/api/view.ts
  - id: openwiki-source-96c83d13d2ca18d314c1fc6e
    resource: repo://lib/browser/api/web-contents-view.ts
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-5c4b3547e5f4ed54e10f671a
    resource: repo://lib/browser/guest-view-manager.ts
  - id: openwiki-source-17814a035fd19191252adbb4
    resource: repo://lib/browser/guest-window-manager.ts
  - id: openwiki-source-a18b21a4de8ba6a29d39ffdd
    resource: repo://shell/browser/api/electron_api_base_window.cc
  - id: openwiki-source-4eda8a1b2c13c32d30ea74c8
    resource: repo://shell/browser/api/electron_api_browser_window.cc
  - id: openwiki-source-5b1886b47cac8ce9671914c6
    resource: repo://shell/browser/api/electron_api_web_contents.cc
  - id: openwiki-source-0ee6d56d164b00df4e86177b
    resource: repo://shell/browser/native_window_mac.mm
  - id: openwiki-source-552f048e007fd908814d9f45
    resource: repo://shell/browser/native_window_views.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# WebContents, Windows and Views

<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The page-rendering surface in Electron is `WebContents`; the OS window around it is `BaseWindow`/`BrowserWindow`; the layer joining them is the `View` tree, whose leaf for web content is `WebContentsView`. All are JS-visible objects backed by C++ classes in `shell/browser/api/` ([how bindings work](/openwiki/architecture/native-api-bindings.md)), with TypeScript behavior in `lib/browser/api/`.

## Object relationships

```
BrowserWindow (JS)  extends  BaseWindow (JS)
   |                              |
   |                              +-- NativeWindow  (C++: NativeWindowMac | NativeWindowViews)
   |                                     +-- contents view (views::View root; child Views)
   +-- WebContentsView  (a View)  --- owns --- WebContents (api) --- content::WebContents
```

- **`View`** (`lib/browser/api/view.ts`, `electron_api_view.cc`) is the base of the view tree; its JS prototype is an `EventEmitter`. `WebContentsView` (`web-contents-view.ts`, `electron_api_web_contents_view.cc`) subclasses it and exposes a `webContents`. `ImageView` and `BaseWindow.contentView` are other views.
- **`BaseWindow`** (`lib/browser/api/base-window.ts`, `electron_api_base_window.cc`) is a window with no web content of its own. It creates a `NativeWindow` with `NativeWindow::Create(options, parent)` and provides window methods and properties (many JS accessors like `fullScreen`, `kiosk` map to getter/setter pairs). On non-macOS platforms its `_init` copies the application menu onto the window.
- **`BrowserWindow`** (`browser-window.ts`, `electron_api_browser_window.cc`) sets its prototype to `BaseWindow`'s. The C++ constructor creates a `WebContentsView` from the `webPreferences`, remembers its `WebContents`, registers as an observer, calls `SetOwnerWindow`, and installs the view as a sibling placed *before* `BaseWindow.contentView` in paint order, so extra views added to `contentView` draw on top of the page. `WebContentsDestroyed` makes the window close immediately. The JS `_init` redirects `focus`/`blur` to `app` events, emits `unresponsive`/`responsive` with debouncing (a 50 ms delay, or 5 s after a `close` that wasn't prevented), forwards visibility changes to the renderer, and emits `app` `browser-window-created`.
- **`BrowserView`** (`browser-view.ts`) is a legacy class implemented on top of `WebContentsView`, with a `#webContentsView`, owner window tracking, and auto-resize emulation.

## NativeWindow platform backends

`NativeWindow` (`shell/browser/native_window.h`) is the abstract platform interface (show/hide, bounds, fullscreen, content view, menus, etc., with `SupportsUserData`). `NativeWindow::Create` is defined once per backend: `NativeWindowMac` in `native_window_mac.mm` (Cocoa, with helper classes in `shell/browser/ui/cocoa/`: window delegate, panel, touch bar, window buttons) and `NativeWindowViews` in `native_window_views.cc` for Windows and Linux (Chromium Views; `ui/views/` contains frame views, the menu bar and Linux global menu, caption buttons). The build selects the implementation per platform, so each platform uses exactly one concrete class. Window observers (`NativeWindowObserver`) turn native events into JS events on `BaseWindow`.

## WebContents

`api::WebContents` (`electron_api_web_contents.cc`, ~4.7k lines) wraps `content::WebContents`, observes it (navigation, frames, console, devtools), implements Chromium's `WebContentsDelegate`, and is a `TrackableObject` so it can be found by id. JS-level behavior is layered by `lib/browser/api/web-contents.ts`.

Creation: the constructor picks a session (`session`, else `partition`, else the default session), then builds a `content::WebContents` in one of three modes, depending on `type`:

- **guest** (`<webview>`): a `SiteInstance` for the fake `chrome-guest://fake-host`, a `WebViewGuestDelegate`, and an offscreen view if the embedder is offscreen;
- **offscreen**: an `OffScreenWebContentsView` painting to a callback (`osr/`), with a transparent background computed from the window's background color;
- **normal**: plain `content::WebContents::Create`, hidden initially if `show: false`.

Teardown: `Destroy()` posts the deletion asynchronously (the user may destroy a WebContents from inside one of its own events) except during browser shutdown or for guests. `Close({waitForBeforeUnload})` either dispatches `beforeunload` or closes directly.

<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`WebContents.prototype._init` in TypeScript sets a read-only `id` (readable after destruction), a per-contents `ipc` (`IpcMainImpl`, see [IPC](/openwiki/architecture/ipc.md)), the `navigationHistory` helper, the window-open handler slot, and wiring for new-window events. It also deprecation-logs the old sandbox default for preload-with-no-nodeIntegration windows.

## webPreferences

<!-- openwiki: broken internal link [/openwiki/architecture/renderer-preload-and-isolation.md] link "/openwiki/architecture/renderer-preload-and-isolation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`WebContentsPreferences` (`shell/browser/web_contents_preferences.cc`) is a `WebContentsUserData` that stores parsed `webPreferences` (node integration flags, `sandbox`, `contextIsolation`, `webviewTag`, preload, fonts, zoom, `enableBlinkFeatures`, ...). It computes renderer command-line switches (including the sandbox decision, see [renderer and isolation](/openwiki/architecture/renderer-preload-and-isolation.md)), feeds Blink preferences, and exposes `getLastWebPreferences()` to JS. For child windows the next `webPreferences` are set with `_setNextChildWebPreferences`.

## window.open, popups and navigation

New windows requested by a page flow through two C++ hooks that emit JS events:

1. `OpenURLFromTab` and `WebContentsCreatedWithFullParams` emit `-new-window` and `-will-add-new-contents` with url, frame name, features, referrer, disposition and POST body.
2. `AddNewContents` (when Chromium has actually created the new contents, e.g. same-process popups) wraps it as a new `api::WebContents` (type `kBrowserWindow` or `kOffScreen`), manually runs `HandleNewRenderFrame` for the initial `about:blank` frame so background color and similar prefs apply, and emits `-add-new-contents`; if a listener returns true the new contents is destroyed.

`lib/browser/api/web-contents.ts` handles those events. `setWindowOpenHandler(handler)` stores `_windowOpenHandler`; `_callWindowOpenHandler` validates the result: a non-object or `null` logs an error and prevents the default, `{ action: 'deny' }` prevents it, and `{ action: 'allow' }` can supply `overrideBrowserWindowOptions`, `outlivesOpener` and a custom `createWindow` factory. `-will-add-new-contents` merges feature-string preferences (parsed by `parseFeatures`) with the handler's overrides into secure web preferences via `makeWebPreferences`, so a page cannot grant itself extra privileges through feature strings; handler overrides win. Then `openGuestWindow` in `lib/browser/guest-window-manager.ts` creates or reuses the child window: default `show: true, width: 800, height: 600`, a repeated `window.open` with the same frame name navigates the existing window instead, and a `createWindow` hook can build a custom host. With no handler registered, the default allows the window to open.

## `<webview>` guests

<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`lib/browser/guest-view-manager.ts` (loaded early in `lib/browser/init.ts`) services the renderer's `<webview>` element through internal IPC (`GUEST_VIEW_MANAGER_*` messages, see [IPC](/openwiki/architecture/ipc.md)):

- `createGuest` builds guest preferences from element attributes (including the `webpreferences` string and `preload` via a file URL) and then forces **inheritance of security-relevant preferences** from the embedder: where the embedder has `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInSubFrames: false`, `enableWebSQL: false` or `javascript: false`, the guest gets the same value. The embedder can veto with `will-attach-webview` (calling `preventDefault`) and may mutate the preferences first.
- The guest `WebContents` is created with `type: 'webview'`; it is tracked in `guestInstances`, auto-detached on `destroyed`, and an older guest in the same element slot is detached when a new one attaches. Guest events listed in `web-view-events.ts` and `-ipc-message-host` messages are forwarded to the embedder over internal IPC, and `did-attach-webview` fires after the first attach loads `src`.
- The native `web_view_manager` and `WebViewGuestDelegate` finish attachment on the Chromium side.

## Tests

<!-- openwiki: broken internal link [/openwiki/architecture/sessions-protocols-and-network.md] link "/openwiki/architecture/sessions-protocols-and-network.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`spec/api-browser-window-spec.ts`, `spec/api-web-contents-spec.ts`, `spec/api-web-contents-view-spec.ts`, `spec/api-view-spec.ts`, `spec/api-browser-view-spec.ts`, `spec/guest-window-manager-spec.ts`, `spec/parse-features-string-spec.ts` and `spec/webview-spec.ts` cover these behaviors. For sessions that a `WebContents` belongs to, see [sessions, protocols and network](/openwiki/architecture/sessions-protocols-and-network.md).
