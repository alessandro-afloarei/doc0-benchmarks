---
type: concept
title: Runtime Adapters and Platform Entrypoints
description: How a Hono app object is attached to each supported runtime (Cloudflare Workers and Pages, Deno, Bun, AWS Lambda, Lambda@Edge, Vercel, Netlify, service workers), what each entrypoint passes into app.fetch, and which platform helpers (getConnInfo, serveStatic, toSSG, WebSocket upgrades) ship alongside them.
tags: [adapters, runtimes, cloudflare, deno, bun, aws-lambda, vercel, netlify, service-worker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-883edce3e8ab890035f6e626
    resource: repo://src/adapter/cloudflare-pages/handler.ts
  - id: openwiki-source-af2b0b047cc3f1d6127abba9
    resource: repo://src/adapter/lambda-edge/handler.ts
  - id: openwiki-source-7812a9a6971be6b7cb74d7db
    resource: repo://src/adapter/service-worker/handler.ts
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Runtime Adapters and Platform Entrypoints

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's core is written against Web Standards: `app.fetch(request, env, executionCtx)` takes a `Request` and returns a `Response` (or a promise of one). Every platform adapter is therefore a thin shim that (1) converts the platform's native event into a `Request`, (2) calls `app.fetch` with the platform's bindings or context in the environment slot, and (3) converts the resulting `Response` back into the platform's expected return shape. Adapters do not own routing, middleware, or response semantics; those live in the core described in [Architecture Overview](/openwiki/architecture/overview.md) and [Request Lifecycle](/openwiki/architecture/request-lifecycle.md).

## Adapter Inventory

Each adapter lives under `src/adapter/<platform>/` and is published as its own subpath export (for example `hono/bun`, `hono/aws-lambda`), as declared in the `exports` map of `package.json`.

| Adapter | Source | Entry shape | What the adapter adds |
| --- | --- | --- | --- |
| Cloudflare Workers | `src/adapter/cloudflare-workers/index.ts` | Adapter exports helpers only; the app object is used as the Worker module's default export | `serveStatic` (module-based assets), `upgradeWebSocket`, `getConnInfo` |
| Cloudflare Pages | `src/adapter/cloudflare-pages/handler.ts` | `handle(app)` returns a `PagesFunction` | `handleMiddleware`, `serveStatic`, `getConnInfo`, `EventContext` types |
| Deno | `src/adapter/deno/index.ts` | Adapter exports helpers only; the app is served through Deno's own server API | `serveStatic` (filesystem), `toSSG` with `denoFileSystemModule`, `upgradeWebSocket`, `getConnInfo` |
| Bun | `src/adapter/bun/index.ts` | Adapter exports helpers only; the app is served through `Bun.serve` | `serveStatic`, `toSSG` with `bunFileSystemModule`, `createBunWebSocket`/`websocket`, `getBunServer`, `getConnInfo` |
| AWS Lambda | `src/adapter/aws-lambda/index.ts` | `handle(app)` returns an API Gateway/ALB-style handler | `streamHandle`, `defaultIsContentTypeBinary`, `getConnInfo` |
| Lambda@Edge | `src/adapter/lambda-edge/index.ts` | `handle(app)` for CloudFront events | `getConnInfo`, CloudFront event types |
| Vercel | `src/adapter/vercel/index.ts` | `handle(app)` returns `(req: Request) => app.fetch(req)` | `getConnInfo` |
| Netlify | `src/adapter/netlify/index.ts` | `handle(app)` passes the Netlify `context` through `app.fetch` | `getConnInfo` |
| Service Worker | `src/adapter/service-worker/index.ts` | `fire(app)` registers a `fetch` listener | Fallback to the global `fetch` on 404 |

Two targets that appear in the runtime matrix do not have an adapter directory under `src/adapter/`: the Node.js target is exercised in `runtime-tests/node` and the Fastly Compute target in `runtime-tests/fastly`, which build the app through their own tooling. Helper-level runtime detection (see below) still recognizes `node` and `fastly`.

## Common Shape: Passing Platform Context Into `app.fetch`

Each adapter chooses what to pass as the second and third arguments of `app.fetch`. These become the Context environment (`c.env`) and execution context (`c.executionCtx`) that handlers see:

- **Cloudflare Pages** spreads the Pages `env` bindings and attaches the raw `eventContext` under a key, and forwards `waitUntil` and `passThroughOnException` as the execution context. This is why `handleMiddleware` can read the original Pages event when needed.
- **AWS Lambda** calls `app.fetch(req, { event, requestContext, lambdaContext })`, so bindings include the raw API Gateway or ALB event, the request context, and the Lambda context.
- **Lambda@Edge** calls `app.fetch(createRequest(event), { event, context, callback, config, request, response })`, exposing the CloudFront event pieces as bindings.
- **Netlify** calls `app.fetch(req, { context })`.
- **Service Worker** calls `app.fetch(evt.request, {}, evt)`, passing the `FetchEvent` in the execution-context slot.
- **Vercel** calls `app.fetch(req)` with no extra bindings.

Because bindings are untyped at this layer, application code typically declares its binding shape via the `Bindings` type parameter of `Hono<{ Bindings: ... }>` and reads it through `c.env`.

## Request Translation and Error Mapping

Lambda is the most involved adapter because it accepts several event shapes. `getProcessor(event)` selects an `EventProcessor` subclass for the event (ALB, API Gateway v1, HTTP API v2, or Lattice v2). The processor builds the `Request` from path, method, query string, headers, and body (decoding base64 when `isBase64Encoded` is set), and later converts the `Response` back to the event's result format, including multi-value headers and cookies. If translation throws before `app.fetch` runs, the adapter returns its own response: a `TypeError` maps to `400 Invalid request`, and any other error maps to `500 Internal Server Error`. `defaultIsContentTypeBinary` and the `isContentTypeBinary` option decide whether a body is returned base64-encoded.

Lambda also exports `streamHandle`, which writes the response body through a Node writable stream instead of buffering it. Use it when responses are streamed; the buffered `handle` remains the default.

The Service Worker `handle` is the only adapter that falls back to network fetch: when the app returns `404` and `opts.fetch` is set, the original request is forwarded to `fetch`. The default `opts` binds `globalThis.fetch`.

## Platform Helpers

- **`getConnInfo`** is exported by most adapters so that `hono/conninfo` can read the client address from runtime-specific sources. The Cloudflare Workers implementation reads only `cf-connecting-ip` from request headers.
<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`serveStatic`** comes in several variants, each specialized to its runtime's storage. Bun wraps the shared static-file middleware with a `Bun.file`-based `getContent` and a `node:fs` directory check. Deno uses its own file-open and directory-stat functions with the same shared middleware. The Cloudflare Workers variant forwards its options to the shared middleware and accepts an optional KV `namespace`; its ES-module form omits that option. Cloudflare Pages `serveStatic` is not a file server: it forwards the request to the Pages `ASSETS` binding and converts a `404` into `c.notFound()`. The shared middleware is documented in [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md).
<!-- openwiki: broken internal link [/openwiki/helpers/static-site-generation.md] link "/openwiki/helpers/static-site-generation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`toSSG`** for Deno and Bun pairs a file-system module with the static-site generator in [Static Site Generation (SSG) Helper](/openwiki/helpers/static-site-generation.md).
- **WebSockets** are provided through `upgradeWebSocket`, which uses runtime-native upgrade mechanisms. Bun additionally requires the `websocket` handler object to be passed to `Bun.serve`, and `createBunWebSocket` produces the typed pair.
- **Runtime detection** is handled by `src/helper/adapter/index.ts`. `getRuntimeKey()` checks the user agent (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then the `EdgeRuntime` global (`edge-light`), a Fastly global, and finally `process.release.name`. The `env(c, runtime?)` helper uses that key to read environment variables from `process.env`, `Deno.env`, or `c.env` (for `workerd`). Fastly returns an empty object because its configuration store is not exposed through this helper.

## Invariants and Failure Behavior

- The adapters do not add their own error handler around `app.fetch`: errors raised inside the app are routed through the app's `onError` handler by the core dispatch path. Adapter-level catches exist only around event translation (Lambda, which returns `400` or `500` as described above) and around the Service Worker `fetch` fallback.
- The Service Worker adapter falls back to the network only when the app itself returns `404`; any other status is returned to the client unchanged.

## Extension Seams

<!-- openwiki: broken internal link [/openwiki/operations/build-and-packaging.md] link "/openwiki/operations/build-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
To support a new platform, follow the existing pattern: write a `handle(app)` function that converts the native event to a `Request`, calls `app.fetch` with a suitable environment and execution context, and converts the response back. Add a subpath export in `package.json` and `jsr.json`, and extend the runtime matrix in `runtime-tests` so behaviors are checked on the real platform. See [Build and Packaging](/openwiki/operations/build-and-packaging.md) for how new entry points are discovered and validated.

## Related Tests

- `runtime-tests/workerd`, `runtime-tests/lambda`, `runtime-tests/lambda-edge`, `runtime-tests/deno`, `runtime-tests/bun`, `runtime-tests/node`, and `runtime-tests/fastly` exercise these adapters against their actual runtimes.
- Colocated unit tests such as `src/adapter/bun/server.test.ts`, `src/adapter/cloudflare-workers/serve-static.test.ts`, `src/helper/adapter/index.test.ts`, and `src/adapter/service-worker` coverage verify translation and detection logic without starting a platform.

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
See [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md) for how these suites are run.
