---
type: integration
title: Runtime Adapters
description: How src/adapter bridges Hono's Web-standard fetch() to AWS Lambda (API Gateway v1/v2, ALB, VPC Lattice, streaming), Lambda@Edge, Cloudflare Workers and Pages, Bun, Deno, Netlify, Vercel and Service Workers, and how each supplies serveStatic, upgradeWebSocket, getConnInfo and toSSG implementations.
tags: [adapters, runtimes, aws-lambda, cloudflare, bun, deno, deployment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-b9a8387fef3591f80b327aa9
    resource: repo://src/adapter/bun/serve-static.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-8f07a0b8a762547156ba4abf
    resource: repo://src/adapter/cloudflare-workers/conninfo.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-32c11363149a03db878ea874
    resource: repo://src/adapter/deno/serve-static.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-ee2a2aab8c474aacda920234
    resource: repo://src/adapter/vercel/conninfo.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Runtime Adapters

Hono's core only needs `app.fetch(request, env, executionCtx)`. Runtimes that already speak `fetch` (Cloudflare Workers module syntax, Deno `Deno.serve`, Bun `Bun.serve`) can use `export default app` directly. Adapters in `src/adapter/<runtime>/` exist for two reasons:

1. **Event conversion** for platforms that do not pass a `Request` (AWS Lambda, Lambda@Edge, Service Worker `FetchEvent`, Pages Functions).
2. **Runtime-specific implementations** of contracts defined in helpers/middleware: `serveStatic` (base in `src/middleware/serve-static`), `upgradeWebSocket` (contract in [WebSocket helper](../helpers/overview.md#websocket)), `getConnInfo` ([conninfo](../helpers/overview.md#adapter-and-conninfo)) and `toSSG` ([SSG](../helpers/overview.md#static-site-generation-ssg)).

Node.js is supported through the separate `@hono/node-server` package (used here only as a dev dependency for tests), not by an adapter in this repo.

## Capability matrix

| Adapter (`hono/...`) | Handler | serveStatic | upgradeWebSocket | getConnInfo | toSSG |
| --- | --- | --- | --- | --- | --- |
| `aws-lambda` | `handle`, `streamHandle` | – | – | ✓ | – |
| `lambda-edge` | `handle` | – | – | ✓ | – |
| `cloudflare-workers` | (use `app.fetch`) | ✓ (KV `__STATIC_CONTENT`) | ✓ (`WebSocketPair`) | ✓ (`cf-connecting-ip`) | – |
| `cloudflare-pages` | `handle`, `handleMiddleware` | ✓ (`env.ASSETS`) | – | ✓ | – |
| `bun` | (use `app.fetch`) | ✓ (`Bun.file`) | ✓ (`server.upgrade` + `websocket`) | ✓ (`server.requestIP`) | ✓ |
| `deno` | (use `app.fetch`) | ✓ (`Deno.open`) | ✓ (`Deno.upgradeWebSocket`) | ✓ (`env.remoteAddr`) | ✓ |
| `netlify` | `handle` | – | – | ✓ | – |
| `vercel` | `handle` | – | – | ✓ (`x-real-ip`) | – |
| `service-worker` | `handle`, `fire` | – | – | – | – |

## AWS Lambda

`handle(app, { isContentTypeBinary? })` (`src/adapter/aws-lambda/handler.ts`) picks an `EventProcessor` per event shape:

- **ALB** – `requestContext.elb` present.
- **API Gateway v2 / Function URL** – `rawPath` **and** `requestContext.http` present (a v1 REST event behind a custom-domain mapping also has `rawPath`, so `rawPath` alone is not trusted).
- **VPC Lattice v2** – `requestContext.serviceArn`.
- Otherwise **API Gateway v1**.

Each processor builds a `Request` (method, path, query string, headers including `multiValueHeaders`, v2 `cookies` joined into a `Cookie` header, base64 body decoding when `isBase64Encoded`) and later converts the `Response` into the matching result shape. Binary detection: the body is base64-encoded if `isContentTypeBinary(contentType)` (default: anything other than `text/plain|html|css|javascript|csv` and `*/json`/`*+json`/`xml`) or if a non-`identity` `Content-Encoding` is set. `Set-Cookie` values are placed in `cookies` (v2), `multiValueHeaders['set-cookie']` (v1/ALB with multi-value) or headers, depending on the event type.

`c.env` receives `{ event, requestContext, lambdaContext }`. If building the request fails, the handler returns 400 for `TypeError` (malformed input) and 500 otherwise, without calling the app.

`streamHandle(app)` wraps the handler in `awslambda.streamifyResponse`, writes status/headers/cookies via `awslambda.HttpResponseStream.from`, then pipes the response body. Errors are logged and written as `Internal Server Error`.

## Lambda@Edge

`handle(app)` converts a CloudFront event to a `Request` and exposes `{ event, context, callback, config, request, response }` on `c.env`. Middleware can call `c.env.callback(err, result)` to return a CloudFront request/response directly (e.g. to pass through to origin); the first callback result wins over the Hono response, and a callback error is re-thrown. Otherwise the response is converted, base64-encoding binary or encoded bodies.

## Cloudflare

- **Workers**: use `export default app`. `upgradeWebSocket` creates a `WebSocketPair`, wires `message`/`close`/`error` listeners (Workers has no `open` event, so `onOpen` is excluded from the event type), accepts the server socket and returns `101` with `webSocket: client`. `serveStatic` (`hono/cloudflare-workers`) reads from Workers Sites KV (`env.__STATIC_CONTENT` plus manifest).
- **Pages**: `handle(app)` turns a Pages Function into `app.fetch(request, { ...env, eventContext }, { waitUntil, passThroughOnException })`. `handleMiddleware(mw)` runs a Hono middleware as a Pages `_middleware`, where `next()` calls `eventContext.next()`; an `HTTPException` becomes its response and other errors are rethrown. `serveStatic()` proxies to `env.ASSETS.fetch` and maps 404 to `c.notFound()`.

## Bun and Deno

Both implement `serveStatic` by giving the generic serve-static middleware `getContent`, `join` and `isDir` functions. Both export `toSSG` bound to their filesystem APIs (`bunFileSystemModule`, `denoFileSystemModule`).

- **Bun** `upgradeWebSocket` calls `server.upgrade(req, { data: { events, url, protocol } })`; the server is read from `c.env` (or `c.env.server`) via `getBunServer`, so the app must be served with `fetch(req, server)`. The exported `websocket` handler object must be passed to `Bun.serve({ fetch, websocket })`; it dispatches `open`/`message`/`close` to the stored events. `getConnInfo` uses `server.requestIP`.
- **Deno** `upgradeWebSocket` calls `Deno.upgradeWebSocket`, echoing the first requested subprotocol (browsers reject connections otherwise). `getConnInfo` reads `c.env.remoteAddr` (Deno passes connection info as the second `fetch` argument).

## Netlify, Vercel, Service Worker

- **Netlify** `handle(app)` → `(req, context) => app.fetch(req, { context })`.
- **Vercel** `handle(app)` → `(req) => app.fetch(req)`; `getConnInfo` reads `x-real-ip`.
- **Service Worker** `handle(app, { fetch })` responds to a `FetchEvent` with `app.fetch(evt.request, {}, evt)`; when the app returns 404 and a `fetch` is configured (default: bound `globalThis.fetch`), the request falls through to the network. `fire(app)` registers it with `addEventListener('fetch', ...)`. The `FetchEvent` becomes `c.event`/`c.executionCtx`.

## Security notes

`getConnInfo` implementations that read headers (`cf-connecting-ip`, `x-real-ip`) are only trustworthy behind the corresponding platform proxy. Choose the adapter matching the actual deployment when using [ip-restriction](../middleware/security-and-auth.md).

## Tests

- Unit tests sit beside each adapter (`src/adapter/aws-lambda/handler.test.ts`, `src/adapter/cloudflare-pages/handler.test.ts`, `src/adapter/bun/websocket.test.ts`, ...).
- End-to-end runtime checks live in `runtime-tests/` (`bun`, `deno`, `workerd`, `lambda`, `lambda-edge`, `fastly`, `node`); see [Testing Strategy](../testing/testing-strategy.md).
