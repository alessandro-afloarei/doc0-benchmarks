---
title: "Route Types and Factory"
---
## Overview

Hono's types are not declared once per app; they accumulate. `Hono` carries three type parameters, the environment `E`, the schema `S` and the base path, and every `get`, `post`, `use` or `route` call returns the app with a wider type. Chaining registrations, `const app = new Hono().get(...).post(...)`, therefore produces an app type that lists every endpoint with its input and output, which the [[RPC Client]] turns into typed calls. This page describes those types and the factory helper that keeps them intact when handlers are written away from the app. The run-time side of registration is in [[Application and Routing API]].

Sources: [src/hono.ts:16-20](repo://src/hono.ts#L16-L20), [src/types.ts:127-182](repo://src/types.ts#L127-L182)

All of it lives in `src/types.ts`, re-exported in part from the package root: `Env`, `Handler`, `MiddlewareHandler`, `Next`, `Input`, `Schema`, `ToSchema` and `TypedResponse` among others.

Sources: [src/index.ts:21-34](repo://src/index.ts#L21-L34)

## Env

`Env` is an object type with two optional members. `Bindings` types `c.env`, the values the runtime passes to `fetch` (secrets, KV namespaces and the like on Workers). `Variables` types `c.set`, `c.get` and `c.var`, as [[Context]] describes.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:293-316](repo://src/context.ts#L293-L316)

```ts
type Env = {
  Bindings?: Bindings
  Variables?: Variables
}

const app = new Hono<{ Bindings: { TOKEN: string }; Variables: { user: string } }>()
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:293-316](repo://src/context.ts#L293-L316)

Middleware can add to the environment. Each handler parameter of a method helper has its own `E2`, `E3`… and the returned app's `Env` is `IntersectNonAnyTypes` of all of them, which intersects the types while ignoring `any` and the bare `Env`. A middleware typed `MiddlewareHandler<{ Variables: { user: User } }>` thus makes `c.var.user` typed in the handlers after it.

Sources: [src/types.ts:149-165](repo://src/types.ts#L149-L165), [src/types.ts:2762-2765](repo://src/types.ts#L2762-L2765)

## Handlers and middleware

`Handler<E, P, I, R>` is `(c: Context<E, P, I>, next: Next) => R`, where `R` is a `Response`, a `TypedResponse`, or a promise of one or of `void`. `MiddlewareHandler` has the same parameters but must return a promise. `H` is either. `P` is the path, used to type `c.req.param`; `I` is the `Input`.

Sources: [src/types.ts:35-46](repo://src/types.ts#L35-L46), [src/types.ts:70-95](repo://src/types.ts#L70-L95)

`Input` has three optional members: `in`, what a client sends per validation target; `out`, what `c.req.valid` returns per target; and `outputFormat`. The [[Validator]] middleware is the usual source of an `Input`.

Sources: [src/types.ts:42-46](repo://src/types.ts#L42-L46), [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727)

`ErrorHandler` receives an `Error` or an `HTTPResponseError`, an error with `getResponse()`. `NotFoundHandler`'s return type follows the `NotFoundResponse` interface, which an app can augment to give `c.notFound()` a typed response.

Sources: [src/types.ts:97-119](repo://src/types.ts#L97-L119)

## Schema

### Endpoints

A `Schema` maps each path to a record keyed by `$` plus the lower-cased method (`$get`, `$post`), and each entry is an `Endpoint` of `input`, `output`, `outputFormat` and `status`.

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

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

### ToSchema

`ToSchema<M, P, I, R>` builds the entry for one registration. Its `input` is the validator input plus, through `AddParam`, a `param` record derived from the path's parameter names. Its `output`, `outputFormat` and `status` come from the handler's `TypedResponse`; a handler that returns a plain `Response` gives an empty output with format `json` and any status. A handler returning only `Promise<void>`, meaning plain middleware, adds nothing.

Sources: [src/types.ts:2483-2530](repo://src/types.ts#L2483-L2530), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

The `app.get(path, handler)` overload merges the path with the base path through `MergePath` and adds `ToSchema` to `S` only if the handler returns a response (`AddSchemaIfHasResponse`). Overloads with several handlers also add the typed responses middleware might return early, extracted by `MergeMiddlewareResponse`, so a 401 from an auth middleware becomes a possible output of the route.

Sources: [src/types.ts:167-182](repo://src/types.ts#L167-L182), [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544), [src/types.ts:2649-2672](repo://src/types.ts#L2649-L2672)

### Path parameters

`ParamKeys` splits a path on `/` and collects the names after `:`, dropping a `{pattern}` and keeping a trailing `?` for optional ones. `ParamKeyToRecord` maps a required name to `string` and an optional one to `string | undefined`; these are the types `c.req.param` returns, as [[HonoRequest]] notes.

Sources: [src/types.ts:2698-2712](repo://src/types.ts#L2698-L2712), [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Grouping types

`MergePath<A, B>` is the type-level twin of the run-time `mergePath`: it joins two paths with exactly one slash and treats `/` as empty. `basePath(path)` returns an app whose base path type is `MergePath<BasePath, path>`.

Sources: [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

`route(path, subApp)` adds `MergeSchemaPath<SubSchema, MergePath<BasePath, path>>` to the parent's schema. Every key of the sub-app's schema is prefixed with the mount path, and when the mount path itself has parameters (`/users/:id`), they are added to each endpoint's `input.param`, with any `{pattern}` stripped from the name.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2553-2600](repo://src/types.ts#L2553-L2600)

`ExtractSchema<typeof app>` reads the schema back out of an app type, and `ExtractSchemaForStatusCode` keeps only the endpoint variants with a given status.

Sources: [src/types.ts:2737-2748](repo://src/types.ts#L2737-L2748)

## TypedResponse

`TypedResponse<T, U, F>` is a phantom type with `_data`, `_status` and `_format` members; no value of it exists at run time. The [[Context]] response helpers return `Response & TypedResponse<...>`, so a handler's return type records the body, status and format. The format defaults to `text` for strings and `json` for JSON values.

Sources: [src/types.ts:2632-2647](repo://src/types.ts#L2632-L2647), [src/context.ts:156-208](repo://src/context.ts#L156-L208)

`c.json` records `JSONParsed<T>`, which models what `JSON.stringify` then `JSON.parse` would give back: values with `toJSON` (such as `Date`) become what `toJSON` returns, functions and `undefined` properties are dropped, `Set` and `Map` become `{}`, and a `bigint` makes the type `never` since `JSON.stringify` would throw.

Sources: [src/utils/types.ts:40-87](repo://src/utils/types.ts#L40-L87)

## Factory helper

### Why it exists

A handler written inline in `app.get(path, handler)` gets its context typed from the app and the path. A handler or middleware stored in a variable first loses that inference. `hono/factory` gives such code a place to take its types from.

Sources: [src/helper/factory/index.ts:18-36](repo://src/helper/factory/index.ts#L18-L36)

### createMiddleware

`createMiddleware<E>(fn)` returns `fn` unchanged. Its only purpose is the type: the middleware is a `MiddlewareHandler<E, P, I, R>`, so `E`, typically adding `Variables`, flows into apps that use it, and a typed response it returns early joins the route's schema.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

### createFactory

`createFactory<E>(init)` returns a `Factory` bound to one `Env`. Its `createMiddleware` is the same identity function with `E` pre-filled. `createHandlers(...handlers)` returns the handlers as an array (dropping `undefined`) with overloads that type each one like the method helpers do, so `app.get('/', ...factory.createHandlers(mw, handler))` keeps validator inputs and responses. `createApp(options)` builds a `Hono<E>`, merging the factory's `defaultAppOptions` under the given options, and runs `initApp(app)` on it, for example to install middleware every app needs.

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366), [src/helper/factory/index.ts:20-36](repo://src/helper/factory/index.ts#L20-L36)

```ts
import { createFactory } from 'hono/factory'

const factory = createFactory<{ Variables: { user: string } }>()

const auth = factory.createMiddleware(async (c, next) => {
  c.set('user', 'alice')
  await next()
})

const handlers = factory.createHandlers(auth, (c) => c.json({ user: c.var.user }))

const app = factory.createApp().get('/me', ...handlers)
```

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)
