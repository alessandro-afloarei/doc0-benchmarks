---
type: subsystem
title: Built-in Middleware
description: Conventions for writing Hono middleware and a mechanism-level catalog of the bundled non-security middleware — logger, compress, etag, cache, body-limit, timeout, timing, combine, context-storage, serve-static, trailing-slash, method-override, request-id, language, pretty-json, powered-by, jsx-renderer.
tags: [middleware, compress, etag, cache, serve-static, body-limit]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-c52e34c02912599687c48998
    resource: repo://src/middleware/compress/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-ef88a825b039e386354ea111
    resource: repo://src/middleware/etag/index.ts
  - id: openwiki-source-1b54b0033c153265ad5e31a3
    resource: repo://src/middleware/language/language.ts
  - id: openwiki-source-97ee0534367259fdaa3aa719
    resource: repo://src/middleware/method-override/index.ts
  - id: openwiki-source-785846e8d46887671c6d2d0b
    resource: repo://src/middleware/request-id/request-id.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
  - id: openwiki-source-53f59c46f802917c69a0bae7
    resource: repo://src/middleware/trailing-slash/index.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Built-in Middleware

All bundled middleware lives in `src/middleware/<name>/index.ts` and is published as `hono/<name>`. Authentication and security middleware (`basic-auth`, `bearer-auth`, `jwt`, `jwk`, `cors`, `csrf`, `secure-headers`, `ip-restriction`) is described in [Authentication and Security Middleware](./security-middleware.md).

## Conventions

A middleware is `async (c, next) => { …; await next(); … }`, usually returned from a factory that takes options. Execution follows the onion model of `compose` (see [Request Lifecycle and Composition](../architecture/request-lifecycle.md)):

- **Before `next()`**: inspect the request, short-circuit by **returning** a `Response`, or throw `HTTPException`.
- **After `next()`**: read `c.res`, replace it by assigning `c.res = new Response(...)` (the setter keeps headers that were already set), or edit `c.res.headers` directly.
- Functions are given names (`async function etag(c, next)`) so that `hono/dev`'s `showRoutes` and the SSG middleware detection can identify them.
- Middleware that exposes per-request data uses `c.set()` and adds the type through module augmentation: `declare module '../..' { interface ContextVariableMap extends XVariables {} }`. Examples are `request-id`, `timing`, `language` and `jwt`.
- `createMiddleware` from `hono/factory` keeps the `Env`/`Input` types for user-written middleware (see [Helpers](../helpers/helpers.md)).

## Catalog

| Middleware | Phase | Mechanism and key behaviour |
| --- | --- | --- |
| `logger(fn = console.log)` | both | Logs `<-- METHOD path` before and `--> METHOD path STATUS elapsed` after. The status is coloured when `utils/color` detects colour support |
| `compress({ encoding?, threshold = 1024, contentTypeFilter? })` | after | Uses `CompressionStream` with gzip or deflate, picked by q-value from `Accept-Encoding`. Skips 206, HEAD, responses that already have `Content-Encoding` or `Transfer-Encoding`, small `Content-Length`, non-compressible types and `Cache-Control: no-transform`. Removes `Content-Length` and turns a strong `ETag` into a weak one |
| `etag({ weak, retainedHeaders, generateDigest })` | after | Hashes a clone of the body with SHA-1 through Web Crypto, unless an `ETag` is already set. If `If-None-Match` matches (weak comparison, or `*` for an ok GET/HEAD), it returns a 304 that keeps only `RETAINED_304_HEADERS` (cache-control, content-location, date, etag, expires, vary) |
| `cache({ cacheName, cacheControl, vary, keyGenerator, wait, cacheableStatusCodes })` | both | Uses the Web Cache API (`globalThis.caches`). If that is missing, the middleware becomes a no-op and logs a message. Only GET requests **without `Authorization`** are cached. The key is the URL, or `keyGenerator`, plus the values of the `vary` headers. Responses with `private`/`no-store`/`no-cache`, `Set-Cookie`, or a `Vary` the options do not cover are not stored. `vary: '*'` throws. The default stores through `executionCtx.waitUntil`. `wait: true` awaits the put instead, which Deno needs |
| `bodyLimit({ maxSize, onError })` | before | When only `Content-Length` is present, it trusts that header. Otherwise (chunked, or no length) it reads the whole body before the handler runs, fails as soon as the size exceeds `maxSize`, and replaces `c.req.raw` with a buffered copy. The default error is `HTTPException(413)` with the body "Payload Too Large" |
| `timeout(ms, exception?)` | around | Races `next()` against a timer that rejects with `HTTPException(504, 'Gateway Timeout')` or a custom exception. The downstream work is **not** cancelled. Only the response is replaced |
| `timing(config)` + `setMetric`/`startTime`/`endTime`/`wrapTime` | after | Builds the `Server-Timing` header, including total time by default. `crossOrigin` controls `Timing-Allow-Origin` |
| `some(...)`, `every(...)`, `except(cond, ...)` (`hono/combine`) | – | Combine middleware or boolean conditions. `some` stops at the first success, `every` requires all to pass, `except` skips the middleware when a path pattern or condition matches |
| `contextStorage()` + `getContext()`/`tryGetContext()` | around | Runs the rest of the chain inside `AsyncLocalStorage` from `node:async_hooks`, so code without access to `c` can still reach the Context. The runtime must support `node:async_hooks` |
| `serveStatic` (core) | before | Runtime-neutral. Adapters inject `getContent`, `join` and `isDir` (see [Runtime Adapters](../integrations/runtime-adapters.md)). Skips if the response is already finalized. Rejects decoded paths containing `.`/`..` segments, repeated slashes or backslashes, which blocks traversal. Serves `index.html` for directories. Sets the MIME type (`options.mimes` override) and serves `.br`/`.zst`/`.gz` variants when `precompressed` is set. `onFound`/`onNotFound` hooks are available, and `next()` is called if the file is missing |
| `trimTrailingSlash` / `appendTrailingSlash({ alwaysRedirect, skip })` | after or before | Redirects with 301 on GET/HEAD. By default this only happens when the route 404s. `alwaysRedirect` redirects before routing |
| `methodOverride({ app, form \| header \| query })` | before | For non-GET requests, reads the override method from the `_method` form field (default), a header or a query parameter, and **re-dispatches** a rebuilt request through `app.fetch(request, c.env, executionCtx)` |
| `requestId({ headerName = 'X-Request-Id', limitLength = 255, generator = randomUUID })` | before | Reuses the incoming ID only if it is short enough and matches `[\w\-=]`. Otherwise it generates one. Sets `c.var.requestId` and the response header |
| `languageDetector(options)` | before | Detects the language in order: query `lang`, cookie, `Accept-Language` header, with optional path detection. Caches the result in a cookie, falls back to `en`, and sets `c.var.language` |
| `prettyJSON({ space = 2, query = 'pretty', force })` | after | Re-serialises JSON responses with indentation when `?pretty` is present |
| `poweredBy({ serverName = 'Hono' })` | after | Sets `X-Powered-By` |
| `jsxRenderer(Layout, options)` | before | Installs `c.setRenderer`. See [JSX Runtime](../jsx/jsx-runtime.md) |

## Ordering consequences

- Post-processing runs in **reverse** registration order. With `app.use(etag()); app.use(compress())`, `compress` finishes first and `etag` then hashes the compressed body. With the reverse order, `etag` runs on the uncompressed body, and `compress` weakens the resulting strong ETag.
- `bodyLimit` must run before anything that reads the body, including validators.
- `timeout` only bounds the time to the response. Long-running handlers keep running, so use `c.req.raw.signal` or your own cancellation where it matters.
- `cache` skips requests with `Authorization`, so authenticated responses are never shared across users.

## Tests

Every middleware has a co-located `index.test.ts`. Examples are `compress/index.test.ts` (encoding negotiation, skip rules), `etag/index.test.ts` (304 header retention), `body-limit/index.test.ts` (chunked vs content-length paths), and `serve-static/index.test.ts` / `path.test.ts` (traversal rejection). Runtime-specific static serving is covered in `runtime-tests/{bun,deno}`.
