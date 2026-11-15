---
title: "Runtime Adapters"
---
## Overview

A Hono app is a `fetch(request, env, executionCtx)` function, so on runtimes whose server entry is already a `fetch` handler (Cloudflare Workers, Bun, Deno) the app runs as is. Adapters in `src/adapter` fill the remaining gaps: they convert a platform's own entry signature into a `fetch` call, and they supply runtime-specific pieces such as serving static files, WebSocket upgrades, static site generation and the client's connection information. Each adapter is a subpath (`hono/cloudflare-workers`, `hono/bun`, ...). AWS is covered in [[AWS Lambda and Lambda@Edge]], static files in [[Serving Static Files]] and upgrades in [[WebSockets]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11)

| Runtime | Entry | Adapter exports | `env` inside handlers |
| --- | --- | --- | --- |
| Cloudflare Workers | `export default app` | `serveStatic` (deprecated), `upgradeWebSocket`, `getConnInfo` | Worker bindings |
| Cloudflare Pages | `export const onRequest = handle(app)` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` | Bindings plus `eventContext` |
| Bun | `export default app`, or `{ fetch: app.fetch, websocket }` | `serveStatic`, `toSSG`, `upgradeWebSocket`, `websocket`, `getConnInfo`, `getBunServer` | The Bun server |
| Deno | `Deno.serve(app.fetch)` | `serveStatic`, `toSSG`, `upgradeWebSocket`, `getConnInfo` | Deno's handler info (`remoteAddr`) |
| Vercel | `export const GET = handle(app)` | `handle`, `getConnInfo` | `{}` |
| Netlify | `export default handle(app)` | `handle`, `getConnInfo` | `{ context }` |
| Service Worker | `fire(app)` | `handle`, `fire` | `{}` |
| AWS Lambda, Lambda@Edge | `export const handler = handle(app)` | see [[AWS Lambda and Lambda@Edge]] | Lambda event, context |

Sources: [src/adapter/cloudflare-pages/index.ts:6-8](repo://src/adapter/cloudflare-pages/index.ts#L6-L8), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/vercel/index.ts:6-7](repo://src/adapter/vercel/index.ts#L6-L7), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

Node.js and Fastly Compute have no adapter in this repository: Node.js uses the separate `@hono/node-server` package, and Fastly runs the exported app directly; both are covered by the test projects described in [[Build, Test and Release]].

Sources: [package.json:18-19](repo://package.json#L18-L19), [package.json:668-672](repo://package.json#L668-L672)

## Cloudflare Workers

Workers call `export default { fetch }` with the request, the bindings and an `ExecutionContext`, which is exactly the shape of `app.fetch`, so bindings appear as `c.env` and `c.executionCtx.waitUntil` works without an adapter. The adapter adds `upgradeWebSocket`, `getConnInfo` (reading `cf-connecting-ip`), and a `serveStatic` over Workers Sites KV storage, deprecated in favour of Cloudflare Static Assets; [[Serving Static Files]] describes it.

Sources: [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-workers/serve-static.ts:21-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L21-L42)

## Cloudflare Pages

Pages Functions receive one `EventContext` object. `handle(app)` returns a `PagesFunction` that calls `app.fetch` with the context's request, an env made of the bindings plus `eventContext` (so `c.env.eventContext.params`, `data` and `next` stay reachable), and an execution context built from the context's `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:12-46](repo://src/adapter/cloudflare-pages/handler.ts#L12-L46)

`handleMiddleware(mw)` runs a single Hono middleware as a Pages `_middleware` function, so existing middleware such as `basicAuth` can guard static pages. It builds a `Context` directly (no app or router), and its `next` calls the Pages `next()` to fetch the downstream response and assigns it to `c.res`. A returned response wins; otherwise an `HTTPException` becomes its response, other errors are rethrown, and the downstream response is returned.

Sources: [src/adapter/cloudflare-pages/handler.ts:49-102](repo://src/adapter/cloudflare-pages/handler.ts#L49-L102)

```ts
// functions/_middleware.ts
import { handleMiddleware } from 'hono/cloudflare-pages'
import { basicAuth } from 'hono/basic-auth'

export const onRequest = handleMiddleware(basicAuth({ username: 'admin', password: 'secret' }))
```

Sources: [src/adapter/cloudflare-pages/handler.ts:49-59](repo://src/adapter/cloudflare-pages/handler.ts#L49-L59)

The Pages `serveStatic()` forwards the request to the `ASSETS` binding and turns its 404 into the app's not-found response. `getConnInfo` reads `cf-connecting-ip`.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26)

## Bun

`Bun.serve` accepts an object with `fetch` and passes the server as the second argument, so inside handlers `c.env` is the Bun server (or holds it as `server`). `getBunServer(c)` returns it, and both `getConnInfo` and `upgradeWebSocket` depend on it: `getConnInfo` calls `server.requestIP(c.req.raw)` and returns address, family and port, or an empty `remote` for closed requests and Unix sockets; it throws a `TypeError` when the server is missing.

Sources: [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43)

## Deno

`Deno.serve(app.fetch)` calls the handler with the request and an info object, so `c.env.remoteAddr` is available and `getConnInfo` reports its hostname, port and transport. The adapter also exports `serveStatic` over `Deno.open`, `toSSG` (see [[Static Site Generation]]) and `upgradeWebSocket`.

Sources: [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9)

## Vercel and Netlify

Vercel's `handle(app)` returns `(req) => app.fetch(req)`, used as the exported `GET`, `POST` and other method handlers; `getConnInfo` reads `x-real-ip`. Netlify's `handle(app)` returns `(req, context) => app.fetch(req, { context })`, so the Netlify context, with geolocation and the client IP, is `c.env.context`, and `getConnInfo` reads its `ip`.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:8-57](repo://src/adapter/netlify/conninfo.ts#L8-L57)

## Service workers

`handle(app, { fetch })` returns a `fetch` event listener that responds with `app.fetch(event.request, {}, event)`, so `c.event` gives the `FetchEvent`. When the app answers 404 the request falls through to the network with `fetch` (by default the global `fetch` bound to `globalThis`); pass `{ fetch: undefined }` to keep the 404. `fire(app, options)` registers that listener with `addEventListener('fetch', ...)` and replaces the deprecated `app.fire()`.

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36), [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542)

## Connection info across runtimes

Every adapter's `getConnInfo(c)` returns the same `ConnInfo` shape (see [[Helper Catalogue]]), so code that needs the client address, such as `ipRestriction` in [[Access Control Middleware]], takes the function as a parameter and stays runtime-neutral.

Sources: [src/helper/conninfo/types.ts:35-45](repo://src/helper/conninfo/types.ts#L35-L45)

| Adapter | Source of the address | Also provides |
| --- | --- | --- |
| Cloudflare Workers, Pages | `cf-connecting-ip` header | |
| Bun | `server.requestIP()` | `addressType`, `port` |
| Deno | `c.env.remoteAddr` | `port`, `transport` |
| Vercel | `x-real-ip` header | |
| Netlify | `c.env.context.ip` | |
| AWS Lambda, Lambda@Edge | Request context or CloudFront client IP | see [[AWS Lambda and Lambda@Edge]] |

Sources: [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7), [src/adapter/bun/conninfo.ts:28-42](repo://src/adapter/bun/conninfo.ts#L28-L42), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57)

> [!WARNING]
> The header-based adapters trust a header set by the platform's edge. Behind another proxy, or when the app is reachable without that edge, a client can send the header itself.

Sources: [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7)
