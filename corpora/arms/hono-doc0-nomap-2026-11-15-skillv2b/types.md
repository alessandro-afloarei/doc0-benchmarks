---
title: "Env, Handler and Schema Types"
---
## Overview

Hono's types do two jobs. Inside a handler they make `c.env`, `c.var`, `c.req.param()` and `c.req.valid()` precise. Across the app they accumulate a `Schema`, a type-level record of every route's path, method, input and response, which the [[RPC Client]] turns into a typed client. All of it lives in `src/types.ts`, and none of it exists at run time: the JavaScript in `HonoBase` is untyped `this as any` returns.

Sources: [src/types.ts:20-48](repo://src/types.ts#L20-L48), [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

## Env: bindings and variables

```ts
export type Env = {
  Bindings?: Bindings
  Variables?: Variables
}
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

`new Hono<{ Bindings: { DB: D1Database }; Variables: { user: User } }>()` types `c.env.DB` and `c.get('user')`/`c.var.user` for every handler of that app ([[Context and Responses]]). Middleware can declare its own `Env`; when it is used in a route, `IntersectNonAnyTypes` merges its `Env` into the app's for the following handlers, so a handler after an auth middleware sees the variables that middleware sets.

Sources: [src/types.ts:2763-2765](repo://src/types.ts#L2763-L2765), [src/types.ts:127-160](repo://src/types.ts#L127-L160)

Values that should be visible in every app regardless of its `Env` are declared by augmenting `ContextVariableMap` in the `hono` module, which built-in middleware such as jwt, requestId, timing, language and secureHeaders do for the variables they set.


Sources: [src/context.ts:57-57](repo://src/context.ts#L57-L57), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)

## Handler types

| Type | Shape | Notes |
| --- | --- | --- |
| `Handler<E, P, I, R>` | `(c, next) => R` | `R` is a `HandlerResponse`: `Response`, `TypedResponse`, or a promise of either, or `Promise<void>` |
| `MiddlewareHandler<E, P, I, R>` | `(c, next) => Promise<R \| void>` | Always async; may return nothing after `await next()` |
| `H` | `Handler \| MiddlewareHandler` | What routers store |
| `Next` | `() => Promise<void>` | |
| `NotFoundHandler<E>` | `(c) => Response \| Promise<Response>` | Its type follows the augmentable `NotFoundResponse` interface |
| `ErrorHandler<E>` | `(err, c) => Response \| Promise<Response>` | `err` may be an `HTTPResponseError` with `getResponse()` |

Sources: [src/types.ts:35-35](repo://src/types.ts#L35-L35), [src/types.ts:70-120](repo://src/types.ts#L70-L120)

`P` is the route path as a string literal, inferred from the call: `app.get('/posts/:id', (c) => ...)` passes `'/posts/:id'`, and `ParamKeys` extracts `id` from it. `:name{pattern}` yields `name`, a trailing `?` makes the key optional, and `ParamKeyToRecord` turns optional keys into `string | undefined`.

Sources: [src/types.ts:2696-2712](repo://src/types.ts#L2696-L2712), [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Input and validation targets

`Input` has `in` (what a client sends), `out` (what the validator produced) and `outputFormat`. Validators return a middleware typed with an `Input` for one target; `c.req.valid(target)` reads `I['out'][target]` through `InputToDataByTarget` ([[Validator]]).

Sources: [src/types.ts:42-46](repo://src/types.ts#L42-L46), [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727)

```ts
export type ValidationTargets<T extends FormValue = ParsedFormValue, P extends string = string> = {
  json: any
  form: Record<string, T | T[]>
  query: Record<string, string | string[]>
  param: Record<P, P extends `${infer _}?` ? string | undefined : string>
  header: Record<RequestHeader | CustomHeader, string>
  cookie: Record<string, string>
}
```

Sources: [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

## The Schema

### How routes become a schema

`HandlerInterface`, `MiddlewareHandlerInterface` and `OnHandlerInterface` type `app.get`, `app.use` and `app.on`. They are long lists of overloads, one per handler count up to ten, because TypeScript cannot infer a variadic chain in which each handler's `Env` and `Input` feed the next. Each overload returns `HonoBase<E', S & ToSchema<M, P, I, R>, BasePath, CurrentPath>`: the same app with the new route added to its schema type.

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160), [src/types.ts:1080-1084](repo://src/types.ts#L1080-L1084), [src/types.ts:1457-1461](repo://src/types.ts#L1457-L1461)

`ToSchema<M, P, I, R>` produces `{ [P]: { [$method]: Endpoint } }`, where the key is the lower-case method prefixed with `$` (`$get`, `$post`) and `Endpoint` is `{ input, output, outputFormat, status }`. `AddParam` adds a `param` input from the path when the validator did not declare one. A handler whose return type is `Promise<void>` (middleware) adds nothing.

Sources: [src/types.ts:2500-2551](repo://src/types.ts#L2500-L2551), [src/types.ts:2601-2608](repo://src/types.ts#L2601-L2608)

### Typed responses

`c.json(data, status)` returns `Response & TypedResponse<JSONParsed<T>, U, 'json'>`. `TypedResponse` is a phantom type with `_data`, `_status` and `_format` fields that never exist at run time. `ToSchema` reads them to fill `output`, `status` and `outputFormat`. A handler that can return several responses yields a union of endpoints, one per status, which the client narrows by `res.status` or `res.ok`.

Sources: [src/types.ts:2635-2647](repo://src/types.ts#L2635-L2647), [src/context.ts:205-208](repo://src/context.ts#L205-L208)

`JSONParsed<T>` mirrors what `JSON.stringify` then `JSON.parse` does to a type: a value with `toJSON()` (such as `Date`) becomes that method's return type, functions and symbols disappear, `Map` and `Set` become `{}`, and `bigint` fields become `never` because `JSON.stringify` throws on them. The output type therefore describes what the client actually receives.

Sources: [src/utils/types.ts:40-87](repo://src/utils/types.ts#L40-L87)

### Grouping and base paths

`MergePath<A, B>` joins path literals at the type level the way `mergePath` does at run time. `MergeSchemaPath<S, SubPath>` re-keys every path of a sub-app's schema under the prefix and adds the prefix's own parameters (`/users/:userId` mounted routes get `param.userId`). `app.route(path, sub)` returns the parent typed with that merged schema ([[Hono App and Route Registration]]).

Sources: [src/types.ts:2563-2599](repo://src/types.ts#L2563-L2599), [src/types.ts:2610-2626](repo://src/types.ts#L2610-L2626)

Because the schema exists only in the return type, it is kept only when calls are chained or their results assigned. `app.get(...)` on separate statements registers the route at run time but leaves `typeof app` without it; an app meant for the RPC client is written as one chain, `const route = app.get(...).post(...)`, and `typeof route` is exported.

Sources: [src/hono-base.ts:129-141](repo://src/hono-base.ts#L129-L141)

### Reading a schema

`ExtractSchema<typeof app>` returns the schema type of an app. `ExtractSchemaForStatusCode<T, 200>` filters it to endpoints with one status. The client module builds `InferRequestType` and `InferResponseType` on top of these.

Sources: [src/types.ts:2737-2748](repo://src/types.ts#L2737-L2748)

## Factory helper

Handlers written outside `app.get(...)` lose path and `Env` inference. `hono/factory` restores it.

Sources: [src/helper/factory/index.ts:363-375](repo://src/helper/factory/index.ts#L363-L375)


| Function | Purpose |
| --- | --- |
| `createMiddleware<E>(fn)` | Returns `fn` unchanged but typed as `MiddlewareHandler<E, P, I>`, so `c.set` and `c.var` know the middleware's variables |
| `createFactory<E>({ initApp?, defaultAppOptions? })` | A `Factory` bound to one `Env` |
| `factory.createApp(options?)` | `new Hono<E>` with default options merged in, then `initApp(app)` (for example, to register shared middleware) |
| `factory.createMiddleware(fn)` | `createMiddleware` with the factory's `Env` |
| `factory.createHandlers(...handlers)` | Returns the handlers as a typed tuple, so `app.get('/x', ...factory.createHandlers(mw, handler))` keeps the inference a direct call would have |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

All of these are identity functions at run time; `createHandlers` only filters out `undefined`. Their value is entirely in the type parameters they fix.

Sources: [src/helper/factory/index.ts:353-360](repo://src/helper/factory/index.ts#L353-L360)
