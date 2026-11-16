---
type: architecture
title: Runtime Adapters
description: How Hono's runtime adapters under src/adapter translate each platform's request, event, and response shapes into the Web Standard Request/Response that Hono.fetch consumes, and which helpers each adapter exports.
tags: [hono, adapters, runtime, serverless, edge, lambda, cloudflare, deno, bun]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-8f07a0b8a762547156ba4abf
    resource: repo://src/adapter/cloudflare-workers/conninfo.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-c2bcf3576302d7f13d4dc1e5
    resource: repo://src/adapter/netlify/conninfo.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-9a62de02f61d81368f630ab0
    resource: repo://src/adapter/vercel/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Runtime Adapters

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's core speaks only Web Standards: `app.fetch(request, env, executionCtx)` takes a `Request` and returns a `Response` (see [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)). Runtime adapters live under `src/adapter/` and bridge that contract to each platform's native event model. An adapter does not own routing or middleware; it converts the inbound event, calls `app.fetch`, and converts the result back.

## Adapter inventory

| Adapter | Package export | Entry module | What it provides |
| --- | --- | --- | --- |
| Cloudflare Workers | `hono/cloudflare-workers` | `src/adapter/cloudflare-workers/index.ts` | `serveStatic` (KV-backed), `upgradeWebSocket`, `getConnInfo` |
| Cloudflare Pages | `hono/cloudflare-pages` | `src/adapter/cloudflare-pages/index.ts` | `handle`, `handleMiddleware`, `serveStatic`, `getConnInfo` |
| Deno | `hono/deno` | `src/adapter/deno/index.ts` | `serveStatic`, `toSSG`, `denoFileSystemModule`, `upgradeWebSocket`, `getConnInfo` |
| Bun | `hono/bun` | `src/adapter/bun/index.ts` | `serveStatic`, `toSSG`, `bunFileSystemModule`, `createBunWebSocket`, `upgradeWebSocket`, `websocket`, `getBunServer`, `getConnInfo` |
| AWS Lambda | `hono/aws-lambda` | `src/adapter/aws-lambda/index.ts` | `handle`, `streamHandle`, `defaultIsContentTypeBinary`, `getConnInfo` |
| Lambda@Edge | `hono/lambda-edge` | `src/adapter/lambda-edge/index.ts` | `handle`, `getConnInfo` |
| Vercel | `hono/vercel` | `src/adapter/vercel/index.ts` | `handle`, `getConnInfo` |
| Netlify | `hono/netlify` | `src/adapter/netlify/index.ts` | `handle`, `getConnInfo` |
| Service Worker | `hono/service-worker` | `src/adapter/service-worker/index.ts` | `handle`, `fire` |

The `package.json` `exports` map points each `hono/<adapter>` subpath at `dist/adapter/<adapter>/index.js` (and `dist/cjs/...` for `require`). The `hono/conninfo`, `hono/adapter`, and `hono/ws` subpaths are not adapters: they resolve to `helper/conninfo`, `helper/adapter`, and `helper/websocket` respectively. Serve-static for Node-style runtimes is exposed as `hono/serve-static` from the middleware tree, not from an adapter directory. No Fastly adapter exists in this source tree; Fastly appears only as a `Runtime` key in the runtime detection helper (see below).

## The common shape

Most adapters follow the same three-step pattern:

1. **Translate the inbound event into a `Request`.** AWS Lambda builds a request from a processor chosen per event type (API Gateway v1 and v2, ALB, VPC Lattice). Lambda@Edge rebuilds a request from the CloudFront `Records[0].cf.request`.
2. **Call `app.fetch` with platform data as the second argument.** The `env` / `executionCtx` slots are used to pass platform objects through to handlers and middleware. Lambda passes `{ event, requestContext, lambdaContext }`; Lambda@Edge passes `{ event, context, callback, config, request, response }`; the service worker passes `{}` as env and the `FetchEvent` as the execution context; Cloudflare Pages spreads the Pages environment bindings and adds `eventContext` into env, and passes `waitUntil`, `passThroughOnException`, and `props` as the execution context.
3. **Translate the `Response` back** into the platform's result shape. For Lambda this is `processor.createResult(event, res, { isContentTypeBinary })`, which encodes the body to base64 when the content type is binary.

The Vercel handler is the thinnest: `handle(app)` returns `(req) => app.fetch(req)`, so no platform environment is passed through.

### Bridging examples

- **AWS Lambda** (`src/adapter/aws-lambda/handler.ts`, `handle`, lines 239-276): if building the request throws, the adapter returns a 400 for `TypeError` or a 500 otherwise, without calling the app. On success it calls `app.fetch(req, { event, requestContext, lambdaContext })` and returns `processor.createResult(...)`. `streamHandle` is the streaming variant that writes to a Node stream instead of buffering the body.
- **Service worker** (`src/adapter/service-worker/handler.ts`, lines 18-35): `handle(app, opts)` returns a fetch-event listener that calls `evt.respondWith`. If the app returns `404` and an `opts.fetch` is configured (default: the bound global `fetch`), the request falls through to the network. This lets a Hono app sit in front of existing static assets.
- **Lambda@Edge** (`src/adapter/lambda-edge/handler.ts`, `handle`, lines 116-141): the adapter forwards the CloudFront-specific fields (`event`, `config`, `request`, `response`) into `env`, and wraps the caller's `callback` so the first error or result is recorded inside the adapter while every invocation is still forwarded to the original callback.

## Shared pieces

- **`getConnInfo`** is exported from every adapter. Each implementation reads the platform's client address from wherever that platform exposes it and returns the `ConnInfo` shape used by `hono/conninfo`: Cloudflare Workers reads the `cf-connecting-ip` header, Deno reads `remoteAddr` from `c.env`, Netlify reads `c.env.context.ip`, and AWS Lambda reads the API Gateway identity `sourceIp` from `c.env.requestContext`.
- **Static files and SSG.** Deno and Bun provide `serveStatic` and `toSSG` (static site generation). `toSSG` delegates to the base `helper/ssg` implementation with a runtime-specific `FileSystemModule` (`denoFileSystemModule` / `bunFileSystemModule`). Cloudflare Workers serves assets from KV via `getContentFromKVAsset` in `src/adapter/cloudflare-workers/utils.ts`.
- **WebSockets.** Deno, Cloudflare Workers, and Bun each export an `upgradeWebSocket` helper built on the platform's native WebSocket upgrade. Bun additionally requires registering the `websocket` handler object with the server.

## Runtime detection

`src/helper/adapter/index.ts` contains `getRuntimeKey()`, which returns one of `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light`, or `other`. It checks `navigator.userAgent` against known strings (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`) before falling back to global feature checks. The `env(c, runtime?)` helper uses this key to read environment variables from the correct source: `process.env` on Node, Bun, and edge-light, `Deno.env` on Deno, `c.env` bindings on workerd, and an empty object otherwise. Passing an explicit `runtime` argument skips detection.

## Extension seams and consequences

<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Adding a platform means implementing `handle` (event to `Request`, `app.fetch`, result back) and the per-platform `getConnInfo`, then adding an exports entry in both `package.json` and `jsr.json`; the build validates that the two maps agree (see [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)).
- Adapter handlers do not catch application errors; the app's `errorHandler` produces the response, and only failures before `app.fetch` (such as malformed Lambda events) are handled inside the adapter.
- Binary bodies are a platform concern. Lambda's `isContentTypeBinary` option controls base64 encoding, and `defaultIsContentTypeBinary` is exported so callers can extend it.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md)
