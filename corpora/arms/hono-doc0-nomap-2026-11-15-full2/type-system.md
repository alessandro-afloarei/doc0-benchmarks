---
title: "Type System"
---
## Overview

Hono's types carry information from where a route is declared to every place that uses it: the bindings and variables a handler can read, the parameters in its path, the input a validator produced, and the exact response it returns. None of this exists at runtime. It lives in the generic parameters of `Hono`, `Context`, `HonoRequest` and the handler types, and is threaded through by the overloads of `app.get`, `app.use` and friends. The accumulated route table, the `Schema`, is what the [[RPC Client]] reads to type its calls.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/context.ts:293-299](repo://src/context.ts#L293-L299), [src/request.ts:36-36](repo://src/request.ts#L36-L36)

The core definitions are in `src/types.ts`, with generic helpers such as `UnionToIntersection`, `IsAny`, `Simplify` and `JSONParsed` in `src/utils/types.ts`. The four generic parameters below appear everywhere and are worth learning first.

Sources: [src/types.ts:1-49](repo://src/types.ts#L1-L49), [src/utils/types.ts:12-21](repo://src/utils/types.ts#L12-L21)

| Parameter | Bound | Meaning |
| --- | --- | --- |
| `E` | `Env` | bindings and variables available through the [[Context]] |
| `P` | `string` | the route path string, such as `/posts/:id` |
| `I` | `Input` | validated input: `in` (what clients send), `out` (what handlers read) |
| `S` | `Schema` | accumulated table of routes, methods, inputs and outputs |

Sources: [src/types.ts:26-49](repo://src/types.ts#L26-L49), [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

## Env: Bindings and Variables

### Declaring an Env

`Env` is an object type with two optional keys. `Bindings` types `c.env`, the per-request environment that adapters pass to `app.fetch` (Cloudflare KV namespaces, secrets, and so on). `Variables` types the per-request store behind `c.set`, `c.get` and `c.var`.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33)

```ts
export type Env = {
  Bindings?: Bindings
  Variables?: Variables
}
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:315-315](repo://src/context.ts#L315-L315)

```ts
type AppEnv = {
  Bindings: { DB: D1Database; API_KEY: string }
  Variables: { user: { id: string } }
}

const app = new Hono<AppEnv>()
app.get('/me', (c) => {
  c.env.API_KEY          // string
  return c.json(c.var.user) // { id: string }
})
```

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

### How set, get and var are typed

`Context` types `set` and `get` with two overloads each: one keyed by `E['Variables']`, one keyed by the global `ContextVariableMap`. When `E` itself is `any` (the default for an untyped `Context`), the `IsAny` check widens `Variables` to `ContextVariableMap & Record<string, any>`, so untyped code still compiles. `c.var` is the read-only intersection of `ContextVariableMap` and `E['Variables']`.

Sources: [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/context.ts:546-602](repo://src/context.ts#L546-L602), [src/utils/types.ts:114-114](repo://src/utils/types.ts#L114-L114)

### Merging Env from middleware

Middleware can contribute its own `Env`. Each overload of `HandlerInterface` and `MiddlewareHandlerInterface` gives every handler a separate `E2`, `E3`, ... parameter and returns an app whose `Env` is `IntersectNonAnyTypes<[E, E2, ...]>`. That helper intersects the list while turning `any` and the bare `Env` type into `{}`, so an untyped middleware does not erase the app's types.

Sources: [src/types.ts:2762-2766](repo://src/types.ts#L2762-L2766), [src/types.ts:1080-1108](repo://src/types.ts#L1080-L1108)

```ts
const auth = createMiddleware<{ Variables: { userId: string } }>(async (c, next) => {
  c.set('userId', 'u1')
  await next()
})

app.use(auth).get('/whoami', (c) => c.text(c.var.userId)) // userId: string
```

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375), [src/types.ts:1085-1093](repo://src/types.ts#L1085-L1093)

## ContextVariableMap and ContextRenderer

`ContextVariableMap` and `ContextRenderer` are empty exported interfaces meant for declaration merging. Built-in middleware extend `ContextVariableMap` from inside their own module, so importing the middleware is enough for `c.get('requestId')` to be typed everywhere, without adding it to the app's `Env`.

Sources: [src/context.ts:54-62](repo://src/context.ts#L54-L62), [src/middleware/request-id/index.ts:5-7](repo://src/middleware/request-id/index.ts#L5-L7)

```ts
declare module '../..' {
  interface ContextVariableMap extends RequestIdVariables {}
}
```

Sources: [src/context.ts:54-62](repo://src/context.ts#L54-L62), [src/middleware/request-id/index.ts:5-7](repo://src/middleware/request-id/index.ts#L5-L7)

The JWT, language, secure-headers and timing middleware do the same. Applications augment `'hono'` instead of `'../..'`. Extending `ContextRenderer` with a call signature changes the type of `c.render()` and of the props passed to layouts, through `Renderer` and `PropsForRenderer`.

Sources: [src/middleware/jwt/index.ts:7-9](repo://src/middleware/jwt/index.ts#L7-L9), [src/middleware/timing/index.ts:6-8](repo://src/middleware/timing/index.ts#L6-L8), [src/context.ts:71-85](repo://src/context.ts#L71-L85), [src/index.ts:40-40](repo://src/index.ts#L40-L40)

> [!WARNING]
> Variables declared through `ContextVariableMap` are typed for every route, whether or not the middleware that sets them ran. Prefer `Env['Variables']` with `createMiddleware` when a variable exists only behind a specific middleware.

Sources: [src/context.ts:95-108](repo://src/context.ts#L95-L108)

## Path parameter inference

### ParamKeys and ParamKeyToRecord

`ParamKeys<Path>` splits the path on `/` recursively and runs `ParamKey` on each segment. A segment `:name` yields `name`; a segment with a regex, `:name{[0-9]+}`, yields `name` with the pattern dropped; a regex segment ending in `?` yields `name?` to mark it optional. `ParamKeyToRecord` turns each key into `{ name: string }`, or `Record<name, string | undefined>` for an optional one.

Sources: [src/types.ts:2698-2713](repo://src/types.ts#L2698-L2713)

```ts
type ParamKey<Component> = Component extends `:${infer NameWithPattern}`
  ? NameWithPattern extends `${infer Name}{${infer Rest}`
    ? Rest extends `${infer _Pattern}?`
      ? `${Name}?`
      : Name
    : NameWithPattern
  : never

export type ParamKeys<Path> = Path extends `${infer Component}/${infer Rest}`
  ? ParamKey<Component> | ParamKeys<Rest>
  : ParamKey<Path>
```

Sources: [src/types.ts:2698-2713](repo://src/types.ts#L2698-L2713)

| Route path | `ParamKeys` | `c.req.param()` |
| --- | --- | --- |
| `/posts/:id` | `'id'` | `{ id: string }` |
| `/posts/:id/comments/:cid` | `'id' \| 'cid'` | `{ id: string; cid: string }` |
| `/files/:name{.+\\.png}` | `'name'` | `{ name: string }` |
| `/animals/:type?` | `'type?'` | `{ type: string \| undefined }` |

Sources: [src/types.ts:2698-2713](repo://src/types.ts#L2698-L2713), [src/request.ts:94-101](repo://src/request.ts#L94-L101)

### Where P comes from

In `app.get(path, handler)`, the overload captures the literal `P` and passes `MergedPath extends MergePath<BasePath, P>` into the handler type, so a handler on an app with `basePath('/api')` sees `/api/posts/:id`. The handler's `Context<E, P, I>` hands `P` to `HonoRequest<P, I['out']>`, whose `param()` overloads use `ParamKeys<P>` and `RemoveQuestion`. `AddParam<I, P>` also adds a `param` entry to the schema input when the path has parameters and no validator already declared one.

Sources: [src/types.ts:167-181](repo://src/types.ts#L167-L181), [src/context.ts:366-369](repo://src/context.ts#L366-L369), [src/request.ts:94-101](repo://src/request.ts#L94-L101), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

### MergePath

`MergePath<A, B>` joins two path literals at the type level with the same rules as the runtime `mergePath`: an empty or `/` base disappears, duplicate slashes collapse, and a `/` sub-path leaves the base unchanged.

Sources: [src/types.ts:2610-2625](repo://src/types.ts#L2610-L2625), [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

## Input and validated data

`Input` has three optional keys: `in` for what a client must send, `out` for what the handler reads after validation, and `outputFormat`. The validator middleware returns `MiddlewareHandler<E, P, V>` where `V` is `{ in: { [target]: ... }, out: { [target]: ... } }`, with the input side derived from the schema and the output side from the validation function's return type.

Sources: [src/types.ts:37-46](repo://src/types.ts#L37-L46), [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88)

The handler overloads chain these: in `app.post(path, validatorA, validatorB, handler)`, each later handler's `I` defaults to the intersection of the earlier ones (`I3 extends Input = I & I2`), so the final handler's `c.req.valid('json')` resolves via `InputToDataByTarget<I['out'], 'json'>`. `ExtractInput` takes `I['in']` for the schema, falling back to `{}` when nothing was declared.

Sources: [src/types.ts:183-210](repo://src/types.ts#L183-L210), [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727), [src/request.ts:351-354](repo://src/request.ts#L351-L354)

`ValidationTargets` lists the six targets and their raw value types (`json`, `form`, `query`, `param`, `header`, `cookie`); [[Validator]] shows them in use.

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

## TypedResponse

### The marker type

`TypedResponse<T, U, F>` is a phantom object with `_data`, `_status` and `_format` fields. Response helpers return `Response & TypedResponse<...>`, so the runtime value is a plain `Response` while the type records the body type, the status code literal and the format. `F` defaults to `'text'` for strings, `'json'` for JSON values and `ResponseFormat` otherwise.

Sources: [src/types.ts:2635-2647](repo://src/types.ts#L2635-L2647), [src/context.ts:121-141](repo://src/context.ts#L121-L141)

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

| Helper | Return type |
| --- | --- |
| `c.text('hi', 200)` | `Response & TypedResponse<'hi', 200, 'text'>` |
| `c.json(obj, 201)` | `Response & TypedResponse<JSONParsed<typeof obj>, 201, 'json'>` |
| `c.body(null, 204)` | `Response & TypedResponse<null, 204, 'body'>` |
| `c.redirect('/login')` | `Response & TypedResponse<undefined, 302, 'redirect'>` |

Sources: [src/context.ts:121-208](repo://src/context.ts#L121-L208), [src/context.ts:750-753](repo://src/context.ts#L750-L753)

### JSONParsed

`c.json()` types its body as `JSONParsed<T>`, which models what `JSON.stringify` then `JSON.parse` actually yields: objects with `toJSON()` (such as `Date`) become the `toJSON` result, functions, symbols and `undefined` properties are removed or made optional, invalid values inside arrays become `null`, `Set` and `Map` become `{}`, and `bigint` values make the type `never` because `JSON.stringify` would throw.

Sources: [src/utils/types.ts:23-87](repo://src/utils/types.ts#L23-L87), [src/context.ts:205-208](repo://src/context.ts#L205-L208)

### Middleware responses

`MergeTypedResponse<R>` unwraps a handler's return (including promises) to its `TypedResponse`, and falls back to a plain `TypedResponse` for an untyped `Response`. `MergeMiddlewareResponse<M1>` does the same for middleware passed before the handler, keeping only typed responses and ignoring `void`. The union of both becomes the route's possible outputs, which is how an auth middleware's `c.json({ error }, 401)` shows up in the client's response union.

Sources: [src/types.ts:2649-2673](repo://src/types.ts#L2649-L2673), [src/types.ts:150-165](repo://src/types.ts#L150-L165)

## Schema and ToSchema

### Schema and Endpoint

A `Schema` maps each path string to an object keyed by `$`-prefixed lowercase methods (`$get`, `$post`), each an `Endpoint` with `input`, `output`, `outputFormat` and `status`. The `$` prefix lets the RPC client expose methods as `client.posts[':id'].$get()` without colliding with path segments.

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

```ts
export type Schema = {
  [Path: string]: {
    [Method: `$${Lowercase<string>}`]: Endpoint
  }
}
```

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551), [src/types.ts:2608-2608](repo://src/types.ts#L2608-L2608)

### How ToSchema builds an entry

`ToSchema<M, P, I, RorO>` produces `{ [P]: { [$m]: Endpoint } }` for one route. It handles four cases:

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529)

1. `RorO` is `any` (an untyped handler): the endpoint has the input but `output: {}` and the widest format and status.
2. `RorO` is `never`: no entry.
3. `RorO` is `Promise<void>` (a middleware-only route): no entry.
4. Otherwise: `input` is `AddParam<ExtractInput<I>, P>`, and `ToSchemaOutput` reads `output`, `outputFormat` and `status` from the `TypedResponse`. For a non-typed value, `output` is the value itself with format `json` and status `StatusCode`. A union of typed responses distributes into a union of endpoints, one per status.

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529)

Every `HandlerInterface` overload returns `HonoBase<E', S & ToSchema<...>, BasePath, CurrentPath>`, so each chained call adds to `S`. Path-taking overloads go through `AddSchemaIfHasResponse`, which skips the entry when the handler returns only `Promise<void>`. This is why routes must be chained (or the result reassigned) for the client to see them.

Sources: [src/types.ts:134-147](repo://src/types.ts#L134-L147), [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544)

```ts
const route = new Hono().get('/posts/:id', (c) => c.json({ id: c.req.param('id') }, 200))
// typeof route: Hono<BlankEnv, {
//   '/posts/:id': { $get: {
//     input: { param: { id: string } }
//     output: { id: string }
//     outputFormat: 'json'
//     status: 200
//   } }
// }, '/'>
```

Sources: [src/types.ts:2500-2529](repo://src/types.ts#L2500-L2529), [src/types.ts:2601-2606](repo://src/types.ts#L2601-L2606)

### MergeSchemaPath

`app.route(subPath, subApp)` returns `Hono<E, MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> | S, ...>`. `MergeSchemaPath` renames every key of the sub-app's schema with `MergePath<SubPath, key>` and passes each endpoint through `MergeEndpointParamsWithPath`, which extracts `:params` from the mount prefix with `ExtractParams` and adds them to the endpoint's `input.param`, stripping any `{regex}` suffix from the names.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2553-2599](repo://src/types.ts#L2553-L2599)

```ts
const books = new Hono().get('/books/:bookId', (c) => c.json({ ok: true }))
const app = new Hono().route('/authors/:authorId', books)
// key: '/authors/:authorId/books/:bookId'
// input.param: { bookId: string; authorId: string }
```

Sources: [src/types.ts:2563-2599](repo://src/types.ts#L2563-L2599)

## Utility types

| Type | File | Purpose |
| --- | --- | --- |
| `ExtractSchema<T>` | `types.ts` | reads `S` from a `Hono` type; the RPC client's entry point |
| `ExtractSchemaForStatusCode<T, Status>` | `types.ts` | keeps only endpoints with a given status |
| `ExtractHandlerResponse<T>` | `types.ts` | response type of a handler, without `void` |
| `IntersectNonAnyTypes<T>` | `types.ts` | intersects `Env`s, ignoring `any` |
| `UnionToIntersection<U>` | `utils/types.ts` | turns `A \| B` into `A & B` (used for param records) |
| `Simplify<T>` | `utils/types.ts` | flattens intersections for readable editor hints |
| `IsAny<T>` | `utils/types.ts` | detects `any` to choose permissive overloads |
| `Equal`, `Expect` | `utils/types.ts` | assertions used in type tests |

Sources: [src/types.ts:2737-2766](repo://src/types.ts#L2737-L2766), [src/utils/types.ts:7-16](repo://src/utils/types.ts#L7-L16), [src/utils/types.ts:89-114](repo://src/utils/types.ts#L89-L114)

The `NotFoundResponse` interface can be augmented in the same way as `ContextVariableMap` to type 404 bodies for the client; [[Error Handling]] describes it.

Sources: [src/types.ts:98-111](repo://src/types.ts#L98-L111)
