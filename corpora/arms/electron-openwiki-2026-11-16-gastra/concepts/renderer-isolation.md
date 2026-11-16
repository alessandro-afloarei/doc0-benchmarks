---
type: concept
title: Renderer sandbox, preloads, and context bridge
description: Distinct renderer privilege controls, browser-mediated preload selection, sandboxed and Node-backed loading, and cross-world API conversion.
tags: [renderer, sandbox, preload, context-isolation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
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
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Renderer sandbox, preloads, and context bridge

Sandboxing controls the renderer execution environment; context isolation separates JavaScript worlds; Node integration controls Node exposure. Follow these independently when investigating a preload failure or changing renderer privileges.

## Preferences and process selection

WebContentsPreferences starts with Node integration, worker integration, subframe integration, and webview tags disabled. Context isolation and web security start enabled. Sandbox is initially unspecified: IsSandboxed honors an explicit value, otherwise enables sandboxing unless Node integration or worker Node integration is enabled. Cross-origin subframe processes may also be sandboxed when subframe Node integration is disabled.

These preferences become command-line and Blink preferences. The native main delegate then selects the sandboxed or nonsandboxed renderer client. Do not infer effective process behavior from one JavaScript option without checking this native translation. See [preferences](../../shell/browser/web_contents_preferences.cc) and [process lifecycle](../architecture/process-lifecycle.md).

## Browser-mediated preload selection

The [RPC server](../../lib/browser/rpc-server.ts) starts from Session preload registrations. Frame requests select frame scripts and append the WebContents-specific preload; service-worker requests select service-worker scripts. It filters out nonabsolute paths.

For sandbox loading, the browser reads all selected scripts and returns their contents or read errors along with selected process properties. For nonsandbox loading it returns paths. This explains why identical preload configuration reaches different loaders.

Sandbox renderer initialization provides a restricted require implementation. Its module maps include Electron aliases, events, timers, and url, including the listed node-prefixed aliases. Other modules throw `module not found`. Scripts are compiled into a wrapper supplied with require, a preload process object, exports/module, Buffer, and selected globals. This is not a full Node module loader.

Nonsandbox initialization loads non-.mjs preloads with Module._load, then imports .mjs preloads through Node's ESM loader. Node integration controls global module/require exposure; when disabled without context isolation, Node globals are removed after the loaded event. Preload execution itself still has the dedicated initialization path.

Both loaders catch preload failures, log them, and send an internal preload-error report. The browser forwards frame errors as the WebContents `preload-error` event. One failed preload does not automatically prevent later preloads in these loops from being attempted.

## Crossing JavaScript worlds

The public [contextBridge wrapper](../../lib/renderer/api/context-bridge.ts) requires context isolation. exposeInMainWorld targets world 0; exposeInIsolatedWorld targets a supplied world. Native conversion proxies functions and promises and converts supported values across contexts. This is a conversion boundary, not shared arbitrary object identity.

Native ExposeAPI refuses to overwrite an existing window property. In its normal branch it deep-freezes object APIs except typed-array roots and installs a readonly, nonconfigurable property. There is also an explicit ContextBridgeMutability feature branch that assigns the property directly, so the freeze guarantee must be read with that feature condition. The conversion code rejects excessive recursion with a depth error.

The repository's [context-isolation guide](../../docs/tutorial/context-isolation.md) uses one purpose-specific function per exposed action instead of unrestricted IPC forwarding. Keep receiver-side sender and argument checks when using such a bridge: separating worlds does not decide which application operations a caller may perform.

## Debugging and extension

Trace failures in this order:

1. Effective WebContents preferences and selected renderer client.
2. Session versus per-WebContents preload selection and absolute paths.
3. Browser file-read results, sandbox require restrictions, or CJS/ESM loading.
4. ContextBridge conversion, property collision, and feature-dependent mutability.
5. Main-side IPC handler scope and application policy.

[Context-bridge specs](../../spec/api-context-bridge-spec.ts) generate coverage with both sandbox settings and include conversion, execution, and mutability tests. Changes to one loader should be checked against the other loader and its focused specs. See [IPC](ipc.md) for dispatch, [sessions](sessions-and-networking.md) for registration ownership, and [windows](windows-and-web-contents.md) for inherited child-window preferences.
