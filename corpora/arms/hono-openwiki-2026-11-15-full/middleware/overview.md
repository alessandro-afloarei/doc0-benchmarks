---
type: subsystem
title: Built-in Middleware
description: Catalog of Hono's built-in middleware in src/middleware with the behaviors that matter in practice — serve-static, compress, etag, cache, body-limit, timeout, logger, timing, request-id, trailing-slash, method-override, combine (some/every/except), context-storage and others — plus conventions for writing new middleware.
tags: [middleware, caching, compression, static-files, combine]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
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
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Built-in Middleware

Every built-in middleware lives in `src/middleware/<name>/index.ts`, is exported as `hono/<name>`, and is a **factory**: `app.use(cors({...}))`. All of them follow the onion model described in [Request Lifecycle](../architecture/request-lifecycle.md#compose): work before `await next()` runs on the way in, work after it can inspect and replace `c.res`. Security-related middleware (auth, JWT, CORS, CSRF, secure headers, IP restriction) is covered in [Security and Authentication Middleware](security-and-auth.md); `jsx-renderer` is in [Server JSX](../jsx/server-jsx.md#jsx-renderer-middleware).

## Catalog

| Middleware | Phase | Summary |
| --- | --- | --- |
| `serve-static` | before | Runtime-neutral static file server; wrapped by adapters. |
| `compress` | after | gzip/deflate via `CompressionStream`. |
| `etag` | after | Generates/validates ETags, returns 304. |
| `cache` | both | Cache API (`caches.open`) response caching. |
| `body-limit` | before | Rejects bodies larger than `maxSize` with 413. |
| `timeout` | around | Races `next()` against a timer; 504 by default. |
| `logger` | both | Logs `<-- METHOD path` and `--> METHOD path status time`. |
| `timing` | both | `Server-Timing` header with `startTime`/`endTime`/`setMetric`. |
| `request-id` | before | Sets/propagates `X-Request-Id`, exposes `c.var.requestId`. |
| `trailing-slash` | after/before | `trimTrailingSlash` / `appendTrailingSlash` 301 redirects. |
| `method-override` | before | Re-dispatches POST requests with `_method` (form), header or query. |
| `combine` | – | `some`, `every`, `except` combinators. |
| `context-storage` | around | `AsyncLocalStorage` access to `c` via `getContext()`. |
| `language` | before | Detects language (default order: query string, cookie, header; path detection optional) and can cache it in a cookie. |
| `pretty-json` | after | Pretty-prints JSON when `?pretty` is present. |
| `powered-by` | after | Adds `X-Powered-By`. |
| `jsx-renderer` | before | Sets `c.render` with a layout (see Server JSX). |

## Behavior notes

### serve-static (runtime-neutral core)

`serveStatic({ getContent, join?, isDir?, root, path, rewriteRequestPath, mimes, precompressed, onFound, onNotFound })` (`src/middleware/serve-static/index.ts`) is not used directly; [runtime adapters](../integrations/runtime-adapters.md) supply `getContent` (and `join`/`isDir`).

- Skips entirely if a previous handler already finalized the response.
- Decodes the request path and **rejects traversal**: any `.`/`..` segment, repeated slashes, or backslashes cause `onNotFound` + `next()`.
- Directories resolve to `index.html` when `isDir` reports a directory.
- `Content-Type` comes from the extension (`getMimeType`, overridable by `mimes`), defaulting to `application/octet-stream`.
- With `precompressed: true` and a compressible type, it looks for `.br`, `.zst`, `.gz` siblings in that order (filtered by `Accept-Encoding`) and sets `Content-Encoding` and `Vary: Accept-Encoding`.
- If `getContent` returns a `Response`, it is returned as-is; when nothing is found, `onNotFound` runs and `next()` continues to later routes.

### compress

Runs after `next()` and skips when the status is 206, `Content-Encoding` or `Transfer-Encoding` is already set, the request is `HEAD`, `Content-Length` is below `threshold` (default 1024 bytes), the content type is not compressible (`COMPRESSIBLE_CONTENT_TYPE_REGEX` or a custom `contentTypeFilter`), or `Cache-Control: no-transform` is set. Encoding is chosen by `Accept-Encoding` q-values (including `*`) among `gzip`/`deflate` or the single configured encoding. It removes `Content-Length` and weakens strong ETags (`W/`), since compressed bytes differ.

### etag

After `next()`, uses an existing `ETag` header or computes a SHA-1 digest of the cloned body via Web Crypto (custom `generateDigest` allowed; `weak: true` emits `W/"..."`). If `If-None-Match` matches (weak comparison; `*` matches successful GET/HEAD), the response becomes `304 Not Modified` keeping only `retainedHeaders` (default `cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`). If Web Crypto is unavailable and no ETag exists, it does nothing.

### cache

Uses the Cache API, so it only works where `globalThis.caches` exists (Workers, Deno); elsewhere it becomes a pass-through and logs a message (configurable via `onCacheNotAvailable`).

- Only `GET` requests **without `Authorization`** are cached.
- Key = URL (or `keyGenerator(c)`) plus `::header=value` for every configured `vary` header. `vary: '*'` throws at setup.
- Only `cacheableStatusCodes` (default `[200]`) are stored; `cacheControl` directives and `Vary` are merged into the response. Responses whose own `Vary` includes headers not covered by the config are not cached.
- Storage happens through `c.executionCtx.waitUntil(cache.put(...))`, or awaited when `wait: true` (required on Deno).

### body-limit

Passes through requests without a body. If only `Content-Length` is present, it is trusted. If `Transfer-Encoding` is present or no length header exists, the body is **read up front** in chunks; exceeding `maxSize` triggers `onError` (default: throws an `HTTPException(413)` with `Payload Too Large`). The buffered chunks are re-wrapped into a new `c.req.raw` so the handler can still read the body.

### timeout

`timeout(ms, exception?)` races `next()` with a timer that rejects with `HTTPException(504, 'Gateway Timeout')` or a custom exception (or factory of `c`). The timer is cleared afterwards. The downstream work is not cancelled — it simply loses the race.

### request-id

Reuses the incoming `X-Request-Id` (configurable `headerName`) only if it is at most `limitLength` (255) characters and contains only `[A-Za-z0-9_\-=]`; otherwise generates `crypto.randomUUID()` (configurable `generator`). The ID is set on `c.var.requestId` and the response header.

### trailing-slash

`trimTrailingSlash()` and `appendTrailingSlash()` redirect with 301 only when the route resulted in a 404 (checked after `next()`) for `GET`/`HEAD`; with `alwaysRedirect: true` they redirect before routing (useful with wildcard routes). `appendTrailingSlash` also accepts a `skip(path)` predicate.

### method-override

`methodOverride({ app, form | header | query })` intercepts non-GET requests and, if an override value is present (default form field `_method`), builds a new `Request` with that method (removing the override field from the body) and re-dispatches it through `app.fetch(request, c.env, executionCtx)`. It must therefore be given the app instance.

### combine

`hono/combine` composes middleware or boolean conditions:

- `some(...m)` – tries each in order and stops at the first success; a condition returning `false` counts as failure; if all fail, the last error is thrown (e.g. "No successful middleware found"). Errors thrown after `next()` was already called are not retried.
- `every(...m)` – runs all via `compose()`; a condition returning `false` throws `Unmet condition`. `routeIndex` is pinned so params stay correct.
- `except(condition | path | [...], ...m)` – skips the middleware when any condition matches; string conditions are path patterns matched with a `TrieRouter`.

Typical use: `some(bearerAuth(...), ipRestriction(...))` for alternative auth methods.

### context-storage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` (imports `node:async_hooks`, so it requires a runtime that provides it). `getContext()` returns the current context (throwing if none) and `tryGetContext()` returns `undefined`, letting non-handler code access `c.env`/`c.var`.

## Writing middleware

- Use `createMiddleware<{ Variables: {...} }>(async (c, next) => { ... })` from `hono/factory` to type variables and bindings (see [Helpers](../helpers/overview.md#factory) and [Type System](../concepts/type-system.md)).
- Always `await next()` (calling it twice throws). Return a `Response` to short-circuit.
- To change a downstream response, assign `c.res = new Response(...)`; returning a response after `next()` is ignored once the context is finalized. Headers set with `c.header()` before `next()` are carried over to the final response (see [Context](../architecture/context-and-request.md#header-and-response-mutation-rules)).
- Throw `HTTPException` for HTTP-level failures so the app's `onError` can format them.
- Middleware that should run for all routes must be registered **before** the routes, because execution follows registration order.
- New middleware needs a subpath entry in both `package.json` and `jsr.json` (see [Build and Packaging](../operations/build-and-packaging.md)).

## Tests

Each middleware has `index.test.ts` beside it, run in the `main` Vitest project. The cache tests stub `globalThis.caches` with `vi.stubGlobal`, and the adapter-specific `serveStatic` wrappers are exercised in `runtime-tests/*`.
