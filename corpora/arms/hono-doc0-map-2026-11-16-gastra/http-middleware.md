---
title: "HTTP Middleware"
---
## Overview

HTTP middleware wraps ordinary handlers to record request activity, select request-local values, normalize requests, or change downstream responses. The continuation and error rules are defined in [[Routing and Middleware Execution]]. Authentication and browser policy belong to [[Security Middleware]]; this catalogue covers the middleware that manages the rest of the HTTP exchange.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/language/language.ts:283-299](repo://src/middleware/language/language.ts#L283-L299), [src/middleware/compress/index.ts:86-120](repo://src/middleware/compress/index.ts#L86-L120)

## Observe and carry request state

| Middleware | Behavior and configuration |
| --- | --- |
| `logger` | Prints incoming method/path and outgoing status/elapsed time; accepts a custom print function |
| `requestId` | Reuses a valid incoming ID or generates one, stores requestId, and optionally writes the response header |
| `timing` | Collects metrics and timers, then appends Server-Timing when enabled |
| `contextStorage` | Runs downstream work inside AsyncLocalStorage so helper code can retrieve the context |
| `poweredBy` | Sets X-Powered-By after downstream work, defaulting to Hono |

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/timing/timing.ts:84-125](repo://src/middleware/timing/timing.ts#L84-L125), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

Request IDs default to the X-Request-Id header, a 255-character limit, and crypto.randomUUID. Missing IDs, oversized IDs, and values outside the allowed word/hyphen/equal character set are replaced. Context storage imports node:async_hooks; `tryGetContext` returns undefined outside a stored scope, while `getContext` throws. These are distinct ways to expose the request variables documented in [[Request and Context]].

Sources: [src/middleware/request-id/request-id.ts:41-57](repo://src/middleware/request-id/request-id.ts#L41-L57), [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

Timing avoids reinitializing an existing metric context. It can start a total timer, end remaining timers automatically, conditionally emit headers, and permit cross-origin timing access. `setMetric` adds numeric durations or descriptive metrics; without initialized metrics it logs a warning and returns. Its header is produced after the downstream handler, so recorded metrics are available before serialization.

Sources: [src/middleware/timing/timing.ts:84-125](repo://src/middleware/timing/timing.ts#L84-L125), [src/middleware/timing/timing.ts:149-172](repo://src/middleware/timing/timing.ts#L149-L172)

## Normalize and select requests

Trailing-slash middleware defaults to redirecting eligible GET/HEAD requests only after a downstream 404. The trim variant excludes the root path and removes the final slash; the append variant adds one. `alwaysRedirect` moves that decision before handlers, and append also accepts a skip predicate. Redirects use status 301 and preserve the URL's other components through URL mutation.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-139](repo://src/middleware/trailing-slash/index.ts#L128-L139), [src/middleware/trailing-slash/index.ts:76-100](repo://src/middleware/trailing-slash/index.ts#L76-L100)

Method override skips GET. It reads the replacement method from a configured header or query parameter, or from a form field when neither is configured. It removes that override marker, constructs a replacement Request, and invokes the supplied application's fetch method with the same environment and available execution context. This performs another routing pass rather than changing the current match list.

Sources: [src/middleware/method-override/index.ts:60-147](repo://src/middleware/method-override/index.ts#L60-L147)

Language detection checks strategies in configured order and stores `language` before continuing. Defaults are querystring, cookie, then header, with an English fallback and cookie caching. Path detection is also available. Configuration rejects an unsupported fallback, negative path index, or unknown detector. Detector errors can be debug-logged and allow the next strategy to run.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:167-207](repo://src/middleware/language/language.ts#L167-L207), [src/middleware/language/language.ts:229-258](repo://src/middleware/language/language.ts#L229-L258), [src/middleware/language/language.ts:283-299](repo://src/middleware/language/language.ts#L283-L299)

## Cache complete responses

Cache middleware requires the host's global caches API. Without it, initialization invokes the configured availability callback, logs by default, or suppresses logging when requested, and returns pass-through middleware. The normal path skips non-GET requests and requests containing Authorization. Cache names and keys can be computed asynchronously; configured Vary header values are encoded into key variants.

Sources: [src/middleware/cache/index.ts:65-103](repo://src/middleware/cache/index.ts#L65-L103), [src/middleware/cache/index.ts:141-164](repo://src/middleware/cache/index.ts#L141-L164)

On a hit it returns a new response around cached data. On a miss it runs downstream, restricts storage to allowed statuses (200 by default), merges configured cache headers, and applies exclusion checks. Private, no-store, no-cache, Set-Cookie, and response Vary dimensions absent from the configured variants prevent storage. A configured Vary wildcard is rejected at initialization.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:88-138](repo://src/middleware/cache/index.ts#L88-L138), [src/middleware/cache/index.ts:158-175](repo://src/middleware/cache/index.ts#L158-L175)

The cache stores a clone of the response. With `wait: true`, middleware awaits the write; otherwise it passes the write promise to `c.executionCtx.waitUntil`. A runtime without that execution-context facility needs the awaited path. Runtime wrappers supplying execution context are described in [[Runtime Adapters]].

Sources: [src/middleware/cache/index.ts:177-182](repo://src/middleware/cache/index.ts#L177-L182), [src/context.ts:391-395](repo://src/context.ts#L391-L395)

## Transform downstream output

ETag middleware preserves an existing ETag or hashes a cloned body using its initialized digest generator. It compares If-None-Match and can replace the response with 304, retaining only configured headers. Weak generation and custom digest functions are options. Because generation reads a cloned body, this operation depends on response content rather than just request metadata.

Sources: [src/middleware/etag/index.ts:79-128](repo://src/middleware/etag/index.ts#L79-L128)

Compression runs after downstream handlers and selects an accepted encoding. It skips partial responses, existing content/transfer encoding, HEAD requests, known lengths below the threshold, nonmatching content types, and no-transform responses. When applied, it pipes the body through CompressionStream, deletes Content-Length, sets Content-Encoding, and converts a strong ETag into a weak one because the bytes changed.

Sources: [src/middleware/compress/index.ts:70-128](repo://src/middleware/compress/index.ts#L70-L128)

Pretty JSON uses the configured query parameter, defaulting to pretty, or a force option. For a selected JSON response it consumes the body and returns a new response with indented JSON, defaulting to two spaces. This changes body bytes, so its position relative to ETag generation determines which representation is hashed.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56), [src/middleware/etag/index.ts:84-105](repo://src/middleware/etag/index.ts#L84-L105)

## Delegate content and control execution

Static-serving middleware combines path decoding and checks, optional path rewriting, directory index handling, MIME selection, and precompressed file selection around a supplied `getContent` callback. Found content returns a response; missing content invokes onNotFound and continues. [[Runtime Adapters]] supplies the filesystem or asset-store implementation behind that common interface.

Sources: [src/middleware/serve-static/index.ts:35-124](repo://src/middleware/serve-static/index.ts#L35-L124)

The proxy helper constructs an outbound Request, removes hop-by-hop headers, and fetches with an optional custom implementation. Strict connection processing validates and removes headers named by Connection. It removes outbound Accept-Encoding and cleans response encoding/length metadata before returning a new response around the upstream body.

Sources: [src/helper/proxy/index.ts:50-90](repo://src/helper/proxy/index.ts#L50-L90), [src/helper/proxy/index.ts:170-189](repo://src/helper/proxy/index.ts#L170-L189)

Timeout races `next()` against a timer and clears the timer in finally. The default exception is 504 Gateway Timeout; a custom exception or context callback can replace it. The implementation does not abort downstream work. For conditional composition, `some` tries alternatives until one succeeds, `every` composes checks and rejects false conditions, and `except` skips a group when a predicate or path matches.

Sources: [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58), [src/middleware/combine/index.ts:38-68](repo://src/middleware/combine/index.ts#L38-L68), [src/middleware/combine/index.ts:99-116](repo://src/middleware/combine/index.ts#L99-L116), [src/middleware/combine/index.ts:141-164](repo://src/middleware/combine/index.ts#L141-L164)

