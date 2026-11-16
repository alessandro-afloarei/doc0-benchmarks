---
title: "Runtime Adapters"
---
## Overview

Every platform hands requests to code differently, but most of them now speak the Fetch API. An adapter's job is therefore small: get a `Request` to `app.fetch(request, env, executionCtx)` and return the `Response`. The second and third arguments become `c.env` and `c.executionCtx` on the [[Context and Responses]], which is how platform bindings, the Bun server object or Netlify's context reach handlers. Each adapter lives under `src/adapter/<platform>` and is imported as `hono/<platform>`, together with that platform's versions of helpers such as `serveStatic`, `getConnInfo`, `upgradeWebSocket` and `toSSG`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9)

AWS has its own event formats and is covered on [[AWS Lambda and Lambda@Edge]]. Node.js uses the separate `@hono/node-server` package, which the Node runtime tests in this repository install.

Sources: [runtime-tests/node/index.test.ts:1-15](repo://runtime-tests/node/index.test.ts#L1-L15)

## Platforms and entry points

| Platform | Entry | `c.env` | `c.executionCtx` |
| --- | --- | --- | --- |
| Cloudflare Workers (modules) | `export default app` | Bindings (KV, D1, secrets, ...) | Worker `ExecutionContext` |
| Bun | `export default app` or `Bun.serve({ fetch: app.fetch })` | The Bun server | none |
| Deno | `Deno.serve(app.fetch)` | Handler info (`remoteAddr`) | none |
| Fastly Compute | `fire(app)` from `hono/service-worker` (a `fetch` event listener) | `{}` | `FetchEvent` |
| Service Worker | `fire(app)` from `hono/service-worker` | `{}` | `FetchEvent` |
| Cloudflare Pages Functions | `onRequest = handle(app)` from `hono/cloudflare-pages` | Bindings plus `eventContext` | Built from the event context |
| Vercel | `handle(app)` from `hono/vercel` | none | none |
| Netlify | `handle(app)` from `hono/netlify` | `{ context }` | none |

Sources: [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37), [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

Runtimes that accept an object with a `fetch` method need no adapter, because the app is such an object. The Bun helpers depend on the second argument: `getBunServer(c)` returns `c.env.server` if present, or `c.env` itself, which is what `Bun.serve` passes.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/bun/server.ts:5-14](repo://src/adapter/bun/server.ts#L5-L14)

## Service Worker

`handle(app, { fetch })` returns a `fetch` event listener that calls `evt.respondWith` with `app.fetch(evt.request, {}, evt)`, passing the event as the execution context so `c.event` works. If the app answers 404 and a `fetch` option is set (by default the global `fetch`, bound to `globalThis`), the request is forwarded to the network instead. A worker can therefore handle some routes and let the rest pass through. `fire(app, options)` registers that listener with `addEventListener('fetch', ...)`.

Sources: [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

The older `app.fire()` method on the app does the same without the 404 fallback and is deprecated (see [[Hono Application]]).

Sources: [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542)

## Cloudflare Pages

### Functions

`handle(app)` returns a `PagesFunction`. It spreads the Pages bindings into `c.env` alongside `eventContext` (with `params`, `data`, `next`, `functionPath`) and passes an execution context built from the event's `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

`serveStatic()` from `hono/cloudflare-pages` asks the `ASSETS` binding for the request and calls `c.notFound()` on 404, so static assets and app routes share one function.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)

### Pages middleware

`handleMiddleware(middleware)` runs a single Hono middleware as a Pages `_middleware` function, with no app or router. It builds a `Context` by hand, and the middleware's `next()` calls the Pages `next()` and stores its response in `c.res`.

Sources: [src/adapter/cloudflare-pages/handler.ts:49-102](repo://src/adapter/cloudflare-pages/handler.ts#L49-L102)

There is no error handler in this path. A returned response wins. Otherwise an `HTTPException` becomes its own response, any other error is rethrown to Pages, and with no error `c.res` is returned. Middleware such as `basicAuth` therefore works unchanged in front of static Pages content.

Sources: [src/adapter/cloudflare-pages/handler.ts:66-101](repo://src/adapter/cloudflare-pages/handler.ts#L66-L101)

## Vercel and Netlify

Both are one-liners. Vercel's `handle(app)` returns `(req) => app.fetch(req)` for Edge and Node functions that use the Fetch API. Netlify's passes its `context` argument as `{ context }`, so `c.env.context` carries geolocation, the client IP (used by its `getConnInfo`) and the request ID.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:1-10](repo://src/adapter/netlify/handler.ts#L1-L10), [src/adapter/netlify/conninfo.ts:8-57](repo://src/adapter/netlify/conninfo.ts#L8-L57)

## Runtime-neutral helpers

### getRuntimeKey

`getRuntimeKey()` from `hono/adapter` names the current runtime: `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` (Vercel Edge) or `other`. It first compares `navigator.userAgent` against known prefixes (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`). It then checks the `EdgeRuntime` global and the `fastly` global, and finally `process.release.name` for Node.js versions older than 21.1 that lack `navigator.userAgent`.

Sources: [src/helper/adapter/index.ts:8-8](repo://src/helper/adapter/index.ts#L8-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

Library code uses it to pick an implementation; the JWT key importer, for example, checks for `node` to find `CryptoKey` (see [[JWT and JWK]]).

Sources: [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

### env

`env<T>(c, runtime?)` reads configuration in a runtime-neutral way: `process.env` on Node.js, Bun and Vercel Edge, `Deno.env.toObject()` on Deno, the bindings in `c.env` on Workers, and `{}` on Fastly and unknown runtimes. Code written against `env(c).API_KEY` therefore runs unchanged across platforms.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

```ts
import { env, getRuntimeKey } from 'hono/adapter'

app.get('/info', (c) => {
  const { NAME } = env<{ NAME: string }>(c)
  return c.text(`${NAME} on ${getRuntimeKey()}`)
})
```

Sources: [src/helper/adapter/index.ts:10-18](repo://src/helper/adapter/index.ts#L10-L18)

## Testing per runtime

The `runtime-tests` folder holds a small suite per platform (`bun`, `deno`, `deno-jsx`, `fastly`, `lambda`, `lambda-edge`, `node`, `workerd`) that runs the same kinds of apps through the real or simulated runtime and checks `getRuntimeKey()`. The Fastly suite simulates the platform by stubbing the `fastly` global and removing `navigator`. [[Building and Testing Hono]] explains how they are run.

Sources: [runtime-tests/fastly/index.test.ts:1-30](repo://runtime-tests/fastly/index.test.ts#L1-L30), [runtime-tests/node/index.test.ts:17-40](repo://runtime-tests/node/index.test.ts#L17-L40)
