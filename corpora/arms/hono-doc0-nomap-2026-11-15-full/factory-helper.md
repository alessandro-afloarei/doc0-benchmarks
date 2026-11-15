---
title: "Factory Helper"
---
## Overview

Hono infers handler types from where a handler is written: an inline `app.get('/posts', (c) => ...)` handler gets the app's `Env`, the route's path parameters and the inputs of the validators before it. Once a handler or middleware is moved into its own variable or file, that context is lost and `c.var`, `c.env` or `c.req.valid()` become untyped. The factory helper, exported from `hono/factory`, restores it with functions that do almost nothing at runtime and exist to carry type parameters.

Sources: [src/helper/factory/index.ts:1-16](repo://src/helper/factory/index.ts#L1-L16), [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [package.json:334-338](repo://package.json#L334-L338)

| Export | Runtime behavior | Purpose |
| --- | --- | --- |
| `createMiddleware` | Returns its argument | Types a standalone middleware with an `Env`, path, input and response type. |
| `createFactory` | Returns a new `Factory` | Binds one `Env` (and path type) to `createApp`, `createMiddleware` and `createHandlers`. |
| `Factory.createApp` | Builds a `Hono` instance and runs `initApp` | Creates pre-configured apps with shared options and middleware. |
| `Factory.createHandlers` | Returns the handlers array, minus `undefined` entries | Defines a typed handler chain outside of a route. |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## createMiddleware

### Signature

The standalone `createMiddleware` is an identity function whose type parameters describe the middleware. `E` defaults to `any`, so a bare call stays compatible with every app, and `R` defaults to `void`, which the return type maps to `Response`.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

```ts
export const createMiddleware = <
  E extends Env = any,
  P extends string = string,
  I extends Input = {},
  R extends HandlerResponse<any> | void = void,
>(
  middleware: MiddlewareHandler<E, P, I, R extends void ? Response : R>
): MiddlewareHandler<E, P, I, R extends void ? Response : R> => middleware
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

`MiddlewareHandler<E, P, I, R>` is `(c: Context<E, P, I>, next: Next) => Promise<R | void>`, so inside the function `c.set()` and `c.var` are checked against `E['Variables']`, and `c.env` against `E['Bindings']`.

Sources: [src/types.ts:83-88](repo://src/types.ts#L83-L88)

### Usage

Declaring the variables a middleware sets lets every route that uses it read them with types. When the middleware is passed to `app.use()` or to a route, its `Env` is intersected into the downstream handlers' `Env`.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/types.ts:150-165](repo://src/types.ts#L150-L165)

```ts
import { createMiddleware } from 'hono/factory'

const auth = createMiddleware<{ Variables: { user: { id: string } } }>(async (c, next) => {
  const token = c.req.header('Authorization')
  if (!token) {
    return c.text('Unauthorized', 401)
  }
  c.set('user', { id: token })
  await next()
})

app.get('/me', auth, (c) => c.json(c.var.user))
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/helper/factory/index.test.ts:50-60](repo://src/helper/factory/index.test.ts#L50-L60)

A middleware's response type also matters for the [[RPC Client]]: when the type parameter `R` (or the inferred return) is a `TypedResponse`, route definitions merge it into the endpoint's possible responses through `MergeMiddlewareResponse`. A middleware that only calls `next()` adds nothing, which is why a `*` middleware created this way does not show up in the schema.

Sources: [src/types.ts:2662-2672](repo://src/types.ts#L2662-L2672), [src/helper/factory/index.test.ts:385-397](repo://src/helper/factory/index.test.ts#L385-L397)

## createFactory

### Factory options

`createFactory<E, P>(init?)` returns a `Factory` whose methods share the `Env` type `E` and path type `P`. Its methods are arrow-function class fields, so they can be destructured (`const { createApp, createHandlers } = createFactory()`) without losing `this`.

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366), [src/helper/factory/index.test.ts:428-434](repo://src/helper/factory/index.test.ts#L428-L434)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `initApp` | `(app: Hono<E>) => void` | none | Called on every app created by `createApp`, after construction; typically registers middleware that sets variables. |
| `defaultAppOptions` | `HonoOptions<E>` | none | Options (`strict`, `router`, `getPath`) used by every `createApp` call. |

Sources: [src/helper/factory/index.ts:18-19](repo://src/helper/factory/index.ts#L18-L19), [src/helper/factory/index.ts:332-339](repo://src/helper/factory/index.ts#L332-L339), [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

### createApp

`createApp(options?)` constructs a `Hono<E>` from `hono/hono` (so it uses the default `SmartRouter` unless `router` is given). When both call options and `defaultAppOptions` exist, they are merged with a shallow spread in which the call options win; otherwise whichever is present is used. `initApp` then runs on the new app.

Sources: [src/helper/factory/index.ts:341-351](repo://src/helper/factory/index.ts#L341-L351), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

```ts
import { createFactory } from 'hono/factory'

type Env = { Bindings: { DB: D1Database }; Variables: { foo: string } }

const factory = createFactory<Env>({
  defaultAppOptions: { strict: false },
  initApp: (app) => {
    app.use(async (c, next) => {
      c.set('foo', 'bar')
      await next()
    })
  },
})

const app = factory.createApp()
app.get('/', (c) => c.text(c.var.foo)) // c.var.foo is string
```

Sources: [src/helper/factory/index.ts:336-366](repo://src/helper/factory/index.ts#L336-L366), [src/helper/factory/index.test.ts:362-382](repo://src/helper/factory/index.test.ts#L362-L382), [src/helper/factory/index.test.ts:410-424](repo://src/helper/factory/index.test.ts#L410-L424)

> [!NOTE]
> `initApp` changes only runtime behavior. The `Env` type of the created app is always the factory's `E`, so variables set in `initApp` must be declared in `E` to be typed.

Sources: [src/helper/factory/index.ts:18-19](repo://src/helper/factory/index.ts#L18-L19), [src/helper/factory/index.ts:341-351](repo://src/helper/factory/index.ts#L341-L351)

### Factory.createMiddleware

`factory.createMiddleware` is the same identity function as the standalone one, but `E` and `P` are fixed to the factory's types, so only the input and response types remain as type parameters.

Sources: [src/helper/factory/index.ts:353-355](repo://src/helper/factory/index.ts#L353-L355)

## createHandlers

### Typed handler chains

`createHandlers` accepts one to ten handlers and returns them as a tuple, so that `app.get('/posts', ...handlers)` type-checks as if they had been written inline. At runtime it only filters out `undefined` entries.

Sources: [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)

The typing is carried by the `CreateHandlersInterface<E, P>` overloads. For the n-th handler:

Sources: [src/helper/factory/index.ts:20-24](repo://src/helper/factory/index.ts#L20-L24)

1. Its input type defaults to the intersection of all previous inputs (`I3 = I & I2`, ...), so a handler after a validator sees the validator's `in`/`out` types through `c.req.valid()`.
2. Its `Env` defaults to `IntersectNonAnyTypes` of the factory `Env` and every previous handler's `Env`, so variables declared by a `createMiddleware` earlier in the list are visible in `c.var`.
3. Each handler keeps its own response type parameter (`R`, `R2`, ...), so each element of the returned tuple keeps its own output type.

Sources: [src/helper/factory/index.ts:20-99](repo://src/helper/factory/index.ts#L20-L99)

```ts
import { createFactory } from 'hono/factory'
import { validator } from 'hono/validator'

const factory = createFactory<{ Variables: { foo: string } }>()

const handlers = factory.createHandlers(
  validator('query', () => ({ page: '1' })),
  (c) => {
    const foo = c.var.foo
    const { page } = c.req.valid('query')
    return c.json({ page, foo })
  }
)

const routes = app.get('/posts', ...handlers)
```

Sources: [src/helper/factory/index.test.ts:129-146](repo://src/helper/factory/index.test.ts#L129-L146), [src/helper/factory/index.ts:25-36](repo://src/helper/factory/index.ts#L25-L36)

When spread into a route, the tuple behaves exactly like inline handlers: the route schema receives the validator inputs and the final `TypedResponse`, which the [[RPC Client]] then exposes. Route definitions also merge middleware response types, as described in [[Validator]].

Sources: [src/helper/factory/index.test.ts:147-172](repo://src/helper/factory/index.test.ts#L147-L172), [src/types.ts:150-165](repo://src/types.ts#L150-L165)

> [!WARNING]
> The nine-handler overload's return tuple reuses the first handler's response type `R` for every element instead of `R2` to `R9`; the other overloads keep each handler's own type. This only matters when the individual tuple elements are inspected; the handlers themselves are unaffected.

Sources: [src/helper/factory/index.ts:224-273](repo://src/helper/factory/index.ts#L224-L273)

### When to use which

Use `createMiddleware` for single middleware shared across apps, `createHandlers` when a route's full chain (validators plus handler) lives in a separate module, and `createFactory().createApp()` when several sub-apps need the same `Env`, options and bootstrap middleware before being mounted with `app.route()` (see [[The Hono Application]] and [[Middleware and Composition]]).

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)
