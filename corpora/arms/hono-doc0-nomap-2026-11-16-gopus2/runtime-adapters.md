---
title: "Runtime Adapters"
---
## Overview

A Hono app is a `fetch(request, env, executionCtx)` function, so any runtime whose entry point has that shape runs it with no adapter: Cloudflare Workers, Deno and Bun accept `export default app` or `app.fetch` directly. Adapters exist for the rest of the work: translating a platform's own handler signature into that call, and offering runtime-specific versions of features the Web Standards do not cover, namely static files, WebSockets, static site generation and the client's IP address. Each adapter is its own entry point, such as `hono/bun` or `hono/vercel`. AWS has its own page, [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:468-485](repo://src/hono-base.ts#L468-L485), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11)

## What each adapter provides

| Entry point | `handle` | `serveStatic` | `upgradeWebSocket` | `toSSG` | `getConnInfo` |
| --- | --- | --- | --- | --- | --- |
| `hono/cloudflare-workers` | not needed | KV assets (deprecated) | yes | no | `cf-connecting-ip` |
| `hono/cloudflare-pages` | Pages Functions | `ASSETS` binding | no | no | `cf-connecting-ip` |
| `hono/deno` | not needed | `Deno.open` | yes | yes | `remoteAddr` from env |
| `hono/bun` | not needed | `Bun.file` | yes, with `websocket` | yes | `server.requestIP` |
| `hono/netlify` | Netlify Functions | no | no | no | `context.ip` |
| `hono/vercel` | yes | no | no | no | `x-real-ip` |
| `hono/service-worker` | `FetchEvent` listener, plus `fire` | no | no | no | no |

Sources: [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8), [src/adapter/cloudflare-pages/index.ts:1-8](repo://src/adapter/cloudflare-pages/index.ts#L1-L8), [src/adapter/deno/index.ts:1-9](repo://src/adapter/deno/index.ts#L1-L9), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/netlify/index.ts:1-6](repo://src/adapter/netlify/index.ts#L1-L6), [src/adapter/vercel/index.ts:1-7](repo://src/adapter/vercel/index.ts#L1-L7), [src/adapter/service-worker/index.ts:1-36](repo://src/adapter/service-worker/index.ts#L1-L36)

The runtime-specific features have their own pages: [[Serving Static Files]], [[WebSockets]] and [[Static Site Generation]].

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/bun/websocket.ts:48-104](repo://src/adapter/bun/websocket.ts#L48-L104), [src/adapter/bun/ssg.ts:20-27](repo://src/adapter/bun/ssg.ts#L20-L27)

## Handler adapters

### Vercel and Netlify

The Vercel `handle(app)` returns `(req) => app.fetch(req)`. The Netlify `handle(app)` returns `(req, context) => app.fetch(req, { context })`, so Netlify's context object is available as `c.env.context`, which its `getConnInfo` reads.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:28-57](repo://src/adapter/netlify/conninfo.ts#L28-L57)

### Cloudflare Pages

`handle(app)` turns the app into a Pages Function. It calls `app.fetch` with the request, an env made of the Pages bindings plus `eventContext` (the whole Pages context, including `params`, `data` and `next`), and an execution context built from the event's `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

`handleMiddleware(middleware)` runs a single Hono middleware as a Pages `_middleware` function: it builds a `Context` directly, and the middleware's `next()` calls the Pages `eventContext.next()` and stores the result in `c.res`. Errors from either side are kept in `c.error`; an `HTTPException` becomes its response, and other errors are rethrown.

Sources: [src/adapter/cloudflare-pages/handler.ts:48-102](repo://src/adapter/cloudflare-pages/handler.ts#L48-L102)

The Pages `serveStatic()` fetches the request from the `ASSETS` binding and calls `c.notFound()` when the asset is missing.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)

### Service workers

`handle(app, { fetch })` returns a `FetchEvent` listener that calls `event.respondWith` with `app.fetch(event.request, {}, event)`, passing the event as execution context so `c.event` works. When the app answers 404 and a `fetch` option is set (by default the global `fetch`, bound to `globalThis`), the request is passed through to the network instead. `fire(app, options)` registers that listener with `addEventListener('fetch', ...)`; it replaces the deprecated `app.fire()` described in [[Request Lifecycle and Middleware]].

Sources: [src/adapter/service-worker/handler.ts:1-37](repo://src/adapter/service-worker/handler.ts#L1-L37), [src/adapter/service-worker/index.ts:1-36](repo://src/adapter/service-worker/index.ts#L1-L36), [src/context.ts:371-383](repo://src/context.ts#L371-L383)

## Connection information

### The ConnInfo type

`getConnInfo(c)` returns `{ remote: { address, addressType, port, transport } }`, all fields optional, in the shape `hono/conninfo` defines. Since the client address is not part of a standard `Request`, each runtime finds it differently. The [[Security Middleware]] page shows `ipRestriction` taking a `getConnInfo` function as its source of addresses.

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45), [src/middleware/ip-restriction/index.ts:218-245](repo://src/middleware/ip-restriction/index.ts#L218-L245)

### Per runtime

| Adapter | Source of the address | Other fields |
| --- | --- | --- |
| Cloudflare Workers, Pages | `cf-connecting-ip` header | none |
| Vercel | `x-real-ip` header | none |
| Netlify | `c.env.context.ip` | none |
| Deno | `c.env.remoteAddr.hostname` | `port`, `transport` |
| Bun | `server.requestIP(c.req.raw)`, with the server from `c.env` | `addressType`, `port` |

Sources: [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-pages/conninfo.ts:1-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L1-L26), [src/adapter/vercel/conninfo.ts:1-8](repo://src/adapter/vercel/conninfo.ts#L1-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57), [src/adapter/deno/conninfo.ts:1-17](repo://src/adapter/deno/conninfo.ts#L1-L17), [src/adapter/bun/conninfo.ts:1-43](repo://src/adapter/bun/conninfo.ts#L1-L43)

Bun's version throws when `c.env` holds no server (the app must receive Bun's second `fetch` argument) or when `requestIP` is missing, and returns an empty `remote` for closed requests or Unix sockets, where Bun returns `null`.

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/bun/server.ts:1-14](repo://src/adapter/bun/server.ts#L1-L14)

## Adapter helper

### getRuntimeKey

`hono/adapter` lets code that runs everywhere ask where it is. `getRuntimeKey()` checks, in order: `navigator.userAgent` starting with `Deno`, `Bun`, `Cloudflare-Workers` or `Node.js`; a global `EdgeRuntime` string (`edge-light`); a global `fastly`; and `process.release.name === 'node'` for Node versions without `navigator.userAgent`. Anything else is `other`.

Sources: [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

### env

`env(c, runtime?)` returns environment variables the way the current runtime exposes them: `process.env` on Node, Bun and Edge Runtime, `Deno.env.toObject()` on Deno, `c.env` (the bindings) on Workers, and `{}` on Fastly and unknown runtimes. Its type parameter types the result, so `env<{ SECRET: string }>(c).SECRET` is a string.

Sources: [src/helper/adapter/index.ts:8-41](repo://src/helper/adapter/index.ts#L8-L41)

```ts
import { env, getRuntimeKey } from 'hono/adapter'

app.get('/env', (c) => {
  const { NAME } = env<{ NAME: string }>(c)
  return c.text(`${NAME} on ${getRuntimeKey()}`)
})
```

Sources: [src/helper/adapter/index.ts:10-90](repo://src/helper/adapter/index.ts#L10-L90)
