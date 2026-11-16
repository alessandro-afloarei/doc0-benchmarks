---
type: architecture
title: IPC Between Main, Renderer, and Utility Processes
description: How ipcMain, ipcRenderer, MessagePorts, and WebContents messaging are implemented across lib/ and shell/. Covers the mojo transport, the browser-side dispatch of send, invoke, and sendSync to the JavaScript emitters, reply semantics, and the internal-versus-public channel split.
tags: [ipc, ipcMain, ipcRenderer, mojo, message-port, invoke, sync-ipc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-292829a2671e72404b6fcd44
    resource: repo://lib/browser/ipc-main-internal-utils.ts
  - id: openwiki-source-bc1e3f5c0345fe73f82ff336
    resource: repo://shell/browser/api/ipc_dispatcher.h
  - id: openwiki-source-5e62dde8d8a08cd2251771e1
    resource: repo://shell/browser/electron_api_ipc_handler_impl.cc
  - id: openwiki-source-c4c0bc4af5a5cdc4080ce7a1
    resource: repo://shell/common/api/api.mojom
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# IPC Between Main, Renderer, and Utility Processes

Electron's IPC lets JavaScript in the browser (main) process and renderers exchange messages. The public surface is `ipcMain`/`ipcRenderer`, `webContents.send`, and `MessagePort`. Underneath, the messages cross a Mojo interface (`ElectronApiIPC`) defined in `shell/common/api/api.mojom`. The C++ side turns each message into a JavaScript event, and `lib/browser/ipc-dispatch.ts` decides which emitter receives it.

## Layers

| Layer | Location | Responsibility |
| --- | --- | --- |
| Public API | `lib/browser/ipc-main-impl.ts`, `lib/renderer/api/ipc-renderer.ts` | `ipcMain.handle`/`handleOnce`/`removeHandler` store invoke handlers. Renderer-side objects are exposed to user code. |
| Dispatch | `lib/browser/ipc-dispatch.ts` | Listens for the `-ipc-*` events and selects emitters: frame-scoped `webFrameMain.ipc`, then `webContents.ipc`, then the global `ipcMain`. |
| Internal channels | `lib/browser/ipc-main-internal.ts`, `lib/browser/ipc-main-internal-utils.ts`, `lib/renderer/ipc-renderer-internal.ts` | Electron's own messages (for example `handleSync`, `invokeInWebContents`) use a separate emitter so they cannot collide with user channels. |
| Renderer binding | `lib/renderer/ipc-renderer-bindings.ts`, `lib/renderer/ipc-native-setup.ts` | Gets the native IPC object for the current process type and receives inbound messages from C++ through a hidden `ipcNative.onMessage` callback. |
| Native renderer | `shell/renderer/api/electron_api_ipc_renderer.cc`, `shell/renderer/electron_ipc_native.cc` | Sends messages through the Mojo remote (`Message`, `Invoke`, `MessageSync`, `MessageHost`) and calls `ipcNative.onMessage` on inbound messages. |
| Native browser | `shell/browser/electron_api_ipc_handler_impl.cc`, `shell/browser/api/ipc_dispatcher.h` | Receives the Mojo calls, wraps them into an event object, and emits the matching `-ipc-*` event on the session, WebContents, or frame. |

## Message flow

Each message type is one Mojo method on `ElectronApiIPC`, with an optional `internal` flag:

- **`send`** (`Message`) is one-way. The browser handler emits `-ipc-message`. `ipc-dispatch.ts` runs the internal path if the `internal` flag is set. Otherwise it attaches a reply helper (`event.reply`) and emits to the frame, WebContents, and global `ipcMain` emitters in order.
- **`invoke`** (`Invoke`) carries a Mojo callback. The browser emits `-ipc-invoke`, and `ipc-dispatch.ts` finds the first emitter whose `_invokeHandlers` map has the channel. The result or error is sent back through `event._replyChannel.sendReply`. An unregistered channel replies with `No handler registered for '<channel>'`. A thrown handler error is logged and returned as a string.
- **`sendSync`** (`MessageSync`) is marked `[Sync]` in the mojom. The renderer blocks on the reply. The browser emits `-ipc-message-sync` and installs `event.returnValue` through `addReturnValueToEvent`. A WebContents with a sync call but no listener logs a warning.
- **`postMessage`** (`ReceivePostMessage`) carries transferable message ports. `IpcDispatcher::ReceivePostMessage` entangles the ports and emits `-ipc-ports`, which `ipc-dispatch.ts` converts into `MessagePortMain` objects on the event.
- **`sendToHost`** (`MessageHost`) is a renderer-to-host-WebContents message for `<webview>`. It emits `-ipc-message-host` on the guest's WebContents.

Inbound messages use the reverse path. The browser calls the `ElectronRenderer.Message` mojo method, which is implemented by `ElectronApiServiceImpl` in `shell/renderer/electron_api_service_impl.cc`. That implementation calls `ipcNative.onMessage(internal, channel, ports, args)` through `shell/renderer/electron_ipc_native.cc`. The callback picks `ipcRendererInternal` for internal channels and `ipcRenderer` otherwise, and emits on it.

## Internal versus public channels

The `internal` flag is set by Electron's own code and is read in the browser via `v8Util.getHiddenValue(event, 'internal')`. Internal messages go only to `ipcMainInternal`, and invoke lookups use that emitter too. Public code cannot set that flag, so Electron's internal channels cannot be intercepted by user `ipcMain` listeners. Consequence: user code cannot spoof internal commands by reusing a channel name.

## Ordering, lifecycle, and failure behavior

- Dispatch is synchronous on the browser UI thread. `-ipc-message` listeners run in the order emitters are returned, and a frame-scoped emitter can run before WebContents-level listeners.
- Frame lookup uses the frame tree node ID. This keeps messages that arrive while a frame is being swapped or unloaded routed to the right emitter.
- When a renderer context is released, calls on its `ipcRenderer` objects throw `kIPCMethodCalledAfterContextReleasedError` instead of sending.
- Invoke replies from the wrong WebContents are rejected in `invokeInWebContents` for internal commands.
- A duplicate `ipcMain.handle` on the same channel throws `Attempted to register a second handler for '<channel>'`.

## Extension seams

- New message types are added in `api.mojom`, implemented in `electron_api_ipc_handler_impl.cc`, and dispatched in `ipc_dispatcher.h`. The matching `-ipc-*` listener then goes in `lib/browser/ipc-dispatch.ts`.
- Internal commands should use `ipcMainInternal` and the helpers in `ipc-main-internal-utils.ts` rather than public channels.

## Related pages

- [Browser Main Process](browser-main-process.md) explains the process that receives these events.
- [JavaScript API Layer](js-api-layer.md) explains how `lib/` modules are bundled and loaded per process.
- [Process Model and Startup](process-model.md) explains which process hosts each end of a channel.

## Focused tests

- `spec/api-ipc-spec.ts`, `spec/api-ipc-main-spec.ts`, and `spec/api-ipc-renderer-spec.ts` cover send, invoke, sync, and reply semantics.
