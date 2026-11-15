---
title: "Combining Middleware and Context Storage"
---
## Overview

Two utilities change how middleware is wired rather than what it does. `hono/combine` builds one middleware out of several with `some` (the first that succeeds), `every` (all of them, in order) and `except` (all of them, unless a condition matches), which expresses rules such as "accept either a bearer token or a session cookie" without custom code. `hono/context-storage` puts the current `Context` into an `AsyncLocalStorage` so code deep inside a request, such as a database helper, can read `c.env` or `c.var` without receiving `c` as a parameter.

Sources: [src/middleware/combine/index.ts:38-117](repo://src/middleware/combine/index.ts#L38-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165), [src/middleware/context-storage/index.ts:1-59](repo://src/middleware/context-storage/index.ts#L1-L59)

## Conditions and middleware

All three combinators accept two kinds of entries. A middleware is called with `c` and `next` as usual. A condition is a function `(c) => boolean`: returning `true` counts as success and `false` as failure. Mixing them lets a cheap check short-circuit an expensive one.

Sources: [src/middleware/combine/index.ts:12-12](repo://src/middleware/combine/index.ts#L12-L12), [src/middleware/combine/index.ts:38-38](repo://src/middleware/combine/index.ts#L38-L38)

```ts
import { some, every, except } from 'hono/combine'
import { bearerAuth } from 'hono/bearer-auth'
import { ipRestriction } from 'hono/ip-restriction'
import { rateLimit } from './rate-limit'

app.use(
  '/api/*',
  some(
    (c) => c.req.header('x-internal') === env.INTERNAL_KEY,
    every(ipRestriction(getConnInfo, { allowList: ['10.0.0.0/8'] }), bearerAuth({ token })),
    rateLimit()
  )
)
app.use('/admin/*', except('/admin/health', bearerAuth({ token })))
```

Sources: [src/middleware/combine/index.ts:38-117](repo://src/middleware/combine/index.ts#L38-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

## some

`some(...entries)` tries entries in order and stops at the first success.

Sources: [src/middleware/combine/index.ts:46-57](repo://src/middleware/combine/index.ts#L46-L57)

- A condition that returns `true` calls `next()` (unless the context is already finalized) and stops.
- A condition that returns `false` records `No successful middleware found` and moves to the next entry.
- A middleware that returns or calls `next()` without throwing is a success and stops the loop.
- A middleware that throws (an auth middleware throwing its `HTTPException(401)`, for example) records the error and moves on. If it had already called `next()`, the error came from downstream handlers, so it is not swallowed: the loop stops and the error is rethrown.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69)

When nothing succeeds, the last recorded error is thrown, so the client sees the response of the last alternative, such as the last middleware's `401`.

Sources: [src/middleware/combine/index.ts:65-67](repo://src/middleware/combine/index.ts#L65-L67)

## every

`every(...entries)` reuses `compose` from the core ([[Request Dispatch and Middleware Composition]]). Each entry is wrapped so that a `false` from a condition throws `Unmet condition`, and the composed chain is called with the outer `next`, so the route's handler runs only after every entry has called its `next`. A thrown error stops the chain and propagates.

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117)

The wrapper restores `c.req.routeIndex` before each entry. `compose` overwrites `routeIndex` as it walks its own list, and without the reset `c.req.param()` inside a combined middleware would read the parameters of the wrong route ([[HonoRequest: Params, Query, Headers and Body]]).

Sources: [src/middleware/combine/index.ts:101-106](repo://src/middleware/combine/index.ts#L101-L106), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

## except

`except(conditions, ...middleware)` runs `every(...middleware)` unless one of the conditions matches. A condition is a function or a path pattern. Path patterns are added to a private `TrieRouter` under `ALL`, so they use the same syntax as routes (`/admin/*`, `/users/:id`) and are matched against `c.req.path` ([[TrieRouter, LinearRouter and PatternRouter]]).

Sources: [src/middleware/combine/index.ts:141-159](repo://src/middleware/combine/index.ts#L141-L159)

Internally it is `some(anyConditionMatches, every(...middleware))`: a matching condition calls `next()` and skips the middleware, and otherwise the middleware run.

Sources: [src/middleware/combine/index.ts:161-164](repo://src/middleware/combine/index.ts#L161-L164)

## contextStorage

### Setting up

`contextStorage()` is a middleware that runs the rest of the chain inside `asyncLocalStorage.run(c, next)`. Every `await` in handlers and the functions they call stays inside that run, so the store follows the request through asynchronous code. It is registered once, before the code that needs it.

Sources: [src/middleware/context-storage/index.ts:10-47](repo://src/middleware/context-storage/index.ts#L10-L47)

### Reading the context

`getContext<Env>()` returns the current `Context` and throws `Context is not available` outside a request; `tryGetContext<Env>()` returns `undefined` instead. The type parameter gives the result the app's bindings and variables.

Sources: [src/middleware/context-storage/index.ts:49-59](repo://src/middleware/context-storage/index.ts#L49-L59)

```ts
import { contextStorage, getContext } from 'hono/context-storage'

type Env = { Variables: { requestId: string }; Bindings: { DB: D1Database } }

app.use(contextStorage())

const findUser = (id: string) => {
  const c = getContext<Env>()
  console.log(`[${c.var.requestId}] findUser ${id}`)
  return c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
}
```

Sources: [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)

### Runtime requirements

The module imports `AsyncLocalStorage` from `node:async_hooks`. Node.js, Deno and Bun provide it; Cloudflare Workers need the `nodejs_compat` (or `nodejs_als`) compatibility flag. This is the only built-in middleware with a Node-compatible API requirement, which is why it is opt-in rather than part of `Context`.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10)
