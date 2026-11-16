---
title: "HTTP Middleware"
---
## Overview

HTTP middleware can finish a request early, redispatch a transformed request, or adjust the response after downstream handlers complete. Its ordering follows [[Middleware and Errors]], and its header mutations use [[Request and Context]]. This catalogue follows normalization and negotiation into caching, response transformation and diagnostics. Authentication and browser request admission are described in [[Security Middleware]].

Sources: [src/middleware/method-override/index.ts:60-137](repo://src/middleware/method-override/index.ts#L60-L137), [src/middleware/cors/index.ts:96-155](repo://src/middleware/cors/index.ts#L96-L155), [src/middleware/compress/index.ts:86-120](repo://src/middleware/compress/index.ts#L86-L120)

## Request normalization

`methodOverride` accepts the target app and a form field, header or query parameter naming the replacement HTTP method. GET bypasses override. Form mode defaults to `_method`, removes the control field and rebuilds multipart or URL-encoded data. Header and query modes remove their control value before calling `app.fetch` with the replacement request, existing environment and available execution context. This starts routing again, so it is a request redispatch rather than a mutation of the already selected handler list.

Sources: [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

`trimTrailingSlash` and `appendTrailingSlash` produce 301 redirects for GET/HEAD. By default they first await downstream handling and redirect only a 404; `alwaysRedirect` makes the applicable redirect happen before handlers execute. Trimming excludes `/`. Appending supports a `skip(path)` predicate, including in the early redirect branch. These middleware change the URL seen by a subsequent request, whereas strict path extraction in [[Routing]] changes how the current request is matched.

Sources: [src/middleware/trailing-slash/index.ts:44-73](repo://src/middleware/trailing-slash/index.ts#L44-L73), [src/middleware/trailing-slash/index.ts:128-157](repo://src/middleware/trailing-slash/index.ts#L128-L157), [src/utils/url.ts:141-145](repo://src/utils/url.ts#L141-L145)

## CORS and negotiation

`cors` accepts a fixed origin, origin list or context-aware function, plus allowed methods, allowed/exposed headers, credentials and maximum age. The default origin is `*`. OPTIONS receives a 204 response with no content headers; if allowed headers are unspecified, the middleware reflects `Access-Control-Request-Headers`. Non-wildcard origin configuration adds `Vary: Origin`. A nonmatching origin suppresses its allow-origin header; it does not itself throw a request-admission error.

Sources: [src/middleware/cors/index.ts:63-155](repo://src/middleware/cors/index.ts#L63-L155)

`languageDetector` stores the selected language as `c.get('language')`. Defaults try query parameter `lang`, cookie `language`, then `accept-language`, with `en` as the sole supported and fallback language. Configuration can add a path detector, change lookup locations and convert detected values. Normalization prefers an exact supported match, then progressively truncates a regional language tag. Detection takes the first successful strategy, tolerates strategy errors and optionally caches detected values in a cookie.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:88-180](repo://src/middleware/language/language.ts#L88-L180), [src/middleware/language/language.ts:212-257](repo://src/middleware/language/language.ts#L212-L257), [src/middleware/language/language.ts:283-299](repo://src/middleware/language/language.ts#L283-L299)

For handler-local negotiation, `accepts` parses the selected Accept header and invokes a matcher. Its default matcher sorts descending by quality and chooses the first exact supported type, returning the configured default when none match or when the header is missing. A custom matcher receives both parsed values and configuration. This helper leaves the selected representation's response construction to the endpoint.

Sources: [src/helper/accepts/accepts.ts:11-24](repo://src/helper/accepts/accepts.ts#L11-L24), [src/helper/accepts/accepts.ts:40-48](repo://src/helper/accepts/accepts.ts#L40-L48)

## Response caching

`cache` uses `globalThis.caches`. If unavailable at middleware creation, it calls the configured notification or logs by default, then returns a pass-through middleware. When available it handles GET requests without `Authorization`, opens the configured cache name, builds a key from the URL or `keyGenerator`, and adds configured vary-header values. A cache hit returns a response immediately. The default cacheable status set contains only 200.

Sources: [src/middleware/cache/index.ts:10-13](repo://src/middleware/cache/index.ts#L10-L13), [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103), [src/middleware/cache/index.ts:141-169](repo://src/middleware/cache/index.ts#L141-L169)

After a miss, cache middleware merges its response headers and skips storing responses with `Set-Cookie`, private/no-store/no-cache directives, or response `Vary` values absent from its configured key variants. A configured `vary: '*'` is rejected. Storage clones the response and either awaits `cache.put` with `wait: true`, or schedules it through `c.executionCtx.waitUntil`. The default asynchronous storage path therefore requires an execution context supplied by the runtime.

Sources: [src/middleware/cache/index.ts:15-35](repo://src/middleware/cache/index.ts#L15-L35), [src/middleware/cache/index.ts:84-98](repo://src/middleware/cache/index.ts#L84-L98), [src/middleware/cache/index.ts:105-138](repo://src/middleware/cache/index.ts#L105-L138), [src/middleware/cache/index.ts:166-182](repo://src/middleware/cache/index.ts#L166-L182)

`etag` operates after downstream handling. It preserves an existing ETag or computes one from a cloned body when a digest generator is available, optionally using a weak tag. A matching `If-None-Match` produces a bodyless 304 and filters headers against `retainedHeaders`; otherwise it sets the tag. The wildcard request condition only matches successful GET/HEAD responses. Digest generation and retained headers are extension points for this conditional-response policy.

Sources: [src/middleware/etag/index.ts:61-66](repo://src/middleware/etag/index.ts#L61-L66), [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128)

## Representation transformations

Compression selects gzip or deflate using Accept-Encoding quality values and an optional fixed encoding. It skips HEAD, partial content, preexisting content/transfer encoding, known lengths below the default 1024-byte threshold, excluded content types and no-transform responses. Accepted bodies pass through `CompressionStream`; the middleware removes content length, records content encoding and weakens a strong ETag because compressed bytes differ. A missing content length does not trigger a full-body size measurement before compression.

Sources: [src/middleware/compress/index.ts:30-43](repo://src/middleware/compress/index.ts#L30-L43), [src/middleware/compress/index.ts:70-128](repo://src/middleware/compress/index.ts#L70-L128)

`prettyJSON` activates for its query parameter, including an empty query value, or `force: true`. After downstream completion it consumes JSON responses and replaces their body with indented JSON, using two spaces by default. Because both it and compression alter the representation after `next`, their actual execution order follows the unwinding rules in [[Middleware and Errors]].

Sources: [src/middleware/pretty-json/index.ts:46-55](repo://src/middleware/pretty-json/index.ts#L46-L55), [src/compose.ts:49-70](repo://src/compose.ts#L49-L70)

## Diagnostics and upstream responses

`logger` prints method/path on entry and status plus elapsed time on exit, with an overridable print function. `poweredBy` writes a configurable `X-Powered-By` after downstream handling. `requestId` accepts a valid incoming ID or generates one, stores it as `requestId`, and echoes it in the configured header. Defaults use `X-Request-Id`, a 255-character limit and `crypto.randomUUID`; disallowed characters also trigger generation.

Sources: [src/middleware/logger/index.ts:81-94](repo://src/middleware/logger/index.ts#L81-L94), [src/middleware/powered-by/index.ts:30-34](repo://src/middleware/powered-by/index.ts#L30-L34), [src/middleware/request-id/request-id.ts:41-58](repo://src/middleware/request-id/request-id.ts#L41-L58)

`timing` initializes metric state, starts a total timer by default, awaits downstream processing, and ends remaining timers when `autoEnd` is enabled. An enabled predicate controls appending `Server-Timing`; a separate cross-origin option controls `Timing-Allow-Origin`. If metric state already exists, another timing middleware passes through, avoiding a second set of timers for the same context.

Sources: [src/middleware/timing/timing.ts:76-125](repo://src/middleware/timing/timing.ts#L76-L125)

The `proxy` helper constructs an outgoing request, removes Accept-Encoding, calls a custom fetch or global fetch, and returns a new response with hop-by-hop headers removed. When the upstream includes content encoding it also removes content encoding and length from the returned headers. Strict connection processing additionally validates names listed by `Connection` and removes those headers, rejecting invalid names with 400. Request forwarding can therefore be part of the same response flow while preserving a deliberate boundary around transport-specific metadata.

Sources: [src/helper/proxy/index.ts:61-90](repo://src/helper/proxy/index.ts#L61-L90), [src/helper/proxy/index.ts:160-189](repo://src/helper/proxy/index.ts#L160-L189)
