---
title: "Runtime Adapters"
---
## Overview

A Hono app is a `fetch(request, env, executionCtx)` function, so on runtimes that call a default export's `fetch`, such as Cloudflare Workers, Deno and Bun, `export default app` is all the glue needed. The adapters in `src/adapter` fill the gaps around that contract: converting a platform's input into those three arguments, serving static files from the platform's storage, reading the client's address, upgrading WebSockets and writing files for static generation. Each adapter is a subpath export such as `hono/bun`. Two runtime-neutral helpers sit beside them: `hono/adapter` for environment variables and runtime detection, and `hono/conninfo` for the connection-info type every adapter's `getConnInfo` returns. AWS Lambda and Lambda@Edge have their own page, [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/helper/adapter/index.ts:8-41](repo://src/helper/adapter/index.ts#L8-L41), [src/helper/conninfo/types.ts:35-45](repo://src/helper/conninfo/types.ts#L35-L45)

| Import | `handle` | `serveStatic` | `getConnInfo` | `upgradeWebSocket` | `toSSG` |
| --- | --- | --- | --- | --- | --- |
| `hono/cloudflare-workers` | — | KV assets (deprecated) | `cf-connecting-ip` | yes | — |
| `hono/cloudflare-pages` | Pages Functions, plus `handleMiddleware` | `ASSETS` binding | `cf-connecting-ip` | — | — |
| `hono/deno` | — | `Deno.open` | `remoteAddr` | yes | yes |
| `hono/bun` | — | `Bun.file` | `server.requestIP` | yes, plus `websocket` | yes |
| `hono/vercel` | yes | — | `x-real-ip` | — | — |
| `hono/netlify` | yes | — | `context.ip` | — | — |
| `hono/service-worker` | yes, plus `fire` | — | — | — | — |

Sources: [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/cloudflare-pages/index.ts:6-8](repo://src/adapter/cloudflare-pages/index.ts#L6-L8), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/vercel/index.ts:6-7](repo://src/adapter/vercel/index.ts#L6-L7), [src/adapter/netlify/mod.ts:1-2](repo://src/adapter/netlify/mod.ts#L1-L2), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

WebSockets are on [[WebSocket Helper]] and `toSSG` on [[Static Site Generation]]; the rest is below.

Sources: [src/adapter/bun/ssg.ts:25-27](repo://src/adapter/bun/ssg.ts#L25-L27)

## Request handlers

### Vercel and Netlify

`handle(app)` from `hono/vercel` returns `(req) => app.fetch(req)`. `handle(app)` from `hono/netlify` returns `(req, context) => app.fetch(req, { context })`, so Netlify's context, with the client IP and geolocation, is available as `c.env.context`.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10), [src/adapter/netlify/conninfo.ts:8-32](repo://src/adapter/netlify/conninfo.ts#L8-L32)

### Cloudflare Pages

`handle(app)` returns a Pages Function. It passes the bindings spread together with `eventContext`, the whole Pages context, as `c.env`, and builds an execution context from the event's `waitUntil` and `passThroughOnException`.

Sources: [src/adapter/cloudflare-pages/handler.ts:6-46](repo://src/adapter/cloudflare-pages/handler.ts#L6-L46)

`handleMiddleware(middleware)` runs a single Hono middleware as Pages middleware, outside any app. It creates a `Context` itself, and the middleware's `next()` calls the Pages `next()` and stores the result as `c.res`. A returned response wins; an `HTTPException` becomes its response; any other error is re-thrown; otherwise `c.res` is returned.

Sources: [src/adapter/cloudflare-pages/handler.ts:48-102](repo://src/adapter/cloudflare-pages/handler.ts#L48-L102)

### Service Worker

`handle(app, { fetch })` returns a `fetch` event listener that responds with `app.fetch(event.request, {}, event)`. When the app answers 404, the request is sent to `opts.fetch` instead, by default the global `fetch` bound to `globalThis`, so a service worker built with Hono passes unknown requests through to the network. `fire(app, options)` registers that listener with `addEventListener('fetch', ...)`; it replaces the deprecated `app.fire()` on [[Request Lifecycle and Error Handling]].

Sources: [src/adapter/service-worker/handler.ts:10-37](repo://src/adapter/service-worker/handler.ts#L10-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

## Static files

Each `serveStatic` is the generic middleware from [[Response Middleware]] with a runtime-specific `getContent`, and where needed `join` and `isDir`:

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:8-42](repo://src/adapter/deno/serve-static.ts#L8-L42), [src/adapter/cloudflare-workers/serve-static.ts:21-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L21-L42), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

| Adapter | `getContent(path)` | Directory check |
| --- | --- | --- |
| Bun | `Bun.file(path)` if it exists | `stat` from `node:fs/promises` |
| Deno | `Deno.open(path).readable`; directories and missing files give `null`, other errors are logged | `Deno.lstatSync` |
| Cloudflare Workers | The KV value named in the asset manifest, as a stream | none |
| Cloudflare Pages | Not built on the generic middleware: forwards the request to `env.ASSETS.fetch` and turns its 404 into `c.notFound()` | — |

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:8-42](repo://src/adapter/deno/serve-static.ts#L8-L42), [src/adapter/cloudflare-workers/serve-static.ts:21-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L21-L42), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

The Workers version looks the path up in `options.manifest`, a JSON string or object, or the global `__STATIC_CONTENT_MANIFEST`, and reads from `options.namespace`, `c.env.__STATIC_CONTENT` or the global `__STATIC_CONTENT`. It is deprecated: its documentation recommends Cloudflare Static Assets, or Cloudflare Pages.

Sources: [src/adapter/cloudflare-workers/utils.ts:1-50](repo://src/adapter/cloudflare-workers/utils.ts#L1-L50), [src/adapter/cloudflare-workers/serve-static.ts:11-20](repo://src/adapter/cloudflare-workers/serve-static.ts#L11-L20)

## Connection info

`getConnInfo(c)` returns a `ConnInfo` whose `remote` may have `address`, `addressType` (`IPv4` or `IPv6`), `port` and `transport`. Each adapter fills what its platform exposes:

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57)

| Adapter | Source of `remote` |
| --- | --- |
| Bun | `server.requestIP(c.req.raw)`: address, family and port; `{}` for closed requests or Unix sockets |
| Deno | `c.env.remoteAddr`: hostname, port and transport |
| Cloudflare Workers and Pages | The `cf-connecting-ip` header |
| Vercel | The `x-real-ip` header |
| Netlify | `c.env.context.ip` |

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/cloudflare-workers/conninfo.ts:3-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L3-L7), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57)

The Bun and Deno versions read the server object or address from `c.env`, so they work only when the runtime's second `fetch` argument reaches the app; Bun's throws `env has to include the 2nd argument of fetch.` otherwise. The `ipRestriction` middleware on [[Security Middleware]] accepts any of these functions.

Sources: [src/adapter/bun/conninfo.ts:19-24](repo://src/adapter/bun/conninfo.ts#L19-L24), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/middleware/ip-restriction/index.ts:23-23](repo://src/middleware/ip-restriction/index.ts#L23-L23)

## hono/adapter

### getRuntimeKey

`getRuntimeKey()` returns `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` against `Deno`, `Bun`, `Cloudflare-Workers` and `Node.js`, then looks for the `EdgeRuntime` and `fastly` globals, then for `process.release.name === 'node'`, which the comment says covers Node versions before 21.1, where `navigator.userAgent` is missing.

Sources: [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

### env

`env(c, runtime?)` returns environment variables the same way on every runtime: `process.env` on Node, Bun and the Edge runtime, `Deno.env.toObject()` on Deno, `c.env` on Workers, and `{}` on Fastly and unknown runtimes. Code that reads configuration through it does not change between runtimes.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

```ts
import { env } from 'hono/adapter'

app.get('/', (c) => {
  const { API_KEY } = env<{ API_KEY: string }>(c)
  return c.text(API_KEY ? 'configured' : 'missing')
})
```

Sources: [src/helper/adapter/index.ts:10-18](repo://src/helper/adapter/index.ts#L10-L18)

The JWT code uses `getRuntimeKey` to pick the right `CryptoKey` class on Node, as [[JWT Utilities]] notes.

Sources: [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)
