---
title: "Route Types and Schema"
---
## Overview

Hono's types are computed from the code that registers routes, not written separately. Each call such as `app.get('/posts/:id', handler)` returns a `Hono` whose type parameters have grown: the `Env` merges what the middleware declared, the current path is remembered, and the schema `S` gains an entry describing the route's inputs and outputs. All of this lives in `src/types.ts` and has no runtime cost.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/types.ts:127-182](repo://src/types.ts#L127-L182)

This page explains those types. The [[RPC Client]] reads the final schema, and the [[Validator]] is the usual source of route inputs.

Sources: [src/types.ts:2479-2551](repo://src/types.ts#L2479-L2551)

## Env: Bindings and Variables

```ts
export type Env = {
  Bindings?: Bindings
  Variables?: Variables
}
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

`Bindings` types `c.env`, the runtime's environment such as Cloudflare KV namespaces or secrets, and `Variables` types `c.set`, `c.get` and `c.var` ([[Context and Responses]]). Both must be objects. An app declares them once with `new Hono<{ Bindings: …; Variables: … }>()`, and every handler's `c` is typed from it.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:315-315](repo://src/context.ts#L315-L315), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Middleware can add to the Env. Each handler slot of `HandlerInterface` and `MiddlewareHandlerInterface` has its own `E2`, `E3`, … parameter, and the returned app's Env is `IntersectNonAnyTypes<[E, E2, …]>`. That type intersects the Envs, but treats `any` and the bare `Env` as `{}` so that an untyped middleware does not erase the app's types. A middleware typed as `MiddlewareHandler<{ Variables: { user: User } }>` therefore makes `c.var.user` available to the handlers after it.

Sources: [src/types.ts:127-162](repo://src/types.ts#L127-L162), [src/types.ts:1080-1099](repo://src/types.ts#L1080-L1099), [src/types.ts:2762-2765](repo://src/types.ts#L2762-L2765)

## Handlers and their type parameters

| Type | Shape |
| --- | --- |
| `Handler<E, P, I, R>` | `(c: Context<E, P, I>, next: Next) => R` |
| `MiddlewareHandler<E, P, I, R>` | `(c: Context<E, P, I>, next: Next) => Promise<R \| void>` |
| `H` | Either of the two |
| `HandlerResponse<O>` | `Response`, `TypedResponse<O>`, a Promise of either, or `Promise<void>` |

Sources: [src/types.ts:70-95](repo://src/types.ts#L70-L95)

`P` is the route path, which types `c.req.param()`. `I` is the `Input`, with `in` (what a client sends), `out` (what `c.req.valid()` returns) and an optional `outputFormat`. `R` is the response type.

Sources: [src/types.ts:37-47](repo://src/types.ts#L37-L47), [src/request.ts:351-354](repo://src/request.ts#L351-L354)

`HandlerInterface` is the type of `app.get` and the other method functions. It is a long list of overloads: with or without a path, and with one up to ten handlers, plus variadic forms. In each overload the input types flow from left to right (`I`, `I2 = I`, `I3 = I & I2`, …), so the validators before a handler add up to its input. The last handler's response, merged with any typed response a middleware can return, becomes the route's output.

Sources: [src/types.ts:127-195](repo://src/types.ts#L127-L195), [src/types.ts:971-971](repo://src/types.ts#L971-L971), [src/types.ts:1043-1066](repo://src/types.ts#L1043-L1066)

## Path parameters

`ParamKeys<Path>` splits a path on `/` and collects the names of its `:name` segments. A `{pattern}` is stripped from the name, and an optional segment keeps its `?`. `ParamKeyToRecord` turns each key into `{ name: string }`, or `{ name: string | undefined }` for an optional one.

Sources: [src/types.ts:2698-2714](repo://src/types.ts#L2698-L2714)

```ts
type Keys = ParamKeys<'/posts/:id{[0-9]+}/comments/:page?'>
// 'id' | 'page?'
```

Sources: [src/types.ts:2698-2708](repo://src/types.ts#L2698-L2708)

`HonoRequest.param` uses these keys, as [[HonoRequest]] describes. `AddParam<I, P>` adds `{ param: … }` to a route's input when the path has parameters and no validator already declared `param`.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

`MergePath<A, B>` is the type-level twin of the runtime `mergePath`: it joins two paths with exactly one slash, so `basePath('/api')` followed by `get('/posts')` gives the type path `/api/posts`.

Sources: [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624), [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

## TypedResponse

```ts
export type TypedResponse<
  T = unknown,
  U extends StatusCode = StatusCode,
  F extends ResponseFormat = T extends string
    ? 'text'
    : T extends JSONValue
      ? 'json'
      : ResponseFormat,
> = {
  _data: T
  _status: U
  _format: F
}
```

Sources: [src/types.ts:2632-2647](repo://src/types.ts#L2632-L2647)

The response builders on the Context return `Response & TypedResponse<…>`, which records the body type, the status and the format. `c.json(obj)` uses `JSONParsed<T>`, which models what a JSON round trip leaves: a value with `toJSON()` becomes its result (a `Date` becomes a string), `undefined`, functions and symbols are dropped from objects and become `null` in arrays, `Set` and `Map` become `{}`, and a `bigint` makes the type `never` because `JSON.stringify` would throw.

Sources: [src/context.ts:205-208](repo://src/context.ts#L205-L208), [src/utils/types.ts:40-91](repo://src/utils/types.ts#L40-L91)

A handler that returns a plain `Response` without these types still works at run time; it just leaves the route's output as `{}` in the schema. `NotFoundResponse` can be augmented with declaration merging to give `c.notFound()` a typed response.

Sources: [src/types.ts:2483-2498](repo://src/types.ts#L2483-L2498), [src/types.ts:97-111](repo://src/types.ts#L97-L111)

## Schema

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

`ToSchema<M, P, I, R>` builds the entry for one route: under the path, a key `$get`, `$post`, … (the method lower-cased with a `$` added) holds `input` (the route's `in` plus its params), and `output`, `outputFormat` and `status` from the typed response. When `R` is a union of typed responses, for example a 200 JSON body and a 404 text body, the endpoint is a union too. A handler typed as `any` yields an endpoint with `output: {}`, and a route whose handlers only return `Promise<void>` adds nothing.

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544)

The app's `S` is the intersection of every route's entry. `app.route(path, sub)` adds `MergeSchemaPath<SubSchema, MergePath<BasePath, path>>`, which prefixes each of the sub-app's paths and adds the prefix's own params, such as the `:userId` in `route('/users/:userId', posts)`, to each endpoint's `param` input.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2553-2599](repo://src/types.ts#L2553-L2599)

## Reading the schema

Because `S` grows with each call, the schema is only complete on the value returned by the last call of a chain. Code that shares the app's type does so with that value:

Sources: [src/types.ts:127-182](repo://src/types.ts#L127-L182)

```ts
const app = new Hono()
  .get('/posts', (c) => c.json({ posts: [] }))
  .post('/posts', validator('json', (v) => v as { title: string }), (c) =>
    c.json({ ok: true }, 201)
  )

export type AppType = typeof app
```

Sources: [src/types.ts:127-182](repo://src/types.ts#L127-L182)

`ExtractSchema<typeof app>` returns the schema from any `Hono` type, and `ExtractSchemaForStatusCode<T, Status>` keeps only the endpoints with a given status. These and `ToSchema` are exported from `hono/types`.

Sources: [src/types.ts:2737-2748](repo://src/types.ts#L2737-L2748), [package.json:49-53](repo://package.json#L49-L53)
