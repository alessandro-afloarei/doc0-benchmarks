---
title: "Request Control Middleware"
---
## Overview

These built-in middleware change how a request travels through the app rather than what it returns: `combine` composes other middleware with conditions, `methodOverride` re-dispatches a request under another method, the trailing-slash pair redirects between `/path` and `/path/`, `timeout` caps how long the rest of the chain may run, and `contextStorage` makes the current `Context` reachable from code that was not passed it. Each relies on the onion model of `compose` described in [[Request Lifecycle and Middleware]].

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-165](repo://src/middleware/combine/index.ts#L99-L165), [src/middleware/method-override/index.ts:60-138](repo://src/middleware/method-override/index.ts#L60-L138), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

| Middleware | Import | Use it to |
| --- | --- | --- |
| `some`, `every`, `except` | `hono/combine` | Build one middleware from several, with OR, AND and exclusion logic |
| `methodOverride` | `hono/method-override` | Let HTML forms send `PUT`, `PATCH` or `DELETE` |
| `trimTrailingSlash`, `appendTrailingSlash` | `hono/trailing-slash` | Redirect to one canonical form of each path |
| `timeout` | `hono/timeout` | Fail a request that takes too long |
| `contextStorage`, `getContext`, `tryGetContext` | `hono/context-storage` | Read the context from anywhere during the request |

Sources: [src/middleware/trailing-slash/index.ts:44-158](repo://src/middleware/trailing-slash/index.ts#L44-L158), [src/middleware/combine/index.ts:38-38](repo://src/middleware/combine/index.ts#L38-L38)

## combine

### some

`some(...middleware)` tries each entry in order until one succeeds. An entry is either a middleware or a condition `(c) => boolean`. A condition returning `true` counts as success and calls `next()`; returning `false` moves on. A middleware succeeds when it returns without throwing. If an entry throws before calling `next()`, the next one is tried; if it throws after `next()`, the error is final because the rest of the chain already ran. When nothing succeeds, the last error is thrown, or `No successful middleware found` after only failing conditions.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69)

```ts
import { some } from 'hono/combine'
import { bearerAuth } from 'hono/bearer-auth'
import { ipRestriction } from 'hono/ip-restriction'

app.use(
  '*',
  some(
    (c) => c.req.header('x-internal') === 'yes',
    bearerAuth({ token }),
    ipRestriction(getConnInfo, { allowList: ['192.168.0.2'] })
  )
)
```

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69)

### every

`every(...middleware)` runs all entries as one composed chain with `compose`, so each must call `next()` for the following one to run. A condition returning `false` throws `Unmet condition`. It restores `c.req.routeIndex` before each entry, so `c.req.param()` inside the combined middleware still reads the outer route's parameters.

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/request.ts:106-110](repo://src/request.ts#L106-L110)

### except

`except(condition, ...middleware)` runs the middleware unless the condition matches. Conditions are functions or path patterns; patterns are added to a private `TrieRouter` and matched against `c.req.path`, so the same path syntax as routes applies (see [[TrieRouter]]). It is built as `some(anyConditionMatches, every(...middleware))`: a match short-circuits the `some`, and a miss runs the middleware chain.

Sources: [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

## methodOverride

HTML forms can only send `GET` and `POST`. `methodOverride({ app, form | header | query })` reads the intended method from the request and dispatches a new request with that method through `app.fetch`, passing the same bindings and execution context. The response of that second dispatch is returned; the original request never reaches its own handler.

Sources: [src/middleware/method-override/index.ts:11-33](repo://src/middleware/method-override/index.ts#L11-L33), [src/middleware/method-override/index.ts:60-66](repo://src/middleware/method-override/index.ts#L60-L66), [src/middleware/method-override/index.ts:140-148](repo://src/middleware/method-override/index.ts#L140-L148)

| Source | Default | What is removed from the new request |
| --- | --- | --- |
| Form field | `_method`, for `multipart/form-data` and URL-encoded bodies | The field |
| `header: 'X-HTTP-Method-Override'` | none | The header |
| `query: '_method'` | none | The query parameter |

Sources: [src/middleware/method-override/index.ts:67-136](repo://src/middleware/method-override/index.ts#L67-L136)

`GET` requests and requests without an override value continue normally. Because it calls `app.fetch` again, the middleware is typically registered on the app it is given, and the re-dispatched request goes through all of the app's middleware once more.

Sources: [src/middleware/method-override/index.ts:62-64](repo://src/middleware/method-override/index.ts#L62-L64), [src/middleware/method-override/index.ts:137-138](repo://src/middleware/method-override/index.ts#L137-L138)

## Trailing slashes

`trimTrailingSlash()` and `appendTrailingSlash()` make one form canonical with 301 redirects, for `GET` and `HEAD` only. By default they act after `next()`, and only when the response is a 404: a request for `/about/` that matched nothing is redirected to `/about`, or the reverse. The root `/` is never trimmed. With `alwaysRedirect: true` they redirect before routing, whatever the route would have answered. `appendTrailingSlash` also takes `skip(path)` to leave some paths alone, for example files with extensions.

Sources: [src/middleware/trailing-slash/index.ts:8-74](repo://src/middleware/trailing-slash/index.ts#L8-L74), [src/middleware/trailing-slash/index.ts:76-158](repo://src/middleware/trailing-slash/index.ts#L76-L158)

The app's `strict: false` option, described in [[Application and Routing API]], is the alternative: it serves both forms from the same route without redirecting.

Sources: [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

## timeout

`timeout(duration, exception)` races `next()` against a timer. If the timer fires first, the race rejects with the exception: by default an `HTTPException(504)` with message `Gateway Timeout`, or the given exception, or the result of a function of the context. The timer is cleared either way. The handler is not cancelled; its result is simply ignored once the timeout has been thrown to the error handler.

Sources: [src/middleware/timeout/index.ts:10-58](repo://src/middleware/timeout/index.ts#L10-L58)

## contextStorage

`contextStorage()` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)` from `node:async_hooks`. Anywhere downstream, including in functions called by the handler, `getContext()` returns the current context and throws `Context is not available` outside a request; `tryGetContext()` returns `undefined` instead. Both accept an `Env` type parameter to type `c.env` and `c.var`. The import of `node:async_hooks` means the runtime must provide it.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)
