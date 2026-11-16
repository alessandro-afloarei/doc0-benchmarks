---
title: "Sessions and Browser Contexts"
---
## Overview

A session is a separate browser profile inside one app: its own cookies, cache, local storage, permissions handlers, preload scripts, protocol handlers and network settings. In Chromium terms each session is a `content::BrowserContext`. Electron's subclass is `ElectronBrowserContext`, and the JavaScript `session` object is `api::Session`, a garbage-collected wrapper with at most one instance per browser context. Every `WebContents` belongs to exactly one session, chosen when it is created.

Sources: [shell/browser/electron_browser_context.cc:357-410](repo://shell/browser/electron_browser_context.cc#L357-L410), [shell/browser/api/electron_api_session.cc:1673-1706](repo://shell/browser/api/electron_api_session.cc#L1673-L1706), [shell/browser/api/electron_api_web_contents.cc:822-831](repo://shell/browser/api/electron_api_web_contents.cc#L822-L831)

This page covers how partitions map to contexts, what a context owns, and how sessions handle permissions, downloads and their network context. Custom protocols registered on a session are covered in [[Custom Protocols and the net Module]], request interception in [[Web Request Interception]], and IPC events dispatched through the session in [[IPC Between Main and Renderer]].

Sources: [shell/browser/api/electron_api_session.cc:1342-1361](repo://shell/browser/api/electron_api_session.cc#L1342-L1361), [lib/browser/api/session.ts:25-26](repo://lib/browser/api/session.ts#L25-L26)

## From a partition to a context

`session.fromPartition(partition, options)` and `session.fromPath(path, options)` are native functions. Both throw `Session can only be received when app is ready` before `ready`. `session.defaultSession` is a getter for `fromPartition('')`.

Sources: [shell/browser/api/electron_api_session.cc:1870-1918](repo://shell/browser/api/electron_api_session.cc#L1870-L1918), [lib/browser/api/session.ts:114-120](repo://lib/browser/api/session.ts#L114-L120)

`Session::FromPartition` reads the partition string in three ways:

Sources: [shell/browser/api/electron_api_session.cc:1712-1730](repo://shell/browser/api/electron_api_session.cc#L1712-L1730)

| Partition | Context | Storage |
| --- | --- | --- |
| `''` | `GetDefaultBrowserContext()` | Persistent, at the session data directory |
| `persist:<name>` | `From(name, in_memory = false)` | Persistent, at `<session data>/Partitions/<name>` with the name lower-cased and path-escaped |
| any other string | `From(partition, in_memory = true)` | In memory only; `IsOffTheRecord()` is true |

Sources: [shell/browser/api/electron_api_session.cc:484-484](repo://shell/browser/api/electron_api_session.cc#L484-L484), [shell/browser/electron_browser_context.cc:237-239](repo://shell/browser/electron_browser_context.cc#L237-L239), [shell/browser/electron_browser_context.cc:377-385](repo://shell/browser/electron_browser_context.cc#L377-L385), [shell/browser/electron_browser_context.cc:506-508](repo://shell/browser/electron_browser_context.cc#L506-L508)

`fromPath` requires a non-empty absolute path, and its context always persists at exactly that path.

Sources: [shell/browser/api/electron_api_session.cc:1732-1750](repo://shell/browser/api/electron_api_session.cc#L1732-L1750), [shell/browser/electron_browser_context.cc:386-391](repo://shell/browser/electron_browser_context.cc#L386-L391)

All contexts live in one static map keyed by `PartitionKey`, which holds the kind (partition or path), the location and the in-memory flag. `From` and `FromPath` return the existing context for a key or create it, so the same partition string always yields the same context and the same session. The `options` argument only matters the first time.

Sources: [shell/browser/electron_browser_context.cc:308-335](repo://shell/browser/electron_browser_context.cc#L308-L335), [shell/browser/electron_browser_context.cc:869-897](repo://shell/browser/electron_browser_context.cc#L869-L897)

Contexts are never destroyed individually. `ElectronBrowserMainParts::PostMainMessageLoopRun` calls `DestroyAllContexts`, which pulls the default context out of the map, clears the rest, and destroys the default context last. The comment there refers to commit ba629e3, which avoided a use-after-free that way.

Sources: [shell/browser/electron_browser_context.cc:349-355](repo://shell/browser/electron_browser_context.cc#L349-L355), [shell/browser/electron_browser_main_parts.cc:596-598](repo://shell/browser/electron_browser_main_parts.cc#L596-L598)

## What a browser context owns

The constructor reads the `cache` option, which can be overridden by the `--disable-http-cache` switch, and `--disk-cache-size`. It creates a `ProtocolRegistry` and a special storage policy. It loads preferences from `<path>/Preferences` through a `JsonPrefStore`, read synchronously, and registers prefs such as the last file-dialog directory, the default download directory and DevTools file system paths. Persistent contexts also start extension services when extensions are built in.

Sources: [shell/browser/electron_browser_context.cc:357-410](repo://shell/browser/electron_browser_context.cc#L357-L410), [shell/browser/electron_browser_context.cc:422-496](repo://shell/browser/electron_browser_context.cc#L422-L496)

Other services are created lazily when Chromium first asks for them.

Sources: [shell/browser/electron_browser_context.cc:525-531](repo://shell/browser/electron_browser_context.cc#L525-L531)

| Getter | Returns |
| --- | --- |
| `GetDownloadManagerDelegate` | `ElectronDownloadManagerDelegate` |
| `GetGuestManager` | `WebViewManager`, which tracks `<webview>` guests |
| `GetPermissionControllerDelegate` | `ElectronPermissionManager` |
| `GetPreconnectManager` | `content::PreconnectManager` with Electron's delegate |
| `GetURLLoaderFactory` | A trusted browser-process loader factory on the default storage partition, built after asking `ElectronBrowserClient::WillCreateURLLoaderFactory` for proxies |
| `GetUserAgent` | The session's user agent, or the app-wide one |

Sources: [shell/browser/electron_browser_context.cc:525-605](repo://shell/browser/electron_browser_context.cc#L525-L605)

## The Session object

`Session::CreateFrom` returns the existing session for a context if there is one. Otherwise it allocates a new garbage-collected `Session`, calls its JavaScript `_init`, and emits `session-created` on `app`. The constructor records a weak cell for the session in the context's user data. That is how `Session::FromBrowserContext` finds the session from C++, for example in the IPC handler. It also creates the `protocol` object over the context's `ProtocolRegistry`, attaches `SessionPreferences` (which holds the registered preload scripts), and observes the download manager. `new Session()` throws `Session objects cannot be created with 'new'`.

Sources: [shell/browser/api/electron_api_session.cc:1682-1706](repo://shell/browser/api/electron_api_session.cc#L1682-L1706), [shell/browser/api/electron_api_session.cc:562-591](repo://shell/browser/api/electron_api_session.cc#L562-L591), [shell/browser/api/electron_api_session.cc:1673-1680](repo://shell/browser/api/electron_api_session.cc#L1673-L1680), [shell/browser/api/electron_api_session.cc:1752-1756](repo://shell/browser/api/electron_api_session.cc#L1752-L1756)

`cookies`, `extensions`, `serviceWorkers`, `webRequest` and `netLog` are created on first access and cached, so each session has one of each.

Sources: [shell/browser/api/electron_api_session.cc:1323-1369](repo://shell/browser/api/electron_api_session.cc#L1323-L1369)

`Session.prototype._init` in TypeScript adds the IPC dispatch listeners and re-emits the extension events on the session with a deprecation warning. The file adds `session.fetch`, which runs `net.fetch` through this session. It wraps `setDisplayMediaRequestHandler` to answer with the system picker when `useSystemPicker` is set and available. It also keeps deprecated shims: `getPreloads` and `setPreloads` over `registerPreloadScript`, and the old extension methods moved to `session.extensions`.

Sources: [lib/browser/api/session.ts:25-112](repo://lib/browser/api/session.ts#L25-L112)

## Permissions

Permission decisions go through `ElectronPermissionManager`, the context's `PermissionControllerDelegate`. `setPermissionRequestHandler` and `setPermissionCheckHandler` accept `null` or a function, and anything else throws `Must pass null or function`.

Sources: [shell/browser/api/electron_api_session.cc:861-897](repo://shell/browser/api/electron_api_session.cc#L861-L897)

Without a request handler, every requested permission is granted. For MIDI SysEx the manager also grants the renderer process the right to send SysEx messages, and for geolocation it opts the app into location services. With a handler, the manager stores the request under an id, adds `requestingUrl` and `isMainFrame` to the details, and calls the handler once per permission. Each answer fills one slot in the pending request, and the renderer's callback runs only when every permission has an answer.

Sources: [shell/browser/electron_permission_manager.cc:181-248](repo://shell/browser/electron_permission_manager.cc#L181-L248)

Without a check handler, permission checks such as `navigator.permissions.query` also report granted, except the deprecated synchronous clipboard read, which is always denied. With a handler, its boolean is the answer. Device permissions for HID, serial and USB, protected USB classes and Bluetooth pairing each have their own handler on the same manager. Without a pairing handler, Bluetooth pairing is refused.

Sources: [shell/browser/electron_permission_manager.cc:308-318](repo://shell/browser/electron_permission_manager.cc#L308-L318), [shell/browser/electron_permission_manager.cc:271-306](repo://shell/browser/electron_permission_manager.cc#L271-L306), [shell/browser/electron_permission_manager.cc:111-143](repo://shell/browser/electron_permission_manager.cc#L111-L143)

## Downloads

When the download manager creates an item, `Session::OnDownloadCreated` wraps it as a `DownloadItem` and emits `will-download` with the item and the originating `webContents`. Preventing the event cancels and removes the download. "Save page" downloads are skipped.

Sources: [shell/browser/api/electron_api_session.cc:610-626](repo://shell/browser/api/electron_api_session.cc#L610-L626)

`ElectronDownloadManagerDelegate::DetermineDownloadTarget` then picks the file path. A forced path wins. Next comes a save path the app set on the item with `setSavePath`, usually from inside `will-download`. Otherwise it generates a default name off the UI thread, from the URL, content disposition, suggested name and MIME type, in the last-used or default download directory. It then shows a save dialog parented to the contents' window, detached for offscreen contents, unless a save path appeared in the meantime.

Sources: [shell/browser/electron_download_manager_delegate.cc:333-374](repo://shell/browser/electron_download_manager_delegate.cc#L333-L374), [shell/browser/electron_download_manager_delegate.cc:219-285](repo://shell/browser/electron_download_manager_delegate.cc#L219-L285)

At shutdown, every context's download manager is shut down before Node stops, so download callbacks cannot run against a dead environment, as described in [[Process Startup]].

Sources: [shell/browser/electron_browser_main_parts.cc:554-559](repo://shell/browser/electron_browser_main_parts.cc#L554-L559)

## The network context

Each session gets its own network context in Chromium's network service, configured by `NetworkContextService::ConfigureNetworkContextParams`. It starts from the system defaults, then adds an SSL config client (so `setSSLConfig` can push changes), the session's user agent and CORS origin access list, the `Accept-Language` header from the application locale, and the HTTP cache switch.

Sources: [shell/browser/net/network_context_service.cc:39-77](repo://shell/browser/net/network_context_service.cc#L39-L77)

Persistent sessions also get files under their path: the network data directory, the HTTP cache with its maximum size, the cookie database, HTTP server properties, trust tokens and transport security state. Session cookies are neither persisted nor restored. Cookies are encrypted on disk only when the `cookie_encryption` fuse is on. In-memory sessions get none of these files. Proxy settings come from the context's prefs through `proxy_config_monitor_`, and `--proxy-server` style switches are applied to the in-memory pref store.

Sources: [shell/browser/net/network_context_service.cc:79-125](repo://shell/browser/net/network_context_service.cc#L79-L125), [build/fuses/fuses.json5:6-6](repo://build/fuses/fuses.json5#L6-L6)

The session's own requests from the main process, such as `net.request` with a `session` option or `session.fetch`, use the trusted loader factory from `GetURLLoaderFactory`. Its parameters mark it as the browser process, with ORB off and web security on; the comment says the `net` module's tests depend on that last setting.

Sources: [shell/browser/electron_browser_context.cc:571-605](repo://shell/browser/electron_browser_context.cc#L571-L605)
