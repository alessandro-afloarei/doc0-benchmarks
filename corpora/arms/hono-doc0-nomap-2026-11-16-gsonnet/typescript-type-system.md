---
title: "Type System and Typed Routes"
---
## Overview

Most of `src/types.ts` (about 2,800 lines, mostly overloads) exists to carry route information in the type of the app object. Every call to `app.get(...)` returns a `HonoBase` whose second type parameter, the `Schema`, has grown by one entry describing that route's path, method, input and output. The RPC client reads that schema back (see [[RPC Client (hc)]]), and handlers read the same information through `c.req.param`, `c.req.valid` and `c.get`. Nothing here exists at runtime: only plain types are involved, apart from the `FetchEventLike` abstract class.

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160), [src/types.ts:2500-2535](repo://src/types.ts#L2500-L2535)

## Environment and handler types

`Env` has two optional parts: `Bindings` (what the platform passes as the second argument to `fetch`, exposed as `c.env`) and `Variables` (what `c.set` and `c.get` accept). `Input` describes validated data: `in` for what a client sends, `out` for what `c.req.valid` returns, and `outputFormat`.

Sources: [src/types.ts:26-47](repo://src/types.ts#L26-L47)

A `Handler` is `(c: Context<E, P, I>, next: Next) => R`, where `E` is the environment, `P` the path string and `I` the input. `MiddlewareHandler` has the same arguments but returns `Promise<R | void>`, so a middleware may finish without producing a response. `H` is the union of both. `NotFoundHandler` and `ErrorHandler` are the shapes accepted by `app.notFound` and `app.onError`; the error handler receives `Error | HTTPResponseError`, an error with a `getResponse` method such as `HTTPException`.

Sources: [src/types.ts:70-125](repo://src/types.ts#L70-L125)

`RouterRoute` is the stored record for a route: `basePath`, `path`, `method` and `handler`. It is what `app.routes` holds and what the router returns next to each handler.

Sources: [src/types.ts:57-62](repo://src/types.ts#L57-L62), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## Typed registration

`HandlerInterface` is the type of `app.get`, `post` and the other method functions. It is a very large overload list: one signature for a single handler, one per count of handlers, and one per path-plus-handlers form. In each signature the new route is added to the app's schema through `ToSchema`, and the environment is merged with `IntersectNonAnyTypes<[E, E2]>`.

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160)

```ts
// app.get(handler)
<P extends string = CurrentPath, I extends Input = BlankInput, R extends HandlerResponse<any> = any, E2 extends Env = E>(
  handler: H<E2, P, I, R>
): HonoBase<
  IntersectNonAnyTypes<[E, E2]>,
  S & ToSchema<M, P, I, MergeTypedResponse<R>>,
  BasePath,
  CurrentPath
>
```

Sources: [src/types.ts:127-160](repo://src/types.ts#L127-L160)

`MiddlewareHandlerInterface` (for `app.use`) and `OnHandlerInterface` (for `app.on`) follow the same scheme. Their overloads also chain environments so that a middleware that declares `Variables` makes them visible to the handlers registered after it.

Sources: [src/types.ts:1080-1110](repo://src/types.ts#L1080-L1110), [src/types.ts:1457-1480](repo://src/types.ts#L1457-L1480)

## The schema

`Schema` maps a path to methods named `$get`, `$post` and so on (`AddDollar` lower-cases the method and prefixes `$`). Each method is an `Endpoint` with `input`, `output`, `outputFormat` and `status`.

Sources: [src/types.ts:2531-2551](repo://src/types.ts#L2531-L2551), [src/types.ts:2608-2608](repo://src/types.ts#L2608-L2608)

`ToSchema<M, P, I, RorO>` builds one entry. If the handler's return type is `any`, the output is `{}` with a generic format and any status; if it is `never` or `Promise<void>`, the route adds nothing; otherwise the input is `AddParam<ExtractInput<I>, P>` combined with `ToSchemaOutput`, which reads data, status and format from a `TypedResponse`.

Sources: [src/types.ts:2483-2530](repo://src/types.ts#L2483-L2530)

`TypedResponse<T, U, F>` is a type with `_data`, `_status` and `_format`. The format defaults to `'text'` for string data and `'json'` for JSON values. `c.json`, `c.text` and the other helpers return `Response & TypedResponse<...>`, which is how a plain `Response` carries its body type. `MergeTypedResponse` falls back to a bare `TypedResponse` when a handler returns something untyped.

Sources: [src/types.ts:2632-2660](repo://src/types.ts#L2632-L2660), [src/context.ts:122-140](repo://src/context.ts#L122-L140)

## Path parameters

`ParamKeys<Path>` splits a path at `/`, keeps the components starting with `:` and removes a trailing `{pattern}`; a pattern ending in `?`, or a name written with `?`, keeps the `?`. `ParamKeyToRecord` turns a key into `{ name: string }` or, with `?`, `{ name: string | undefined }`. `AddParam` adds the resulting `param` record to the input unless one already exists.

Sources: [src/types.ts:2698-2717](repo://src/types.ts#L2698-L2717), [src/types.ts:2601-2607](repo://src/types.ts#L2601-L2607)

`HonoRequest.param` uses the same helpers: with a literal path type, `c.req.param('id')` is typed `string`, an optional parameter returns `string | undefined`, and `c.req.param()` returns the full record. See [[Request Parsing and Validation]].

Sources: [src/request.ts:84-103](repo://src/request.ts#L84-L103)

## Grouping and base paths

`MergePath<A, B>` joins two path types the way `mergePath` joins strings at runtime, handling empty segments, a trailing `/` on `A` and a leading `/` on `B`. `MergeSchemaPath` rewrites every key of a sub-app's schema under a new prefix and merges any `:param` segments of that prefix into each endpoint's `input.param` (stripping `{...}` patterns). They give `app.route` and `app.basePath` their return types.

Sources: [src/types.ts:2563-2630](repo://src/types.ts#L2563-L2630), [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/hono-base.ts:247-249](repo://src/hono-base.ts#L247-L249)

## Validation targets

`ValidationTargets` names the six validated parts and the type of each raw value: `json` is `any`, `form` a record of values or arrays, `query` a record of strings or string arrays, `param`, `header` and `cookie` records of strings. `InputToDataByTarget` is what `c.req.valid(target)` returns: the `out` entry for that target. See [[Request Parsing and Validation]].

Sources: [src/types.ts:2680-2696](repo://src/types.ts#L2680-L2696), [src/types.ts:2720-2729](repo://src/types.ts#L2720-L2729)

## Reading the schema back

`ExtractSchema<T>` takes the `S` parameter out of a `HonoBase` type; `ExtractSchemaForStatusCode` narrows endpoints to one status. The client types start from `ExtractSchema<App>` to build its path tree.

Sources: [src/types.ts:2737-2749](repo://src/types.ts#L2737-L2749), [src/client/types.ts:294-320](repo://src/client/types.ts#L294-L320)

`ExtractHandlerResponse` pulls a response type out of a handler function type, ignoring `void`. `IntersectNonAnyTypes` combines environments and treats `any` or the generic `Env` as `{}`, so an untyped middleware does not erase the typed environment.

Sources: [src/types.ts:2750-2766](repo://src/types.ts#L2750-L2766)

## Context-level extension points

Two empty interfaces are meant to be augmented by applications: `ContextVariableMap` gives global typed variables for `c.get` and `c.set`, and `ContextRenderer` types the arguments of `c.render`. When `ContextRenderer` has been extended to a function type, `Renderer` and `PropsForRenderer` pick up its parameter types.

Sources: [src/context.ts:57-95](repo://src/context.ts#L57-L95)
