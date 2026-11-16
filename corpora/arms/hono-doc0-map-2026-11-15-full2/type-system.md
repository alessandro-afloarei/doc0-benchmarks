---
title: "Type System and Schema Inference"
---
## Overview

Hono's type system lets a handler know, at compile time, which environment bindings and variables exist, which path parameters a route has, what the validator produced, and what each route returns. Most of it lives in `src/types.ts` and has no runtime cost: the methods `app.get`, `app.post`, `app.use` and `app.on` are typed through large overload interfaces that return a new `Hono` type carrying an accumulated `Schema`, while the runtime implementation simply returns `this as any`.

Sources: [src/types.ts:1-49](repo://src/types.ts#L1-L49), [src/hono-base.ts:98-140](repo://src/hono-base.ts#L98-L140)

The accumulated schema is what powers end-to-end type safety: the [[RPC Client (hc)]] walks the schema of `typeof app` to build typed request functions, and [[Validator]] middleware feeds request input types into it. The `Context` object described in [[Context]] and the request wrapper in [[HonoRequest]] read their generic parameters from the same types.

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88)

## The Hono generic parameters

`Hono` (defined in `src/hono-base.ts`) carries four type parameters. Every routing method is declared with a `!` definite-assignment field whose type is one of the handler interfaces; the constructor then assigns a single runtime function to each of them.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112)

| Parameter | Constraint | Default | Meaning |
| --- | --- | --- | --- |
| `E` | `Env` | `Env` | Bindings and Variables available on `c.env` and `c.var` |
| `S` | `Schema` | `{}` | The accumulated route schema, grown by every route registration |
| `BasePath` | `string` | `'/'` | Prefix set by `basePath()`, merged into every route path |
| `CurrentPath` | `string` | `BasePath` | The last path registered, reused by chained calls that omit a path |

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112)

Because each method returns a new `HonoBase` type with a larger `S`, the schema only exists on the value returned by a chain. Routes registered in separate statements are not reflected in `typeof app`; chain them (or assign the chain result to a variable) when the type is needed for RPC.

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160), [src/hono-base.ts:125-140](repo://src/hono-base.ts#L125-L140)

```ts
const route = new Hono()
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))
  .post('/posts', (c) => c.json({ ok: true }, 201))

export type AppType = typeof route
```

Sources: [src/types.ts:168-182](repo://src/types.ts#L168-L182), [src/context.ts:181-208](repo://src/context.ts#L181-L208)

## Env, Bindings and Variables

### Declaring the environment

`Env` is an object type with two optional slots: `Bindings` (platform bindings such as Cloudflare KV, secrets or environment variables) and `Variables` (values set by middleware with `c.set`). `BlankEnv` is the empty object. Both `Bindings` and `Variables` are aliases of `object`, so any record shape is accepted.

Sources: [src/types.ts:26-35](repo://src/types.ts#L26-L35)

```ts
type AppEnv = {
  Bindings: { DB: D1Database; SECRET: string }
  Variables: { user: { id: string } }
}

const app = new Hono<AppEnv>()
app.get('/me', (c) => c.json(c.var.user)) // typed from Variables
```

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:593-597](repo://src/context.ts#L593-L597)

### How Context reads it

`Context` takes `E`, `P` (the path) and `I` (the input). `c.env` is typed as `E['Bindings']`. `c.set` and `c.get` are typed by the `Set` and `Get` interfaces, which offer one overload keyed by `keyof E['Variables']` and a second keyed by `ContextVariableMap`, a global interface that libraries and applications augment with `declare module`. When `E` is `any`, both fall back to `ContextVariableMap & Record<string, any>`. The `c.var` getter returns a `Readonly` intersection of the same two sources.

Sources: [src/context.ts:57-57](repo://src/context.ts#L57-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/context.ts:293-315](repo://src/context.ts#L293-L315), [src/context.ts:546-597](repo://src/context.ts#L546-L597)

### Merging environments from middleware

A middleware can declare its own `Env` (for example one that sets a `user` variable). The handler interfaces capture each handler's environment as `E2`, `E3` and so on, and combine them with `IntersectNonAnyTypes`. That helper walks a tuple and intersects every element, turning `any` into `{}` (via `IfAnyThenEmptyObject`) and turning the bare `Env` type into `{}` so a default does not widen the result. As a result, the variables a middleware sets become visible to the handlers registered after it in the same call.

Sources: [src/types.ts:2762-2766](repo://src/types.ts#L2762-L2766), [src/utils/types.ts:21-21](repo://src/utils/types.ts#L21-L21), [src/types.ts:1080-1108](repo://src/types.ts#L1080-L1108)

## Handler types

### Handler, MiddlewareHandler and H

A `Handler` is `(c: Context<E, P, I>, next: Next) => R` where `R` is a `HandlerResponse`: a `Response`, a `TypedResponse`, a promise of either, or `Promise<void>`. A `MiddlewareHandler` has the same arguments but always returns `Promise<R | void>`, since middleware usually calls `await next()` without returning. `H` is the union of both and is what the router stores. `Next` is `() => Promise<void>`.

Sources: [src/types.ts:35-35](repo://src/types.ts#L35-L35), [src/types.ts:70-96](repo://src/types.ts#L70-L96)

| Type | Generic defaults | Returns |
| --- | --- | --- |
| `Handler` | `E = any`, `P = any`, `I = BlankInput`, `R = any` | `R` |
| `MiddlewareHandler` | `E = any`, `P = string`, `I = {}`, `R = Response` | `Promise<R \| void>` |
| `H` | `E = any`, `P = any`, `I = BlankInput`, `R = any` | either of the above |
| `NotFoundHandler` | `E = any` | `Response`, or the augmented `NotFoundResponse` |
| `ErrorHandler` | `E = any` | `Response \| Promise<Response>` |

Sources: [src/types.ts:76-120](repo://src/types.ts#L76-L120)

### Customising notFound

`NotFoundResponse` is an empty interface. If an application augments it to extend `Response` and a `TypedResponse`, `NotFoundHandler` switches its return type to that interface, so `c.notFound()` contributes a typed 404 to inference.

Sources: [src/types.ts:97-111](repo://src/types.ts#L97-L111)

## Route method overloads

### HandlerInterface

`HandlerInterface<E, M, S, BasePath, CurrentPath>` types `app.get`, `app.post`, `app.put`, `app.delete`, `app.options`, `app.patch` and `app.all`; `M` is the lowercase method name. It is a long list of call signatures because TypeScript cannot infer a variadic chain of handlers whose input and environment types flow from one to the next. There are overloads for one to ten handlers, each with and without a leading path argument, plus catch-all overloads for a handler array and for a bare path.

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160), [src/types.ts:1043-1072](repo://src/types.ts#L1043-L1072)

In an overload with a path, `P` is the literal path and `MergedPath` is `MergePath<BasePath, P>`, which is passed to every handler so that `c.req.param()` knows the full path including the base path. In an overload without a path, `P` defaults to `CurrentPath`, the path of the previous call. Inputs chain too: `I2` defaults to `I`, `I3` to `I & I2`, so a handler sees the inputs of every validator before it.

Sources: [src/types.ts:168-182](repo://src/types.ts#L168-L182), [src/types.ts:185-210](repo://src/types.ts#L185-L210)

```ts
// excerpt: app.get(path, handler)
  <
    P extends string,
    MergedPath extends MergePath<BasePath, P>,
    R extends HandlerResponse<any> = any,
    I extends Input = BlankInput,
    E2 extends Env = E,
  >(
    path: P,
    handler: H<E2, MergedPath, I, R>
  ): HonoBase<
    E,
    AddSchemaIfHasResponse<MergeTypedResponse<R>, S, M, P, I, BasePath>,
    BasePath,
    MergePath<BasePath, P>
  >
```

Sources: [src/types.ts:168-182](repo://src/types.ts#L168-L182)

### MiddlewareHandlerInterface and OnHandlerInterface

`app.use` is typed by `MiddlewareHandlerInterface`. Its overloads never add to `S`; they only intersect environments and set the current path to `MergePath<BasePath, '*'>` when no path is given. `app.on` is typed by `OnHandlerInterface`, whose overloads take the method (a string or an array of strings) as a type parameter and add a `ToSchema` entry for it, mirroring `HandlerInterface`.

Sources: [src/types.ts:1080-1108](repo://src/types.ts#L1080-L1108), [src/types.ts:1457-1479](repo://src/types.ts#L1457-L1479)

## Schema accumulation

### Schema and Endpoint

A `Schema` maps a path to an object whose keys are `$`-prefixed lowercase methods (`$get`, `$post`), each holding an `Endpoint`: `input`, `output`, `outputFormat` and `status`.

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551)

```ts
type Expected = {
  '/': {
    $get: {
      input: { json: Payload }
      output: { message: string }
      outputFormat: 'json'
      status: ContentfulStatusCode
    }
  }
}
```

Sources: [src/types.test.ts:90-104](repo://src/types.test.ts#L90-L104)

### ToSchema

`ToSchema<M, P, I, RorO>` builds one schema entry. It maps the path `P` to an object whose key is `AddDollar<M>` (the method lowercased with a `$` prefix). The input is `AddParam<ExtractInput<I>, P>`: `ExtractInput` takes the `in` side of the validator input (or `{}` when unknown), and `AddParam` adds a `param` record derived from the path when the input does not already have one. The output side comes from `ToSchemaOutput`:

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529)

1. If the response type is `any`, the entry gets `output: {}`, `outputFormat: ResponseFormat` and `status: StatusCode`.
2. If it is `never` or `Promise<void>`, no entry is added at all (`{}`), which is how pure middleware stays out of the schema.
3. If it is a `TypedResponse<T, U, F>`, output is `T`, status is `U`, and format is `F` unless the input declared an `outputFormat`.
4. Otherwise the raw type is used as output with format `'json'` and status `StatusCode`.

Sources: [src/types.ts:2483-2529](repo://src/types.ts#L2483-L2529), [src/types.ts:37-46](repo://src/types.ts#L37-L46), [src/types.ts:2601-2608](repo://src/types.ts#L2601-L2608)

Path-based overloads use `AddSchemaIfHasResponse`, which returns `S` unchanged when the merged response is `Promise<void>`, and otherwise `S & ToSchema<M, MergePath<BasePath, P>, I, Merged>`. Non-path overloads intersect `ToSchema` directly. Since each call intersects a new entry, two methods on one path merge into one path object with two `$method` keys.

Sources: [src/types.ts:2537-2544](repo://src/types.ts#L2537-L2544), [src/types.ts:127-160](repo://src/types.ts#L127-L160)

### Collecting response types

A route can respond from the final handler or from a middleware that short-circuits (for example a validator returning a 400). `MergeTypedResponse` normalises the final handler's return: a promise is unwrapped, and anything that is not a `TypedResponse` (a plain `Response`) becomes the bare `TypedResponse`. `MergeMiddlewareResponse` inspects each middleware's return type, drops `void`, and keeps only the `TypedResponse` parts. The overloads union these, so the endpoint becomes a union of entries, one per possible status and body.

Sources: [src/types.ts:2649-2674](repo://src/types.ts#L2649-L2674), [src/types.ts:185-210](repo://src/types.ts#L185-L210)

```mermaid
flowchart TD
  call["app.get(path, mw, handler)"] --> merge["MergePath(BasePath, path)"]
  call --> resp["MergeTypedResponse(R) or MergeMiddlewareResponse(M1)"]
  call --> input["ExtractInput(I) then AddParam"]
  resp --> check{"Response is Promise void?"}
  check -->|yes| keep["S unchanged"]
  check -->|no| toSchema["ToSchema(M, path, I, R)"]
  merge --> toSchema
  input --> toSchema
  toSchema --> next["HonoBase(E, S and entry, BasePath, path)"]
```

Sources: [src/types.ts:168-182](repo://src/types.ts#L168-L182), [src/types.ts:2500-2544](repo://src/types.ts#L2500-L2544), [src/types.ts:2649-2674](repo://src/types.ts#L2649-L2674)

### Sub-apps, route() and basePath()

`app.route(path, subApp)` returns `Hono<E, MergeSchemaPath<SubSchema, MergePath<BasePath, SubPath>> | S, BasePath, CurrentPath>`. `MergeSchemaPath` re-keys every path of the sub-app's schema with the mount prefix and, through `MergeEndpointParamsWithPath`, adds the prefix's own parameters (found by `ExtractParams`, with any `{regex}` suffix stripped from the key) to each endpoint's `input.param`. The result is a union with the parent schema rather than an intersection; `ExtractSchema` later turns that union into an intersection with `UnionToIntersection`. `basePath(path)` keeps `S` and moves both `BasePath` and `CurrentPath` to the merged path.

Sources: [src/hono-base.ts:208-251](repo://src/hono-base.ts#L208-L251), [src/types.ts:2553-2600](repo://src/types.ts#L2553-L2600), [src/types.ts:2737-2739](repo://src/types.ts#L2737-L2739)

### MergePath

`MergePath<A, B>` joins two literal paths at the type level the same way `mergePath` does at runtime: an empty `B` becomes `'/'`, an empty or `'/'` `A` yields `B`, and duplicate or missing slashes at the joint are normalised. `MergePath<'/api', '/users'>` is `'/api/users'`; `MergePath<'/api', '/'>` is `'/api'`.

Sources: [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624)

## Path parameter extraction

`ParamKeys<Path>` splits the path on `/` and runs `ParamKey` on each component. A component starting with `:` yields its name; a `{pattern}` suffix is removed, and a trailing `?` (after a pattern, or on the name itself) is kept to mark the parameter as optional. `ParamKeyToRecord` turns `'id'` into `{ id: string }` and `'id?'` into `Record<'id', string | undefined>`.

Sources: [src/types.ts:2698-2714](repo://src/types.ts#L2698-L2714)

`HonoRequest<P, I>` uses these for `c.req.param`. With a key, required keys return `string` and optional keys (matched after `RemoveQuestion`) return `string | undefined`; when `P` is plain `string`, any key is accepted. Without a key, it returns `Simplify<UnionToIntersection<ParamKeyToRecord<ParamKeys<P2>>>>`, the full parameter object.

Sources: [src/request.ts:36-36](repo://src/request.ts#L36-L36), [src/request.ts:94-103](repo://src/request.ts#L94-L103), [src/types.ts:2729-2729](repo://src/types.ts#L2729-L2729)

```ts
app.get('/posts/:id/:comment_id?', (c) => {
  const id = c.req.param('id') // string
  const commentId = c.req.param('comment_id') // string | undefined
  const all = c.req.param() // { id: string; comment_id: string | undefined }
  return c.text(id)
})
```

Sources: [src/request.ts:94-103](repo://src/request.ts#L94-L103), [src/types.ts:2698-2714](repo://src/types.ts#L2698-L2714)

## Input and validation targets

`Input` has three optional fields: `in` (what the client sends, used by the RPC client), `out` (what the handler reads after validation) and `outputFormat`. The `validator` function builds such a type: for each target `U` it sets `in` to the pre-validation shape (for `json`, the declared input type or the validator output; for others, `InferInput` over form values) and `out` to `ExtractValidatorOutput<VF>`, and returns `MiddlewareHandler<E, P, V, ExtractValidationResponse<VF>>`.

Sources: [src/types.ts:42-46](repo://src/types.ts#L42-L46), [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88)

`ValidationTargets` lists the targets and their raw shapes. `Context` passes `I['out']` to `HonoRequest`, whose `valid(target)` returns `InputToDataByTarget<I, T>`, the validated type for that target.

Sources: [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690), [src/types.ts:2720-2727](repo://src/types.ts#L2720-L2727), [src/request.ts:351-354](repo://src/request.ts#L351-L354), [src/context.ts:293-303](repo://src/context.ts#L293-L303)

| Target | Raw type |
| --- | --- |
| `json` | `any` |
| `form` | `Record<string, T \| T[]>` with `T` defaulting to `string \| File` |
| `query` | `Record<string, string \| string[]>` |
| `param` | `Record<P, string>`, `string \| undefined` for optional names |
| `header` | `Record<RequestHeader \| CustomHeader, string>` |
| `cookie` | `Record<string, string>` |

Sources: [src/types.ts:2680-2690](repo://src/types.ts#L2680-L2690)

## TypedResponse

`TypedResponse<T, U, F>` is a phantom type with `_data`, `_status` and `_format` fields; no runtime object has them. The format defaults to `'text'` when `T` is a string, `'json'` when `T` is a `JSONValue`, and `ResponseFormat` otherwise. `KnownResponseFormat` is `'json' | 'text' | 'redirect'`, and `ResponseFormat` allows any string so helpers such as WebSockets can use `'ws'`.

Sources: [src/types.ts:2632-2647](repo://src/types.ts#L2632-L2647)

The `Context` response helpers return `Response & TypedResponse<...>`. `c.text` returns `TypedResponse<T, U, 'text'>` with the literal string type. `c.json` returns `TypedResponse<JSONParsed<T>, U, 'json'>`, where `JSONParsed` converts the value to what `JSON.stringify` would produce: values with `toJSON` (like `Date`) become their JSON form, `undefined`, symbols and functions are dropped from objects (a property that may hold one becomes `| undefined`) and turned into `null` in arrays, `Set`, `Map` and empty records become `{}`, and `bigint` makes the type `never` unless `TError` is overridden.

Sources: [src/context.ts:156-208](repo://src/context.ts#L156-L208), [src/utils/types.ts:23-87](repo://src/utils/types.ts#L23-L87)

## How the RPC client consumes the schema

`Client<T, Prefix>` infers `S` from `HonoBase<any, infer S, any>` and, for every path key, uses `PathToChain` to split the path on `/` into nested objects (an empty segment becomes `index`). At the leaf it builds a `ClientRequest` from that path's methods: each `$method` becomes a function whose `args` is the endpoint's `input` (required when the input has required keys) and whose result is a `ClientResponse` carrying `output`, `status` and `outputFormat`. `$url` and `$path` are added for every path, and `$ws` when `$get` has `outputFormat: 'ws'`.

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/client/types.ts:67-126](repo://src/client/types.ts#L67-L126)

`ClientResponse` narrows `ok` to `true` for success status codes and `false` otherwise, so checking `res.ok` narrows the union of endpoint entries produced by multiple `TypedResponse` statuses. See [[RPC Client (hc)]] for the runtime side.

Sources: [src/client/types.ts:128-140](repo://src/client/types.ts#L128-L140)

## Type utilities

### Exported helpers in types.ts

| Type | Purpose |
| --- | --- |
| `ExtractSchema<T>` | The schema of a `Hono` type, with unions from `route()` intersected |
| `ExtractSchemaForStatusCode<T, Status>` | The same schema filtered to endpoints with one status code |
| `ExtractHandlerResponse<T>` | The non-void `Response` or `TypedResponse` a handler returns |
| `IntersectNonAnyTypes<T>` | Intersect a tuple of environments, ignoring `any` and bare `Env` |
| `MergePath<A, B>` | Join two literal paths |
| `MergeSchemaPath<S, P>` | Prefix every path in a schema and add the prefix's params |

Sources: [src/types.ts:2737-2766](repo://src/types.ts#L2737-L2766), [src/types.ts:2563-2570](repo://src/types.ts#L2563-L2570), [src/types.ts:2610-2624](repo://src/types.ts#L2610-L2624)

### Generic helpers in utils/types.ts

`src/utils/types.ts` holds framework-agnostic helpers: `Expect`, `Equal` and `NotEqual` for type tests, `UnionToIntersection` (via contravariant function parameters), `RemoveBlankRecord`, `IfAnyThenEmptyObject` and `IsAny`, the `JSONValue` family and `JSONParsed`, `Simplify` and `SimplifyDeepArray` for flattening editor hints, `InterfaceToType`, `RequiredKeysOf` and `HasRequiredKeys` (used by the client to decide whether `args` is required), and `StringLiteralUnion` for literal autocompletion that still accepts any string.

Sources: [src/utils/types.ts:7-120](repo://src/utils/types.ts#L7-L120)

> [!TIP]
> The type tests in `src/types.test.ts` use `Expect<Equal<Expected, Actual>>` against `ExtractSchema<typeof route>`; they are the clearest reference for what schema a given chain produces.

Sources: [src/types.test.ts:80-104](repo://src/types.test.ts#L80-L104), [src/utils/types.ts:7-10](repo://src/utils/types.ts#L7-L10)
