---
type: concept
title: IPC routing and message ports
description: Renderer-to-main transport, frame and WebContents dispatch priority, invoke errors, synchronous replies, and transferred MessagePort ownership.
tags: [ipc, messaging, frames, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-28e5fbabf9ba3b8c0a6d92d9
    resource: repo://lib/browser/message-port-main.ts
  - id: openwiki-source-90a1c3c767c21f6343b965a7
    resource: repo://lib/renderer/api/ipc-renderer.ts
  - id: openwiki-source-5e62dde8d8a08cd2251771e1
    resource: repo://shell/browser/electron_api_ipc_handler_impl.cc
  - id: openwiki-source-e876c0572cbbb7c653e8a6a1
    resource: repo://shell/common/gin_helper/reply_channel.cc
  - id: openwiki-source-8bebcb156457664da5a52d2e
    resource: repo://shell/renderer/api/electron_api_ipc_renderer.cc
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# IPC routing and message ports

Electron IPC combines native serialization and transport with JavaScript dispatch. A channel name alone does not identify the receiver: internal traffic, frame traffic, and service-worker traffic take different routes.

## Transport and event identity

The public [ipcRenderer wrapper](../../lib/renderer/api/ipc-renderer.ts) passes `internal = false` to the binding. Native IPC serializes arguments into Blink cloneable messages before sending through the Mojo interface defined in [api.mojom](../../shell/common/api/api.mojom). Calls after the renderer context releases its IPC remote throw; serialization failure stops the send.

The browser handler is associated with a RenderFrameHost and observes its WebContents. It obtains the Session from the frame's BrowserContext, then sends the event and payload through that Session. The event carries its WebContents sender, frame/process identifiers, FrameTreeNode ID, and a reply channel when applicable. Connection loss or WebContents destruction deletes the native handler.

This event identity matters across navigation. JavaScript looks up the frame emitter by FrameTreeNode ID so messages sent while a frame unloads can still be routed after a frame swap. See [native event construction](../../shell/browser/electron_api_ipc_handler_impl.cc) and [dispatch](../../lib/browser/ipc-dispatch.ts).

## Routing semantics

| Incoming operation | Main-side behavior |
| --- | --- |
| Public frame `send` | Emit WebContents `ipc-message`, then the channel on frame IPC, WebContents IPC, and global ipcMain |
| Public frame `invoke` | Select the first registered handler in frame → WebContents → ipcMain order |
| Internal send/invoke | Route through ipcMainInternal |
| Service-worker send/invoke | Resolve the worker by Session/version and use its IPC object |
| `sendSync` | Install a returnValue setter backed by the native reply channel, then dispatch |
| `postMessage` | Wrap transferred ports as MessagePortMain and dispatch the message |

For ordinary frame messages, `event.reply` captures the originating process/frame IDs and uses `sendToFrame`. It is therefore the appropriate existing route when a response must return to the frame that sent the request.

The IpcMainImpl handler map rejects duplicate registrations and nonfunction handlers. `handleOnce` removes the handler before executing it, which also protects the once-only contract during reentry. Removing an EventEmitter listener is not the same operation as removing an invoke handler.

## Invoke completion and failures

An invoke handler can return a value or promise. The dispatcher awaits it and returns an envelope containing `result`; thrown or rejected errors are logged and returned as an `error` string. The renderer wrapper creates a new Error from that string, so callers must not depend on receiving the original Error object or custom properties. A missing handler uses the same failure route.

ReplyChannel consumes its native callback on successful reply. Later attempts return false. If the channel is destroyed with a pending callback, it attempts to send `reply was never sent`; during shutdown it skips sending when no current V8 context exists. This is a lifetime fallback, not a request timeout.

Synchronous sends return only after the native sync response. The dispatcher warns when no frame/WebContents/global listener exists. Avoid introducing a dependency cycle where the main handler needs the blocked renderer to make progress.

## Port transfer

Renderer `postMessage` serializes the message and extracts channels from transferred Blink MessagePorts; invalid transfer entries throw. Main-side dispatch exposes ports as MessagePortMain instances. The wrapper forwards start and close, wraps ports received in subsequent messages, and unwraps MessagePortMain objects when transferring them onward.

Treat transfer as an ownership operation, not object sharing. Existing [IPC specs](../../spec/api-ipc-spec.ts) exercise invalid, duplicate, source, and already-neutered ports, alongside handler rejection, missing handlers, and dropped replies.

## Extension and debugging route

For a new application capability, expose a narrow preload operation through the [context bridge](renderer-isolation.md), choose the intended handler scope, and validate the requesting frame and payload in the receiving policy. Transport supplies identity; registering a channel does not establish application authorization.

For lost messages, follow serialization → native frame/Session → internal/type branch → scoped emitter → handler/reply lifetime. See [windows and WebContents](windows-and-web-contents.md) for navigation and destruction, and [utility processes](node-and-asar.md) for another MessagePort-based integration.
