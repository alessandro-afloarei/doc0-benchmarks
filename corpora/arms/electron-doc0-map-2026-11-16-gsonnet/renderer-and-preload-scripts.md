---
title: "Renderer, Preload Scripts and Context Isolation"
---
## Overview

In a renderer process, Electron runs code before the page's own scripts: a preload script, and in the right configuration a whole Node.js environment. Three web preferences decide how that code is arranged: `nodeIntegration` (Node in the page), `sandbox` (no Node, a restricted preload) and `contextIsolation` (the preload runs in a separate JavaScript world from the page). The C++ renderer clients create the contexts and run the bootstrap bundles listed in [[Process Types and JavaScript Bootstraps]]; this page covers how they pick between them, how preload scripts are located and run, and how `contextBridge` moves values between the isolated world and the page.

Sources: [shell/browser/web_contents_preferences.cc:161-178](repo://shell/browser/web_contents_preferences.cc#L161-L178), [shell/browser/web_contents_preferences.cc:280-286](repo://shell/browser/web_contents_preferences.cc#L280-L286)

## Preference defaults

`WebContentsPreferences::Clear` sets `node_integration_` to false and `context_isolation_` to true. `IsSandboxed` honours an explicit `sandbox` setting; otherwise a window is sandboxed unless `nodeIntegration` or `nodeIntegrationInWorker` is on. So a plain window is sandboxed and isolated, and turning Node on is what switches the sandbox off by default.

Sources: [shell/browser/web_contents_preferences.cc:114-120](repo://shell/browser/web_contents_preferences.cc#L114-L120), [shell/browser/web_contents_preferences.cc:280-286](repo://shell/browser/web_contents_preferences.cc#L280-L286)

The renderer chooses its client class from the same decision. `ElectronMainDelegate::CreateContentRendererClient` creates an `ElectronSandboxedRendererClient` when the process is sandboxed and an `ElectronRendererClient` otherwise; both derive from `RendererClientBase`. See [[Main Process Startup]].

Sources: [shell/app/electron_main_delegate.cc:462-473](repo://shell/app/electron_main_delegate.cc#L462-L473)

## Which frames get preloads

`RendererClientBase::ShouldLoadPreload` allows a preload (and a Node environment) in the main frame, in DevTools and DevTools extensions, and in subframes only when `nodeIntegrationInSubFrames` is set; frames that are `<webview>` guests are always excluded. It also decides which JavaScript context counts as "the" context: `GetContext` returns the isolated world (`ISOLATED_WORLD_ID`) when context isolation is on, else the main world.

Sources: [shell/renderer/renderer_client_base.cc:198-210](repo://shell/renderer/renderer_client_base.cc#L198-L210), [shell/renderer/renderer_client_base.cc:536-566](repo://shell/renderer/renderer_client_base.cc#L536-L566)

World numbers come from `world_ids.h`: the main world is 0, Electron's isolated world is 999 ("a high number far away from 0 to not collide with any other world IDs created internally by Chrome"), and extension worlds start at `1 << 20`.

Sources: [shell/common/world_ids.h:12-26](repo://shell/common/world_ids.h#L12-L26)

## Creating the contexts

`ElectronRenderFrameObserver` receives Blink's callbacks for every frame. On `DidInstallConditionalFeatures` it notifies the renderer client with `DidCreateScriptContext` (if the world is the right one), and when context isolation is on, the world is the main world and the frame is a main frame (or sub-frame Node is allowed), it creates the isolated world and, unless this is a webview frame, runs `SetupMainWorldOverrides`.

Sources: [shell/renderer/electron_render_frame_observer.cc:90-148](repo://shell/renderer/electron_render_frame_observer.cc#L90-L148)

A workaround sits at the top of that method: a child window opened with `window.open` copies its parent's preferences and Chromium initializes its context at once, before the browser can override them. To keep a child from getting Node with `nodeIntegration=no`, initialization is delayed while the frame is still on the initial empty document, unless the URL is `about:blank`, which never navigates. `DidClearWindowObject` then performs the delayed initialization.

Sources: [shell/renderer/electron_render_frame_observer.cc:70-88](repo://shell/renderer/electron_render_frame_observer.cc#L70-L88), [shell/renderer/electron_render_frame_observer.cc:93-120](repo://shell/renderer/electron_render_frame_observer.cc#L93-L120)

`SetupMainWorldOverrides` only does work when the `webview` tag is enabled: it builds an `isolatedApi` object with two methods and a `guestViewInternal` value passed from the isolated world, and runs the `isolated_bundle` in the main world, so `<webview>` can be defined where the page can see it.

Sources: [shell/renderer/renderer_client_base.cc:568-609](repo://shell/renderer/renderer_client_base.cc#L568-L609)

## Non-sandboxed renderer with Node

`ElectronRendererClient::DidCreateScriptContext` builds a real Node environment in the page's context. In order: it exits if `ShouldLoadPreload` is false; initializes `NodeBindings` once per process and prepares the embed thread; sets up a Node tracing agent; calls `node::InitializeContext`; defers the document body load (`LoaderFreezeMode::kStrict`) until the preload finishes, so an asynchronous (ESM) preload cannot race page scripts; creates the environment with `UndeferLoad` as the "app code ready" callback; saves Blink's `fetch`, `Response`, `FormData`, `Request`, `Headers` and `EventSource` under `blink`-prefixed names because Node deletes them; forces context-aware modules; sets unhandled rejections to warn; binds Electron's `process` extensions; and calls `LoadEnvironment`. See [[Node.js Integration and the Event Loop]] for the loop.

Sources: [shell/renderer/electron_renderer_client.cc:92-178](repo://shell/renderer/electron_renderer_client.cc#L92-L178)

`lib/renderer/init.ts` then runs in that environment and ends with `appCodeLoaded()`, which is what lifts the deferral. Teardown is symmetric: `WillReleaseScriptContext` emits `exit` on `process`, drops the environment and clears the loop's environment pointer if it was the main one. Web workers get Node only when `nodeIntegrationInWorker` is set, and never in service, shared or main-thread worklet contexts.

Sources: [lib/renderer/init.ts:133-168](repo://lib/renderer/init.ts#L133-L168), [shell/renderer/electron_renderer_client.cc:180-230](repo://shell/renderer/electron_renderer_client.cc#L180-L230)

## Sandboxed renderer

`ElectronSandboxedRendererClient::DidCreateScriptContext` does no Node setup. After the same `ShouldLoadPreload` check it builds a `binding` object with `get` (the linked-binding getter), `createPreloadScript`, and a `process` object (pid, `sandboxed: true`, `type: "renderer"`, uptime, argv and the common `BindProcess` fields), compiles `electron/js2c/sandbox_bundle` with `binding` as its parameter, and emits `loaded` on the process. The bundle's side is in [[Process Types and JavaScript Bootstraps]].

Sources: [shell/renderer/electron_sandboxed_renderer_client.cc:70-90](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L70-L90), [shell/renderer/electron_sandboxed_renderer_client.cc:110-139](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L110-L139)

## Finding and running preload scripts

The renderer asks the main process which scripts to run, using synchronous internal IPC ([[IPC Messaging]]): `BROWSER_NONSANDBOX_LOAD` for unsandboxed renderers and `BROWSER_SANDBOX_LOAD` for sandboxed ones. Both go through `getPreloadScriptsFromEvent` in `rpc-server.ts`: the session's registered preload scripts of the matching type, plus the one from the window's own `preload` web preference for frames, filtered to absolute paths. The non-sandboxed answer is just the paths. The sandboxed answer reads each file in the main process and returns its contents together with a subset of process properties (`arch`, `platform`, a copy of `env`, `version`, `versions`, and the helper executable as `execPath`), because a sandboxed renderer cannot read files.

Sources: [lib/browser/rpc-server.ts:52-107](repo://lib/browser/rpc-server.ts#L52-L107)

In a sandboxed renderer, `executeSandboxedPreloadScripts` wraps each script's source in a function taking `require`, `process`, `exports`, `module` and a few globals (`Buffer`, `global`, `setImmediate`, ...), compiled by C++ in window scope, and calls it. `preloadRequire` serves only modules in `loadedModules` or `loadableModules` and throws `module not found: <name>` for anything else. Errors are logged and reported with `BROWSER_PRELOAD_ERROR`, which the main process re-emits as the `preload-error` event on the `WebContents`.

Sources: [lib/sandboxed_renderer/preload.ts:46-101](repo://lib/sandboxed_renderer/preload.ts#L46-L101), [lib/browser/rpc-server.ts:109-112](repo://lib/browser/rpc-server.ts#L109-L112)

The sandboxed `process` object given to preloads is a fresh `EventEmitter` with `getProcessMemoryInfo` and a `noDeprecation` property that forwards to the real one; `_linkedBinding` is exposed only when the `unsafely-expose-electron-internals-for-testing` switch is present.

Sources: [lib/sandboxed_renderer/preload.ts:19-44](repo://lib/sandboxed_renderer/preload.ts#L19-L44)

Common per-page setup runs for both renderer kinds from `lib/renderer/common-init.ts`: it installs the IPC callback, then branches on the page's protocol (DevTools gets the inspector overrides, `chrome-extension:` and `chrome:` pages get nothing, all others get `windowSetup`), loads the webview tag implementation in the main frame, runs `webFrameInit`, and starts the security warnings.

Sources: [lib/renderer/common-init.ts:6-48](repo://lib/renderer/common-init.ts#L6-L48)

## contextBridge

With context isolation, the preload runs in the isolated world and the page in the main world; they share the DOM but not JavaScript objects. `contextBridge` is the supported way across. The TypeScript wrapper only checks that `process.contextIsolated` is true (otherwise it throws that the API "can only be used when contextIsolation is enabled") and calls the native binding with a world id: `exposeInMainWorld` uses world 0, `exposeInIsolatedWorld` a given id, and `executeInMainWorld` runs a script there.

Sources: [lib/renderer/api/context-bridge.ts:1-22](repo://lib/renderer/api/context-bridge.ts#L1-L22)

The native `ExposeAPI` finds the target context, refuses to overwrite an existing property ("Cannot bind an API on top of an existing property on the window object"), passes the value across with `PassValueToOtherContext`, and defines the result as a read-only, non-configurable property after deep-freezing it (unless the `kContextBridgeMutability` feature is on). For service worker preload realms only the main world is valid.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:733-768](repo://shell/renderer/api/electron_api_context_bridge.cc#L733-L768), [shell/renderer/api/electron_api_context_bridge.cc:775-800](repo://shell/renderer/api/electron_api_context_bridge.cc#L775-L800)

`PassValueToOtherContextInner` decides how each value crosses, in this order:

| Value | What the destination receives |
| --- | --- |
| Recursion depth 1000 or more | a `TypeError`: "Electron contextBridge recursion depth exceeded" |
| String, number, null/undefined, boolean, symbol, bigint | the value itself |
| Anything already seen in this call | the cached proxy (handles cycles and shared references) |
| Function | a proxy function in the destination context that calls the original; a function that is sent back returns the original |
| Promise | a new promise settled when the source promise settles |
| Error | a new `Error` rebuilt from the original `message` |
| Array | a recursively converted array |
| DOM element, Blob, VideoFrame (from window contexts) | the same underlying object, re-wrapped |
| Plain object | a proxy object copied property by property |
| Other serializable objects | a structured clone |

Sources: [shell/renderer/api/electron_api_context_bridge.cc:153-237](repo://shell/renderer/api/electron_api_context_bridge.cc#L153-L237), [shell/renderer/api/electron_api_context_bridge.cc:239-466](repo://shell/renderer/api/electron_api_context_bridge.cc#L239-L466)

What counts as a "plain object" is an explicit exclusion list: `Date`, boxed primitives, errors, regexps, promises, maps, sets, typed arrays and buffers, arrays, generators, Wasm and module objects and proxies are all handled elsewhere. Everything that is not handled by the cases above goes through `gin::ConvertFromV8` into a `CloneableMessage`, so unsupported objects fail the way structured clone fails.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:91-108](repo://shell/renderer/api/electron_api_context_bridge.cc#L91-L108), [shell/renderer/api/electron_api_context_bridge.cc:444-466](repo://shell/renderer/api/electron_api_context_bridge.cc#L444-L466)

The `internalContextBridge` helpers (`overrideGlobalValueFromIsolatedWorld` and friends) let Electron's own bundles replace main-world globals; they are attached to the public object only when the binding reports a debug build.

Sources: [lib/renderer/api/context-bridge.ts:24-39](repo://lib/renderer/api/context-bridge.ts#L24-L39)

## Security warnings

Electron prints guidance to the DevTools console in development. `securityWarnings(nodeIntegration)` is started from `common-init.ts` in the main frame only; on window `load` it checks whether to log at all: only when the executable's path ends in the stock Electron binary name for the platform (so packaged apps stay quiet), and `ELECTRON_DISABLE_SECURITY_WARNINGS` or `ELECTRON_ENABLE_SECURITY_WARNINGS` can turn it off or on, from the environment or `window`. If it logs, it fetches the window's last web preferences over internal IPC and runs the checks: Node with remote content, disabled web security, insecure resources, allowed insecure content, experimental features, `enableBlinkFeatures`, a missing or unsafe CSP, and allowed popups. The comment lists the guideline items it cannot check automatically.

Sources: [lib/renderer/security-warnings.ts:6-50](repo://lib/renderer/security-warnings.ts#L6-L50), [lib/renderer/security-warnings.ts:258-293](repo://lib/renderer/security-warnings.ts#L258-L293)
