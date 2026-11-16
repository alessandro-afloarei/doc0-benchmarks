---
type: system
title: IPC between main and renderer
description: End-to-end flow of Electron IPC — ipcRenderer send/sendSync/invoke/postMessage over the ElectronApiIPC mojom interface, dispatch through Session into ipc-dispatch.ts with frame/WebContents/global ipcMain priority, invoke/handle replies, main-to-renderer messages via WebFrameMain and ElectronRenderer, internal channels used by Electron itself, service-worker IPC, and MessagePortMain.
tags: [ipc, mojo, ipcMain, ipcRenderer, message-port, internals]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-02a1bf323c3b504b25f825b1
    resource: repo://lib/browser/api/web-contents.ts
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-292829a2671e72404b6fcd44
    resource: repo://lib/browser/ipc-main-internal-utils.ts
  - id: openwiki-source-28e5fbabf9ba3b8c0a6d92d9
    resource: repo://lib/browser/message-port-main.ts
  - id: openwiki-source-90a1c3c767c21f6343b965a7
    resource: repo://lib/renderer/api/ipc-renderer.ts
  - id: openwiki-source-a8b1b0baa1b9288138aa7ed6
    resource: repo://lib/renderer/ipc-native-setup.ts
  - id: openwiki-source-55fdaaad21b85e6b4e3c9210
    resource: repo://lib/renderer/ipc-renderer-internal.ts
  - id: openwiki-source-05a1be396e6a26d718e839a0
    resource: repo://shell/browser/api/electron_api_web_frame_main.cc
  - id: openwiki-source-bc1e3f5c0345fe73f82ff336
    resource: repo://shell/browser/api/ipc_dispatcher.h
  - id: openwiki-source-8d2aa0a11aae6506c58f1400
    resource: repo://shell/browser/api/message_port.cc
  - id: openwiki-source-5e62dde8d8a08cd2251771e1
    resource: repo://shell/browser/electron_api_ipc_handler_impl.cc
  - id: openwiki-source-c4c0bc4af5a5cdc4080ce7a1
    resource: repo://shell/common/api/api.mojom
  - id: openwiki-source-8bebcb156457664da5a52d2e
    resource: repo://shell/renderer/api/electron_api_ipc_renderer.cc
  - id: openwiki-source-add0576ee35842626c2c59cd
    resource: repo://shell/renderer/electron_api_service_impl.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# IPC between main and renderer

All renderer↔main messaging in Electron rides on two Mojo interfaces defined in
`shell/common/api/api.mojom`, with argument payloads serialised as Blink
structured clones (`blink.mojom.CloneableMessage`, or
`TransferableMessage` when ports are transferred):

| Interface | Direction | Methods |
| --- | --- | --- |
| `ElectronApiIPC` | renderer → browser (frame-associated) | `Message`, `Invoke` (async reply), `MessageSync` (`[Sync]`), `ReceivePostMessage`, `MessageHost` |
| `ElectronRenderer` | browser → renderer frame | `Message`, `ReceivePostMessage`, `TakeHeapSnapshot` |

Every call carries an `internal` flag that separates Electron's **internal
channels** from user channels. Because arguments are structured-cloned,
functions, DOM objects and class prototypes do not survive the trip.

## Renderer → main

### Renderer side

`lib/renderer/api/ipc-renderer.ts` (public `ipcRenderer`, `internal = false`)
and `lib/renderer/ipc-renderer-internal.ts` (`ipcRendererInternal`,
`internal = true`) both wrap the native object returned by
`ipc-renderer-bindings` (`shell/renderer/api/electron_api_ipc_renderer.cc`),
which exists in two flavours — for a render frame and for a service worker
(`createForRenderFrame` / `createForServiceWorker`). Methods:

- `send` → `ElectronApiIPC.Message`
- `sendSync` → `MessageSync`, blocking the renderer until the main process sets
  `event.returnValue`
- `invoke` → `Invoke`; resolves to `{ result }` or `{ error }`, and
  `invoke` rethrows the latter as
  `Error invoking remote method '<channel>': <error>`
- `postMessage(channel, message, transfer)` → `ReceivePostMessage` with
  disentangled `MessagePort`s
- `sendToHost` → `MessageHost` (to a `<webview>` embedder)

### Browser side

`ElectronApiIPCHandlerImpl` (`shell/browser/electron_api_ipc_handler_impl.cc`)
is bound per `RenderFrameHost` and lives until the connection drops or the
WebContents is destroyed. For each message it builds an IPC event object
(`MakeIPCEvent`) with `type: 'frame'`, `sender` (the `webContents`),
`senderFrame` getter, `frameId`, `processId`, `frameTreeNodeId`, a hidden
`internal` flag and — for `Invoke`/`MessageSync` — a `_replyChannel`. If the
WebContents wrapper is already gone, any pending reply is completed with
`WebContents was destroyed` so the renderer never hangs.

The event is handed to the frame's **Session**, whose `IpcDispatcher`
(`shell/browser/api/ipc_dispatcher.h`) emits private events `-ipc-message`,
`-ipc-invoke`, `-ipc-message-sync`, `-ipc-ports` and `-ipc-message-host`.
Service workers use `ElectronApiSWIPCHandlerImpl` and produce events with
`type: 'service-worker'`, `session` and `versionId`.

### Dispatch in JS: `lib/browser/ipc-dispatch.ts`

`lib/browser/api/session.ts` calls `addIpcDispatchListeners(this)` for each
session. The listeners route by `internal` flag and event type:

- **Internal** messages go only to `ipcMainInternal`.
- **Frame** messages are emitted, in priority order, on
  1. the sending frame's `webFrameMain.ipc` (looked up by FrameTreeNode id so
     IPC sent during a frame swap is not lost),
  2. the sender's `webContents.ipc`,
  3. the global `ipcMain`.
  The `webContents` also emits `ipc-message` / `ipc-message-sync`.
  `event.reply(...)` is added, sending back to the exact
  `[processId, frameId]`.
- **Service-worker** messages go to that worker's `ServiceWorkerMain.ipc`.

`sendSync` events get a write-only `event.returnValue` setter that sends the
reply; a warning is printed when nothing listens to the channel.

### invoke / handle

`IpcMainImpl` (`lib/browser/ipc-main-impl.ts`) — the class behind `ipcMain`,
`ipcMainInternal`, `webContents.ipc` and `webFrameMain.ipc` — adds
`handle`, `handleOnce` and `removeHandler` over an `_invokeHandlers` map.
Registering a second handler for a channel throws. For `-ipc-invoke` the
dispatcher picks the **first** target (frame → WebContents → global) that has
a handler, awaits it, and replies `{ result }`; exceptions are logged and
replied as `{ error: err.toString() }` (so only the message string crosses);
if no handler exists the reply is `No handler registered for '<channel>'`.

`IpcMainImpl` also installs a no-op `error` listener so a channel named
`error` does not throw as an unhandled EventEmitter error.

## Main → renderer

- `webContents.send(channel, ...)` delegates to `mainFrame.send`;
  `webContents.sendToFrame(frameId, ...)` finds the frame first.
- `WebFrameMain::Send` (`shell/browser/api/electron_api_web_frame_main.cc`)
  serialises arguments and calls `ElectronRenderer.Message` on a remote bound
  lazily to the frame; `postMessage` uses `ReceivePostMessage` with
  transferred `MessagePortMain`s.
- In the renderer, `ElectronApiServiceImpl`
  (`shell/renderer/electron_api_service_impl.cc`) resolves the context that
  owns Electron's code for the frame (the isolated world when context
  isolation is on — see
  [Renderer processes, sandboxing and context isolation](../architecture/renderer-processes-and-sandboxing.md))
  and calls `ipc_native::EmitIPCEvent`, which invokes the hidden
  `ipcNative.onMessage` callback installed by
  `lib/renderer/ipc-native-setup.ts`. That emits on `ipcRendererInternal` or
  `ipcRenderer` with an event `{ sender, ports }`.

## Internal channels

Electron implements many features on top of the same pipes with
`internal = true`, so they are invisible to app listeners. Channel names
are centralised in `lib/common/ipc-messages.ts` (`IPC_MESSAGES`), e.g.
`BROWSER_SANDBOX_LOAD` / `BROWSER_NONSANDBOX_LOAD` (preload discovery),
`BROWSER_PRELOAD_ERROR`, `BROWSER_CLIPBOARD_SYNC` (clipboard for sandboxed
renderers, method allowlisted), `GUEST_VIEW_MANAGER_*` (webview), and
`INSPECTOR_*` (DevTools). Helpers:

- `ipcMainUtils.handleSync` (`lib/browser/ipc-main-internal-utils.ts`)
  answers a `sendSync` with `[error, result]`;
  `invokeSync` on the renderer side unpacks it.
- `invokeInWebContents` sends `command` with a request id and waits for
  `<command>_RESPONSE_<id>`, ignoring replies from other WebContents.
- Most handlers live in `lib/browser/rpc-server.ts`, loaded at startup by
  `lib/browser/init.ts`.

## MessagePorts

`MessageChannelMain` / `MessagePortMain` give the main process real
`MessagePort` semantics. The native `MessagePort`
(`shell/browser/api/message_port.cc`) entangles a `blink::MessagePortDescriptor`,
`Pin()`s itself while started and open so it is not garbage-collected while
messages can still arrive, and emits `message`/`close`.
`lib/browser/message-port-main.ts` wraps it in an `EventEmitter`, unwrapping
and re-wrapping ports on `postMessage` and `message`. Ports received from a
renderer's `ipcRenderer.postMessage` arrive as `event.ports` on the `-ipc-ports`
dispatch. The same mechanism connects to [utility processes](utility-process.md).

## Testing

Focused specs: `spec/api-ipc-spec.ts`, `spec/api-ipc-main-spec.ts`,
`spec/api-ipc-renderer-spec.ts`, and `spec/api-web-frame-main-spec.ts`. See
[Testing: spec runner and test suites](../testing/spec-runner.md).

Related: [Windows, views and WebContents](windows-and-web-contents.md).
