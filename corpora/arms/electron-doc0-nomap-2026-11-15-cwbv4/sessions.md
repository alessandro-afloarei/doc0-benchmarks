---
title: "Sessions and Browser Contexts"
---
## Overview

A session is the storage and network identity that pages share: cookies, cache, local storage, permissions, proxy settings, downloads, registered protocols and preload scripts. In Chromium this is a `content::BrowserContext`; Electron's subclass is `ElectronBrowserContext`, and the JavaScript `session` object is `api::Session`, a thin wrapper that exposes it. Every `webContents` belongs to exactly one session, chosen by its `session` or `partition` preference ([[WebContents and Frames]]). This page covers how sessions are identified and created, where their data lives, and the per-session services: permissions, cookies, downloads, preload scripts and data clearing. Request interception and custom schemes, also per session, are in [[Custom Protocols and Request Interception]].

Sources: [shell/browser/api/electron_api_web_contents.cc:826-838](repo://shell/browser/api/electron_api_web_contents.cc#L826-L838), [shell/browser/api/electron_api_session.cc:562-590](repo://shell/browser/api/electron_api_session.cc#L562-L590)

## Partitions and identity

### Choosing a browser context

`session.fromPartition(partition, options)` maps a partition string to a browser context: the empty string is the default session, a string starting with `persist:` is a persistent context named by the rest of the string, and any other string is an in-memory context. `session.fromPath(path)` creates a persistent context at an absolute path and throws for empty or relative paths. `session.defaultSession` is `fromPartition('')`.

Sources: [shell/browser/api/electron_api_session.cc:484-484](repo://shell/browser/api/electron_api_session.cc#L484-L484), [shell/browser/api/electron_api_session.cc:1713-1749](repo://shell/browser/api/electron_api_session.cc#L1713-L1749), [lib/browser/api/session.ts:114-120](repo://lib/browser/api/session.ts#L114-L120)

`ElectronBrowserContext::From` and `FromPath` keep a map keyed by partition name and in-memory flag, or by path, so asking for the same partition twice returns the same context. Contexts are never destroyed individually; they all go in `DestroyAllContexts` at shutdown, as described in [[Process Model and Native Startup]].

Sources: [shell/browser/electron_browser_context.cc:308-354](repo://shell/browser/electron_browser_context.cc#L308-L354), [shell/browser/electron_browser_context.cc:868-899](repo://shell/browser/electron_browser_context.cc#L868-L899)

### The JavaScript wrapper

`Session::CreateFrom` returns the existing wrapper for a context if there is one, found through a weak back-link stored on the context; otherwise it allocates a garbage-collected `Session`, runs its JavaScript `_init`, and emits `session-created` on `app`. `new Session()` throws. The constructor observes the context's download manager, creates `SessionPreferences` for it, and creates the session's `protocol` object around the context's `ProtocolRegistry`.

Sources: [shell/browser/api/electron_api_session.cc:1673-1711](repo://shell/browser/api/electron_api_session.cc#L1673-L1711), [shell/browser/api/electron_api_session.cc:1751-1755](repo://shell/browser/api/electron_api_session.cc#L1751-L1755), [shell/browser/api/electron_api_session.cc:562-590](repo://shell/browser/api/electron_api_session.cc#L562-L590)

`_init` in `lib/browser/api/session.ts` attaches the IPC dispatch listeners, because a session is where IPC from its frames and service workers arrives ([[Inter-Process Communication]]), and forwards extension events. The same file adds `session.fetch`, which runs `net.fetch` with this session, and the system-picker option of `setDisplayMediaRequestHandler`.

Sources: [lib/browser/api/session.ts:25-58](repo://lib/browser/api/session.ts#L25-L58)

## Where data lives

The `ElectronBrowserContext` constructor reads `cache` from the options (and `--disable-http-cache`, `--disk-cache-size` from the command line) and computes its path. The default context uses the session-data directory; a named persistent partition uses `Partitions/<name>` under it; a `fromPath` context uses the given path. In-memory contexts report themselves as off-the-record, so Chromium keeps their storage in memory.

Sources: [shell/browser/electron_browser_context.cc:356-397](repo://shell/browser/electron_browser_context.cc#L356-L397), [shell/browser/electron_browser_context.cc:506-508](repo://shell/browser/electron_browser_context.cc#L506-L508)

Each context reads a JSON `Preferences` file from its path synchronously and registers the preferences Electron needs: the last directory used in file dialogs, the default download directory, DevTools file-system paths and settings, the media device ID salt, zoom levels, proxy configuration, extension and spellcheck preferences. On first run the spellchecker dictionary defaults to the system locale's language. Persistent contexts also start the extension system.

Sources: [shell/browser/electron_browser_context.cc:398-410](repo://shell/browser/electron_browser_context.cc#L398-L410), [shell/browser/electron_browser_context.cc:422-496](repo://shell/browser/electron_browser_context.cc#L422-L496)

A session's user agent defaults to the app-wide one from `ElectronBrowserClient` until `session.setUserAgent` overrides it; new `webContents` take it from their session.

Sources: [shell/browser/electron_browser_context.cc:498-500](repo://shell/browser/electron_browser_context.cc#L498-L500), [shell/browser/electron_browser_context.cc:557-559](repo://shell/browser/electron_browser_context.cc#L557-L559), [shell/browser/api/electron_api_web_contents.cc:971-971](repo://shell/browser/api/electron_api_web_contents.cc#L971-L971)

## Permissions

### Handlers

`ElectronPermissionManager` is the context's permission controller delegate, and the session's handler setters install JavaScript functions on it. A null argument removes the handler; anything other than a function or null throws "Must pass null or function".

Sources: [shell/browser/api/electron_api_session.cc:861-897](repo://shell/browser/api/electron_api_session.cc#L861-L897)

### Requests

When a page asks for a permission (camera, notifications, geolocation and so on) and no request handler is set, every requested permission is granted, enabling MIDI SysEx or location services where they need it. With a handler, the request is stored as a pending request and the handler is called once per permission with the `webContents`, the permission type, a callback and details that include `requestingUrl` and `isMainFrame`. The page's request completes only when every permission has been answered.

Sources: [shell/browser/electron_permission_manager.cc:181-248](repo://shell/browser/electron_permission_manager.cc#L181-L248)

### Checks

Synchronous checks, such as `navigator.permissions.query`, go to the check handler. Without one, everything is allowed except the deprecated synchronous clipboard read; with one, it receives the `webContents` (if any), the permission, the requesting origin and details including `requestingUrl`, `isMainFrame` and, for media, `mediaType`.

Sources: [shell/browser/electron_permission_manager.cc:308-343](repo://shell/browser/electron_permission_manager.cc#L308-L343)

Device permissions for HID, serial, USB and Bluetooth have their own handler and grant lists in the same manager.

Sources: [shell/browser/electron_permission_manager.cc:130-143](repo://shell/browser/electron_permission_manager.cc#L130-L143), [shell/browser/electron_permission_manager.cc:345-375](repo://shell/browser/electron_permission_manager.cc#L345-L375)

## Cookies

`session.cookies` is an `api::Cookies` object. `get`, `set`, `remove` and `flushStore` return promises and call the cookie manager of the context's default storage partition. The object subscribes to the context's `CookieChangeNotifier` and emits `changed` with the cookie, the cause, and whether it was removed.

Sources: [shell/browser/api/electron_api_cookies.cc:279-345](repo://shell/browser/api/electron_api_cookies.cc#L279-L345), [shell/browser/api/electron_api_cookies.cc:422-442](repo://shell/browser/api/electron_api_cookies.cc#L422-L442)

## Downloads

### will-download

`Session` observes the download manager. For each new download (save-page downloads excepted) it wraps the item as a `DownloadItem` and emits `will-download` with the item and the `webContents` that started it; preventing the event cancels and removes the download. An app can call `item.setSavePath()` or `setSaveDialogOptions()` from that listener.

Sources: [shell/browser/api/electron_api_session.cc:610-626](repo://shell/browser/api/electron_api_session.cc#L610-L626)

### Choosing the file

`ElectronDownloadManagerDelegate::DetermineDownloadTarget` decides where the file goes: a forced path wins, then a save path set from JavaScript; otherwise it generates a default file name on a background thread from the URL, content disposition, suggested name and MIME type, inside the last directory used or the session's default download directory. If no save path has been set by then, `OnDownloadPathGenerated` shows a save dialog parented to the page's window (detached for offscreen pages), titled with the URL unless the app set dialog options.

Sources: [shell/browser/electron_download_manager_delegate.cc:333-374](repo://shell/browser/electron_download_manager_delegate.cc#L333-L374), [shell/browser/electron_download_manager_delegate.cc:219-285](repo://shell/browser/electron_download_manager_delegate.cc#L219-L285)

At shutdown, `ElectronBrowserMainParts` shuts down every context's download manager before Node is stopped so download callbacks cannot run into a dead JavaScript environment.

Sources: [shell/browser/electron_browser_main_parts.cc:554-559](repo://shell/browser/electron_browser_main_parts.cc#L554-L559)

## Preload scripts

`session.registerPreloadScript({ type, id, filePath })` stores a preload in the context's `SessionPreferences`. It throws for a duplicate ID or a relative path (the deprecated `setPreloads` only logs). Frame preloads run in every page of the session before the page's own preload; `service-worker` preloads run in the session's service workers. How renderers fetch and run them is described in [[Renderer Processes and Preload Scripts]].

Sources: [shell/browser/api/electron_api_session.cc:1084-1116](repo://shell/browser/api/electron_api_session.cc#L1084-L1116), [lib/browser/api/session.ts:60-83](repo://lib/browser/api/session.ts#L60-L83), [lib/browser/rpc-server.ts:52-70](repo://lib/browser/rpc-server.ts#L52-L70)

## Clearing data and network settings

`clearCache` clears the HTTP cache through the storage partition's network context. `clearStorageData` clears the requested storage and quota types for an optional origin and resets the media device ID salt when cookies are cleared, as the media-capture spec requires; `flushStorageData` writes pending data to disk. `setProxy`, `resolveProxy` and the network-emulation methods act on the same network context.

Sources: [shell/browser/api/electron_api_session.cc:712-760](repo://shell/browser/api/electron_api_session.cc#L712-L760)

The session also exposes child objects for other subsystems: `protocol` and `webRequest` ([[Custom Protocols and Request Interception]]), `netLog`, `serviceWorkers`, and `extensions` ([[Chrome Extensions Support]]). With the built-in spellchecker, the session emits `spellcheck-dictionary-*` events as Hunspell dictionaries load and download.

Sources: [shell/browser/api/electron_api_session.cc:1323-1370](repo://shell/browser/api/electron_api_session.cc#L1323-L1370), [shell/browser/api/electron_api_session.cc:1829-1836](repo://shell/browser/api/electron_api_session.cc#L1829-L1836), [shell/browser/api/electron_api_session.cc:628-641](repo://shell/browser/api/electron_api_session.cc#L628-L641)
