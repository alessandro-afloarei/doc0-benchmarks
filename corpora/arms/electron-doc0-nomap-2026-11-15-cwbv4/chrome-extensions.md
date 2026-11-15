---
title: "Chrome Extensions Support"
---
## Overview

Electron can load unpacked Chrome extensions, mainly so apps can use DevTools extensions and similar tools. It does this by embedding Chromium's `//extensions` layer, the browser-independent part of Chrome's extension system, and supplying the embedder classes Chrome would otherwise provide: an extension system, a loader, a browser client, API providers and a renderer client. Only a subset of the `chrome.*` APIs exists, and some of those (such as `tabs`) are re-implemented on Electron's own `webContents` model. Everything here is compiled only when the `enable_electron_extensions` build flag is on ([[Build System]]). Extensions belong to sessions, which are described in [[Sessions and Browser Contexts]].

Sources: [shell/browser/electron_browser_main_parts.cc:432-444](repo://shell/browser/electron_browser_main_parts.cc#L432-L444), [shell/browser/api/electron_api_extensions.cc:46-94](repo://shell/browser/api/electron_api_extensions.cc#L46-L94)

## Startup

### Browser process

`ElectronBrowserMainParts::PreMainMessageLoopRun` installs an `ElectronExtensionsClient` and an `ElectronExtensionsBrowserClient` as the process-wide extension clients and makes sure the keyed-service factories for extension services, Chromium's and Electron's, are built before any browser context needs them.

Sources: [shell/browser/electron_browser_main_parts.cc:432-444](repo://shell/browser/electron_browser_main_parts.cc#L432-L444)

### Per session

Each persistent `ElectronBrowserContext` creates its keyed services, gets its `ElectronExtensionSystem`, and calls `InitForRegularProfile` and `FinishInitialization`. In-memory sessions skip this, so they have no extension system at all. `InitForRegularProfile` creates the service-worker manager, quota service, user-script manager and an `ElectronExtensionLoader`, and loads component extensions; the built-in PDF viewer is one, when `enable_pdf_viewer` is on.

Sources: [shell/browser/electron_browser_context.cc:398-410](repo://shell/browser/electron_browser_context.cc#L398-L410), [shell/browser/extensions/electron_extension_system.cc:75-130](repo://shell/browser/extensions/electron_extension_system.cc#L75-L130)

### Renderer process

`RendererClientBase::RenderThreadStarted` installs the extensions client and an `ElectronExtensionsRendererClient` with Chromium's core renderer API provider plus Electron's, and registers `chrome-extension:` as a scheme that supports `fetch`, is first-party when top-level, and bypasses Content Security Policy. Every new frame gets an `ExtensionFrameHelper` and is announced to the extension dispatcher, which is how content scripts and extension bindings reach pages.

Sources: [shell/renderer/renderer_client_base.cc:223-246](repo://shell/renderer/renderer_client_base.cc#L223-L246), [shell/renderer/renderer_client_base.cc:324-336](repo://shell/renderer/renderer_client_base.cc#L324-L336)

## Loading an extension

### session.extensions.loadExtension

`session.extensions` is an `api::Extensions` object; the old `session.loadExtension` and related methods are deprecated aliases for it. `loadExtension(path, options)` returns a promise. It rejects relative paths and in-memory ("temporary") sessions, always follows symlinks, and adds the `ALLOW_FILE_ACCESS` flag when `allowFileAccess` is set.

Sources: [shell/browser/api/electron_api_extensions.cc:46-94](repo://shell/browser/api/electron_api_extensions.cc#L46-L94), [lib/browser/api/session.ts:85-112](repo://lib/browser/api/session.ts#L85-L112)

### ElectronExtensionLoader

The loader reads the extension on the extension file task runner. It deletes any `_metadata` folder first (Chromium refuses names starting with `_`), calls Chromium's `file_util::LoadExtension` as a command-line extension, and collects install warnings, logging but not reporting "unrecognized manifest key" warnings such as `minimum_chrome_version`. Back on the UI thread, `FinishExtensionLoad` adds the extension to the `ExtensionRegistrar` and writes an install time into `ExtensionPrefs`, which the extension `webRequest` API needs.

Sources: [shell/browser/extensions/electron_extension_loader.cc:45-117](repo://shell/browser/extensions/electron_extension_loader.cc#L45-L117), [shell/browser/extensions/electron_extension_loader.cc:141-167](repo://shell/browser/extensions/electron_extension_loader.cc#L141-L167)

The promise resolves with the extension; any remaining warnings are emitted as an `ExtensionLoadWarning` process warning. A load failure rejects with "Loading extension at … failed with: …".

Sources: [shell/browser/api/electron_api_extensions.cc:76-91](repo://shell/browser/api/electron_api_extensions.cc#L76-L91), [shell/browser/extensions/electron_extension_loader.cc:57-65](repo://shell/browser/extensions/electron_extension_loader.cc#L57-L65)

### Events and removal

`api::Extensions` observes the extension registry and emits `extension-loaded`, `extension-unloaded` and `extension-ready`; the session re-emits them under its own name for older code, with a deprecation warning. `removeExtension(id)` unloads an extension, and `getExtension` and `getAllExtensions` read the registry.

Sources: [shell/browser/api/electron_api_extensions.cc:96-154](repo://shell/browser/api/electron_api_extensions.cc#L96-L154), [lib/browser/api/session.ts:25-42](repo://lib/browser/api/session.ts#L25-L42)

## Processes and URLs

Extension pages run in their own renderer processes. `ElectronBrowserClient::SiteInstanceGotProcessAndSite` records which extension a process hosts in the extension `ProcessMap`, `IsSuitableHost` only reuses a process whose privilege level matches the site's, and `ShouldUseProcessPerSite` keeps one process per extension.

Sources: [shell/browser/electron_browser_client.cc:727-776](repo://shell/browser/electron_browser_client.cc#L727-L776)

`chrome-extension://` resources are served by Chromium's extension URL loader factory, which Electron registers for subresources, navigations and service workers. Component extensions may also load `chrome://resources`, and extensions loaded with file access get a `file:` factory when the user allowed it.

Sources: [shell/browser/electron_browser_client.cc:1166-1210](repo://shell/browser/electron_browser_client.cc#L1166-L1210)

Background pages are wrapped as `webContents` of type `backgroundPage` and pinned so they stay alive; other extension views that Electron does not manage are wrapped as `remote` ([[WebContents and Frames]]).

Sources: [shell/browser/api/electron_api_web_contents.cc:991-1011](repo://shell/browser/api/electron_api_web_contents.cc#L991-L1011)

When an extension uses `chrome.webRequest`, the session's own `webRequest` takes precedence: Electron proxies requests through the extension API only when the session has no `webRequest` listener, as described in [[Custom Protocols and Request Interception]].

Sources: [shell/browser/electron_browser_client.cc:1309-1340](repo://shell/browser/electron_browser_client.cc#L1309-L1340)

## Supported APIs

### Electron's additions

Electron's API provider adds a handful of APIs on top of those that `//extensions` implements itself. Their schemas are in `shell/common/extensions/api` and their implementations in `shell/browser/extensions/api`:

Sources: [shell/common/extensions/api/_api_features.json:13-60](repo://shell/common/extensions/api/_api_features.json#L13-L60), [shell/common/extensions/api/BUILD.gn:40-70](repo://shell/common/extensions/api/BUILD.gn#L40-L70)

| API | Implementation | Notes |
| --- | --- | --- |
| `tabs` | `tabs_api.cc` | Maps tab IDs to `webContents` IDs: `query`, `get`, `update`, `reload`, zoom functions, `executeScript` and CSS insertion |
| `scripting` | `scripting_api.cc` | `executeScript`, `insertCSS`, `removeCSS`, dynamic content scripts |
| `action` / `browserAction` | `extension_action_api.cc` | Defined in `action.json` and `browser_action.json` |
| `extension` | Schema in `extension.json` | `getBackgroundPage`, `getURL` and `lastError` for Manifest V2 |
| `management` | `electron_management_api_delegate.cc` | Electron's delegate for the core API |
| `runtime` | `electron_runtime_api_delegate.cc` | Electron's delegate for the core API |
| `pdfViewerPrivate`, `resourcesPrivate`, `streamsPrivate` | `*_private_api.cc` | Used by the built-in PDF viewer |

Sources: [shell/browser/extensions/api/tabs/tabs_api.h:20-120](repo://shell/browser/extensions/api/tabs/tabs_api.h#L20-L120), [shell/browser/extensions/api/scripting/scripting_api.h:23-110](repo://shell/browser/extensions/api/scripting/scripting_api.h#L23-L110), [shell/browser/extensions/api/scripting/scripting_api.h:127-170](repo://shell/browser/extensions/api/scripting/scripting_api.h#L127-L170), [shell/common/extensions/api/_api_features.json:13-60](repo://shell/common/extensions/api/_api_features.json#L13-L60)

### tabs on webContents

Electron has no tab strip, so `chrome.tabs` is answered from the list of `webContents`. `tabs.query` walks every `webContents`, matches `active` against focus and `url` patterns against the committed URL (URL and title are only revealed when the extension has the permission), and builds tab objects from them. Functions that need a target tab require an explicit tab ID, because there is no meaningful default tab.

Sources: [shell/browser/extensions/api/tabs/tabs_api.cc:243-330](repo://shell/browser/extensions/api/tabs/tabs_api.cc#L243-L330), [shell/browser/extensions/api/tabs/tabs_api.cc:92-135](repo://shell/browser/extensions/api/tabs/tabs_api.cc#L92-L135)
