---
type: platform
title: Runtime Adapters
description: How the adapters in src/adapter bridge platform-specific events, servers and file systems to Hono's fetch contract - Cloudflare Workers/Pages, AWS Lambda and Lambda@Edge, Bun, Deno, Vercel, Netlify and Service Workers - plus runtime detection.
tags: [adapters, cloudflare, aws-lambda, bun, deno, vercel, netlify, runtime]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
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
  - id: openwiki-source-753f402adff22861f1a61d5b
    resource: repo://src/adapter/cloudflare-workers/serve-static.ts
  - id: openwiki-source-32c11363149a03db878ea874
    resource: repo://src/adapter/deno/serve-static.ts
  - id: openwiki-source-742c2cb89906fa46f1243028
    resource: repo://src/adapter/deno/websocket.ts
  - id: openwiki-source-3b540c7cdbcadd6a68a916fb
    resource: repo://src/adapter/netlify/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Runtime Adapters

The core only knows `app.fetch(request, env, executionCtx)` ([Request Lifecycle](../architecture/request-lifecycle.md)). Adapters in `src/adapter/<platform>/` (each its own subpath export such as `hono/aws-lambda`, `hono/cloudflare-pages`, `hono/bun`) supply the missing pieces:

1. an **entry handler** converting the platform's invocation shape into `fetch(...)` and the `Response` back;
2. **platform capabilities** implemented against shared interfaces: `serveStatic`, `upgradeWebSocket`, `getConnInfo`, and SSG file-system modules ([Helpers](../features/helpers.md), [Middleware Catalog](../features/middleware-catalog.md)).

What the adapter passes as `env` is the contract handlers rely on: it is how the platform leaks bindings, the server object or the raw event into `c.env`.

## Entry handlers

| Platform | Export | What it does |
| --- | --- | --- |
| Cloudflare Pages | `handle(app)` | A `PagesFunction`: calls `app.fetch(request, { ...env, eventContext }, { waitUntil, passThroughOnException, props: {} })`. `handleMiddleware(mw)` runs a single middleware as a Pages Function middleware, mapping `next()` to `executionCtx.next()`, converting thrown `HTTPException` into its response and rethrowing other errors |
| Vercel | `handle(app)` | `(req) => app.fetch(req)` |
| Netlify | `handle(app)` | `(req, context) => app.fetch(req, { context })`: the Netlify context is exposed as `c.env.context` |
| Service Worker | `handle(app, { fetch })` | Returns a `fetch`-event listener that calls `app.fetch(evt.request, {}, evt)`; if the app answers 404 and a `fetch` is configured (default `globalThis.fetch`), falls back to the network. This lets a Hono app sit in front of existing network resources |
| AWS Lambda | `handle(app, { isContentTypeBinary })`, `streamHandle(app)` | See below |
| Lambda@Edge | `handle(app)` | Converts the CloudFront event (`event.Records[0].cf`) into a `Request` and calls `app.fetch` with an env containing `callback`, `config`, `request` and `response`, so handlers can interact with the CloudFront callback; the module also polyfills `globalThis.crypto` from `node:crypto` |
| Bun / Deno | (no wrapper) | `Bun.serve({ fetch: app.fetch, websocket })` / `Deno.serve(app.fetch)`: `fetch` already matches the runtime API |
| Cloudflare Workers | (no wrapper) | `export default app` works as the module worker |

### AWS Lambda (`src/adapter/aws-lambda/handler.ts`)

`handle` selects an `EventProcessor` subclass per event via `getProcessor`: **ALB** (`requestContext.elb`), **API Gateway v2 / function URL** (needs both `rawPath` and `requestContext.http`; `rawPath` alone is insufficient because v1 events behind a custom domain mapping also have it), **VPC Lattice v2** (`requestContext.serviceArn`), otherwise **API Gateway v1**. Each processor implements the abstract extraction methods (path, method, query string, headers, cookies, cookie-writing). Shared logic in the base class:

- `createRequest` builds `https://<domainName><path>?<query>` (domain from the request context or `Host` header), decodes base64 or UTF-8 bodies, and sets `content-length`. Non-ASCII header values are `encodeURIComponent`-sanitised.
- `createResult` returns `{ statusCode, body, isBase64Encoded, headers | multiValueHeaders }`, base64-encoding the body when the content type is considered binary (`defaultIsContentTypeBinary`: anything that is not text/js/css/csv/json/xml; override via `isContentTypeBinary`) or `Content-Encoding` is not `identity`. `Set-Cookie` values are moved into the format each event type expects (v2 `cookies` array vs header lists).
- The Hono `env` is `{ event, requestContext, lambdaContext }`; `getConnInfo` reads the source IP from the request context.
- Request-conversion errors are turned into a 400 (`TypeError`) or 500 response instead of failing the invocation; `app.fetch` errors are handled by the app error handler as usual.
- `streamHandle` wraps `awslambda.streamifyResponse` for Lambda response streaming: it passes `{event, requestContext, context}` as env, writes status/headers/cookies through `awslambda.HttpResponseStream.from`, pipes the body reader to the Node stream, and writes `Internal Server Error` on failure.

## Capabilities per runtime

- **serveStatic.** All variants wrap the shared `serveStatic` and only provide `getContent` (plus `join`/`isDir` where applicable): Bun uses `Bun.file(path)` (returning `null` if missing) and `node:fs/promises.stat`; Deno uses `Deno.open(...).readable` and `lstatSync`, logging non-NotFound errors; Cloudflare Workers reads from the KV asset namespace (`__STATIC_CONTENT` or `options.namespace`, with `manifest`); Cloudflare Pages delegates to `env.ASSETS.fetch(c.req.raw)` and maps a 404 to `c.notFound()`.
- **WebSocket.** Each adapter calls `defineWebSocketHelper` ([Helpers](../features/helpers.md)). Bun needs the *server* in `c.env` (the second argument to `fetch`) and calls `server.upgrade(req, { data: { events, url, protocol } })`, returning an empty response on success; you must also pass the exported `websocket` handler object to `Bun.serve`, whose `open/message/close` callbacks dispatch to the stored events. Deno requires an `Upgrade: websocket` header, echoes the first requested subprotocol (browsers reject mismatches), calls `Deno.upgradeWebSocket`, and wires `socket.on*` to the events. Cloudflare Workers uses `WebSocketPair`.
- **Connection info (`getConnInfo`).** Bun reads `server.requestIP(req)` from `c.env` (throwing `TypeError` if the server is missing); Deno reads `c.env.remoteAddr`; Cloudflare Workers reads the `cf-connecting-ip` header; Vercel reads `x-real-ip`; Netlify uses the `ip` from its context object; Lambda reads the request context. All conform to `GetConnInfo` ([Helpers](../features/helpers.md)).
- **SSG.** `adapter/bun/ssg.ts` and `adapter/deno/ssg.ts` provide `FileSystemModule` implementations and `toSSG` wrappers around the generic `toSSG`.

## Runtime detection (`src/helper/adapter`)

`getRuntimeKey()` returns `node | deno | bun | workerd | fastly | edge-light | other`, by matching `navigator.userAgent` against known strings (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then `EdgeRuntime`, then the `fastly` global. `env(c, runtime?)` uses it to read environment variables portably (see [Helpers](../features/helpers.md)). Many parts of the library branch on runtime knowledge only through these helpers or via adapter-specific imports, which keeps the portable core free of platform APIs.

## Testing

Adapter behaviour is covered by colocated tests (`handler.test.ts`, `conninfo.test.ts`, `websocket.test.ts`) plus real-environment suites in `runtime-tests/` for Lambda, Lambda@Edge, Bun, Deno and workerd ([Testing](../operations/testing.md)).
