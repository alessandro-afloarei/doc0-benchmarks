---
type: subsystem
title: Helpers
description: Guide to Hono's helper modules under src/helper — cookie, streaming and SSE, WebSocket, factory, testing client, proxy, conninfo, accepts, adapter/runtime detection, dev route inspection, route introspection, html/css and static site generation — and how runtime adapters plug implementations into them.
tags: [helpers, cookie, streaming, websocket, ssg, factory, proxy]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-c2f00f3388df41550f8e1be3
    resource: repo://src/helper/cookie/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
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
  - id: openwiki-source-c381d12d61294dab23132187
    resource: repo://src/utils/stream.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Helpers

Helpers are plain functions (not middleware) that usually take a `Context` and either read request data or produce a `Response`. Each lives in `src/helper/<name>/` and is published as its own subpath export (`hono/cookie`, `hono/streaming`, `hono/ws`, `hono/factory`, `hono/testing`, `hono/proxy`, `hono/conninfo`, `hono/accepts`, `hono/adapter`, `hono/dev`, `hono/route`, `hono/html`, `hono/css`, `hono/ssg`). Some helpers only define a **runtime-neutral contract** whose implementation is supplied by a [runtime adapter](../integrations/runtime-adapters.md).

| Helper | What it provides | Runtime-specific part |
| --- | --- | --- |
| cookie | `getCookie`, `setCookie`, `deleteCookie`, signed variants | – |
| streaming | `stream`, `streamText`, `streamSSE` | – |
| websocket | `WSContext`, `defineWebSocketHelper`, `UpgradeWebSocket` type | `upgradeWebSocket` from Bun/Deno/Workers adapters |
| conninfo | `ConnInfo`/`GetConnInfo` types | `getConnInfo` in each adapter |
| ssg | `toSSG`, `ssgParams`, `isSSGContext`, `disableSSG`, `onlySSG`, plugins | `toSSG` wrappers in Bun/Deno adapters |
| factory | `createFactory`, `createMiddleware`, `createHandlers` | – |
| testing | `testClient(app)` | – |
| proxy | `proxy(url, init)` | – |
| adapter | `env(c)`, `getRuntimeKey()` | – |
| accepts | `accepts(c, { header, supports, default })` | – |
| dev | `inspectRoutes`, `showRoutes`, `getRouterName` | – |
| route | `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath` | – |
| html, css | tagged template HTML and CSS-in-JS | see [Server JSX](../jsx/server-jsx.md) |

## Cookie

`getCookie(c, key?, prefix?)` parses the `Cookie` header via `src/utils/cookie.ts`; `prefix: 'secure' | 'host'` reads `__Secure-`/`__Host-` names. `setCookie` serializes and appends a `Set-Cookie` header (append mode, so several cookies can be set), defaulting `path` to `/`.

Safety rules enforced by `serialize` in `src/utils/cookie.ts`:

- `__Secure-` cookies are forced `secure: true`; `__Host-` cookies are forced `secure`, `path: '/'` and no `domain`.
- Invalid names and attribute values containing `;`, `\r` or `\n` throw.
- `Max-Age` and `Expires` beyond 400 days throw, per RFC 6265bis.
- `Partitioned` requires `Secure`.

Signed cookies (`setSignedCookie`/`getSignedCookie`) use HMAC-SHA-256 via Web Crypto. `getSignedCookie` returns `false` for a cookie whose signature does not verify (distinct from `undefined` for missing). `deleteCookie` sets an empty value with `maxAge: 0` and returns the previous value.

## Streaming

`stream(c, cb, onError?)` creates a `TransformStream`, wraps it in `StreamingApi` (`src/utils/stream.ts`) and returns `c.newResponse(readable)` immediately while `cb` runs asynchronously. `StreamingApi` offers `write`, `writeln`, `pipe`, `sleep`, `close`, `onAbort` and `abort`; write/close errors are swallowed. If the client disconnects, the response stream's `cancel` triggers `abort()`, which runs the `onAbort` subscribers.

`streamText` sets text headers; `streamSSE` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`, and exposes `writeSSE({ data, event, id, retry })`. Multi-line `data` is split into multiple `data:` lines; `event`, `id` or `retry` containing CR/LF throws to prevent SSE injection. If the callback throws an `Error` and `onError` is given, `onError` runs and an `event: error` message with the error message is written.

Bun compatibility: the context is stashed in a `WeakMap` keyed by the response stream so it is not collected mid-stream, and for Bun < 1.1.27 the request's abort signal is wired to `stream.abort()`.

## WebSocket

`src/helper/websocket/index.ts` defines the runtime-independent pieces:

- `WSContext` – wraps an adapter-provided `send`/`close`/`readyState`/`raw`.
- `WSEvents` – `onOpen`, `onMessage`, `onClose`, `onError`.
- `defineWebSocketHelper(handler)` – turns an adapter's upgrade function into an `UpgradeWebSocket` with two call styles: as middleware (`upgradeWebSocket((c) => events, options)`, which calls `next()` if the upgrade did not happen) or imperatively (`upgradeWebSocket(c, events)`, which throws `Failed to upgrade WebSocket` if it fails).

The response type is tagged with `outputFormat: 'ws'`, which the [RPC client](../integrations/rpc-client.md) uses to expose `$ws()`.

## Factory

`createMiddleware<E>(fn)` is an identity function that only exists for typing middleware (env variables, inputs, typed responses). `createFactory({ initApp, defaultAppOptions })` returns a `Factory` whose `createApp()` constructs a `Hono` with merged default options and runs `initApp(app)`, and whose `createHandlers(...)` lets handler arrays be defined outside `app.get()` while keeping per-position input inference (it filters out `undefined` entries at runtime).

## Testing

`testClient(app, env?, executionCtx?, options?)` returns an `hc` client whose `fetch` is `app.request(...)`, so typed RPC-style calls hit the app in-process without a network.

## Proxy

`proxy(input, init)` is a `fetch` wrapper for reverse proxying:

- When `init.raw` (or a `Request` as `init`) is passed, method, body (with `duplex: 'half'`), headers and signal are copied, and hop-by-hop headers (`connection`, `keep-alive`, `te`, `transfer-encoding`, `upgrade`, ...) are removed.
- Header record values of `undefined`/`null` delete headers (e.g. drop `Authorization`).
- `Accept-Encoding` is always removed from the outgoing request; on the response, hop-by-hop headers are stripped and, if `Content-Encoding` is present, both it and `Content-Length` are dropped because the runtime has already decoded the body.
- `strictConnectionProcessing: true` additionally removes headers listed in `Connection` (rejecting invalid tokens with `HTTPException(400)`); the default ignores `Connection` to avoid hop-by-hop header injection from untrusted clients.
- `customFetch` replaces the global `fetch`.

## Adapter and conninfo

`getRuntimeKey()` detects `deno`, `bun`, `workerd`, `node` by `navigator.userAgent` prefix, then `edge-light` (global `EdgeRuntime`), `fastly` (global `fastly`), then Node via `process.release.name`, else `other`. `env(c, runtime?)` returns `process.env` on Node/Bun/edge-light, `Deno.env.toObject()` on Deno, `c.env` on workerd and `{}` elsewhere.

`hono/conninfo` only declares `ConnInfo { remote: { address?, addressType?, port?, transport? } }` and `GetConnInfo = (c) => ConnInfo`; each adapter exports `getConnInfo`. The [ip-restriction middleware](../middleware/security-and-auth.md) takes a `GetConnInfo` as input.

## Accepts

`accepts(c, { header, supports, default, match? })` parses an `Accept*` header, sorts by `q` and returns the first supported value, or `default` when the header is missing or nothing matches. A custom `match` can replace the selection.

## Dev and route introspection

- `inspectRoutes(app)` lists `{ path, method, name, isMiddleware }` for every registered route, unwrapping sub-app error-handler wrappers via `findTargetHandler`; `showRoutes(app, { verbose, colorize })` prints them.
- `getRouterName(app)` forces a match (so `SmartRouter` picks its router) and returns e.g. `SmartRouter + RegExpRouter`.
- `hono/route` reads the match result for the current handler: `matchedRoutes(c)`, `routePath(c, index?)`, `baseRoutePath(c, index?)` and `basePath(c, index?)` (the *actual* request prefix for a parameterized `app.route('/:sub', ...)`, cached per context in a `WeakMap`).

## Static site generation (SSG)

`toSSG(app, fs, options)` renders an app to files:

1. `fetchRoutesContent` walks `app.routes`, keeping `GET`/`ALL` routes whose real handler is not middleware.
2. Each route is first requested with `env[SSG_CONTEXT] = true`. The `ssgParams(params)` middleware, on dynamic routes, attaches the param list to the request and short-circuits with `notFound()`. Dynamic routes (`:param` or `*`) without `ssgParams` are skipped.
3. Each concrete path is requested again; responses with the `x-hono-disable-ssg` header (set by `disableSSG()`) are skipped. `onlySSG()` makes routes 404 outside SSG.
4. Content is written through the provided `fs` module (`writeFile`, `mkdir`), mapping MIME types to extensions (`defaultExtensionMap`). `ensureWithinOutDir` rejects paths that would escape the output directory.

Requests are throttled by a pool (`concurrency`, default 2). Hooks (`beforeRequestHook`, `afterResponseHook`, `afterGenerateHook`) can be passed directly or through plugins; when no plugins are given, `defaultPlugin()` (skips non-200 responses) is used. `redirectPlugin()` emits redirect HTML pages and must be ordered before `defaultPlugin()`. Errors are caught and returned as `{ success: false, error }` rather than thrown. Bun and Deno adapters export `toSSG` bound to their file APIs.

## Tests

Each helper has a colocated test file (e.g. `src/helper/cookie/index.test.ts`, `src/helper/streaming/sse.test.tsx`, `src/helper/proxy/index.test.ts`, `src/helper/ssg/ssg.test.tsx`, `src/helper/websocket/index.test.ts`). Adapter-specific behavior is tested under `src/adapter/*` and `runtime-tests/`.
