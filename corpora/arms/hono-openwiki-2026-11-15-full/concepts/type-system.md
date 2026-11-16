---
type: concept
title: Type System and Schema Inference
description: How Hono's compile-time types in src/types.ts model environments (Bindings/Variables), handler and middleware signatures, path parameter inference, schema accumulation per route, typed responses and JSON serialization, and how the type tests are run.
tags: [types, typescript, schema, inference, rpc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-42f32064bdeac43eac5d0e75
    resource: repo://src/utils/types.ts
  - id: openwiki-source-cfec35e61a853579c60d6d5d
    resource: repo://tsconfig.spec.json
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Type System and Schema Inference

A large part of Hono is type-level code that has no runtime effect. `src/types.ts` (≈2,800 lines) and `src/utils/types.ts` make three things possible:

1. Typed `c.env`, `c.get()/c.var` and `c.req.param()` inside handlers.
2. Accumulating a **Schema** type on the app as routes are registered.
3. Feeding that schema to the [RPC client](../integrations/rpc-client.md) and to [validator](validation.md)-aware `c.req.valid()`.

## Env, Bindings and Variables

```ts
type Env = { Bindings?: object; Variables?: object }
const app = new Hono<{ Bindings: { DB: D1Database }; Variables: { user: User } }>()
```

- `Bindings` types `c.env` (the second argument of `fetch`).
- `Variables` types `c.set/c.get/c.var`. Libraries can also augment the global `ContextVariableMap` interface (declared in `src/context.ts`) so their keys are typed for every app.
- Middleware can contribute to the environment: handler overloads take an extra `E2/E3/...` generic per handler and combine them with `IntersectNonAnyTypes<[E, E2, ...]>`, which drops `any` and bare `Env` members so an untyped middleware does not erase the app's types. `createMiddleware<{ Variables: { foo: string } }>(...)` from `hono/factory` relies on this.

## Handler types

- `Handler<E, P, I, R>` = `(c: Context<E, P, I>, next) => R`.
- `MiddlewareHandler<E, P, I, R>` = `(c, next) => Promise<R | void>`.
- `H` is the union of both; it is the element type stored in routers (`Router<[H, RouterRoute]>`).
- `NotFoundHandler` and `ErrorHandler`. `NotFoundResponse` is an empty interface that apps may augment (via `declare module 'hono'`) to give `c.notFound()` a typed response.

## HandlerInterface: overload ladder

`HandlerInterface` (types for `app.get/post/...`), `MiddlewareHandlerInterface` (`app.use`) and `OnHandlerInterface` (`app.on`) are long lists of explicit overloads: with/without a path, and with 1 up to 10 handlers. Each position gets its own `E`, `I` and middleware generic, so inputs declared by a validator in position 1 flow into the handler in position 2 (`I2 extends Input = I`, `I3 = I & I2`, ...). Beyond ten handlers a rest-parameter fallback (`...handlers: H<E, P, I, R>[]`) keeps the call type-checking with less precise inference.

Each overload returns a new `HonoBase<E', S & ToSchema<...>, BasePath, CurrentPath>`, which is why **chaining** (`new Hono().get(...).post(...)`) is required to retain the full schema in a variable; separate statements on an existing variable do not change its declared type.

## Path parameters

`ParamKeys<Path>` splits a route string on `/` and extracts `:name` components:

- `:id{[0-9]+}` → key `id` (the regex part is dropped);
- `:id?` → `id?`, which `ParamKeyToRecord` maps to `string | undefined`.

`c.req.param('id')` is typed from these keys (required keys return `string`, optional ones `string | undefined`). `AddParam<I, P>` injects `{ param: ... }` into a route's input unless a validator already supplied a typed `param` target.

## Paths and base paths

`MergePath<A, B>` mirrors runtime `mergePath()` at the type level (handles leading/trailing slashes, `''` and `/`). `BasePath` and `CurrentPath` generics on `HonoBase` track `basePath()` and the sticky current path. `MergeSchemaPath<Schema, SubPath>` re-keys a sub-app's schema under a mount prefix for `app.route()`, and adds param types extracted from the prefix (e.g. `/users/:userId`) into every endpoint's `input.param`.

## Schema and endpoints

```ts
type Schema = { [Path: string]: { [Method: `$${Lowercase<string>}`]: Endpoint } }
type Endpoint = { input: any; output: any; outputFormat: ResponseFormat; status: StatusCode }
```

`ToSchema<M, P, I, R>` produces `{ [P]: { $get: { input, output, outputFormat, status } } }`:

- `input` = validator inputs (`I['in']`) plus params.
- `output`, `outputFormat` and `status` come from a `TypedResponse` returned by the handler; if the response is untyped, `output` is `{}`, and status is the generic `StatusCode`.
- A handler whose return type is only `Promise<void>` (pure middleware) contributes nothing (`AddSchemaIfHasResponse`).
- Typed responses returned early by middleware in the chain are unioned into the endpoint via `MergeMiddlewareResponse`.

Method keys are prefixed with `$` and lower-cased (`$get`, `$post`), matching the client's call syntax.

## TypedResponse and JSON serialization

`c.json()`, `c.text()`, `c.body()` and `c.redirect()` return `Response & TypedResponse<T, Status, Format>`. `TypedResponse` is a phantom type (`_data`, `_status`, `_format`) with no runtime fields.

For JSON, `JSONParsed<T>` (`src/utils/types.ts`) models what survives `JSON.stringify` + `JSON.parse`: `toJSON()` results are used (so `Date` becomes `string`), `undefined`/functions/symbols are dropped from objects and become `null` in arrays, `Map`/`Set` become `{}`, and `bigint` values make the type `never` (configurable via the `TError` parameter). The client therefore sees the deserialized shape rather than the server-side type.

## Utilities

- `ExtractSchema<typeof app>` and `ExtractSchemaForStatusCode<typeof app, 200>` retrieve schemas for tooling.
- `ValidationTargets` defines the shape of each validator target (`json`, `form`, `query`, `param`, `header`, `cookie`).
- `InputToDataByTarget` types `c.req.valid(target)`.
- `src/utils/types.ts` has general helpers (`UnionToIntersection`, `Simplify`, `IsAny`, `Equal`/`Expect` for tests).

## Testing types

Type behavior is tested by compiling, not by running:

- `npm test` runs `tsc -p tsconfig.spec.json` (noEmit over all of `src`) before Vitest, so type regressions fail CI.
- `src/types.test.ts` (≈4,100 lines) and `src/client/types.test.ts` use `expectTypeOf` and the `Expect<Equal<...>>` helpers.
- `@ts-expect-error` lines assert that invalid usage stays rejected (e.g. `Bindings: number` in preset tests).

Coverage excludes `src/**/types.ts` because these files are compile-time only.

## Extending safely

When adding a new middleware that sets variables, type it via `createMiddleware<{ Variables: ... }>` or by declaring `ContextVariableMap`. When changing an overload in `HandlerInterface`, update all arities consistently and add cases to `src/types.test.ts`; inference regressions are otherwise silent at runtime.
