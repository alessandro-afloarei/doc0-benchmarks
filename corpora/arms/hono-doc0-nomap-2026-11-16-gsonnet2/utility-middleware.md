---
title: "Utility and Response Middleware"
---
## Overview

The remaining built-in middleware either change the response on its way out (cache, compress, etag, timing, pretty JSON), serve content (static files), adjust the request before routing finishes (method override, trailing slashes), or help compose other middleware. Most of them call `await next()` first and work on `c.res` afterwards, so their order relative to each other matters: whichever runs outermost sees the final response. Authentication and security middleware are on [[Authentication and Security Middleware]]; the chain mechanics are on [[Middleware Composition and Error Handling]].

Sources: [src/middleware/etag/index.ts:84-89](repo://src/middleware/etag/index.ts#L84-L89), [src/middleware/compress/index.ts:86-88](repo://src/middleware/compress/index.ts#L86-L88), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

| Middleware | Purpose |
| --- | --- |
| `cache` | Store and replay responses with the Web Cache API |
| `compress` | `gzip` or `deflate` the response body |
| `etag` | Add `ETag` and answer `304 Not Modified` |
| `logger` | Print request and response lines |
| `timing` | Emit `Server-Timing` metrics |
| `requestId` | Assign an id to each request |
| `timeout` | Fail requests that take too long |
| `serveStatic` | Serve files through a runtime-supplied reader |
| `some`, `every`, `except` | Combine middleware |
| `contextStorage` | Make `c` available outside handlers |
| `languageDetector` | Detect the client language |
| `methodOverride` | Reroute POSTs as other methods |
| `poweredBy`, `prettyJSON` | Small response tweaks |
| `trimTrailingSlash`, `appendTrailingSlash` | Redirect on trailing slashes |

Sources: [src/middleware/cache/index.ts:64-72](repo://src/middleware/cache/index.ts#L64-L72), [src/middleware/combine/index.ts:38](repo://src/middleware/combine/index.ts#L38), [src/middleware/context-storage/index.ts:43-47](repo://src/middleware/context-storage/index.ts#L43-L47), [src/middleware/language/language.ts:10-45](repo://src/middleware/language/language.ts#L10-L45), [src/middleware/method-override/index.ts:60-61](repo://src/middleware/method-override/index.ts#L60-L61), [src/middleware/trailing-slash/index.ts:44](repo://src/middleware/trailing-slash/index.ts#L44)

## Caching and validators

`cache({ cacheName, … })` uses the global `caches` (Web Cache API). Without it the factory logs a message (or calls `onCacheNotAvailable`) and returns a pass-through. It only handles `GET` requests without an `Authorization` header. The key is the URL, or `keyGenerator(c)`, extended with `::header=value` for each header named in `vary`. A hit returns a copy of the stored response without running the handler. On a miss it runs `next()`, and stores a clone if the status is in `cacheableStatusCodes` (default `[200]`) and `shouldSkipCache` says it is cacheable: responses are skipped when they set a cookie, carry `private`, `no-store` or `no-cache` in `Cache-Control`, or have a `Vary` header the options do not account for. `cacheControl` and `vary` options append headers first, without repeating a directive the handler already set. The write is awaited when `wait: true`, and otherwise handed to `c.executionCtx.waitUntil`. A `vary` that includes `*` throws at creation.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:64-183](repo://src/middleware/cache/index.ts#L64-L183)

`etag()` runs the handler, then takes the response's `ETag` or computes one: it hashes a clone of the body with SHA-1 through `crypto.subtle` (or your `generateDigest`), producing `"hash"` or `W/"hash"` when `weak` is set. If there is no digest function it does nothing. It compares with the request's `If-None-Match` ignoring the weak prefix (`*` matches successful `GET` and `HEAD` responses). On a match the response becomes `304 Not Modified` with headers pruned to `RETAINED_304_HEADERS` (`cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`); otherwise it sets `ETag` on the response.

Sources: [src/middleware/etag/index.ts:21-54](repo://src/middleware/etag/index.ts#L21-L54), [src/middleware/etag/index.ts:79-129](repo://src/middleware/etag/index.ts#L79-L129)

`compress()` also acts after `next()`. It skips the response when the status is 206, when `Content-Encoding` or `Transfer-Encoding` is already set, for `HEAD`, when `Content-Length` is under the threshold (default 1024 bytes), when the content type does not match `COMPRESSIBLE_CONTENT_TYPE_REGEX` (or your `contentTypeFilter`) and when `Cache-Control` has `no-transform`. It then chooses `gzip` or `deflate` from `Accept-Encoding` with quality values (`selectEncoding`), pipes the body through `CompressionStream`, removes `Content-Length`, sets `Content-Encoding`, and turns a strong `ETag` into a weak one because the bytes changed. This is why `etag` placed outside `compress` sees weak tags.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:70-129](repo://src/middleware/compress/index.ts#L70-L129)

## Observability and request tracking

`logger(fn = console.log)` prints `<-- METHOD path` before `next()` and `--> METHOD path status elapsed` after it. The status is coloured (2xx green, 3xx cyan, 4xx yellow, 5xx red) when `getColorEnabledAsync()` says colour is on, and time is shown as milliseconds, or seconds from 1000 ms.

Sources: [src/middleware/logger/index.ts:9-63](repo://src/middleware/logger/index.ts#L9-L63), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

`timing()` stores a `metric` variable (headers and timers) on the context and, after `next()`, appends a `Server-Timing` header; with `crossOrigin` it also appends `Timing-Allow-Origin`. It starts a `total` timer by default and ends all open timers when `autoEnd` is true. Handlers use the exported `setMetric`, `startTime`, `endTime` and `wrapTime(c, name, promise)` to add their own entries; they warn if `timing()` is not installed. If a `metric` variable already exists, `timing()` simply continues.

Sources: [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

`requestId()` reads the incoming `X-Request-Id` (configurable, and disabled with an empty `headerName`) and keeps it only if it is at most `limitLength` (255) characters of word characters, hyphens or `=`; otherwise it generates one with `generator` (default `crypto.randomUUID()`). It stores it as `c.get('requestId')` and sets it on the response header.

Sources: [src/middleware/request-id/request-id.ts:13-59](repo://src/middleware/request-id/request-id.ts#L13-L59)

`timeout(duration, exception?)` races `next()` against a timer that rejects with an `HTTPException` (default `504 Gateway Timeout`, or the result of a function of the context). The timer is cleared in `finally`. The handler keeps running after the timeout; only the response path is cut.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

`contextStorage()` runs the rest of the chain inside a Node `AsyncLocalStorage` holding `c`. Code anywhere downstream can call `getContext()` (which throws `Context is not available` outside a request) or `tryGetContext()`.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

## Static files

`serveStatic` in `src/middleware/serve-static` is runtime-agnostic: callers supply `getContent(path, c)`, optionally `join` and `isDir`, and the adapters do so ([[Runtime Adapters]]). It does nothing if the context is already finalized. The file name is `options.path` or the decoded request path; a path with `.` or `..` segments, doubled separators or backslashes is treated as not found. The name is joined to `root` (default `./`) after `rewriteRequestPath`, and a directory (per `isDir`) gets `index.html` appended. If `getContent` returns a `Response` it is used as is; if it returns data, `Content-Type` comes from the extension (with `mimes` overrides, falling back to `application/octet-stream`). With `precompressed`, for compressible types it looks for `.br`, `.zst` or `.gz` siblings that the client accepts, in that order, and serves the first found with `Content-Encoding` and `Vary: Accept-Encoding`. `onFound` and `onNotFound` are hooks; a miss continues to `next()`.

Sources: [src/middleware/serve-static/index.ts:13-126](repo://src/middleware/serve-static/index.ts#L13-L126)

## Composing middleware

`some(...)` runs middleware in order until one succeeds: a function returning `true` calls `next()`, one returning `false` counts as failure and the next is tried; a thrown error is remembered and the next middleware is tried, unless `next()` was already called, in which case it stops. If nothing succeeded, the last error is thrown. `every(...)` runs all of them as a chain with `compose`, resetting `c.req.routeIndex` for each, and throws `Unmet condition` when a condition function returns `false`. `except(condition, ...middleware)` runs the middleware unless the condition matches; a string condition is a path pattern matched with a `TrieRouter`, and conditions can also be functions of the context. It is built from `some` and `every`.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

## Request rewriting

`methodOverride({ app, form | header | query })` lets clients that can only send `POST` request other methods. It ignores `GET`. It reads the desired method from a form field (default `_method`, for `multipart/form-data` and `application/x-www-form-urlencoded` bodies), a header, or a query parameter, then builds a new `Request` with that method (removing the override field and, for forms, rebuilding the body) and dispatches it through `app.fetch(request, c.env, executionCtx)`, returning that response. If the override value is absent it calls `next()`.

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

`trimTrailingSlash()` and `appendTrailingSlash()` redirect with `301`. By default they wait for `next()` and redirect only if the response is a 404 for a `GET` or `HEAD` whose path ends with (or lacks) a slash; with `alwaysRedirect: true` they redirect before running the handler. `appendTrailingSlash` has a `skip(path)` option and never touches the root path in the trim variant.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

## Small response and request helpers

`poweredBy({ serverName })` sets `X-Powered-By` after `next()`, default `Hono`. `prettyJSON({ space, query, force })` re-serialises a JSON response with indentation (default 2 spaces) when the query parameter `pretty` is present (or always with `force`).

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

`languageDetector` configures detection with `DetectorOptions`: an `order` of sources from `querystring`, `cookie`, `header` and `path`, the names to look up in each (`lang`, `language`, `accept-language` by default), a `fallbackLanguage`, the list of `supportedLanguages`, and `caches` (a cookie, on by default with strict, secure and HTTP-only attributes). Detected values are normalised against the supported list, ignoring case by default, and the result is exposed as the `language` variable.

Sources: [src/middleware/language/language.ts:10-68](repo://src/middleware/language/language.ts#L10-L68), [src/middleware/language/language.ts:84-106](repo://src/middleware/language/language.ts#L84-L106)
