---
title: "Runtime Adapters"
---
## Overview

A Hono app needs nothing from its runtime beyond a call to `app.fetch(request, env, executionCtx)` ([[Request Lifecycle and Middleware Composition]]). Adapters exist for the parts that differ: an entry point when the platform does not call `fetch` with a `Request`, a `getConnInfo` that finds the client address in the platform's own data, and runtime-specific static files, WebSockets and static site generation. Each adapter is a subpath such as `hono/vercel` or `hono/bun`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [package.json:344-388](repo://package.json#L344-L388)

This page lists entry points and connection info. AWS is covered in [[AWS Lambda and Lambda@Edge]], static files in [[Serving Static Files]], WebSockets in [[WebSockets]] and file generation in [[Static Site Generation]].

Sources: [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8)

## Entry points

### By platform

| Adapter | Export | What it passes to `app.fetch` |
| --- | --- | --- |
| `hono/vercel` | `handle(app)` | the `Request` only |
| `hono/netlify` | `handle(app)` | the `Request` and `{ context }` as bindings |
| `hono/service-worker` | `handle(app, { fetch })`, `fire(app, options)` | the event's request, empty bindings, the `FetchEvent` as execution context |
| `hono/cloudflare-pages` | `handle(app)`, `handleMiddleware(mw)` | the Pages request, `{ ...env, eventContext }`, and `waitUntil`/`passThroughOnException` |
| `hono/cloudflare-workers`, `hono/deno`, `hono/bun` | none | the runtime calls `app.fetch` itself |

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/service-worker/handler.ts:1-37](repo://src/adapter/service-worker/handler.ts#L1-L37), [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46)

### Service workers

`handle(app, opts)` returns a `fetch` event listener that calls `evt.respondWith` with the app's response. If the app answers `404` and `opts.fetch` is set (by default the global `fetch` bound to `globalThis`), the request is passed to that `fetch` instead, so any request the app answers with `404` falls through to the network. `fire(app, options)` registers that listener with `addEventListener('fetch', ...)`; it replaces the deprecated `app.fire()`. Because the `FetchEvent` is the execution context, `c.event` works there ([[Context]]).

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:10-36](repo://src/adapter/service-worker/index.ts#L10-L36), [src/context.ts:377-383](repo://src/context.ts#L377-L383)

### Cloudflare Pages

`handle(app)` produces a Pages Function. The bindings spread the Pages `env` and add `eventContext`, the full Pages context with `params`, `data` and `next`, so handlers reach it as `c.env.eventContext`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

`handleMiddleware(middleware)` runs one Hono middleware as Pages middleware, without an app. It builds a `Context` itself, and the middleware's `next()` calls the Pages `next()` and stores the result in `c.res`. Errors thrown by `next()` or the middleware are recorded on `c.error`. A response returned by the middleware wins; otherwise an `HTTPException` becomes its response, any other error is re-thrown, and without an error `c.res` is returned.

Sources: [src/adapter/cloudflare-pages/handler.ts:48-102](repo://src/adapter/cloudflare-pages/handler.ts#L48-L102)

## Connection info

### The ConnInfo type

`getConnInfo(c)` returns `{ remote: { address, addressType, port, transport } }`, where every field may be missing and `addressType` is `IPv4`, `IPv6` or `undefined`. The type lives in `hono/conninfo`, and the `ipRestriction` middleware accepts any adapter's function ([[Security Middleware]]).

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45), [src/helper/conninfo/index.ts:1-6](repo://src/helper/conninfo/index.ts#L1-L6), [src/middleware/ip-restriction/index.ts:23-23](repo://src/middleware/ip-restriction/index.ts#L23-L23)

### Where each adapter looks

| Adapter | Source of the address |
| --- | --- |
| Cloudflare Workers, Cloudflare Pages | `cf-connecting-ip` header |
| Vercel | `x-real-ip` header |
| Netlify | `c.env.context.ip` |
| Deno | `c.env.remoteAddr` (hostname, port, transport) |
| Bun | `server.requestIP(c.req.raw)` (address, family, port) |
| AWS Lambda, Lambda@Edge | the event's request context ([[AWS Lambda and Lambda@Edge]]) |

Sources: [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26), [src/adapter/vercel/conninfo.ts:1-8](repo://src/adapter/vercel/conninfo.ts#L1-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43)

The Bun version obtains the server with `getBunServer(c)`, which uses `c.env.server` when present and otherwise `c.env` itself. It throws a `TypeError` when no server or no `requestIP` method is available, and returns an empty `remote` when Bun reports no address, which the code comment says happens for closed requests and Unix sockets.

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/bun/server.ts:7-14](repo://src/adapter/bun/server.ts#L7-L14)

## Environment and runtime detection

### getRuntimeKey

`getRuntimeKey()` from `hono/adapter` identifies the runtime as `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` with known prefixes (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then checks for the `EdgeRuntime` global, the `fastly` global, and finally `process.release.name === 'node'` for Node versions without `navigator.userAgent`.

Sources: [src/helper/adapter/index.ts:8-90](repo://src/helper/adapter/index.ts#L8-L90)

### env

`env(c, runtime?)` returns environment variables in one shape on every runtime: `process.env` on Node, Bun and Edge Runtime; `Deno.env.toObject()` on Deno; `c.env` (the Workers bindings) on `workerd`; and an empty object on Fastly and unknown runtimes. Its type parameter describes the variables.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)
