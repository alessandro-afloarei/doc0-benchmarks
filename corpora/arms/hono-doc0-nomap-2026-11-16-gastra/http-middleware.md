---
title: "HTTP and Observability Middleware"
---
## Overview

These middleware and helpers transform, observe or redirect an HTTP exchange. Many run work after `await next()`, so they see the response produced downstream; cache middleware can instead return a stored response before invoking the handler. Use the execution rules in [[Request Context and Middleware]] when choosing registration order. Authentication and browser security policies have their own catalogue in [[Security Middleware]].

Sources: [src/middleware/cache/index.ts:141-183](repo://src/middleware/cache/index.ts#L141-L183), [src/middleware/compress/index.ts:86-121](repo://src/middleware/compress/index.ts#L86-L121), [src/compose.ts:49-70](repo://src/compose.ts#L49-L70)

## Cache responses

`cache` uses the runtime's `globalThis.caches`. If unavailable at construction, it returns pass-through middleware and invokes the configured availability callback, logs by default, or stays quiet when that option is false. Configuration includes the cache name, key generator, response cache-control directives, varied request headers and cacheable statuses, which default to 200. Configured `vary: '*'` is rejected when caching is available.

Sources: [src/middleware/cache/index.ts:13-16](repo://src/middleware/cache/index.ts#L13-L16), [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103)

Only GET requests without an Authorization header enter the cache lookup. The key defaults to the request URL and appends configured request-header variants. A hit returns a fresh response around the cached body and metadata. On a miss, middleware runs downstream, checks the resulting status, merges configured headers and decides whether to store a clone. `wait: true` awaits the write; otherwise the code schedules it through `c.executionCtx.waitUntil`, so that mode requires an execution context.

Sources: [src/middleware/cache/index.ts:105-183](repo://src/middleware/cache/index.ts#L105-L183)

Responses with `Set-Cookie`, private/no-store/no-cache directives, or response `Vary` fields absent from the configured variants are skipped. Configured cache-control directives supplement existing directive names rather than replacing them. This matters when a downstream language detector or application handler sets cookies: a nominally successful GET can still be intentionally excluded from storage.

Sources: [src/middleware/cache/index.ts:15-35](repo://src/middleware/cache/index.ts#L15-L35), [src/middleware/cache/index.ts:105-139](repo://src/middleware/cache/index.ts#L105-L139), [src/middleware/cache/index.ts:166-182](repo://src/middleware/cache/index.ts#L166-L182), [src/middleware/language/language.ts:212-223](repo://src/middleware/language/language.ts#L212-L223)

## Conditional and compressed output

`etag` runs after the handler, reuses an existing ETag or computes one from a cloned response body. Its default digest uses SHA-1 when available; a custom generator and weak-tag option are supported. If no generator or digest is available, generation stops. Matching `If-None-Match` replaces the response with a bodyless 304 and retains only configured headers. The wildcard comparison is limited to successful GET or HEAD responses; listed tags are compared after stripping weak prefixes.

Sources: [src/middleware/etag/index.ts:21-54](repo://src/middleware/etag/index.ts#L21-L54), [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128)

`compress` negotiates gzip or deflate using accepted quality values; an explicit encoding option restricts candidates. It skips partial responses, already encoded or chunked responses, HEAD, known lengths below the threshold, excluded content types and `no-transform`. The default threshold is 1024 bytes, but the size check uses Content-Length rather than buffering unknown-size bodies. Compression pipes through `CompressionStream`, removes Content-Length and sets Content-Encoding. An existing strong ETag becomes weak because the compressed bytes differ.

Sources: [src/middleware/compress/index.ts:12-44](repo://src/middleware/compress/index.ts#L12-L44), [src/middleware/compress/index.ts:70-128](repo://src/middleware/compress/index.ts#L70-L128)

`prettyJSON` rewrites JSON responses when its query switch is present or `force` is enabled, defaulting to the `pretty` query key and two-space indentation. It reads and reserializes the body after downstream execution. `poweredBy` sets `X-Powered-By` afterward, defaulting to `Hono`; the secure-headers middleware can remove that header during its own post-processing. Their observable interaction therefore follows middleware unwind order.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228), [src/compose.ts:49-51](repo://src/compose.ts#L49-L51)

## Normalize paths and methods

`trimTrailingSlash` and `appendTrailingSlash` redirect GET or HEAD requests with 301. By default they wait for a downstream 404 before changing the path. `alwaysRedirect` moves the decision before downstream execution; append also supports a path-skipping callback, and trim preserves the root path. This changes the client's URL, whereas non-strict routing in [[Routing]] changes path matching without issuing a redirect.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158), [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

`methodOverride` takes the target application and reads an override from a form field, header or query parameter. It skips GET, removes the override value from the reconstructed input, and redispatches through `app.fetch` with the environment and available execution context. Form mode defaults to `_method` and supports multipart and URL-encoded input. Without an override, it continues the existing chain.

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

## Observe requests and bound waiting

| Middleware | Behavior and options |
| --- | --- |
| `logger` | Logs incoming method/path and outgoing status/elapsed time through a supplied print function or `console.log` |
| `requestId` | Accepts a constrained incoming identifier or generates one; stores `requestId` and writes the configured response header |
| `timing` | Collects named metrics and timers, then emits Server-Timing and optional Timing-Allow-Origin |
| `timeout` | Races downstream execution against a timer; defaults to a 504 HTTPException |

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58)

Request IDs default to `X-Request-Id`, maximum incoming length 255 and `crypto.randomUUID`. Missing, excessive-length or disallowed-character inputs cause generation. Timing defaults to total-duration measurement and auto-ending open timers; `startTime`, `endTime`, `setMetric` and `wrapTime` operate on the request's metric state. Timeout clears its timer in a finally block, but its implementation only races promises: it does not abort the downstream operation.

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-224](repo://src/middleware/timing/timing.ts#L149-L224), [src/middleware/timing/timing.ts:244-257](repo://src/middleware/timing/timing.ts#L244-L257), [src/middleware/timeout/index.ts:42-57](repo://src/middleware/timeout/index.ts#L42-L57)

## Context and negotiation helpers

`contextStorage` runs downstream work inside `AsyncLocalStorage` imported from `node:async_hooks`. `tryGetContext` returns the active context or undefined; `getContext` throws when none is available. It extends request-local state access from [[Request Context and Middleware]] to functions without an explicit context argument, and requires a runtime supporting that imported API.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

`languageDetector` checks query, cookie and header in that default order, with optional path detection. It matches configured languages, progressively truncates language subtags and falls back to a configured supported language. Successful detection can set a cookie, and the selected language is stored in context. The smaller `accepts` helper reads a configured Accept-family header, picks a supported value by quality, or returns the configured default; callers may supply a custom matcher.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:84-123](repo://src/middleware/language/language.ts#L84-L123), [src/middleware/language/language.ts:229-258](repo://src/middleware/language/language.ts#L229-L258), [src/middleware/language/language.ts:283-300](repo://src/middleware/language/language.ts#L283-L300), [src/helper/accepts/accepts.ts:21-49](repo://src/helper/accepts/accepts.ts#L21-L49)

## Conditional chains and proxying

`some` tries middleware until one succeeds, treating false conditions or pre-next exceptions as failures; once downstream execution has begun, its error is not used to try another alternative. `every` composes a chain and throws for a false condition, preserving the outer route index. `except` uses predicate or trie path matches to skip its wrapped chain. These utilities combine the policies from [[Security Middleware]] without adding route registrations for each alternative.

Sources: [src/middleware/combine/index.ts:38-68](repo://src/middleware/combine/index.ts#L38-L68), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

The `proxy` helper forwards a constructed request through custom or global fetch. When given a raw request, it removes standard hop-by-hop headers; optional strict connection processing validates and removes headers named by Connection. It deletes outgoing Accept-Encoding and removes hop-by-hop response headers. If the upstream response has Content-Encoding, the returned response drops that and Content-Length. Static-resource lookup is a separate flow in [[Runtime Adapters and Static Files]].

Sources: [src/helper/proxy/index.ts:10-22](repo://src/helper/proxy/index.ts#L10-L22), [src/helper/proxy/index.ts:50-90](repo://src/helper/proxy/index.ts#L50-L90), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)
