---
title: "Type System and Route Schemas"
---
## Overview

Hono's runtime code is small; much of its value is in `src/types.ts`, which makes every registration method return a more precisely typed app. Three things are tracked: the environment `E` (bindings and context variables), the current path (so `c.req.param()` knows its keys), and the schema `S`, a type-level table of every route with its input, output, format and status. The schema is what the [[RPC Client]] reads; nothing is generated at runtime.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

`HonoBase` has four type parameters: `E extends Env`, `S extends Schema`, `BasePath` (from `basePath()` or `route()`), and `CurrentPath` (the last path registered, used when a method is called without a path). Its methods `get`, `post`, `use`, `on` are typed by the `HandlerInterface`, `MiddlewareHandlerInterface` and `OnHandlerInterface` interfaces.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/types.ts:127-133](repo://src/types.ts#L127-L133)

## Env: bindings and variables

```ts
export type Env = {
  Bindings?: Bindings
  Variables?: Variables
}
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

`new Hono<{ Bindings: { DB: D1Database }; Variables: { user: User } }>()` types `c.env.DB`, `c.get('user')` and `c.var.user` in every handler of the app. `Bindings` must be an object, so a primitive is rejected. Middleware can also contribute variables: each overload intersects the app's `E` with the middleware's own `E2` through `IntersectNonAnyTypes`, so after `app.use(middlewareThatSetsUser)` the new type knows `c.var.user`. For values that should be typed in every app, a package augments the global `ContextVariableMap`, as [[Context and Response Building]] shows.

Sources: [src/types.ts:1080-1094](repo://src/types.ts#L1080-L1094), [src/types.ts:2762-2765](repo://src/types.ts#L2762-L2765), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Handler types

`Handler<E, P, I, R>` is `(c: Context<E, P, I>, next: Next) => R`, and `MiddlewareHandler` is the same with a `Promise<R | void>` result. `P` types the path parameters, `I` the validated input, `R` the response. `H` is the union of both, the type the router stores.

Sources: [src/types.ts:69-96](repo://src/types.ts#L69-L96)

`Input` has an `in` half (what a client sends) and an `out` half (what `c.req.valid()` returns), plus an optional `outputFormat`. Validators produce it, as described on [[Validation]]; handlers after a validator receive it through `I`.

Sources: [src/types.ts:37-47](repo://src/types.ts#L37-L47)

## How a route enters the schema

### The overloads

`HandlerInterface` has one overload per argument shape: handlers without a path, a path with one to ten handlers, then variadic fallbacks. Explicit overloads exist because each handler in a chain may change the types for the next one: a validator's `I` feeds the handler's `I2`, and each middleware's `E2` is intersected into the following handler's environment. The variadic forms keep working past ten handlers but lose that threading.

Sources: [src/types.ts:127-200](repo://src/types.ts#L127-L200), [src/types.ts:1043-1072](repo://src/types.ts#L1043-L1072)

### ToSchema

Each overload returns `HonoBase<E, S & ToSchema<M, Path, I, Response>, ...>`. `ToSchema` builds one entry keyed by the full path and the method prefixed with `$`:

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529)

```ts
{
  '/posts/:id': {
    $get: {
      input: { param: { id: string } }
      output: { id: string; title: string }
      outputFormat: 'json'
      status: 200
    }
  }
}
```

Sources: [src/types.ts:2482-2529](repo://src/types.ts#L2482-L2529)

`input` is the handler chain's `in` input plus a `param` record added by `AddParam` when the path has parameters. `output`, `outputFormat` and `status` come from the handler's return type through `ToSchemaOutput`. A handler that returns `Promise<void>` adds no entry (`AddSchemaIfHasResponse`), which is why pure middleware routes stay out of the schema.

Sources: [src/types.ts:2482-2498](repo://src/types.ts#L2482-L2498), [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

### Response types

`c.json()`, `c.text()` and `c.redirect()` return `Response & TypedResponse<T, U, F>`, where `_data`, `_status` and `_format` carry the body type, status literal and format. `MergeTypedResponse` unwraps promises, and a handler that returns several typed responses yields a union, one schema variant per status. Middleware that can return a response (an auth failure, a validator's 400) adds its `TypedResponse` through `MergeMiddlewareResponse`.

Sources: [src/types.ts:2632-2678](repo://src/types.ts#L2632-L2678)

`c.json(obj)` types its data as `JSONParsed<T>`, the type the value has after `JSON.stringify` and `JSON.parse`: `Date` becomes `string` through `toJSON`, `undefined` and functions drop out of objects, `Map` and `Set` become `{}`, and `bigint` makes the type `never` because `JSON.stringify` would throw.

Sources: [src/utils/types.ts:39-92](repo://src/utils/types.ts#L39-L92), [src/context.ts:205-208](repo://src/context.ts#L205-L208)

> [!IMPORTANT]
> Types accumulate along a chain of calls. `app.get(...)` written as separate statements returns new types that are discarded, so `typeof app` keeps an empty schema. Chain the calls, or keep the returned value: `const routes = app.get(...).post(...)` and `export type AppType = typeof routes`.

Sources: [src/types.ts:127-147](repo://src/types.ts#L127-L147)

## Paths and parameters

`MergePath<A, B>` is the type-level copy of the runtime `mergePath`, joining base and route paths with exactly one slash.

Sources: [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624), [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

`ParamKeys<Path>` splits a path on `/` and keeps each `:name` component, stripping a `{regex}` and keeping a trailing `?` as a marker. `ParamKeyToRecord` turns `name?` into `string | undefined` and `name` into `string`. These types drive `c.req.param()`, whose overloads only accept known keys.

Sources: [src/types.ts:2698-2714](repo://src/types.ts#L2698-L2714), [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Merging sub-app schemas

`app.route('/api', sub)` returns `MergeSchemaPath<SubSchema, MergePath<BasePath, '/api'>> | S`. `MergeSchemaPath` rewrites every key of the sub-app's schema with the prefix and, when the prefix itself has parameters (`/users/:userId`), adds them to each endpoint's `input.param`, so a client calling a nested route must supply the outer parameters too.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2563-2599](repo://src/types.ts#L2563-L2599)

`basePath(path)` only changes `BasePath` and `CurrentPath`; every route registered afterwards uses `MergePath<BasePath, P>` as its key.

Sources: [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

## Reading a schema back

Helper types extract information from an app type: `ExtractSchema<typeof app>` returns the schema, `ExtractSchemaForStatusCode<typeof app, 200>` keeps only the variants with that status, and `ExtractHandlerResponse` the response type of a handler. The client's `InferRequestType` and `InferResponseType`, covered on [[RPC Client]], build on the same schema.

Sources: [src/types.ts:2737-2760](repo://src/types.ts#L2737-L2760)

## Helpers in utils/types

`src/utils/types.ts` holds the generic utilities the schema types rely on: `UnionToIntersection`, `Simplify` (flattens intersections for editor tooltips), `IsAny`, and the JSON types `JSONValue`, `JSONParsed` and `InvalidJSONValue`.

Sources: [src/utils/types.ts:12-20](repo://src/utils/types.ts#L12-L20), [src/utils/types.ts:93-120](repo://src/utils/types.ts#L93-L120)
