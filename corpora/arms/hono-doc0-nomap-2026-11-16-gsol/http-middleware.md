---
title: "HTTP Middleware"
---
## Overview

HTTP middleware observes a request or changes the response produced downstream. Its position in the routed chain determines which work it wraps and when it sees the response. [[Middleware and Errors]] explains that continuation order. This catalogue groups the built-in operations by their effect on the HTTP exchange; credential checks, origin policies, and admission limits belong to [[Security Middleware]], while asset lookup belongs to [[Static Files and Generation]].

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/compress/index.ts:86-120](repo://src/middleware/compress/index.ts#L86-L120), [src/middleware/body-limit/index.ts:61-109](repo://src/middleware/body-limit/index.ts#L61-L109), [src/middleware/serve-static/index.ts:1-25](repo://src/middleware/serve-static/index.ts#L1-L25)

## Observe requests

| Middleware | Behavior and principal configuration |
| --- | --- |
| `logger` | Logs incoming method/path and outgoing status/duration; accepts a print function |
| `requestId` | Reuses an acceptable incoming identifier or generates one; sets the context variable and response header |
| `timing` | Collects metrics and timers and appends `Server-Timing` after continuation |
| `poweredBy` | Sets `X-Powered-By` after continuation, defaulting to `Hono` |
| `timeout` | Races continuation against a millisecond timer, defaulting to HTTPException 504 |

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35), [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58)

Request IDs default to header `X-Request-Id`, maximum length 255, and `crypto.randomUUID` generation. An absent, too-long, or disallowed-character input is replaced. The selected value is stored as `requestId` before downstream work, so other middleware can read it through the variable interface in [[Request and Context]]. An empty header name disables header lookup and response-header assignment while retaining generation and context storage.

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

Timing initializes the `metric` context value, starts an optional total timer, awaits downstream work, and ends total and outstanding timers when configured. It can conditionally emit timing headers and enable `Timing-Allow-Origin`. `setMetric`, `startTime`, `endTime`, and `wrapTime` add measurements; helpers warn when timing storage is absent. Timeout clears its timer in `finally`; the implementation races promises without aborting the downstream operation.

Sources: [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-173](repo://src/middleware/timing/timing.ts#L149-L173), [src/middleware/timing/timing.ts:187-225](repo://src/middleware/timing/timing.ts#L187-L225), [src/middleware/timing/timing.ts:244-257](repo://src/middleware/timing/timing.ts#L244-L257), [src/middleware/timeout/index.ts:42-56](repo://src/middleware/timeout/index.ts#L42-L56)

## Cache responses with variants

`cache` uses the runtime's global Cache API. When `caches` is absent, construction invokes the configured unavailable callback, logs by default, or suppresses logging when that option is false, then returns pass-through middleware. Cache names and keys can be context-dependent. Only GET requests without an Authorization header are considered; the default key is the request URL, extended with configured Vary header values. A cache hit returns a new response from the stored body and metadata.

Sources: [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103), [src/middleware/cache/index.ts:141-164](repo://src/middleware/cache/index.ts#L141-L164)

On a miss, the middleware awaits the handler, checks the allowed status set, merges configured cache-control and Vary headers, and evaluates cache eligibility. Default cacheable status is 200. It skips responses with Set-Cookie, private/no-store/no-cache directives, or response Vary dimensions not covered by the configured variants. Configured `vary: '*'` is rejected. With `wait: true` it awaits storage; otherwise it passes the put promise to `c.executionCtx.waitUntil`, requiring the execution context described in [[Runtime Adapters]].

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:91-139](repo://src/middleware/cache/index.ts#L91-L139), [src/middleware/cache/index.ts:166-182](repo://src/middleware/cache/index.ts#L166-L182)

## Apply validators and content transformations

ETag middleware reads `If-None-Match`, awaits the handler, and reuses an existing ETag or hashes a clone of the body. The default digest uses SHA-1 when Web Crypto is available; callers can supply a generator and request weak tags. Matching tags produce a null-body 304 and filter headers against the retained list. The wildcard conditional matches successful GET/HEAD responses. Otherwise the tag is set on the outgoing response.

Sources: [src/middleware/etag/index.ts:21-54](repo://src/middleware/etag/index.ts#L21-L54), [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128)

Compression supports gzip and deflate, selecting from Accept-Encoding quality values, with an optional fixed candidate. It defaults to a 1024-byte threshold and a built-in content-type filter. It skips partial content, existing content or transfer encodings, HEAD, known short lengths, unsuitable types, and `no-transform`. For an eligible body it pipes through `CompressionStream`, removes content length, sets content encoding, and weakens a strong ETag because the compressed bytes differ.

Sources: [src/middleware/compress/index.ts:12-43](repo://src/middleware/compress/index.ts#L12-L43), [src/middleware/compress/index.ts:70-128](repo://src/middleware/compress/index.ts#L70-L128)

`prettyJSON` reformats an application/json response when the configured query is present or `force` is true. Defaults are query `pretty` and two spaces. It consumes the response JSON and replaces the body with formatted JSON. This transformation and ETag generation both inspect bodies, whereas [[Streaming Responses]] exposes producers that emit incrementally; the compression skip for transfer encoding is relevant when those features are combined.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56), [src/middleware/etag/index.ts:89-104](repo://src/middleware/etag/index.ts#L89-L104), [src/middleware/compress/index.ts:91-107](repo://src/middleware/compress/index.ts#L91-L107), [src/helper/streaming/sse.ts:92-99](repo://src/helper/streaming/sse.ts#L92-L99)

## Normalize paths and methods

`trimTrailingSlash` and `appendTrailingSlash` redirect GET/HEAD requests with status 301. By default they first run downstream and redirect only a 404. `alwaysRedirect` performs the redirect before handlers, which the option comments identify as useful for wildcard routes. Trimming preserves `/`; appending supports a `skip(path)` predicate. This redirect policy is separate from the path extraction settings in [[Routing and Application Composition]].

Sources: [src/middleware/trailing-slash/index.ts:8-16](repo://src/middleware/trailing-slash/index.ts#L8-L16), [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

`methodOverride` leaves GET untouched. For other methods it reads an override from forms by default, or from a configured header or query parameter, removes the override input, constructs another request, and calls the configured application's `fetch`. Header takes precedence over query when both are configured. Without an override it continues. This is a fresh dispatch with the existing environment and available execution context, allowing the new method to select another route.

Sources: [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

## Negotiate representation and language

The `accepts` helper reads a configured accept header, parses it, and selects the highest-quality exact supported type, falling back to the configured default; a custom matcher can replace that selection. Language detection provides middleware over query, cookie, header, and path strategies. Defaults check query, cookie, then header, support English, and cache through a cookie. Normalization supports case-insensitive matching, an optional converter, and progressive truncation of language subtags.

Sources: [src/helper/accepts/accepts.ts:21-49](repo://src/helper/accepts/accepts.ts#L21-L49), [src/middleware/language/language.ts:51-121](repo://src/middleware/language/language.ts#L51-L121), [src/middleware/language/language.ts:177-182](repo://src/middleware/language/language.ts#L177-L182), [src/middleware/language/language.ts:219-300](repo://src/middleware/language/language.ts#L219-L300)

## Forward an upstream response

`proxy` constructs a standard request, optionally carrying raw request method/body/headers/signal and explicit overrides, and invokes `customFetch` or global fetch. It removes request Accept-Encoding, removes hop-by-hop response headers, and removes content encoding and length when the fetched response had content encoding. Raw-request forwarding removes hop-by-hop headers; optional strict connection processing also validates and removes the header names listed by Connection, returning HTTPException 400 for invalid names. The source documents strict processing for trusted environments.

Sources: [src/helper/proxy/index.ts:9-43](repo://src/helper/proxy/index.ts#L9-L43), [src/helper/proxy/index.ts:50-90](repo://src/helper/proxy/index.ts#L50-L90), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)
