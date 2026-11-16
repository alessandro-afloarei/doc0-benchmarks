---
title: "Response Middleware"
---
## Overview

These built-in middleware do their work after `await next()`, when the handler's response is in `c.res`. Because `compose` ignores a value a middleware returns once the context is finalized, every one of them changes the response by assigning `c.res` or by editing `c.res.headers` ([[Request Lifecycle and Middleware Composition]]). Assigning `c.res` copies the old response's headers onto the new one ([[Context]]).

Sources: [src/compose.ts:67-71](repo://src/compose.ts#L67-L71), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

| Middleware | Import | Changes |
| --- | --- | --- |
| `compress` | `hono/compress` | body piped through `CompressionStream`, `Content-Encoding` set |
| `etag` | `hono/etag` | `ETag` header, or a `304 Not Modified` |
| `cache` | `hono/cache` | serves from and stores into the Cache API |
| `prettyJSON` | `hono/pretty-json` | re-serializes JSON bodies with indentation |
| `poweredBy` | `hono/powered-by` | `X-Powered-By` header |
| `logger` | `hono/logger` | nothing; prints request and response lines |
| `timing` | `hono/timing` | `Server-Timing` and optionally `Timing-Allow-Origin` |

Sources: [package.json:94-98](repo://package.json#L94-L98), [package.json:114-118](repo://package.json#L114-L118), [package.json:134-138](repo://package.json#L134-L138), [package.json:224-248](repo://package.json#L224-L248)

Order matters when several are combined: a middleware registered earlier sees the response later. `compress` turns a strong `ETag` into a weak one, which is what `etag` produces when registered after it, since `etag` then runs before `compress` on the way out.

Sources: [src/middleware/compress/index.ts:116-120](repo://src/middleware/compress/index.ts#L116-L120), [src/compose.ts:42-56](repo://src/compose.ts#L42-L56)

## compress

`compress({ encoding, threshold, contentTypeFilter })` leaves the response alone when any of these hold: status `206`; `Content-Encoding` or `Transfer-Encoding` already present; a `HEAD` request; a `Content-Length` below `threshold` (default 1024 bytes); a content type that fails the filter; or `Cache-Control: no-transform`. The default filter is `COMPRESSIBLE_CONTENT_TYPE_REGEX`, which covers text types except `text/event-stream`, JSON, XML, JavaScript, WebAssembly and other textual formats.

Sources: [src/middleware/compress/index.ts:70-102](repo://src/middleware/compress/index.ts#L70-L102), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129), [src/utils/compress.ts:6-10](repo://src/utils/compress.ts#L6-L10)

The encoding is chosen from `Accept-Encoding` among `gzip` and `deflate` (or only the configured one): an encoding with `q=1` wins immediately, otherwise the highest positive `q`, with `*` supplying the default `q`. The body is piped through `CompressionStream`, `Content-Length` is removed, and a strong `ETag` becomes weak because, as the code comment says, the compressed bytes are not identical.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

## etag

`etag({ weak, retainedHeaders, generateDigest })` reads `If-None-Match` before `next()`. Afterwards, if the response has no `ETag`, it computes one from a clone of the body. The digest is built chunk by chunk: each step hashes the previous digest followed by the next chunk, with SHA-1 through `crypto.subtle` unless a generator is given, and the result is written as hex in quotes, prefixed with `W/` when `weak` is set. Without a body or a digest function it does nothing.

Sources: [src/middleware/etag/index.ts:38-105](repo://src/middleware/etag/index.ts#L38-L105), [src/middleware/etag/digest.ts:16-43](repo://src/middleware/etag/digest.ts#L16-L43)

The request matches when `If-None-Match` lists the tag (weak and strong compared alike), or is `*` on a successful `GET` or `HEAD`. A match replaces the response with `304 Not Modified` carrying the `ETag` and only the headers in `retainedHeaders` (by default `Cache-Control`, `Content-Location`, `Date`, `ETag`, `Expires`, `Vary`); otherwise the `ETag` is set on the response.

Sources: [src/middleware/etag/index.ts:21-36](repo://src/middleware/etag/index.ts#L21-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

## cache

### Setup

`cache({ cacheName, wait, cacheControl, vary, keyGenerator, cacheableStatusCodes, onCacheNotAvailable })` uses the Web Cache API. When `globalThis.caches` is missing it logs a message (or calls `onCacheNotAvailable`, or stays silent when that is `false`) and returns a pass-through middleware. A `vary` option containing `*` throws when the middleware is created.

Sources: [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103)

### Per request

Only `GET` requests without an `Authorization` header use the cache. The key is the URL (or `keyGenerator(c)`) plus, for each `vary` header, its encoded request value. A hit returns the cached response directly. On a miss it runs the handler, then, for a cacheable status (default `200`), merges the `cacheControl` directives into `Cache-Control` without duplicating names the handler set, and merges `vary` into `Vary`.

Sources: [src/middleware/cache/index.ts:105-171](repo://src/middleware/cache/index.ts#L105-L171)

The response is not stored when it has `Set-Cookie`, when `Cache-Control` contains `private`, `no-store` or `no-cache`, or when it varies on a header not listed in the `vary` option. Otherwise a clone is stored with `cache.put`, awaited when `wait` is `true` and handed to `c.executionCtx.waitUntil` otherwise, so the default needs a runtime with an execution context.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:170-184](repo://src/middleware/cache/index.ts#L170-L184)

## prettyJSON and poweredBy

`prettyJSON({ space, query, force })` decides before `next()` whether to act: when `force` is set or the query parameter (default `pretty`) is present, even empty. After `next()`, a response whose `Content-Type` starts with `application/json` is parsed and re-serialized with `space` (default 2) spaces of indentation.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)

`poweredBy({ serverName })` sets `X-Powered-By` to the server name, `Hono` by default, after `next()`. `secureHeaders` removes this header by default ([[Security Middleware]]).

Sources: [src/middleware/powered-by/index.ts:7-35](repo://src/middleware/powered-by/index.ts#L7-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)

## logger

`logger(fn = console.log)` prints `<-- METHOD /path` before `next()` and `--> METHOD /path STATUS TIME` after it, where the path includes the query string and the time is in milliseconds below one second and in seconds above. The status is colored by class (5xx red, 4xx yellow, 3xx cyan, 2xx green) unless `NO_COLOR` is set: on Cloudflare Workers it is looked up in the `cloudflare:workers` environment, elsewhere in `process.env` or Deno's `noColor`.

Sources: [src/middleware/logger/index.ts:9-95](repo://src/middleware/logger/index.ts#L9-L95), [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

## timing

### The middleware

`timing({ total, enabled, totalDescription, autoEnd, crossOrigin })` stores a `metric` object (header list and running timers) on the context; if one already exists, an outer `timing` is active and this one just calls `next()`. With `total` it times the whole downstream chain as `total`. After `next()` it ends any timers still running when `autoEnd` is on, then, if `enabled` (a boolean or a function of the context), appends `Server-Timing` and, when `crossOrigin` is set, `Timing-Allow-Origin` (`*` or the given origin).

Sources: [src/middleware/timing/timing.ts:10-36](repo://src/middleware/timing/timing.ts#L10-L36), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126)

### Recording metrics

Handlers record metrics with helpers that read the context's `metric` object and warn when the middleware is missing. `setMetric(c, name, value, description, precision)` adds `name;dur=value;desc="..."` (or a value-less metric); `startTime(c, name)` and `endTime(c, name)` measure with `performance.now()` (falling back to `Date.now()`); and `wrapTime(c, name, promise)` times a promise.

Sources: [src/middleware/timing/timing.ts:128-194](repo://src/middleware/timing/timing.ts#L128-L194), [src/middleware/timing/timing.ts:196-257](repo://src/middleware/timing/timing.ts#L196-L257)
