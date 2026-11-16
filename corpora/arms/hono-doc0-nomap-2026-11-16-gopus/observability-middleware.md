---
title: "Logging and Timing Middleware"
---
## Overview

Four small middleware record or label requests without changing what the handler answers. `logger` prints one line when a request arrives and one when its response leaves. `timing` collects durations into a `Server-Timing` header that browser developer tools display. `requestId` gives each request an identifier, and `poweredBy` adds an `X-Powered-By` header. All of them wrap `await next()`, so registering them first with `app.use()` makes them see the full chain, including responses produced by the error handler: an error thrown by a later handler is turned into a response before `next()` returns, as [[Request Lifecycle and Error Handling]] explains.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/compose.ts:48-62](repo://src/compose.ts#L48-L62)

| Middleware | Import | Writes |
| --- | --- | --- |
| `logger(fn)` | `hono/logger` | Two log lines per request |
| `timing(options)` | `hono/timing` | `Server-Timing`, optionally `Timing-Allow-Origin` |
| `requestId(options)` | `hono/request-id` | `c.var.requestId` and an `X-Request-Id` response header |
| `poweredBy(options)` | `hono/powered-by` | `X-Powered-By: Hono` |

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59), [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

## logger

`logger(fn)` prints with `fn`, which defaults to `console.log`. The incoming line is `<-- METHOD /path?query`; after `next()` the outgoing line adds the status and the elapsed time, `--> GET /posts 200 12ms`. The path is everything after the host in the URL, query string included.

Sources: [src/middleware/logger/index.ts:9-13](repo://src/middleware/logger/index.ts#L9-L13), [src/middleware/logger/index.ts:50-95](repo://src/middleware/logger/index.ts#L50-L95)

Times under one second are shown in milliseconds and longer ones rounded to whole seconds, with thousands separators. The status is coloured by class, 2xx green, 3xx cyan, 4xx yellow and 5xx red, unless colour is disabled.

Sources: [src/middleware/logger/index.ts:15-46](repo://src/middleware/logger/index.ts#L15-L46)

Colour is disabled by the `NO_COLOR` environment variable. `getColorEnabled` reads `Deno.noColor` on Deno and `process.env` elsewhere; `getColorEnabledAsync`, which the logger uses, first detects Cloudflare Workers by user agent and reads `NO_COLOR` from the `cloudflare:workers` module's `env`. The comment explains the module name is kept in a variable so bundlers do not try to resolve it.

Sources: [src/utils/color.ts:14-56](repo://src/utils/color.ts#L14-L56)

## timing

### Collecting metrics

`timing` stores a `metric` variable on the Context holding the header entries and the running timers; a second `timing` on the same request sees it and steps aside. With `total` on, it starts a `total` timer described as `Total Response Time` (`totalDescription`) before `next()` and ends it after.

Sources: [src/middleware/timing/timing.ts:10-28](repo://src/middleware/timing/timing.ts#L10-L28), [src/middleware/timing/timing.ts:76-102](repo://src/middleware/timing/timing.ts#L76-L102)

Handlers add their own metrics with the exported functions, all taking the Context first:

Sources: [src/middleware/timing/timing.ts:128-225](repo://src/middleware/timing/timing.ts#L128-L225), [src/middleware/timing/timing.ts:244-257](repo://src/middleware/timing/timing.ts#L244-L257)

| Function | Adds |
| --- | --- |
| `startTime(c, name, description?)` | Starts a named timer. |
| `endTime(c, name, precision?)` | Ends it and records `name;dur=...;desc="..."`. |
| `setMetric(c, name, value, description?, precision?)` | Records a duration measured elsewhere. |
| `setMetric(c, name, description?)` | Records a metric without a duration. |
| `wrapTime(c, name, promise, description?, precision?)` | Times a promise, ending the timer even when it rejects. |

Sources: [src/middleware/timing/timing.ts:128-225](repo://src/middleware/timing/timing.ts#L128-L225), [src/middleware/timing/timing.ts:244-257](repo://src/middleware/timing/timing.ts#L244-L257)

Durations use `performance.now()` where it exists, else `Date.now()`, and are written with one decimal unless `precision` says otherwise. Calling the functions on a route without the middleware logs a warning instead of throwing.

Sources: [src/middleware/timing/timing.ts:30-35](repo://src/middleware/timing/timing.ts#L30-L35), [src/middleware/timing/timing.ts:156-172](repo://src/middleware/timing/timing.ts#L156-L172)

### Writing the header

After `next()`, timers still running are ended when `autoEnd` is on, which is the default. When `enabled` is `true`, or a function returning `true` for the request, the entries are appended to `Server-Timing` joined by commas. `crossOrigin` adds `Timing-Allow-Origin`, `*` for `true` or the given origin for a string, so pages on other origins can read the timings.

Sources: [src/middleware/timing/timing.ts:104-124](repo://src/middleware/timing/timing.ts#L104-L124)

```ts
app.use(timing())

app.get('/', async (c) => {
  startTime(c, 'db')
  const rows = await db.query()
  endTime(c, 'db')
  return c.json(rows)
})
```

Sources: [src/middleware/timing/timing.ts:187-225](repo://src/middleware/timing/timing.ts#L187-L225)

## requestId

`requestId` reuses the identifier the client sent in `X-Request-Id` (`headerName`) when it is at most `limitLength` characters, 255 by default, and contains only word characters, `-` and `=`. Otherwise it calls `generator(c)`, `crypto.randomUUID()` by default. The identifier is stored as `c.var.requestId` and set on the response under the same header name; an empty `headerName` skips both reading and writing the header.

Sources: [src/middleware/request-id/request-id.ts:9-59](repo://src/middleware/request-id/request-id.ts#L9-L59)

## poweredBy

`poweredBy` sets `X-Powered-By` after the handler runs, to `Hono` or the `serverName` option. The `secureHeaders` middleware on [[Security Middleware]] removes the same header by default after its own `next()`. Registered before `poweredBy`, it runs that cleanup last and the header is gone; registered after, `poweredBy` sets the header once the cleanup has run.

Sources: [src/middleware/powered-by/index.ts:7-35](repo://src/middleware/powered-by/index.ts#L7-L35), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)
