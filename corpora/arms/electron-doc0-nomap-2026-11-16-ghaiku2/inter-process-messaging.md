---
title: "Inter-process Messaging"
---
## Overview

A call such as `ipcRenderer.send` in a page reaches `ipcMain` in the browser process through a fixed chain. The renderer's native binding serialises the arguments and calls a Mojo interface. The browser's handler turns the call into an event on the session. A JavaScript dispatcher then emits that event to the `ipcMain` object of the frame's `WebContents`, or to the global `ipcMain`. This page follows that chain for the three styles of call: one-way `send`, synchronous `sendSync`, and `invoke` with a reply. Loading the preload scripts that create these objects is covered in [[Preload Scripts and Sandboxing]].

Sources: [lib/renderer/api/ipc-renderer.ts:1-9](repo://lib/renderer/api/ipc-renderer.ts#L1-L9)

## Renderer side

The renderer's `ipcRenderer` object is an `IpcRenderer` that forwards every call to a binding. `getIPCRenderer` picks the binding for the process type: `createForRenderFrame` for a page and `createForServiceWorker` for a service worker. The internal `ipcRendererInternal` object uses the same binding with `internal` set to `true`, so Electron's own messages can be told apart from app messages.

Sources: [lib/renderer/ipc-renderer-bindings.ts:4-13](repo://lib/renderer/ipc-renderer-bindings.ts#L4-L13)

Sources: [lib/renderer/ipc-renderer-internal.ts:4-26](repo://lib/renderer/ipc-renderer-internal.ts#L4-L26)

The native `IPCBase` template implements `send`, `sendSync`, `invoke` and `postMessage`. `SendMessage` serialises the arguments to a `CloneableMessage` and calls `Message` on the Mojo remote. If the remote is gone, it throws instead.

Sources: [shell/renderer/api/electron_api_ipc_renderer.cc:66-80](repo://shell/renderer/api/electron_api_ipc_renderer.cc#L66-L80)

`Invoke` does the same with `Invoke` on the remote, and returns a promise that resolves when the browser calls back. `SendSync` calls the synchronous `MessageSync` method, which blocks the renderer until the browser replies.

Sources: [shell/renderer/api/electron_api_ipc_renderer.cc:82-107](repo://shell/renderer/api/electron_api_ipc_renderer.cc#L82-L107)

Sources: [shell/renderer/api/electron_api_ipc_renderer.cc:164-180](repo://shell/renderer/api/electron_api_ipc_renderer.cc#L164-L180)

## The Mojo interface

`ElectronApiIPC` in `api.mojom` defines the calls a renderer may make: `Message` for `send`, `Invoke` for `invoke` with a reply, `MessageSync` for `sendSync`, and `MessageHost` for `sendToHost`. Each call carries an `internal` flag, the channel name and a `CloneableMessage` of arguments.

Sources: [shell/common/api/api.mojom:28-56](repo://shell/common/api/api.mojom#L28-L56)

`ElectronApiIPCHandlerImpl` implements that interface in the browser process. Its `Message` method finds the session for the sending frame, builds the event object with `MakeIPCEvent`, and calls `Message` on the session. `Invoke` does the same and passes the reply callback into the event, so the handler can answer.

Sources: [shell/browser/electron_api_ipc_handler_impl.cc:44-55](repo://shell/browser/electron_api_ipc_handler_impl.cc#L44-L55)

Sources: [shell/browser/electron_api_ipc_handler_impl.cc:57-71](repo://shell/browser/electron_api_ipc_handler_impl.cc#L57-L71)

## Dispatch in the browser

The session inherits `IpcDispatcher`, and that template turns each call into a JavaScript event: `-ipc-message` for `send`, `-ipc-invoke` for `invoke`, `-ipc-message-sync` for `sendSync` and `-ipc-message-host` for `sendToHost`. The events are emitted on the session, and the JavaScript side listens for them.

Sources: [shell/browser/api/ipc_dispatcher.h:32-45](repo://shell/browser/api/ipc_dispatcher.h#L32-L45)

Sources: [shell/browser/api/ipc_dispatcher.h:62-76](repo://shell/browser/api/ipc_dispatcher.h#L62-L76)

The session installs these listeners on itself, so every event from the browser reaches this code.

Sources: [lib/browser/api/session.ts:26-26](repo://lib/browser/api/session.ts#L26-L26)

`addIpcDispatchListeners` handles `-ipc-message`. A message marked internal goes to `ipcMainInternal`. Otherwise the event sender's `addReplyToEvent` is set up, and the message goes to the frame's `WebFrameMain.ipc`, then the `WebContents.ipc`, then the global `ipcMain`, in that order. Each emitter receives the channel and the event.

Sources: [lib/browser/ipc-dispatch.ts:58-74](repo://lib/browser/ipc-dispatch.ts#L58-L74)

The emitter order comes from `getIpcEmittersForFrameEvent`. It looks up the frame by its frame-tree node ID, which keeps messages delivered after a frame swap, and fills the first two slots of a shared array.

Sources: [lib/browser/ipc-dispatch.ts:37-52](repo://lib/browser/ipc-dispatch.ts#L37-L52)

Each `WebContents` owns its own `IpcMainImpl`, created in its constructor, which is why a listener on `win.webContents.ipc` only receives that window's messages.

Sources: [lib/browser/api/web-contents.ts:550-556](repo://lib/browser/api/web-contents.ts#L550-L556)

## Invoke and replies

`ipcMain.handle` stores one handler per channel in a map. A second `handle` for the same channel throws. `handleOnce` removes its handler after the first call.

Sources: [lib/browser/ipc-main-impl.ts:13-30](repo://lib/browser/ipc-main-impl.ts#L13-L30)

For `-ipc-invoke`, the dispatcher looks up the handler in the same ordered list of emitters and runs it. The result goes back through `_replyChannel.sendReply` as `{ result }`. An error is logged, and sent back as `{ error }`. If no handler exists, the reply is an error that names the channel.

Sources: [lib/browser/ipc-dispatch.ts:76-107](repo://lib/browser/ipc-dispatch.ts#L76-L107)

## Replies into the renderer

When the browser sends to a page, `ElectronApiIPC` in the renderer receives the message and `ipc-native-setup` hands it to the `ipcNative` object. That object calls the renderer's `onMessage` callback, which emits the event on `ipcRenderer` or on `ipcRendererInternal`.

Sources: [lib/renderer/ipc-native-setup.ts:4-13](repo://lib/renderer/ipc-native-setup.ts#L4-L13)

Sources: [shell/renderer/electron_ipc_native.cc:42-80](repo://shell/renderer/electron_ipc_native.cc#L42-L80)

## Internal channels

Messages that Electron's own code sends use names from `IPC_MESSAGES`, an enum of constant strings.

Sources: [lib/common/ipc-messages.ts:1-28](repo://lib/common/ipc-messages.ts#L1-L28)

The browser handles those names in `rpc-server.ts`. Window close is registered as an internal `on` handler, and the sandbox and non-sandbox preload loads are synchronous handlers that read the preload scripts for the sender.

Sources: [lib/browser/rpc-server.ts:12-20](repo://lib/browser/rpc-server.ts#L12-L20)

Sources: [lib/browser/rpc-server.ts:52-60](repo://lib/browser/rpc-server.ts#L52-L60)

Sources: [lib/browser/rpc-server.ts:89-107](repo://lib/browser/rpc-server.ts#L89-L107)

The clipboard handler is different: it accepts only the methods in an allowlist, which covers every clipboard method on Linux, only the find-pasteboard methods on macOS, and none elsewhere.

Sources: [lib/browser/rpc-server.ts:33-50](repo://lib/browser/rpc-server.ts#L33-L50)
