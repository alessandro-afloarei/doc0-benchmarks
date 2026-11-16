---
title: "Renderer Processes and Preload Scripts"
---
## Overview

A renderer process runs Blink and V8 for one or more web pages. Electron adds two things to it: optionally a full Node.js environment, and the preload scripts an app registers to run before the page's own code. Which of those a renderer gets depends on the `WebContents`'s web preferences: the main process turns them into command-line switches, and the switch `--enable-sandbox` or `--no-sandbox` decides whether `ElectronMainDelegate` creates an `ElectronSandboxedRendererClient` or an `ElectronRendererClient` ([[Process Model and Native Startup]]). Both derive from `RendererClientBase`.

Sources: [shell/app/electron_main_delegate.cc:462-473](repo://shell/app/electron_main_delegate.cc#L462-L473), [shell/browser/web_contents_preferences.cc:308-325](repo://shell/browser/web_contents_preferences.cc#L308-L325)

This page follows a frame from creation to the point where its preload scripts have run, for both clients, and then covers web workers, service-worker preloads and the developer security warnings. The separate world that context isolation creates, and `contextBridge`, are in [[Context Isolation and contextBridge]]; the IPC calls preloads use are in [[Inter-Process Communication]].

Sources: [shell/renderer/electron_render_frame_observer.cc:90-148](repo://shell/renderer/electron_render_frame_observer.cc#L90-L148)

## Shared renderer setup

### RendererClientBase

When the render thread starts, `RendererClientBase::RenderThreadStarted` registers `webview` and `browserplugin` as embedder custom elements, applies the privileged-scheme lists the main process passed on the command line (fetch, service worker, CSP-bypassing and code-cache schemes), gives `file:` service-worker and fetch support when the `GrantFileProtocolExtraPrivileges` fuse is on, and sets up the extensions and spellcheck clients when built in.

Sources: [shell/renderer/renderer_client_base.cc:212-297](repo://shell/renderer/renderer_client_base.cc#L212-L297)

For every new frame, `RenderFrameCreated` attaches the per-frame helpers: an autofill agent, a `ContentSettingsObserver`, the print helper, and `ElectronApiServiceImpl`, the receiver for messages the main process sends to this frame. Each client also creates an `ElectronRenderFrameObserver` for the frame.

Sources: [shell/renderer/renderer_client_base.cc:306-343](repo://shell/renderer/renderer_client_base.cc#L306-L343), [shell/renderer/electron_renderer_client.cc:55-59](repo://shell/renderer/electron_renderer_client.cc#L55-L59)

### Which contexts get Electron

`ElectronRenderFrameObserver::DidInstallConditionalFeatures` runs whenever Blink creates a script context and decides whether to pass it to the client. `ShouldNotifyClient` picks the world: with context isolation, Electron's code runs in the isolated world (`ISOLATED_WORLD_ID`); without it, in the main world. Blank `about:blank` subframes are skipped when `nodeIntegrationInSubFrames` is on, because tearing down their Node environment later would break the navigation that replaces them.

Sources: [shell/renderer/electron_render_frame_observer.cc:126-148](repo://shell/renderer/electron_render_frame_observer.cc#L126-L148), [shell/renderer/electron_render_frame_observer.cc:191-211](repo://shell/renderer/electron_render_frame_observer.cc#L191-L211)

A window opened with `window.open` starts on an initial empty document that inherited its opener's preferences before the main process could override them. The observer delays Node setup for such a frame until the real page loads, unless the URL is `about:blank`, which never navigates further.

Sources: [shell/renderer/electron_render_frame_observer.cc:93-119](repo://shell/renderer/electron_render_frame_observer.cc#L93-L119)

`RendererClientBase::ShouldLoadPreload` then limits preloads to the main frame, DevTools and DevTools extensions, or any frame when `nodeIntegrationInSubFrames` is on, and never to a `<webview>`'s embedder-side frame.

Sources: [shell/renderer/renderer_client_base.cc:198-210](repo://shell/renderer/renderer_client_base.cc#L198-L210)

When context isolation is on, the observer also creates the isolated world ("Electron Isolated Context" in DevTools) with the document's origin. If the page may use `<webview>`, `SetupMainWorldOverrides` then runs the `isolated_bundle` in the main world, handing it the `<webview>` internals from the isolated world so the element can be defined where the page can see it.

Sources: [shell/renderer/electron_render_frame_observer.cc:136-148](repo://shell/renderer/electron_render_frame_observer.cc#L136-L148), [shell/renderer/electron_render_frame_observer.cc:173-189](repo://shell/renderer/electron_render_frame_observer.cc#L173-L189), [shell/renderer/renderer_client_base.cc:568-610](repo://shell/renderer/renderer_client_base.cc#L568-L610)

## Renderers with Node.js

### Creating the environment

`ElectronRendererClient::DidCreateScriptContext` builds one Node environment per eligible context. The first time, it initialises `NodeBindings` and starts the embed thread. It then initialises the context for Node and, before loading anything, tells Blink to defer loading the document body. It creates the environment with a callback that undefers the load, saves Blink's `fetch`, `Response`, `FormData`, `Request`, `Headers` and `EventSource` as `blinkFetch` and so on (Node removes its own when its fetch is disabled), forces context-aware native modules, makes unhandled rejections warn, binds `process.isMainFrame`, `process.contextIsolated` and `process.contextId`, and loads the environment. The first environment becomes the one the uv loop runs in. [[Node.js Integration and Event Loops]] covers what happens inside `CreateEnvironment`.

Sources: [shell/renderer/electron_renderer_client.cc:92-178](repo://shell/renderer/electron_renderer_client.cc#L92-L178), [shell/renderer/renderer_client_base.cc:186-196](repo://shell/renderer/renderer_client_base.cc#L186-L196)

The deferral is what lets preload scripts be asynchronous. The page cannot start running until the preload calls `process.appCodeLoaded`, which is bound to `UndeferLoad`.

Sources: [shell/renderer/electron_renderer_client.cc:116-131](repo://shell/renderer/electron_renderer_client.cc#L116-L131), [shell/renderer/electron_renderer_client.cc:87-90](repo://shell/renderer/electron_renderer_client.cc#L87-L90)

`RunScriptsAtDocumentStart` and `RunScriptsAtDocumentEnd` emit `document-start` and `document-end` on `process`, and `WillReleaseScriptContext` emits `exit` and destroys the environment, detaching the uv loop if it was the main one.

Sources: [shell/renderer/electron_renderer_client.cc:61-85](repo://shell/renderer/electron_renderer_client.cc#L61-L85), [shell/renderer/electron_renderer_client.cc:180-206](repo://shell/renderer/electron_renderer_client.cc#L180-L206)

### lib/renderer/init.ts

The environment runs `renderer_init`. It warns when the `vm` module is loaded, replaces `Module.wrapper` so preload modules always receive `process`, `global` and `Buffer`, strips its own path from `argv`, and runs the common initialisation. `common-init.ts` sets up native IPC, applies the `window` overrides for normal pages or DevTools-specific overrides for `devtools:` pages, initialises the `<webview>` element in main frames, and schedules the security warnings.

Sources: [lib/renderer/init.ts:10-61](repo://lib/renderer/init.ts#L10-L61), [lib/renderer/common-init.ts:1-48](repo://lib/renderer/common-init.ts#L1-L48)

With `nodeIntegration` on, the page gets a real `require` and `module`. For a `file:` page, `__filename` and `__dirname` point at the HTML file so relative `require` works; otherwise module paths come from the app path. `window.onerror` is forwarded to `process`'s `uncaughtException` listeners. With `nodeIntegration` off and no context isolation, `process`, `Buffer`, `global`, `setImmediate` and friends are deleted from the window once the environment has loaded, so the page never sees them.

Sources: [lib/renderer/init.ts:65-130](repo://lib/renderer/init.ts#L65-L130)

### Loading preloads

`init.ts` asks the main process for the preload list with a synchronous internal IPC call, `BROWSER_NONSANDBOX_LOAD`. The main process collects the session's frame preloads plus the `WebContents`'s `webPreferences.preload`, keeps only absolute paths, and returns them. CommonJS preloads load with `Module._load`; `.mjs` preloads load through Node's ESM loader, and `appCodeLoaded` is called only after they settle. A failing preload is logged and reported as `BROWSER_PRELOAD_ERROR`, which the main process emits as `preload-error` on the `webContents`.

Sources: [lib/renderer/init.ts:132-168](repo://lib/renderer/init.ts#L132-L168), [lib/browser/rpc-server.ts:52-70](repo://lib/browser/rpc-server.ts#L52-L70), [lib/browser/rpc-server.ts:104-112](repo://lib/browser/rpc-server.ts#L104-L112)

## Sandboxed renderers

### The binding object

A sandboxed renderer has no Node.js. `ElectronSandboxedRendererClient` registers Electron's linked bindings once and, for each eligible context, creates a `binding` object and runs `sandbox_bundle` with it as the only argument. `binding.get` loads a linked binding by name, caching it per context; `binding.createPreloadScript` compiles and runs a source string in the page's context; `binding.process` carries `pid`, `argv`, `uptime`, the memory and CPU helpers, `sandboxed: true` and `type: 'renderer'`.

Sources: [shell/renderer/electron_sandboxed_renderer_client.cc:62-85](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L62-L85), [shell/renderer/electron_sandboxed_renderer_client.cc:110-139](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L110-L139), [shell/renderer/preload_utils.cc:20-71](repo://shell/renderer/preload_utils.cc#L20-L71)

### lib/sandboxed_renderer/init.ts

`pre-init.ts` turns `binding.get` into `process._linkedBinding`, copies `binding.process` onto `process`, stores the `Buffer` shim where C++ can find it, and makes `process` an `EventEmitter`. `init.ts` then makes one synchronous `BROWSER_SANDBOX_LOAD` call, to which the main process replies with every preload script's contents (it reads the files, since the sandbox cannot) and a few process properties: `arch`, `platform`, a copy of `env`, `version`, `versions` and `execPath`.

Sources: [lib/sandboxed_renderer/pre-init.ts:1-30](repo://lib/sandboxed_renderer/pre-init.ts#L1-L30), [lib/sandboxed_renderer/init.ts:1-22](repo://lib/sandboxed_renderer/init.ts#L1-L22), [lib/browser/rpc-server.ts:72-102](repo://lib/browser/rpc-server.ts#L72-L102)

The C++ client reaches the bundle's `process` emitter through a hidden global function, `emit-process-event`, so `loaded`, `document-start`, `document-end` and `exit` fire on both `process` and the preload's own process object.

Sources: [lib/sandboxed_renderer/init.ts:40-47](repo://lib/sandboxed_renderer/init.ts#L40-L47), [shell/renderer/electron_sandboxed_renderer_client.cc:39-58](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L39-L58), [shell/renderer/electron_sandboxed_renderer_client.cc:141-171](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L141-L171)

### Running sandboxed preloads

`executeSandboxedPreloadScripts` wraps each script's source in a function taking `require`, `process`, `exports`, `module`, `Buffer`, `global`, `setImmediate` and `clearImmediate`, compiles it with `createPreloadScript`, and calls it. The `require` it passes is not Node's: it returns modules from a fixed map (`electron`, `electron/common`, `electron/renderer`, `events`) or lazily loads `timers` and `url`, and throws "module not found" for anything else. The preload's `process` is a separate `EventEmitter` with the copied properties and `getProcessMemoryInfo`; tests can also get `_linkedBinding` through a dedicated switch. Errors are reported the same way as in non-sandboxed renderers.

Sources: [lib/sandboxed_renderer/preload.ts:19-101](repo://lib/sandboxed_renderer/preload.ts#L19-L101), [lib/sandboxed_renderer/init.ts:23-71](repo://lib/sandboxed_renderer/init.ts#L23-L71)

## Workers and service workers

### Web workers

Dedicated workers get Node only when the renderer was started with `--node-integration-in-worker`; service workers, shared workers and main-thread worklets never do, because they run out of process with policies Electron cannot set. `WebWorkerObserver` keeps one `NodeBindings` per worker thread with its own uv loop, creates the environment with the same Blink-fetch preservation, and emits `exit` and frees it when the worker context is destroyed.

Sources: [shell/renderer/electron_renderer_client.cc:208-247](repo://shell/renderer/electron_renderer_client.cc#L208-L247), [shell/renderer/web_worker_observer.cc:40-131](repo://shell/renderer/web_worker_observer.cc#L40-L131)

### Service-worker preload realm

A session can also register preloads of type `service-worker`. When it has any, renderers are started with `--service-worker-preload`, and before a service worker's script is evaluated the sandboxed client creates a `ShadowRealm`-backed preload realm next to it with `preload_realm::OnCreatePreloadableV8Context`. The realm runs `preload_realm_bundle`, which, like the sandbox bundle, asks the main process for the scripts with `BROWSER_SANDBOX_LOAD` (the main process filters by the `service-worker` type) and runs them with an even smaller `require`: `electron`, `electron/common`, `events` and `url`.

Sources: [shell/browser/electron_browser_client.cc:588-597](repo://shell/browser/electron_browser_client.cc#L588-L597), [shell/renderer/electron_sandboxed_renderer_client.cc:173-195](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L173-L195), [shell/renderer/preload_realm_context.cc:152-190](repo://shell/renderer/preload_realm_context.cc#L152-L190), [lib/preload_realm/init.ts:1-58](repo://lib/preload_realm/init.ts#L1-L58), [lib/browser/rpc-server.ts:52-66](repo://lib/browser/rpc-server.ts#L52-L66)

## Security warnings

In the main frame, `securityWarnings` waits for `load`, then fetches the last web preferences from the main process and logs console warnings for risky setups: Node integration with remote content, `webSecurity` disabled, resources loaded over insecure protocols, `allowRunningInsecureContent`, `experimentalFeatures`, extra `enableBlinkFeatures`, a missing or unsafe Content Security Policy, and `allowpopups` on `<webview>`. The warnings only appear when running the unpackaged `electron` binary, unless `ELECTRON_ENABLE_SECURITY_WARNINGS` is set on the process environment or the window; `ELECTRON_DISABLE_SECURITY_WARNINGS` turns them off.

Sources: [lib/renderer/security-warnings.ts:18-50](repo://lib/renderer/security-warnings.ts#L18-L50), [lib/renderer/security-warnings.ts:264-293](repo://lib/renderer/security-warnings.ts#L264-L293)
