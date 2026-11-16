---
title: "Body Limit, Timeout, Method Override and Trailing Slash"
---
## Overview

These middleware act on the request before handlers see it, either bounding what a request may cost or rewriting it into a form the routes expect. `bodyLimit` rejects bodies over a size, `timeout` gives up on handlers that take too long, `methodOverride` lets HTML forms reach `PUT` and `DELETE` routes, and `trimTrailingSlash`/`appendTrailingSlash` redirect between `/path` and `/path/`. Failures are reported as `HTTPException`s, so an app's `onError` can format them ([[Request Dispatch and Middleware Composition]]).

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58), [src/middleware/method-override/index.ts:60-138](repo://src/middleware/method-override/index.ts#L60-L138), [src/middleware/trailing-slash/index.ts:44-158](repo://src/middleware/trailing-slash/index.ts#L44-L158)

## bodyLimit

### Options

`bodyLimit({ maxSize, onError? })` takes a size in bytes and an optional handler. The default handler throws `HTTPException(413)` with the body `Payload Too Large`; a custom `onError(c)` returns the response to send instead.

Sources: [src/middleware/body-limit/index.ts:10-59](repo://src/middleware/body-limit/index.ts#L10-L59)

### Two ways of measuring

- **No body**: the request passes.
- **`Content-Length` without `Transfer-Encoding`**: the header is trusted and compared to `maxSize`; the body is not read.
- **Otherwise** (chunked uploads, or both headers): the body stream is read chunk by chunk, counting bytes. The moment the count exceeds `maxSize` the error handler runs, without reading the rest. If the whole body fits, the chunks are wrapped in a new `ReadableStream` and `c.req.raw` is replaced with a `Request` built from it, so handlers can read the body normally.

Sources: [src/middleware/body-limit/index.ts:61-110](repo://src/middleware/body-limit/index.ts#L61-L110)

Stopping at the limit is the point of the streaming branch: a client sending an endless chunked body cannot make the server buffer it. The check on `Content-Length` relies on the runtime to refuse a body longer than its declared length, which Web Standard runtimes do.

Sources: [src/middleware/body-limit/index.ts:67-94](repo://src/middleware/body-limit/index.ts#L67-L94)

## timeout

`timeout(duration, exception?)` races `next()` against a timer. If the timer fires first, the middleware rejects with the exception: by default an `HTTPException(504)` with the message `Gateway Timeout`, or a fixed `HTTPException`, or one built by a function of `c`. The timer is cleared in a `finally` block whichever side wins.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

```ts
import { HTTPException } from 'hono/http-exception'
import { timeout } from 'hono/timeout'

app.use('/api/*', timeout(5000))
app.use(
  '/slow/*',
  timeout(10000, (c) => new HTTPException(408, { message: `Timeout on ${c.req.path}` }))
)
```

Sources: [src/middleware/timeout/index.ts:38-48](repo://src/middleware/timeout/index.ts#L38-L48)

> [!NOTE]
> JavaScript cannot cancel a running promise. After a timeout the client gets the error response, but the handler keeps running until it finishes; its eventual result is discarded. Long work that must stop should watch `c.req.raw.signal` or its own `AbortController`.

Sources: [src/middleware/timeout/index.ts:50-56](repo://src/middleware/timeout/index.ts#L50-L56)

## methodOverride

HTML forms can only send `GET` and `POST`. `methodOverride({ app, form | header | query })` reads the intended method from the request and, if present, dispatches a rewritten request through `app.fetch` with the same `env` and execution context, so the matching `PUT`, `PATCH` or `DELETE` route handles it. `GET` requests are never overridden.

Sources: [src/middleware/method-override/index.ts:11-66](repo://src/middleware/method-override/index.ts#L11-L66)

| Mode | Where the method is read | What is removed from the new request |
| --- | --- | --- |
| `form` (default, field `_method`) | `multipart/form-data` or `application/x-www-form-urlencoded` body | The field, from a re-encoded body |
| `header: 'X-HTTP-Method-Override'` | The named header | The header |
| `query: '_method'` | The named query parameter | The parameter, from the URL |

Sources: [src/middleware/method-override/index.ts:68-137](repo://src/middleware/method-override/index.ts#L68-L137)

The form mode reads two clones of the raw request, one to find the field and one to rebuild the body, so the original stays readable if no override is found. Because the rewritten request goes through `app.fetch` again, middleware registered before `methodOverride` runs twice for overridden requests; registering it first avoids that. `app` must be the application that owns the target routes.

Sources: [src/middleware/method-override/index.ts:68-105](repo://src/middleware/method-override/index.ts#L68-L105), [src/middleware/method-override/index.ts:140-148](repo://src/middleware/method-override/index.ts#L140-L148)

## Trailing slash redirects

### Default: redirect only after a 404

`trimTrailingSlash()` lets the request through first. If the result is a `404` for a `GET` or `HEAD` whose path ends in `/` (and is not `/`), it replaces the response with a `301` to the same URL without the slash. `appendTrailingSlash()` does the reverse for paths without a trailing slash, and accepts a `skip(path)` function, for example to leave file-like paths such as `/robots.txt` alone.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

Redirecting only after a 404 means a route that really exists at both forms keeps working, and requests that matched need no `new URL` parsing.

Sources: [src/middleware/trailing-slash/index.ts:59-72](repo://src/middleware/trailing-slash/index.ts#L59-L72)

### alwaysRedirect

With `alwaysRedirect: true`, both middleware redirect before calling `next()`, without waiting for a `404`. That is needed when a wildcard route such as `/docs/*` would otherwise answer the non-canonical form with a `200`. The redirect is a `301`, so browsers cache it.

Sources: [src/middleware/trailing-slash/index.ts:8-17](repo://src/middleware/trailing-slash/index.ts#L8-L17), [src/middleware/trailing-slash/index.ts:46-57](repo://src/middleware/trailing-slash/index.ts#L46-L57), [src/middleware/trailing-slash/index.ts:130-141](repo://src/middleware/trailing-slash/index.ts#L130-L141)

The middleware is an alternative to the app's `strict: false` option, which makes routing ignore a trailing slash without redirecting ([[Hono App and Route Registration]]). The redirect approach keeps one canonical URL per resource, which matters for caches and search engines.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)
