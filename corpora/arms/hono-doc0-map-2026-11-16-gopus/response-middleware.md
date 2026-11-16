---
title: "Response Middleware"
---
## Overview

These middleware work on the response a handler produced. Each one calls `await next()` first and then reads or replaces `c.res`, the pattern described on [[Request Dispatch and Middleware]]. When one replaces the response, the Context's `res` setter carries the earlier headers over ([[Context and Responses]]).

Sources: [src/middleware/compress/index.ts:86-121](repo://src/middleware/compress/index.ts#L86-L121), [src/middleware/etag/index.ts:84-128](repo://src/middleware/etag/index.ts#L84-L128), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

| Middleware | Import | What it does |
| --- | --- | --- |
| `compress` | `hono/compress` | Compresses the body with gzip or deflate |
| `etag` | `hono/etag` | Adds an `ETag` and answers `304 Not Modified` |
| `cache` | `hono/cache` | Stores and serves responses with the Web Cache API |
| `prettyJSON` | `hono/pretty-json` | Re-indents JSON responses on request |
| `poweredBy` | `hono/powered-by` | Adds an `X-Powered-By` header |

Sources: [package.json:94-98](repo://package.json#L94-L98), [package.json:114-118](repo://package.json#L114-L118), [package.json:134-138](repo://package.json#L134-L138), [package.json:239-248](repo://package.json#L239-L248)

## compress

`compress(options?)` streams the body through a `CompressionStream`, so it works on any runtime that provides that Web API.

Sources: [src/middleware/compress/index.ts:12-22](repo://src/middleware/compress/index.ts#L12-L22), [src/middleware/compress/index.ts:70-84](repo://src/middleware/compress/index.ts#L70-L84)

| Option | Default | Effect |
| --- | --- | --- |
| `encoding` | both `gzip` and `deflate` | Restrict to one encoding |
| `threshold` | `1024` | Skip bodies whose `Content-Length` is smaller |
| `contentTypeFilter` | `COMPRESSIBLE_CONTENT_TYPE_REGEX` | A `RegExp` or a function deciding which content types to compress |

Sources: [src/middleware/compress/index.ts:12-22](repo://src/middleware/compress/index.ts#L12-L22), [src/middleware/compress/index.ts:70-84](repo://src/middleware/compress/index.ts#L70-L84)

The default filter matches `text/*` except `text/event-stream`, JSON, XML, JavaScript, WebAssembly and many other text-like `application/*` types, a few font and image types, and any `+json`, `+xml`, `+text`, `+yaml` or `+msgpack` suffix. Because `text/event-stream` is excluded, the event streams of [[Streaming and Server-Sent Events]] are never compressed.

Sources: [src/utils/compress.ts:9-10](repo://src/utils/compress.ts#L9-L10)

After `next()`, the response is left untouched when any of these is true, each noted in a comment: the status is 206, `Content-Encoding` or `Transfer-Encoding` is already set, the method is `HEAD`, the length is under the threshold, the type does not pass the filter, or `Cache-Control` contains `no-transform`.

Sources: [src/middleware/compress/index.ts:86-102](repo://src/middleware/compress/index.ts#L86-L102), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129)

The encoding is chosen from `Accept-Encoding` with `parseAccept` ([[Content Negotiation]]). An encoding with `q=1` wins at once; otherwise the highest positive `q` wins, and an encoding not listed takes the `q` of `*`. With no acceptable encoding or no body, nothing changes.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-108](repo://src/middleware/compress/index.ts#L104-L108)

When it compresses, the middleware replaces `c.res` with the piped stream, removes `Content-Length`, sets `Content-Encoding`, and turns a strong `ETag` into a weak one, because, as the comment says, compressed content is not byte-identical.

Sources: [src/middleware/compress/index.ts:110-121](repo://src/middleware/compress/index.ts#L110-L121)

## etag

`etag(options?)` reads `If-None-Match` before `next()`. After it, it uses the response's own `ETag` if there is one; otherwise it hashes a clone of the body. The default hash is SHA-1 from `crypto.subtle`, and without `crypto.subtle` and without a custom `generateDigest` the middleware does nothing.

Sources: [src/middleware/etag/index.ts:38-105](repo://src/middleware/etag/index.ts#L38-L105)

`generateDigest` reads the body stream chunk by chunk and, for each chunk, hashes the previous hash joined with the chunk, so the body is never held in memory whole. The result is written as lower-case hex, quoted, and prefixed with `W/` when `weak: true`.

Sources: [src/middleware/etag/digest.ts:1-43](repo://src/middleware/etag/digest.ts#L1-L43), [src/middleware/etag/index.ts:104-104](repo://src/middleware/etag/index.ts#L104-L104)

The response becomes `304 Not Modified` when `If-None-Match` lists the tag (compared with `W/` stripped from both sides), or when it is `*` and the request is a successful `GET` or `HEAD`. The 304 keeps only the headers in `retainedHeaders`, by default `RETAINED_304_HEADERS`: `cache-control`, `content-location`, `date`, `etag`, `expires` and `vary`. Otherwise the `ETag` header is set on the response.

Sources: [src/middleware/etag/index.ts:9-36](repo://src/middleware/etag/index.ts#L9-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

## cache

`cache(options)` uses `globalThis.caches`, the Cache API that runtimes such as Cloudflare Workers and Deno provide. When it is missing, the middleware becomes a pass-through and logs a message, or calls `onCacheNotAvailable`, or stays silent when that option is `false`.

Sources: [src/middleware/cache/index.ts:64-82](repo://src/middleware/cache/index.ts#L64-L82)

| Option | Effect |
| --- | --- |
| `cacheName` | Cache to open; a string or a function of the Context |
| `wait` | Await `cache.put` instead of handing it to `executionCtx.waitUntil` (default `false`) |
| `cacheControl` | Directives added to `Cache-Control` unless the handler set them |
| `vary` | Request headers that vary the response; added to `Vary` and to the cache key. `*` throws at setup |
| `keyGenerator` | Builds the key; the default is the request URL |
| `cacheableStatusCodes` | Statuses to store; default `[200]` |

Sources: [src/middleware/cache/index.ts:13-13](repo://src/middleware/cache/index.ts#L13-L13), [src/middleware/cache/index.ts:64-139](repo://src/middleware/cache/index.ts#L64-L139)

A request is only looked up when it is a `GET` without an `Authorization` header. The key is the URL or generated key, followed by `::name=value` for each `vary` header. A hit is returned as a new `Response` and the handlers do not run.

Sources: [src/middleware/cache/index.ts:141-164](repo://src/middleware/cache/index.ts#L141-L164)

On a miss with a cacheable status, the middleware adds its headers and then stores a clone, unless the response sets a cookie, has `private`, `no-store` or `no-cache` in `Cache-Control`, or varies on a header not listed in `vary`.

Sources: [src/middleware/cache/index.ts:15-35](repo://src/middleware/cache/index.ts#L15-L35), [src/middleware/cache/index.ts:166-183](repo://src/middleware/cache/index.ts#L166-L183)

> [!WARNING]
> With `wait` left at `false`, the middleware calls `c.executionCtx.waitUntil`, which throws when the runtime passed no execution context ([[Context and Responses]]). On such runtimes, set `wait: true`.

Sources: [src/middleware/cache/index.ts:177-182](repo://src/middleware/cache/index.ts#L177-L182), [src/context.ts:391-397](repo://src/context.ts#L391-L397)

## prettyJSON

`prettyJSON(options?)` re-serialises a JSON response with `JSON.stringify(obj, null, space)` when the request has the query parameter `?pretty` (with or without a value), or always with `force: true`. `space` defaults to 2 and `query` renames the parameter. Only responses whose `Content-Type` starts with `application/json` are touched.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)

## poweredBy

`poweredBy(options?)` sets `X-Powered-By` to `serverName`, or `Hono` by default, after the handler runs. [[Security Middleware]]'s `secureHeaders` removes the same header by default, so with `secureHeaders` registered first, its post-processing runs last and the header from `poweredBy` is removed again.

Sources: [src/middleware/powered-by/index.ts:7-35](repo://src/middleware/powered-by/index.ts#L7-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)
