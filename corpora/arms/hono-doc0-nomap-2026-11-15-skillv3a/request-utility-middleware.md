---
title: "Request Utility Middleware"
---
## Overview

This catalogue covers the built-in middleware that observe a request, attach data to it, limit it, or arrange other middleware, rather than deciding access ([[Access Control Middleware]]) or rewriting the response ([[Response Middleware]]). Several of them publish a value through `c.set`, typed by extending `ContextVariableMap`, so handlers read it with `c.get` or `c.var` as described in [[Context]].

Sources: [src/middleware/request-id/request-id.ts:9-11](repo://src/middleware/request-id/request-id.ts#L9-L11), [src/middleware/timing/timing.ts:10-15](repo://src/middleware/timing/timing.ts#L10-L15), [src/middleware/language/language.ts:47-49](repo://src/middleware/language/language.ts#L47-L49)

| Middleware | Import | Purpose | Sets |
| --- | --- | --- | --- |
| `logger` | `hono/logger` | Logs each request and its status and duration | |
| `timing` | `hono/timing` | `Server-Timing` header with custom metrics | `metric` |
| `requestId` | `hono/request-id` | Accepts or generates a request ID | `requestId` |
| `languageDetector` | `hono/language` | Picks the user's language | `language` |
| `methodOverride` | `hono/method-override` | Lets HTML forms send `PUT`, `PATCH`, `DELETE` | |
| `bodyLimit` | `hono/body-limit` | Rejects request bodies over a size | |
| `timeout` | `hono/timeout` | Fails requests that take too long | |
| `contextStorage` | `hono/context-storage` | Makes `c` reachable outside handlers | |
| `some`, `every`, `except` | `hono/combine` | Combine other middleware with conditions | |

Sources: [package.json:84-122](repo://package.json#L84-L122)

## logger

`logger(fn = console.log)` prints `<-- METHOD /path` when the request arrives and `--> METHOD /path status time` after the response, with the status coloured by class when the terminal supports colour. The path is taken from the URL after the host. Pass another print function to route the lines elsewhere.

Sources: [src/middleware/logger/index.ts:9-63](repo://src/middleware/logger/index.ts#L9-L63), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

## timing

`timing(options)` creates a per-request metric store under `c.get('metric')` and, after the handler, appends a `Server-Timing` header with every recorded metric. Handlers record durations with `startTime(c, name)` and `endTime(c, name)`, wrap a promise with `wrapTime(c, name, promise)`, or add a value directly with `setMetric(c, name, value, description)`. Times come from `performance.now()` where available.

Sources: [src/middleware/timing/timing.ts:76-126](repo://src/middleware/timing/timing.ts#L76-L126), [src/middleware/timing/timing.ts:149-257](repo://src/middleware/timing/timing.ts#L149-L257)

| Option | Default | Effect |
| --- | --- | --- |
| `total` | `true` | Adds a `total` metric for the whole request |
| `totalDescription` | `Total Response Time` | Its description |
| `autoEnd` | `true` | Ends timers still running when the response is sent |
| `enabled` | `true` | Boolean or `(c) => boolean`; when false the header is omitted |
| `crossOrigin` | `false` | Adds `Timing-Allow-Origin` (`*` or the given origin) |

Sources: [src/middleware/timing/timing.ts:22-28](repo://src/middleware/timing/timing.ts#L22-L28), [src/middleware/timing/timing.ts:77-84](repo://src/middleware/timing/timing.ts#L77-L84)

A second `timing` on the same request is skipped, so mounting it both globally and on a sub-app does not double the header. Calling the metric functions without the middleware logs a warning instead of throwing.

Sources: [src/middleware/timing/timing.ts:89-91](repo://src/middleware/timing/timing.ts#L89-L91), [src/middleware/timing/timing.ts:156-160](repo://src/middleware/timing/timing.ts#L156-L160)

## requestId

`requestId({ headerName = 'X-Request-Id', limitLength = 255, generator })` reuses the incoming header when it is present, at most `limitLength` characters and made only of word characters, `-` and `=`; otherwise it calls `generator(c)` (default `crypto.randomUUID()`). The ID is stored as `c.get('requestId')` and echoed in the response header. An empty `headerName` disables both reading and echoing.

Sources: [src/middleware/request-id/request-id.ts:41-59](repo://src/middleware/request-id/request-id.ts#L41-L59)

## languageDetector

`languageDetector(options)` tries detectors in `order` (default query string `lang`, cookie `language`, then `Accept-Language`; `path` reads a path segment by index), keeps the first result that is in `supportedLanguages`, and otherwise uses `fallbackLanguage`. A detected language is cached in a cookie by default (`Strict`, secure, HTTP-only, one year). The result is stored as `c.get('language')`. Options are validated at creation: the fallback must be supported and the detector names must exist.

Sources: [src/middleware/language/language.ts:51-68](repo://src/middleware/language/language.ts#L51-L68), [src/middleware/language/language.ts:195-300](repo://src/middleware/language/language.ts#L195-L300)

## methodOverride

`methodOverride({ app, form | header | query })` lets a `POST` act as another method. By default it reads the `_method` field of a `multipart/form-data` or URL-encoded form; alternatively a header or a query parameter names the method. When an override is found it builds a new request with that method (removing the override field, header or parameter) and dispatches it through `app.fetch` with the same env and execution context, returning that response instead of continuing. `GET` requests are never overridden.

Sources: [src/middleware/method-override/index.ts:60-148](repo://src/middleware/method-override/index.ts#L60-L148)

> [!NOTE]
> Because the new request goes through `app.fetch` again, middleware registered before `methodOverride` runs twice for overridden requests. Register it first.

Sources: [src/middleware/method-override/index.ts:83-88](repo://src/middleware/method-override/index.ts#L83-L88)

## bodyLimit

`bodyLimit({ maxSize, onError })` rejects request bodies larger than `maxSize` bytes with `413 Payload Too Large` (or `onError(c)`). Requests without a body pass. When only `Content-Length` is present, it trusts the header and does not read the body. With `Transfer-Encoding` or no length header it reads the whole body up front, counting bytes and stopping as soon as the limit is passed, then replaces `c.req.raw` with a request over the buffered chunks so the handler can still read it.

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111)

## timeout

`timeout(ms, exception)` races the rest of the chain against a timer. When the timer wins it rejects with the given `HTTPException` (or the result of a function of `c`), by default `504 Gateway Timeout`, which the error handler turns into the response. The timer is always cleared. The handler itself is not cancelled; it keeps running in the background unless it watches a signal of its own.

Sources: [src/middleware/timeout/index.ts:12-58](repo://src/middleware/timeout/index.ts#L12-L58)

## contextStorage

`contextStorage()` runs the rest of the chain inside a Node.js `AsyncLocalStorage` holding `c`. Code called from a handler, such as a data-access module, can then call `getContext()` (which throws when there is none) or `tryGetContext()` to read `c.env` or `c.var` without receiving `c` as a parameter. It imports `node:async_hooks`, so the runtime must provide it (Node.js, Deno, Bun, or Workers with `nodejs_compat`).

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

## Combining middleware

`hono/combine` builds one middleware from several, where any item may also be a condition `(c) => boolean`:

Sources: [src/middleware/combine/index.ts:12-12](repo://src/middleware/combine/index.ts#L12-L12)

- **`some(...items)`** runs items in order until one succeeds: a condition returning `true` continues the chain, `false` moves to the next item, and a middleware that does not throw counts as success. If all fail, the last error is thrown. Use it for "admin IP or a valid token".
- **`every(...items)`** runs all items as one composed chain, keeping `c.req.routeIndex` stable so parameters stay correct; a condition returning `false` throws `Unmet condition`.
- **`except(conditions, ...middleware)`** skips the middleware when a condition matches. String conditions are path patterns matched with a [[TrieRouter]], so `except('/public/*', bearerAuth(...))` protects everything except public paths.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)
