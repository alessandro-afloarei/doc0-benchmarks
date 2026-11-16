---
title: "Inter-process Communication"
---
## Overview

`ipcRenderer` and `ipcMain` are built on one Mojo interface, `ElectronApiIPC`, that the renderer calls and the browser process implements. Electron's own modules use the same path with an `internal` flag, which routes a message to a separate `ipcMainInternal` emitter so app code cannot receive it. This page follows a message from the renderer's JavaScript to the `ipcMain` listener and describes the three call shapes: send, invoke and synchronous send. The page that sets up each renderer's bindings is [[Renderer Startup and Realms]].

Sources: [shell/common/api/api.mojom:28-35](repo://shell/common/api/api.mojom#L28-L35), [lib/browser/ipc-main-internal.ts:1-2](repo://lib/browser/ipc-main-internal.ts#L1-L2)

The renderer reaches the browser through `getIPCRenderer`, which asks the native `electron_renderer_ipc` binding for a frame-level or service-worker-level object depending on the process type.

Sources: [lib/renderer/ipc-renderer-bindings.ts:1-16](repo://lib/renderer/ipc-renderer-bindings.ts#L1-L16)

## Internal channels

`IPC_MESSAGES` is a `const enum` that names every internal channel. Each name is the string the internal code sends or handles, so a typo fails at compile time rather than at run time.

Sources: [lib/common/ipc-messages.ts:1-27](repo://lib/common/ipc-messages.ts#L1-L27)

The internal renderer wrapper sends with `internal = true`. Its `send`, `sendSync` and `invoke` methods are the renderer's view of the same native object that `ipcRenderer` uses.

Sources: [lib/renderer/ipc-renderer-internal.ts:1-23](repo://lib/renderer/ipc-renderer-internal.ts#L1-L23)

Each main-process internal handler is registered on `ipcMainInternal`, which is an `IpcMainImpl`. `handle` stores one function per channel and throws if the channel already has a handler, so an internal channel cannot be replaced by a second module.

Sources: [lib/browser/ipc-main-impl.ts:5-23](repo://lib/browser/ipc-main-impl.ts#L5-L23)

`handleSync` wraps a handler so that the result is written to `event.returnValue` as a pair, `[error, result]`. The renderer side reads that pair in `invokeSync`, which throws the error if one is present.

Sources: [lib/browser/ipc-main-internal-utils.ts:5-13](repo://lib/browser/ipc-main-internal-utils.ts#L5-L13), [lib/renderer/ipc-renderer-internal-utils.ts:16-24](repo://lib/renderer/ipc-renderer-internal-utils.ts#L16-L24)

Some internal channels are used only for the window itself. `BROWSER_WINDOW_CLOSE` closes the window that sent it, and `BROWSER_CLIPBOARD_SYNC` runs one clipboard method on behalf of the renderer, and only for methods on an allow-list.

Sources: [lib/browser/rpc-server.ts:11-18](repo://lib/browser/rpc-server.ts#L11-L18), [lib/browser/rpc-server.ts:44-56](repo://lib/browser/rpc-server.ts#L44-L56)

## Send

`ipcRenderer.send` calls `SendMessage` in the renderer. The method refuses the call if the context has been released, serializes the arguments into a `CloneableMessage`, and calls `Message` on the remote `ElectronApiIPC`.

Sources: [shell/renderer/api/electron_api_ipc_renderer.cc:66-80](repo://shell/renderer/api/electron_api_ipc_renderer.cc#L66-L80)

In the browser, `ElectronApiIPCHandlerImpl::Message` looks up the session of the sending frame, creates an IPC event object, and passes it with the channel and arguments to `Session::Message`.

Sources: [shell/browser/electron_api_ipc_handler_impl.cc:44-56](repo://shell/browser/electron_api_ipc_handler_impl.cc#L44-L56)

`addIpcDispatchListeners` in `ipc-dispatch.ts` listens for the `-ipc-message` event. For internal messages it emits the channel on `ipcMainInternal` and stops. For a frame it first adds a `reply` method to the event, then emits `ipc-message` on the frame's `WebContents`, and then emits the channel on each emitter from `getIpcEmittersForFrameEvent`, which lists the frame's `WebFrameMain` IPC, the `WebContents` IPC, and `ipcMain` in that order.

Sources: [lib/browser/ipc-dispatch.ts:59-74](repo://lib/browser/ipc-dispatch.ts#L59-L74), [lib/browser/ipc-dispatch.ts:36-51](repo://lib/browser/ipc-dispatch.ts#L36-L51)

## Invoke

`ipcRenderer.invoke` calls `Invoke` on the remote, which returns a promise. The browser side passes a callback that resolves that promise with the reply.

Sources: [shell/renderer/api/electron_api_ipc_renderer.cc:82-106](repo://shell/renderer/api/electron_api_ipc_renderer.cc#L82-L106), [shell/browser/electron_api_ipc_handler_impl.cc:57-71](repo://shell/browser/electron_api_ipc_handler_impl.cc#L57-L71)

On the browser side, `-ipc-invoke` looks for a handler for the channel in the same emitters that `-ipc-message` uses. It calls the first handler found, sends its result back through `_replyChannel`, and sends the error text back if the handler throws. A channel with no handler gets the error `No handler registered for '<channel>'`.

Sources: [lib/browser/ipc-dispatch.ts:76-108](repo://lib/browser/ipc-dispatch.ts#L76-L108)

## Synchronous send

`sendSync` is the only call that blocks. The `MessageSync` method on the Mojo interface is marked `[Sync]`, so the renderer waits for the reply on the same thread.

Sources: [shell/common/api/api.mojom:47-52](repo://shell/common/api/api.mojom#L47-L52), [shell/browser/electron_api_ipc_handler_impl.cc:88-102](repo://shell/browser/electron_api_ipc_handler_impl.cc#L88-L102)

The browser handler for `-ipc-message-sync` writes the return value to `event.returnValue`, and warns when the `WebContents` has no listener for the channel. That warning is the only sign that a `sendSync` call went nowhere.

Sources: [lib/browser/ipc-dispatch.ts:110-133](repo://lib/browser/ipc-dispatch.ts#L110-L133)

## Browser to renderer

The reverse direction uses the `ElectronRenderer` interface. The browser holds a remote `ElectronRenderer` for each frame, and `WebFrameMain::GetRendererApi` returns it. Its `Message` method has the same shape as `ElectronApiIPC.Message`, so the renderer receives a channel and a cloneable argument list.

Sources: [shell/common/api/api.mojom:8-16](repo://shell/common/api/api.mojom#L8-L16), [shell/browser/api/electron_api_web_frame_main.cc:290-291](repo://shell/browser/api/electron_api_web_frame_main.cc#L290-L291)

On the renderer, `EmitIPCEvent` calls the `onMessage` callback that the native IPC module installed, passing the internal flag, the channel, any transferred ports and the arguments. The JavaScript `ipcRenderer` then emits the channel to its listeners.

Sources: [shell/renderer/electron_ipc_native.cc:65-80](repo://shell/renderer/electron_ipc_native.cc#L65-L80)

## Ports

`-ipc-ports` delivers a `MessagePort` that was sent with a message. The browser wraps each transferred port in a `MessagePortMain` and emits the channel with the port list on the event, which is how the `event.ports` array is filled. The renderer-side objects that a page receives are limited by the context bridge on [[Renderer APIs and Context Bridge]].

Sources: [lib/browser/ipc-dispatch.ts:139-150](repo://lib/browser/ipc-dispatch.ts#L139-L150)
