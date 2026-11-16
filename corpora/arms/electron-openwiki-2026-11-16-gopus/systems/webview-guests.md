---
type: system
title: The webview tag and guest views
description: How Electron's <webview> works — a custom element with a shadow-root iframe defined in the embedder's main world, internal IPC to guest-view-manager.ts which creates a guest WebContents and attaches it as an inner WebContents of that iframe, inherited security preferences, allowlisted method/property proxying, event forwarding, and lifetime management.
tags: [webview, guest-view, renderer, security, ipc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-5c4b3547e5f4ed54e10f671a
    resource: repo://lib/browser/guest-view-manager.ts
  - id: openwiki-source-5975defae2ba332493c5b56a
    resource: repo://lib/browser/web-view-events.ts
  - id: openwiki-source-60890bc56818c3917ff2885f
    resource: repo://lib/common/web-view-methods.ts
  - id: openwiki-source-1842fcb4320c014e992600b5
    resource: repo://lib/renderer/common-init.ts
  - id: openwiki-source-ebba03cf65fc852497630eb6
    resource: repo://lib/renderer/web-view/guest-view-internal.ts
  - id: openwiki-source-6bae95fe18e68b6932bf7ac8
    resource: repo://lib/renderer/web-view/web-view-element.ts
  - id: openwiki-source-a425fc1d0d9ec4c800c5d8c1
    resource: repo://lib/renderer/web-view/web-view-impl.ts
  - id: openwiki-source-82d07c4533273541b47f262b
    resource: repo://lib/renderer/web-view/web-view-init.ts
  - id: openwiki-source-0408a4a96de79cfcf5059185
    resource: repo://shell/browser/web_view_guest_delegate.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# The `<webview>` tag and guest views

`<webview>` embeds a separate page (a *guest* `WebContents`) inside an
*embedder* page. It is disabled unless the embedder's `webPreferences` set
`webviewTag: true`. The implementation spans the embedder renderer, the main
process, and Chromium's inner-WebContents support.

## Renderer side (embedder)

### Registering the element

`lib/renderer/web-view/web-view-init.ts` runs during renderer init. If
`webviewTag` is on and this page is not itself a guest (nested `<webview>`
is not allowed), it loads `guest-view-internal`. Custom elements must be
defined in the page's **main world**:

- without context isolation it calls `setupWebView` directly;
- with context isolation it stores `guestViewInternal` as a hidden value, and
  `RendererClientBase::SetupMainWorldOverrides` runs the
  `isolated_bundle` (`lib/isolated_renderer/init.ts`) in the main world,
  passing the hooks across the context bridge (see
  [Renderer processes, sandboxing and context isolation](../architecture/renderer-processes-and-sandboxing.md)).

`lib/renderer/web-view/web-view-element.ts` defines `WebViewElement extends
HTMLElement` and registers it as `webview` inside
`allowGuestViewElementDefinition` (a native helper that permits the
definition). After registration it deletes the lifecycle callbacks and
`observedAttributes` from the prototype so page script cannot call or
inspect them.

### The element implementation

`WebViewImpl` (`lib/renderer/web-view/web-view-impl.ts`):

- attaches an open shadow root containing an internal `<iframe>`; the iframe
  is flagged via `setIsWebView` — this is what `IsWebViewFrame` checks so no
  preload/Node is injected into it;
- maps attributes (`src`, `partition`, `preload`, `nodeintegration`,
  `allowpopups`, `webpreferences`, `useragent`, `httpreferrer`, …) through
  `web-view-attributes.ts`;
- on attach calls `guestViewInternal.createGuest(iframe, elementInstanceId,
  params)`, which invokes `GUEST_VIEW_MANAGER_CREATE_AND_ATTACH_GUEST` with
  the iframe's **frame token**;
- exposes `WebContents`-like methods (`getURL`, `reload`, `executeJavaScript`,
  `send`, `loadURL`, …) generated from `lib/common/web-view-methods.ts`, each
  forwarded with `GUEST_VIEW_MANAGER_CALL` (async or sync) or
  `GUEST_VIEW_MANAGER_PROPERTY_GET/SET`;
- receives events on the internal channel
  `GUEST_VIEW_INTERNAL_DISPATCH_EVENT-<viewInstanceId>` and re-dispatches
  them as DOM events on the element.

## Main process: `lib/browser/guest-view-manager.ts`

Loaded at startup by `lib/browser/init.ts`. Every handler is wrapped by
`makeSafeHandler`, which accepts only frame senders and throws
`<webview> disabled` if the sender's last `webPreferences` lacks
`webviewTag`.

### Creating a guest

`createGuest(embedder, embedderFrameToken, elementInstanceId, params)`:

1. **Builds webPreferences** from attributes (`nodeintegration`,
   `nodeintegrationinsubframes`, `plugins`, `allowpopups` →
   `disablePopups`, `disablewebsecurity`, blink features, `partition`,
   `preload` converted from a `file:` URL, and the `webpreferences` string
   parsed like `window.open` features). Then **security inheritance**: if the
   embedder has `contextIsolation: true`, `javascript: false`,
   `nodeIntegration: false`, `sandbox: true`,
   `nodeIntegrationInSubFrames: false` or `enableWebSQL: false`, the guest is
   forced to the same value — a guest can never be less restricted than its
   embedder on these axes.
2. Emits **`will-attach-webview`** on the embedder with the mutable
   `webPreferences` and params; `preventDefault()` aborts (returns `-1`).
   This is the main hook apps use to strip preloads or validate `src`.
3. Creates the guest via `webContents.create({ ...webPreferences,
   type: 'webview', embedder })`.
4. On first `did-attach`, loads `src` (with referrer/user agent) and emits
   **`did-attach-webview`** on the embedder.
5. Forwards each event listed in `lib/browser/web-view-events.ts` (with
   argument names mapping to DOM event properties), plus guest
   `sendToHost` messages (`ipc-message`) and `will-frame-navigate`, to the
   embedder.
6. If the same element already had a guest, detaches it from its outer frame.
7. Registers the guest with the native `WebViewManager` and calls
   `guest.attachToIframe(embedder, embedderFrameToken)`.

### Proxying calls safely

`getGuestForWebContents` verifies the guest exists and that its
`hostWebContents` is the calling embedder (`Access denied to guestInstanceId`
otherwise). Methods and properties must be in the allowlists from
`web-view-methods.ts` (`Invalid method`/`Invalid property` otherwise);
history methods are redirected to `webContents.navigationHistory`.

### Lifetime

- Guest `destroyed` → `detachGuest` removes it from maps and `WebViewManager`.
- Embedder `will-destroy` → detaches all its guests; window visibility changes
  of the embedder are forwarded to guests
  (`GUEST_INSTANCE_VISIBILITY_CHANGE`).
- `GUEST_VIEW_MANAGER_FOCUS_CHANGE` from the guest page emits `-focus-change`.

## Native side

- `WebContents::AttachToIframe` → `WebViewGuestDelegate::AttachToIframe`
  (`shell/browser/web_view_guest_delegate.cc`) resolves the embedder frame
  from its token and calls Chromium's
  `WebContents::AttachInnerWebContents`, so the guest renders inside the
  embedder iframe as a true inner WebContents (out-of-process). It also links
  the guest's zoom controller to the embedder's so zoom follows the embedder.
- `WebViewManager` (`shell/browser/web_view_manager.cc`) is the browser
  context's guest registry (add/remove/iterate guests) used by Chromium's
  guest-view hooks.

## Related

- Internal IPC mechanics: [IPC between main and renderer](ipc.md).
- `WebContents`, window.open and views:
  [Windows, views and WebContents](windows-and-web-contents.md).
- Tests: `spec/webview-spec.ts`.
