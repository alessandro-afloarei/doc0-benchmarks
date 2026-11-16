---
type: system
title: Sessions, protocols and networking
description: How Electron's session API maps to ElectronBrowserContext storage partitions, how custom and intercepted protocols are registered and served (registerSchemesAsPrivileged, protocol.handle, ProtocolRegistry, ElectronURLLoaderFactory), how webRequest hooks into ProxyingURLLoaderFactory, how net.request / net.fetch use SimpleURLLoader, and how permission handlers default.
tags: [session, network, protocol, webRequest, net, permissions, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-0702fbd38b1811ca32c7bee1
    resource: repo://lib/browser/api/net-fetch.ts
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
  - id: openwiki-source-1e79e6fad198d50041d61d91
    resource: repo://shell/browser/net/electron_url_loader_factory.h
  - id: openwiki-source-e219e6d768f58cfda1412627
    resource: repo://shell/browser/net/proxying_url_loader_factory.cc
  - id: openwiki-source-e4a665a6552e31c2251a1105
    resource: repo://shell/common/api/electron_api_url_loader.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Sessions, protocols and networking

## Session ⇔ ElectronBrowserContext

A `Session` (`shell/browser/api/electron_api_session.cc`, JS
`lib/browser/api/session.ts`) wraps an `ElectronBrowserContext`
(`shell/browser/electron_browser_context.cc`), Chromium's per-profile object
owning cookies, cache, storage partition, prefs, permission manager, download
manager and protocol registry.

`Session::FromPartition(partition)`:

| `partition` | Context |
| --- | --- |
| `""` | the default context (`session.defaultSession`) |
| `persist:<name>` | on-disk context at `<sessionData>/Partitions/<name>` |
| any other string | **in-memory** context (nothing persisted) |

`session.fromPath(path)` creates a context at an explicit **absolute** path
(throws for empty or relative paths). Contexts are cached by key, so the same
partition always yields the same session. A `webContents`' session comes from
its `webPreferences.session` / `partition`.

Each session gets `addIpcDispatchListeners` (IPC is routed through the session;
see [IPC between main and renderer](ipc.md)) and owns sub-objects such as
`cookies`, `webRequest`, `protocol`, `serviceWorkers`, `netLog` and
`extensions`.

## Custom protocols

### Privileges must be declared before `ready`

`protocol.registerSchemesAsPrivileged([{ scheme, privileges }])`
(`shell/browser/api/electron_api_protocol.cc`) accepts `standard`, `secure`,
`bypassCSP`, `allowServiceWorkers`, `supportFetchAPI`, `corsEnabled`,
`stream` and `codeCache` (which requires `standard`). It registers schemes
with `url::` registries for the browser process **and** appends them to the
command line (`--standard-schemes`, `--secure-schemes`, …) so child processes
get the same configuration. Because `ElectronBrowserMainParts` locks URL scheme
registries in `PreMainMessageLoopRun` (see
[Process model and main-process startup](../architecture/process-model-and-startup.md)),
this must be called before the app is ready.

### Handling requests

The modern API is `protocol.handle(scheme, handler)`
(`lib/browser/api/protocol.ts`): the handler receives a WHATWG `Request` and
returns a `Response` (or promise). Internally:

- For built-in schemes (`http`, `https`, `file`) `handle` uses the
  **intercept** path; for others the **register** path. `unhandle` /
  `isProtocolHandled` mirror this.
- Upload data (raw bytes, files, streams, blobs) is converted into a
  `ReadableStream` body; an `Origin: null` header is dropped.
- The response is validated; invalid responses fail with
  `ERR_UNEXPECTED`, `Response.error()` with `ERR_FAILED`; otherwise the body
  is bridged back to a Node stream with status, headers and MIME type.
- Registration failure throws `Failed to register protocol`.

The deprecated `register*Protocol` / `intercept*Protocol` variants map to
`ProtocolType` values (`kBuffer`, `kString`, `kFile`, `kHttp`, `kStream`,
`kFree`) handled by `ElectronURLLoaderFactory`
(`shell/browser/net/electron_url_loader_factory.cc`). `protocol.*` module
functions are shortcuts for `session.defaultSession.protocol`.

### Where handlers plug into Chromium

`ProtocolRegistry` (`shell/browser/protocol_registry.cc`) stores per-context
registered and intercepted handlers:

- **Registered** schemes are installed as non-network URL loader factories
  (`RegisterURLLoaderFactories` / navigation factories). It also swaps in the
  ASAR-aware `file:` factory when the GrantFileProtocolExtraPrivileges fuse is
  on ([ASAR archive support](asar-archives.md)).
- **Intercepted** schemes are handled by `ProxyingURLLoaderFactory`
  (below), which checks `intercepted_handlers_` first unless the request has
  `kBypassCustomProtocolHandlers`.

## webRequest and the proxying loader factory

`ElectronBrowserClient::WillCreateURLLoaderFactory` inserts a
`ProxyingURLLoaderFactory` (`shell/browser/net/proxying_url_loader_factory.cc`)
in front of every URL loader factory for a context. (When Chrome extensions are
enabled and the app registered no `webRequest` listener, the extensions
WebRequest API may proxy instead.) For each request the proxy:

1. Serves **intercepted protocols** via `ElectronURLLoaderFactory`.
2. Serves `file://` service-worker scripts through the ASAR loader (Chromium
   otherwise forbids them).
3. If no `webRequest` listener exists, passes straight through to the
   original factory.
4. Otherwise drives `onBeforeRequest` → `onBeforeSendHeaders` →
   `onSendHeaders` → `onHeadersReceived` → `onResponseStarted` /
   `onBeforeRedirect` → `onCompleted` / `onErrorOccurred` on
   `api::WebRequest` (`shell/browser/api/electron_api_web_request.cc`),
   using a `TrustedURLLoaderHeaderClient` when headers must be observed or
   modified. WebSockets are proxied by `ProxyingWebSocket`.

`WebRequest` keeps one listener per event; filters accept URL match patterns
(invalid patterns throw `Invalid url pattern`) and resource types. Response
events (`onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`) can
cancel, redirect or modify; simple events only observe.

## net: ClientRequest and fetch

- `net.request()` (`lib/browser/api/net.ts`) throws before `app` is ready and
  creates a `ClientRequest` (`lib/common/api/net-client-request.ts`), a Node
  `Writable` that collects headers/body and calls the native
  `createURLLoader`. Options can pick a `session` or `partition`
  (validated), `useSessionCookies`, redirect mode, etc.
- `net.fetch()` and `session.fetch()` (`lib/browser/api/net-fetch.ts`)
  implement WHATWG fetch on top of `ClientRequest`, with
  `bypassCustomProtocolHandlers` to skip the app's own handlers (useful
  inside a `protocol.handle` handler that forwards to the network).
- Native side: `SimpleURLLoaderWrapper`
  (`shell/common/api/electron_api_url_loader.cc`) wraps Chromium's
  `network::SimpleURLLoader`, streaming the response, reporting
  redirect/progress, and emitting `login` for auth challenges. It chooses the
  factory itself: intercepted then registered custom protocol handlers (unless
  bypassed), the ASAR `file:` factory for `file://`, otherwise the browser
  context's network factory. In a [utility process](utility-process.md) it uses
  a shared factory provided by the browser.

So `net` requests are made by Chromium's network service (proxy settings,
certificate verification, cookies of the chosen session) rather than Node's
`http` stack.

## Cookies and network context

`session.cookies` (`electron_api_cookies.cc`) talks to the context's
`network::mojom::CookieManager`; `CookieChangeNotifier` emits `changed`.
`NetworkContextService` builds each context's network context and enables
cookie encryption only when the CookieEncryption fuse is on
([Fuses and build flags](fuses-and-build-flags.md)). Proxy configuration,
host resolution (`resolveHost`), certificate verification
(`setCertificateVerifyProc` via `CertVerifierClient`) and net logging
(`netLog`) are also per-session.

## Permissions

`session.setPermissionRequestHandler` / `setPermissionCheckHandler` /
`setDevicePermissionHandler` configure `ElectronPermissionManager`
(`shell/browser/electron_permission_manager.cc`). **Defaults are
permissive**: with no request handler every requested permission is
**granted** (also opting into geolocation and MIDI sysex), and with no check
handler checks return true except deprecated synchronous clipboard reads.
Apps loading remote content should install handlers.
`WebContentsPermissionHelper` (`shell/browser/web_contents_permission_helper.cc`)
funnels media, fullscreen, pointer-lock, notifications, etc. through the
same manager, adding details like `requestingUrl` and `isMainFrame`.

## Tests

`spec/api-session-spec.ts`, `spec/api-protocol-spec.ts`,
`spec/api-net-spec.ts`, `spec/api-net-custom-protocols-spec.ts`,
`spec/api-net-session-spec.ts` and `spec/api-web-request-spec.ts`.
