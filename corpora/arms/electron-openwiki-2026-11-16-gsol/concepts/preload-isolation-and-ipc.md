---
type: concept
title: Preload isolation and IPC
description: Renderer privilege boundaries, sandbox preload loading, contextBridge exposure, and main-process IPC dispatch and error semantics.
tags: [ipc, preload, sandbox, context-isolation, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-a182429dac80030a1ecb8797
    resource: repo://docs/tutorial/security.md
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-9cf1ec79a43c0d1ad83c2b51
    resource: repo://lib/browser/ipc-main-impl.ts
  - id: openwiki-source-b3bf72a4d1265e1d13612584
    resource: repo://lib/renderer/api/context-bridge.ts
  - id: openwiki-source-90a1c3c767c21f6343b965a7
    resource: repo://lib/renderer/api/ipc-renderer.ts
  - id: openwiki-source-a887f89c61604389673127b5
    resource: repo://lib/sandboxed_renderer/init.ts
  - id: openwiki-source-231d8cc7d4512ba089cf47a0
    resource: repo://lib/sandboxed_renderer/preload.ts
  - id: openwiki-source-d1b0639183a69d7026a9b782
    resource: repo://shell/browser/web_contents_preferences.cc
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Preload isolation and IPC

Renderer communication crosses two boundaries: JavaScript worlds within a renderer, and processes between renderer and browser. Context isolation controls the first boundary; sandboxing and Node integration affect process privileges. IPC connects privileged handlers to renderer requests.

## Preferences and preload environments

WebContents preferences initialize Node integration to false and context isolation to true. Sandboxing uses an explicit preference when set; otherwise enabling Node integration or Node integration in workers disables its default. Changes to these preferences need review across native renderer selection and JavaScript initialization.

The unsandboxed renderer initializer exposes Node module globals only when Node integration is enabled. It fetches preload paths through internal IPC, loads non-`.mjs` preloads through CommonJS, and imports `.mjs` preloads with Node's ESM loader. Preload errors are logged and sent to the browser through the internal preload-error channel.

Sandboxed preloads use a restricted environment. Initialization obtains preload source and process properties from the browser, then provides Electron aliases, events, timers, and URL modules through an allowlisted require implementation. Unknown modules throw `module not found`. This require is not unrestricted Node module resolution. Each preload runs in a wrapper with explicitly provided globals; one failing preload is reported without aborting the loop over remaining preloads.

## Exposing a capability

`contextBridge.exposeInMainWorld` and `exposeInIsolatedWorld` check `process.contextIsolated` before forwarding to the native context bridge. The former targets world 0. Setting a property in a preload's world is therefore different from deliberately exposing a public API.

Follow the repository's [context isolation guide](../../docs/tutorial/context-isolation.md) and [IPC security guidance](../../docs/tutorial/security.md#17-validate-the-sender-of-all-ipc-messages): expose narrow methods for specific operations and validate the sender and arguments in privileged handlers. Callback wrappers should pass intended data rather than exposing the raw Electron event or unrestricted IPC methods.

## Message flow and routing

`ipcRenderer` wraps a linked native renderer binding. Native methods serialize arguments before using the Mojo `ElectronApiIPC` interface; `send`, `invoke`, synchronous messages, host messages, and transferable postMessage are separate operations.

The browser dispatcher distinguishes internal traffic from public traffic using hidden event metadata. Internal messages go to `ipcMainInternal`. For ordinary frame messages, it emits the WebContents message event and dispatches to frame IPC, WebContents IPC, and global ipcMain. Frame lookup uses FrameTreeNode identity so messages sent during frame swaps can still find their target.

`event.reply` targets the sending process/frame pair. This matters for subframes: replying through the originating event preserves the return destination.

## Invoke semantics and failure

Invoke searches handlers in frame, WebContents, then global order and runs the first target registered for that channel. Service-worker events take a separate route through their session's worker IPC emitter. A handler may return a value or a promise.

`IpcMainImpl` rejects a second handler for the same channel and non-function handlers. `handleOnce` removes its registration before running user code. Missing handlers and thrown or rejected handler errors produce error replies; `ipcRenderer.invoke` turns that error field into a rejected Error with channel context. The original main-process Error object is not returned intact.

For event-style synchronous messages, assigning `event.returnValue` sends the reply. Prefer examining the distinct invoke and event dispatch paths when investigating ordering or missing responses.

## Verification and related systems

`spec/api-ipc-spec.ts` covers synchronous/asynchronous invoke results, failures, removed and duplicate handlers, ordering, and MessagePorts. `spec/api-context-bridge-spec.ts` covers world exposure. Test configurations sometimes disable isolation to reach APIs directly; those fixtures do not define application defaults.

See [runtime bootstrap](../architecture/runtime-and-bootstrap.md), [windows and navigation](../architecture/windows-and-navigation.md), and [runtime testing](../testing/runtime-and-api-tests.md) for lifecycle and harness context.
