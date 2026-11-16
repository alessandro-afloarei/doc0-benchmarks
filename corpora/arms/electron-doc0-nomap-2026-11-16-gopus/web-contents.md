---
title: "WebContents"
---
## Overview

`webContents` is Electron's handle on one web page: its navigation, its frames, its renderer process, and the events Chromium reports about them. In C++ it is `api::WebContents`, which wraps a `content::WebContents`, acts as that object's `WebContentsDelegate` and `WebContentsObserver`, and is exposed to JavaScript through the `electron_browser_web_contents` binding. `lib/browser/api/web-contents.ts` adds the promise-based `loadURL`, IPC helpers, dialogs and window-open handling on top.

Sources: [shell/browser/api/electron_api_web_contents.cc:735-764](repo://shell/browser/api/electron_api_web_contents.cc#L735-L764), [shell/browser/api/electron_api_web_contents.cc:1013-1033](repo://shell/browser/api/electron_api_web_contents.cc#L1013-L1033), [lib/browser/api/web-contents.ts:117-119](repo://lib/browser/api/web-contents.ts#L117-L119)

This page follows a `WebContents` from creation through navigation to destruction, and covers `WebFrameMain`, which represents its frames. The window that usually hosts it is covered in [[Windows and Views]], messages to and from its frames in [[IPC Between Main and Renderer]], and new windows it opens in [[Child Windows and window.open]].

Sources: [shell/browser/api/electron_api_browser_window.cc:66-83](repo://shell/browser/api/electron_api_browser_window.cc#L66-L83)

## Types

Every `api::WebContents` has a `Type`, exposed to JavaScript by `getType()`. The default is `kBrowserWindow`.

Sources: [shell/browser/api/electron_api_web_contents.h:128-137](repo://shell/browser/api/electron_api_web_contents.h#L128-L137), [shell/browser/api/electron_api_web_contents.h:791-791](repo://shell/browser/api/electron_api_web_contents.h#L791-L791)

| Type | `getType()` | Used for |
| --- | --- | --- |
| `kBrowserWindow` | `window` | Contents of a `BrowserWindow` or `WebContentsView` |
| `kBrowserView` | `browserView` | The JavaScript `BrowserView` shim; otherwise identical to `window` |
| `kWebView` | `webview` | A `<webview>` guest (`is_guest()`) |
| `kOffScreen` | `offscreen` | `webPreferences.offscreen` rendering into `paint` events |
| `kRemote` | `remote` | A thin wrapper around a `content::WebContents` Electron did not create |
| `kBackgroundPage` | `backgroundPage` | An extension's background page |

Sources: [shell/browser/api/electron_api_web_contents.cc:303-330](repo://shell/browser/api/electron_api_web_contents.cc#L303-L330), [shell/browser/api/electron_api_web_contents.h:128-137](repo://shell/browser/api/electron_api_web_contents.h#L128-L137)

## Creating a WebContents

### Constructors

There are three constructors. `WebContents(isolate, options)` creates a new page from web preferences. `WebContents(isolate, unique_ptr, type)` takes ownership of a `content::WebContents` Chromium already made, for example for a new window. `WebContents(isolate, content::WebContents*)` creates a `kRemote` wrapper without ownership. `WebContents::New`, `CreateAndTake` and `FromOrCreate` each call the matching constructor and then the JavaScript `_init`; an exception in `_init` is reported as an uncaught exception.

Sources: [shell/browser/api/electron_api_web_contents.cc:735-784](repo://shell/browser/api/electron_api_web_contents.cc#L735-L784), [shell/browser/api/electron_api_web_contents.cc:4560-4611](repo://shell/browser/api/electron_api_web_contents.cc#L4560-L4611)

### From web preferences

`CreateFromWebPreferences` is what `WebContentsView` and `BrowserWindow` call. If the preferences carry a hidden `webContents`, it reuses that object: it replaces its `WebContentsPreferences` with the new dictionary and applies the new background colour. Otherwise it calls `WebContents::New`.

Sources: [shell/browser/api/electron_api_web_contents.cc:4614-4638](repo://shell/browser/api/electron_api_web_contents.cc#L4614-L4638)

The options constructor reads `backgroundThrottling`, `type`, `offscreen` (a boolean, or an object with `useSharedTexture`), `embedder`, `devTools` and `show`. It picks the session from `session`, then `partition`, then the default partition. It then creates the `content::WebContents` in one of three ways.

Sources: [shell/browser/api/electron_api_web_contents.cc:785-833](repo://shell/browser/api/electron_api_web_contents.cc#L785-L833)

- A guest gets a `chrome-guest://fake-host` site instance and a `WebViewGuestDelegate`, plus an offscreen view when its embedder is offscreen.
- An offscreen contents gets an `OffScreenWebContentsView` that paints through `OnPaint`, and is transparent when the hidden background colour is transparent.
- Anything else gets ordinary `CreateParams` with `initially_hidden` set from `show`.

Sources: [shell/browser/api/electron_api_web_contents.cc:785-890](repo://shell/browser/api/electron_api_web_contents.cc#L785-L890)

### Initialization

`InitWithSessionAndOptions` makes `api::WebContents` the delegate and wraps the contents in an `InspectableWebContents`, which owns it and adds DevTools support. It builds `accept_languages` from the application locale and the OS's preferred languages, applies system font rendering settings and the cursor blink rate, and creates the `WebContentsPreferences` from the options unless the window-open path already made one. It also attaches the permission helper, zoom controller, autofill driver, and the session's user agent. A guest takes its embedder's window as owner. Finally a `UserDataLink` on the `content::WebContents` lets `WebContents::From` find the API object from Chromium code.

Sources: [shell/browser/api/electron_api_web_contents.cc:906-987](repo://shell/browser/api/electron_api_web_contents.cc#L906-L987), [shell/browser/api/electron_api_web_contents.cc:1013-1033](repo://shell/browser/api/electron_api_web_contents.cc#L1013-L1033), [shell/browser/api/electron_api_web_contents.cc:4589-4596](repo://shell/browser/api/electron_api_web_contents.cc#L4589-L4596)

## Web preferences

`WebContentsPreferences` stores the `webPreferences` dictionary in C++. `Clear` sets the defaults, notably `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`, `webviewTag: false`, and no explicit sandbox. `SetFromDictionary` reads every option over them; turning off `webSecurity` also allows insecure content unless that is set explicitly.

Sources: [shell/browser/web_contents_preferences.cc:111-158](repo://shell/browser/web_contents_preferences.cc#L111-L158), [shell/browser/web_contents_preferences.cc:160-200](repo://shell/browser/web_contents_preferences.cc#L160-L200)

The preferences reach the renderer two ways. `ElectronBrowserClient::OverrideWebPreferences` calls `OverrideWebkitPrefs`, which sets Blink settings such as JavaScript, images, WebGL, web security and fonts. `AppendCommandLineSwitches` adds process switches such as `--enable-sandbox` when a renderer is launched, as described in [[Sandboxed Renderers and Preload Scripts]].

Sources: [shell/browser/web_contents_preferences.cc:382-412](repo://shell/browser/web_contents_preferences.cc#L382-L412), [shell/browser/electron_browser_client.cc:404-440](repo://shell/browser/electron_browser_client.cc#L404-L440), [shell/browser/web_contents_preferences.cc:308-325](repo://shell/browser/web_contents_preferences.cc#L308-L325)

## The JavaScript layer

`WebContents.prototype._init` runs once per object. It freezes `id`, creates the per-contents `ipc` emitter, and defines `navigationHistory`. It forwards `render-process-gone` and `login` to `app`, re-emits `ready-to-show` on the owner window on the next tick, wires up the window-open handlers (except for `remote` contents), and finally emits `web-contents-created` on `app`.

Sources: [lib/browser/api/web-contents.ts:537-607](repo://lib/browser/api/web-contents.ts#L537-L607), [lib/browser/api/web-contents.ts:756-766](repo://lib/browser/api/web-contents.ts#L756-L766), [lib/browser/api/web-contents.ts:845-845](repo://lib/browser/api/web-contents.ts#L845-L845)

It also turns several private native events into policy.

Sources: [lib/browser/api/web-contents.ts:609-620](repo://lib/browser/api/web-contents.ts#L609-L620)

- `-before-unload-fired`: for the interactive types (`window`, `offscreen`, `browserView`), a `beforeunload` handler that returned false prevents the close; other types unload regardless.
- `-run-dialog`: shows `alert` and `confirm` as message boxes, counts dialogs per origin to offer a "prevent additional dialogs" checkbox when `safeDialogs` is on, and never supports `prompt`. `-cancel-dialogs` aborts any open ones.
- `-unresponsive`: becomes `unresponsive` only for a visible, initialized renderer.

Sources: [lib/browser/api/web-contents.ts:609-618](repo://lib/browser/api/web-contents.ts#L609-L618), [lib/browser/api/web-contents.ts:779-843](repo://lib/browser/api/web-contents.ts#L779-L843)

`webContents.create`, `fromId`, `fromFrame`, `fromDevToolsTargetId` and `getAllWebContents` call the binding. `getFocusedWebContents` prefers a focused `webview` over its focused embedder.

Sources: [lib/browser/api/web-contents.ts:880-910](repo://lib/browser/api/web-contents.ts#L880-L910)

## Loading a page

`loadURL` returns a promise. It first subscribes to the navigation events with `_awaitNextLoad`, then calls the native `_loadURL`. `loadFile` builds a `file:` URL relative to `app.getAppPath()` and calls `loadURL`.

Sources: [lib/browser/api/web-contents.ts:324-338](repo://lib/browser/api/web-contents.ts#L324-L338), [lib/browser/api/web-contents.ts:427-433](repo://lib/browser/api/web-contents.ts#L427-L433)

`WebContents::LoadURL` validates the URL, and an invalid or over-long URL emits `did-fail-load` with `ERR_INVALID_URL`. It reads `httpReferrer`, `userAgent`, `extraHeaders`, `postData`, `baseURLForDataURL` and `reloadIgnoringCache` into `LoadURLParams`. It refuses with `ERR_FAILED` while a navigation call is still on the stack, which the comment ties to crbug.com/347742. It discards uncommitted entries and calls `LoadURLWithParams`. Because that call can run JavaScript that destroys the object, it re-checks a weak pointer before touching `this` again.

Sources: [shell/browser/api/electron_api_web_contents.cc:2331-2408](repo://shell/browser/api/electron_api_web_contents.cc#L2331-L2408)

The promise settles from the events, in this order of precedence.

Sources: [lib/browser/api/web-contents.ts:342-347](repo://lib/browser/api/web-contents.ts#L342-L347)

1. A second main-frame, cross-document `did-start-navigation` after the first rejects with `ERR_ABORTED`; same-document changes such as `pushState` are allowed.
2. A main-frame `did-fail-load` records the error, and settles at once if no navigation had started.
3. `did-finish-load`, or a `did-navigate-in-page` that the page itself started, resolves, or rejects with the recorded error.
4. `did-stop-loading` or `destroyed` without either rejects with `ERR_FAILED`; the comment gives a bad scheme as one case.

Sources: [lib/browser/api/web-contents.ts:342-425](repo://lib/browser/api/web-contents.ts#L342-L425)

The rejection error carries `errno`, `code` and `url`, and its message includes the URL truncated to 2048 characters.

Sources: [lib/browser/api/web-contents.ts:349-354](repo://lib/browser/api/web-contents.ts#L349-L354)

## Navigation and load events

`EmitNavigationEvent` builds one event object for `did-start-navigation`, `did-redirect-navigation` and the internal `-ready-to-commit-navigation`. It carries `url`, `isSameDocument`, `isMainFrame`, `processId`, `routingId`, and lazy `frame` and `initiator` getters. It returns whether a listener called `preventDefault`. While these are emitted, `is_safe_to_delete_` is false, which is what blocks a nested `loadURL`.

Sources: [shell/browser/api/electron_api_web_contents.cc:1951-1991](repo://shell/browser/api/electron_api_web_contents.cc#L1951-L1991), [shell/browser/api/electron_api_web_contents.cc:2027-2056](repo://shell/browser/api/electron_api_web_contents.cc#L2027-L2056)

`DidFinishNavigation` emits nothing for uncommitted navigations or error pages. It emits `did-navigate-in-page` for same-document navigations. Otherwise it emits `did-frame-navigate`, plus `did-navigate` for the main frame, with the HTTP status. Guests also get `load-commit`. Load events follow: `dom-ready` for the main frame, `did-frame-finish-load` then `did-finish-load`, `did-fail-load` (ignoring the aborted first request for media documents), and `did-start-loading` and `did-stop-loading`. `ready-to-show` fires on the main frame's first non-empty layout, which the renderer reports through `ElectronWebContentsUtility`.

Sources: [shell/browser/api/electron_api_web_contents.cc:2058-2106](repo://shell/browser/api/electron_api_web_contents.cc#L2058-L2106), [shell/browser/api/electron_api_web_contents.cc:1891-1949](repo://shell/browser/api/electron_api_web_contents.cc#L1891-L1949), [shell/browser/api/electron_api_web_contents.cc:1993-1998](repo://shell/browser/api/electron_api_web_contents.cc#L1993-L1998)

A crash of the main frame's renderer emits `render-process-gone` with `reason` and `exitCode`.

Sources: [shell/browser/api/electron_api_web_contents.cc:1846-1854](repo://shell/browser/api/electron_api_web_contents.cc#L1846-L1854)

## Frames: WebFrameMain

`WebFrameMain` represents one frame in the main process. It is indexed two ways. By `FrameTreeNodeId`, which stays the same across navigations "most similar to how `<iframe>` works", as the comment puts it. And by the exact `RenderFrameHost` token. A frame host that is already running unload handlers when the object is created counts as detached and is left out of the frame tree node map.

Sources: [shell/browser/api/electron_api_web_frame_main.cc:56-70](repo://shell/browser/api/electron_api_web_frame_main.cc#L56-L70), [shell/browser/api/electron_api_web_frame_main.cc:96-139](repo://shell/browser/api/electron_api_web_frame_main.cc#L96-L139), [shell/browser/api/electron_api_web_frame_main.cc:150-165](repo://shell/browser/api/electron_api_web_frame_main.cc#L150-L165)

`api::WebContents` keeps the frames in step with Chromium.

Sources: [shell/browser/api/electron_api_web_contents.cc:1779-1800](repo://shell/browser/api/electron_api_web_contents.cc#L1779-L1800)

| Chromium callback | Effect |
| --- | --- |
| `RenderFrameCreated` (active frame) | Emits `frame-created` with a `frame` getter |
| `RenderFrameHostChanged` | A cross-origin navigation swapped hosts; `UpdateRenderFrameHost` moves the same `WebFrameMain` to the new host and reconnects its Mojo pipe |
| `RenderFrameDeleted` | Marks the frame disposed, but only if the token matches, so an old host swapped out does not dispose the new one |
| `FrameDeleted` | The frame tree node is gone; `Destroyed` removes the object from both maps |

Sources: [shell/browser/api/electron_api_web_contents.cc:1752-1828](repo://shell/browser/api/electron_api_web_contents.cc#L1752-L1828), [shell/browser/api/electron_api_web_frame_main.cc:171-203](repo://shell/browser/api/electron_api_web_frame_main.cc#L171-L203)

A disposed frame throws `Render frame was disposed before WebFrameMain could be accessed` from methods that need the renderer.

Sources: [shell/browser/api/electron_api_web_frame_main.cc:205-214](repo://shell/browser/api/electron_api_web_frame_main.cc#L205-L214)

## Closing and destroying

`close()` closes the page. With `waitForBeforeUnload` it first marks user activation and dispatches `beforeunload`, so the page may refuse. `destroy()` deletes the object, asynchronously unless the browser is shutting down or the contents are a guest. The comment explains why: an app may call `destroy()` from inside one of the object's own events. `DeleteThisIfAlive` skips the delete if garbage collection has already started.

Sources: [shell/browser/api/electron_api_web_contents.cc:1072-1108](repo://shell/browser/api/electron_api_web_contents.cc#L1072-L1108)

The destructor emits the internal `will-destroy`. A guest attached to its embedder, or an extension background page, does not own its `content::WebContents`, so the destructor releases it instead of deleting it. When the `content::WebContents` itself is destroyed, `WebContentsDestroyed` removes the object from the id map, clears the wrapper's internal pointer so later calls see a destroyed object, tells a guest delegate, and emits `destroyed`.

Sources: [shell/browser/api/electron_api_web_contents.cc:1035-1070](repo://shell/browser/api/electron_api_web_contents.cc#L1035-L1070), [shell/browser/api/electron_api_web_contents.cc:2249-2265](repo://shell/browser/api/electron_api_web_contents.cc#L2249-L2265)
