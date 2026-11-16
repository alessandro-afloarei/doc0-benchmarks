---
title: "Request Control Middleware"
---
## Overview

These middleware change how a request is processed rather than what the response says: they cap the body size, rewrite the method, normalise trailing slashes, bound the handling time, combine other middleware with conditions, or make the Context reachable from code that has no `c` argument. All of them run inside the normal `compose` chain ([[Request Dispatch and Middleware]]).

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111), [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-165](repo://src/middleware/combine/index.ts#L99-L165)

| Middleware | Import | Use it to |
| --- | --- | --- |
| `bodyLimit` | `hono/body-limit` | Reject request bodies larger than a size |
| `methodOverride` | `hono/method-override` | Let an HTML form send `PUT`, `PATCH` or `DELETE` |
| `trimTrailingSlash`, `appendTrailingSlash` | `hono/trailing-slash` | Redirect to one canonical form of each path |
| `timeout` | `hono/timeout` | Fail a request that takes too long |
| `some`, `every`, `except` | `hono/combine` | Run middleware under conditions |
| `contextStorage`, `getContext`, `tryGetContext` | `hono/context-storage` | Read the current Context anywhere in the request's async call tree |

Sources: [package.json:84-88](repo://package.json#L84-L88), [package.json:119-123](repo://package.json#L119-L123), [package.json:139-143](repo://package.json#L139-L143), [package.json:219-238](repo://package.json#L219-L238), [package.json:264-268](repo://package.json#L264-L268)

## bodyLimit

`bodyLimit({ maxSize, onError? })` answers `413 Payload Too Large` through an `HTTPException`, or calls `onError(c)`, when the body exceeds `maxSize` bytes. A request without a body passes straight through.

Sources: [src/middleware/body-limit/index.ts:10-65](repo://src/middleware/body-limit/index.ts#L10-L65)

How the size is measured depends on the headers:

Sources: [src/middleware/body-limit/index.ts:67-110](repo://src/middleware/body-limit/index.ts#L67-L110)

- With `Content-Length` and no `Transfer-Encoding`, the header is trusted and compared directly; the body is not read.
- Otherwise the middleware reads the whole body before the handler runs, stops with the error as soon as the running total passes the limit, and then replaces `c.req.raw` with a new `Request` whose body replays the buffered chunks.

Sources: [src/middleware/body-limit/index.ts:67-110](repo://src/middleware/body-limit/index.ts#L67-L110)

The comment on the second branch gives the reasons: per RFC 7230, `Transfer-Encoding` wins over `Content-Length`, and reading up front makes the check final however the handler later reads the body.

Sources: [src/middleware/body-limit/index.ts:76-80](repo://src/middleware/body-limit/index.ts#L76-L80)

## methodOverride

`methodOverride({ app, form? | header? | query? })` takes the method from somewhere other than the request line and re-dispatches the request through `app.fetch` with that method, so the routes for `DELETE` or `PUT` handle it. `GET` requests are never overridden.

Sources: [src/middleware/method-override/index.ts:11-64](repo://src/middleware/method-override/index.ts#L11-L64)

| Source | How the method is read | What the new request drops |
| --- | --- | --- |
| `form` (default, field `_method`) | From a `multipart/form-data` or `application/x-www-form-urlencoded` body | The field from the body |
| `header` | From the named header | That header |
| `query` | From the named query parameter | That parameter from the URL |

Sources: [src/middleware/method-override/index.ts:66-136](repo://src/middleware/method-override/index.ts#L66-L136)

The form branch works on clones of the raw request, so the original body is still readable when no override is found and `next()` runs. The re-dispatch passes `c.env` and the execution context, when there is one, to `app.fetch`, which is why the middleware needs the `app` option.

Sources: [src/middleware/method-override/index.ts:68-105](repo://src/middleware/method-override/index.ts#L68-L105), [src/middleware/method-override/index.ts:140-148](repo://src/middleware/method-override/index.ts#L140-L148)

## Trailing slashes

`trimTrailingSlash()` and `appendTrailingSlash()` redirect `GET` and `HEAD` requests with a `301` to the path without, or with, a final `/`. By default they act only after the handlers ran and answered `404`, so existing routes win. With `alwaysRedirect: true` they redirect before calling `next()`, whatever the routes are.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)

`trimTrailingSlash` never touches `/`. `appendTrailingSlash` has a `skip(path)` option to exempt paths, such as files with an extension.

Sources: [src/middleware/trailing-slash/index.ts:76-101](repo://src/middleware/trailing-slash/index.ts#L76-L101), [src/middleware/trailing-slash/index.ts:128-157](repo://src/middleware/trailing-slash/index.ts#L128-L157)

The app's own `strict: false` option is the alternative when both forms should simply match the same route without a redirect ([[Hono Application]]).

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

## timeout

`timeout(duration, exception?)` races `next()` against a timer. When the timer fires first, it rejects with the exception, by default `HTTPException(504, { message: 'Gateway Timeout' })`; a function `(c) => HTTPException` can build one per request. The timer is cleared in a `finally` block either way.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

> [!NOTE]
> `Promise.race` does not cancel the handler. After a timeout the client gets the error response, but the handler's work continues until it finishes on its own.

Sources: [src/middleware/timeout/index.ts:50-56](repo://src/middleware/timeout/index.ts#L50-L56)

## Combining middleware

### some

`hono/combine` builds one middleware out of several, and each argument is either a middleware or a condition `(c) => boolean`. `some(...items)` runs the items in order until one succeeds. A condition that returns `true` counts as success, and `next()` is then called for it. A middleware succeeds when it returns without throwing. A thrown error or a `false` condition moves on to the next item; if none succeeds, the last error is re-thrown. An error thrown after `next()` was called stops the loop, so later handlers do not run twice. The comment's example skips a rate limit for clients with a valid bearer token:

Sources: [src/middleware/combine/index.ts:12-69](repo://src/middleware/combine/index.ts#L12-L69)

```ts
app.use('/api/*', some(bearerAuth({ token }), myRateLimit({ limit: 100 })))
```

Sources: [src/middleware/combine/index.ts:12-69](repo://src/middleware/combine/index.ts#L12-L69)

### every

`every(...items)` runs all items as one `compose` chain, and a condition returning `false` throws `Unmet condition`. Each wrapped item restores `c.req.routeIndex` before running, so the inner chain does not change which route's params the outer handlers see ([[HonoRequest]]).

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117)

### except

`except(condition, ...middleware)` runs the middleware unless the condition matches. String conditions are path patterns, added to a private `TrieRouter` and matched against `c.req.path` ([[TrieRouter]]); functions are evaluated with the Context. It is built as `some(anyConditionMatches, every(...middleware))`.

Sources: [src/middleware/combine/index.ts:119-165](repo://src/middleware/combine/index.ts#L119-L165)

## contextStorage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` from `node:async_hooks`. Any code called during the request, however deep, can then call `getContext()` to get the Context, or `tryGetContext()`, which returns `undefined` outside a request instead of throwing `Context is not available`. Both take the app's `Env` as a type parameter.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

```ts
const app = new Hono<Env>()

app.use(contextStorage())

app.use(async (c, next) => {
  c.set('message', 'Hono is hot!!')
  await next()
})

app.get('/', async (c) => c.text(getMessage()))

const getMessage = () => getContext<Env>().var.message
```

Sources: [src/middleware/context-storage/index.ts:20-41](repo://src/middleware/context-storage/index.ts#L20-L41)

The import of `node:async_hooks` means the middleware only works on runtimes that provide that module.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10)
