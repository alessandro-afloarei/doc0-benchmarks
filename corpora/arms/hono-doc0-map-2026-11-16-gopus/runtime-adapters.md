---
title: "Runtime Adapters"
---
## Overview

Because a Hono app is a `fetch(request, env, executionCtx)` function ([[Hono Application]]), many runtimes need no adapter for the request itself: Cloudflare Workers, Deno and Bun call a module's `fetch` with a `Request` directly. The adapters under `src/adapter` exist for two reasons. Some platforms call functions with a different signature, so `handle(app)` converts it. And every runtime has its own way to read files, upgrade WebSockets, find the client address or write files, so each adapter exports its versions of `serveStatic`, `upgradeWebSocket`, `getConnInfo` and `toSSG`. AWS Lambda and Lambda@Edge have their own page, [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9)

| Import | `handle` / entry | `serveStatic` | `upgradeWebSocket` | `getConnInfo` | `toSSG` |
| --- | --- | --- | --- | --- | --- |
| `hono/cloudflare-workers` | none, `export default app` | yes (deprecated) | yes | yes | |
| `hono/cloudflare-pages` | `handle`, `handleMiddleware` | yes (`ASSETS`) | | yes | |
| `hono/bun` | none, `export default app` | yes | yes, plus `websocket` | yes | yes |
| `hono/deno` | none, pass `app.fetch` | yes | yes | yes | yes |
| `hono/netlify` | `handle` | | | yes | |
| `hono/vercel` | `handle` | | | yes | |
| `hono/service-worker` | `handle`, `fire` | | | | |

Sources: [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/cloudflare-pages/index.ts:1-8](repo://src/adapter/cloudflare-pages/index.ts#L1-L8), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/vercel/index.ts:1-7](repo://src/adapter/vercel/index.ts#L1-L7), [src/adapter/service-worker/index.ts:1-36](repo://src/adapter/service-worker/index.ts#L1-L36)

The shared helpers are described once: file serving on [[Serving Static Files]], WebSockets on [[WebSockets]], client addresses on [[Runtime and Connection Info]] and static generation on [[Static Site Generation]].

Sources: [src/middleware/serve-static/index.ts:35-49](repo://src/middleware/serve-static/index.ts#L35-L49), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

## Cloudflare Workers

A Worker module exports the app as its default export; the runtime calls `app.fetch(request, env, ctx)`, so `c.env` holds the bindings (KV namespaces, secrets, D1 databases) and `c.executionCtx` the Workers execution context. `hono/cloudflare-workers` adds `serveStatic` for Workers Sites, which its comment marks deprecated in favour of Cloudflare Static Assets, `upgradeWebSocket` built on `WebSocketPair`, and `getConnInfo` reading `cf-connecting-ip`.

Sources: [src/context.ts:300-315](repo://src/context.ts#L300-L315), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/cloudflare-workers/serve-static.ts:12-20](repo://src/adapter/cloudflare-workers/serve-static.ts#L12-L20)

## Cloudflare Pages

Pages Functions are called with one `EventContext` object instead of `(request, env, ctx)`. `handle(app)` returns such a function: it calls `app.fetch` with the request, the bindings spread together with the whole `eventContext`, and an execution context built from the event's `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

```ts
// functions/api/[[route]].ts
import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'

const app = new Hono().basePath('/api')
app.get('/hello', (c) => c.json({ message: 'Hello' }))

export const onRequest = handle(app)
```

Sources: [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46)

`handleMiddleware(middleware)` turns one Hono middleware into a Pages middleware. It creates a `Context` by hand and runs the middleware with a `next` that calls the Pages `eventContext.next()` and stores the result as `c.res`. Errors are kept in `c.error`; afterwards, a response returned by the middleware wins, an `HTTPException` is turned into its response, any other error is re-thrown, and otherwise the next function's response is returned.

Sources: [src/adapter/cloudflare-pages/handler.ts:48-102](repo://src/adapter/cloudflare-pages/handler.ts#L48-L102)

`serveStatic()` for Pages advanced mode fetches the request from the `ASSETS` binding and calls `c.notFound()` when it answers 404, so later routes can handle the path.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)

## Bun and Deno

Both runtimes serve a `fetch` function directly, so their adapters export only the helpers. The Bun adapter's helpers find the Bun server through `getBunServer(c)`, which reads `c.env.server` or `c.env` itself, the second argument Bun passes to `fetch`. Bun's WebSocket support also needs the exported `websocket` handler on the server.

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14), [src/adapter/bun/websocket.ts:76-104](repo://src/adapter/bun/websocket.ts#L76-L104)

The Deno adapter's `getConnInfo` reads `c.env.remoteAddr`, so the second argument of `fetch` must be Deno's connection info, and its `serveStatic` and `toSSG` use `Deno.open`, `Deno.writeFile` and `Deno.mkdir`.

Sources: [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17)

## Netlify and Vercel

`handle(app)` from `hono/netlify` returns `(req, context) => app.fetch(req, { context })`, so the Netlify context, with the client `ip` and geolocation, is available as `c.env.context`. `handle(app)` from `hono/vercel` returns `(req) => app.fetch(req)`, passing no bindings; its `getConnInfo` reads the `x-real-ip` header instead.

Sources: [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:8-57](repo://src/adapter/netlify/conninfo.ts#L8-L57), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/vercel/conninfo.ts:1-8](repo://src/adapter/vercel/conninfo.ts#L1-L8)

## Service Worker

`handle(app, opts?)` from `hono/service-worker` returns a `fetch` event listener. It calls `evt.respondWith` with `app.fetch(evt.request, {}, evt)`, so the event itself is the execution context and `c.event` works ([[Context and Responses]]).

Sources: [src/adapter/service-worker/handler.ts:1-36](repo://src/adapter/service-worker/handler.ts#L1-L36), [src/context.ts:377-383](repo://src/context.ts#L377-L383)

When the app answers 404 and `opts.fetch` is set, the request is passed to that `fetch` instead, which makes the app a layer in front of the network. `handle` sets `opts.fetch` to `globalThis.fetch` bound to `globalThis` by default, as a comment notes is required in a Service Worker; `fire(app, options?)` registers `handle(app, options)` with `addEventListener('fetch', …)`. Its doc comment says `fetch` defaults to undefined, but when `options` is omitted, `handle`'s default parameter applies and the network fallback is active.

Sources: [src/adapter/service-worker/handler.ts:18-36](repo://src/adapter/service-worker/handler.ts#L18-L36), [src/adapter/service-worker/index.ts:10-34](repo://src/adapter/service-worker/index.ts#L10-L34)

The deprecated `app.fire()` method does the same without the fallback, and points to `fire` from `hono/service-worker` ([[Hono Application]]).

Sources: [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542)
