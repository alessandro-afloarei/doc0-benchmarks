---
title: "Custom Protocols and the net Module"
---
## Overview

Electron lets an app serve its own URL schemes, such as `app://index.html`, and make HTTP requests from the main process with Chromium's network stack instead of Node's. Both sides rest on Chromium's `URLLoaderFactory` interface. A protocol handler becomes an `ElectronURLLoaderFactory` registered for its scheme. A `net.request` becomes a `SimpleURLLoaderWrapper` that asks the session for the right factory, which means a main-process `net.fetch('app://...')` reaches the app's own handler.

Sources: [shell/browser/protocol_registry.cc:24-67](repo://shell/browser/protocol_registry.cc#L24-L67), [shell/common/api/electron_api_url_loader.cc:484-523](repo://shell/common/api/electron_api_url_loader.cc#L484-L523)

Each session has its own protocol handlers, as [[Sessions and Browser Contexts]] describes. Changing or observing requests in flight is a different mechanism, covered in [[Web Request Interception]]. The `file:` handler that reads inside `.asar` archives is covered in [[ASAR Archives]].

Sources: [shell/browser/api/electron_api_session.cc:574-576](repo://shell/browser/api/electron_api_session.cc#L574-L576)

## Privileged schemes

A custom scheme is not "standard" by default: it has no host or origin semantics, it is not secure, and fetch, CORS and service workers do not work on it. `protocol.registerSchemesAsPrivileged` changes that, and it must run before `ready`, or it throws. Chromium reads scheme registries once during startup, and `PreMainMessageLoopRun` then locks them.

Sources: [shell/browser/api/electron_api_protocol.cc:346-356](repo://shell/browser/api/electron_api_protocol.cc#L346-L356), [shell/browser/electron_browser_main_parts.cc:431-432](repo://shell/browser/electron_browser_main_parts.cc#L431-L432)

`RegisterSchemesAsPrivileged` reads an array of `{ scheme, privileges }`. It first rejects `codeCache` on a scheme that is not also `standard`. For each scheme it then applies the privileges to the browser process's registries:

Sources: [shell/browser/api/electron_api_protocol.cc:110-125](repo://shell/browser/api/electron_api_protocol.cc#L110-L125)

| Privilege | Browser-process effect | Renderer switch |
| --- | --- | --- |
| `standard` | `url::AddStandardScheme`, web-safe in `ChildProcessSecurityPolicy` | `--standard-schemes` |
| `secure` | `url::AddSecureScheme` | `--secure-schemes` |
| `bypassCSP` | `url::AddCSPBypassingScheme` | `--bypasscsp-schemes` style switch |
| `corsEnabled` | `url::AddCorsEnabledScheme` | `--cors-schemes` |
| `supportFetchAPI` | none | `--fetch-schemes` |
| `allowServiceWorkers` | Added to content's service worker schemes | `--service-worker-schemes` |
| `stream` | Recorded | `--streaming-schemes` |
| `codeCache` | `url::AddCodeCacheScheme` | `--code-cache-schemes` |

Sources: [shell/browser/api/electron_api_protocol.cc:40-49](repo://shell/browser/api/electron_api_protocol.cc#L40-L49), [shell/browser/api/electron_api_protocol.cc:127-189](repo://shell/browser/api/electron_api_protocol.cc#L127-L189)

Renderers are separate processes, so the schemes are appended to the browser's own command line as comma-separated switches. Child processes inherit them, and `RendererClientBase` registers them again at startup, as [[Renderer Process Initialization]] shows. `AddServiceWorkerScheme` casts away `const` on Chromium's scheme list; its comment says a patch will be needed if Chromium ever returns a copy instead.

Sources: [shell/browser/api/electron_api_protocol.cc:166-189](repo://shell/browser/api/electron_api_protocol.cc#L166-L189), [shell/browser/api/electron_api_protocol.cc:100-108](repo://shell/browser/api/electron_api_protocol.cc#L100-L108), [shell/renderer/renderer_client_base.cc:138-165](repo://shell/renderer/renderer_client_base.cc#L138-L165)

## Registering a handler

### The registry and protocol types

`api::Protocol` is a thin wrapper over the session's `ProtocolRegistry`. Each `register*Protocol` method stores `(ProtocolType, handler)` in the registry's `handlers_` map, and each `intercept*Protocol` method stores it in `intercept_handlers_`. Both use `try_emplace`, so a second registration for the same scheme fails instead of replacing the first. A trailing callback argument is still accepted, with a deprecation warning.

Sources: [shell/browser/api/electron_api_protocol.cc:219-288](repo://shell/browser/api/electron_api_protocol.cc#L219-L288), [shell/browser/protocol_registry.cc:69-98](repo://shell/browser/protocol_registry.cc#L69-L98)

| Method | `ProtocolType` | Expected response |
| --- | --- | --- |
| `registerStringProtocol` | `kString` | A string, or `{ data }` |
| `registerBufferProtocol` | `kBuffer` | A buffer, or `{ data }` |
| `registerFileProtocol` | `kFile` | A path, or `{ path }` |
| `registerHttpProtocol` | `kHttp` | `{ url, ... }` to proxy another request |
| `registerStreamProtocol` | `kStream` | `{ data: stream, statusCode, headers }` |
| `registerProtocol` | `kFree` | Any of the above, inferred from the value |

Sources: [shell/browser/api/electron_api_protocol.cc:303-336](repo://shell/browser/api/electron_api_protocol.cc#L303-L336)

The top-level `protocol` module forwards every call to `session.defaultSession.protocol`. A handler registered on `protocol` therefore only applies to the default session.

Sources: [lib/browser/api/protocol.ts:159-183](repo://lib/browser/api/protocol.ts#L159-L183)

### protocol.handle

`protocol.handle(scheme, handler)` is the fetch-style API, implemented in TypeScript over the older methods. For `http`, `https` and `file` it uses `interceptProtocol`, and for any other scheme `registerProtocol`, both with the free-form type. The wrapper does four things.

Sources: [lib/browser/api/protocol.ts:111-113](repo://lib/browser/api/protocol.ts#L111-L113)

1. It converts the request's `uploadData` into a `Request` body: a single raw chunk is passed as-is, and mixed raw, file, stream and blob chunks are joined into one `ReadableStream`.
2. It drops an `Origin: null` header and builds a `Request`.
3. It awaits the handler and validates the `Response`. An invalid response answers `ERR_UNEXPECTED (-9)`, and `Response.error()` answers `ERR_FAILED (-2)`.
4. It converts the body to a Node stream and returns `{ data, headers, statusCode, statusText, mimeType }`. A handler that throws is logged and answers `ERR_UNEXPECTED`.

Sources: [lib/browser/api/protocol.ts:13-13](repo://lib/browser/api/protocol.ts#L13-L13), [lib/browser/api/protocol.ts:48-147](repo://lib/browser/api/protocol.ts#L48-L147)

`unhandle` and `isProtocolHandled` choose the intercept or register variants with the same built-in-scheme test.

Sources: [lib/browser/api/protocol.ts:149-157](repo://lib/browser/api/protocol.ts#L149-L157)

## How handlers are reached

Registered handlers are offered to Chromium as non-network URL loader factories. `ElectronBrowserClient` asks the session's `ProtocolRegistry` for factories in three places: for navigations (`CreateNonNetworkNavigationURLLoaderFactory`), for subresources, and for worker main scripts. For workers it passes `allow_file_access = false`. `RegisterURLLoaderFactories` adds one `ElectronURLLoaderFactory` per registered scheme.

Sources: [shell/browser/electron_browser_client.cc:1044-1072](repo://shell/browser/electron_browser_client.cc#L1044-L1072), [shell/browser/protocol_registry.cc:24-67](repo://shell/browser/protocol_registry.cc#L24-L67)

When the `grant_file_protocol_extra_privileges` fuse is on, the same function also replaces Chromium's `file:` factory with `AsarURLLoaderFactory`, or adds one when file access is explicitly allowed, so `file:` URLs can read inside archives.

Sources: [shell/browser/protocol_registry.cc:24-46](repo://shell/browser/protocol_registry.cc#L24-L46)

Intercepted handlers are not installed as factories. They apply to schemes the network service already handles, so `ProxyingURLLoaderFactory` checks them for every request; see [[Web Request Interception]].

Sources: [shell/browser/electron_browser_client.cc:1366-1372](repo://shell/browser/electron_browser_client.cc#L1366-L1372)

## Serving a response

`ElectronURLLoaderFactory::CreateLoaderAndStart` clones itself as the target factory for redirects and calls the JavaScript handler with the request and a callback bound to `StartLoading`. `StartLoading` turns whatever the handler passed into a response:

Sources: [shell/browser/net/electron_url_loader_factory.cc:411-431](repo://shell/browser/net/electron_url_loader_factory.cc#L411-L431)

1. No argument at all completes with `ERR_NOT_IMPLEMENTED`. Its comment says the callback must not throw, whatever it is given, to stay compatible with old handlers.
2. `{ error }` completes with that network error code.
3. A response head is built from the object (status, headers, MIME type, charset). If the headers carry a redirect, the factory computes the redirect, sends `OnReceiveRedirect`, and hands the request to a `RedirectedRequest` that waits for `FollowRedirect` and loads the new URL with the target factory. The comment explains why: with the network service, a `Location` header no longer redirects by itself.
4. Otherwise it dispatches on the protocol type: buffer, string, file (with optional range), HTTP (a new request for `url`), or stream. `kFree` infers the type from `data`, or from `url` or `path` when there is no `data`.

Sources: [shell/browser/net/electron_url_loader_factory.cc:445-535](repo://shell/browser/net/electron_url_loader_factory.cc#L445-L535), [shell/browser/net/electron_url_loader_factory.cc:536-619](repo://shell/browser/net/electron_url_loader_factory.cc#L536-L619)

## net.request

### ClientRequest

`net.request(options, callback)` throws until the app is ready and returns a `ClientRequest`. `net.fetch` and `net.resolveHost` forward to the default session, and `net.online` reads `isOnline()` from the native binding.

Sources: [lib/browser/api/net.ts:1-27](repo://lib/browser/api/net.ts#L1-L27)

`ClientRequest` is a Node `Writable`. `parseOptions` builds a URL from `url`, or from `protocol`, `host`/`hostname`, `port` and `path`; a path containing a space throws. It validates `redirect` (`follow`, `error` or `manual`) and the headers. It accepts a `session` (which must be a `Session`) or a `partition` string. Only `http:` and `https:` are allowed unless the options were marked by the internal `allowAnyProtocol`.

Sources: [lib/common/api/net-client-request.ts:229-318](repo://lib/common/api/net-client-request.ts#L229-L318), [lib/common/api/net-client-request.ts:319-345](repo://lib/common/api/net-client-request.ts#L319-L345), [lib/common/api/net-client-request.ts:200-206](repo://lib/common/api/net-client-request.ts#L200-L206)

The request starts when the body is complete. Without chunked encoding, written chunks are collected by a `SlurpStream`, and `_startRequest` runs when it finishes or on `end()` with no body. With chunked encoding, a `ChunkedBodyStream` starts the request on the first write and streams chunks through a data pipe. `_startRequest` derives `referrer`, `origin`, `hasUserActivation`, `mode` and `destination` from the matching headers, calls the native `createURLLoader`, and maps its events. `response-started` becomes an `IncomingMessage`, `data` is pushed into it with back-pressure through `resume`, and `error`, `login`, `redirect` and the progress events follow.

Sources: [lib/common/api/net-client-request.ts:131-198](repo://lib/common/api/net-client-request.ts#L131-L198), [lib/common/api/net-client-request.ts:401-470](repo://lib/common/api/net-client-request.ts#L401-L470)

A `login` event with no listener cancels the authentication. With redirect policy `error`, a redirect fails the request.

Sources: [lib/common/api/net-client-request.ts:459-470](repo://lib/common/api/net-client-request.ts#L459-L470)

### SimpleURLLoaderWrapper

`createURLLoader` is `SimpleURLLoaderWrapper::Create`. It fills a `network::ResourceRequest` from the options: method, URL, referrer and policy, initiator origin, mode, credentials, cache mode and priority. Unless `credentials` or `useSessionCookies` is given, it sends credentials but blocks all cookies, so `net.request` does not use the session's cookies by default. A buffer body is attached directly, and a function body becomes a chunked data pipe. In the browser process it resolves the session from `session`, `partition`, or the default.

Sources: [shell/common/api/electron_api_url_loader.cc:526-560](repo://shell/common/api/electron_api_url_loader.cc#L526-L560), [shell/common/api/electron_api_url_loader.cc:655-720](repo://shell/common/api/electron_api_url_loader.cc#L655-L720)

The wrapper pins itself, and any body getter, so garbage collection cannot drop a request in flight. To start, it picks a factory with `GetURLLoaderFactoryForURL`:

Sources: [shell/common/api/electron_api_url_loader.cc:357-404](repo://shell/common/api/electron_api_url_loader.cc#L357-L404)

1. In a utility process, the shared factory from `URLLoaderBundle`.
2. Unless `bypassCustomProtocolHandlers` is set: an intercepted handler for the scheme, then a registered handler, each as an `ElectronURLLoaderFactory`. The comment says this is done here, not left to the proxying factory, so that `file:` interception works too.
3. For `file:`, an `AsarURLLoaderFactory`.
4. Otherwise the session's trusted `GetURLLoaderFactory`.

Sources: [shell/common/api/electron_api_url_loader.cc:484-523](repo://shell/common/api/electron_api_url_loader.cc#L484-L523)

## net.fetch

`session.fetch` calls `fetchWithSession` with the session and `net.request`. It builds a WHATWG `Request` and handles an already-aborted or later-aborted signal by rejecting with the abort reason, cancelling the body and aborting the request. It then creates a `ClientRequest` with `allowAnyProtocol`, so custom schemes work. `credentials: 'same-origin'` without an `Origin` header is upgraded to `include`. `Sec-Fetch-Mode` is set from `mode`, and every header is copied over. `bypassCustomProtocolHandlers` from the init object is passed to the loader.

Sources: [lib/browser/api/session.ts:44-46](repo://lib/browser/api/session.ts#L44-L46), [lib/browser/api/net-fetch.ts:18-99](repo://lib/browser/api/net-fetch.ts#L18-L99)

On `response` it builds a `Response`: headers with array values joined, a null body for statuses 101, 204, 205 and 304 or for `HEAD`, and otherwise the `IncomingMessage` converted to a web stream. The original message is kept on `__original_resp`, which `protocol.handle` reads to pass the MIME type through when a handler returns the result of `net.fetch`. The request body, if any, is piped into the `ClientRequest`.

Sources: [lib/browser/api/net-fetch.ts:101-125](repo://lib/browser/api/net-fetch.ts#L101-L125), [lib/browser/api/protocol.ts:133-139](repo://lib/browser/api/protocol.ts#L133-L139)
