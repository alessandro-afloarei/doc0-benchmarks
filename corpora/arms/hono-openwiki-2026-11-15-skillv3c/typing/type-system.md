---
type: concept
title: Type System and Route Schema
description: How src/types.ts makes Hono type-safe end to end — Env with Bindings and Variables, the generic parameters of HonoBase, handler/middleware overloads that thread Env and Input through chains, path-parameter inference, TypedResponse, and accumulation of every route into a Schema type consumed by the RPC client.
tags: [types, typescript, schema, rpc, env, params]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-42f32064bdeac43eac5d0e75
    resource: repo://src/utils/types.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Type System and Route Schema

Much of Hono's API surface is type-level. `src/types.ts` (≈2,800 lines) defines how route definitions accumulate into a **schema type** on the app object, which the [RPC client](rpc-client.md) reads to type requests and responses. None of this exists at runtime; correctness is enforced by type tests (see [Testing](../testing/testing-strategy.md#type-tests)).

## The app's generic parameters

```ts
class Hono<E extends Env, S extends Schema, BasePath extends string, CurrentPath extends string>
```

- **`E` — `Env`** = `{ Bindings?: object; Variables?: object }`. `Bindings` types `c.env` (Cloudflare bindings, Lambda event, etc.); `Variables` types `c.get/c.set/c.var`. The global `ContextVariableMap` interface can be augmented for app-wide variables (see [Context](../core/context.md#variables)).
- **`S` — `Schema`** = `{ [path]: { [$method]: Endpoint } }` where `Endpoint` = `{ input, output, outputFormat, status }`. It starts as `{}` and grows with every route.
- **`BasePath`** — accumulated by `basePath()`/`route()` via the `MergePath` type (which mirrors the runtime `mergePath` slash rules).
- **`CurrentPath`** — the path set by the last `app.get('/path', ...)`, so a chained `.post(handler)` is typed for that path.

## Handler typing

- `Handler<E, P, I, R>` / `MiddlewareHandler<E, P, I, R>` — `(c: Context<E, P, I>, next) => R`. `H` is their union.
- `HandlerInterface` (used for `app.get/post/...`) is a large set of overloads — with and without a path, and for **1 to N handlers** in one call. Each handler's `Env` and `Input` type parameters are intersected left to right (`IntersectNonAnyTypes`), so a middleware that declares `Variables: { user: User }` or a validator that declares `in/out` makes those types visible to the handlers after it in the same call. `MiddlewareHandlerInterface` (for `use`) and `OnHandlerInterface` (for `on`) follow the same pattern; `use` can also widen `E` for the rest of the app.
- `Input` = `{ in?, out?, outputFormat? }`: `in` is what the client must send (used by RPC), `out` is what `c.req.valid()` returns after validation. [Validators](../validation/validator.md) produce these.
- `HandlerResponse<O>` allows `Response`, `TypedResponse`, and promises of them.

Because these overloads are enumerated explicitly, handlers defined **outside** the route call lose inference; `createFactory().createHandlers(...)` and `createMiddleware()` (see [Utility Helpers](../helpers/utility-helpers.md#factory--honofactory)) exist to restore it.

## Path parameters

`ParamKeys<'/posts/:id/comments/:cid{[0-9]+}?'>` parses the path string literal: each `:name` segment yields `name`, a `{regex}` suffix is stripped, and a trailing `?` marks it optional. `ParamKeyToRecord` turns optional keys into `string | undefined`. This types `c.req.param()` (see [HonoRequest](../core/request.md)) and is added to the schema input as `param` (`AddParam`) unless a validator already declared `param`.

## Responses: `TypedResponse`

`c.json`, `c.text`, `c.body`, `c.redirect` return `Response & TypedResponse<T, Status, Format>` — a phantom `{ _data, _status, _format }` shape. `c.json(obj)` uses `JSONParsed<T>` so the type reflects what survives `JSON.stringify` (e.g. `Date` → `string`, functions dropped). The status literal is captured, so returning `c.json(err, 404)` and `c.json(data, 200)` from one handler yields a union of two endpoints.

## Building the schema: `ToSchema`

For each route registration the overload returns a new `HonoBase` with `S & ToSchema<Method, Path, Input, Response>`:

```ts
ToSchema<'get', '/posts/:id', I, R> = {
  '/posts/:id': {
    $get: { input: AddParam<I['in'], '/posts/:id'>; output: T; outputFormat: F; status: U }
  }
}
```

- Methods are lower-cased and `$`-prefixed (`AddDollar`), matching the client's `$get` calls.
- If the handler's response type is `any`, the output becomes `{}`; if it is `Promise<void>` (middleware that only calls `next()`), **no schema entry** is added.
- Responses of middleware in the same chain that can return early (e.g. a 401 `c.json`) are merged into the route's output union (`MergeMiddlewareResponse`).
- `route(path, subApp)` merges the sub-app's schema with `MergeSchemaPath<SubSchema, MergePath<BasePath, path>>`, prefixing keys and adding any params from the mount path to each endpoint's input.

**Only chained definitions are captured.** `app.get(...)` returns a new type, so the schema accumulates only when calls are chained (`const app = new Hono().get(...).post(...)`) or when the result of each call is used; statements like `app.get(...)` on separate lines don't change the type of `app`. This is the documented way to export `typeof app` for RPC.

## Extraction helpers

- `ExtractSchema<typeof app>` — the schema type; `ExtractSchemaForStatusCode<typeof app, 200>` filters endpoints by status.
- `ExtractHandlerResponse<typeof handler>` — the response type of a handler.
- Client-side `InferRequestType` / `InferResponseType`, `PickResponseByStatusCode`, `ApplyGlobalResponse` live in `src/client/types.ts` (see [RPC Client](rpc-client.md#type-level-api-typests)).
- `src/utils/types.ts` provides helpers such as `UnionToIntersection`, `Simplify`, `IsAny`, `JSONValue`/`JSONParsed`, and `RequiredKeysOf`.

## Tests and performance

`src/types.test.ts` (≈4,000 lines) asserts inference with `expectTypeOf` for chained routes, sub-apps, params, validators, middleware variables and responses. Because deep generic types can slow compilation, `perf-measures/type-check` tracks `tsc` diagnostics on a generated large app in CI.
