---
type: architecture
title: Renderer processes, sandboxing and context isolation
description: How Electron renderers are configured from webPreferences — sandboxed vs Node-integrated renderer clients, which JavaScript world receives the Node environment or preload, how preload scripts are located and executed, the contextBridge value-passing rules, the isolated bundle, web workers with Node and service-worker preload realms.
tags: [architecture, renderer, sandbox, context-isolation, preload, context-bridge, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-3870e9df1305cc5d679a8730
    resource: repo://lib/browser/rpc-server.ts
  - id: openwiki-source-8a4b61c0afab7dad57838c26
    resource: repo://lib/isolated_renderer/init.ts
  - id: openwiki-source-b3bf72a4d1265e1d13612584
    resource: repo://lib/renderer/api/context-bridge.ts
  - id: openwiki-source-b590f9b923c89bac137bd0aa
    resource: repo://lib/renderer/init.ts
  - id: openwiki-source-a887f89c61604389673127b5
    resource: repo://lib/sandboxed_renderer/init.ts
  - id: openwiki-source-231d8cc7d4512ba089cf47a0
    resource: repo://lib/sandboxed_renderer/preload.ts
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-d1b0639183a69d7026a9b782
    resource: repo://shell/browser/web_contents_preferences.cc
  - id: openwiki-source-1d0b4b2283c8d9d06ddc3966
    resource: repo://shell/common/world_ids.h
  - id: openwiki-source-d0ee1e88153651819cbd3a03
    resource: repo://shell/renderer/api/electron_api_context_bridge.cc
  - id: openwiki-source-34f2a2f4a478476d66363979
    resource: repo://shell/renderer/electron_render_frame_observer.cc
  - id: openwiki-source-a24378d8ea89c1ac619c961c
    resource: repo://shell/renderer/electron_renderer_client.cc
  - id: openwiki-source-3d7a5d9e34be7b2e4cc3e775
    resource: repo://shell/renderer/electron_sandboxed_renderer_client.cc
  - id: openwiki-source-caf1d66fdda3f5575ee740de
    resource: repo://shell/renderer/preload_realm_context.cc
  - id: openwiki-source-716a2a2e8bfb52ac62f2cd25
    resource: repo://shell/renderer/renderer_client_base.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Renderer processes, sandboxing and context isolation

Every web page in Electron runs in a Chromium renderer process. Electron adds
optional Node.js integration, preload scripts and a privileged isolated world
on top. Which of these exist in a given frame is decided by a handful of
`webPreferences` that the browser process turns into command-line switches and
Blink preferences for the renderer.

## From webPreferences to renderer configuration

`WebContentsPreferences` (`shell/browser/web_contents_preferences.cc`) parses
the `webPreferences` dictionary. Secure defaults are set in `Clear()`:
`nodeIntegration`, `nodeIntegrationInSubFrames` and
`nodeIntegrationInWorker` are `false`, `contextIsolation` is `true`, and
`sandbox` is unset.

- **Sandbox resolution** — `IsSandboxed()` returns the explicit `sandbox`
  value if set; otherwise renderers are sandboxed *unless* `nodeIntegration`
  or `nodeIntegrationInWorker` is enabled.
- **Switches** — `AppendCommandLineSwitches` adds Electron's `--enable-sandbox`
  switch when the page is sandboxed, or for a cross-origin subframe process
  when `nodeIntegrationInSubFrames` is off; otherwise it adds
  `--no-sandbox` and `--no-zygote`. `nodeIntegrationInWorker` becomes a
  switch too. The remaining preferences (context isolation, node integration
  flags, preload, webview tag, …) are copied into
  `blink::web_pref::WebPreferences` and read in the renderer via
  `render_frame->GetBlinkPreferences()`.

In the renderer, `ElectronMainDelegate::CreateContentRendererClient` picks
**`ElectronSandboxedRendererClient`** when the sandbox switch is present and
**`ElectronRendererClient`** otherwise (see
[Process model and main-process startup](process-model-and-startup.md)). Both
derive from `RendererClientBase`.

## Which world gets Electron's code

Electron uses Blink worlds identified in `shell/common/world_ids.h`:
`MAIN_WORLD_ID = 0` (the page), `ISOLATED_WORLD_ID = 999` (Electron's
preload world when context isolation is on), and a range starting at
`1 << 20` for Chrome extensions.

`ElectronRenderFrameObserver::DidInstallConditionalFeatures`
(`shell/renderer/electron_render_frame_observer.cc`) is the dispatcher:

- `ShouldNotifyClient(world_id)` selects the isolated world when context
  isolation is on (for the main frame, or any frame with
  `nodeIntegrationInSubFrames`), otherwise the main world. Subframes on
  `about:blank` are skipped when sub-frame Node integration is enabled.
- With context isolation, after notifying the client it calls
  `CreateIsolatedWorldContext()` (named "Electron Isolated Context" in
  DevTools, inheriting the document's security origin) and
  `SetupMainWorldOverrides`.
- Child windows created by `window.open` delay initialisation while on the
  initial empty document (except `about:blank`) so they don't start Node with
  the opener's copied preferences before the browser applies their own.

The client's `DidCreateScriptContext` additionally gates on
`RendererClientBase::ShouldLoadPreload`: only main frames, DevTools (and
DevTools extensions), or any frame when `nodeIntegrationInSubFrames` is on —
and never a subframe whose `frameElement` is marked as a `<webview>`
(`IsWebViewFrame`), i.e. the internal frame backing a webview element.

## Non-sandboxed renderers (`ElectronRendererClient`)

`ElectronRendererClient::DidCreateScriptContext`
(`shell/renderer/electron_renderer_client.cc`) creates a **full Node.js
environment per frame context**:

1. Lazily initialises `NodeBindings` and its embed thread (shared uv loop
   per process), then `node::InitializeContext`.
2. **Defers the document load** (`SetDefersLoading(kStrict)`) and passes an
   `UndeferLoad` callback as the environment's `appCodeLoaded`, so async/ESM
   preloads finish before the page body loads.
3. Creates the environment with entry `electron/js2c/renderer_init`, saving
   Blink's `fetch`, `Response`, `FormData`, `Request`, `Headers`,
   `EventSource` as `blink*` globals so `lib/node/init.ts` can restore them
   after Node removes its own.
4. Forces `force_context_aware` (only context-aware native modules may load)
   and `unhandled_rejections = "warn-with-error-code"`.
5. Binds Electron's `process` extensions, loads the environment, and starts
   polling the uv loop the first time.

`lib/renderer/init.ts` then:

- with `nodeIntegration`, exposes `require`, `module`, `__filename` and
  `__dirname` (derived from the `file:` URL) and routes `window.onerror` to
  `process 'uncaughtException'` when listeners exist;
- without `nodeIntegration` and without context isolation, deletes `process`,
  `Buffer`, `setImmediate`, `global` and friends from the page on `loaded`;
- fetches preload paths synchronously from the browser
  (`BROWSER_NONSANDBOX_LOAD`), loads CommonJS preloads with `Module._load`
  and `.mjs` preloads with Node's ESM loader, reports failures back with
  `BROWSER_PRELOAD_ERROR` (surfacing as `webContents` `preload-error`), and
  finally calls `appCodeLoaded` to undefer the page.

`WillReleaseScriptContext` tears the per-frame environment down.

## Sandboxed renderers (`ElectronSandboxedRendererClient`)

Sandboxed renderers have no Node environment. In
`shell/renderer/electron_sandboxed_renderer_client.cc`,
`DidCreateScriptContext` builds a small `binding` object and executes the
`electron/js2c/sandbox_bundle` with `CompileAndCall`, then emits
`process 'loaded'`; `document-start`, `document-end` and `exit` are emitted
the same way.

`lib/sandboxed_renderer/init.ts`:

- synchronously asks the browser for preload scripts **with their contents**
  (`BROWSER_SANDBOX_LOAD`); the browser reads the files
  (`lib/browser/rpc-server.ts`) and also returns a safe subset of `process`
  (`arch`, `platform`, `env`, `version(s)`, `execPath`);
- provides a restricted `require` (`lib/sandboxed_renderer/preload.ts`) that
  only resolves `electron`, `electron/common`, `electron/renderer`, `events`,
  `timers` and `url` (with `node:` variants) and throws
  `module not found` otherwise;
- wraps each preload's source in a function receiving `require`, `process`,
  `exports`, `module`, `Buffer`, `global`, `setImmediate`, `clearImmediate`,
  compiled through `binding.createPreloadScript`.

Preload scripts come from two sources (`getPreloadScriptsFromEvent` in
`rpc-server.ts`): `session.getPreloadScripts()` filtered by type (`frame` or
`service-worker`), plus the window's `webPreferences.preload`. Only absolute
paths are honoured.

## Context isolation and `contextBridge`

With `contextIsolation`, preloads run in world 999 while the page runs in
world 0, sharing the DOM but not JS objects. `contextBridge`
(`lib/renderer/api/context-bridge.ts`, native
`shell/renderer/api/electron_api_context_bridge.cc`) is the only sanctioned
way across, and throws if context isolation is disabled.

- `exposeInMainWorld(key, api)` / `exposeInIsolatedWorld(worldId, …)` refuse
  to overwrite an existing global, copy the value with
  `PassValueToOtherContext`, **deep-freeze** the resulting object and define
  it read-only and non-configurable (unless the
  `ContextBridgeMutability` feature is enabled).
- `PassValueToOtherContext` rules: functions become proxy functions whose
  arguments and return values are copied back across; promises are proxied
  to settle in the other world; plain objects and arrays are recursively
  proxied (depth limit 1000); in window contexts DOM `Element`, `Blob` and
  `VideoFrame` references are passed through as the same underlying objects;
  everything else goes through structured clone (`blink::CloneableMessage`),
  so non-cloneable values throw. An `ObjectCache` preserves identity for
  repeated references within one transfer.
- `executeInMainWorld` runs a function in the main world and clones the result
  back.

### The isolated bundle

`RendererClientBase::SetupMainWorldOverrides` runs the
`electron/js2c/isolated_bundle` in the **main world** only when the
`webviewTag` preference is enabled; its job is to register the `<webview>`
custom element with hooks passed in from the isolated world (see
[The webview tag and guest views](../systems/webview-guests.md)).

## Web workers with Node

When `nodeIntegrationInWorker` is set (as a process switch),
`ElectronRendererClient::WorkerScriptReadyForEvaluationOnWorkerThread`
creates a `WebWorkerObserver`, which starts a Node environment running the
`worker_init` bundle on the worker thread. Service workers, shared workers and
main-thread worklets are explicitly excluded because they run with policies
Electron cannot customise.

## Service-worker preload realms

Service workers can have preloads of type `service-worker` (registered via
`session.registerPreloadScript`). When the browser passes the service-worker
preload switch, `ElectronSandboxedRendererClient::WillEvaluateServiceWorkerOnWorkerThread`
calls `preload_realm::OnCreatePreloadableV8Context`
(`shell/renderer/preload_realm_context.cc`), which creates a Blink
**ShadowRealm** global scope owned by the worker's execution context and runs
`electron/js2c/preload_realm_bundle` inside it. `lib/preload_realm/init.ts`
mirrors the sandboxed preload flow (restricted `require`, `BROWSER_SANDBOX_LOAD`)
so preloads can `contextBridge`-expose APIs to the service worker and talk to
the main process through `ServiceWorkerMain` IPC.

## Security consequences

- Turning on `nodeIntegration` silently disables the sandbox unless `sandbox`
  is explicitly `true`.
- Without context isolation, a non-Node page still shares globals with its
  preload; Electron deletes Node globals but objects the preload attaches to
  `window` are directly reachable by page script.
- `lib/renderer/security-warnings.ts` prints DevTools warnings for insecure
  configurations in development.

IPC used by preloads is covered in [IPC between main and renderer](../systems/ipc.md).
