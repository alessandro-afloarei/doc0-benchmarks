---
type: component-group
title: Helpers (SSG, Streaming, Cookie, Factory, Testing, WebSocket, Proxy, etc.)
description: The opt-in utility modules under src/helper — static site generation pipeline and plugins, streaming and SSE, cookies, factory/createMiddleware, testClient, WebSocket abstraction, proxy, route and dev introspection, html and accepts.
tags: [helpers, ssg, streaming, sse, websocket, factory, testing, cookie]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
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
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Helpers

`src/helper/*` modules are separate public entry points (`hono/ssg`, `hono/streaming`, `hono/cookie`, `hono/factory`, `hono/testing`, `hono/ws`, `hono/proxy`, `hono/route`, `hono/dev`, `hono/html`, `hono/accepts`, `hono/adapter`, `hono/conninfo`, `hono/css`). They sit above core and below middleware/adapters in the [layering](../architecture/overview.md). Runtime-specific parts (file systems for SSG, WebSocket upgrade, serve-static) are provided by [adapters](../runtimes/adapters.md).

## Static site generation (`helper/ssg`)

`toSSG(app, fsModule, options)` (`ssg.ts`) renders an app's GET routes to files.

**Route discovery.** `filterStaticGenerateRoutes(app)` (`utils.ts`) walks `app.routes` and keeps entries with method `GET` or `ALL` whose handler is not middleware (it unwraps `COMPOSED_HANDLER` first).

**Two-request protocol per route** (`fetchRoutesContent`, a generator of promises, concurrency-limited by `createPool`):
1. An *info* request to the route path with env `{ HONO_SSG_CONTEXT: true }`. Dynamic routes (`:param` or `*`) must set `request.ssgParams` via the `ssgParams()` middleware (accepts an array or an async function of `c`); that middleware stores the params on the raw request and returns `c.notFound()` to stop the chain. A dynamic route with no `ssgParams` is skipped; a static route defaults to `[{}]`.
2. One *content* request per param set, with `:name` segments substituted (`replaceUrlParam`). Responses carrying the `x-hono-disable-ssg` header are skipped.

`beforeRequestHook` / `afterResponseHook` / `afterGenerateHook` (from options and plugins; each may be a single function or an array, combined by `combineBefore…`/`combineAfter…`) can modify or drop (`false`) requests and responses. Default plugin = `defaultPlugin()`, which drops non-200 responses; `redirectPlugin()` converts 301/302/303/307/308 responses into a small HTML page with a meta refresh. Passing `plugins` replaces the default plugin.

**Writing.** `saveContentToFile` computes the file path from the route path, mime type and `extensionMap` (`defaultExtensionMap`, e.g. `text/html`→`.html`), creates directories once (tracked in a module-level `createdDirs` set), and writes strings or `ArrayBuffer`s. `ensureWithinOutDir` guards against paths escaping the output directory. The `FileSystemModule` abstraction (`writeFile`, `mkdir`) is what the Bun/Deno adapters implement (`adapter/bun/ssg.ts`, `adapter/deno/ssg.ts`); `ToSSGAdaptorInterface` is the app+options form they export.

**In-app controls** (`middleware.ts`): `isSSGContext(c)` (env flag), `disableSSG()` (marks the response with the disable header and returns 404 during SSG), `onlySSG()` (404 outside SSG).

## Streaming (`helper/streaming`)

- `stream(c, cb, onError?)` creates a `TransformStream`, wraps it in `StreamingApi` (`utils/stream.ts`), runs `cb` asynchronously and returns `c.newResponse(readable)`. Errors: `undefined` rejection (client cancel) is ignored; `Error` + `onError` calls it; otherwise `console.error`. `stream.close()` always runs in `finally`. The context is parked in a `WeakMap` keyed by the readable so it is not collected while streaming (Bun quirk), and old Bun versions get an explicit `abort` listener (`isOldBunVersion`).
- `streamText` sets text headers on top of this; `streamSSE` (`sse.ts`) sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `Transfer-Encoding: chunked` and exposes `writeSSE({ data, event?, id?, retry? })`. `data` may be a promise/escaped string (resolved via `resolveCallback`), multi-line data is split into `data:` lines, and `event`/`id`/`retry` containing CR/LF throw (preventing SSE field injection). On error with `onError`, an `event: error` message is written.

## Cookies (`helper/cookie`)

`getCookie`, `setCookie`, `deleteCookie`, and signed variants (`getSignedCookie`, `setSignedCookie`, `generateSignedCookie`) over `utils/cookie.ts`. They support `__Secure-`/`__Host-` prefixes via `prefix` options, which the `jwt` and `csrf` middleware reuse (see [Built-in Middleware](../middleware/middleware.md)). Signed cookies use HMAC via `crypto.subtle`.

## Factory (`helper/factory`)

`createFactory<E>()` returns a `Factory` with `createApp()`, `createMiddleware()` and `createHandlers(...)` (typed overloads up to 10 handlers that thread `Env` and `Input` types forward). Standalone `createMiddleware` gives typed `MiddlewareHandler`s. This is the supported way to define handlers in separate files without losing the type information the [RPC client](../core/validation-and-client.md) depends on.

## Testing (`helper/testing`)

`testClient(app, env?, executionCtx?, options?)` is `hc` with a custom `fetch` that calls `app.request(input, init, env, executionCtx)` — a typed client that needs no network or server.

## WebSocket (`helper/websocket`)

Runtime-neutral contracts: `WSEvents` (`onOpen/onMessage/onClose/onError`), `WSContext` (wraps a runtime socket via `WSContextInit`), `UpgradeWebSocket` (middleware form `(createEvents) => MiddlewareHandler` or direct `(c, events)` form), and `defineWebSocketHelper(handler)` which adapters use to build `upgradeWebSocket` for Cloudflare Workers, Deno, Bun (see adapters page). The middleware form's type carries `outputFormat: 'ws'`, which lets `hc(...).$ws()` infer it.

## Proxy (`helper/proxy`)

`proxy(url | Request, init)` forwards a request with `fetch` (or `init.customFetch`). It strips hop-by-hop headers, and with `strictConnectionProcessing` also removes headers named in `Connection`, validating names against the RFC 9110 token pattern (invalid → `HTTPException(400)`). Body streams with `duplex: 'half'`.

## Introspection

- `helper/route`: `matchedRoutes(c)`, `routePath(c, index?)`, `baseRoutePath(c, index?)`, `basePath(c, index?)` over `c.req`'s match result.
- `helper/dev`: `inspectRoutes(app)`, `showRoutes(app, opts)` (pretty console table, marks middleware), `getRouterName(app)`.
- `helper/adapter`: `getRuntimeKey()` (checks `navigator.userAgent` for Deno/Bun/Cloudflare-Workers/Node.js, then `EdgeRuntime`, `fastly`, `process.release`) and `env(c)` which returns `process.env`, `Deno.env.toObject()`, or `c.env` depending on runtime.

## Small utilities
- `helper/html`: the `html` tagged template (escapes interpolations, supports async/callback content) and `raw`.
- `helper/accepts`: parses `Accept*` headers (`utils/accept.ts`) and picks the best supported value with a customizable match function.
- `helper/conninfo`: `GetConnInfo` / `ConnInfo` types implemented per adapter (remote address info).
- `helper/css`: server-side CSS-in-JS (`css`, `cx`, `keyframes`, `Style`) that integrates with JSX; see [Hono JSX](../jsx/jsx-system.md).
