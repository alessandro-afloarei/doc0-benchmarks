---
title: "Typed Routes and Schemas"
---
## Overview

Hono records an app's routes in its type as well as in its router. Every registration method returns a `Hono` whose schema type `S` has grown by the route just added: its path, its method, what it accepts and what it can answer. Nothing of this exists at runtime; it is all in `src/types.ts`. Handlers use it to type `c.env`, `c.var`, `c.req.param()` and `c.req.valid()`; the [[RPC Client]] uses the finished schema to type calls from another program. This page explains how the types are built. The validators that contribute the input half are on [[Validation]].

Sources: [src/types.ts:127-151](repo://src/types.ts#L127-L151), [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

## Env

`Env` has two optional parts. `Bindings` types `c.env`, the second argument a runtime passes to `fetch`. `Variables` types `c.get`, `c.set` and `c.var`. Both must be objects.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

```ts
type AppEnv = {
  Bindings: { DB: D1Database }
  Variables: { user: { id: string } }
}

const app = new Hono<AppEnv>()
app.get('/', (c) => c.json(c.var.user))
```

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Middleware can add to the environment of the handlers after it. Each handler slot in an overload has its own `Env` parameter, and the overloads combine them with `IntersectNonAnyTypes`, which intersects them while dropping any that is `any` or the bare `Env`. A middleware typed as `MiddlewareHandler<{ Variables: { user: User } }>` placed before a handler in the same call therefore types `c.var.user` in that handler. `app.use()` folds the middleware's environment into the app's `E` for every later route.

Sources: [src/types.ts:153-170](repo://src/types.ts#L153-L170), [src/types.ts:1080-1110](repo://src/types.ts#L1080-L1110), [src/types.ts:2762-2766](repo://src/types.ts#L2762-L2766)

## Handlers and their inputs

| Type | Shape |
| --- | --- |
| `Handler<E, P, I, R>` | `(c: Context<E, P, I>, next: Next) => R` |
| `MiddlewareHandler<E, P, I, R>` | `(c, next) => Promise<R \| void>` |
| `H` | Either of the two |
| `Input` | `{ in?, out?, outputFormat? }` |
| `HandlerResponse<O>` | `Response`, `TypedResponse<O>`, a promise of either, or `Promise<void>` |

Sources: [src/types.ts:35-49](repo://src/types.ts#L35-L49), [src/types.ts:70-103](repo://src/types.ts#L70-L103)

`P` is the path the handler was registered on, which is how `c.req.param()` knows its keys. `ParamKeys` splits the path on `/` and takes each `:name` component, stripping a `{pattern}` and keeping a trailing `?`; `ParamKeyToRecord` turns `name?` into an optional `string | undefined` key and every other name into `string`.

Sources: [src/types.ts:2698-2713](repo://src/types.ts#L2698-L2713)

`I` collects what validators put on the request. In an overload with several handlers, each later handler's input is the intersection of the earlier ones, so a handler after two validators sees both in `c.req.valid()`.

Sources: [src/types.ts:182-200](repo://src/types.ts#L182-L200)

## HandlerInterface

`app.get`, `app.post` and the other method helpers share `HandlerInterface<E, M, S, BasePath, CurrentPath>`. It is a long list of overloads: one for handlers alone and one for a path followed by handlers, for each count of handlers from one to ten, then variadic fallbacks. The fixed-count overloads exist so each handler can carry its own `Env` and `Input`.

Sources: [src/types.ts:127-200](repo://src/types.ts#L127-L200), [src/types.ts:1043-1072](repo://src/types.ts#L1043-L1072)

Each overload returns a new `HonoBase` type:

Sources: [src/types.ts:153-185](repo://src/types.ts#L153-L185), [src/types.ts:2649-2673](repo://src/types.ts#L2649-L2673)

- the environment is the intersection of the app's and the handlers';
- the schema is `S & ToSchema<M, MergePath<BasePath, P>, I, ...>`, where the response type is the last handler's `R` merged with any response a middleware in the chain can return;
- `CurrentPath` becomes the merged path, which is what a later call without a path uses.

Sources: [src/types.ts:153-185](repo://src/types.ts#L153-L185), [src/types.ts:2649-2673](repo://src/types.ts#L2649-L2673)

Because the schema lives in the return type, only a chain of calls, or a variable assigned from one, carries it:

Sources: [src/types.ts:166-185](repo://src/types.ts#L166-L185)

```ts
const route = app
  .get('/posts', (c) => c.json({ posts: [] }))
  .post('/posts', (c) => c.json({ ok: true }, 201))

export type AppType = typeof route
```

Sources: [src/types.ts:166-185](repo://src/types.ts#L166-L185)

When a handler returns only `Promise<void>`, such as a pure middleware registered with `get`, the path-plus-handler overload leaves the schema unchanged through `AddSchemaIfHasResponse`.

Sources: [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544)

`app.use()` has its own interface, `MiddlewareHandlerInterface`, whose overloads never touch the schema, and `app.on()` uses `OnHandlerInterface` with the same pattern as `HandlerInterface` for a method or list of methods.

Sources: [src/types.ts:1080-1110](repo://src/types.ts#L1080-L1110), [src/types.ts:1457-1470](repo://src/types.ts#L1457-L1470)

## The schema

### Shape

A `Schema` maps each path to an object keyed by `$` and the lower-case method, such as `$get`. Each entry is an `Endpoint`: `input`, `output`, `outputFormat` and `status`.

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

### ToSchema

`ToSchema<M, P, I, RorO>` builds the entry for one route. `input` is the route's validator input (`I['in']`) with `param` added from the path by `AddParam` when no validator supplied one. The output part depends on the response type:

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

1. A `TypedResponse<T, U, F>` gives `output: T`, `status: U` and `outputFormat: F`.
2. A plain value gives that value as `output`, `json` as format and any `StatusCode`.
3. `any` gives an empty output with any format and status.
4. `never` or `Promise<void>` adds nothing.

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

A handler that can return several typed responses, for example a 200 and a 404, has a union as `R`, and `ToSchema` distributes over it: the endpoint becomes a union with one member per status. `ExtractSchemaForStatusCode<T, Status>` picks the members with one status out of an app's schema.

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529), [src/types.ts:2737-2748](repo://src/types.ts#L2737-L2748)

### Mounting and paths

`MergePath<A, B>` is the type twin of the runtime `mergePath`: it joins two path literals with one `/`, treating `''` and `/` as empty. `app.route(path, sub)` adds `MergeSchemaPath<SubSchema, MergePath<BasePath, path>>` to the parent's schema: every sub-app path is prefixed, and any `:param` in the prefix is added to each endpoint's `input.param` with the braces of a `{pattern}` stripped from the key.

Sources: [src/types.ts:2553-2599](repo://src/types.ts#L2553-L2599), [src/types.ts:2610-2625](repo://src/types.ts#L2610-L2625), [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

`ExtractSchema<typeof app>` reads the schema back out of an app type.

Sources: [src/types.ts:2737-2739](repo://src/types.ts#L2737-L2739)

## TypedResponse

`TypedResponse<T, U, F>` is a phantom type with `_data`, `_status` and `_format`. The format defaults to `text` for strings and `json` for JSON values. `c.text`, `c.json`, `c.body` and `c.redirect` return `Response & TypedResponse<...>`, so a handler that returns them needs no annotation; `c.json` records `JSONParsed<T>`, the type after a JSON round trip, as covered on [[Context and Responses]].

Sources: [src/types.ts:2632-2647](repo://src/types.ts#L2632-L2647), [src/context.ts:181-208](repo://src/context.ts#L181-L208)

`NotFoundResponse` is an empty interface. A module that augments it with a `TypedResponse` makes `c.notFound()` and not-found handlers return that type:

Sources: [src/types.ts:97-111](repo://src/types.ts#L97-L111)

```ts
declare module 'hono' {
  interface NotFoundResponse extends Response, TypedResponse<string, 404, 'text'> {}
}
```

Sources: [src/types.ts:97-111](repo://src/types.ts#L97-L111)

## The factory helper

Handlers written apart from `app.get(...)` lose the inference the overloads give, because nothing ties their `c` to the app's `Env`. `hono/factory` restores it.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

| Function | What it does |
| --- | --- |
| `createFactory<E>({ initApp, defaultAppOptions })` | Returns a `Factory` bound to one `Env`. |
| `factory.createApp(options)` | Creates `new Hono<E>` with the default options merged under `options`, then runs `initApp(app)`. |
| `factory.createMiddleware(fn)` | Returns `fn` unchanged, typed as `MiddlewareHandler<E, P, I, R>`. |
| `factory.createHandlers(...handlers)` | Returns the handlers as a tuple, dropping `undefined`, with the same per-slot inference as `app.get`. |
| `createMiddleware<E>(fn)` | The standalone form of `createMiddleware`. |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/factory/index.ts:20-40](repo://src/helper/factory/index.ts#L20-L40)

```ts
const factory = createFactory<AppEnv>()

const handlers = factory.createHandlers(logger(), (c) => c.json(c.var.user))

app.get('/me', ...handlers)
```

Sources: [src/helper/factory/index.ts:357-366](repo://src/helper/factory/index.ts#L357-L366)
