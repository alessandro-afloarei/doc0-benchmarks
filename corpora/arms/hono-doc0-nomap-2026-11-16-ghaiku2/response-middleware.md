---
title: "Response Middleware"
---
## Overview

The response middleware changes what leaves the app: it compresses or caches a body, answers conditional requests, limits the size of an upload, serves files, renders layouts, or adjusts the URL before routing continues. Each one wraps `next()` and then edits `c.res`, or stops the chain before the handler runs. The list is `compress`, `etag`, `cache`, `bodyLimit`, `prettyJSON`, `serveStatic`, `jsxRenderer`, `timeout`, `trimTrailingSlash`, `methodOverride`, `languageDetector` and `poweredBy`. The mechanics of the chain that calls them are in [[Request Dispatch]], and the response helpers they reuse are in [[Context]].

Sources: [src/middleware/compress/index.ts:70-74](repo://src/middleware/compress/index.ts#L70-L74), [src/middleware/etag/index.ts:79-82](repo://src/middleware/etag/index.ts#L79-L82), [src/middleware/cache/index.ts:64-66](repo://src/middleware/cache/index.ts#L64-L66), [src/middleware/body-limit/index.ts:50-55](repo://src/middleware/body-limit/index.ts#L50-L55)

## Compression

`compress` picks an encoding from the request's `Accept-Encoding` header. The candidates are `gzip` and `deflate`, or the single encoding given in the options. Each candidate's quality value is read from the header, and a wildcard sets the value for any candidate it does not name; the highest value above zero wins, and a value of `1` wins at once.

Sources: [src/middleware/compress/index.ts:44-68](repo://src/middleware/compress/index.ts#L44-L68), [src/middleware/compress/index.ts:70-75](repo://src/middleware/compress/index.ts#L70-L75)

The body is compressed only when it is at least `threshold` bytes (default `1024`), when the `Content-Type` matches the compressible-type filter, and when the response does not carry `Cache-Control: no-transform`. A response that does not pass these checks is sent unchanged.

Sources: [src/middleware/compress/index.ts:70-75](repo://src/middleware/compress/index.ts#L70-L75), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129)

## Conditional responses

`etag` hashes the response body and sets an `ETag` header. The default digest is SHA-1 from `crypto.subtle`, and a `generateDigest` option replaces it. When the request's `If-None-Match` lists the same tag, the middleware answers `304` with an empty body and keeps only the headers in `RETAINED_304_HEADERS`, such as `ETag`, `Cache-Control` and `Vary`.

Sources: [src/middleware/etag/index.ts:21-27](repo://src/middleware/etag/index.ts#L21-L27), [src/middleware/etag/index.ts:30-54](repo://src/middleware/etag/index.ts#L30-L54), [src/middleware/etag/index.ts:79-100](repo://src/middleware/etag/index.ts#L79-L100)

Tags are compared without their `W/` weak prefix, so a weak and a strong tag with the same value match.

Sources: [src/middleware/etag/index.ts:30-36](repo://src/middleware/etag/index.ts#L30-L36)

## Caching

`cache` stores responses in the Cache API, `caches.open(cacheName)`. Only responses whose status is in `cacheableStatusCodes` are stored, and the default is `200` alone. The middleware does not store a response that has `Cache-Control` with `private`, `no-store` or `no-cache`, a `Set-Cookie` header, or a `Vary` header whose names are not listed in its options.

Sources: [src/middleware/cache/index.ts:13-22](repo://src/middleware/cache/index.ts#L13-L22), [src/middleware/cache/index.ts:100-103](repo://src/middleware/cache/index.ts#L100-L103), [src/middleware/cache/index.ts:158-161](repo://src/middleware/cache/index.ts#L158-L161)

When `globalThis.caches` is missing, the middleware does not run its logic: it logs a message, or calls `onCacheNotAvailable`, and passes the request through.

Sources: [src/middleware/cache/index.ts:64-90](repo://src/middleware/cache/index.ts#L64-L90)

## Body limit

`bodyLimit({ maxSize })` refuses a body that is larger than `maxSize` bytes with `413 Payload Too Large`. When the request has a `Content-Length` and no `Transfer-Encoding`, the header is compared first, and the body is not read. Otherwise the middleware reads the body chunk by chunk and counts the bytes, so a request that lies about its length is still stopped.

Sources: [src/middleware/body-limit/index.ts:50-79](repo://src/middleware/body-limit/index.ts#L50-L79)

## Static files

`serveStatic` is not used directly. The file system is specific to each runtime, so each adapter wraps it with its own `getContent` function. The shared part maps the request path to a file, adds `index.html` for a directory, and refuses paths that contain `..` segments or repeated separators.

Sources: [src/middleware/serve-static/index.ts:30-35](repo://src/middleware/serve-static/index.ts#L30-L35), [src/middleware/serve-static/index.ts:80-100](repo://src/middleware/serve-static/index.ts#L80-L100)

The content type is taken from the file extension through `getMimeType`. The runtime's `getContent` receives the resolved path and the context, and returns the body to send.

Sources: [src/middleware/serve-static/index.ts:8-10](repo://src/middleware/serve-static/index.ts#L8-L10), [src/middleware/serve-static/index.ts:35-45](repo://src/middleware/serve-static/index.ts#L35-L45)

## Layouts with JSX

`jsxRenderer` installs a renderer on the context with `setRenderer`. The renderer wraps the handler's JSX in a layout component and renders it as HTML. Its `docType` option defaults to `<!DOCTYPE html>`, and `false` or a string replaces it. The layout is read from the context with `getLayout`, so a route can override it with `setLayout`.

Sources: [src/middleware/jsx-renderer/index.ts:116-127](repo://src/middleware/jsx-renderer/index.ts#L116-L127), [src/middleware/jsx-renderer/index.ts:36-55](repo://src/middleware/jsx-renderer/index.ts#L36-L55)

## Timeout

`timeout(duration)` races the rest of the chain against a timer. If the timer fires first, the promise rejects with the `HTTPException` for `504`, or with the exception that a function option returns. The timer is cleared in a `finally` block, so a fast response leaves no timer behind.

Sources: [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58)

## Trailing slash

`trimTrailingSlash` removes a trailing slash from a `GET` or `HEAD` path. With `alwaysRedirect`, it sends a `301` redirect before the chain runs. Without it, the chain runs first, and only a `404` answer is replaced by a `301` redirect to the path without the slash.

Sources: [src/middleware/trailing-slash/index.ts:44-72](repo://src/middleware/trailing-slash/index.ts#L44-L72)

## Method override

`methodOverride` reads a method name from a form field `_method` by default, or from a header or a query parameter when one is named in the options, and replaces the request's method. `GET` requests are passed through. The rewritten request is sent to the `app` option's `fetch`, so the app routes it again with the new method.

Sources: [src/middleware/method-override/index.ts:33-35](repo://src/middleware/method-override/index.ts#L33-L35), [src/middleware/method-override/index.ts:60-70](repo://src/middleware/method-override/index.ts#L60-L70), [src/middleware/method-override/index.ts:86-89](repo://src/middleware/method-override/index.ts#L86-L89)

## Language detection

`languageDetector` tries the detectors named in `order`, which defaults to the query string, the cookie and the header, and the first language found is kept. It stores that language on the context as `language`. The `caches` option can store the choice in a cookie named by `lookupCookie`, and the default is `cookie`.

Sources: [src/middleware/language/language.ts:52-57](repo://src/middleware/language/language.ts#L52-L57), [src/middleware/language/language.ts:232-254](repo://src/middleware/language/language.ts#L232-L254), [src/middleware/language/language.ts:283-299](repo://src/middleware/language/language.ts#L283-L299)

## Pretty JSON and powered-by

`prettyJSON` indents a JSON response with two spaces when the request has a `pretty` query parameter, or when `force` is set. It runs after the chain, reads the body, and replaces `c.res` with the indented text.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

`poweredBy` sets `X-Powered-By` to `Hono`, or to the `serverName` option, after the chain runs. The secure-headers middleware removes that header again when its own option is set.

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)
