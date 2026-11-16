---
title: "Response, Observability and Utility Middleware"
---
## Overview

This page lists the remaining built-in middleware: the ones that transform responses, control the flow of a request, report on it, or make request data easier to reach. (Security middleware is in [[Authentication and Security Middleware]]; static files in [[Serving Static Files]].) All of them are factories returning `async (c, next)`. The ones that act on the response call `await next()` first and then read or replace `c.res`; see [[Application and Request Dispatch]] for why that works and [[Context and Responses]] for how a replaced `res` keeps earlier headers.

Sources: [src/middleware/compress/index.ts:86-87](repo://src/middleware/compress/index.ts#L86-L87), [src/middleware/powered-by/index.ts:30-34](repo://src/middleware/powered-by/index.ts#L30-L34), [src/compose.ts:49-72](repo://src/compose.ts#L49-L72)

| Middleware | Purpose | Runs its logic |
| --- | --- | --- |
| `compress` | Gzip or deflate the response body | after `next()` |
| `etag` | Add `ETag` and answer `If-None-Match` with 304 | after `next()` |
| `cache` | Store GET responses in the Cache API | before and after |
| `prettyJSON` | Indent JSON responses on request | after `next()` |
| `timeout` | Fail a request that takes too long | races `next()` |
| `methodOverride` | Let a form, header or query change the method | before `next()` |
| `trimTrailingSlash`, `appendTrailingSlash` | Redirect to one slash form | before or after |
| `some`, `every`, `except` | Combine middleware | wraps others |
| `logger` | Log request and response lines | around |
| `requestId` | Give each request an id | before |
| `timing` | Emit `Server-Timing` | around |
| `poweredBy` | Set `X-Powered-By` | after |
| `languageDetector` | Pick a language for the request | before |
| `contextStorage` | Make the `Context` reachable anywhere | wraps |
| `jsxRenderer` | Set a JSX layout and renderer | before |

Sources: [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128), [src/middleware/cache/index.ts:141-183](repo://src/middleware/cache/index.ts#L141-L183), [src/middleware/timeout/index.ts:38-57](repo://src/middleware/timeout/index.ts#L38-L57), [src/middleware/logger/index.ts:81-94](repo://src/middleware/logger/index.ts#L81-L94), [src/middleware/request-id/request-id.ts:41-58](repo://src/middleware/request-id/request-id.ts#L41-L58), [src/middleware/language/language.ts:283-299](repo://src/middleware/language/language.ts#L283-L299), [src/middleware/context-storage/index.ts:43-47](repo://src/middleware/context-storage/index.ts#L43-L47), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

## Response transformers

### compress

`compress({ encoding, threshold, contentTypeFilter })` waits for the response, then compresses it with `CompressionStream` using `gzip` or `deflate`. It skips the response when it is a 206, already has `Content-Encoding` or `Transfer-Encoding`, answers a `HEAD`, has a `Content-Length` under `threshold` (default 1024), has a type that does not match `contentTypeFilter` (default `COMPRESSIBLE_CONTENT_TYPE_REGEX`), or carries `Cache-Control: no-transform`. The encoding is chosen from the request's `Accept-Encoding` by quality value. When it compresses, it deletes `Content-Length`, sets `Content-Encoding` and turns a strong `ETag` into a weak one.

Sources: [src/middleware/compress/index.ts:18-44](repo://src/middleware/compress/index.ts#L18-L44), [src/middleware/compress/index.ts:70-129](repo://src/middleware/compress/index.ts#L70-L129)

### etag

`etag({ weak, retainedHeaders, generateDigest })` reads `If-None-Match` before `next()`. Afterwards it uses the response's own `ETag`, or generates one by hashing a clone of the body (SHA-1 through `crypto.subtle` unless `generateDigest` is given). If the tag matches, or `If-None-Match` is `*` on a successful `GET` or `HEAD`, the response becomes a 304 with only the headers in `retainedHeaders` (default `cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`). Otherwise it sets `ETag` on the response. Without a digest generator it does nothing.

Sources: [src/middleware/etag/index.ts:9-54](repo://src/middleware/etag/index.ts#L9-L54), [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128)

### cache

`cache({ cacheName, wait, cacheControl, vary, keyGenerator, cacheableStatusCodes })` uses the platform `caches` API; if `caches` does not exist it logs a message (or calls `onCacheNotAvailable`) and passes everything through. It only handles `GET` requests without an `Authorization` header. The key is the URL (or `keyGenerator`'s result) with each `vary` header value appended. A hit returns a copy of the stored response. On a miss it runs `next()`, and for a cacheable status (default only 200) adds the configured `Cache-Control` directives and `Vary` header, skips storing when the response has `Set-Cookie`, a `private` / `no-store` / `no-cache` directive, or a `Vary` not covered by the option, and otherwise stores a clone. With `wait: true` it awaits `cache.put`; otherwise it hands the write to `c.executionCtx.waitUntil`. A `*` in the `vary` option is rejected at construction.

Sources: [src/middleware/cache/index.ts:13-36](repo://src/middleware/cache/index.ts#L13-L36), [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103), [src/middleware/cache/index.ts:141-183](repo://src/middleware/cache/index.ts#L141-L183)

### prettyJSON

`prettyJSON({ space, query, force })` re-serialises a JSON response with indentation (default 2) when the query parameter named `pretty` (or `query`) is present, or always with `force`. It only touches responses whose `Content-Type` starts with `application/json`.

Sources: [src/middleware/pretty-json/index.ts:8-26](repo://src/middleware/pretty-json/index.ts#L8-L26), [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

## Request flow control

### timeout

`timeout(duration, exception)` races `next()` against a timer that rejects with an `HTTPException`: by default status 504 with `Gateway Timeout`, or the exception (or function of the context) you pass. The timer is cleared in a `finally`.

Sources: [src/middleware/timeout/index.ts:10-57](repo://src/middleware/timeout/index.ts#L10-L57)

### methodOverride

`methodOverride({ app, form | header | query })` lets clients that can only send `POST` choose another method. For anything but `GET` it reads the override from a form field (default `_method`, for multipart and urlencoded bodies), a header or a query parameter. When one is found it builds a new request with that method, removing the override field, and sends it to `app.fetch(request, c.env, executionCtx)` itself, returning that response. Otherwise it calls `next()`.

Sources: [src/middleware/method-override/index.ts:11-34](repo://src/middleware/method-override/index.ts#L11-L34), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

### trimTrailingSlash and appendTrailingSlash

Both only affect `GET` and `HEAD`. By default they run after `next()` and, when the response is a 404 and the path has (or lacks) a trailing slash, replace it with a 301 redirect to the other form. With `alwaysRedirect: true` they redirect before running the handlers. `appendTrailingSlash` also accepts a `skip(path)` function. Note that `trimTrailingSlash` ignores the root path `/`.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

### some, every and except

`some(...middleware)` tries each in order and stops at the first that succeeds, where a function returning `false` counts as failure; if all fail it throws the last error. A failure after `next()` was called is not retried. `every(...middleware)` runs all of them through `compose`, and a condition that returns `false` throws `Unmet condition`. `except(condition, ...middleware)` runs the given middleware unless a condition holds; string conditions are path patterns matched with a `TrieRouter`.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

## Observability and metadata

### logger

`logger(fn = console.log)` prints `<-- METHOD path` when the request arrives and `--> METHOD path status elapsed` after `next()`. Status codes are coloured when colour is enabled (red 5xx, yellow 4xx, cyan 3xx, green 2xx), and elapsed time is `ms` below one second and `s` above.

Sources: [src/middleware/logger/index.ts:9-26](repo://src/middleware/logger/index.ts#L9-L26), [src/middleware/logger/index.ts:28-63](repo://src/middleware/logger/index.ts#L28-L63), [src/middleware/logger/index.ts:81-94](repo://src/middleware/logger/index.ts#L81-L94)

### requestId

`requestId({ limitLength, headerName, generator })` takes an incoming `X-Request-Id`, and keeps it only if it is at most 255 characters and made of word characters, `-` or `=`; otherwise it generates one with `crypto.randomUUID()`. The id is stored as the context variable `requestId` and written to the response header (unless `headerName` is empty) before `next()`.

Sources: [src/middleware/request-id/request-id.ts:9-17](repo://src/middleware/request-id/request-id.ts#L9-L17), [src/middleware/request-id/request-id.ts:41-58](repo://src/middleware/request-id/request-id.ts#L41-L58)

### timing

`timing(options)` initialises a `metric` variable and, after `next()`, appends a `Server-Timing` header built from the recorded metrics, plus `Timing-Allow-Origin` when `crossOrigin` is set. It adds a `total` timer by default. Handlers use `setMetric`, `startTime`, `endTime` and `wrapTime` to record entries; each warns on the console if the middleware was not installed.

Sources: [src/middleware/timing/timing.ts:10-28](repo://src/middleware/timing/timing.ts#L10-L28), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-225](repo://src/middleware/timing/timing.ts#L149-L225)

### poweredBy

`poweredBy({ serverName })` sets `X-Powered-By` to `Hono`, or the given name, after `next()`.

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

### languageDetector

`languageDetector(options)` chooses a language and stores it as the context variable `language`. Detectors are tried in `order` (default query string `lang`, cookie `language`, then the `accept-language` header; `path` is also available) and each result is normalised against `supportedLanguages`, with an exact match first and then progressive truncation of subtags. The first hit wins, otherwise `fallbackLanguage` (default `en`) is used. A detected language is cached in a cookie unless `caches` is `false`. Options are validated up front: the fallback must be among the supported languages, the path index must not be negative, and `order` may only name known detectors.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123), [src/middleware/language/language.ts:195-299](repo://src/middleware/language/language.ts#L195-L299)

## Request-scoped access

### contextStorage

`contextStorage()` runs the rest of the chain inside an `AsyncLocalStorage` holding the `Context`. Code that has no `c` argument can then call `getContext()`, which throws `Context is not available` outside a request, or `tryGetContext()`, which returns `undefined`.

Sources: [src/middleware/context-storage/index.ts:10-59](repo://src/middleware/context-storage/index.ts#L10-L59)

### jsxRenderer

`jsxRenderer(component, options)` installs a layout and a renderer on the context. It keeps any previous layout as `Layout`, calls `c.setLayout` to nest `component` around it and `c.setRenderer` so that `c.render(children, props)` wraps the page in the layout and `RequestContext.Provider`. The output starts with `<!DOCTYPE html>` unless `docType` says otherwise, and is returned with `c.html`, or as a chunked stream through `renderToReadableStream` when `stream` is set. `useRequestContext()` reads the `Context` inside a component and throws if none is provided. See [[JSX Server Rendering]] and [[Context and Responses]].

Sources: [src/middleware/jsx-renderer/index.ts:15-80](repo://src/middleware/jsx-renderer/index.ts#L15-L80), [src/middleware/jsx-renderer/index.ts:116-165](repo://src/middleware/jsx-renderer/index.ts#L116-L165)
