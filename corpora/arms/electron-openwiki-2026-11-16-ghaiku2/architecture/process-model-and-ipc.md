---
type: architecture
title: Process Model and IPC
description: How Electron's browser, renderer, sandboxed renderer, utility, worker, and preload-realm processes are initialized, and how ipcMain, ipcRenderer, sendSync, invoke, and message ports move messages between them over Mojo and the internal IPC dispatch.
tags: [electron, ipc, process-model, mojo, ipcMain, ipcRenderer, sandbox, preload, message-port]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-28e5fbabf9ba3b8c0a6d92d9
    resource: repo://lib/browser/message-port-main.ts
  - id: openwiki-source-3870e9df1305cc5d679a8730
    resource: repo://lib/browser/rpc-server.ts
  - id: openwiki-source-90a1c3c767c21f6343b965a7
    resource: repo://lib/renderer/api/ipc-renderer.ts
  - id: openwiki-source-b590f9b923c89bac137bd0aa
    resource: repo://lib/renderer/init.ts
  - id: openwiki-source-a887f89c61604389673127b5
    resource: repo://lib/sandboxed_renderer/init.ts
  - id: openwiki-source-5e62dde8d8a08cd2251771e1
    resource: repo://shell/browser/electron_api_ipc_handler_impl.cc
  - id: openwiki-source-c4c0bc4af5a5cdc4080ce7a1
    resource: repo://shell/common/api/api.mojom
  - id: openwiki-source-add0576ee35842626c2c59cd
    resource: repo://shell/renderer/electron_api_service_impl.cc
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Process Model and IPC

Electron applications run as several operating-system processes that cooperate: one browser (main) process that owns the application, renderer processes that host web content, and smaller processes for utility and worker code. JavaScript in each process runs in its own V8 environment, so every cross-process interaction is an explicit message. This page describes how each process starts, and how a message travels from `ipcRenderer.send` to `ipcMain.on` and back, including synchronous calls, `invoke`, and message ports.

## Process types and their initialization

<!-- openwiki: broken internal link [/openwiki/architecture/native-shell.md] link "/openwiki/architecture/native-shell.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The native shell selects a process type from Chromium's process type string (see [Native Shell (C++)](/openwiki/architecture/native-shell.md)) and runs the matching init bundle, as described in [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md). The main differences between them are:

- **Browser process.** `lib/browser/init.ts` runs first, then the browser-side modules load. Its `ipcMain` is the `IpcMainImpl` instance from `lib/browser/ipc-main-impl.ts`, and it also owns an internal emitter, `ipcMainInternal`, used by Electron's own handlers in `lib/browser/rpc-server.ts`.
- **Renderer process.** `lib/renderer/init.ts` runs in the page's context. Before the page's own scripts run, it loads preload scripts. It requests their paths from the browser process synchronously with `BROWSER_NONSANDBOX_LOAD` (`lib/renderer/init.ts` around line 136). `rpc-server.ts` answers that request with `ipcMainUtils.handleSync`.
- **Sandboxed renderer.** `lib/sandboxed_renderer/init.ts` loads a restricted bundle. It requests its preload scripts and process properties with `BROWSER_SANDBOX_LOAD` (around line 22 of that file) and then loads only the modules in its own maps (`loadedModules` and `loadableModules`), which include `electron`, `events`, `timers`, and `url`. Other modules are not in those maps.
- **Preload realm.** `lib/preload_realm/init.ts` runs preload code in a separate context. It also uses `BROWSER_SANDBOX_LOAD` to fetch its scripts.
- **Utility and worker.** `lib/utility/init.ts` and `lib/worker/init.ts` run Node.js code in a utility process or a web worker. Their IPC goes through the parent port and the message-port helpers.

The message names used by these handshakes are in `lib/common/ipc-messages.ts`, in the `IPC_MESSAGES` enum. The enum includes `BROWSER_SANDBOX_LOAD`, `BROWSER_NONSANDBOX_LOAD`, `BROWSER_WINDOW_CLOSE`, `BROWSER_GET_LAST_WEB_PREFERENCES`, and several `GUEST_VIEW_*` names for `<webview>`.

## The transport: Mojo and ElectronApiIPC

The renderer does not send messages by itself. The C++ `ipc_renderer` binding (`shell/renderer/api/electron_api_ipc_renderer.cc`) implements the JavaScript `ipcRenderer` methods `send`, `sendSync`, `invoke`, `sendToHost`, and `postMessage` as native methods. Each one calls a Mojo interface named `electron::mojom::ElectronApiIPC`, which is defined in `shell/common/api/api.mojom`. Its methods are:

- `Message(bool internal, string channel, CloneableMessage arguments)` for one-way messages.
- `Invoke(bool internal, string channel, CloneableMessage arguments) => (CloneableMessage result)` for request and response.
- `ReceivePostMessage` for message ports.
- A synchronous variant (`MessageSync`) for `sendSync`, and `MessageHost` for `sendToHost`.

The browser side implements this interface in `shell/browser/electron_api_ipc_handler_impl.cc`. `ElectronApiIPCHandlerImpl::Message` and `Invoke` resolve the `Session` that owns the sending frame, build an IPC event object (`MakeIPCEvent`), and call the session's `Message` or `Invoke`. `lib/browser/api/session.ts` calls `addIpcDispatchListeners(this)` (line 26), so those calls are dispatched through the JavaScript dispatcher described below.

The `internal` boolean separates Electron's own channels from application channels. Internal messages are routed only to `ipcMainInternal` and never to application listeners.

## Browser-side dispatch

`lib/browser/ipc-dispatch.ts` is the browser's routing layer. It listens on three internal events: `-ipc-message`, `-ipc-invoke`, and `-ipc-message-sync`. For each frame-originated message it builds the list of candidate emitters in priority order:

1. The `WebFrameMain` for the sending frame, found by its frame tree node ID, so messages sent while a frame is being swapped still reach the right emitter.
2. The `WebContents` that owns the frame.
3. The application's `ipcMain`.

`-ipc-message` emits the event on each candidate in that order, so a listener on the frame sees the message before a listener on `ipcMain`. For `-ipc-invoke`, the dispatcher finds the first candidate whose `_invokeHandlers` map has the channel and calls it. Service-worker messages are routed through the matching `ServiceWorkerMain` instead of frames.

The reply path differs by message type:

- `send` messages get `event.reply(channel, ...args)`, which calls `sendToFrame` back to the originating frame (`addReplyToEvent`).
- `sendSync` messages get `event.returnValue`, a setter that calls `_replyChannel.sendReply` (`addReturnValueToEvent`). The renderer blocks until that reply arrives. If no listener exists on the channel, the dispatcher logs a warning that names the channel.
- `invoke` messages get the handler's result. The dispatcher awaits the handler, then sends `{ result }`. If the handler throws, it logs the error and sends `{ error }`. If no handler is registered, it sends `{ error: "No handler registered for '<channel>'" }`.

On the renderer side, `lib/renderer/api/ipc-renderer.ts` turns an `invoke` error response into a thrown `Error` that names the channel. That is how a failing main-process handler surfaces in the page.

## Handler registration rules

`IpcMainImpl` in `lib/browser/ipc-main-impl.ts` is an `EventEmitter` with one extra map for invoke handlers. Its `handle` method throws if the channel already has a handler, and throws a `TypeError` if the handler is not a function. `handleOnce` removes the handler before calling it. `removeHandler` deletes it. Because `handle` refuses duplicates, two modules cannot silently replace each other's invoke handlers.

## Renderer-side receive

Messages from the browser arrive through `ElectronApiServiceImpl` (`shell/renderer/electron_api_service_impl.cc`). Its `Message` method calls `ipc_native::EmitIPCEvent` with the channel and arguments, and `ReceivePostMessage` does the same with transferred ports. `EmitIPCEvent` dispatches the event to the renderer's `ipcRenderer` emitters, which run on the renderer's main thread.

## Message ports

`MessageChannelMain` and `MessagePortMain` (`lib/browser/api/message-channel.ts` and `lib/browser/message-port-main.ts`) wrap Chromium message ports. `MessagePortMain` wraps the internal port, and its `postMessage` replaces any `MessagePortMain` arguments with their internal ports before sending, so ports can be transferred across the boundary. When the internal port emits `message`, the wrapper converts each transferred port back into a `MessagePortMain`. Renderer-side ports arrive through `ReceivePostMessage` as described above.

## Ordering, failure, and invariants

- Dispatch on the browser side calls each candidate emitter's `emit` synchronously, in the priority order described above, so a listener on the frame runs before the same channel's listener on `ipcMain`.
- `sendSync` blocks the renderer until the browser replies. A slow `ipcMain.on` handler therefore holds up the page that called it. Electron warns when no listener is registered for a `sendSync` channel.
- `invoke` is asynchronous on both sides. A handler that throws is logged in the browser process and its error is returned to the caller as `{ error }`; the call does not crash the browser process.
- A candidate emitter whose lookup fails (for example, a `WebFrameMain` that was already torn down during a frame swap) is simply skipped, and the `WebContents` and `ipcMain` candidates are still tried.
- Internal messages (`internal` set to true) are routed only to `ipcMainInternal`, so Electron's own handlers in `lib/browser/rpc-server.ts` do not appear as application `ipcMain` listeners.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) places these processes in the wider layering.
<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md) covers the sandbox and context-isolation settings that determine which bundle a renderer loads.
<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md) explains the bundles and module lists used by each process.
