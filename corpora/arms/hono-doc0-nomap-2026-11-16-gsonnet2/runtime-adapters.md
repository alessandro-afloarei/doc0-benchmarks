---
title: "Runtime Adapters"
---
## Overview

The core never touches a runtime API: an app is just `app.fetch(request, env, executionCtx)` ([[Application and Request Lifecycle]]). Each directory under `src/adapter` is a thin layer that fits one platform to that call. It converts the platform's event into a `Request` when the platform does not already use one, passes whatever the platform gives as `env` and the execution context, and converts the `Response` back. Adapters also provide runtime-specific middleware (`serveStatic`), WebSocket upgrade and connection info, because those need platform objects.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8)

| Adapter | Exports | What it adapts |
| --- | --- | --- |
| `cloudflare-workers` | `serveStatic`, `upgradeWebSocket`, `getConnInfo` | Worker modules already call `fetch`; this adds KV static assets, `WebSocketPair` upgrade and `cf-connecting-ip` |
| `cloudflare-pages` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` | Pages Functions `EventContext` |
| `bun` | `serveStatic`, `upgradeWebSocket`, `websocket`, `createBunWebSocket`, `getConnInfo`, `getBunServer`, `toSSG` | `Bun.serve` |
| `deno` | `serveStatic`, `upgradeWebSocket`, `getConnInfo`, `toSSG` | `Deno.serve` |
| `aws-lambda` | `handle`, `streamHandle` | API Gateway v1/v2, ALB, VPC Lattice events |
| `lambda-edge` | `handle` | CloudFront Lambda@Edge events |
| `vercel` | `handle` | Vercel functions |
| `netlify` | `handle` | Netlify functions |
| `service-worker` | `handle`, `fire` | Service Worker `fetch` events |

Sources: [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/adapter/cloudflare-pages/index.ts:6-8](repo://src/adapter/cloudflare-pages/index.ts#L6-L8), [src/adapter/bun/index.ts:6-11](repo://src/adapter/bun/index.ts#L6-L11), [src/adapter/deno/index.ts:6-9](repo://src/adapter/deno/index.ts#L6-L9), [src/adapter/aws-lambda/handler.ts:138-193](repo://src/adapter/aws-lambda/handler.ts#L138-L193), [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/lambda-edge/handler.ts:116-147](repo://src/adapter/lambda-edge/handler.ts#L116-L147), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36)

## Event handlers

Vercel is the simplest: `handle(app)` returns `(req) => app.fetch(req)`. Netlify's returns `(req, context) => app.fetch(req, { context })`, so the Netlify context is `c.env.context`.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/netlify/handler.ts:4-10](repo://src/adapter/netlify/handler.ts#L4-L10)

`cloudflare-pages` `handle(app)` calls `app.fetch(eventContext.request, { ...eventContext.env, eventContext }, { waitUntil, passThroughOnException, props: {} })`, so Pages bindings are on `c.env` and the full event context on `c.env.eventContext`. `handleMiddleware(middleware)` instead builds a `Context` itself and runs a Hono-style middleware as a Pages Function, with `next` calling `executionCtx.next()`; if the middleware returns nothing it returns an `HTTPException`'s response, rethrows other errors, or returns `context.res`. Its `serveStatic()` forwards to `env.ASSETS.fetch` and answers `c.notFound()` on 404.

Sources: [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/cloudflare-pages/handler.ts:49-102](repo://src/adapter/cloudflare-pages/handler.ts#L49-L102), [src/adapter/cloudflare-pages/handler.ts:114-120](repo://src/adapter/cloudflare-pages/handler.ts#L114-L120)

`service-worker` `handle(app, opts)` returns a listener that calls `evt.respondWith` with `app.fetch(evt.request, {}, evt)`; if the response status is 404 and `opts.fetch` is set (it defaults to the bound global `fetch`), it falls back to the network with that function. `fire(app, options)` registers it with `addEventListener('fetch', …)`. The deprecated `app.fire()` does a similar registration directly.

Sources: [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36), [src/hono-base.ts:536-542](repo://src/hono-base.ts#L536-L542)

## AWS Lambda and Lambda@Edge

These platforms deliver JSON events, not requests, so the adapters translate both ways. `aws-lambda` `handle(app, { isContentTypeBinary })` picks an `EventProcessor` for the event shape with `getProcessor` (API Gateway v1 or v2, ALB, VPC Lattice), builds a `Request` with `processor.createRequest(event)`, calls `app.fetch(req, { event, requestContext, lambdaContext })`, and turns the `Response` into the event-specific result with `processor.createResult`. If building the request fails, it returns `400 Invalid request` for a `TypeError` and `500` otherwise.

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276), [src/adapter/aws-lambda/handler.ts:625-665](repo://src/adapter/aws-lambda/handler.ts#L625-L665)

`EventProcessor` is the abstract base: each subclass supplies `getPath`, `getMethod`, `getQueryString`, `getHeaders`, `getCookies` and the cookie placement for results, while the base class assembles the `Request`. Result bodies are base64-encoded when the content type is binary (`defaultIsContentTypeBinary`, overridable) or the response has a non-identity content encoding. Header values containing non-ASCII characters are passed through `encodeURIComponent`.

Sources: [src/adapter/aws-lambda/handler.ts:13-21](repo://src/adapter/aws-lambda/handler.ts#L13-L21), [src/adapter/aws-lambda/handler.ts:278-300](repo://src/adapter/aws-lambda/handler.ts#L278-L300), [src/adapter/aws-lambda/handler.ts:666-674](repo://src/adapter/aws-lambda/handler.ts#L666-L674)

`streamHandle(app)` wraps the work in `awslambda.streamifyResponse`, writes the status, headers and cookies as response metadata, and pipes `res.body` to the Lambda response stream; any error writes `Internal Server Error` and the stream is always ended.

Sources: [src/adapter/aws-lambda/handler.ts:138-193](repo://src/adapter/aws-lambda/handler.ts#L138-L193)

`lambda-edge` `handle(app)` builds the request from the CloudFront record (URL from the host header or the distribution domain plus `uri` and `querystring`, headers, and a decoded body), and passes `event`, `context`, a wrapped `callback`, `config`, `request` and `response` as `env`. A callback result set by a handler wins; otherwise the `Response` becomes a CloudFront result with the status as a string and lower-cased header arrays.

Sources: [src/adapter/lambda-edge/handler.ts:105-196](repo://src/adapter/lambda-edge/handler.ts#L105-L196)

## Bun and Deno

Bun and Deno pass the server object to `fetch` as the second argument, and the adapters read it back from `c.env`. `getBunServer(c)` returns `c.env.server` when `env` has a `server` key and `c.env` otherwise. `getConnInfo` for Bun calls `server.requestIP(c.req.raw)`; if the server was not passed it throws `env has to include the 2nd argument of fetch.`, and a null result yields an empty `remote`. Deno's `getConnInfo` reads `c.env.remoteAddr` for hostname, port and transport.

Sources: [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17)

Both runtimes provide `serveStatic` by giving the generic `serveStatic` middleware a `getContent`, `join` and `isDir` that use the platform's file APIs (`Bun.file` and `fs.stat` for Bun), and a `toSSG` that gives `helper/ssg` a file-system module ([[Static Site Generation]]). The generic middleware is covered in [[Utility and Response Middleware]].

Sources: [src/adapter/bun/serve-static.ts:1-32](repo://src/adapter/bun/serve-static.ts#L1-L32), [src/adapter/bun/ssg.ts:1-27](repo://src/adapter/bun/ssg.ts#L1-L27)

## Cloudflare Workers

Worker modules export an app directly, so the adapter only supplies the pieces that need Cloudflare objects. `serveStatic` serves from KV assets using `getContentFromKVAsset`, with `options.namespace` or `c.env.__STATIC_CONTENT` as the namespace. `getConnInfo` returns the `cf-connecting-ip` header as the remote address.

Sources: [src/adapter/cloudflare-workers/serve-static.ts:6-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L6-L42), [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7)

## WebSocket upgrade

`helper/websocket` defines the contract. `WSEvents` has `onOpen`, `onMessage`, `onClose` and `onError`; `WSContext` wraps platform-supplied `send`, `close`, `readyState`, `url` and `protocol` behind one class. `defineWebSocketHelper(handler)` builds an `UpgradeWebSocket` function that can be used two ways: as middleware `upgradeWebSocket((c) => events)`, which calls `next()` when the handler declines to upgrade, or directly as `upgradeWebSocket(c, events)`, which throws `Failed to upgrade WebSocket` when it cannot.

Sources: [src/helper/websocket/index.ts:14-91](repo://src/helper/websocket/index.ts#L14-L91), [src/helper/websocket/index.ts:111-140](repo://src/helper/websocket/index.ts#L111-L140)

Each runtime implements only the handler. Bun's calls `server.upgrade(c.req.raw, { data: { events, url, protocol } })` and returns an empty `Response` on success; the exported `websocket` handler object routes `open`, `message` and `close` to the stored events. Cloudflare's requires an `Upgrade: websocket` header, creates a `WebSocketPair`, attaches `close`, `message` and `error` listeners (no `open`, which Workers does not fire), accepts the server side and returns a 101 response carrying the client side.

Sources: [src/adapter/bun/websocket.ts:33-104](repo://src/adapter/bun/websocket.ts#L33-L104), [src/adapter/cloudflare-workers/websocket.ts:5-53](repo://src/adapter/cloudflare-workers/websocket.ts#L5-L53)

## Runtime detection and environment variables

`getRuntimeKey()` returns `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It matches `navigator.userAgent` against known prefixes first, then checks for `EdgeRuntime`, `fastly`, and finally `process.release.name`. `env(c, runtime?)` in `helper/adapter` then reads variables from the right place: `process.env` for Node, Bun and edge-light, `Deno.env.toObject()` for Deno, `c.env` for Workers, and an empty object for Fastly and unknown runtimes. The conninfo helper defines the shared `ConnInfo` type, with a `remote` address, port and transport, that each adapter's `getConnInfo` returns.

Sources: [src/helper/adapter/index.ts:8-41](repo://src/helper/adapter/index.ts#L8-L41), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90), [src/helper/conninfo/types.ts:1-40](repo://src/helper/conninfo/types.ts#L1-L40)
