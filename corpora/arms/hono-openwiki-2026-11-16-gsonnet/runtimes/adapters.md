---
type: integration
title: Runtime Adapters and Multi-Runtime Support
description: How src/adapter translates platform events (Cloudflare Pages, AWS Lambda, Lambda@Edge, Vercel, Netlify, service workers) into app.fetch calls, and how per-runtime serve-static, WebSocket upgrade, conninfo and the getRuntimeKey/env helper hide runtime differences.
tags: [adapters, runtimes, lambda, cloudflare, bun, deno, websocket, conninfo]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-2c8c4b178ced11e8101be44a
    resource: repo://src/adapter/bun/conninfo.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-91d3173886899b1d372057c9
    resource: repo://src/adapter/bun/websocket.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-8f07a0b8a762547156ba4abf
    resource: repo://src/adapter/cloudflare-workers/conninfo.ts
  - id: openwiki-source-753f402adff22861f1a61d5b
    resource: repo://src/adapter/cloudflare-workers/serve-static.ts
  - id: openwiki-source-0570fa79ae374d6432e88c4e
    resource: repo://src/adapter/cloudflare-workers/websocket.ts
  - id: openwiki-source-89fa5f287735c052fe5571db
    resource: repo://src/adapter/lambda-edge/conninfo.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-c2bcf3576302d7f13d4dc1e5
    resource: repo://src/adapter/netlify/conninfo.ts
  - id: openwiki-source-3b540c7cdbcadd6a68a916fb
    resource: repo://src/adapter/netlify/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-ee2a2aab8c474aacda920234
    resource: repo://src/adapter/vercel/conninfo.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Runtime Adapters and Multi-Runtime Support

Hono's core only needs `app.fetch(request, env, executionCtx)` (see [Request Lifecycle](../architecture/request-lifecycle.md)). On modern runtimes that *is* the entry point (`export default app` on Workers/Bun, `Deno.serve(app.fetch)`). `src/adapter/*` exists for the platforms that don't speak `Request/Response` natively, and to supply runtime-specific implementations of cross-cutting features. Each adapter is its own entry (`hono/aws-lambda`, `hono/cloudflare-pages`, `hono/bun`, `hono/deno`, `hono/cloudflare-workers`, `hono/vercel`, `hono/netlify`, `hono/lambda-edge`, `hono/service-worker`).

The platform's native event/context object is passed as the **second argument (`env`)** of `fetch`, so handlers reach it through `c.env`; this is why `c.env` is typed by `Bindings` and why adapters nest things like `{ event, requestContext, lambdaContext }` inside it.

## Handler-translation adapters

| Adapter | What it does |
| --- | --- |
| `vercel` (`handle(app)`) | `(req) => app.fetch(req)` |
| `netlify` | `(req, context) => app.fetch(req, { context })` |
| `service-worker` (`handle(app, { fetch })`) | `(evt) => evt.respondWith(...)`: calls `app.fetch(evt.request, {}, evt)` (so `c.event` works); on a 404 it falls back to the real `fetch(evt.request)`, which lets a Hono app sit in front of network/static assets. `fire` from this module replaces the deprecated `app.fire()`. |
| `cloudflare-pages` | `handle(app)` calls `app.fetch(ctx.request, { ...ctx.env, eventContext }, { waitUntil, passThroughOnException, props: {} })`. `handleMiddleware(mw)` turns a Hono middleware into a Pages Function: it builds a standalone `Context`, runs the middleware with `next` bound to `executionCtx.next()`, converts a thrown `HTTPException` to its response and rethrows other errors. `serveStatic()` there proxies to the `ASSETS` binding and maps 404 to `c.notFound()`. |
| `aws-lambda` | Largest adapter — see below. |
| `lambda-edge` | `handle(app)` converts a CloudFront event (`Records[0].cf.request`) into a `Request` (host from header or distribution domain; body only for non-GET/HEAD, base64-aware), calls `app.fetch(req, { event, context, callback, config, … })` (the raw event, Lambda context, a wrapped callback and the CloudFront config), and converts the `Response` to a CloudFront result (headers as `{key,value}[]` lowercase, `bodyEncoding: 'base64'` for binary types/encodings). The `callback` passed in `env` lets handlers short-circuit with the raw CloudFront request/result. It polyfills `globalThis.crypto` from `node:crypto`. |

### AWS Lambda (`adapter/aws-lambda/handler.ts`)
`handle(app, { isContentTypeBinary? })` returns `async (event, lambdaContext) => result`. It uses the **`EventProcessor` strategy pattern**: `getProcessor(event)` inspects the event and picks one of `ALBProcessor` (`requestContext.elb`), `EventV2Processor` (`rawPath` **and** `requestContext.http` — HTTP API / function URLs), `LatticeV2Processor` (`requestContext.serviceArn`), or `EventV1Processor` (REST API / default). The base class implements `createRequest(event)` (builds `https://<domain><path>?<query>`; the domain comes from `requestContext.domainName` or the Host header; body is base64-decoded when `isBase64Encoded`, with `content-length` set) and `createResult(event, res, options)` (base64-encodes the body if the content type is "binary" — anything not text/json/xml by `defaultIsContentTypeBinary` — or the response has a non-identity `Content-Encoding`; emits `headers` or `multiValueHeaders` depending on the event; moves `Set-Cookie` into `cookies` (V2) or header lists). Subclasses supply path/method/query/headers/cookie specifics. Errors while creating the request become 400 (`TypeError`) or 500 responses without invoking the app. `streamHandle(app)` uses Lambda response streaming (`awslambda.streamifyResponse` + `HttpResponseStream`), writing the body from the `Response` stream and the metadata (status, headers, cookies). Non-ASCII header values are URI-encoded (`sanitizeHeaderValue`). `app.fetch` receives `{ event, requestContext, lambdaContext }` (non-streaming) or `{ event, requestContext, context }` (streaming) as `c.env`.

## Cross-cutting features implemented per runtime

### Connection info (`helper/conninfo` + `getConnInfo` per adapter)
`GetConnInfo = (c) => { remote: { address?, addressType?, port?, transport? } }`. Implementations: Cloudflare Workers reads `cf-connecting-ip`; Deno reads `c.env.remoteAddr`; Bun calls `server.requestIP(c.req.raw)` (throws `TypeError` if `env` lacks the server or `requestIP`; returns `{ remote: {} }` for closed/unix-socket requests); Vercel reads `x-real-ip`, Cloudflare Pages reads `cf-connecting-ip`, Netlify reads `c.env.context.ip`, Lambda@Edge reads the CloudFront request's `clientIp`, and AWS Lambda derives it from the event's request context. `ip-restriction` consumes this (see [Built-in Middleware](../middleware/middleware.md)). Bun's `getBunServer(c)` accepts either `c.env.server` or `c.env` itself, supporting both `export default { fetch }` and `Bun.serve({ fetch: app.fetch })` styles.

### Static files
`middleware/serve-static` is generic; runtime wrappers provide `getContent` and path joining: Bun/Deno read from the file system, Cloudflare Workers reads from Workers KV assets (`getContentFromKVAsset`, `namespace`/`manifest` options, default namespace `c.env.__STATIC_CONTENT`), Cloudflare Pages delegates to `ASSETS`.

### WebSocket (`helper/websocket`)
Each runtime implements `upgradeWebSocket` via `defineWebSocketHelper`:
- *Cloudflare Workers*: requires `Upgrade: websocket`, creates a `WebSocketPair`, accepts the server side, wires `close/message/error` listeners (no `open` event on Workers), and returns a 101 response with the client socket.
- *Bun*: `hono/bun` exports `upgradeWebSocket` and a `websocket` handler (the older `createBunWebSocket()` factory returning both is deprecated). `upgradeWebSocket` calls `server.upgrade(c.req.raw, { data: { events, url, protocol } })` and throws a `TypeError` if `env` has no server; the `websocket` handler (`open/message/close`) must be passed to `Bun.serve`; `createWSContext` adapts Bun's socket to `WSContext`.
- *Deno*: wraps `Deno.upgradeWebSocket(c.req.raw, …)`.
All three present the same `WSEvents` API (see [Helpers](../helpers/helpers.md)); `hc(...).$ws()` is the matching client.

### Static site generation
`adapter/bun/ssg.ts` and `adapter/deno/ssg.ts` supply the `FileSystemModule` for `toSSG` and export adaptor-form `toSSG(app, options)`.

## Runtime detection (`helper/adapter`)
`getRuntimeKey()` returns `'node' | 'deno' | 'bun' | 'workerd' | 'fastly' | 'edge-light' | 'other'` by checking `navigator.userAgent` against known strings (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then `EdgeRuntime`, `fastly`, and finally `process.release.name`. `env(c, runtime?)` returns environment variables in a uniform way: `process.env` (node/bun/edge-light), `Deno.env.toObject()`, `c.env` (workerd), or `{}` (fastly/other). `checkUserAgentEquals` is exported for tests.

## Testing
Runtime behaviour is verified in `runtime-tests/*` (Deno, Bun, workerd, Fastly, Lambda, Lambda@Edge, Node) and per-adapter unit tests (`handler.test.ts`, `conninfo.test.ts`, `websocket.test.ts`) — see [Testing Strategy](../testing/testing.md).
