---
title: "Logging, Timing and Request IDs"
---
## Overview

Three small middleware make requests visible. `logger` prints one line when a request arrives and one when its response leaves. `timing` collects durations and sends them in the `Server-Timing` header, where browser developer tools display them. `requestId` gives each request an identifier, taken from the client or generated, that handlers and logs can share. They wrap `next()` like every middleware on [[Middleware Composition and Error Handling]]; errors thrown by handlers have already been turned into responses when they log or measure.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

```ts
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { timing } from 'hono/timing'

app.use(requestId())
app.use(logger())
app.use(timing())
```

Sources: [src/middleware/logger/index.ts:81-81](repo://src/middleware/logger/index.ts#L81-L81), [src/middleware/timing/timing.ts:76-76](repo://src/middleware/timing/timing.ts#L76-L76), [src/middleware/request-id/request-id.ts:41-45](repo://src/middleware/request-id/request-id.ts#L41-L45)

## logger

### Output

`logger(fn = console.log)` prints, through `fn`, an incoming line before `next()` and an outgoing line after it:

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

```text
<-- GET /posts?page=2
--> GET /posts?page=2 200 12ms
```

Sources: [src/middleware/logger/index.ts:9-13](repo://src/middleware/logger/index.ts#L9-L13), [src/middleware/logger/index.ts:50-63](repo://src/middleware/logger/index.ts#L50-L63)

The path is everything after the host, including the query string. The elapsed time is measured with `Date.now()` and printed in milliseconds below one second and in whole seconds above, with thousands separators. Because the outgoing line is written after `next()` returns, the status is the final one, including an error handler's 500.

Sources: [src/middleware/logger/index.ts:15-26](repo://src/middleware/logger/index.ts#L15-L26), [src/middleware/logger/index.ts:83-93](repo://src/middleware/logger/index.ts#L83-L93)

Passing a custom `fn` sends the lines elsewhere, for example to a structured logger; `fn` receives the formatted string.

Sources: [src/middleware/logger/index.ts:48-48](repo://src/middleware/logger/index.ts#L48-L48)

### Colours

The status is coloured with ANSI codes by class: 5xx red, 4xx yellow, 3xx cyan, 2xx green; other codes are printed plain. Colour is on unless the environment opts out. `getColorEnabled` checks `Deno.noColor`, or `NO_COLOR` in `process.env`. On Cloudflare Workers, detected by `navigator.userAgent`, `getColorEnabledAsync` imports `cloudflare:workers` and checks `NO_COLOR` in its `env`. The module name is kept in a variable so bundlers for other platforms do not try to resolve it.

Sources: [src/middleware/logger/index.ts:28-46](repo://src/middleware/logger/index.ts#L28-L46), [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

## timing

### Collecting metrics

`timing(options)` from `hono/timing` creates a per-request store of finished metric strings and running timers, saved as the `metric` context variable. If the variable already exists, because `timing` was registered twice on overlapping paths, the inner instance does nothing.

Sources: [src/middleware/timing/timing.ts:10-20](repo://src/middleware/timing/timing.ts#L10-L20), [src/middleware/timing/timing.ts:85-93](repo://src/middleware/timing/timing.ts#L85-L93)

Handlers record metrics with helpers that take the context:

Sources: [src/middleware/timing/timing.ts:128-132](repo://src/middleware/timing/timing.ts#L128-L132)

| Helper | Effect |
| --- | --- |
| `startTime(c, name, description?)` | Starts a timer |
| `endTime(c, name, precision?)` | Stops it and records `name;dur=…;desc="…"` |
| `setMetric(c, name, value, description?, precision?)` | Records a duration you measured yourself |
| `setMetric(c, name, description?)` | Records a value-less metric, such as a cache hit marker |
| `wrapTime(c, name, promise, description?, precision?)` | Times a promise, ending the timer even if it rejects |

Sources: [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

```ts
import { startTime, endTime, wrapTime } from 'hono/timing'

app.get('/posts', async (c) => {
  startTime(c, 'db')
  const posts = await db.listPosts()
  endTime(c, 'db')
  const user = await wrapTime(c, 'auth', fetchUser(c))
  return c.json({ posts, user })
})
```

Sources: [src/middleware/timing/timing.ts:187-257](repo://src/middleware/timing/timing.ts#L187-L257)

Durations use `performance.now()` where available and fall back to `Date.now()`, and are formatted with one decimal unless `precision` says otherwise. Calling a helper on a route without `timing()` logs a warning instead of throwing, so instrumentation can stay in code that some routes run without the middleware.

Sources: [src/middleware/timing/timing.ts:30-35](repo://src/middleware/timing/timing.ts#L30-L35), [src/middleware/timing/timing.ts:156-172](repo://src/middleware/timing/timing.ts#L156-L172)

### Writing the header

After `next()`, the middleware ends its `total` timer, ends any timers still running (`autoEnd`), and, if `enabled` (a boolean or a function of the context) is true, appends the joined metrics to `Server-Timing`.

Sources: [src/middleware/timing/timing.ts:95-114](repo://src/middleware/timing/timing.ts#L95-L114)

| Option | Default | Effect |
| --- | --- | --- |
| `total` | `true` | Adds a `total` metric for the whole chain |
| `totalDescription` | `Total Response Time` | Its description |
| `enabled` | `true` | Whether to send the header; a function can limit it to internal clients |
| `autoEnd` | `true` | Ends timers left running |
| `crossOrigin` | `false` | Sets `Timing-Allow-Origin` (`*` for `true`, or the given origin) so cross-origin pages can read the timings |

Sources: [src/middleware/timing/timing.ts:22-28](repo://src/middleware/timing/timing.ts#L22-L28), [src/middleware/timing/timing.ts:76-84](repo://src/middleware/timing/timing.ts#L76-L84), [src/middleware/timing/timing.ts:115-123](repo://src/middleware/timing/timing.ts#L115-L123)

> [!NOTE]
> `Server-Timing` reveals how long internal steps take. Use `enabled` to restrict it in production if that matters.

Sources: [src/middleware/timing/timing.ts:110-114](repo://src/middleware/timing/timing.ts#L110-L114)

## requestId

`requestId({ headerName = 'X-Request-Id', limitLength = 255, generator })` from `hono/request-id` reuses the ID the client or an upstream proxy sent in `headerName` if it is at most `limitLength` characters of letters, digits, `_`, `-` and `=`. Otherwise it calls `generator(c)`, which defaults to `crypto.randomUUID()`. The validation keeps attacker-controlled values out of logs and headers.

Sources: [src/middleware/request-id/request-id.ts:13-51](repo://src/middleware/request-id/request-id.ts#L13-L51)

The ID is stored as `c.var.requestId`, typed through `ContextVariableMap`, and echoed in the response under the same header. With `headerName: ''` the request header is ignored and no response header is set.

Sources: [src/middleware/request-id/request-id.ts:46-58](repo://src/middleware/request-id/request-id.ts#L46-L58), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)

To put the ID into log lines, register `requestId` first and give `logger` a function that reads it, for example from `getContext()` of the context storage middleware described on [[Context and Responses]].

Sources: [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)
