---
title: "Renderer Initialization"
---
## Overview

Each web page runs in a Chromium renderer process. Electron prepares the page before any of its scripts run, in two stages. Native code creates a Node.js environment for the frame when the script context is created, and then JavaScript in `lib/renderer/` runs the renderer init. That init decides whether the page gets Node.js globals, sets up `window` and `webFrame` for an ordinary page, and checks the page for insecure settings. Preload scripts are loaded in the same init, and are covered in [[Preload Scripts and Sandboxing]].

Sources: [shell/renderer/electron_renderer_client.cc:92-131](repo://shell/renderer/electron_renderer_client.cc#L92-L131)

## Native script-context setup

`ElectronRendererClient::DidCreateScriptContext` runs for each new script context. It returns early unless `ShouldLoadPreload` says the frame should get Node.js. The first frame to qualify starts the Node.js bindings, and every qualifying frame gets its own `node::InitializeContext` and Node environment.

Sources: [shell/renderer/electron_renderer_client.cc:92-107](repo://shell/renderer/electron_renderer_client.cc#L92-L107)

Before it creates the environment, the client asks Blink to hold the document load with `SetDefersLoading`. The load resumes only after the preload scripts have finished, so a preload that is async, such as an ES module, cannot race the page's own scripts.

Sources: [shell/renderer/electron_renderer_client.cc:118-131](repo://shell/renderer/electron_renderer_client.cc#L118-L131)

## Renderer init file

`lib/renderer/init.ts` runs in the page's script context. First it wraps `Module.wrapper` so that every module receives `process`, `global` and `Buffer` as parameters. This keeps them reachable from preload scripts even after the page deletes its globals. It then loads the common init and reads the `nodeIntegration` web preference from the main frame.

Sources: [lib/renderer/init.ts:34-40](repo://lib/renderer/init.ts#L34-L40)

Sources: [lib/renderer/init.ts:60-64](repo://lib/renderer/init.ts#L60-L64)

With `nodeIntegration` on, the init sets `global.module` and `global.require`. For a `file:` page it sets `__filename` and `__dirname` from the page's location, and for other pages it uses the app path. It also replaces `window.onerror` so that an uncaught error in the page emits `uncaughtException` on `process`.

Sources: [lib/renderer/init.ts:66-115](repo://lib/renderer/init.ts#L66-L115)

With `nodeIntegration` off and `contextIsolation` off, the init deletes `process`, `Buffer`, `global` and related globals once the environment has loaded. That keeps the page from reaching Node.js objects it should not see.

Sources: [lib/renderer/init.ts:117-131](repo://lib/renderer/init.ts#L117-L131)

## Common renderer init

`lib/renderer/common-init.ts` picks the setup for the page's URL. Pages on `devtools:` get the inspector overrides, `chrome-extension:` and `chrome:` pages get none, and every other page runs `windowSetup`.

Sources: [lib/renderer/common-init.ts:15-33](repo://lib/renderer/common-init.ts#L15-L33)

Only the main frame gets the `<webview>` element implementation, and every frame gets `webFrameInit`. The security warnings check runs once, for the main frame only.

Sources: [lib/renderer/common-init.ts:35-48](repo://lib/renderer/common-init.ts#L35-L48)

## Window and web frame setup

`windowSetup` replaces `window.close` with a function that sends `BROWSER_WINDOW_CLOSE` to the browser. It skips this in sandboxed renderers and `<webview>` guests. It also makes `window.prompt` throw, because Electron does not support it. When context isolation is on, both overrides are also written into the isolated world.

Sources: [lib/renderer/window-setup.ts:5-25](repo://lib/renderer/window-setup.ts#L5-L25)

`webFrameInit` registers one `ipcRendererUtils.handle` for the `RENDERER_WEB_FRAME_METHOD` channel. A `webFrame` method called from the browser, such as `executeJavaScript`, is run against the local `webFrame` object and its result is returned to the browser.

Sources: [lib/renderer/web-frame-init.ts:12-22](repo://lib/renderer/web-frame-init.ts#L12-L22)

Sources: [lib/browser/api/web-contents.ts:176-183](repo://lib/browser/api/web-contents.ts#L176-L183)
