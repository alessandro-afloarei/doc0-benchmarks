---
type: architecture
title: Windows, WebContents, and navigation
description: Ownership and lifecycle of Electron windows and embedded pages, including asynchronous navigation and new-window policy.
tags: [windows, webcontents, navigation, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-b5a72c5fec66e3a7a6ec16c2
    resource: repo://docs/api/base-window.md
  - id: openwiki-source-e14ed5e3704652dc0067b09f
    resource: repo://lib/browser/api/browser-window.ts
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-17814a035fd19191252adbb4
    resource: repo://lib/browser/guest-window-manager.ts
  - id: openwiki-source-4eda8a1b2c13c32d30ea74c8
    resource: repo://shell/browser/api/electron_api_browser_window.cc
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Windows, WebContents, and navigation

A native window, its view hierarchy, and a Chromium page have related but distinct responsibilities. `BaseWindow` manages a top-level native window. `WebContentsView` presents a `WebContents`. `BrowserWindow` assembles both into the familiar application window.

## Ownership and event forwarding

The native BrowserWindow constructor creates a WebContentsView, retains its WebContents, observes it, assigns its owner window, and inserts the view beneath the window's other content views. Its destructor destroys surviving owned contents; a WebContents destruction callback closes the window immediately.

The TypeScript wrapper inherits from BaseWindow and adds application-level focus/blur forwarding, visibility tracking, and unresponsive-event timing. Methods such as `loadURL`, `loadFile`, and `reload` delegate to the underlying WebContents. A navigation defect can therefore originate below the window wrapper.

With a manually composed BaseWindow, closing the window does not automatically destroy the WebContents of child WebContentsViews. The application must close those contents when finished. The [BaseWindow ownership guide](../../docs/api/base-window.md#resource-management) describes this lifecycle obligation; [WebContentsView](../../docs/api/web-contents-view.md) documents adoption of existing contents.

## Navigation is an event-driven operation

`WebContents.loadURL` first attaches temporary listeners through `_awaitNextLoad`, invokes native `_loadURL`, and returns the resulting promise. Installing listeners before starting the native operation avoids missing early completion events.

The promise tracks main-frame navigation and failure:

- A successful finish resolves after listener cleanup.
- A second unrelated main-frame navigation rejects the earlier operation with `ERR_ABORTED`; same-document URL changes receive separate handling.
- Main-frame load failure records the error; loading stopping or contents destruction settles the operation, synthesizing `ERR_FAILED` if no more specific error was recorded.

The wrapper attaches a no-op rejection handler to prevent an unhandled-rejection report, but returns the original promise. Callers can still await it and handle the failure. Use navigation events when diagnosing the underlying sequence rather than assuming every stopped load succeeded.

## Opening child windows

`setWindowOpenHandler` installs the main-process decision point. The handler must return an object with `action: 'allow'` or `action: 'deny'`. Invalid responses log an error and prevent opening. An allow response may provide constructor overrides, `outlivesOpener`, or a custom `createWindow` function.

The guest-window manager parses window features, applies main-process overrides, and reuses live named windows. Otherwise it creates a BrowserWindow around supplied guest contents or invokes the custom creator. A custom creator must return the supplied guest WebContents when one was provided.

Guest lifetime normally follows the opener's current render view. Setting `outlivesOpener` changes that relationship. Named-window registrations are removed when the guest is destroyed. Child preference construction also carries security-sensitive parent settings; inspect `makeWebPreferences` before changing feature parsing or inheritance.

## Focused investigation

The `loadURL() promise API` group in `spec/api-web-contents-spec.ts` exercises navigation settlement. `spec/api-browser-window-spec.ts` separates close, destroy, and load behavior. For API detail see [WebContents](../../docs/api/web-contents.md) and [BrowserWindow](../../docs/api/browser-window.md).

Continue with [sessions and networking](../concepts/sessions-and-networking.md) for shared storage and protocol scope, [preload isolation and IPC](../concepts/preload-isolation-and-ipc.md) for renderer privileges, and [runtime bootstrap](runtime-and-bootstrap.md) for application launch ordering.
