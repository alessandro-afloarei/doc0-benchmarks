---
type: integration
title: Runtime Adapters
description: How Hono's Web-Standard fetch handler is wired into Cloudflare Workers/Pages, Deno, Bun, AWS Lambda, Lambda@Edge, Netlify, Vercel, and Service Workers, including request/response translation, getConnInfo, and runtime-specific serveStatic.
tags: [adapters, runtime, aws-lambda, cloudflare, bun, deno, serve-static, conninfo]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-2c8c4b178ced11e8101be44a
    resource: repo://src/adapter/bun/conninfo.ts
  - id: openwiki-source-b9a8387fef3591f80b327aa9
    resource: repo://src/adapter/bun/serve-static.ts
  - id: openwiki-source-a297b78d110b6653c37db7e1
    resource: repo://src/adapter/bun/server.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-753f402adff22861f1a61d5b
    resource: repo://src/adapter/cloudflare-workers/serve-static.ts
  - id: openwiki-source-32c11363149a03db878ea874
    resource: repo://src/adapter/deno/serve-static.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Runtime Adapters

Hono's core is a single Web-Standard entrypoint: `app.fetch(request, env?, executionCtx?)` (see [Application Object and Request Dispatch](../core/application.md)). Runtimes that already speak `Request`/`Response` (Cloudflare Workers, Deno, Bun) can call `app.fetch` directly; the code under `src/adapter/*` exists for everything around that call — translating proprietary event shapes, exposing runtime connection info, serving static files from a runtime's file system, and upgrading WebSockets.

Each adapter is published as a package subpath (`hono/aws-lambda`, `hono/bun`, `hono/cloudflare-workers`, `hono/cloudflare-pages`, `hono/deno`, `hono/lambda-edge`, `hono/netlify`, `hono/vercel`, `hono/service-worker`). Node.js is **not** in this repository; it is served by the separate `@hono/node-server` package.

## Adapter surface at a glance

| Adapter | Main exports | What it does |
| --- | --- | --- |
| `aws-lambda` | `handle`, `streamHandle`, `defaultIsContentTypeBinary`, `getConnInfo` | Converts API Gateway v1/v2, ALB, Lambda Function URL and VPC Lattice v2 events to `Request` and back |
| `lambda-edge` | `handle`, `getConnInfo` | Converts CloudFront edge events; supports the callback style |
| `cloudflare-pages` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` | Pages Functions integration |
| `cloudflare-workers` | `serveStatic` (KV, deprecated), `upgradeWebSocket`, `getConnInfo` | Workers-specific helpers (no handler needed — export `app`) |
| `bun` | `serveStatic`, `toSSG`, `bunFileSystemModule`, `createBunWebSocket`/`upgradeWebSocket`/`websocket`, `getConnInfo`, `getBunServer` | Bun file system, sockets and server object |
| `deno` | `serveStatic`, `toSSG`, `denoFileSystemModule`, `upgradeWebSocket`, `getConnInfo` | Deno file system and sockets |
| `netlify` | `handle`, `getConnInfo` | Passes Netlify `context` in `env` |
| `vercel` | `handle`, `getConnInfo` | Thin `app.fetch(req)` wrapper |
| `service-worker` | `handle`, `fire` | Registers a `fetch` event listener with 404 fallthrough |

WebSocket upgrade helpers are documented in [Streaming, SSE, and WebSocket Helpers](../helpers/streaming-and-websocket.md); `toSSG` in [Static Site Generation](../helpers/ssg.md).

## Handler translation

### Thin wrappers (Vercel, Netlify, Cloudflare Pages)

- **Vercel** `handle(app)` returns `(req) => app.fetch(req)` — nothing else is translated.
- **Netlify** `handle(app)` returns `(req, context) => app.fetch(req, { context })`, so the Netlify context is available as `c.env.context`.
- **Cloudflare Pages** `handle(app)` calls `app.fetch(eventContext.request, { ...eventContext.env, eventContext }, { waitUntil, passThroughOnException, props: {} })`. Bindings stay accessible as `c.env.X`, and the full Pages `EventContext` is at `c.env.eventContext`.

`cloudflare-pages` also provides `handleMiddleware(middleware)`, which runs a *single* Hono middleware as a Pages middleware function without a router. It builds a `Context` manually, wires `next()` to `eventContext.next()`, and resolves the outcome in this order: a returned `Response` wins; an `HTTPException` stored on `context.error` is converted with `getResponse()`; any other error is re-thrown; otherwise `context.res` is returned. Its `serveStatic()` forwards the raw request to the `ASSETS` binding and converts an upstream 404 into `c.notFound()`.

### Service Worker

`handle(app, { fetch })` returns a `FetchEvent` listener that calls `evt.respondWith(app.fetch(evt.request, {}, evt))`. If the app answers **404** and a `fetch` option is present (default: `globalThis.fetch` bound to `globalThis`), the original request is re-fetched from the network, so the worker only intercepts routes it knows. `fire(app, options)` simply does `addEventListener('fetch', handle(app, options))`. (The legacy `app.fire()` method on the app itself is a separate, simpler path.)

### AWS Lambda

`hono/aws-lambda` is the largest adapter. The `handle(app, { isContentTypeBinary })` function:

1. Chooses an `EventProcessor` via `getProcessor(event)`:
   - **ALB** when `requestContext` has an `elb` key;
   - **API Gateway v2 / Function URL** when the event has `rawPath` **and** `requestContext.http` (a v1 REST event behind a custom-domain base path mapping also has `rawPath`, so `rawPath` alone is not trusted);
   - **VPC Lattice v2** when `requestContext` has `serviceArn`;
   - otherwise **API Gateway v1**.
2. Builds a `Request` with `processor.createRequest(event)` (host from headers, query from single- or multi-value parameters, cookies folded into a `Cookie` header, base64 bodies decoded).
3. Calls `app.fetch(req, { event, requestContext, lambdaContext })`, so handlers read Lambda data through `c.env`.
4. Converts the `Response` back with `processor.createResult`. The body is base64-encoded when `isContentTypeBinary(contentType)` is true (default `defaultIsContentTypeBinary` treats everything except `text/plain|html|css|javascript|csv` and `*/json`, `*+json`, `*/xml`, `*+xml` as binary) **or** when `Content-Encoding` is anything other than `identity`. Multi-value header events get `multiValueHeaders` in the result.
5. `Set-Cookie` headers are placed in the event-specific slot: `cookies` for v2, `multiValueHeaders['set-cookie']` for v1, and `headers['set-cookie']` for Lattice.

If building the request throws, the handler does not call the app: a `TypeError` produces a 400 `Invalid request`, any other error a 500, both formatted through the processor.

`streamHandle(app)` uses the non-standard `awslambda.streamifyResponse` global. It sends status/headers/cookies as `HttpResponseStream` metadata and pipes the `ReadableStream` body into the Node stream; errors are logged and written as `Internal Server Error` before the stream is ended. Note the env key is `context` here rather than `lambdaContext`.

### Lambda@Edge

`handle(app)` converts the CloudFront record into a `Request` and passes `{ event, context, callback, config, request, response }` as env. Handlers may call `c.env.callback(err, result)` (for example to forward the *request* to the origin); the first callback invocation is captured and wins over the Hono response — a callback error is thrown, a callback result is returned as-is. Otherwise the `Response` is turned into a CloudFront result; the body is base64-encoded unless the content type is textual (`text/plain|html|css|javascript|csv`, `application/*json`, `application/*xml`, `image/svg+xml`) and there is no non-`identity` `Content-Encoding`. Unlike `hono/aws-lambda`, this check is not configurable.

## Connection info (`getConnInfo`)

All adapters implement the `GetConnInfo` contract from `hono/conninfo` (`(c) => ConnInfo` where `ConnInfo.remote` has optional `address`, `addressType`, `port`, `transport`). Sources differ per runtime:

- **Cloudflare Workers** — the `cf-connecting-ip` header.
- **Deno** — `c.env.remoteAddr` (hostname, port, transport) from `Deno.serve`'s handler info.
- **Bun** — `server.requestIP(c.req.raw)` where the server object is obtained by `getBunServer(c)`, which accepts either `c.env.server` or `c.env` itself (Bun passes the server as the second `fetch` argument). It throws a `TypeError` if no server or no `requestIP` is available, and returns `{ remote: {} }` when Bun returns `null` (closed request or Unix socket).
- **Lambda / Lambda@Edge / Netlify / Vercel / Pages** — values read from the event, request context, or platform headers.

`getConnInfo` is consumed by middleware such as `ipRestriction` (see [Security and Authentication Middleware](../middleware/security-and-auth.md)).

## Static files

`src/middleware/serve-static/index.ts` holds a runtime-agnostic `serveStatic` that adapters specialize by supplying `getContent(path, c)` and optionally `join` and `isDir`:

- It is a no-op (`next()`) if the context is already finalized.
- The request path is URI-decoded; any path containing `.` or `..` segments, repeated slashes, or backslashes is rejected (it calls `onNotFound` and falls through), which is the traversal guard.
- If `isDir` reports a directory, `index.html` is appended.
- A `Response` returned by `getContent` is passed through; other content gets a `Content-Type` from `getMimeType` (custom `mimes` take precedence, default `application/octet-stream`).
- With `precompressed: true` and a compressible MIME type, it probes `.br`, `.zst`, `.gz` variants in that order, limited to encodings the client lists in `Accept-Encoding`, and sets `Content-Encoding` and `Vary: Accept-Encoding`.
- `onFound` / `onNotFound` hooks run before responding or falling through.

Runtime implementations:

- **Bun** — `Bun.file(path)` (returns `null` if it doesn't exist), `node:path.join`, and `node:fs/promises.stat` for directories.
- **Deno** — `Deno.open(path).readable`, `Deno.lstatSync` for directories; non-`NotFound` errors are logged with `console.warn`.
- **Cloudflare Workers** — reads from Workers Sites KV (`__STATIC_CONTENT` binding or a `namespace` option, plus an asset `manifest`). This adapter is **deprecated** in favor of Cloudflare Static Assets.
- **Cloudflare Pages** — delegates to the `ASSETS` binding as described above.

## Extending

A new runtime adapter typically needs only: a `handle` that maps the platform's event to `Request`, calls `app.fetch(req, envObject, executionCtx)`, and maps the `Response` back; a `getConnInfo`; and, if the runtime has a file system, a `serveStatic` that supplies `getContent`/`isDir`/`join` to the base middleware. Adapter behavior is tested both in unit tests next to each adapter and in `runtime-tests/` (see [Testing, Runtime Tests, and Benchmarks](../testing/testing-strategy.md)).
