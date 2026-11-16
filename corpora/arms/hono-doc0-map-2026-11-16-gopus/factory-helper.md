---
title: "Factory Helper"
---
## Overview

Handlers written inline, as in `app.get('/', (c) => …)`, get their types from the app: TypeScript infers `c` from the app's `Env` and the route path ([[Route Types and Schema]]). A handler or middleware defined in another file has no app to infer from, so its `c` would be untyped. `hono/factory` solves this with functions that do nothing at run time beyond returning their arguments, but carry the type parameters the definitions need.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

| Export | Run-time behaviour | Purpose |
| --- | --- | --- |
| `createMiddleware(mw)` | Returns `mw` | Type a middleware with its `Env`, path, input and response |
| `createFactory(init?)` | Returns a `Factory` | Fix one `Env` for many definitions and apps |
| `factory.createMiddleware(mw)` | Returns `mw` | Same, with the factory's `Env` |
| `factory.createHandlers(...hs)` | Returns `hs` without `undefined` entries | Type a list of handlers for spreading into a route |
| `factory.createApp(options?)` | Builds a `Hono<E>` and runs `initApp` | Create apps that share setup |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## createMiddleware

`createMiddleware<E, P, I, R>(middleware)` returns the middleware unchanged. Its type parameters let the middleware declare what it adds to the Context, and that declaration flows into every app that uses it, because the method functions intersect each handler's `Env` into the app's ([[Route Types and Schema]]).

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

```ts
import { createMiddleware } from 'hono/factory'

const auth = createMiddleware<{ Variables: { user: { id: string } } }>(async (c, next) => {
  c.set('user', { id: '42' })
  await next()
})

app.get('/me', auth, (c) => c.json(c.var.user)) // c.var.user is typed
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

The `R` parameter defaults to `void`, which the return type turns into `Response`. A middleware that can answer with a typed response, such as `c.json({ error }, 401)`, can set `R` so the route's schema includes that response for the [[RPC Client]].

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

## createFactory

`createFactory<E, P>(init?)` returns a `Factory` whose methods all use the same `Env` `E`. It removes the need to repeat the `Env` type in each definition:

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

```ts
import { createFactory } from 'hono/factory'

type Env = { Bindings: { DB: D1Database }; Variables: { user: User } }

const factory = createFactory<Env>()

const loadUser = factory.createMiddleware(async (c, next) => {
  c.set('user', await findUser(c.env.DB))
  await next()
})
```

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

## createHandlers

`factory.createHandlers(...handlers)` returns the handlers as a tuple, dropping `undefined` entries. Its overloads, from one to ten handlers, thread the input and `Env` types from each handler to the next in the same way as `app.get` does, so a validator's output is typed in the handler after it. The tuple can be spread into a route:

Sources: [src/helper/factory/index.ts:20-44](repo://src/helper/factory/index.ts#L20-L44), [src/helper/factory/index.ts:275-330](repo://src/helper/factory/index.ts#L275-L330), [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)

```ts
const handlers = factory.createHandlers(logger(), validator('json', check), (c) => {
  const body = c.req.valid('json')
  return c.json(body)
})

app.post('/posts', ...handlers)
```

Sources: [src/helper/factory/index.ts:20-44](repo://src/helper/factory/index.ts#L20-L44), [src/helper/factory/index.ts:275-330](repo://src/helper/factory/index.ts#L275-L330), [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)

## createApp

`factory.createApp(options?)` creates a `Hono<E>` with the default router. When the factory was created with `defaultAppOptions`, those options are merged under the ones passed to `createApp`. When it was created with `initApp`, that function is called with each new app before it is returned, which lets every app start with the same middleware or settings:

Sources: [src/helper/factory/index.ts:18-18](repo://src/helper/factory/index.ts#L18-L18), [src/helper/factory/index.ts:336-351](repo://src/helper/factory/index.ts#L336-L351)

```ts
const factory = createFactory<Env>({
  initApp: (app) => {
    app.use(async (c, next) => {
      c.set('db', createDb(c.env))
      await next()
    })
  },
  defaultAppOptions: { strict: false },
})

const app = factory.createApp()
```

Sources: [src/helper/factory/index.ts:18-18](repo://src/helper/factory/index.ts#L18-L18), [src/helper/factory/index.ts:336-351](repo://src/helper/factory/index.ts#L336-L351)

The options are the same `HonoOptions` the `Hono` constructor takes (`strict`, `router`, `getPath`), described on [[Hono Application]].

Sources: [src/helper/factory/index.ts:7-8](repo://src/helper/factory/index.ts#L7-L8), [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)
