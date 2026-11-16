---
type: concept
title: Renderer sandbox, preloads and context isolation
description: Renderer preference defaults, isolated preload execution, contextBridge transfer rules and application authorization boundaries.
tags: [security, sandbox, preload, context-bridge]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-a182429dac80030a1ecb8797
    resource: repo://docs/tutorial/security.md
  - id: openwiki-source-3870e9df1305cc5d679a8730
    resource: repo://lib/browser/rpc-server.ts
  - id: openwiki-source-b3bf72a4d1265e1d13612584
    resource: repo://lib/renderer/api/context-bridge.ts
  - id: openwiki-source-b590f9b923c89bac137bd0aa
    resource: repo://lib/renderer/init.ts
  - id: openwiki-source-a887f89c61604389673127b5
    resource: repo://lib/sandboxed_renderer/init.ts
  - id: openwiki-source-231d8cc7d4512ba089cf47a0
    resource: repo://lib/sandboxed_renderer/preload.ts
  - id: openwiki-source-d1b0639183a69d7026a9b782
    resource: repo://shell/browser/web_contents_preferences.cc
  - id: openwiki-source-d0ee1e88153651819cbd3a03
    resource: repo://shell/renderer/api/electron_api_context_bridge.cc
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Renderer sandbox, preloads and context isolation

Electron has distinct controls for OS process sandboxing, Node availability and JavaScript-world isolation. They interact, but none substitutes for the others. The browser owns web preferences and preload selection; renderer initialization implements the environment selected by those settings.

## Defaults and configuration

`WebContentsPreferences::Clear` starts with Node integration disabled for pages, subframes and workers, `webviewTag` disabled, context isolation and web security enabled, and insecure mixed content disabled. Sandbox preference initially has no explicit value. `IsSandboxed()` honors an explicit value; otherwise it enables sandboxing unless page or worker Node integration is enabled. Global command-line policy also participates in process setup, so this preference rule alone does not describe every launched process.

Preload paths supplied through web preferences must be absolute. The renderer frame observer creates an isolated world when context isolation applies and selects the appropriate world for Electron initialization. Preload code and page code can therefore see different JavaScript globals while interacting with the same document.

## Two preload execution paths

| Path | Browser supplies | Renderer executes |
| --- | --- | --- |
| Sandboxed renderer | Preload source/error records plus selected process properties | A function wrapper with a restricted `require`, process shim and supplied globals |
| Nonsandboxed renderer | Preload filenames | CommonJS loads followed by `.mjs` imports through Node's ESM loader |

The browser RPC server collects session preload registrations for the sender's type, adds the WebContents-specific preload for frame senders, and filters to absolute paths. Service-worker senders receive registrations of their own type. This ordering is part of the preload contract.

The sandboxed `require` supports Electron aliases, `events`, `timers`, and `url` (including their listed `node:` aliases). Other modules throw `module not found`; it is not a full Node resolver. Source is compiled with explicitly supplied `require`, `process`, exports/module, Buffer and scheduling globals. Each preload failure is logged and reported through internal IPC, allowing the browser to emit `preload-error` for a frame.

Nonsandboxed initialization loads non-`.mjs` preloads through `Module._load` and then imports `.mjs` preloads sequentially. Node integration controls exposure of page globals such as `require`; having an unsandboxed preload does not itself mean page Node integration is enabled. In a nonisolated environment with Node integration disabled, initialization removes Node globals after the environment's `loaded` event.

## Context bridge contract

The public contextBridge wrapper requires context isolation. `exposeInMainWorld` targets world 0; `exposeInIsolatedWorld` targets a specified world. The native bridge transfers values between contexts, proxies functions and promises, and rejects binding over an existing global property.

Normally the transferred object graph is deep-frozen and the exposed global is read-only and nonconfigurable, with typed-array handling exceptions in the implementation. This checkout also has a `ContextBridgeMutability` feature path that installs the property without those freeze/read-only steps. Consequently, an unconditional statement that every bridge exposure is immutable would miss a supported code path. Inspect that feature when debugging mutability differences.

Design preload APIs around specific operations and validate arguments rather than exposing an unrestricted IPC sender. Cross-world transfer is not application authorization. Main-process handlers must decide whether the sending frame is trusted and whether the requested operation is allowed; the repository's [security guide](../../docs/tutorial/security.md#17-validate-the-sender-of-all-ipc-messages) explicitly calls for sender validation because subframes and child windows may also send IPC.

## Neighboring policy boundaries

[Window-open and webview attachment handlers](../architecture/windows-and-web-contents.md) can deny creation and adjust preferences before a guest starts. Keep main-process preference overrides under trusted control. [Session permission handlers](sessions-and-networking.md) control a different boundary: access to browser/device capabilities, including permission checks and requests. Context isolation does not install an application-specific permission policy.

## Tests and investigation

`spec/api-context-bridge-spec.ts` exercises the bridge with sandbox on and off, read-only properties, value/prototype handling, errors, promises and the mutability feature. `spec/api-browser-window-spec.ts` and `spec/esm-spec.ts` provide neighboring preload and integration cases. For a failed preload, establish the selected sandbox path, absolute registration path and module format first, then inspect `preload-error`. For unexpected privileged access, trace [IPC dispatch](../architecture/ipc-and-message-ports.md) through the receiving scope and its validation.
