---
title: "Response Processing Middleware"
---
## Overview

These middleware act after `await next()`: they read the response the handler produced and transform it, replace it, or store it. They rely on two properties of the [[Context and Response Building]] object: `c.res` holds the downstream response once `next()` resolves, and assigning `c.res` replaces it while keeping headers set earlier. Order matters for that reason: a middleware registered first wraps the ones after it, so it sees their output.

Sources: [src/compose.ts:42-70](repo://src/compose.ts#L42-L70), [src/context.ts:403-434](repo://src/context.ts#L403-L434)

| Import | Does | Choose it when |
| --- | --- | --- |
| `hono/compress` | gzip or deflate the body with `CompressionStream` | The runtime or CDN does not already compress |
| `hono/etag` | Adds an `ETag` and answers `304 Not Modified` | Clients revalidate cached GET responses |
| `hono/cache` | Stores responses in the Web Cache API | Cloudflare Workers or Deno with `caches` available |
| `hono/pretty-json` | Indents JSON when `?pretty` is in the URL | Debugging an API in a browser |
| `hono/powered-by` | Sets `X-Powered-By` | Advertising the server name |
| `hono/trailing-slash` | Redirects `/path/` to `/path`, or the reverse | Canonical URLs with strict routing |
| `hono/timeout` | Fails a request after a duration with 504 | Bounding slow handlers |

Sources: [src/middleware/compress/index.ts:70-122](repo://src/middleware/compress/index.ts#L70-L122), [src/middleware/etag/index.ts:79-129](repo://src/middleware/etag/index.ts#L79-L129), [src/middleware/cache/index.ts:64-183](repo://src/middleware/cache/index.ts#L64-L183)

## compress

`compress({ encoding, threshold = 1024, contentTypeFilter })` lets the handler run, then skips compression when the response is a 206, already has `Content-Encoding` or `Transfer-Encoding`, answers a `HEAD`, declares a `Content-Length` below the threshold, has a content type the filter rejects (by default `COMPRESSIBLE_CONTENT_TYPE_REGEX` from `utils/compress`), or has `Cache-Control: no-transform`.

Sources: [src/middleware/compress/index.ts:70-102](repo://src/middleware/compress/index.ts#L70-L102), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129), [src/utils/compress.ts:1-10](repo://src/utils/compress.ts#L1-L10)

Otherwise it picks an encoding from `Accept-Encoding` with `parseAccept`: the first candidate with `q=1` wins, else the highest positive `q`, and a `*` entry applies to candidates not listed. The body is piped through `CompressionStream`, `Content-Length` is removed, `Content-Encoding` set, and a strong `ETag` is weakened to `W/"..."` because the compressed bytes differ from the ones the tag was computed on.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

## etag

`etag({ weak, retainedHeaders, generateDigest })` remembers `If-None-Match`, runs the handler, and keeps any `ETag` the handler set. Without one, it hashes a clone of the body (SHA-1 through `crypto.subtle` by default), feeding chunks to the generator as they arrive, and formats the hex digest as `"..."` or `W/"..."`.

Sources: [src/middleware/etag/index.ts:79-105](repo://src/middleware/etag/index.ts#L79-L105), [src/middleware/etag/digest.ts:16-43](repo://src/middleware/etag/digest.ts#L16-L43)

When `If-None-Match` lists the tag (compared with weak prefixes stripped), or is `*` on a successful GET or HEAD, the response becomes an empty `304 Not Modified` that keeps only `RETAINED_304_HEADERS`: `Cache-Control`, `Content-Location`, `Date`, `ETag`, `Expires` and `Vary`. Otherwise the `ETag` header is set on the response.

Sources: [src/middleware/etag/index.ts:15-36](repo://src/middleware/etag/index.ts#L15-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

> [!TIP]
> Registered before `compress()`, `etag()` wraps it and hashes the compressed bytes. Registered after, it hashes the uncompressed body and `compress` weakens the tag as described above.

Sources: [src/middleware/compress/index.ts:116-120](repo://src/middleware/compress/index.ts#L116-L120)

## cache

### Setup

`cache({ cacheName, cacheControl, vary, keyGenerator, wait, cacheableStatusCodes })` uses `globalThis.caches`. When the runtime has no Cache API the factory logs a message (or calls `onCacheNotAvailable`) and returns a pass-through middleware. A `vary` list containing `*` is rejected at startup, because such a response can never be reused.

Sources: [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103)

### Per request

Only `GET` requests without an `Authorization` header are cached. The key is the URL, or `keyGenerator(c)`, plus `::header=value` for each `vary` header. A hit returns the stored response immediately. On a miss the handler runs, and the response is stored only if its status is cacheable (200 by default) and it has no `Set-Cookie`, no `private`, `no-store` or `no-cache` directive, and no `Vary` header outside the configured `vary` list. Before storing, the configured `Cache-Control` directives are appended unless the handler already set them, and `Vary` is merged.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:105-183](repo://src/middleware/cache/index.ts#L105-L183)

`cache.put` runs in the background through `c.executionCtx.waitUntil` unless `wait: true`, which Deno needs because it has no execution context.

Sources: [src/middleware/cache/index.ts:177-182](repo://src/middleware/cache/index.ts#L177-L182)

## pretty-json

`prettyJSON({ space = 2, query = 'pretty', force })` decides before the handler runs whether the URL has `?pretty` (with or without a value). Afterwards, for an `application/json` response, it parses the body and re-serialises it with indentation.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)

## powered-by

`poweredBy({ serverName = 'Hono' })` sets `X-Powered-By` on every response. `secureHeaders()` removes that header by default, so do not combine the two unless `removePoweredBy` is turned off (see [[Security Middleware]]).

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)

## trailing-slash

`trimTrailingSlash()` and `appendTrailingSlash()` are for apps with strict routing, where `/about` and `/about/` are different routes (see [[Application and Route Registration]]). By default they act only when the handler chain answered 404 for a `GET` or `HEAD`: they then replace the response with a 301 redirect to the path without, or with, the trailing slash. With `alwaysRedirect: true` they redirect before running any handler, which is needed when a wildcard route would otherwise match the non-canonical form. `appendTrailingSlash` also accepts `skip(path)` to leave paths such as files with extensions alone. The root path `/` is never trimmed.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

## timeout

`timeout(duration, exception?)` races `next()` against a timer that rejects with an `HTTPException`: 504 `Gateway Timeout` by default, or the one given, which may be a function of the context. The timer is cleared when the handler finishes first. The handler itself is not cancelled: its work continues in the background while the client receives the timeout response.

Sources: [src/middleware/timeout/index.ts:12-58](repo://src/middleware/timeout/index.ts#L12-L58)
