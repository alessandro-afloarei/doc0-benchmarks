---
type: reference
title: Helper Modules
description: Survey of the helper modules under src/helper - factory and createMiddleware for typed apps and middleware, testClient for in-process requests, streaming (stream, streamText, streamSSE), the WebSocket helper contract, cookies, connection info, the reverse proxy, route introspection, dev-time route printing, the html and css tagged-template helpers, and accepts - with the role and key mechanism of each.
tags: [helpers, factory, testing, streaming, sse, websocket, cookie, proxy, route, dev, html, css]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-3f907dd5d3367ef4be8829b4
    resource: repo://src/helper/dev/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
  - id: openwiki-source-a49b959930b2834e410ba9de
    resource: repo://src/utils/cookie.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Helper Modules

<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/static-site-generation.md] link "/openwiki/helpers/static-site-generation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/helper/*` contains optional utilities that build on `Context`, `HonoRequest`, and the middleware contract. Each helper is published as its own subpath (for example `hono/factory`, `hono/testing`, `hono/streaming`, `hono/ws`, `hono/proxy`; see `package.json`). Helpers never change routing or dispatch. Several of them depend on a runtime adapter for platform specifics, such as WebSocket upgrades and connection addresses, and those are described in [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md). Static-site generation has its own page: [Static Site Generation (SSG) Helper](/openwiki/helpers/static-site-generation.md).

## Typing Helpers: `factory`

`createFactory({ initApp?, defaultAppOptions? })` returns a `Factory` whose methods are bound to a single environment type and path type:

- `createApp(options?)` constructs a `Hono` instance. Options passed to `createApp` are shallow-merged over `defaultAppOptions`, and `initApp` runs against the new app before it is returned, which is the place to install shared middleware or error handlers.
- `createMiddleware(fn)` produces a middleware typed with the factory's environment.
- `createHandlers(...handlers)` returns its arguments with `undefined` entries removed. Its declared type ties the handler list to the factory's environment and path types, so the result can be passed directly to `app.get(path, ...)`.

Both `createMiddleware` forms (the factory method and the standalone export) are identity functions that return the middleware they receive; their purpose is type inference, not runtime behavior. The factory is the recommended way to share environment typings across files in larger applications.

## In-Process Testing: `testing`

<!-- openwiki: broken internal link [/openwiki/client/typed-rpc-client.md] link "/openwiki/client/typed-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`testClient(app, env?, executionCtx?, options?)` returns a typed client (see [Typed RPC Client (hc)](/openwiki/client/typed-rpc-client.md)) whose base URL is `http://localhost`. Its `fetch` override calls `app.request(input, init, env, executionCtx)`, so requests never leave the process and no server is started. Passing `env` lets tests supply bindings directly. Because the client is built from the same `Hono` type as the application, test code gets the same route-level type checking as production clients.

## Streaming: `streaming`

Three helpers wrap a `TransformStream` in a `StreamingApi` and return a `Response` whose body is the readable side:

- **`stream(c, callback, onError?)`** runs the callback with a `StreamingApi` that exposes `write`, `writeln`, `sleep`, `pipe`, `onAbort`, `abort`, and `close`. Abort is wired to the request's abort signal on older Bun versions, where cancellation was not propagated. The context is stashed for the lifetime of the stream, because on Bun the context may be torn down as soon as the response is returned.
- **`streamText(c, callback, onError?)`** is the same mechanism with `Content-Type: text/plain`, `X-Content-Type-Options: nosniff`, and chunked transfer encoding set first.
- **`streamSSE(c, callback, onError?)`** uses `SSEStreamingApi`, which writes `data`, `event`, `id`, and `retry` fields in the SSE wire format. It sets `Transfer-Encoding: chunked`, `Content-Type: text/event-stream`, `Cache-Control: no-cache`, and `Connection: keep-alive` before returning.

The callback runs asynchronously, so the response is returned before the callback finishes. For `streamSSE`, an exception in the callback is passed to `onError` (when provided) and then sent to the client as an `error` event carrying the message; without `onError` the error is logged with `console.error`. The stream is closed in all cases.

## WebSocket Contract: `websocket`

`src/helper/websocket/index.ts` defines the shared contract, not a transport. `defineWebSocketHelper(handler)` produces an `upgradeWebSocket` function with two call forms:

- A middleware form, `upgradeWebSocket(createEvents, options?)`, that returns a middleware. The middleware calls `createEvents(c)` to obtain `WSEvents` (`onOpen`, `onMessage`, `onClose`, `onError`), then the platform handler. If the handler returns nothing, the middleware calls `next()`.
- A direct form, `upgradeWebSocket(c, events, options?)`, that returns the upgrade response and throws `Failed to upgrade WebSocket` if the platform handler does not upgrade.

`WSContext` is the object exposed to event callbacks (`send`, `close`, `readyState`), and `createWSMessageEvent` normalizes messages from strings, blobs, and buffers. Each runtime adapter supplies its own handler to `defineWebSocketHelper` (see the adapters page).

## Cookies: `cookie`

<!-- openwiki: broken internal link [/openwiki/utils/crypto-jwt-and-encoding.md] link "/openwiki/utils/crypto-jwt-and-encoding.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`getCookie`, `setCookie`, and `deleteCookie` read and write cookies on the context, and `getCookie` accepts a prefix option. `getSignedCookie` and `setSignedCookie` add integrity checking; the signature is HMAC-SHA-256 computed with Web Crypto, so these functions are asynchronous. `generateCookie` and `generateSignedCookie` produce the `Set-Cookie` string without touching the context. See [Crypto, JWT and Encoding Utilities](/openwiki/utils/crypto-jwt-and-encoding.md) for the underlying utilities.

## Connection Information: `conninfo`

The `conninfo` helper defines the types `ConnInfo`, `NetAddrInfo`, and `GetConnInfo`; `ConnInfo` carries a `remote` address record. The function itself is supplied per runtime by each adapter, so calling `getConnInfo(c)` yields platform-specific information. On Cloudflare Workers the value is derived from request headers (see the adapters page).

## Reverse Proxy: `proxy`

`proxy(input, init)` forwards a request to another URL and returns the upstream response. It copies the incoming request's headers, removes hop-by-hop headers from the response, deletes `accept-encoding` on the forwarded request, and drops `content-encoding` and `content-length` from the response when the upstream body is compressed, since the bytes the client receives are no longer the bytes the upstream sent. The `customFetch` option lets callers route the upstream call through another fetch implementation.

## Route Introspection: `route`, `dev`

- **`route`** reads routing data from a context: `matchedRoutes(c)` lists the route records that matched, and `routePath`, `baseRoutePath`, and `basePath` return the registered pattern at the current or given index. These functions read the same match result that `HonoRequest` uses for parameters, and they are useful for logging and for middleware that behaves differently per route.
<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`dev`** serves development-time diagnostics. `inspectRoutes(app)` returns each registered route with its path, method, a derived handler name, and whether it is middleware. `showRoutes(app, { verbose?, colorize? })` prints them as a table, collapsing duplicate method and path pairs. `getRouterName(app)` triggers a match against `/` so that the active router (which is resolved lazily by `SmartRouter`) reports its name; see [Router Selection and Matching](/openwiki/routing/router-selection.md).

## Templating: `html` and `css`

- **`html`** is a tagged template that escapes interpolated values by default. Arrays are flattened, `null`, `undefined`, and booleans render as nothing, numbers are inserted directly, and values wrapped with `raw` are inserted without escaping. If any interpolated value is a promise, the template returns a promise. The result is an `HtmlEscapedString`, which the core treats as already escaped.
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`css`** is a tagged template that produces scoped class names and collects the CSS text. `createCssContext` builds an isolated context, `css`, `cx`, `keyframes`, and `viewTransition` are bound to a default context, and `Style` is a JSX component that emits the collected rules. The module is designed for server-rendered JSX (see [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md)).

## Content Negotiation: `accepts`

`accepts(c, options)` reads the header named by `options.header`, parses it, and returns the best match according to `options.match` (by default, a quality-weighted match against the supported values), or `options.default` when the header is absent. The compression and language middleware use this module.

## Tests

Colocated test files sit beside the sources, for example `src/helper/streaming/sse.test.tsx`, `src/helper/streaming/stream.test.ts`, `src/helper/proxy/index.test.ts`, and `src/helper/testing/index.test.ts`.
