---
title: "The net Module"
---
## Overview

The `net` module makes HTTP requests from the main process and from utility processes using Chromium's network service rather than Node's `http`. Requests therefore use the session's cookies, cache, proxy settings, certificate verification and `webRequest` listeners, and go through the same stack as a page's requests. There are two APIs on one core: `net.request` returns a Node-style `ClientRequest` writable stream with an `IncomingMessage` response, and `net.fetch` / `session.fetch` implement the WHATWG `fetch` on top of `ClientRequest`. Both end in a native `SimpleURLLoaderWrapper` created by the `electron_common_net` binding. Interception of the requests it makes is covered in [[Custom Protocols and Request Interception]].

Sources: [lib/browser/api/net.ts:1-27](repo://lib/browser/api/net.ts#L1-L27), [lib/common/api/net-client-request.ts:9-13](repo://lib/common/api/net-client-request.ts#L9-L13), [shell/common/api/electron_api_net.cc:86-91](repo://shell/common/api/electron_api_net.cc#L86-L91)

## Entry points

In the main process, `net.request` refuses to run before `ready`, `net.fetch` is `session.defaultSession.fetch`, and `net.resolveHost` asks the default session. In a utility process there is no session: `request` and `fetch` go straight to `ClientRequest`, and `resolveHost` comes from the native binding. `net.isOnline()` and `net.online` report Chromium's `NetworkChangeNotifier` state in both.

Sources: [lib/browser/api/net.ts:8-27](repo://lib/browser/api/net.ts#L8-L27), [lib/utility/api/net.ts:1-22](repo://lib/utility/api/net.ts#L1-L22), [shell/common/api/electron_api_net.cc:26-28](repo://shell/common/api/electron_api_net.cc#L26-L28)

## ClientRequest

### Building the options

`parseOptions` accepts a URL string or an options object. Without `url` it assembles one from `protocol` (default `http:`), `host` or `hostname` (default `localhost`), `port` and `path`, rejecting paths with unescaped spaces. It validates `redirect` (`follow`, `error` or `manual`, default `follow`) and headers, and produces the loader options: method, URL, `useSessionCookies`, `credentials`, `origin`, `referrerPolicy`, `cache` and `priority`. A `session` must be a `Session` instance and a `partition` a string.

Sources: [lib/common/api/net-client-request.ts:229-317](repo://lib/common/api/net-client-request.ts#L229-L317)

The constructor only accepts `http:` and `https:` URLs unless the options were marked with `allowAnyProtocol`, which `net.fetch` does so it can reach custom and `file:` schemes. `credentials: 'same-origin'` without an `origin` throws.

Sources: [lib/common/api/net-client-request.ts:201-212](repo://lib/common/api/net-client-request.ts#L201-L212), [lib/common/api/net-client-request.ts:340-347](repo://lib/common/api/net-client-request.ts#L340-L347)

### Sending the body

The request starts lazily. Writing without `chunkedEncoding` buffers the whole body in a `SlurpStream` and starts the request on `end()`; `end()` with no body starts it immediately. With `chunkedEncoding = true` (settable once, before starting), the first write starts the request and the body is streamed through a `ChunkedBodyStream` into a data pipe that the native side reads as an HTTP chunked upload.

Sources: [lib/common/api/net-client-request.ts:146-196](repo://lib/common/api/net-client-request.ts#L146-L196), [lib/common/api/net-client-request.ts:348-367](repo://lib/common/api/net-client-request.ts#L348-L367), [lib/common/api/net-client-request.ts:403-424](repo://lib/common/api/net-client-request.ts#L403-L424)

### Starting and events

`_startRequest` derives the referrer, origin, user activation, fetch mode and destination from the headers the caller set (`Referer`, `Origin`, `Sec-Fetch-*`), flattens the headers, and calls `createURLLoader`. It then translates the loader's events:

Sources: [lib/common/api/net-client-request.ts:426-442](repo://lib/common/api/net-client-request.ts#L426-L442)

| Loader event | ClientRequest behaviour |
| --- | --- |
| `response-started` | Creates an `IncomingMessage` from the response head and emits `response` |
| `data` | Hands the chunk and a `resume` callback to the response stream |
| `complete` | Ends the response stream |
| `error` | Destroys the response and emits `error` with the net error string |
| `login` | Emits `login`; with no listener, cancels authentication |
| `redirect` | Applies the redirect policy (below) |
| `upload-progress`, `download-progress` | Updates progress state |

Sources: [lib/common/api/net-client-request.ts:443-505](repo://lib/common/api/net-client-request.ts#L443-L505)

Redirect policy `error` fails the request. `manual` emits `redirect` and fails with "Redirect was cancelled" unless a listener calls `followRedirect()` synchronously. `follow` emits `redirect` for information and lets it proceed.

Sources: [lib/common/api/net-client-request.ts:467-495](repo://lib/common/api/net-client-request.ts#L467-L495)

### IncomingMessage and back-pressure

`IncomingMessage` is a `Readable`. Each `data` event stores the chunk and the native `resume` callback; chunks are pushed while the stream wants more, and `resume` is only called once the consumer has drained them, so a slow reader pauses the network download instead of buffering it all in memory. `headers` merges duplicate headers the way Node does, keeping only the first of headers Node treats as single-valued.

Sources: [lib/common/api/net-client-request.ts:15-38](repo://lib/common/api/net-client-request.ts#L15-L38), [lib/common/api/net-client-request.ts:100-127](repo://lib/common/api/net-client-request.ts#L100-L127)

## SimpleURLLoaderWrapper

### Creation

`SimpleURLLoaderWrapper::Create` builds a `network::ResourceRequest` from the options, sets a chunked data-pipe body when a body getter was supplied, and in the main process resolves the browser context from `session`, `partition` or the default session. The wrapper pins itself (and the body getter) so it is not garbage-collected while the request runs.

Sources: [shell/common/api/electron_api_url_loader.cc:526-560](repo://shell/common/api/electron_api_url_loader.cc#L526-L560), [shell/common/api/electron_api_url_loader.cc:690-720](repo://shell/common/api/electron_api_url_loader.cc#L690-L720)

The constructor marks the request as trusted, asks for raw headers so every response header reaches JavaScript, and installs itself as the request's network-service observer, which is how it receives authentication challenges and certificate errors. In a utility process started with `respondToAuthRequestsFromMainProcess`, it skips that and lets the main process's observer handle them.

Sources: [shell/common/api/electron_api_url_loader.cc:326-355](repo://shell/common/api/electron_api_url_loader.cc#L326-L355)

### Choosing the factory

`Start` creates a `network::SimpleURLLoader`, allowing HTTP error statuses through, wiring the response-started, redirect and progress callbacks, and downloading as a stream. The URL loader factory depends on where it runs and on the scheme:

Sources: [shell/common/api/electron_api_url_loader.cc:357-389](repo://shell/common/api/electron_api_url_loader.cc#L357-L389)

1. In a utility process, the shared factory the main process passed to the child's `NodeService` ([[MessagePorts and the Utility Process]]).
2. Otherwise, unless `bypassCustomProtocolHandlers` was set, an `ElectronURLLoaderFactory` for a scheme the session intercepts or registers. This is done here, before the proxying factory would see the request, so that intercepted `file:` URLs work too.
3. For `file:`, the asar-aware factory.
4. For everything else, the browser context's URL loader factory, which goes through the session's network context and `webRequest` proxy.

Sources: [shell/common/api/electron_api_url_loader.cc:484-524](repo://shell/common/api/electron_api_url_loader.cc#L484-L524)

### Events

Data arrives in `OnDataReceived` and is emitted as an `ArrayBuffer` with the `resume` closure. `OnComplete` emits `complete` or `error` with the net error name and drops the pins. `OnAuthRequired` emits `login` with a callback that supplies credentials or, called with no arguments, cancels; if the request is cancelled while waiting, the responder's disconnect cancels the loader.

Sources: [shell/common/api/electron_api_url_loader.cc:722-770](repo://shell/common/api/electron_api_url_loader.cc#L722-L770), [shell/common/api/electron_api_url_loader.cc:406-436](repo://shell/common/api/electron_api_url_loader.cc#L406-L436)

## net.fetch

`fetchWithSession` adapts the `fetch` contract to `ClientRequest`. It constructs a `Request`, rejects immediately if the signal is already aborted, and on a later abort rejects the promise, cancels the request body and aborts the `ClientRequest`. It maps `credentials` (downgrading `same-origin` without an origin to `include`), `cache`, `referrerPolicy` and `redirect`, sets `Sec-Fetch-Mode` unless that would be `cors` without an origin, and copies the headers.

Sources: [lib/browser/api/net-fetch.ts:18-99](repo://lib/browser/api/net-fetch.ts#L18-L99)

On `response` it builds a `Response` whose body is the `IncomingMessage` converted to a web stream, or `null` for 101, 204, 205, 304 and `HEAD`, and keeps the original response on the object so `protocol.handle` can recover its MIME type. The request body, if any, is piped into the `ClientRequest`.

Sources: [lib/browser/api/net-fetch.ts:101-125](repo://lib/browser/api/net-fetch.ts#L101-L125), [lib/browser/api/protocol.ts:133-139](repo://lib/browser/api/protocol.ts#L133-L139)

## Network contexts

Each session's requests go through a network context configured by `NetworkContextService::ConfigureNetworkContextParams`. It starts from the system defaults, then applies the session's SSL configuration, user agent, CORS access list, `Accept-Language` from the app locale, and whether the HTTP cache is enabled. Persistent sessions get on-disk paths under the session directory for the network data, cache, cookies, server properties, trust tokens and HSTS state; session cookies are not persisted, and cookie encryption follows the `EnableCookieEncryption` fuse ([[Fuses]]).

Sources: [shell/browser/net/network_context_service.cc:46-120](repo://shell/browser/net/network_context_service.cc#L46-L120)

`SystemNetworkContextManager` owns the system network context used for requests that belong to no session, such as the factories handed to utility processes. When the network service starts it sets up HTTP authentication, creates the system context, configures the DNS stub resolver, and, if the network service runs out of process and cookie encryption is on, sends it the OS encryption key.

Sources: [shell/browser/net/system_network_context_manager.cc:144-175](repo://shell/browser/net/system_network_context_manager.cc#L144-L175), [shell/browser/net/system_network_context_manager.cc:250-284](repo://shell/browser/net/system_network_context_manager.cc#L250-L284), [shell/browser/api/electron_api_utility_process.cc:218-226](repo://shell/browser/api/electron_api_utility_process.cc#L218-L226)

`net.resolveHost` runs a `ResolveHostFunction`, which uses the utility process's host resolver or the session's network context.

Sources: [shell/common/api/electron_api_net.cc:46-60](repo://shell/common/api/electron_api_net.cc#L46-L60), [shell/browser/net/resolve_host_function.cc:46-75](repo://shell/browser/net/resolve_host_function.cc#L46-L75)
