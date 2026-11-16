---
title: "Cache, ETag, Compression and Pretty JSON"
---
## Overview

These four middleware act on the response after the handler has produced it. Each calls `await next()` first, then inspects `c.res` and either stores it, replaces it, or re-encodes its body. `cache` keeps whole responses in the Web Cache API, `etag` answers conditional requests with `304 Not Modified`, `compress` gzips or deflates bodies with `CompressionStream`, and `prettyJSON` re-indents JSON on request. Because they wrap the handler, their order relative to each other decides what they see ([[Request Dispatch and Middleware Composition]]).

Sources: [src/middleware/cache/index.ts:141-184](repo://src/middleware/cache/index.ts#L141-L184), [src/middleware/etag/index.ts:79-129](repo://src/middleware/etag/index.ts#L79-L129), [src/middleware/compress/index.ts:70-122](repo://src/middleware/compress/index.ts#L70-L122), [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

```ts
import { cache } from 'hono/cache'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'

app.use(compress())
app.use(etag())
app.get('/data', cache({ cacheName: 'data', cacheControl: 'max-age=3600' }), handler)
```

Sources: [src/middleware/cache/index.ts:64-72](repo://src/middleware/cache/index.ts#L64-L72)

## cache

### Options

| Option | Default | Effect |
| --- | --- | --- |
| `cacheName` | required | Name passed to `caches.open`, or a function of `c` |
| `wait` | `false` | Await `cache.put` instead of handing it to `c.executionCtx.waitUntil` |
| `cacheControl` | none | Directives appended to `Cache-Control` unless the response already sets the same directive |
| `vary` | none | Request headers that become part of the key and of the `Vary` header; `*` is rejected at setup |
| `keyGenerator` | `c.req.url` | Custom cache key |
| `cacheableStatusCodes` | `[200]` | Statuses that may be stored |
| `onCacheNotAvailable` | logs a message | Called when `globalThis.caches` is missing; `false` silences it |

Sources: [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103)

When the runtime has no `caches` global (Node.js, Bun), the factory returns a pass-through middleware, so the same code runs everywhere and only caches where the platform supports it. `wait: true` is needed on Deno, which has no `executionCtx`.

Sources: [src/middleware/cache/index.ts:73-86](repo://src/middleware/cache/index.ts#L73-L86)

### Request flow

1. Only `GET` requests without an `Authorization` header are considered; others go straight to `next()`.
2. The key is the URL (or `keyGenerator`'s result) plus `::name=value` for each `vary` header, URL-encoded.
3. A hit returns a copy of the cached response and the handler does not run.
4. On a miss, after `next()`, a response with a non-cacheable status is left alone. Otherwise `Cache-Control` and `Vary` are merged into it.
5. The response is not stored when it varies on a header the middleware did not include in the key, when `Cache-Control` contains `private`, `no-store` or `no-cache`, or when it sets a cookie.
6. A clone is put in the cache, in the background or awaited depending on `wait`.

Sources: [src/middleware/cache/index.ts:141-184](repo://src/middleware/cache/index.ts#L141-L184), [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35)

Step 5 is what keeps per-user responses out of a shared cache: a response that varies on `Cookie` or carries `Set-Cookie` is never stored under a key that ignores them.

Sources: [src/middleware/cache/index.ts:27-35](repo://src/middleware/cache/index.ts#L27-L35)

## etag

`etag(options)` reads `If-None-Match` before calling `next()`, then works in three steps.

Sources: [src/middleware/etag/index.ts:84-87](repo://src/middleware/etag/index.ts#L84-L87)

1. Uses the response's own `ETag` if it has one. Otherwise it hashes the body, read from a clone, with SHA-1 through Web Crypto (or `options.generateDigest`), and quotes the hex digest, prefixed with `W/` when `weak` is set.
2. Matches `If-None-Match` against it, ignoring weak prefixes on both sides; `If-None-Match: *` matches any successful `GET` or `HEAD`.
3. On a match, replaces `c.res` with an empty `304 Not Modified` and removes every header except those in `retainedHeaders` (by default `Cache-Control`, `Content-Location`, `Date`, `ETag`, `Expires`, `Vary`). Otherwise sets the `ETag` header on the response.

Sources: [src/middleware/etag/index.ts:21-129](repo://src/middleware/etag/index.ts#L21-L129)

`generateDigest` reads the body stream chunk by chunk and feeds the generator the previous digest concatenated with the next chunk, so memory stays bounded for large bodies. It returns `null` for a body-less response, and in that case no `ETag` is set. Without Web Crypto and without a custom generator, the middleware does nothing.

Sources: [src/middleware/etag/digest.ts:1-43](repo://src/middleware/etag/digest.ts#L1-L43), [src/middleware/etag/index.ts:38-54](repo://src/middleware/etag/index.ts#L38-L54)

The body is still produced by the handler on a match; `etag` saves bandwidth, not computation. Pairing it with `cache` saves both.

Sources: [src/middleware/etag/index.ts:84-105](repo://src/middleware/etag/index.ts#L84-L105)

## compress

### When a response is compressed

`compress({ encoding?, threshold = 1024, contentTypeFilter? })` leaves the response untouched when any of the conditions below holds.

Sources: [src/middleware/compress/index.ts:70-72](repo://src/middleware/compress/index.ts#L70-L72)

- the status is `206` (the `Content-Range` refers to uncompressed bytes);
- it already has `Content-Encoding` or `Transfer-Encoding`;
- the request is `HEAD`;
- `Content-Length` is known and below `threshold`;
- the `Content-Type` fails the filter (by default `COMPRESSIBLE_CONTENT_TYPE_REGEX`, which covers text, JSON, XML, JavaScript and similar types but excludes `text/event-stream` so SSE keeps streaming);
- `Cache-Control` contains `no-transform`.

Sources: [src/middleware/compress/index.ts:86-102](repo://src/middleware/compress/index.ts#L86-L102), [src/utils/compress.ts:9-10](repo://src/utils/compress.ts#L9-L10), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129)

### Choosing and applying the encoding

`selectEncoding` parses `Accept-Encoding` with the shared Accept parser ([[Accepts and Language Detection]]) and picks among `gzip` and `deflate` (or only the configured `encoding`): an exact `q=1` wins immediately, otherwise the highest positive `q`, with `*` supplying a default weight. No acceptable encoding means no compression.

Sources: [src/middleware/compress/index.ts:12-44](repo://src/middleware/compress/index.ts#L12-L44)

The body is piped through `new CompressionStream(encoding)`, `Content-Length` is removed and `Content-Encoding` set. A strong `ETag` is weakened to `W/"..."`, because the compressed bytes are no longer byte-identical to what the tag described.

Sources: [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

Registering `compress` before `etag` (outermost first) makes `etag` hash the uncompressed body and `compress` weaken the tag afterwards; the reverse order makes the tag depend on the encoding.

Sources: [src/middleware/compress/index.ts:117-120](repo://src/middleware/compress/index.ts#L117-L120)

## prettyJSON

`prettyJSON({ space = 2, query = 'pretty', force })` checks before `next()` whether the request has the query parameter (`?pretty` or `?pretty=...`) or `force` is set. After `next()`, if the response is `application/json`, it parses the body and re-serialises it with the indentation, keeping status and headers. It is meant for humans reading an API in a browser, not for production traffic.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)
