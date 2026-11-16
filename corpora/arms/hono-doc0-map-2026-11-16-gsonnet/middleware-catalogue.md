---
title: "Built-in Middleware Catalogue"
---
## Overview

Every built-in middleware is a function that takes options and returns a `MiddlewareHandler`, `async (c, next) => ...`. Work before `await next()` sees the request; work after it sees the response the rest of the chain produced in `c.res`. A middleware can also end the chain early by returning a `Response` or throwing an `HTTPException`. Each lives under its own `hono/<name>` subpath. This page lists the non-authentication ones by purpose; auth is in [[Authentication Middleware and JWT]], static file serving in [[Runtime Adapters]], and JSX rendering in [[JSX Server Rendering]].

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/compose.ts:42-72](repo://src/compose.ts#L42-L72)

| Purpose | Middleware |
| --- | --- |
| Cross-origin and request origin checks | `cors`, `csrf`, `ipRestriction` |
| Response headers | `secureHeaders`, `poweredBy`, `timing` |
| Response size and caching | `etag`, `cache`, `compress`, `bodyLimit` |
| Response shape and URL form | `prettyJSON`, `trimTrailingSlash`, `appendTrailingSlash` |
| Observability and limits | `logger`, `requestId`, `timeout` |
| Request interpretation | `methodOverride`, `languageDetector` |
| Composition and context access | `some`, `every`, `except`, `contextStorage` |

Sources: [src/middleware/cors/index.ts:63-157](repo://src/middleware/cors/index.ts#L63-L157), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279), [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69)

## Origin and access control

**`cors(options)`** answers cross-origin requests. Defaults are `origin: '*'` and the methods `GET, HEAD, PUT, POST, DELETE, PATCH`. `origin` can be a string, an array, or a function of `(origin, c)`; the middleware sets `Access-Control-Allow-Origin` only when the request's origin is allowed. For an `OPTIONS` preflight it adds max-age, allowed methods and allowed headers (echoing `Access-Control-Request-Headers` when none are configured), removes content headers, and returns an empty `204` itself without calling `next()`. For other methods it calls `next()` and appends `Vary: Origin` when the origin is not `*`.

Sources: [src/middleware/cors/index.ts:63-156](repo://src/middleware/cors/index.ts#L63-L156)

**`csrf(options)`** rejects cross-site form submissions. It only checks requests that are not `GET` or `HEAD` and whose content type is one a form can send (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, and no content type counts as `text/plain`). Such a request is refused with a 403 `HTTPException` unless its `Sec-Fetch-Site` header is allowed (default: only `same-origin`) or its `Origin` header is allowed (default: equal to the request URL's origin). A missing header counts as not allowed. Both checks accept a string, an array or a function.

Sources: [src/middleware/csrf/index.ts:12-31](repo://src/middleware/csrf/index.ts#L12-L31), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151)

**`ipRestriction(getIP, { denyList, allowList }, onError)`** gates by client address. `getIP` is a connection-info getter (see [[Helpers Catalogue]]) or a function returning a string. Rules are exact IPv4 or IPv6 addresses, CIDR ranges, `*`, or functions; `buildMatcher` precompiles them into sets of binary addresses and masks, and treats IPv4-mapped IPv6 addresses as their IPv4 form. A match on the deny list blocks; otherwise a match on the allow list passes; if an allow list exists and nothing matched, the request is blocked; with an empty allow list it passes. Blocking calls `onError` or throws a 403 `Forbidden`; an invalid address is also blocked.

Sources: [src/middleware/ip-restriction/index.ts:51-167](repo://src/middleware/ip-restriction/index.ts#L51-L167), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

**`bodyLimit({ maxSize, onError })`** enforces a request body size limit. With only `Content-Length` present it trusts it and rejects when it exceeds `maxSize`. With `Transfer-Encoding` (or no length header) it reads the whole body first, rejects once the running size passes the limit, and otherwise replaces `c.req.raw` with a new request carrying the buffered chunks. The default failure is a 413 `Payload Too Large` `HTTPException`.

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111)

## Response headers

**`secureHeaders(options)`** sets a bundle of security headers. `HEADERS_MAP` pairs each option with its header and default value (for example `X-Content-Type-Options: nosniff`, `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `X-Frame-Options: SAMEORIGIN`), and the defaults enable all of them except `crossOriginEmbedderPolicy`. A string option overrides the value and `false` turns the header off. Content-Security-Policy (and its report-only form), Permissions-Policy, Reporting-Endpoints and Report-To are added when configured. By default it removes `X-Powered-By`.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229)

CSP values may be functions. The exported `NONCE` handler generates 16 random bytes in base64, stores them in the context variable `secureHeadersNonce`, and yields `'nonce-...'`. Callbacks run before `next()` so a page rendered by a later handler can read the nonce.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228)

**`poweredBy({ serverName })`** sets `X-Powered-By` to `Hono` (or `serverName`) after `next()`.

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

**`timing(options)`** produces a `Server-Timing` header. It stores a `metric` object in the context, times the whole request as `total` by default, and appends the collected metrics after `next()`; `enabled` can switch it off and `crossOrigin` adds `Timing-Allow-Origin`. The exported `setMetric`, `startTime`, `endTime` and `wrapTime` add custom metrics, and warn when `timing()` is not installed.

Sources: [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

## Caching and response size

**`etag(options)`** adds validators and answers conditional requests. After `next()` it uses the response's `ETag` or computes a SHA-1 digest of the body (a custom `generateDigest` is accepted; `weak` produces `W/"..."`). If `If-None-Match` matches, comparing weak tags loosely, or is `*` on a successful GET or HEAD, it replaces the response with an empty `304` that keeps only `RETAINED_304_HEADERS` (`cache-control`, `content-location`, `date`, `etag`, `expires`, `vary`). Otherwise it sets the `ETag` header.

Sources: [src/middleware/etag/index.ts:21-36](repo://src/middleware/etag/index.ts#L21-L36), [src/middleware/etag/index.ts:79-129](repo://src/middleware/etag/index.ts#L79-L129)

**`cache({ cacheName, ... })`** stores responses in the Web Cache API. Without `globalThis.caches` it logs once (or calls `onCacheNotAvailable`) and does nothing. It only handles `GET` requests that have no `Authorization` header; the key is the URL (or `keyGenerator`) plus the values of the `vary` request headers. A hit is returned directly. A miss runs the chain, and the response is stored only when its status is cacheable (default 200), it has no `Set-Cookie`, no `private` or `no-store`/`no-cache` in `Cache-Control`, and no `Vary` header beyond the configured ones. The `cacheControl` and `vary` options add those headers. Storing uses `executionCtx.waitUntil` unless `wait` is true; a `*` in `vary` is rejected.

Sources: [src/middleware/cache/index.ts:13-36](repo://src/middleware/cache/index.ts#L13-L36), [src/middleware/cache/index.ts:64-183](repo://src/middleware/cache/index.ts#L64-L183)

**`compress({ encoding, threshold, contentTypeFilter })`** compresses the response with `CompressionStream`, `gzip` or `deflate`, chosen from `Accept-Encoding` by quality value. After `next()` it skips partial (206) responses, already encoded or chunked ones, `HEAD`, bodies below the `threshold` (default 1024 bytes when `Content-Length` is known), non-compressible content types, and `Cache-Control: no-transform`. It drops `Content-Length`, sets `Content-Encoding` and turns a strong `ETag` into a weak one.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:70-129](repo://src/middleware/compress/index.ts#L70-L129)

## Response shape and URLs

**`prettyJSON({ space, query, force })`** re-serialises JSON responses with indentation (2 spaces by default) when the query string contains `pretty` (or the name given in `query`) or `force` is set.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

**`trimTrailingSlash`** and **`appendTrailingSlash`** redirect with a 301 to the form without or with a trailing slash, for `GET` and `HEAD` only. By default they act only when the response would be a 404 after `next()`; with `alwaysRedirect: true` they redirect before running handlers, which the option's comment recommends for wildcard routes. `appendTrailingSlash` also takes a `skip(path)` function, for example to leave file paths alone.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:76-158](repo://src/middleware/trailing-slash/index.ts#L76-L158)

## Observability and limits

**`logger(fn)`** prints `<-- METHOD path` on arrival and `--> METHOD path status elapsed` when the response is ready, through `console.log` or the function you pass. The status is coloured by class when colour is enabled, and elapsed time is shown in `ms` or `s`.

Sources: [src/middleware/logger/index.ts:9-63](repo://src/middleware/logger/index.ts#L9-L63), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

**`requestId({ limitLength, headerName, generator })`** reuses an incoming `X-Request-Id` when it is at most 255 characters of word characters, `-` or `=`, and otherwise generates one with `crypto.randomUUID()`. It stores the id in the `requestId` variable and sets it on the response header.

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

**`timeout(duration, exception)`** races `next()` against a timer. When the timer wins it rejects with a 504 `Gateway Timeout` `HTTPException` (or the exception, or exception function, you pass); the timer is cleared in all cases.

Sources: [src/middleware/timeout/index.ts:12-58](repo://src/middleware/timeout/index.ts#L12-L58)

## Request interpretation

**`methodOverride({ app, form | header | query })`** lets clients that can only send `POST` use other methods. Non-`GET` requests are checked for an override: a `_method` form field by default (urlencoded or multipart), a named header, or a named query parameter. When found, the override is removed from the request and the **given app** is called again with `app.fetch(newRequest, c.env, executionCtx)`, so routing restarts with the new method; otherwise the chain continues.

Sources: [src/middleware/method-override/index.ts:11-34](repo://src/middleware/method-override/index.ts#L11-L34), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

**`languageDetector(options)`** picks a language and stores it in the `language` variable. It tries the detectors in `order` (default `querystring`, `cookie`, `header`; `path` is also available), each normalising against `supportedLanguages` with an exact match and then progressive truncation like `en-US` to `en`. The first result wins, otherwise `fallbackLanguage` is used (it must be in the supported list, or creation throws). By default the result is cached in a cookie named `language` with strict, secure, http-only settings.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:177-282](repo://src/middleware/language/language.ts#L177-L282), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300)

## Composition and context access

**`some(...)`**, **`every(...)`** and **`except(condition, ...middleware)`** combine middleware. `some` runs each in turn until one succeeds (a `Condition` function returning true continues to `next()`, returning false tries the next one) and throws the last error if none did. `every` runs them in order through `compose` and fails with `Unmet condition` when a condition returns false. `except` applies its middleware to every request except those matching a path pattern (matched with a `TrieRouter`) or condition.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

**`contextStorage()`** runs the rest of the chain inside an `AsyncLocalStorage` holding the `Context`, so code far from a handler can call `getContext()` (throws `Context is not available` outside a request) or `tryGetContext()`.

Sources: [src/middleware/context-storage/index.ts:10-59](repo://src/middleware/context-storage/index.ts#L10-L59)
