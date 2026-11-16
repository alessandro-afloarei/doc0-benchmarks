---
title: "Cloudflare, Deno, Bun, Vercel, Netlify and Service Worker Adapters"
---
## Overview

A Hono app is a `fetch(request, env, executionCtx)` function, and most JavaScript runtimes already call a function of that shape. On those runtimes the app needs no adapter at all; the `hono/<runtime>` modules only add what the core cannot do portably: reading files, WebSockets, client addresses, static generation, and the occasional entry-point wrapper for platforms whose handler signature differs. AWS Lambda, whose events are not `Request` objects, is covered separately in [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11)

## How env and executionCtx reach the app

| Runtime | Entry | `c.env` | `c.executionCtx` |
| --- | --- | --- | --- |
| Cloudflare Workers | `export default app` | The Worker's bindings | The Worker's `ExecutionContext` |
| Cloudflare Pages Functions | `export const onRequest = handle(app)` | Bindings plus `eventContext` | `waitUntil`, `passThroughOnException` from the Pages context |
| Bun | `export default app` or `{ fetch: app.fetch, websocket }` | The Bun `Server` | none |
| Deno | `Deno.serve(app.fetch)` | The handler info (`remoteAddr`, ...) | none |
| Vercel | `export const GET = handle(app)` | none | none |
| Netlify | `export default handle(app)` | `{ context }` (Netlify's context) | none |
| Service Worker | `fire(app)` or `addEventListener('fetch', handle(app))` | `{}` | The `FetchEvent` |

Sources: [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37)

Handlers read these through [[Context and Responses]]: `c.env` for bindings and `c.executionCtx.waitUntil()` for background work. Code that must also run where `executionCtx` is missing should guard the access, because the getter throws. `env(c)` from `hono/adapter` reads environment variables from wherever each runtime keeps them ([[Testing, Route and Dev Helpers]]).

Sources: [src/context.ts:391-401](repo://src/context.ts#L391-L401), [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

## Cloudflare Workers

`hono/cloudflare-workers` exports `upgradeWebSocket` (built on `WebSocketPair`, see [[WebSockets]]), `getConnInfo` (from `cf-connecting-ip`, see [[Connection Info and IP Restriction]]) and a deprecated `serveStatic` for Workers Sites KV assets ([[Serving Static Files]]). The app itself is exported directly, since a module Worker's default export only needs a `fetch` method.

Sources: [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

## Cloudflare Pages

### handle

Pages Functions receive one `EventContext` object instead of three arguments. `handle(app)` returns a `PagesFunction` that calls `app.fetch(eventContext.request, { ...eventContext.env, eventContext }, { waitUntil, passThroughOnException, props: {} })`, so bindings appear on `c.env` as on Workers and the original context stays reachable as `c.env.eventContext` (for `params`, `data` or `next`).

Sources: [src/adapter/cloudflare-pages/handler.ts:12-46](repo://src/adapter/cloudflare-pages/handler.ts#L12-L46)

### handleMiddleware

`handleMiddleware(middleware)` runs a single Hono middleware as a Pages `_middleware` function. It builds a `Context` directly (no app, no routing), and the middleware's `next` calls `eventContext.next()` to run the rest of the Pages pipeline. Errors are collected on `c.error`. A returned response wins; otherwise an `HTTPException` becomes its own response, other errors are rethrown, and the result of `next()` is returned. This lets middleware such as `basicAuth` or `cors` protect static Pages assets.

Sources: [src/adapter/cloudflare-pages/handler.ts:49-102](repo://src/adapter/cloudflare-pages/handler.ts#L49-L102)

### serveStatic

`serveStatic()` from `hono/cloudflare-pages` forwards the request to the `ASSETS` binding and answers with `c.notFound()` when the asset is missing, so app routes can fall back to static files.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)

## Bun

Bun calls `fetch(request, server)`, so the `Server` object becomes `c.env`; `getBunServer(c)` returns it (also accepting `{ server }` for apps that pass their own env). The adapter builds on that for `getConnInfo` (`server.requestIP`), `upgradeWebSocket`/`websocket` (`server.upgrade`), `serveStatic` (`Bun.file`) and `toSSG` (`Bun.write`).

Sources: [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11)

## Deno

`Deno.serve(app.fetch)` passes the handler info as the second argument, which becomes `c.env`. `hono/deno` exports `serveStatic` (`Deno.open`), `upgradeWebSocket` (`Deno.upgradeWebSocket`), `getConnInfo` (`c.env.remoteAddr`) and `toSSG` with a `denoFileSystemModule` built on `Deno.writeFile` and `Deno.mkdir`. On Deno, Hono is published to JSR as `@hono/hono`, generated from `jsr.json` ([[Build, Package Exports and Testing]]).

Sources: [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/deno/ssg.ts:9-27](repo://src/adapter/deno/ssg.ts#L9-L27)

## Vercel and Netlify

`handle(app)` from `hono/vercel` returns `(req) => app.fetch(req)` for Vercel's route handlers and Edge Functions; `getConnInfo` reads `x-real-ip`. `handle(app)` from `hono/netlify` returns `(req, context) => app.fetch(req, { context })`, so Netlify's context (geo data, `ip`, `requestId`) is available as `c.env.context`.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:1-57](repo://src/adapter/netlify/conninfo.ts#L1-L57)

## Service Workers

`handle(app, { fetch })` from `hono/service-worker` returns a `fetch` event listener that calls `evt.respondWith(app.fetch(evt.request, {}, evt))`. When the app answers `404` and a `fetch` option is set (by default `globalThis.fetch` bound to `globalThis`), the request is passed through to the network, so a Service Worker built with Hono only intercepts the routes it defines. Passing `fetch: undefined` disables the fallback. `fire(app, options)` registers that listener with `addEventListener`, replacing the deprecated `app.fire()` ([[Hono App and Route Registration]]).

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

Because the `FetchEvent` is passed as the execution context, `c.event` returns it and `c.executionCtx.waitUntil` works ([[Context and Responses]]).

Sources: [src/context.ts:377-389](repo://src/context.ts#L377-L389)

## Node.js and Fastly

Node.js's `http` module does not use `Request` and `Response`, so Node support lives in the separate `@hono/node-server` package, which converts between the two; the runtime tests use it. Fastly Compute calls a fetch-style handler and needs no adapter. Both are exercised by the runtime test suites described in [[Build, Package Exports and Testing]].

Sources: [runtime-tests/node/index.test.ts:1-40](repo://runtime-tests/node/index.test.ts#L1-L40), [package.json:668-670](repo://package.json#L668-L670)
