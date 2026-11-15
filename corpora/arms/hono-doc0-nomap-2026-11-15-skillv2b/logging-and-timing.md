---
title: "Logger, Server Timing, Request ID and Powered-By"
---
## Overview

Four small middleware make requests observable. `logger` prints a line when a request arrives and another when it leaves, `timing` reports durations to the browser through the `Server-Timing` header, `requestId` assigns each request an identifier that handlers and logs can share, and `poweredBy` adds an `X-Powered-By` header. They store nothing between requests and need no runtime APIs beyond `console`, `crypto.randomUUID` and `performance.now`.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

```ts
import { logger } from 'hono/logger'
import { requestId } from 'hono/request-id'
import { timing, startTime, endTime } from 'hono/timing'

app.use(requestId())
app.use(logger())
app.use(timing())

app.get('/users', async (c) => {
  startTime(c, 'db')
  const users = await db.listUsers()
  endTime(c, 'db')
  return c.json(users)
})
```

Sources: [src/middleware/timing/timing.ts:187-225](repo://src/middleware/timing/timing.ts#L187-L225)

## logger

`logger(fn = console.log)` writes two lines per request through `fn`.

Sources: [src/middleware/logger/index.ts:9-13](repo://src/middleware/logger/index.ts#L9-L13)

```text
<-- GET /users?page=2
--> GET /users?page=2 200 12ms
```

Sources: [src/middleware/logger/index.ts:50-63](repo://src/middleware/logger/index.ts#L50-L63)

The path is sliced from `c.req.url` after the host, so it includes the query string. Elapsed time is measured with `Date.now()` around `await next()` and printed in milliseconds below one second and in rounded seconds above, with thousands separators. Because the second line is written after `next()` returns, the status is the final one, including responses produced by `onError`.

Sources: [src/middleware/logger/index.ts:15-26](repo://src/middleware/logger/index.ts#L15-L26), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

The status is coloured by class (5xx red, 4xx yellow, 3xx cyan, 2xx green) unless colour is disabled. `getColorEnabled` honours `Deno.noColor` and the `NO_COLOR` environment variable; `getColorEnabledAsync` additionally checks for `NO_COLOR` in the bindings of `cloudflare:workers` when running on Workers. Passing a custom `fn` sends lines to any logger.

Sources: [src/middleware/logger/index.ts:28-46](repo://src/middleware/logger/index.ts#L28-L46), [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

## timing

### Collecting metrics

`timing()` creates a per-request store `{ headers: string[], timers: Map }` under the context variable `metric`. If `metric` is already set (a second `timing` on a nested route), it only calls `next()`, so metrics are never reported twice. With `total` (default on) it starts a `total` timer before `next()` and ends it after.

Sources: [src/middleware/timing/timing.ts:76-102](repo://src/middleware/timing/timing.ts#L76-L102)

Handlers add metrics with four helpers, each a no-op with a console warning when `timing()` is not installed.

Sources: [src/middleware/timing/timing.ts:156-160](repo://src/middleware/timing/timing.ts#L156-L160)

| Helper | Effect |
| --- | --- |
| `startTime(c, name, description?)` | Starts a timer with `performance.now()` (or `Date.now()`) |
| `endTime(c, name, precision?)` | Ends it and records `name;dur=<ms>;desc="..."` |
| `setMetric(c, name, value, description?, precision?)` | Records a duration measured elsewhere |
| `setMetric(c, name, description?)` | Records a metric without a duration |
| `wrapTime(c, name, promise, description?)` | Times a promise, ending the timer even if it rejects |

Sources: [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

### Writing the header

After `next()`, timers still running are ended when `autoEnd` is on (the default). Then, if `enabled` (a boolean or a function of `c`) is true, all metrics are appended as one `Server-Timing` header. `crossOrigin` adds `Timing-Allow-Origin` (`*` or the given origin) so pages on other origins can read the timings through the Performance API.

Sources: [src/middleware/timing/timing.ts:104-125](repo://src/middleware/timing/timing.ts#L104-L125)

`Server-Timing` exposes internal durations to every client. Using an `enabled` function, for example one that checks an environment binding or an admin cookie, keeps them out of public responses.

Sources: [src/middleware/timing/timing.ts:22-28](repo://src/middleware/timing/timing.ts#L22-L28)

## requestId

`requestId({ headerName = 'X-Request-Id', limitLength = 255, generator = crypto.randomUUID })` reuses the identifier from the request header when one is present, no longer than `limitLength`, and made only of word characters, `-` and `=`. Otherwise it calls `generator(c)`. The result is stored as `c.get('requestId')`, declared in `ContextVariableMap` so it is typed in every app, and echoed in the response header. Setting `headerName: ''` disables both reading and writing the header.

Sources: [src/middleware/request-id/request-id.ts:9-59](repo://src/middleware/request-id/request-id.ts#L9-L59), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)

The character check keeps a client-supplied ID safe to write into log lines and headers. Registering `requestId` before `logger` and passing a custom print function lets every log line include the ID.

Sources: [src/middleware/request-id/request-id.ts:48-51](repo://src/middleware/request-id/request-id.ts#L48-L51)

## poweredBy

`poweredBy({ serverName = 'Hono' })` sets `X-Powered-By` on the response after `next()`. The secure-headers middleware removes that header by default ([[CORS, CSRF and Secure Headers]]), so using both leaves no header when `secureHeaders` runs outside `poweredBy`.

Sources: [src/middleware/powered-by/index.ts:7-35](repo://src/middleware/powered-by/index.ts#L7-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)

## Ordering

All four record or modify after `await next()`, except `requestId`, which sets its variable before. Registered first, `requestId` makes the ID available to everything after it; registered first, `logger` and `timing` measure the whole chain, including other middleware. The general rule is in [[Request Dispatch and Middleware Composition]]; [[Combining Middleware and Context Storage]] shows how to reach `c.var.requestId` from code that has no `c`.

Sources: [src/middleware/request-id/request-id.ts:46-58](repo://src/middleware/request-id/request-id.ts#L46-L58), [src/middleware/logger/index.ts:82-94](repo://src/middleware/logger/index.ts#L82-L94)
