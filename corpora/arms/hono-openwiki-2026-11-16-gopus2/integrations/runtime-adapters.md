---
type: integration
title: Runtime Adapters
description: How src/adapter turns platform-specific events into app.fetch calls for AWS Lambda, Lambda@Edge, Cloudflare Workers/Pages, Bun, Deno, Vercel, Netlify and service workers, and how each provides serveStatic, WebSocket upgrade, getConnInfo and SSG bindings.
tags: [adapters, runtimes, aws-lambda, cloudflare, bun, deno, websocket, serve-static]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-6b933a7a2babbdbab3fb58eb
    resource: repo://src/adapter/aws-lambda/conninfo.ts
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-b9a8387fef3591f80b327aa9
    resource: repo://src/adapter/bun/serve-static.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-753f402adff22861f1a61d5b
    resource: repo://src/adapter/cloudflare-workers/serve-static.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-32c11363149a03db878ea874
    resource: repo://src/adapter/deno/serve-static.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-3b540c7cdbcadd6a68a916fb
    resource: repo://src/adapter/netlify/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Runtime Adapters

The core only needs `app.fetch(request, env, executionCtx)` (see [Request Lifecycle](../architecture/request-lifecycle.md)). Runtimes that already speak `fetch` (Cloudflare Workers, Deno, Bun, Fastly) can use `export default app` or `Deno.serve(app.fetch)` directly. The adapters in `src/adapter/*` add the platform pieces:

1. **Event translation** (`handle`) for platforms whose entrypoint is not a `Request` → `Response` function.
2. **Implementations of runtime-neutral contracts** that the [Helpers](../helpers/helpers.md) and middleware define: `serveStatic` (the `middleware/serve-static` core), `upgradeWebSocket` (`helper/websocket`), `getConnInfo` (`helper/conninfo`), and `toSSG` (`helper/ssg`).

Node.js is **not** in this repository. It is served by `@hono/node-server`, which appears here as a dev dependency for tests.

| Adapter (`hono/…`) | `handle` | `serveStatic` | `upgradeWebSocket` | `getConnInfo` source | Other |
| --- | --- | --- | --- | --- | --- |
| `aws-lambda` | ✓ (+ `streamHandle`) | – | – | `requestContext.identity.sourceIp` / `http.sourceIp` / last `X-Forwarded-For` | `defaultIsContentTypeBinary` |
| `lambda-edge` | ✓ | – | – | CloudFront `clientIp` | |
| `cloudflare-workers` | (native fetch) | KV `__STATIC_CONTENT` | `WebSocketPair` | `cf-connecting-ip` header | |
| `cloudflare-pages` | ✓ (+ `handleMiddleware`) | `env.ASSETS.fetch` | – | `cf-connecting-ip` | |
| `bun` | (native fetch) | `Bun.file` | `server.upgrade` + `websocket` handler | `server.requestIP` | `toSSG`, `getBunServer` |
| `deno` | (native fetch) | `Deno.open`/`lstatSync` | `Deno.upgradeWebSocket` | `env.remoteAddr` | `toSSG` |
| `vercel` | ✓ | – | – | `x-real-ip` header | |
| `netlify` | ✓ | – | – | `c.env.context.ip` | |
| `service-worker` | ✓ (+ `fire`) | – | – | – | |

## AWS Lambda (`src/adapter/aws-lambda`)

`handle(app, { isContentTypeBinary? })` returns an `async (event, lambdaContext)` handler:

- `getProcessor(event)` chooses an `EventProcessor` subclass by the shape of the event: **ALB**, **API Gateway v2 / Function URLs**, **VPC Lattice v2**, or **API Gateway v1**, which is the fallback. Each processor knows how to read the path, method, query string, headers and cookies, and how to write the result. For example, v1 and ALB use `multiValueHeaders`, and v2 uses the `cookies` array.
- `createRequest` builds a `Request`. The host comes from `requestContext.domainName` or the `Host` header, and bodies flagged `isBase64Encoded` are decoded. If building the request fails, the handler returns **400** for a `TypeError` and **500** for anything else, without calling the app.
- `app.fetch` receives `env = { event, requestContext, lambdaContext }`, so handlers reach the raw Lambda data through `c.env`.
- `createResult` base64-encodes the body if the content type is binary, or if `Content-Encoding` is anything other than `identity`. By default every content type is binary **except** `text/plain|html|css|javascript|csv` and `*/json`, `*+json`, `*/xml`, `*+xml`. Pass `isContentTypeBinary` to override.

`streamHandle(app)` wraps the global `awslambda.streamifyResponse` for response streaming. It sends status, headers and `set-cookie` values as `HttpResponseStream` metadata, then pipes the body. Errors write `Internal Server Error` to the stream.

## Lambda@Edge (`src/adapter/lambda-edge`)

`handle(app)` converts the CloudFront record (`event.Records[0].cf.request`) into a `Request`. It passes `{ event, context, callback, config, request, response }` as env. The `callback` is wrapped so that a handler can call `c.env.callback(null, request)` to forward the (possibly modified) request to the origin. If the callback was called, its result (or error) is returned in place of the converted response.

## Cloudflare

- **Workers**: `app` is the module default export. `serveStatic({ manifest, namespace? })` reads Workers Sites assets from KV (default binding `__STATIC_CONTENT`). `upgradeWebSocket` creates a `WebSocketPair`, wires `message`/`close`/`error` listeners (Workers have no `open` event), and returns a 101 response that carries the client socket. Requests without `Upgrade: websocket` are passed through.
- **Pages**: `handle(app)` turns a `PagesFunction` `EventContext` into `app.fetch(request, { ...env, eventContext }, { waitUntil, passThroughOnException })`. `handleMiddleware(mw)` runs a single Hono middleware as a Pages middleware. Its `next()` calls `eventContext.next()`, errors are recorded on `c.error`, an `HTTPException` becomes its response, and other errors are re-thrown. `serveStatic()` proxies to `env.ASSETS` and maps 404 to `c.notFound()`.

## Bun and Deno

Both pass platform file APIs (`getContent`, `join`, `isDir`) into the shared `serveStatic` core. Both also export `toSSG` bound to their file systems.

- **Bun** WebSockets need two registrations. `upgradeWebSocket` calls `server.upgrade(req, { data: { events, url, protocol } })`. The server is found with `getBunServer(c)`, which is `c.env.server` or `c.env` itself. The exported `websocket` object (`open`/`message`/`close`) must be passed to `Bun.serve({ fetch: app.fetch, websocket })` so that events reach the handlers. `createBunWebSocket()` is the older API that returns both.
- **Deno**: `upgradeWebSocket` uses `Deno.upgradeWebSocket`. `getConnInfo` reads `c.env.remoteAddr`, which is the second argument of `Deno.serve`'s handler.

## Vercel, Netlify, service worker

- **Vercel**: `handle(app)` is `(req) => app.fetch(req)` for Edge/Node functions that use Web Standards.
- **Netlify**: `handle(app)` is `(req, context) => app.fetch(req, { context })`, which exposes the Netlify context as `c.env.context`.
- **Service worker**: `handle(app, { fetch })` returns a `FetchEvent` listener that calls `respondWith(app.fetch(evt.request, {}, evt))`. If the app returns **404** and `opts.fetch` is set (the default is the bound `globalThis.fetch`), the request is forwarded to the network instead. `fire(app)` registers the listener. `app.fire()` on `HonoBase` is the older equivalent.

## Adding or changing an adapter

- Put the code in `src/adapter/<name>/`, export it from `index.ts`, and add the subpath to `package.json` and `jsr.json` (see [Build, Packaging and Release](../operations/build-and-release.md)).
- Implement the existing contracts rather than inventing new APIs: `ConnInfo` from `helper/conninfo/types.ts`, `defineWebSocketHelper`, and the `getContent`/`join`/`isDir` injection points of `middleware/serve-static`.
- Unit tests live next to the code (`handler.test.ts`, `conninfo.test.ts`, `websocket.test.ts`). Behaviour on the real platform is tested in `runtime-tests/<runtime>` (see [Testing Strategy](../testing/testing-strategy.md)).
