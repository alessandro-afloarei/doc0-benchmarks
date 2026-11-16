---
type: architecture
title: Sessions, Protocols, Network and Permissions
description: How Electron models sessions on top of BrowserContext partitions, routes requests through custom protocol handlers and the webRequest proxying URL loader factory, exposes the net module, and decides web and device permissions through session-level handlers.
tags: [session, protocol, webRequest, net, permissions, browsercontext, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-c2f667ce02e32cf3333f95b9
    resource: repo://lib/browser/api/net.ts
  - id: openwiki-source-1c7ea53d0b013a9bb4df85fd
    resource: repo://lib/browser/api/protocol.ts
  - id: openwiki-source-71cc3d32b6f7a84b340cebcf
    resource: repo://shell/browser/api/electron_api_protocol.cc
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-97cfe5ff2e47214941dcda67
    resource: repo://shell/browser/api/electron_api_web_request.cc
  - id: openwiki-source-f0ec114ee70f9e6816af1872
    resource: repo://shell/browser/electron_browser_client.cc
  - id: openwiki-source-a7812b9989726197c70b9034
    resource: repo://shell/browser/electron_browser_context.cc
  - id: openwiki-source-0a6d7972d5b9642b3af64562
    resource: repo://shell/browser/electron_permission_manager.cc
  - id: openwiki-source-bc4cee6664003aa2bc385dbd
    resource: repo://shell/browser/hid/hid_chooser_context.cc
  - id: openwiki-source-e219e6d768f58cfda1412627
    resource: repo://shell/browser/net/proxying_url_loader_factory.cc
  - id: openwiki-source-d885d8409dce109998cad17e
    resource: repo://shell/browser/protocol_registry.cc
  - id: openwiki-source-f930e6e220d6ed315fe69632
    resource: repo://shell/browser/serial/serial_chooser_controller.cc
  - id: openwiki-source-7cd69198bcb71e3e54bad7ee
    resource: repo://shell/browser/usb/usb_chooser_context.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Sessions, Protocols, Network and Permissions

Everything network- or storage-related in Electron hangs off a **session**: a JS `Session` object wrapping one `ElectronBrowserContext` (a Chromium `BrowserContext`). Protocol handlers, `webRequest` listeners, permission handlers, cookies, downloads, cache, spellchecker and preloads are all per-session.

## Session and ElectronBrowserContext

- `ElectronBrowserContext` (`shell/browser/electron_browser_context.cc`) keeps a process-wide map from a `PartitionKey` to an owned context. The key is either a partition name plus an `in_memory` flag, or an absolute path. `BrowserContexts()` lists them; `DestroyAllContexts()` clears the map but extracts the default context so that it is destroyed last (to avoid a use-after-free).
- `Session::FromPartition` (`shell/browser/api/electron_api_session.cc`) maps the `partition` string: empty means the default session, a `persist:` prefix means an on-disk context named after the rest, and any other string means an **in-memory** context. `Session::FromPath` requires a non-empty absolute path, else throws a `TypeError`. `Session::CreateFrom` returns the existing wrapper if the context already has one; otherwise it constructs it, calls the JS-side `_init`, and emits `session-created` on `app`.
<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `Session.prototype._init` in `lib/browser/api/session.ts` installs the IPC dispatch listeners ([IPC](/openwiki/architecture/ipc.md)) and reroutes legacy extension events to `session.extensions`. Sessions cannot be created with `new`.
- The context also exposes the `ProtocolRegistry`, permission controller delegate, download manager delegate, zoom delegate, guest manager (for `<webview>`) and the trusted browser-process `URLLoaderFactory` used by `net`.
- `Session::OnDownloadCreated` emits `will-download` with the `DownloadItem` and `WebContents`; calling `preventDefault()` cancels and removes the download.

## Custom protocols

Two layers exist:

1. **Scheme privileges (global, before ready).** `protocol.registerSchemesAsPrivileged` (`shell/browser/api/electron_api_protocol.cc`) accepts scheme descriptors with privileges `standard`, `secure`, `bypassCSP`, `allowServiceWorkers`, `supportFetchAPI`, `corsEnabled`, `stream`, `codeCache`. It registers them with Chromium's URL scheme tables and `ChildProcessSecurityPolicy`, and appends comma-joined scheme lists to the browser's command line (`kSecureSchemes`, `kStandardSchemes`, ...) so child processes can register the same schemes. `codeCache` requires `standard`. The URL scheme registries are locked at `PreMainMessageLoopRun`, which is why this must be called before `ready`.
2. **Per-session handlers.** `ProtocolRegistry` (`shell/browser/protocol_registry.cc`) holds two maps per context: `handlers_` for registered schemes (`registerXxxProtocol`) and `intercept_handlers_` for built-in schemes (`interceptXxxProtocol`). `RegisterProtocol`/`InterceptProtocol` fail if the scheme is already present. `RegisterURLLoaderFactories` adds an `ElectronURLLoaderFactory` for each registered scheme as a non-network loader factory. When the `grant_file_protocol_extra_privileges` fuse is on, it also replaces the `file:` factory with an `AsarURLLoaderFactory` so `file://` URLs can reach into ASAR archives.
3. **Intercepted built-ins** (`http`, `https`, `file`, `about`, `data`, `filesystem`) are handled by the proxying factory described below.

The modern `protocol.handle(scheme, handler)` is JS in `lib/browser/api/protocol.ts`: it picks `interceptProtocol` for built-in `http`/`https`/`file` schemes and `registerProtocol` otherwise, converts the native request into a standard `Request` (building a streaming body from upload data chunks of kinds `rawData`, `file`, `stream`, `blob`), awaits the user's `Response`, validates its shape, and hands status, headers, `mimeType` and a Node `Readable` back to native code. Invalid responses produce `ERR_UNEXPECTED` (-9) and `Response.error()` produces `ERR_FAILED` (-2). The module-level `protocol.*` functions delegate to `session.defaultSession.protocol`.

## webRequest and the proxying loader factory

`ElectronBrowserClient::WillCreateURLLoaderFactory` (`shell/browser/electron_browser_client.cc`) is called by Chromium whenever a URL loader factory is created for a context and frame. It looks up the context's `api::WebRequest`; if extensions are enabled and no `session.webRequest` listener exists, it first lets Chromium's extension `WebRequestAPI` try to proxy. Otherwise it wraps the network factory in `ProxyingURLLoaderFactory` (`shell/browser/net/proxying_url_loader_factory.cc`), passing the context's `ProtocolRegistry` intercept handlers and a trusted header client.

`ProxyingURLLoaderFactory::InProgressRequest` drives each request through the classic webRequest state machine: `OnBeforeRequest` (may cancel or redirect, possibly through an internal 307 redirect with an `Internal Redirect` header), `OnBeforeSendHeaders`, `OnSendHeaders`, `OnHeadersReceived`, `OnResponseStarted`, `OnBeforeRedirect`, `OnCompleted` and `OnErrorOccurred`. In Electron, unlike Chromium, `webRequest` also sees requests initiated by the browser process, and redirects skip the usual `IsRedirectSafe` check.

`WebRequest` (`shell/browser/api/electron_api_web_request.cc`) stores listeners as either *response listeners* (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`, which may modify or cancel and must call back) or *simple listeners* (`onSendHeaders`, `onBeforeRedirect`, `onResponseStarted`, `onCompleted`, `onErrorOccurred`), each with an optional `RequestFilter` of URL match patterns that are parsed and validated (invalid patterns throw).

## The net module and fetch

`lib/browser/api/net.ts` exposes `net.request` (a `ClientRequest` implemented in `lib/common/api/net-client-request.ts`, usable only after app ready), `net.fetch` and `net.resolveHost` (both delegate to `session.defaultSession`) and `net.isOnline`. `fetchWithSession` in `net-fetch.ts` implements the WHATWG fetch algorithm on top of `ClientRequest`, including abort handling, and `session.fetch` can bypass custom protocol handlers. Requests are made by the browser process's trusted `URLLoaderFactory` (`ElectronBrowserContext::GetURLLoaderFactory`), which also goes through `WillCreateURLLoaderFactory` so `webRequest` and protocol interception apply to `net` traffic.

## Permissions

`ElectronPermissionManager` (`shell/browser/electron_permission_manager.cc`) is the context's permission controller delegate and defers to JS callbacks set through `session.setPermissionRequestHandler`, `setPermissionCheckHandler` and `setDevicePermissionHandler`:

- **Requests.** With no request handler installed, every requested permission is **granted** (and MIDI sysex / geolocation grants get their side effects). Requests from fenced frames are always denied. With a handler, each permission in a request is dispatched to it with details such as `requestingUrl` and `isMainFrame`, and the results are collected per request id in a `PendingRequest`.
- **Checks.** With no check handler, synchronous checks return `true`, except `DEPRECATED_SYNC_CLIPBOARD_READ`, which returns `false`. With a handler, details include `requestingUrl`, `isMainFrame` and `mediaType` (`audio` or `video`) for capture permissions.
- **Devices.** HID, USB, serial and Bluetooth use chooser contexts (`shell/browser/hid`, `usb`, `serial`, plus `bluetooth`) with per-feature choosers. Granted devices are remembered through `ElectronPermissionManager::GrantDevicePermission` and consulted via `CheckDevicePermission`, which consults the device-permission handler. Chooser controllers emit session or `WebContents` events such as `select-serial-port` that apps answer to pick a device. `SetProtectedUSBHandler` and `SetBluetoothPairingHandler` customize the protected-USB-class decision and Bluetooth pairing.

<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Because the default for requests and checks is permissive, apps that load remote content should install handlers explicitly; see [fuses and security model](/openwiki/security/fuses-and-security-model.md).

## Tests

<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`spec/api-session-spec.ts`, `spec/api-protocol-spec.ts`, `spec/api-web-request-spec.ts`, `spec/api-net-spec.ts`, `spec/api-net-custom-protocols-spec.ts` and `spec/api-net-session-spec.ts` exercise these paths. For how `WebContents` obtains its session, see [WebContents and windows](/openwiki/architecture/web-contents-and-windows.md).
