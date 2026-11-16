---
type: reference
title: Built-in middleware
description: Conventions shared by Hono's bundled middleware (before/after next(), c.res replacement, HTTPException failures, ContextVariableMap augmentation) and behavior of the general-purpose ones — logger, timeout, body-limit, compress, etag, cache, combine (some/every/except), context-storage, request-id, trailing-slash, jsx-renderer, pretty-json, timing, language, method-override, powered-by.
tags: [middleware, compress, etag, cache, logger, timeout, combine, jsx-renderer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-7c59a56e01962fdd144c8972
    resource: repo://src/middleware/combine/index.ts
  - id: openwiki-source-c52e34c02912599687c48998
    resource: repo://src/middleware/compress/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-ef88a825b039e386354ea111
    resource: repo://src/middleware/etag/index.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-935647e291bef93e8944d361
    resource: repo://src/middleware/logger/index.ts
  - id: openwiki-source-97ee0534367259fdaa3aa719
    resource: repo://src/middleware/method-override/index.ts
  - id: openwiki-source-531e7fcadff5e9bed8bb3720
    resource: repo://src/middleware/powered-by/index.ts
  - id: openwiki-source-09c375f68ad58d1d653e136e
    resource: repo://src/middleware/request-id/index.ts
  - id: openwiki-source-785846e8d46887671c6d2d0b
    resource: repo://src/middleware/request-id/request-id.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
  - id: openwiki-source-53f59c46f802917c69a0bae7
    resource: repo://src/middleware/trailing-slash/index.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Built-in middleware

Every middleware lives in `src/middleware/<name>/index.ts` and is published as `hono/<name>`. Security-focused middleware (auth, JWT, CORS, CSRF, secure headers, IP restriction) is covered in [Security and authentication middleware](security-middleware.md). `serve-static` is covered in [Runtime adapters](../integrations/runtime-adapters.md).

## Conventions

A middleware is a factory that returns an `async (c, next) => …` function. These functions are registered with `app.use()` (see [Request lifecycle](../architecture/request-lifecycle.md)). The bundled ones follow these patterns:

- **Before / after.** Request-side work happens before `await next()`. Response-side work happens after it, reading and replacing `c.res`. Setting `c.res` keeps headers that were already on the response, except `Content-Type` (see [Context](../concepts/context-and-request.md)).
- **Short-circuit.** A middleware can return a `Response` without calling `next()`. Examples are a cache hit or a redirect.
- **Failure.** Most throw an `HTTPException`, for example `bodyLimit` (413) and `timeout` (504). The app's `onError` then turns it into a response. By default that response is `err.getResponse()`.
- **Named functions.** Most return a named function (`async function logger(c, next)`). `hono/dev`'s `showRoutes` uses that name in verbose output.
- **Typed variables.** Middleware that sets variables augments `ContextVariableMap` with `declare module`, as `request-id` does with `requestId`. This keeps `c.get()` typed without generics.
- **Authoring.** Write new middleware with `createMiddleware<Env>()` from `hono/factory` (see [Helpers](../helpers/helpers.md)) so that `Env` and response types are inferred.

## General-purpose middleware

| Middleware | Behavior |
| --- | --- |
| `logger(fn = console.log)` | Logs `<-- METHOD path` on entry and `--> METHOD path STATUS elapsed` after `next()`. The status is colored by class when color output is enabled. |
| `timeout(ms, exception?)` | Races `next()` against a timer. On expiry it rejects with `HTTPException(504, 'Gateway Timeout')` or the supplied exception or factory. The timer is always cleared. The downstream handler is **not** cancelled; it keeps running. |
| `bodyLimit({ maxSize, onError? })` | If `Content-Length` is present and `Transfer-Encoding` is absent, checks the header value. Otherwise it reads the stream, counting bytes, and aborts when the size exceeds `maxSize`. In that case it replaces `c.req.raw` with a new `Request` over the buffered chunks so the body can still be read. The default `onError` throws `HTTPException(413)` carrying a `Payload Too Large` response. |
| `compress({ encoding?, threshold = 1024, contentTypeFilter? })` | After `next()`, it skips the response when any of these hold: status is 206; `Content-Encoding` or `Transfer-Encoding` is already set; the method is HEAD; `Content-Length` is below the threshold; the content type is not compressible; or `Cache-Control: no-transform` is set. Otherwise it picks `gzip` or `deflate` from the q-values in `Accept-Encoding` (honoring `*`) and pipes the body through `CompressionStream`. It then removes `Content-Length` and weakens a strong `ETag` to `W/"..."`. |
| `etag({ weak?, retainedHeaders?, generateDigest? })` | After `next()`, computes a SHA-1 digest of a clone of the body if no `ETag` is set. A custom digest function can replace SHA-1. If `If-None-Match` matches, comparing weakly (`*` matches any OK GET or HEAD response), it replaces the response with a `304` that keeps only `RETAINED_304_HEADERS` (`cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`). |
| `cache({ cacheName, wait?, cacheControl?, vary?, keyGenerator?, cacheableStatusCodes = [200], onCacheNotAvailable? })` | Uses the Web Cache API (`caches.open`). When `globalThis.caches` is missing it becomes a pass-through. Only `GET` requests without `Authorization` are cached. The key is the URL, or `keyGenerator(c)`, plus each configured `vary` header value. A hit returns the cached response. On a miss it stores the response unless the response `Vary` names headers outside the configured `vary`, `Cache-Control` is private, no-store or no-cache, or there is a `Set-Cookie`. The store is awaited when `wait: true`; otherwise it is passed to `c.executionCtx.waitUntil`. A `vary` option containing `*` throws when the middleware is created. |
| `contextStorage()` | Runs `next` inside `AsyncLocalStorage.run(c, …)`, imported from `node:async_hooks`. Afterwards `getContext()` and `tryGetContext()` return the current `Context` from anywhere in the call stack. |
| `requestId({ headerName = 'X-Request-Id', limitLength = 255, generator = crypto.randomUUID })` | Reuses the incoming header value if it is short enough and contains only `[\w\-=]`. Otherwise it generates an ID. Sets `c.var.requestId` and echoes the header on the response. |
| `trimTrailingSlash()` / `appendTrailingSlash({ skip? })` | For GET and HEAD, issues a 301 to the canonical path. By default this happens only when the route returned 404. With `alwaysRedirect: true` it redirects before routing. |
| `jsxRenderer(Layout?, { docType, stream })` | Sets `c.setRenderer`, so `c.render(<Page/>, props)` wraps the content in the layout, adds `<!DOCTYPE html>` (override or disable with `docType`), and provides `useRequestContext()`. With `stream`, it responds with `renderToReadableStream` and chunked HTML headers. See [JSX engine](../jsx/jsx.md). |
| `prettyJSON({ space = 2, query = 'pretty', force? })` | Re-serializes JSON responses with indentation when `?pretty` is present or `force` is set. |
| `timing()` with `startTime`, `endTime`, `setMetric`, `wrapTime` | Collects metrics and appends a `Server-Timing` header. `crossOrigin` adds `Timing-Allow-Origin`. |
| `languageDetector({ order, … })` | Detects the language from `path`, `querystring`, `cookie` or `header`. The default order is querystring, then cookie, then header. Normalizes against supported languages, optionally caches the choice in a cookie, and sets `c.var.language`. |
| `methodOverride({ app, form? \| header? \| query? })` | For POST, reads the override method from the form field (default `_method`), a header, or a query parameter. It rebuilds the `Request` and **re-dispatches it through `app.fetch`**, so the middleware needs the app instance. |
| `poweredBy({ serverName? })` | Sets `X-Powered-By` (default `Hono`). |

## Combinators (`hono/combine`)

- **`some(...mw | condition)`** tries each item in order and stops at the first that succeeds. A condition that returns `true` calls `next()`. A condition that returns `false`, or a middleware that throws, moves on to the next item. A throw that happens *after* `next()` was called is not retried. If every item fails, the last error is re-thrown.
- **`every(...mw | condition)`** runs all items through an inner `compose()`, keeping `routeIndex` fixed. A condition that returns `false` throws `Unmet condition`.
- **`except(pathOrCondition | [...], ...mw)`** skips the given middleware when the request matches one of the path patterns (matched with an internal `TrieRouter`) or one of the predicates. It is built from `some` and `every`.

These are typically used to apply auth to all routes except a few, or to accept any one of several auth schemes.

## Tests

Each middleware has an `index.test.ts` next to its source. Behavior that depends on the runtime is also checked by the suites under `runtime-tests/`; for example, `runtime-tests/node` exercises compression (see [Testing strategy](../testing/test-strategy.md)).
