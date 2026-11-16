---
type: reference
title: Request/Response Middleware
description: Behavior and pitfalls of Hono's built-in non-auth middleware — bodyLimit, cache, compress, etag, logger, timing, timeout, requestId, prettyJSON, methodOverride, trailing-slash, poweredBy, languageDetector, contextStorage, plus pointers to combine, serveStatic and jsxRenderer.
tags: [middleware, cache, compress, etag, logger, timing, timeout, body-limit]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
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
  - id: openwiki-source-935647e291bef93e8944d361
    resource: repo://src/middleware/logger/index.ts
  - id: openwiki-source-97ee0534367259fdaa3aa719
    resource: repo://src/middleware/method-override/index.ts
  - id: openwiki-source-785846e8d46887671c6d2d0b
    resource: repo://src/middleware/request-id/request-id.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
  - id: openwiki-source-9adc4d1bf2d0eec0fe711cf5
    resource: repo://src/middleware/timing/timing.ts
  - id: openwiki-source-53f59c46f802917c69a0bae7
    resource: repo://src/middleware/trailing-slash/index.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Request/Response Middleware

All built-in middleware live in `src/middleware/<name>/` and are published as `hono/<name>`. They are ordinary `(c, next)` functions that run inside the [compose chain](../core/middleware-composition.md); most of them act **after** `await next()` by inspecting or replacing `c.res` (whose setter preserves previously set headers — see [Context](../core/context.md)). Authentication and security middleware are on a separate page: [Security and Authentication Middleware](security-and-auth.md).

Pages elsewhere cover `combine` (`some`/`every`/`except`) in [Middleware Composition](../core/middleware-composition.md), the base `serveStatic` in [Runtime Adapters](../adapters/runtime-adapters.md#static-files), and `jsxRenderer` in [JSX Server Rendering](../jsx/server-rendering.md).

## Body and payload

### `bodyLimit({ maxSize, onError? })`

- Requests without a body pass through.
- If `Content-Length` is present **and** `Transfer-Encoding` is not, the declared length is compared to `maxSize` without reading the body.
- Otherwise (chunked or no length) the body stream is read chunk by chunk; exceeding `maxSize` aborts immediately. The buffered chunks are then re-wrapped into a new `ReadableStream` and `c.req.raw` is replaced so downstream code can still read the body.
- Default error: throws `HTTPException(413)` with a `Payload Too Large` response; a custom `onError(c)` can return its own response.

### `methodOverride({ app, form? | header? | query? })`

Lets HTML forms or clients tunnel methods through POST. Non-GET requests are inspected (default: form field `_method` for `multipart/form-data` and `application/x-www-form-urlencoded`; alternatively a header or query parameter). When an override is found, a new `Request` with the new method (and the override field/header/param removed) is dispatched **through `app.fetch` again**, so routing restarts from the top; the original request continues with `next()` otherwise.

## Caching and conditional responses

### `cache({ cacheName, wait?, cacheControl?, vary?, keyGenerator?, cacheableStatusCodes?, onCacheNotAvailable? })`

Uses the Web Cache API (`globalThis.caches`, e.g. Cloudflare Workers, Deno).

- If `caches` is missing, the middleware becomes a no-op (logs once unless `onCacheNotAvailable` is `false` or a callback).
- Only `GET` requests **without an `Authorization` header** are considered. The key is `c.req.url` (or `keyGenerator(c)`), extended with `::<header>=<value>` for each configured `vary` header.
- A hit returns a fresh `Response` from the cache. On a miss, after `next()`, only `cacheableStatusCodes` (default `[200]`) are stored. Configured `Cache-Control` directives are appended if not already present, and `Vary` is merged.
- Responses are **not stored** when they have `Set-Cookie`, a `Cache-Control` with `private`/`no-store`/`no-cache`, or a `Vary` header naming something not covered by the middleware's `vary` option. Configuring `vary: '*'` throws at setup.
- Storage uses `c.executionCtx.waitUntil(cache.put(...))` unless `wait: true` (required on Deno, where there is no execution context).

### `etag({ weak?, retainedHeaders?, generateDigest? })`

After `next()`, uses an existing `ETag` or computes one by hashing a clone of the body (default SHA-1 via `crypto.subtle`; skipped if unavailable). If `If-None-Match` matches (weak comparison; `*` matches successful GET/HEAD), the response becomes `304 Not Modified` keeping only `RETAINED_304_HEADERS` (`cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`) or the configured list.

### `compress({ encoding?, threshold?, contentTypeFilter? })`

Compresses with the Web `CompressionStream` (`gzip` or `deflate`), negotiating with `Accept-Encoding` q-values (q=1 wins immediately, `*` applies as a fallback). It skips: `206` responses, responses already carrying `Content-Encoding` or `Transfer-Encoding`, `HEAD` requests, bodies with `Content-Length` below `threshold` (default 1024 bytes), non-compressible content types (default `COMPRESSIBLE_CONTENT_TYPE_REGEX`), and `Cache-Control: no-transform`. On compression it removes `Content-Length`, sets `Content-Encoding`, and **weakens a strong `ETag`** to `W/…` — so place `etag()` before/outside `compress()` with that in mind.

## Observability

### `logger(fn = console.log)`

Prints `<-- METHOD /path?query` on entry and `--> METHOD /path?query STATUS 12ms` after `next()` (seconds when ≥ 1000 ms; thousands separated). Status codes are colorized by class when color is enabled (`getColorEnabledAsync`, honoring `NO_COLOR`).

### `timing(options)` + `setMetric` / `startTime` / `endTime` / `wrapTime`

Implements the `Server-Timing` header. The middleware stores `{ headers, timers }` in `c.var.metric` (and is a no-op if a metric store already exists, so it can be registered twice safely), measures `total` by default, auto-ends unfinished timers, and appends `Server-Timing` if `enabled` (boolean or `(c) => boolean`). `crossOrigin` adds `Timing-Allow-Origin`. Helper functions warn instead of throwing when `timing()` is not installed.

### `requestId({ headerName = 'X-Request-Id', limitLength = 255, generator = crypto.randomUUID })`

Reuses an incoming request id only if it is ≤ `limitLength` and contains only `[A-Za-z0-9_\-=]`; otherwise generates one. The id is exposed as `c.var.requestId` and echoed in the response header (unless `headerName` is empty).

## Control flow and shaping

### `timeout(duration, exception?)`

Races `next()` against a timer that rejects with an `HTTPException` (default `504 Gateway Timeout`, or a function of the context). The timer is cleared afterwards. It does **not** cancel the downstream work — the handler keeps running after the timeout response is produced.

### `trimTrailingSlash({ alwaysRedirect? })` / `appendTrailingSlash({ alwaysRedirect?, skip? })`

By default they act only when the downstream result is **404** for a `GET`/`HEAD`, then redirect (301) to the path without/with the trailing slash. With `alwaysRedirect: true` they redirect up front, before routing. Use with `strict: true` (the default) on the app.

### `prettyJSON({ space = 2, query = 'pretty', force? })`

When `?pretty` is present (or `force`), re-serializes `application/json` responses with indentation.

### `poweredBy({ serverName = 'Hono' })`

Sets `X-Powered-By` after `next()`.

### `languageDetector(options)` (`hono/language`)

Detects the locale from (default order) query `lang`, cookie `language`, and `Accept-Language` (path segment detection optional), normalizes against `supportedLanguages` (case-insensitive by default), falls back to `fallbackLanguage` (`en`, which must be in `supportedLanguages`), optionally caches the result in a cookie, and exposes it as `c.var.language`.

### `contextStorage()` + `getContext()` / `tryGetContext()`

Runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` (imported from `node:async_hooks`), so code without access to `c` can call `getContext()` (throws `Context is not available` outside) or `tryGetContext()` (returns `undefined`). Requires a runtime with `AsyncLocalStorage` (Node, Bun, Deno, Workers with `nodejs_compat`).

## Tests

Each middleware has `index.test.ts` next to it; Cache API behavior is additionally exercised in the Deno and workerd runtime tests (see [Testing, Runtime Tests, and Benchmarks](../testing/testing-strategy.md)).
