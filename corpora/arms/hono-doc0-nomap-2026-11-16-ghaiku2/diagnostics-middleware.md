---
title: "Diagnostics Middleware"
---
## Overview

The diagnostics middleware records what a request did and lets middleware share state. `logger` prints one line when a request arrives and one when its response is ready, `timing` adds a `Server-Timing` header, `requestId` gives each request an identifier, and `contextStorage` makes the current context reachable from code that does not receive it. `combine` (`some`, `every` and `except`) is the composition helper for choosing which middleware run. The chain that these middleware run in is described in [[Request Dispatch]], and the context they read is described in [[Context]].

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-115](repo://src/middleware/timing/timing.ts#L76-L115), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

## Logger

`logger(fn)` writes two lines per request. The first is logged before `next()` with the prefix `<--`, the method and the path. The second is logged after the chain with `-->`, the method, the path, the status code and the elapsed time. The `fn` argument replaces `console.log`, so a test or a log service can receive the lines.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/logger/index.ts:52-62](repo://src/middleware/logger/index.ts#L52-L62)

The status code is coloured by its class when the runtime supports colour: `5xx` red, `4xx` yellow. Elapsed time is printed in milliseconds below one second and in whole seconds above it, with thousands separators.

Sources: [src/middleware/logger/index.ts:15-50](repo://src/middleware/logger/index.ts#L15-L50)

## Timing

`timing(config)` creates a `Map` of timers and stores it on the context as `metric`. After the chain runs, it writes one `Server-Timing` header that lists the timers, and a total entry named `Total Response Time` unless `total` is turned off. The header is appended to any value already present, so several middleware can add entries.

Sources: [src/middleware/timing/timing.ts:76-115](repo://src/middleware/timing/timing.ts#L76-L115)

A handler adds an entry with `startTime(c, name)` and closes it with `endTime(c, name)`. `setMetric(c, name, value, description)` records a value that was measured elsewhere, with an optional precision. With `autoEnd` (default `true`), any timer still open when the chain finishes is closed automatically.

Sources: [src/middleware/timing/timing.ts:149-160](repo://src/middleware/timing/timing.ts#L149-L160), [src/middleware/timing/timing.ts:187-200](repo://src/middleware/timing/timing.ts#L187-L200), [src/middleware/timing/timing.ts:208-226](repo://src/middleware/timing/timing.ts#L208-L226), [src/middleware/timing/timing.ts:104-110](repo://src/middleware/timing/timing.ts#L104-L110)

## Request ID

`requestId()` takes the identifier from the `X-Request-Id` header when it is present, at most 255 characters long, and made only of word characters, `-` and `=`. Otherwise it calls the `generator` option, which defaults to `crypto.randomUUID()`. The identifier is stored on the context as `requestId` and echoed back in the response header.

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

## Context storage

`contextStorage()` runs the rest of the chain inside an `AsyncLocalStorage` that holds the current context. `getContext()` returns that context, and throws when the middleware is not on the chain; `tryGetContext()` returns `undefined` instead. This lets helper functions read the request without taking `c` as an argument.

Sources: [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

## Combining middleware

`some(...middleware)` runs its middleware in order until one succeeds. A middleware that returns `true` lets the rest of the chain run, one that returns `false` is skipped, and one that throws before calling `next()` is recorded. If every middleware fails, the last recorded error is thrown.

Sources: [src/middleware/combine/index.ts:38-70](repo://src/middleware/combine/index.ts#L38-L70)

`every(...middleware)` runs the middleware as one composed chain and throws `Unmet condition` when any of them returns `false`, so the chain stops at that point.

Sources: [src/middleware/combine/index.ts:99-122](repo://src/middleware/combine/index.ts#L99-L122)

`except(condition, ...middleware)` runs the middleware for every request except those that meet the condition. A string condition is registered in a `TrieRouter` and matched against the request path, and a function condition receives the context and returns a boolean. When the condition is met, the middleware are skipped and the chain continues.

Sources: [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)
