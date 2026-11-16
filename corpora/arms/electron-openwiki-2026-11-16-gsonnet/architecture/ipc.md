---
type: architecture
title: "IPC: ipcMain, ipcRenderer, MessagePorts"
description: End-to-end explanation of how renderer-to-main messages travel from ipcRenderer through a Mojo interface and a C++ handler into the main-process JS dispatcher, including invoke/handle, sendSync, internal channels, MessagePorts and service-worker IPC.
tags: [ipc, mojo, ipcMain, ipcRenderer, messageport, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-658915cd01ee88f6d82a9f53
    resource: repo://lib/browser/api/ipc-main.ts
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-82445f655ec5988c40e35cfd
    resource: repo://lib/browser/ipc-main-internal.ts
  - id: openwiki-source-90a1c3c767c21f6343b965a7
    resource: repo://lib/renderer/api/ipc-renderer.ts
  - id: openwiki-source-ba257208a7ff536a8e71e17e
    resource: repo://lib/renderer/ipc-renderer-bindings.ts
  - id: openwiki-source-bc1e3f5c0345fe73f82ff336
    resource: repo://shell/browser/api/ipc_dispatcher.h
  - id: openwiki-source-5e62dde8d8a08cd2251771e1
    resource: repo://shell/browser/electron_api_ipc_handler_impl.cc
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-c4c0bc4af5a5cdc4080ce7a1
    resource: repo://shell/common/api/api.mojom
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# IPC: ipcMain, ipcRenderer, MessagePorts

Electron's IPC is a thin JavaScript layer over a Chromium Mojo interface. A renderer call into `ipcRenderer` becomes a Mojo message to the browser process, a C++ handler turns it into an event on the owning `Session` object, and TypeScript in `lib/browser` fans it out to the right `ipcMain`-style emitters.

## Renderer side

- `lib/renderer/api/ipc-renderer.ts` defines the public `ipcRenderer` (an `EventEmitter`). Its `send`, `sendSync`, `sendToHost`, `invoke` and `postMessage` methods call a native object with an `internal = false` flag. `invoke` unwraps a `{ error, result }` reply and throws `Error("Error invoking remote method '<channel>': ...")` on error.
- `lib/renderer/ipc-renderer-bindings.ts` obtains the native object from the `electron_renderer_ipc` linked binding: `createForRenderFrame()` in a `renderer` process and `createForServiceWorker()` in a `service-worker` process. Other process types throw.
- `shell/renderer/api/electron_api_ipc_renderer.cc` implements those natives and calls the Mojo remote `ElectronApiIPC` (`Message`, `Invoke`, `MessageSync`, `ReceivePostMessage`, `MessageHost`).
- Messages arriving in the renderer from the browser go the other way through `shell/renderer/electron_ipc_native.cc`, which looks up an `ipcNative` object and calls its `onMessage` callback; `ipc-renderer-internal.ts` provides the internal-only variant used by Electron's own modules.

## The Mojo contract

`shell/common/api/api.mojom` declares two interfaces for this path:

- `ElectronApiIPC` (renderer to browser): `Message`, `Invoke` (returns a result), `MessageSync` (marked `[Sync]`), `ReceivePostMessage` (for MessagePort transfer) and `MessageHost` (used for `<webview>` host messaging via `sendToHost`).
- `ElectronRenderer` (browser to renderer): `Message`, `ReceivePostMessage`, `TakeHeapSnapshot`.

Every call carries a boolean `internal` flag and a channel string. Arguments are Blink `CloneableMessage`s, i.e. structured-clone data, which is why IPC payloads must be structured-cloneable.

## Browser-process C++ handler

`ElectronApiIPCHandlerImpl` (`shell/browser/electron_api_ipc_handler_impl.cc`) is a per-frame, associated-receiver implementation registered in `ElectronBrowserClient` (`shell/browser/electron_browser_client.cc`, alongside the service-worker variant `ElectronApiSWIPCHandlerImpl`). It observes the `WebContents` and deletes itself on `WebContentsDestroyed` or Mojo disconnect.

For each call it finds the `api::Session` for the frame's `BrowserContext`, builds an IPC event object (`MakeIPCEvent`) that carries the `internal` flag and, for `Invoke`/`MessageSync`, a reply channel wrapping the Mojo callback, and calls the matching method on the session. If the session no longer exists, a pending reply callback is still invoked with `"Session does not exist"`, because Mojo callbacks must always be answered.

`shell/browser/api/ipc_dispatcher.h` is the mixin that turns those calls into JS events on the session emitter: `-ipc-message`, `-ipc-invoke`, `-ipc-message-sync`, `-ipc-ports` and `-ipc-message-host`.

## Main-process JS dispatch

`Session.prototype._init` (`lib/browser/api/session.ts`) calls `addIpcDispatchListeners(this)` from `lib/browser/ipc-dispatch.ts`, which subscribes to those five events.

- **Internal vs public.** The event carries a hidden `internal` value. When it is set, the message is routed only to `ipcMainInternal` (`lib/browser/ipc-main-internal.ts`), never to user-visible emitters. Internal channel names are enumerated in `lib/common/ipc-messages.ts` (e.g. `BROWSER_SANDBOX_LOAD`, `GUEST_VIEW_MANAGER_*`, `RENDERER_WEB_FRAME_METHOD`). Helpers in `ipc-main-internal-utils.ts` and `ipc-renderer-internal-utils.ts` wrap request/response patterns on top of them.
- **Public frame messages.** For `type === 'frame'`, `-ipc-message` adds `event.reply`, emits `ipc-message` on the sending `WebContents`, then emits on up to three emitters in priority order: the frame's `WebFrameMain.ipc`, the `WebContents.ipc`, and the global `ipcMain`. The frame is looked up by FrameTreeNode id so IPCs sent by a frame that is mid-swap or unloading are still delivered.
- **Invoke.** `-ipc-invoke` searches the same emitter list for the first one whose `_invokeHandlers` has the channel, awaits the handler and replies `{ result }`, or replies `{ error }` (and logs to the console) if the handler throws or none is registered (`No handler registered for '<channel>'`).
- **Sync.** `-ipc-message-sync` defines a `returnValue` setter that sends the reply, so assigning `event.returnValue` unblocks the renderer. It warns when `sendSync` is called on a channel with no listeners, since the renderer would otherwise block with nothing to answer.
- **Ports.** `-ipc-ports` wraps native ports in `MessagePortMain` (`lib/browser/message-port-main.ts`) and exposes them as `event.ports`.
- **Service workers.** Events with `type === 'service-worker'` are delivered to the matching `ServiceWorkerMain.ipc` instead, found through `session.serviceWorkers`.

## Handler registration semantics

`IpcMainImpl` (`lib/browser/ipc-main-impl.ts`) extends `EventEmitter` and adds `handle`, `handleOnce` and `removeHandler` backed by a `_invokeHandlers` map. Registering a second handler for the same channel throws, a non-function handler throws a `TypeError`, and an `error` listener is installed so a channel named `error` never throws. The same class backs the global `ipcMain`, each `WebContents.ipc`, each `WebFrameMain.ipc`, `ServiceWorkerMain.ipc`, and `ipcMainInternal`.

## Main to renderer

The reverse direction is `webContents.send` / `sendToFrame`, which post an `ElectronRenderer.Message` to the renderer; `event.reply` is built on `sendToFrame` with the sender's process and frame ids. MessagePorts created with `MessageChannelMain` (`lib/browser/api/message-channel.ts`) can be posted to frames, and `ipcRenderer.postMessage` sends transferable ports the other way via `ReceivePostMessage`.

## Extension seams and caveats

- New internal request/response features should use a new `IPC_MESSAGES` entry plus `ipcMainInternal` rather than public channels, so that app code cannot listen on or spoof them.
- Because the handler resolves the session through the frame's `BrowserContext`, IPC from a frame whose session has been destroyed is dropped (or answered with an error for calls that expect a reply).
- Tests live in `spec/api-ipc-main-spec.ts`, `spec/api-ipc-renderer-spec.ts` and `spec/api-ipc-spec.ts`.

<!-- openwiki: broken internal link [/openwiki/architecture/renderer-preload-and-isolation.md] link "/openwiki/architecture/renderer-preload-and-isolation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See also [renderer, preload and isolation](/openwiki/architecture/renderer-preload-and-isolation.md) for where `ipcRenderer` is exposed to page code and [WebContents and windows](/openwiki/architecture/web-contents-and-windows.md) for the `WebContents` that owns per-contents `ipc`.
