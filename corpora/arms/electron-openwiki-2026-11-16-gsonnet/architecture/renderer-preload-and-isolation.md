---
type: architecture
title: Renderer, Preload Scripts, Sandbox and Context Isolation
description: Renderer-process runtime in Electron - how sandboxed and non-sandboxed renderer clients differ, how preload scripts are delivered and executed, how the isolated world and contextBridge work, and how the preload realm and web workers are initialized.
tags: [renderer, preload, sandbox, context-isolation, contextBridge, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
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
  - id: openwiki-source-6be287828600a8b9ac7bf6b1
    resource: repo://lib/worker/init.ts
  - id: openwiki-source-345e688b355d3b46d32f6523
    resource: repo://shell/app/command_line_args.cc
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
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
  - id: openwiki-source-716a2a2e8bfb52ac62f2cd25
    resource: repo://shell/renderer/renderer_client_base.cc
  - id: openwiki-source-7bed76810b0c02e94e87678f
    resource: repo://shell/renderer/web_worker_observer.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Renderer, Preload Scripts, Sandbox and Context Isolation

A renderer process hosts Blink and V8 for web content. Electron adds a per-process "renderer client" (a `content::ContentRendererClient`) plus per-frame hooks that run the Electron renderer bundles, load preload scripts, and optionally create an isolated JavaScript world. Which path is taken depends on the `webPreferences` of the owning `WebContents`.

## Choosing the runtime: sandbox, nodeIntegration, contextIsolation

`WebContentsPreferences` (`shell/browser/web_contents_preferences.cc`) parses `webPreferences`. Defaults are `nodeIntegration = false`, `nodeIntegrationInSubFrames = false`, `nodeIntegrationInWorker = false`, `contextIsolation = true`, and `sandbox` unset. `IsSandboxed()` returns the explicit value if one was given; otherwise it is `true` unless `nodeIntegration` or `nodeIntegrationInWorker` is on, which is how the sandbox became default-on while still letting Node-enabled windows work.

When launching a renderer, `WebContentsPreferences::AppendCommandLineSwitches` adds `--enable-sandbox` if the contents is sandboxed, or if the frame is a cross-origin subframe not covered by `nodeIntegrationInSubFrames`; otherwise it adds `--no-sandbox` and `--no-zygote`. In the child, `ElectronMainDelegate::CreateContentRendererClient` reads that switch (`IsSandboxEnabled`) and instantiates one of two clients:

| | `ElectronSandboxedRendererClient` | `ElectronRendererClient` |
| --- | --- | --- |
| Node.js | not available; no `node::Environment` | full Node environment per frame (when node integration/preload is allowed) |
| JS bundle | `sandbox_bundle` compiled directly and called with a `binding` object | `renderer_init` run as the Node environment's entry |
| Preload | source read in the main process and delivered over IPC, run in a wrapper function | loaded via Node's `Module._load` (or ESM loader for `.mjs`) |

## Non-sandboxed renderers

In `ElectronRendererClient::DidCreateScriptContext` (`shell/renderer/electron_renderer_client.cc`), after `ShouldLoadPreload` passes (the frame is the main frame, or devtools, or `nodeIntegrationInSubFrames` is enabled, and it is not a `<webview>` guest frame):

1. Node bindings and the embed thread are initialized once per process, and a Node tracing agent is set.
2. `node::InitializeContext` prepares the Blink context for Node.
3. Blink is told to **defer loading the document** (`SetDefersLoading(kStrict)`) until the preload finishes. This lets async (ESM) preloads win the race with page scripts; the `appCodeLoaded` callback passed into the environment calls `UndeferLoad`.
4. A `node::Environment` is created, `fetch`, `Request`, `Response`, `Headers`, `FormData` and `EventSource` are saved as `blink*` globals and restored by the init script (Node deletes its own copies), `force_context_aware` is set, and unhandled rejections are warn-only.
<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. `LoadEnvironment` runs `lib/renderer/init.ts`. The first environment also becomes the "uv env" that drives the libuv loop ([event loop integration](/openwiki/architecture/node-chromium-integration.md)).

`lib/renderer/init.ts` then blocks `vm` use with a warning, rewrites `Module.wrapper` so preloads always get `process`, `global` and `Buffer`, requires the shared init, and reads the `nodeIntegration` preference. With node integration it exposes `require`/`module`, `__filename`/`__dirname` (derived from a `file:` URL when applicable) and maps `window.onerror` to `uncaughtException`; without it, it deletes `process`, `Buffer`, `setImmediate`, `clearImmediate` and `global` after the environment's `loaded` event (unless context isolation is on, in which case they live only in the isolated context). It then asks the main process for preload paths via synchronous IPC `BROWSER_NONSANDBOX_LOAD`, loads CommonJS preloads with `Module._load`, and ESM (`.mjs`) preloads with `runEntryPointWithESMLoader`. A throwing preload is reported with `BROWSER_PRELOAD_ERROR`, which the main process re-emits as `preload-error` on the `WebContents`. Finally `appCodeLoaded()` releases the deferred document load.

## Sandboxed renderers

`ElectronSandboxedRendererClient::DidCreateScriptContext` also applies `ShouldLoadPreload`. It builds a `binding` object (`get` for linked bindings, `createPreloadScript`, and a partial `process` containing `uptime`, `argv`, `pid`, `sandboxed: true`, `type: 'renderer'`), then compiles and calls `electron/js2c/sandbox_bundle` with it and fires the `loaded` process event. `RunScriptsAtDocumentStart/End` emit `document-start` / `document-end` on the preload process.

The bundle (`lib/sandboxed_renderer/pre-init.ts` and `init.ts`):

- `pre-init` exposes `process._linkedBinding = binding.get`, stores a `Buffer` shim for C++ deserialization of buffers sent from the browser, and converts the webpack `process` into an `EventEmitter`.
- `init` synchronously invokes `BROWSER_SANDBOX_LOAD`; the main process (`lib/browser/rpc-server.ts`) answers with the preload scripts' **file contents** (it reads them with `fs`) plus a small subset of `process` (`arch`, `platform`, `env`, `version`, `versions`, `execPath`). Preloads are collected from the session's registered scripts of type `frame` and the `webPreferences.preload` script, and only absolute paths are accepted.
- `lib/sandboxed_renderer/preload.ts` runs each script by wrapping it in a function `(require, process, exports, module, ...globals)` evaluated in window scope. Its `require` serves only an allow-list: `electron`, `electron/common`, `electron/renderer`, `events`/`node:events`, and lazily `timers`/`url` (plus `node:` forms). Anything else throws `module not found: <name>`. The preload `process` is a fresh `EventEmitter` with only whitelisted properties; `_linkedBinding` is exposed only with the `unsafely-expose-electron-internals-for-testing` switch.

This is the practical security difference: sandboxed preloads never see Node built-ins like `fs` or `child_process`.

## Context isolation and the isolated world

When `contextIsolation` is on, `ElectronRenderFrameObserver::DidCreateScriptContext` (`shell/renderer/electron_render_frame_observer.cc`) decides which world receives Electron's runtime. For main frames (or subframes with node integration), the preload and Electron APIs are loaded into **isolated world 999** (`WorldIDs::ISOLATED_WORLD_ID` in `shell/common/world_ids.h`; the main world is 0) and `CreateIsolatedWorldContext` creates that context early, copying the document's origin policy. `ShouldNotifyClient` therefore routes `DidCreateScriptContext` to the isolated world instead of the main world in that case. `SetupMainWorldOverrides` then runs the `isolated_bundle` inside the *main* world with an `isolatedApi` object; this only does something when `<webview>` is enabled, installing the web view custom element in the page's own world.

Because the preload runs in a different world than page scripts, page JavaScript cannot see or tamper with preload globals. The sanctioned bridge is `contextBridge` (`lib/renderer/api/context-bridge.ts` over `shell/renderer/api/electron_api_context_bridge.cc`):

- `exposeInMainWorld(key, api)` and `exposeInIsolatedWorld(worldId, key, api)` throw unless `process.contextIsolated` is true. `executeInMainWorld` runs a script in the main world.
- Values are **proxied or cloned** across worlds by `PassValueToOtherContext`: primitives are copied, **plain objects** (anything `IsPlainObject` accepts, i.e. not arrays, dates, errors, promises, maps, sets, typed arrays, proxies, etc.) get a proxy object built by `CreateProxyForAPI`, with an object cache that preserves shared references, and recursion is capped at depth 1000. Functions become proxy functions whose arguments and return values are bridged again, promises are proxied, errors are reduced to a new `Error` carrying the message, arrays are rebuilt element by element, and other values must be structured-cloneable (they are copied through a `CloneableMessage`; otherwise V8's serializer throws). Prototypes are not shared across the bridge, so class identity and prototype chains of bridged values do not leak into the other world.
- Binding over an existing window property fails ("Cannot bind an API on top of an existing property on the window object").

## Preload realm, service workers and web workers

- **Preload realm** (`lib/preload_realm/init.ts`, `shell/renderer/preload_realm_context.cc`): a separate V8 context for service-worker preloads. It uses the same sandboxed preload machinery with a smaller module allow-list (`electron`, `electron/common`, `events`, `url`) and fetches its scripts through the same IPC, with the service-worker flavour. `ElectronSandboxedRendererClient::WillEvaluateServiceWorkerOnWorkerThread` creates the realm when the service-worker-preload switch is present.
- **Web workers** (`lib/worker/init.ts`, `shell/renderer/web_worker_observer.cc`): when `nodeIntegrationInWorker` is on, a Node environment is created for each worker with its own `uv_loop_t`, `require` and `module` are set up, and Blink's `fetch` family is restored from the `blink*` globals.

## Common renderer init

<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`lib/renderer/common-init.ts` (shared by both renderer bundles) sets up the native IPC bridge (`ipc-native-setup`), overrides inspector APIs for `devtools:` pages, installs window overrides (`windowSetup`), initializes the `<webview>` tag in the main frame, runs `webFrameInit`, and emits security warnings (`security-warnings.ts`) in the main frame. See [IPC](/openwiki/architecture/ipc.md) for how `ipcRenderer` reaches the main process.

## Tests and operational notes

<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`spec/api-context-bridge-spec.ts`, `spec/api-web-frame-spec.ts`, `spec/chromium-spec.ts` and `spec/api-browser-window-spec.ts` cover context-bridge copy semantics, world behavior and preload execution. For fuses that further restrict this surface see [fuses and security model](/openwiki/security/fuses-and-security-model.md); for the owner of `webPreferences`, see [WebContents and windows](/openwiki/architecture/web-contents-and-windows.md).
