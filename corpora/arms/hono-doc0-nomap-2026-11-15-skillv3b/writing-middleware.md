---
title: "Writing Middleware and Factories"
---
## Overview

A middleware is any `async (c, next) => Response | void` function, and every built-in middleware is a factory that takes options and returns one. Writing middleware inline in `app.use()` gets full type inference from the app, but a middleware or handler defined in another file loses that context. `hono/factory` exists to give such code back its types, and `hono/combine` composes several middleware into one with `some`, `every` and `except`. How middleware runs in the onion is covered on [[Request Lifecycle and Middleware Composition]].

Sources: [src/types.ts:83-88](repo://src/types.ts#L83-L88), [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## Anatomy of a middleware

Code before `await next()` runs on the way in, code after it on the way out, and `c.res` holds the downstream response once `next()` resolves. A middleware can stop the request by returning a `Response` without calling `next()`, or by throwing an `HTTPException`. Returning nothing after `next()` keeps the handler's response, and assigning `c.res` replaces it.

Sources: [src/compose.ts:42-70](repo://src/compose.ts#L42-L70), [src/context.ts:403-434](repo://src/context.ts#L403-L434)

```ts
import { createMiddleware } from 'hono/factory'

export const timing = (header = 'X-Elapsed') =>
  createMiddleware(async (c, next) => {
    const start = Date.now()
    await next()
    c.header(header, `${Date.now() - start}ms`)
  })
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

The built-in middleware follow the same shape and name the returned function (`async function some(c, next)`), which makes it show up by name in `showRoutes` output and stack traces.

Sources: [src/middleware/combine/index.ts:38-40](repo://src/middleware/combine/index.ts#L38-L40)

## createMiddleware

`createMiddleware` returns its argument unchanged; it exists only for its type parameters. Declaring `E` on it is how a middleware tells the app which variables it sets, and the app picks them up because each `use` overload intersects the middleware's `E2` into the app's environment:

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/types.ts:1080-1094](repo://src/types.ts#L1080-L1094)

```ts
const auth = createMiddleware<{ Variables: { user: { id: string } } }>(async (c, next) => {
  c.set('user', { id: 'u1' })
  await next()
})

const app = new Hono().use(auth).get('/me', (c) => c.json(c.var.user))
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

The `R` parameter records a response type the middleware can return, so an early `c.json({ error }, 401)` appears in the route schema and the [[RPC Client]] sees the 401 variant.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/types.ts:2662-2674](repo://src/types.ts#L2662-L2674)

## createFactory

### Factory methods

`createFactory<E>()` fixes the environment once and returns a `Factory` whose methods all share it, so a project with typed bindings writes the `Env` in one place.

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

| Method | Does |
| --- | --- |
| `createApp(options?)` | `new Hono<E>()` with `defaultAppOptions` merged under `options`, then runs `initApp(app)` |
| `createMiddleware(fn)` | Same as the standalone function, with `E` already set |
| `createHandlers(...handlers)` | Returns the handlers as an array, typed as if they were written inline in a route |

Sources: [src/helper/factory/index.ts:341-360](repo://src/helper/factory/index.ts#L341-L360)

`initApp` is the place to register middleware every app from the factory needs, such as a database client set on the context. `defaultAppOptions` sets `HonoOptions` (strict mode, router, `getPath`) for every app it creates.

Sources: [src/helper/factory/index.ts:18-18](repo://src/helper/factory/index.ts#L18-L18), [src/helper/factory/index.ts:336-351](repo://src/helper/factory/index.ts#L336-L351)

### createHandlers

A handler written apart from its route does not know the validated input of the validator before it, or the path parameters. `createHandlers` solves this with one overload per chain length up to ten, threading each handler's input type `I` into the next, exactly as `HandlerInterface` does for inline routes. The result is spread into the route:

Sources: [src/helper/factory/index.ts:20-60](repo://src/helper/factory/index.ts#L20-L60)

```ts
const factory = createFactory<Env>()

const handlers = factory.createHandlers(
  validator('query', (v) => ({ q: String(v.q ?? '') })),
  (c) => c.json({ q: c.req.valid('query').q })
)

app.get('/search', ...handlers)
```

Sources: [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)

At runtime it only filters out `undefined` entries, so a handler can be included conditionally.

Sources: [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)

## Combining middleware

### some

`hono/combine` builds one middleware out of several middleware and condition functions `(c) => boolean`. `some(a, b, ...)` tries each entry in order and stops at the first that succeeds. A middleware succeeds when it does not throw; a condition succeeds by returning `true`, after which `next()` is called for it. A throw moves on to the next entry, unless that middleware had already called `next()`, in which case the error came from downstream and is re-thrown rather than retried. If every entry fails, the last error is thrown. A typical use: skip rate limiting for callers with a valid token, `some(bearerAuth({ token }), rateLimit())`.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69)

### every

`every(a, b, ...)` runs all entries as one chain through `compose`, so each must call `next()` for the following one to run. A condition returning `false` throws `Unmet condition`. It restores `c.req.routeIndex` inside each step so `c.req.param()` still reads the outer route's parameters.

Sources: [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117)

### except

`except(condition, ...middleware)` runs the middleware unless a condition matches. String conditions are route patterns added to a private `TrieRouter`, so `except('/api/public/*', bearerAuth({ token }))` protects everything under `/api` except the public paths. Internally it is `some(anyConditionMatches, every(...middleware))`: when a condition matches, `some` succeeds on it and calls `next()` directly.

Sources: [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

The built-in middleware to combine are listed on [[Authentication Middleware]], [[Security Middleware]], [[Response Processing Middleware]] and [[Logging, Timing and Request Context Middleware]].

Sources: [src/middleware/combine/index.ts:24-36](repo://src/middleware/combine/index.ts#L24-L36)
