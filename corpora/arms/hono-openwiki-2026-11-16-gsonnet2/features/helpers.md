---
type: feature-overview
title: "Helpers: Streaming, SSG, WebSocket, Cookie, Factory and More"
description: Overview of the src/helper modules, including streaming and SSE, static site generation (toSSG with hooks and plugins), the portable WebSocket abstraction, cookies, createFactory, route introspection, proxy, runtime detection and the testClient.
tags: [helpers, streaming, ssg, websocket, cookie, factory, proxy]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
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
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Helpers

`src/helper/*` holds opt-in utilities, each shipped as its own subpath export (for example `hono/streaming`, `hono/ssg`, `hono/ws`, `hono/cookie`, `hono/factory`). They depend only on the public `Context`/`Hono` API plus `src/utils`. Runtime-specific implementations (Bun/Deno/Cloudflare SSG file systems, WebSocket upgrade, conninfo) live in [Runtime Adapters](../platform/adapters.md) and plug into the interfaces defined here.

## Streaming (`helper/streaming`)

- `stream(c, cb, onError?)` creates a `TransformStream`, wraps it in `StreamingApi` (`src/utils/stream.ts`), runs `cb` in a detached async IIFE and immediately returns `c.newResponse(readable)`. The callback's errors go to `onError` (for `Error` instances) or `console.error`; the stream is always closed in `finally`. A rejection with `undefined` (cancelled pipe) is deliberately ignored. The context is parked in a `WeakMap` keyed by the readable so Bun does not garbage-collect it mid-stream, and for Bun versions before 1.1.27 an abort listener is added because `cancel()` was never delivered.
- `streamText` and `streamSSE` build on the same machinery. `SSEStreamingApi.writeSSE({data, event, id, retry})` splits `data` on newlines into multiple `data:` lines, **rejects `\r`/`\n` in `event`/`id`/`retry`** (protocol injection guard), resolves HTML-escaped promises via `resolveCallback`, and terminates each message with a blank line. On callback errors in `streamSSE`, after `onError` runs an `event: error` message with the error text is written.

## Static site generation (`helper/ssg`)

`toSSG(app, fs, options)` renders a Hono app to files:

1. **Route discovery.** `filterStaticGenerateRoutes(app)` selects registered routes whose method is `GET` or `ALL` and whose handler is not recognised as middleware. For each route a "get info" request is made with the env marker `SSG_CONTEXT` so that the `ssgParams` middleware can record parameter sets on the request; dynamic routes without `ssgParams` are skipped, static ones get `[{}]`.
2. **Rendering.** For each parameter set `app.request(url, init, {SSG_CONTEXT: true})` is executed through a concurrency pool (`createPool`, default `concurrency` of 2 for SSG). A response carrying the `X-Hono-Disable-SSG` header is dropped. The MIME type (from `Content-Type`) drives the file extension through `defaultExtensionMap`.
3. **Hooks.** `beforeRequestHook`, `afterResponseHook` and `afterGenerateHook` can each be a function or array; hooks from `options.plugins` (default `defaultPlugin()`) are appended. Request/response hooks may return `false` to skip a route and are chained by `combineBeforeRequestHooks`/`combineAfterResponseHooks`.
4. **Output.** `saveContentToFile` writes through a `FileSystemModule` abstraction (`writeFile`, `mkdir`), so Bun, Deno and Node supply implementations (`src/adapter/bun/ssg.ts`, `src/adapter/deno/ssg.ts`). Errors are collected into the result: `toSSG` never throws; it returns `{ success, files, error? }` and still runs `afterGenerateHook`.

## WebSocket abstraction (`helper/websocket`)

Defines runtime-neutral types: `WSEvents` (`onOpen/onMessage/onClose/onError`), `WSContext` (a wrapper over a per-runtime `send/close/readyState` init) and `defineWebSocketHelper`. The resulting `upgradeWebSocket` has two call forms: as **middleware** (`upgradeWebSocket((c) => events)`), which returns the upgrade response or falls through with `next()`; or **direct** (`upgradeWebSocket(c, events)`), which throws `Failed to upgrade WebSocket` if the runtime handler returns nothing. Each adapter (Cloudflare, Bun, Deno, ...) calls `defineWebSocketHelper` with its native upgrade logic. The RPC client's `$ws()` complements this on the consuming side ([RPC client](validation-and-rpc-client.md)).

## Cookies (`helper/cookie`)

`getCookie`, `getSignedCookie`, `setCookie`, `setSignedCookie`, `deleteCookie` operate on the request `Cookie` header and the response `Set-Cookie` header through the context (`c.header(..., {append: true})`), delegating parsing/serialisation to `src/utils/cookie.ts`. Signed variants use HMAC via Web Crypto and cookie serialisation throws when a `__Secure-` cookie lacks the `Secure` attribute (with similar `__Host-` rules). The JWT middleware reuses these for cookie-based tokens ([Middleware Catalog](middleware-catalog.md)).

## Factory (`helper/factory`)

`createFactory({ initApp?, defaultAppOptions? })` returns a `Factory` with `createApp()` (constructs a `Hono` with the default options, then runs `initApp`), `createMiddleware(fn)` and `createHandlers(...)`. Its heavily overloaded `createHandlers` exists so that handlers/middleware declared in separate files keep end-to-end typed `Input`/`Env` inference without being chained inline.

## Route, dev and introspection

- `helper/route` (`matchedRoutes`, `routePath`, `baseRoutePath`, `basePath`) reads `c.req.matchedRoutes` and the current `routeIndex` ([Context and HonoRequest](../architecture/context-and-request.md)).
- `helper/dev` offers `inspectRoutes`, `showRoutes` (prints `METHOD path` lines to the console, hiding middleware unless `verbose`) and `getRouterName`, which reports e.g. `SmartRouter + RegExpRouter` and is used by preset tests.

## Other helpers

- `helper/adapter`: `env(c, runtime?)` returns environment variables portably (`process.env` on Node/Bun/edge-light, `Deno.env.toObject()` on Deno, `c.env` on workerd) and `getRuntimeKey()` detects the runtime from `navigator.userAgent`, `EdgeRuntime`, or `fastly` globals.
- `helper/proxy`: `proxy(url, init)` forwards a request with `fetch`, stripping RFC 2616 hop-by-hop headers and, with `strictConnectionProcessing`, also removing headers named in `Connection` (invalid tokens produce a 400 `HTTPException`).
- `helper/conninfo`: the `GetConnInfo` type and `ConnInfo` shape; each adapter implements `getConnInfo(c)`.
- `helper/accepts`, `helper/html` (the `html` tagged template and `raw`), and `helper/css` (CSS-in-JS used by [JSX](jsx.md)).
- `helper/testing`: `testClient(app, env?, executionCtx?, options?)` is `hc` with `fetch` replaced by `app.request`, giving a typed client that never touches the network.
