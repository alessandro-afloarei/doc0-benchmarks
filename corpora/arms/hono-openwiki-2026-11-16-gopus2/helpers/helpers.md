---
type: reference
title: Helpers
description: What each module under src/helper provides — cookies, html/css templating, streaming and SSE, static site generation, WebSocket and connection-info abstractions, runtime detection and env access, factories, testing client, proxy, route introspection and dev tooling — and the mechanisms behind them.
tags: [helpers, cookie, streaming, ssg, websocket, proxy, factory]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-c2f00f3388df41550f8e1be3
    resource: repo://src/helper/cookie/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-015f2dc60c9d3599ae2b42ec
    resource: repo://src/helper/websocket/index.ts
  - id: openwiki-source-a49b959930b2834e410ba9de
    resource: repo://src/utils/cookie.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Helpers

Helpers are functions, not middleware. You call them inside handlers, usually with the `Context`. Each one is its own subpath export (`hono/cookie`, `hono/streaming`, `hono/ws`, …; see [Architecture Overview](../architecture/overview.md)). Several of them define a runtime-independent **contract** that the [Runtime Adapters](../integrations/runtime-adapters.md) implement.

| Module | Export | Purpose |
| --- | --- | --- |
| `cookie` | `hono/cookie` | Read, set, sign and delete cookies |
| `html` | `hono/html` | `html` tagged template and `raw` |
| `css` | `hono/css` | CSS-in-JS for JSX (`css`, `cx`, `keyframes`, `Style`, `createCssContext`) |
| `streaming` | `hono/streaming` | `stream`, `streamText`, `streamSSE` |
| `ssg` | `hono/ssg` | Static site generation (`toSSG`, `ssgParams`, `onlySSG`, `disableSSG`) |
| `websocket` | `hono/ws` | `WSContext`, `defineWebSocketHelper`, event types |
| `conninfo` | `hono/conninfo` | `ConnInfo` / `GetConnInfo` types (remote address, port, transport) |
| `adapter` | `hono/adapter` | `env(c)` and `getRuntimeKey()` |
| `accepts` | `hono/accepts` | Content negotiation over `Accept*` headers |
| `factory` | `hono/factory` | `createFactory`, `createMiddleware`, `createHandlers` |
| `testing` | `hono/testing` | `testClient(app)` |
| `proxy` | `hono/proxy` | `proxy(url, init)` reverse-proxy fetch |
| `route` | `hono/route` | `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath` |
| `dev` | `hono/dev` | `inspectRoutes`, `showRoutes`, `getRouterName` |

## Cookies (`src/helper/cookie`)

- `getCookie(c, key?, prefix?)` parses the `Cookie` header with `utils/cookie.parse`. `prefix: 'secure' | 'host'` reads `__Secure-`/`__Host-` names.
- `setCookie(c, name, value, opts)` **appends** a `Set-Cookie` header, so several cookies coexist. `path` defaults to `/`. With `prefix: 'secure'`, `secure: true` is forced. With `prefix: 'host'`, `secure: true`, `path: '/'` and no `domain` are forced, as the cookie-prefix rules require.
- `getSignedCookie` / `setSignedCookie` add an HMAC-SHA256 signature through Web Crypto (`utils/cookie` + `utils/crypto`). A signature that does not verify gives `false`, a missing cookie gives `undefined`.
- `deleteCookie` sets the cookie with `maxAge: 0` and returns the previous value.

The validator's `cookie` target and the `csrf` middleware use the same parsing.

## Streaming (`src/helper/streaming`)

`stream(c, cb, onError?)` creates a `TransformStream`, wraps its writable side in `StreamingApi` (`src/utils/stream.ts`), starts `cb` **without awaiting it**, and returns `c.newResponse(readable)` straight away. Errors thrown by `cb` go to `onError`, or are logged. The stream is always closed in `finally`. The Context is held in a `WeakMap` keyed by the stream, because Bun drops `c` once the response is returned. For Bun versions before 1.1.27, abort is wired to the request signal by hand.

`streamText` adds text headers. `streamSSE` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`. Its `SSEStreamingApi.writeSSE({ data, event, id, retry })` writes framed events. Multi-line data is split into several `data:` lines. `event`, `id` and `retry` values that contain CR or LF are rejected with an error, which prevents event injection.

## Static site generation (`src/helper/ssg`)

`toSSG(app, fs, options)` pre-renders an app into files:

1. `filterStaticGenerateRoutes` picks `GET`/`ALL` routes whose handler is not a middleware.
2. For each route, the app is fetched once with `env[SSG_CONTEXT] = true`. The `ssgParams()` middleware attaches parameter sets to the request during this pass. Dynamic routes (`:param` or `*`) with no `ssgParams` are skipped.
3. Every parameter set is requested through `app.request`, with bounded concurrency (`utils/concurrent.ts`). `beforeRequestHook` / `afterResponseHook` / `afterGenerateHook` (and plugins such as `defaultPlugin` and `redirectPlugin`) can filter or rewrite requests and responses.
4. The content is written with the supplied `fs` module. The file extension comes from the MIME type (`defaultExtensionMap`), and `ensureWithinOutDir` rejects path traversal outside `outDir` (default `./static`).

`onlySSG()` returns 404 outside SSG. `disableSSG()` makes a route return 404 during SSG and sets the `x-hono-disable-ssg` header, so SSG skips it. `isSSGContext(c)` tells you which mode you are in. The Bun and Deno adapters ship `toSSG` variants that are already bound to their file-system APIs.

## WebSocket and ConnInfo contracts

`src/helper/websocket` is runtime-neutral. `WSContext` wraps a platform socket behind `send`, `close`, `readyState`, `raw` and `url`. `defineWebSocketHelper(handler)` turns a platform-specific upgrade function into an `upgradeWebSocket` that you can use in two ways:

- as middleware, `upgradeWebSocket((c) => events, options)`. It returns the upgrade response, or calls `next()` if the request was not upgraded;
- called directly, `upgradeWebSocket(c, events, options)`. It throws `Failed to upgrade WebSocket` if the upgrade fails.

The Cloudflare Workers, Deno and Bun adapters implement it. Routes typed with `outputFormat: 'ws'` expose `$ws()` on the RPC client. `src/helper/conninfo` defines only the `ConnInfo` shape. Each adapter exports its own `getConnInfo`, which the `ip-restriction` middleware uses.

## Runtime detection (`src/helper/adapter`)

`getRuntimeKey()` detects `deno`, `bun`, `workerd` or `node` from `navigator.userAgent`. It falls back to `globalThis.EdgeRuntime` (`edge-light`), `globalThis.fastly`, and `process.release.name === 'node'`, and returns `other` if nothing matches. `env(c, runtime?)` returns environment variables the same way on every runtime: `process.env` on Node, Bun and edge-light, `Deno.env.toObject()` on Deno, `c.env` on workerd, and `{}` on Fastly and unknown runtimes.

## Factory and testing

- `createMiddleware<E>(fn)` keeps the middleware's `Env` and `Input` types when it is passed to `app.use`.
- `createFactory({ initApp, defaultAppOptions })` returns a `Factory` with `createApp` (which runs `initApp` on every new app), `createMiddleware` and `createHandlers`. `createHandlers` lets you define handler arrays outside a route without losing inference.
- `testClient(app, env?, executionCtx?)` is an `hc` client whose `fetch` is `app.request` (see [Type System and RPC Client](../concepts/types-and-rpc-client.md)).

## Proxy (`src/helper/proxy`)

`proxy(input, init)` builds an upstream `Request`, optionally from `init.raw` (for example `...c.req`), and fetches it with `customFetch` or the global `fetch`. Then:

- **Hop-by-hop headers** (`connection`, `keep-alive`, `te`, `upgrade`, `transfer-encoding`, …) are removed from both the request and the response.
- The **`Connection` header is ignored by default**, which blocks hop-by-hop header injection. With `strictConnectionProcessing: true`, the headers it lists are removed per RFC 9110, and invalid tokens give `HTTPException(400)`.
- `Accept-Encoding` is removed from the upstream request. If the upstream response has `Content-Encoding`, that header and `Content-Length` are removed, because the body has already been decoded.
- Header values given as `undefined` in `init.headers` delete the header, which keeps credentials from being forwarded.

## Route and dev introspection

`hono/route` reads the match result through the `GET_MATCH_RESULT` symbol on `HonoRequest`, giving you the matched routes and the path, or base path, of the current or an indexed handler. `hono/dev` lists `app.routes` (`inspectRoutes`, and `showRoutes` with colours from `utils/color.ts`) and reports the router name. The preset tests use it to check which router is configured.

## Tests

Each helper has a co-located `*.test.ts(x)`. `src/helper/ssg/ssg.test.tsx` covers hooks, plugins and path-traversal protection. `src/helper/proxy/index.test.ts` covers hop-by-hop stripping and strict Connection processing. `src/helper/streaming/*.test.ts` covers abort and error behaviour. Runtime-specific behaviour, such as Deno's SSG and streaming, is tested in `runtime-tests/` (see [Testing Strategy](../testing/testing-strategy.md)).
