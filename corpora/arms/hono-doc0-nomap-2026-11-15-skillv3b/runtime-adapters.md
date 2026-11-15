---
title: "Runtime Adapters"
---
## Overview

Hono's core only knows `app.fetch(request, env, executionCtx)` (see [[Request Lifecycle and Middleware Composition]]). Runtimes whose native entry point has that shape run an app with no adapter at all; the others need a `handle(app)` function that converts their event into a `Request` and the bindings and context the app expects. Each runtime module (`hono/cloudflare-workers`, `hono/bun`, `hono/deno`, and so on) also exports the platform-specific pieces: `serveStatic`, `upgradeWebSocket`, `toSSG` and `getConnInfo`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

| Runtime | Entry | `c.env` holds | Module exports |
| --- | --- | --- | --- |
| Cloudflare Workers | `export default app` | Bindings (KV, D1, secrets) | `serveStatic`, `upgradeWebSocket`, `getConnInfo` |
| Cloudflare Pages Functions | `export const onRequest = handle(app)` | Bindings plus `eventContext` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` |
| Bun | `export default { fetch: app.fetch, websocket }` | The Bun `Server` | `serveStatic`, `upgradeWebSocket`, `websocket`, `toSSG`, `getConnInfo`, `getBunServer` |
| Deno | `Deno.serve(app.fetch)` | Deno's `ServeHandlerInfo` (`remoteAddr`) | `serveStatic`, `upgradeWebSocket`, `toSSG`, `getConnInfo` |
| Vercel | `export const GET = handle(app)` | nothing | `handle`, `getConnInfo` |
| Netlify | `export default handle(app)` | `{ context }`, Netlify's context | `handle`, `getConnInfo` |
| Service Worker | `fire(app)` or `addEventListener('fetch', handle(app))` | nothing | `handle`, `fire` |
| AWS Lambda, Lambda@Edge | `export const handler = handle(app)` | The Lambda event and context | see [[AWS Lambda and Lambda@Edge]] |
| Node.js | the separate `@hono/node-server` package | n/a | n/a |

Sources: [src/adapter/cloudflare-pages/index.ts:1-8](repo://src/adapter/cloudflare-pages/index.ts#L1-L8), [src/adapter/vercel/index.ts:1-7](repo://src/adapter/vercel/index.ts#L1-L7), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

## Runtimes without an adapter

Cloudflare Workers modules, Bun and Deno call an exported `fetch(request, env, ctx)` or `fetch(request, info)` directly, so `app.fetch` is passed through and the second argument becomes `c.env`. On Workers that is the bindings object and the third argument the `ExecutionContext` with `waitUntil`. On Bun it is the `Server`, which `getBunServer(c)` reads (from `c.env.server` when the app is wrapped, or `c.env` itself) for WebSocket upgrades and client IPs. On Deno it is the handler info whose `remoteAddr` gives the client address.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17)

## Adapters with handle()

### Vercel and Netlify

Vercel's `handle(app)` returns `(req) => app.fetch(req)`, the shape Vercel expects for exported `GET`, `POST` and other handlers. Netlify's passes Netlify's context object as `c.env.context`, which holds the client IP, geolocation and request ID.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:8-32](repo://src/adapter/netlify/conninfo.ts#L8-L32)

### Cloudflare Pages

Pages Functions receive an `EventContext`. `handle(app)` calls `app.fetch` with the request, the bindings plus the whole `eventContext` (for `params`, `data` and `next`), and an execution context built from its `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

`handleMiddleware(mw)` runs a single Hono middleware as a Pages `_middleware` function: it builds a `Context` directly, and the middleware's `next()` calls the Pages `next()` and stores its response in `c.res`. An `HTTPException` thrown by the middleware is turned into its response, so Hono's auth middleware can protect static Pages assets. The Pages `serveStatic()` forwards to `env.ASSETS` and turns its 404 into `c.notFound()`.

Sources: [src/adapter/cloudflare-pages/handler.ts:48-123](repo://src/adapter/cloudflare-pages/handler.ts#L48-L123)

### Service Worker

`handle(app, { fetch })` returns a `fetch` event listener that calls `event.respondWith(app.fetch(event.request, {}, event))`, with the event as execution context, so `c.event` works (see [[Context and Response Building]]). When the app answers 404, the request is passed on to the network with `opts.fetch`, so a Service Worker app can intercept some routes and let the rest through; pass `fetch: undefined` to keep the 404. `fire(app)` registers the listener globally and replaces the deprecated `app.fire()`.

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36), [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542)

## Connection info

`hono/conninfo` defines a common shape for client connection data, and each adapter exports a `getConnInfo(c)` that fills it:

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

```ts
interface ConnInfo {
  remote: {
    address?: string
    addressType?: 'IPv4' | 'IPv6' | undefined
    port?: number
    transport?: 'tcp' | 'udp'
  }
}
```

Sources: [src/helper/conninfo/types.ts:5-40](repo://src/helper/conninfo/types.ts#L5-L40)

| Adapter | Source of `remote.address` |
| --- | --- |
| Bun | `server.requestIP(req)`, with family and port; empty for closed requests or Unix sockets |
| Deno | `c.env.remoteAddr.hostname`, with port and transport |
| Cloudflare Workers and Pages | The `cf-connecting-ip` header |
| Vercel | The `x-real-ip` header |
| Netlify | `c.env.context.ip` |
| AWS Lambda | The source IP from the event's request context |

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26), [src/adapter/vercel/conninfo.ts:1-8](repo://src/adapter/vercel/conninfo.ts#L1-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57), [src/adapter/aws-lambda/conninfo.ts:1-73](repo://src/adapter/aws-lambda/conninfo.ts#L1-L73)

Header-based sources are only trustworthy because the platform's edge sets them; behind another proxy they can be spoofed. `ipRestriction` takes a `getConnInfo` function directly, so swapping runtimes means changing one import (see [[Security Middleware]]).

Sources: [src/middleware/ip-restriction/index.ts:218-247](repo://src/middleware/ip-restriction/index.ts#L218-L247)

## Platform features by module

The remaining exports are covered on their own pages: `serveStatic` on [[Serving Static Files]], `upgradeWebSocket` and Bun's `websocket` on [[WebSockets]], and `toSSG` for Bun and Deno on [[Static Site Generation]]. For code that must branch on the runtime or read environment variables portably, `getRuntimeKey()` and `env(c)` from `hono/adapter` are described on [[Helpers Catalogue]].

Sources: [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/helper/adapter/index.ts:10-90](repo://src/helper/adapter/index.ts#L10-L90)
