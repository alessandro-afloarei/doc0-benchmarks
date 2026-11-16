---
title: "Logging, Timing and Request IDs"
---
## Overview

Three small middleware help observe what an app does. `logger` prints a line when a request arrives and another when its response leaves. `timing` collects durations during the request and sends them in a `Server-Timing` header, which browser developer tools display. `requestId` gives every request an identifier that handlers can log and clients can read back. Each wraps the rest of the chain with `await next()` ([[Request Dispatch and Middleware]]).

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

| Middleware | Import | Output |
| --- | --- | --- |
| `logger` | `hono/logger` | Two lines per request through a print function |
| `timing` | `hono/timing` | `Server-Timing` (and optionally `Timing-Allow-Origin`) response headers |
| `requestId` | `hono/request-id` | `c.var.requestId` and an `X-Request-Id` response header |

Sources: [package.json:224-233](repo://package.json#L224-L233), [package.json:249-253](repo://package.json#L249-L253)

## logger

`logger(fn = console.log)` prints through `fn`, so logs can go to any sink that takes a string. Before `next()` it prints `<-- METHOD /path`; afterwards it prints `--> METHOD /path STATUS elapsed`. The path includes the query string, because it is sliced from the full URL after the host.

Sources: [src/middleware/logger/index.ts:9-13](repo://src/middleware/logger/index.ts#L9-L13), [src/middleware/logger/index.ts:48-95](repo://src/middleware/logger/index.ts#L48-L95)

```text
<-- GET /posts?page=2
--> GET /posts?page=2 200 12ms
```

Sources: [src/middleware/logger/index.ts:58-61](repo://src/middleware/logger/index.ts#L58-L61)

The elapsed time is shown in milliseconds below one second and in rounded seconds above it, with thousands separated by commas. When colour is enabled, the status is coloured by class: red for 5xx, yellow for 4xx, cyan for 3xx and green for 2xx; any other status is printed plain, and a comment notes that runtimes differ in which unusual statuses they accept.

Sources: [src/middleware/logger/index.ts:15-46](repo://src/middleware/logger/index.ts#L15-L46)

Colour is decided per line by `getColorEnabledAsync`. It reads `Deno.noColor` on Deno and the `NO_COLOR` environment variable on runtimes with `process`. On Cloudflare Workers, detected by `navigator.userAgent`, it imports `cloudflare:workers` and checks `NO_COLOR` in its `env`; the module name is kept in a variable so that bundlers do not try to resolve it, as a comment says.

Sources: [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

## timing

`timing(options?)` creates, for each request, a list of header entries and a map of running timers, and stores both in the Context as `metric`. The module augments `ContextVariableMap` with that variable. If `metric` is already set, because `timing` was registered twice on the same path, the second instance only calls `next()`.

Sources: [src/middleware/timing/timing.ts:10-28](repo://src/middleware/timing/timing.ts#L10-L28), [src/middleware/timing/timing.ts:85-93](repo://src/middleware/timing/timing.ts#L85-L93), [src/middleware/timing/index.ts:1-8](repo://src/middleware/timing/index.ts#L1-L8)

| Option | Default | Effect |
| --- | --- | --- |
| `total` | `true` | Times the whole chain as the metric `total` |
| `totalDescription` | `Total Response Time` | Description of `total` |
| `autoEnd` | `true` | Ends any timer still running when the chain returns |
| `enabled` | `true` | Whether to write the header; a boolean or a function of the Context |
| `crossOrigin` | `false` | Adds `Timing-Allow-Origin`: `*` for `true`, or the given string |

Sources: [src/middleware/timing/timing.ts:22-28](repo://src/middleware/timing/timing.ts#L22-L28), [src/middleware/timing/timing.ts:76-84](repo://src/middleware/timing/timing.ts#L76-L84)

After `next()`, it ends `total`, ends the remaining timers when `autoEnd` is on, and, when enabled, appends all collected entries joined by commas as one `Server-Timing` header.

Sources: [src/middleware/timing/timing.ts:98-125](repo://src/middleware/timing/timing.ts#L98-L125)

Handlers record their own metrics with these functions:

Sources: [src/middleware/timing/timing.ts:128-173](repo://src/middleware/timing/timing.ts#L128-L173), [src/middleware/timing/timing.ts:187-257](repo://src/middleware/timing/timing.ts#L187-L257)

| Function | Effect |
| --- | --- |
| `startTime(c, name, description?)` | Starts a timer |
| `endTime(c, name, precision?)` | Ends it and records `name;dur=…;desc="…"` |
| `setMetric(c, name, value, description?, precision?)` | Records a given duration |
| `setMetric(c, name, description?)` | Records a metric without a duration |
| `wrapTime(c, name, promise, description?, precision?)` | Times a promise, ending the timer in a `finally` |

Sources: [src/middleware/timing/timing.ts:128-173](repo://src/middleware/timing/timing.ts#L128-L173), [src/middleware/timing/timing.ts:187-257](repo://src/middleware/timing/timing.ts#L187-L257)

```ts
import { timing, startTime, endTime } from 'hono/timing'

app.use(timing())

app.get('/posts', async (c) => {
  startTime(c, 'db')
  const posts = await db.list()
  endTime(c, 'db')
  return c.json(posts)
})
```

Sources: [src/middleware/timing/timing.ts:187-225](repo://src/middleware/timing/timing.ts#L187-L225)

Durations come from `performance.now()`, falling back to `Date.now()`, and are written with one decimal unless a precision is given. Calling these functions on a route without `timing()` logs a warning instead of throwing, as does ending a timer that was never started.

Sources: [src/middleware/timing/timing.ts:30-35](repo://src/middleware/timing/timing.ts#L30-L35), [src/middleware/timing/timing.ts:149-173](repo://src/middleware/timing/timing.ts#L149-L173), [src/middleware/timing/timing.ts:208-225](repo://src/middleware/timing/timing.ts#L208-L225)

## requestId

`requestId(options?)` reuses the ID from the request's `X-Request-Id` header when it is present, at most `limitLength` (255) characters long, and made only of word characters, `-` and `=`. Otherwise it calls `generator(c)`, by default `crypto.randomUUID()`.

Sources: [src/middleware/request-id/request-id.ts:13-51](repo://src/middleware/request-id/request-id.ts#L13-L51)

The ID is stored as `c.var.requestId`, typed through `ContextVariableMap`, and written to the response header of the same name. With `headerName: ''`, no header is read or written, and every request gets a generated ID.

Sources: [src/middleware/request-id/request-id.ts:46-58](repo://src/middleware/request-id/request-id.ts#L46-L58), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)
