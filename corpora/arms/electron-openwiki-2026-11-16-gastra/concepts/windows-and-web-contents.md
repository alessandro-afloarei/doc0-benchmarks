---
type: concept
title: Windows, WebContents, and guest lifecycles
description: Ownership of native windows and page contents, navigation promises, close handling, child-window policy, and webview attachment boundaries.
tags: [windows, web-contents, navigation, guests, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-b5a72c5fec66e3a7a6ec16c2
    resource: repo://docs/api/base-window.md
  - id: openwiki-source-e14ed5e3704652dc0067b09f
    resource: repo://lib/browser/api/browser-window.ts
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-5c4b3547e5f4ed54e10f671a
    resource: repo://lib/browser/guest-view-manager.ts
  - id: openwiki-source-17814a035fd19191252adbb4
    resource: repo://lib/browser/guest-window-manager.ts
  - id: openwiki-source-4eda8a1b2c13c32d30ea74c8
    resource: repo://shell/browser/api/electron_api_browser_window.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Windows, WebContents, and guest lifecycles

BrowserWindow combines desktop window behavior with page contents. BaseWindow is the more general native-window container, while WebContents owns the page-facing APIs and navigation events. Keep those responsibilities distinct when debugging a visible window whose renderer has already failed or been destroyed.

## Ownership and presentation

The native BrowserWindow creates a WebContentsView, retains its WebContents wrapper, observes it, and associates it with the owner window. It installs the page's view beneath the BaseWindow content view so additional child views paint above it. If BrowserWindow is destroyed directly, its destructor destroys the remaining contents; if its WebContents is destroyed first, it closes the native window immediately.

The JavaScript wrapper extends BaseWindow behavior and forwards loadURL, loadFile, reload, send, DevTools and other page operations to WebContents. It preserves a fixed window ID for access after destruction, forwards focus/blur to app, and derives page visibility from visible-and-not-minimized state.

BaseWindow with manually attached WebContentsViews has a different ownership obligation: its API guide explicitly requires callers to close those contents when no longer needed. Closing the BaseWindow alone does not perform BrowserWindow's automatic contents cleanup. See [BaseWindow resource management](../../docs/api/base-window.md).

## Loading is an observed lifecycle

WebContents.loadFile resolves a supplied path against app.getAppPath and formats a file URL. loadURL installs completion listeners before invoking native _loadURL and returns the resulting promise.

The promise tracks main-frame navigation, finish, failure, same-document navigation, stopped loading, and destruction. A second unrelated main-frame navigation rejects the previous load with ERR_ABORTED; same-document transitions are handled separately. A stop without an explicit result becomes ERR_FAILED. Completion removes every listener installed for that load.

The wrapper adds a no-op catch to suppress unhandled-rejection noise, but still returns the original promise. Callers awaiting it continue to observe rejection. This distinction is useful when a load fails silently in an application that ignores the promise.

## Closing and destruction

A close-button request first attempts to close the page: native code marks the request handled, supplies user activation, and dispatches beforeunload when required. Beforeunload cancellation notifies WindowList, which also affects application quitting. Destruction skips this conversational close path.

The JavaScript wrapper delays unresponsive reporting, cancels pending timers when responsiveness returns or contents are destroyed, and starts a longer timeout while a noncancelled close is pending. A close request, a closed window, and destroyed contents therefore represent different points in the lifecycle.

## Child windows and policy precedence

window.open flows through WebContents' registered window-open handler and the guest-window manager. A deny response cancels creation. Invalid or null handler responses also cancel and log an error. An allow response can provide constructor overrides, an outlivesOpener flag, and a custom createWindow function. With no handler, the wrapper returns its default response without cancelling.

The manager parses feature strings, combines options, and reuses existing named guest contents when available. A custom createWindow must return the supplied guest WebContents when one was supplied by Chromium; returning different contents throws.

Preference precedence is deliberate: renderer-parsed preferences come first, inherited secure parent values overwrite them, and trusted main-process overrides come last. Main-process overrides can therefore change values the renderer feature string cannot loosen. Review that last layer when changing [renderer isolation](renderer-isolation.md).

Unless outlivesOpener is true, deletion of the opener's current render view destroys the child guest. Child destruction removes the corresponding opener listener; named entries are removed on guest destruction.

## Webview guests are another path

The guest-view manager uses internal IPC and requires webviewTag on the sending frame's WebContents. Before creation it emits will-attach-webview with mutable preferences and parameters; cancellation returns without creating a guest. Successful creation makes a WebContents of type webview and attaches it to the embedder frame. The manager tracks guest/element relationships, forwards events and visibility, and detaches associated guests when the embedder is being destroyed.

Do not confuse these embedded guests with window.open children: both use the word guest, but their attachment and lifetime mechanisms differ.

## Verification route

[BrowserWindow specs](../../spec/api-browser-window-spec.ts) cover close/destruction, navigation and visibility; [guest-window-manager specs](../../spec/guest-window-manager-spec.ts) exercise option policy. Start with those boundaries when changing ownership. [IPC](ipc.md) explains frame-specific message routing, and [Session networking](sessions-and-networking.md) explains the storage and protocol context behind a WebContents.
