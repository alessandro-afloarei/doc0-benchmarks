---
title: "Type System: Env, Schema and Handlers"
---
## Overview

Hono's type safety lives entirely in TypeScript generics; nothing is generated and nothing runs at build time. An app is typed as `Hono<E, S, BasePath>`: `E` is the environment (runtime bindings and context variables), `S` is the `Schema` that maps every registered path and method to its input and output types, and `BasePath` is the prefix from `basePath()`. Every route call returns a new app type with a larger `S`, and the [[RPC Client]] reads that final type to type its calls.

Sources: [src/hono.ts:16-20](repo://src/hono.ts#L16-L20), [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112)

The definitions sit in `src/types.ts`, most of it the overloads of `HandlerInterface` (one per number of handlers passed to `app.get` and friends). Runtime behaviour is unaffected: the same `HonoBase` instance is returned at run time, only its static type changes.

Sources: [src/types.ts:127-200](repo://src/types.ts#L127-L200), [src/hono-base.ts:130-140](repo://src/hono-base.ts#L130-L140)

## Env

```ts
export type Env = {
  Bindings?: Bindings
  Variables?: Variables
}
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

`Bindings` types `c.env`, for example Cloudflare KV namespaces or secrets. `Variables` types `c.get`, `c.set` and `c.var` (see [[Context and Responses]]). Both must be object types; `new Hono<{ Bindings: number }>()` is a type error.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/preset/quick.test.ts:12-20](repo://src/preset/quick.test.ts#L12-L20)

Middleware can widen the environment for the routes that follow it. `app.use` and the handler overloads accept handlers typed with their own `E2` and return an app typed with `IntersectNonAnyTypes<[E, E2]>`, which intersects the environments while dropping `any` and the bare `Env` default. A middleware created with `createMiddleware<{ Variables: { user: User } }>` therefore makes `c.var.user` typed in every handler chained after it.

Sources: [src/types.ts:1080-1094](repo://src/types.ts#L1080-L1094), [src/types.ts:2762-2765](repo://src/types.ts#L2762-L2765)

## Handler types

| Type | Shape |
| --- | --- |
| `Handler<E, P, I, R>` | `(c: Context<E, P, I>, next: Next) => R` |
| `MiddlewareHandler<E, P, I, R>` | `(c, next) => Promise<R \| void>` |
| `H` | Either of the above |
| `HandlerResponse<O>` | `Response`, `TypedResponse<O>`, a promise of either, or `Promise<void>` |
| `NotFoundHandler`, `ErrorHandler` | Handlers for `notFound` and `onError` |

Sources: [src/types.ts:70-121](repo://src/types.ts#L70-L121)

`P` is the route path as a string literal. `c.req.param()` derives its keys from it through `ParamKeys`, which splits the path on `/` and turns each `:name`, `:name{re}` or `:name?` component into a key; optional keys become `string | undefined`.

Sources: [src/types.ts:2698-2714](repo://src/types.ts#L2698-L2714), [src/request.ts:94-104](repo://src/request.ts#L94-L104)

`NotFoundResponse` is an empty interface that can be augmented with `declare module 'hono'` to give `c.notFound()` a typed response.

Sources: [src/types.ts:97-111](repo://src/types.ts#L97-L111)

## Input and validation targets

`Input` describes what a validator adds to a route: `in` is what the client sends, `out` is what the handler receives after validation, and `outputFormat` can override the response format.

Sources: [src/types.ts:37-46](repo://src/types.ts#L37-L46)

`ValidationTargets` lists the parts of a request a validator can read and their raw types:

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

| Target | Raw type |
| --- | --- |
| `json` | `any` |
| `form` | `Record<string, string \| File \| (string \| File)[]>` |
| `query` | `Record<string, string \| string[]>` |
| `param` | `Record<P, string>`, `string \| undefined` for optional params |
| `header` | `Record<RequestHeader \| CustomHeader, string>` |
| `cookie` | `Record<string, string>` |

Sources: [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

`c.req.valid(target)` returns `InputToDataByTarget<I['out'], target>`, the validated type for that target. [[Validation]] shows how `validator()` fills in `I`.

Sources: [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727), [src/request.ts:351-354](repo://src/request.ts#L351-L354)

## Typed responses

`TypedResponse<T, U, F>` is a phantom type with fields `_data`, `_status` and `_format` that never exist at run time. `c.json(obj, status)` returns `Response & TypedResponse<JSONParsed<T>, U, 'json'>`, `c.text` does the same with format `text`, and `c.redirect` returns format `redirect`.

Sources: [src/types.ts:2632-2648](repo://src/types.ts#L2632-L2648), [src/context.ts:205-208](repo://src/context.ts#L205-L208), [src/context.ts:750-762](repo://src/context.ts#L750-L762)

`JSONParsed<T>` computes the type a client will see after `JSON.stringify` and `JSON.parse`: values with `toJSON()` become its return type (a `Date` becomes `string`), functions and symbols are dropped from objects and turned into `null` in arrays, `Map` and `Set` become `{}`, and `bigint` is rejected because `JSON.stringify` throws on it.

Sources: [src/utils/types.ts:39-88](repo://src/utils/types.ts#L39-L88)

## The Schema

### Shape

```ts
export type Schema = {
  [Path: string]: {
    [Method: `$${Lowercase<string>}`]: Endpoint
  }
}

export type Endpoint = {
  input: any
  output: any
  outputFormat: ResponseFormat
  status: StatusCode
}
```

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

Methods are keyed with a `$` prefix (`$get`, `$post`), which is exactly the property name the RPC client exposes.

Sources: [src/types.ts:2608-2608](repo://src/types.ts#L2608-L2608)

### How a route adds to it

Each overload of `HandlerInterface` returns `HonoBase<E, S & ToSchema<M, P, I, R>, BasePath, CurrentPath>`. `ToSchema` produces `{ [path]: { [$method]: { input, output, outputFormat, status } } }`:

Sources: [src/types.ts:127-200](repo://src/types.ts#L127-L200), [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529)

- `input` is the validator's `in` types plus a `param` record derived from the path by `AddParam`.
- `output`, `outputFormat` and `status` come from the handler's `TypedResponse`; a union of returns (for example a 200 JSON and a 404 text) yields a union of endpoints, one per status.
- A handler typed as `any` produces an endpoint with `output: {}`, and a handler returning only `Promise<void>` adds nothing.

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

When middleware and a handler are passed to the same call, `MergeMiddlewareResponse` adds any typed response the middleware may return early, so the client also sees, for instance, a validator's 400 response.

Sources: [src/types.ts:2649-2678](repo://src/types.ts#L2649-L2678)

### Grouping with route and basePath

`MergePath<A, B>` mirrors the runtime `mergePath` at the type level, so `basePath('/api')` and `route('/v1', sub)` change the keys of the schema the same way they change the registered paths. `app.route(path, sub)` returns `MergeSchemaPath<SubSchema, MergePath<BasePath, path>>` united with the parent schema. `MergeSchemaPath` re-keys every path and, when the mount path has parameters such as `/users/:id`, adds them to every endpoint's `input.param`.

Sources: [src/types.ts:2553-2624](repo://src/types.ts#L2553-L2624), [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217)

`ExtractSchema<typeof app>` pulls the schema back out of an app type, and `ExtractSchemaForStatusCode` filters it to one status.

Sources: [src/types.ts:2737-2748](repo://src/types.ts#L2737-L2748)

## Why routes must be chained

The schema only grows in the return type of each call. Writing routes as separate statements discards those return types:

Sources: [src/hono-base.ts:130-140](repo://src/hono-base.ts#L130-L140)

```ts
// The type of `app` is still Hono<Env, {}>: the routes are not in the schema
const app = new Hono()
app.get('/posts', (c) => c.json({ posts: [] }))

// The chained form keeps every step's type
const api = new Hono()
  .get('/posts', (c) => c.json({ posts: [] }))
  .post('/posts', (c) => c.json({ ok: true }, 201))

export type AppType = typeof api
```

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160)

Only `AppType` from the chained form carries `/posts` with `$get` and `$post`. Large apps keep the chain short by building each feature as its own chained sub-app and combining them with chained `route()` calls.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)
