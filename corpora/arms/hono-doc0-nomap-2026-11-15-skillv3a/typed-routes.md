---
title: "Typed Routes and Schemas"
---
## Overview

Hono records, in the type of the app, what every route accepts and returns. Nothing of this exists at run time: route registration returns `this` (see [[The Hono Application]]), but its declared return type is a new `HonoBase` type whose `Schema` parameter has grown by one entry. That schema is what lets handlers see typed parameters, variables and validated input, and what the [[RPC Client]] reads to type its calls. This page explains how the types are built in `src/types.ts`; the validator that adds input types is covered in [[Validator]].

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/types.ts:127-147](repo://src/types.ts#L127-L147)

## The four type parameters

`HonoBase<E, S, BasePath, CurrentPath>` carries:

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112)

| Parameter | Meaning | Default on `Hono` |
| --- | --- | --- |
| `E extends Env` | `{ Bindings?, Variables? }`: the type of `c.env` and of the keys of `c.get`/`c.set` | `BlankEnv` (`{}`) |
| `S extends Schema` | Every route: path → `$method` → endpoint | `BlankSchema` (`{}`) |
| `BasePath` | The prefix set by `basePath()` | `'/'` |
| `CurrentPath` | The last path given to a method helper, used by path-less calls | `BasePath` |

Sources: [src/types.ts:25-32](repo://src/types.ts#L25-L32), [src/hono.ts:16-21](repo://src/hono.ts#L16-L21)

An app declares its environment once, and every handler's `Context` inherits it.

Sources: [src/types.ts:76-88](repo://src/types.ts#L76-L88)

```ts
type Bindings = { DB: D1Database; TOKEN: string }
type Variables = { user: { id: string } }

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()
app.get('/me', (c) => c.json({ id: c.var.user.id, hasToken: !!c.env.TOKEN }))
```

Sources: [src/types.ts:25-32](repo://src/types.ts#L25-L32), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## The Schema and its endpoints

A `Schema` maps a path to methods prefixed with `$` (`$get`, `$post`, ...), and each method to an `Endpoint` with four fields:

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

| Field | Source |
| --- | --- |
| `input` | The route's `Input['in']` (from validators) plus `param` built from the path |
| `output` | The body type of the handler's `TypedResponse`, or `{}` when unknown |
| `outputFormat` | `'json'`, `'text'`, `'redirect'` or another format |
| `status` | The status literal passed to the response builder, or `StatusCode` |

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:2546-2551](repo://src/types.ts#L2546-L2551)

`ToSchema<M, P, I, R>` builds one entry. `AddDollar` lower-cases the method and prefixes it with `$`; `AddParam` adds `{ param: { id: string } }` to the input when the path has parameters and the input does not already declare them; `ToSchemaOutput` reads `_data`, `_status` and `_format` from the response type. A handler typed `any` produces an entry with empty output, and one that returns `never` or `Promise<void>` produces no entry.

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529), [src/types.ts:2601-2608](repo://src/types.ts#L2601-L2608)

## Where response types come from

`TypedResponse<T, U, F>` is a phantom type with `_data`, `_status` and `_format` fields that never exist at run time. The [[Context]] builders return `Response & TypedResponse<...>`: `c.json(obj, 201)` carries the JSON-serialised type of `obj` (`JSONParsed`, so `Date` becomes `string`), status `201` and format `'json'`; `c.text('ok')` carries the literal `'ok'`; `c.redirect` carries format `'redirect'`. If the format argument is omitted it is inferred: strings are `'text'` and JSON values `'json'`.

Sources: [src/types.ts:2632-2647](repo://src/types.ts#L2632-L2647), [src/context.ts:156-208](repo://src/context.ts#L156-L208)

`MergeTypedResponse` unwraps the handler's return type, promise or not, to the `TypedResponse` inside it, and falls back to a plain `TypedResponse` for an untyped `Response`. A middleware in the handler list contributes too: `MergeMiddlewareResponse` extracts any typed response the middleware may return (a validator's 400 `c.json`, for example), and the endpoint's output becomes the union of all of them. Since each response has its own status literal, the client can narrow by status.

Sources: [src/types.ts:2649-2672](repo://src/types.ts#L2649-L2672)

## How a route adds to the schema

### Handler overloads

`HandlerInterface` (the type of `get`, `post`, `all` and the rest) has overloads for one to ten handlers, with and without a path, plus rest-parameter fallbacks. Each overload threads three things through the handlers:

Sources: [src/types.ts:127-147](repo://src/types.ts#L127-L147), [src/types.ts:1043-1072](repo://src/types.ts#L1043-L1072)

- **Path.** `MergePath<BasePath, P>` is the path every handler's `Context` is typed with, so `c.req.param()` knows the names.
- **Env.** Each handler may declare its own `E2`, `E3`, ...; `IntersectNonAnyTypes` intersects them, ignoring `any` and the bare `Env`, so a middleware created with `createMiddleware<{ Variables: { user: User } }>` makes `c.var.user` visible to the handlers after it.
- **Input.** Each handler's `Input` is intersected with the previous ones (`I3 = I & I2`), so two validators on one route both appear in the final handler's `c.req.valid()`.

Sources: [src/types.ts:184-210](repo://src/types.ts#L184-L210), [src/types.ts:2762-2765](repo://src/types.ts#L2762-L2765)

The overloads with a path use `AddSchemaIfHasResponse`, which leaves the schema unchanged when the merged response is `Promise<void>`: a path-scoped middleware registered with a method helper does not create a phantom endpoint. `app.use()` (`MiddlewareHandlerInterface`) never changes the schema; it only widens the Env with the middleware's types.

Sources: [src/types.ts:167-182](repo://src/types.ts#L167-L182), [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544), [src/types.ts:1080-1108](repo://src/types.ts#L1080-L1108)

### Why routes must be chained

The schema lives in the return type of each call, not in the type of the variable. Statements such as `app.get(...)` on separate lines leave `typeof app` at its declared schema, so a client typed with `typeof app` sees no routes. Chaining keeps each returned type:

Sources: [src/types.ts:167-182](repo://src/types.ts#L167-L182)

```ts
const app = new Hono()

const routes = app
  .get('/posts', (c) => c.json([{ id: 1, title: 'Hello' }]))
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))
  .post('/posts', (c) => c.json({ ok: true }, 201))

export type AppType = typeof routes
```

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529)

## Paths and parameters

`ParamKeys<Path>` splits a path string on `/` and keeps each `:name` component; a `{pattern}` suffix is dropped, and a trailing `?` marks the key optional. `ParamKeyToRecord` turns `id` into `{ id: string }` and `id?` into `{ id: string | undefined }`. These types back the overloads of `c.req.param()` described in [[HonoRequest]].

Sources: [src/types.ts:2698-2729](repo://src/types.ts#L2698-L2729)

`MergePath<A, B>` reproduces at the type level what the run-time `mergePath` does, joining with exactly one slash and treating `''` as `/`. `basePath('/api')` returns a type whose `BasePath` and `CurrentPath` are the merged path, so later routes are recorded as `/api/...`.

Sources: [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

`route(path, subApp)` merges the sub-app's schema with `MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>>`. Every sub-app path is prefixed, and if the prefix itself has parameters (`app.route('/users/:userId', posts)`), `MergeEndpointParamsWithPath` adds those names to each endpoint's `param` input. A large app can therefore be split into files, each exporting a chained sub-app, and still produce one full schema.

Sources: [src/types.ts:2561-2600](repo://src/types.ts#L2561-L2600), [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217)

## Utility types

| Type | Use |
| --- | --- |
| `ExtractSchema<typeof app>` | The schema of an app type |
| `ExtractSchemaForStatusCode<T, 200>` | Only the endpoints that can answer with that status |
| `ExtractHandlerResponse<T>` | The response type of a handler, without `void` |
| `ValidationTargets` | The value types of `json`, `form`, `query`, `param`, `header` and `cookie` input |
| `NotFoundResponse` | Interface to extend by declaration merging to type `c.notFound()` |

Sources: [src/types.ts:2737-2760](repo://src/types.ts#L2737-L2760), [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690), [src/types.ts:97-111](repo://src/types.ts#L97-L111)
