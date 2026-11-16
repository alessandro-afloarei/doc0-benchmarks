---
title: "Response and Observability Middleware"
---
## Overview

This catalogue covers the built-in middleware that work on the response or report on the request: `compress`, `etag` and `cache` change what is sent and how it is cached; `prettyJSON` and `poweredBy` adjust the body or headers; `logger`, `timing` and `requestId` observe. Almost all of them do their work after `await next()`, once the handler has set `c.res`, which is why their position in the chain matters: a middleware registered earlier wraps everything registered after it, as [[Request Lifecycle and Middleware]] explains.

Sources: [src/middleware/compress/index.ts:86-122](repo://src/middleware/compress/index.ts#L86-L122), [src/middleware/etag/index.ts:84-129](repo://src/middleware/etag/index.ts#L84-L129), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

| Middleware | Import | Works | Purpose |
| --- | --- | --- | --- |
| `compress` | `hono/compress` | After `next()` | gzip or deflate the body |
| `etag` | `hono/etag` | After `next()` | Add `ETag`, answer 304 to matching `If-None-Match` |
| `cache` | `hono/cache` | Before and after | Serve and store responses through the Cache API |
| `prettyJSON` | `hono/pretty-json` | After `next()` | Indent JSON bodies on request |
| `poweredBy` | `hono/powered-by` | After `next()` | Set `X-Powered-By` |
| `logger` | `hono/logger` | Before and after | Log each request and its status and time |
| `timing` | `hono/timing` | Before and after | Emit `Server-Timing` metrics |
| `requestId` | `hono/request-id` | Before `next()` | Assign a request ID |

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/cache/index.ts:141-184](repo://src/middleware/cache/index.ts#L141-L184), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

## compress

`compress({ encoding, threshold, contentTypeFilter })` leaves the response alone when it is a 206, already has `Content-Encoding` or `Transfer-Encoding`, answers a `HEAD` request, declares a `Content-Length` below `threshold` (1024 bytes by default), has a content type that is not compressible, or carries `Cache-Control: no-transform`. The default filter is `COMPRESSIBLE_CONTENT_TYPE_REGEX`, which matches text types except `text/event-stream`, JSON, XML, JavaScript and a list of other compressible formats.

Sources: [src/middleware/compress/index.ts:70-102](repo://src/middleware/compress/index.ts#L70-L102), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129), [src/utils/compress.ts:6-10](repo://src/utils/compress.ts#L6-L10)

The encoding is chosen from `Accept-Encoding` with `parseAccept` (see [[Content Negotiation]]): among `gzip` and `deflate`, or only the configured `encoding`, the first with quality 1 wins, else the highest positive quality, with `*` applying to encodings not listed. The body is piped through a `CompressionStream`, `Content-Length` is removed, `Content-Encoding` is set, and a strong `ETag` is weakened to `W/...` because the compressed bytes differ from the original.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

## etag

`etag({ weak, retainedHeaders, generateDigest })` uses the handler's own `ETag` when present. Otherwise it hashes a clone of the body, by default with SHA-1 from `crypto.subtle`, feeding the digest function the accumulated bytes chunk by chunk, and formats it as `"hex"` or `W/"hex"`. Without Web Crypto and without a custom `generateDigest`, it does nothing.

Sources: [src/middleware/etag/index.ts:38-105](repo://src/middleware/etag/index.ts#L38-L105), [src/middleware/etag/digest.ts:16-43](repo://src/middleware/etag/digest.ts#L16-L43)

The request's `If-None-Match` is read before `next()`. If it lists the tag (weak and strong forms compare equal), or is `*` on a successful `GET`/`HEAD`, the response is replaced by a 304 that keeps only `RETAINED_304_HEADERS` (`cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`) or the configured list. Otherwise the `ETag` header is set on the response.

Sources: [src/middleware/etag/index.ts:21-36](repo://src/middleware/etag/index.ts#L21-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

## cache

`cache({ cacheName, cacheControl, vary, keyGenerator, wait, cacheableStatusCodes })` stores responses with the Web Cache API (`caches.open`). Where `globalThis.caches` does not exist, it logs a message (or calls `onCacheNotAvailable`) and becomes a pass-through.

Sources: [src/middleware/cache/index.ts:64-82](repo://src/middleware/cache/index.ts#L64-L82)

Only `GET` requests without an `Authorization` header are considered. The key is the URL, or `keyGenerator(c)`, plus each configured `vary` header's value. A cached response is returned without calling the handler. On a miss, after `next()`, a response with a cacheable status (200 by default) gets the configured `Cache-Control` directives (those the handler did not already set) and the merged `Vary`. It is then stored unless it has `Set-Cookie`, a `private`, `no-store` or `no-cache` directive, or varies on a header the middleware was not configured for. Storing uses `executionCtx.waitUntil` unless `wait: true`, which awaits the write before the response is returned.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:84-184](repo://src/middleware/cache/index.ts#L84-L184)

## prettyJSON and poweredBy

`prettyJSON({ space, query, force })` re-serialises a JSON response with indentation (2 spaces by default) when the request has the `?pretty` query parameter, another name given by `query`, or always with `force`. It only touches responses whose `Content-Type` starts with `application/json`.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)

`poweredBy({ serverName })` sets `X-Powered-By` to `Hono` or the given name after the handler. `secureHeaders` removes that header by default, as [[Security Middleware]] notes.

Sources: [src/middleware/powered-by/index.ts:7-35](repo://src/middleware/powered-by/index.ts#L7-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)

## logger

`logger(fn = console.log)` prints `<-- METHOD /path?query` when the request arrives and `--> METHOD /path?query STATUS 12ms` after the response is ready, switching to seconds above 1000 ms. The status is coloured by class (5xx red, 4xx yellow, 3xx cyan, 2xx green) when the color utility reports that colours are enabled. Passing another print function sends the lines elsewhere.

Sources: [src/middleware/logger/index.ts:9-95](repo://src/middleware/logger/index.ts#L9-L95)

## timing

`timing(options)` stores a `metric` object on the context with a list of entries and a map of running timers, starts a `total` timer, calls `next()`, ends `total`, ends any timers still running (`autoEnd`), and appends everything to `Server-Timing`. A nested `timing` sees `metric` already set and does nothing. `enabled` (a boolean or a function of the context) can suppress the header, and `crossOrigin` adds `Timing-Allow-Origin`.

Sources: [src/middleware/timing/timing.ts:10-126](repo://src/middleware/timing/timing.ts#L10-L126)

Handlers add entries with helpers that read the same `metric` variable: `setMetric(c, name, value, description, precision)` for a measured value or `setMetric(c, name, description)` for a marker, `startTime(c, name)` and `endTime(c, name)` for a timer, and `wrapTime(c, name, promise)` around a promise. Each warns on the console when `timing()` was not installed on the route.

Sources: [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

```ts
import { timing, startTime, endTime } from 'hono/timing'

app.use(timing())

app.get('/', async (c) => {
  startTime(c, 'db')
  const data = await db.query()
  endTime(c, 'db')
  return c.json(data)
})
```

Sources: [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

## requestId

`requestId({ headerName, limitLength, generator })` reuses the incoming `X-Request-Id` (or `headerName`) when it is at most 255 characters (`limitLength`) of letters, digits, `_`, `-` and `=`; otherwise it calls `generator`, `crypto.randomUUID()` by default. The ID is stored as `c.get('requestId')` and echoed in the same response header before the handler runs; an empty `headerName` skips both reading and writing the header.

Sources: [src/middleware/request-id/request-id.ts:9-59](repo://src/middleware/request-id/request-id.ts#L9-L59)
