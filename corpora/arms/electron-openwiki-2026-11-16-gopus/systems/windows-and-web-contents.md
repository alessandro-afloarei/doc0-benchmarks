---
type: system
title: Windows, views and WebContents
description: How Electron's window and page objects are layered — BaseWindow over platform NativeWindow implementations, BrowserWindow as BaseWindow plus a WebContentsView, the View tree, the WebContents API wrapper and its session/type selection, WebFrameMain identity across frame swaps, the close/destroy lifecycle and WindowList, and window.open handling via setWindowOpenHandler and guest-window-manager.
tags: [browser-window, base-window, web-contents, views, window-open, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-3da1fe8dec5a72cb4c5bfde6
    resource: repo://lib/browser/api/browser-view.ts
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-17814a035fd19191252adbb4
    resource: repo://lib/browser/guest-window-manager.ts
  - id: openwiki-source-a18b21a4de8ba6a29d39ffdd
    resource: repo://shell/browser/api/electron_api_base_window.cc
  - id: openwiki-source-4eda8a1b2c13c32d30ea74c8
    resource: repo://shell/browser/api/electron_api_browser_window.cc
  - id: openwiki-source-5b1886b47cac8ce9671914c6
    resource: repo://shell/browser/api/electron_api_web_contents.cc
  - id: openwiki-source-05a1be396e6a26d718e839a0
    resource: repo://shell/browser/api/electron_api_web_frame_main.cc
  - id: openwiki-source-0ee6d56d164b00df4e86177b
    resource: repo://shell/browser/native_window_mac.mm
  - id: openwiki-source-552f048e007fd908814d9f45
    resource: repo://shell/browser/native_window_views.cc
  - id: openwiki-source-0e89648f0c675d0e1b610537
    resource: repo://shell/browser/native_window.cc
  - id: openwiki-source-dc8366e6bb3e0f5912abd876
    resource: repo://shell/browser/window_list.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Windows, views and WebContents

## Object layering

```
BaseWindow (JS + api::BaseWindow, TrackableObject)
  └─ NativeWindow (abstract)  ── NativeWindowViews (Windows/Linux, //ui/views)
                               └─ NativeWindowMac   (macOS, Cocoa)
     └─ contentView: View tree (api::View wraps views::View)
BrowserWindow = BaseWindow + one WebContentsView holding a WebContents
WebContentsView = View hosting an api::WebContents
WebContents ── WebFrameMain (per frame) ── renderer frames
```

- `BaseWindow` (`shell/browser/api/electron_api_base_window.cc`,
  `lib/browser/api/base-window.ts`) creates the platform window with
  `NativeWindow::Create(options, parent)` — implemented once in
  `native_window_views.cc` and once in `native_window_mac.mm` — and gives it
  an empty `View` as its content view. It observes the `NativeWindow` and
  surfaces events (`resize`, `focus`, `close`, `closed`, …).
- `NativeWindow` (`shell/browser/native_window.cc`) holds cross-platform
  state: options like `transparent`, parent/child relationships and `modal`
  (only meaningful with a parent), size constraints, draggable regions, and
  observers.
- `View` (`shell/browser/api/electron_api_view.cc`) exposes
  `addChildView`, `removeChildView`, `setBounds`, `setBackgroundColor`,
  `setBorderRadius`, `setLayout`, `setVisible`. `WebContentsView`
  (`electron_api_web_contents_view.cc`) is a `View` that hosts a
  `WebContents`.
- `BrowserView` is now a JS shim (`lib/browser/api/browser-view.ts`)
  implemented on top of `WebContentsView`.

## BrowserWindow

`BrowserWindow::BrowserWindow` (`shell/browser/api/electron_api_browser_window.cc`):

1. Reads `webPreferences` from the options and copies `backgroundColor` into
   it (transparent windows default the page background to transparent), the
   `show` state when `paintWhenInitiallyHidden: false`, and an optional
   existing `webContents` (used by `window.open`).
2. Creates a `WebContentsView` with those preferences, registers it as a
   draggable-region provider, and keeps references to the view and its
   `WebContents`; sets the window as the WebContents' owner window.
3. Runs `BaseWindow` JS initialisation, then inserts the WebContentsView at
   index 0 of the window's root contents view — **beneath** the
   `contentView`, so views the app adds to `win.contentView` paint on top of
   the page.
4. Calls `InitFromOptions` on the native window.

Page-driven behavior is mirrored: `window.resizeTo/moveTo` set bounds;
`page-title-updated` sets the title unless prevented.

## WebContents

`api::WebContents` (`shell/browser/api/electron_api_web_contents.cc`,
`lib/browser/api/web-contents.ts`) wraps `content::WebContents` and is the
largest API object. Key points:

- **Type**: `kBrowserWindow`, `kBrowserView`, `kWebView`, `kRemote` (wrapping an
  existing contents), `kOffScreen`, `kBackgroundPage`. `webPreferences.offscreen`
  (boolean or `{ useSharedTexture }`) selects off-screen rendering
  (`shell/browser/osr/`).
- **Session**: from `options.session`, else `options.partition` via
  `Session::FromPartition`, else the default session — see
  [Sessions, protocols and networking](sessions-protocols-and-networking.md).
- Guests (`<webview>`) get a `WebViewGuestDelegate` and a fake
  `chrome-guest://` site instance — see
  [The webview tag and guest views](webview-guests.md).
- `webPreferences` are attached as `WebContentsPreferences`, which configures
  the renderer ([Renderer processes, sandboxing and context isolation](../architecture/renderer-processes-and-sandboxing.md)).
- Messaging: `send`, `postMessage`, `_sendInternal` delegate to
  `mainFrame` (a `WebFrameMain`); `sendToFrame` targets a specific frame
  ([IPC between main and renderer](ipc.md)).

### WebFrameMain identity

`WebFrameMain` (`shell/browser/api/electron_api_web_frame_main.cc`) represents
a frame by **FrameTreeNode id**, not by `RenderFrameHost`. On cross-origin
navigation Chromium swaps the RFH under the same FrameTreeNode;
`UpdateRenderFrameHost` rebinds the existing `WebFrameMain` to the new RFH and
re-establishes its Mojo connection, so JS references stay valid. An RFH
running unload handlers is treated as *detached*. Once disposed, accessing the
frame throws `Render frame was disposed before WebFrameMain could be
accessed`. IPC dispatch looks frames up by FrameTreeNode id for the same
reason.

## Close and destroy lifecycle

Closing via the title bar or `win.close()`:

1. `NativeWindow::NotifyWindowCloseButtonClicked` asks observers
   `WillCloseWindow` — `BaseWindow` emits **`close`**; `preventDefault()`
   cancels and notifies `WindowList::WindowCloseCancelled` (which also
   cancels an in-progress `app.quit()`).
2. `BrowserWindow::OnCloseButtonClicked` does not close the window directly.
   It dispatches the page's `beforeunload` (after granting user activation so
   the handler can run) or closes the WebContents. If `beforeunload` cancels,
   `BeforeUnloadDialogCancelled` reports the cancellation.
3. When the WebContents is destroyed, `BrowserWindow::WebContentsDestroyed`
   calls `CloseImmediately()`.
4. `NativeWindow::NotifyWindowClosed` (once) notifies `OnWindowClosed` and
   removes the window from `WindowList`. `BaseWindow::OnWindowClosed`
   invalidates weak pointers, removes itself from the weak map, **marks the JS
   object destroyed**, emits **`closed`**, detaches from its parent, and posts
   a task to delete the native object.

`win.destroy()` skips `close`/`beforeunload`. `WindowList`
(`shell/browser/window_list.cc`) tracks all native windows; when the last is
removed it notifies `OnWindowAllClosed`, which drives `window-all-closed` /
quit — see the lifecycle in
[Process model and main-process startup](../architecture/process-model-and-startup.md).
`CloseAllWindows` and `DestroyAllWindows` back `app.quit()` and `app.exit()`.

## window.open and target=_blank

Requests for new windows arrive as `-will-add-new-contents` (renderer
`window.open`) and `-add-new-contents` / `OpenURLFromTab` paths, handled in
`lib/browser/api/web-contents.ts`:

1. `_callWindowOpenHandler` invokes the app's `setWindowOpenHandler`. Return
   `{ action: 'deny' }` to block; `{ action: 'allow',
   overrideBrowserWindowOptions, outlivesOpener, createWindow }` to allow.
   Any malformed response (non-object, null, unknown action) is logged and
   treated as **deny**. Without a handler, the default is allow.
2. `makeWebPreferences` (`lib/browser/guest-window-manager.ts`) merges:
   features parsed from the `window.open` string (untrusted), then
   **security preferences inherited from the opener** when the opener has
   them in their restrictive state (`contextIsolation: true`,
   `javascript: false`, `nodeIntegration: false`, `sandbox: true`,
   `webviewTag: false`, `nodeIntegrationInSubFrames: false`,
   `enableWebSQL: false`), then the main-process overrides. A renderer can
   therefore never loosen these through the features string; only the main
   process can.
3. `openGuestWindow` builds options (default `800×600`, `show: true`), reuses
   an existing window with the same frame name (navigating it instead), then
   either calls the app's `createWindow` (which must return a window wrapping
   the provided guest `webContents`) or constructs a `BrowserWindow`. It
   emits **`did-create-window`** on the opener.
4. Unless `outlivesOpener` is true, the child is destroyed when the opener's
   render view is deleted (an Electron convention, not browser behavior).

`lib/browser/parse-features-string.ts` implements feature-string parsing shared
with `<webview webpreferences>`.

## Tests

`spec/api-browser-window-spec.ts`,
`spec/api-web-contents-spec.ts`, `spec/api-web-contents-view-spec.ts`,
`spec/api-web-frame-main-spec.ts`, `spec/guest-window-manager-spec.ts`.
