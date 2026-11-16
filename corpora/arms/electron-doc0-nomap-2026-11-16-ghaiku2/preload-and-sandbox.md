---
title: "Preload Scripts and Sandboxing"
---
## Overview

A preload script is app code that runs in a renderer before the page's own scripts, with access to a limited set of Node.js and Electron APIs. Electron has two ways to load one. In an unsandboxed renderer the preload is loaded by path, with the full Node.js `require`. In a sandboxed renderer the browser process reads the file and sends its contents, and a small loader runs it with a `require` that only reaches an allowlist of modules. Both paths get their list of scripts from the browser process. This page covers how that list is chosen and how each path runs the script. The messages involved are described in [[Inter-process Messaging]], and the page's own init is in [[Renderer Initialization]].

Sources: [lib/browser/rpc-server.ts:52-70](repo://lib/browser/rpc-server.ts#L52-L70)

## Choosing the scripts

`getPreloadScriptsFromEvent` in the browser process picks the scripts for the sender. It takes the session's preload scripts and keeps the frame-type ones for a page, or the service-worker-type ones for a worker. It then adds the preload set by the `preload` web preference, and drops any script whose path is not absolute.

Sources: [lib/browser/rpc-server.ts:52-70](repo://lib/browser/rpc-server.ts#L52-L70)

The `session.setPreloads` and `getPreloads` methods are deprecated wrappers around `registerPreloadScript` and `getPreloadScripts`, which the choice above reads.

Sources: [lib/browser/api/session.ts:60-70](repo://lib/browser/api/session.ts#L60-L70)

## Who may run a preload

A renderer loads preloads only for the main frame, for devtools, or for a sub-frame that enabled `nodeIntegrationInSubFrames`. A `<webview>` frame never does. This test runs in native code before any script is evaluated.

Sources: [shell/renderer/renderer_client_base.cc:198-209](repo://shell/renderer/renderer_client_base.cc#L198-L209)

## Unsandboxed path

For an unsandboxed renderer, the browser returns only the file paths through `BROWSER_NONSANDBOX_LOAD`. The renderer's init then loads each `.js` or `.cjs` path with `Module._load`, so the preload has the same `require` as the page's Node.js code. `.mjs` paths are loaded through the ESM loader. A load error is reported to the browser through `BROWSER_PRELOAD_ERROR`, and the loop continues with the next script.

Sources: [lib/renderer/init.ts:136-153](repo://lib/renderer/init.ts#L136-L153)

Sources: [lib/renderer/init.ts:154-166](repo://lib/renderer/init.ts#L154-L166)

## Sandboxed path

The browser reads each script's contents in `readPreloadScript`, and it sends the contents with the process properties the renderer needs, in the `BROWSER_SANDBOX_LOAD` reply. A file that cannot be read is sent with an error instead of contents.

Sources: [lib/browser/rpc-server.ts:72-87](repo://lib/browser/rpc-server.ts#L72-L87)

Sources: [lib/browser/rpc-server.ts:89-103](repo://lib/browser/rpc-server.ts#L89-L103)

The sandboxed renderer's init asks for that reply with `invokeSync`, then calls `executeSandboxedPreloadScripts` with two maps. `loadedModules` holds modules that are returned as they are, which are `electron`, `electron/common` and `events`. `loadableModules` holds lazy loaders for `timers` and `url`.

Sources: [lib/sandboxed_renderer/init.ts:14-23](repo://lib/sandboxed_renderer/init.ts#L14-L23)

Sources: [lib/sandboxed_renderer/init.ts:26-38](repo://lib/sandboxed_renderer/init.ts#L26-L38)

Sources: [lib/sandboxed_renderer/init.ts:58-71](repo://lib/sandboxed_renderer/init.ts#L58-L71)

`runPreloadScript` wraps the contents in a function that takes `require`, `process`, `exports`, `module` and the exposed globals, then runs it. The `require` it passes is `preloadRequire`, which looks only in the two maps. Any other name is refused.

Sources: [lib/sandboxed_renderer/preload.ts:46-82](repo://lib/sandboxed_renderer/preload.ts#L46-L82)

`executeSandboxedPreloadScripts` runs the scripts in order. If a script has no contents and has an error, or if it throws, the error is logged and `BROWSER_PRELOAD_ERROR` is sent to the browser.

Sources: [lib/sandboxed_renderer/preload.ts:87-101](repo://lib/sandboxed_renderer/preload.ts#L87-L101)

On the native side, `DidCreateScriptContext` in the sandboxed client adds the bindings object and runs the `sandbox_bundle` with it, then emits the `loaded` process event. The bundle's pre-init replaces the `process` prototype with an `EventEmitter` so the sandboxed `process` behaves like the unsandboxed one.

Sources: [shell/renderer/electron_sandboxed_renderer_client.cc:110-139](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L110-L139)

Sources: [lib/sandboxed_renderer/pre-init.ts:1-30](repo://lib/sandboxed_renderer/pre-init.ts#L1-L30)

## Preload realm

A service worker runs its preloads in a second V8 context, the preload realm. During worker evaluation the native side creates that context with `OnCreatePreloadableV8Context`, and runs `electron/js2c/preload_realm_bundle` in it. `lib/preload_realm/init.ts` is the entry point for that bundle. It uses the same `BROWSER_SANDBOX_LOAD` reply and the same executor as the sandboxed loader, with a smaller set of modules: `electron`, `electron/common` and `events`, plus a lazy `url`.

Sources: [shell/renderer/electron_sandboxed_renderer_client.cc:193-194](repo://shell/renderer/electron_sandboxed_renderer_client.cc#L193-L194)

Sources: [shell/renderer/preload_realm_context.cc:175-186](repo://shell/renderer/preload_realm_context.cc#L175-L186)

Sources: [lib/preload_realm/init.ts:14-22](repo://lib/preload_realm/init.ts#L14-L22)
