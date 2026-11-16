---
title: "Response Middleware"
---
## Overview

A response middleware calls `next()` first and then changes the `Response` that the handler produced. Most built-in middleware in this group are of that kind: they compress the body, add a validator tag, store the answer in a cache, reformat JSON, set security headers, or add timing data. Each one reads `c.res` after `await next()`, so it sees the result of the whole chain below it. This page is a catalogue of those middlewares, grouped by what they change. The request-side middlewares are on [[Request Middleware]], and the authentication ones on [[Authentication Middleware]].

Sources: [src/middleware/compress/index.ts:70-87](repo://src/middleware/compress/index.ts#L70-L87), [src/middleware/etag/index.ts:84-88](repo://src/middleware/etag/index.ts#L84-L88)

## Compression

`compress` reads the `Accept-Encoding` header and chooses `gzip` or `deflate` by quality value, preferring a candidate with `q=1` at once. It skips a response that is already encoded, is a partial (206) response, is a HEAD request, has a `Content-Length` below the threshold, has a type the filter rejects, or has `no-transform` in `Cache-Control`. The threshold defaults to 1024 bytes.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:70-101](repo://src/middleware/compress/index.ts#L70-L101)

The body is passed through a `CompressionStream`, and the response is replaced with one that carries the stream. `Content-Length` is removed because the length changed, and `Content-Encoding` is set. A strong `ETag` is turned into a weak one, since the compressed bytes differ from the original. The type filter defaults to a regular expression of compressible content types.

Sources: [src/middleware/compress/index.ts:104-122](repo://src/middleware/compress/index.ts#L104-L122), [src/utils/compress.ts:9-10](repo://src/utils/compress.ts#L9-L10)

## Validator tags

`etag` computes a digest of the response body with SHA-1 by default, unless a `generateDigest` option is given. It sets the `ETag` header, or uses the one the handler already set. If the request's `If-None-Match` matches the tag, the middleware replaces the response with an empty 304, and keeps only the headers listed in `RETAINED_304_HEADERS`. A `*` in `If-None-Match` matches any GET or HEAD response that is OK.

Sources: [src/middleware/etag/index.ts:21-54](repo://src/middleware/etag/index.ts#L21-L54), [src/middleware/etag/index.ts:79-129](repo://src/middleware/etag/index.ts#L79-L129)

## Caching responses

`cache` uses the Cache API, which is `caches.open` by name. Before `next()`, it answers a `GET` from the cache when the request has no `Authorization` header, and the key is the request URL, optionally changed by `keyGenerator` and extended with the `vary` headers. When `caches` is not defined, the middleware is created as a pass-through: it logs a message at creation, unless `onCacheNotAvailable` says otherwise, and calls `next()` only.

Sources: [src/middleware/cache/index.ts:64-83](repo://src/middleware/cache/index.ts#L64-L83), [src/middleware/cache/index.ts:141-164](repo://src/middleware/cache/index.ts#L141-L164)

After `next()`, the response is stored only if its status is in `cacheableStatusCodes`, which defaults to 200, and only if it is not private, does not say `no-store` or `no-cache`, and has no `Set-Cookie`. The stored value is a clone. The `wait` option decides whether the write is awaited, and otherwise it is passed to `waitUntil` on the execution context.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:166-182](repo://src/middleware/cache/index.ts#L166-L182)

## Formatting

`prettyJSON` reads its flag before `next()`. The flag is set when `force` is true, or when the query parameter `pretty` is present; the parameter name can be changed with `query`. After `next()`, a JSON response is parsed and replaced with the same value printed with `space` spaces of indentation, which defaults to 2.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

`poweredBy` sets `X-Powered-By` to `Hono` or to the `serverName` option, after the chain has run.

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

## Security headers

`secureHeaders` has a default set of headers in `DEFAULT_OPTIONS`, such as `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN` and `Strict-Transport-Security`. A header is turned off with `false`, or given a different value with a string. `Cross-Origin-Embedder-Policy` is off by default. `removePoweredBy` defaults to `true`, so `X-Powered-By` is deleted after the chain runs.

Sources: [src/middleware/secure-headers/secure-headers.ts:69-124](repo://src/middleware/secure-headers/secure-headers.ts#L69-L124)

The list of headers is built before `next()`, and applied to the response after it. A content security policy, a report-only policy, reporting endpoints and `Report-To` are added to the same list. Each option callback can change the list for the request first.

Sources: [src/middleware/secure-headers/secure-headers.ts:179-226](repo://src/middleware/secure-headers/secure-headers.ts#L179-L226)

## Server timing

`timing` starts a `total` timer before `next()` and ends it after. It stores a metric object on the context, so an inner `timing` call returns without adding a second header. Each timer that is still running is ended when `autoEnd` is set. Its results go into one `Server-Timing` header, and `crossOrigin` adds `Timing-Allow-Origin`.

Sources: [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:30-35](repo://src/middleware/timing/timing.ts#L30-L35)
