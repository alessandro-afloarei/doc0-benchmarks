---
title: "Type Inference"
---
## Overview

Hono has no code generation step: the types of an app come from the generic parameters that each method call returns. A route's path, its validated input and its response are carried as types, and the app's `S` parameter accumulates them as a `Schema` object. That schema is what the typed client in [[Typed Client]] reads. Nothing here runs at request time; the runtime behaviour is in [[App and Routing]] and [[Request Dispatch]].

Sources: [src/hono-base.ts:98-111](repo://src/hono-base.ts#L98-L111), [src/types.ts:2531-2535](repo://src/types.ts#L2531-L2535)

## The app's type parameters

`Hono` is generic over the environment `E`, the schema `S`, the base path `BasePath` and the current path `CurrentPath`. Each method call returns a new `HonoBase` type with `S` extended by the route, so the type of `app` after `app.get(...)` knows that route. `CurrentPath` starts as the base path and is replaced by the path given to the latest call.

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124), [src/types.ts:127-150](repo://src/types.ts#L127-L150)

The method helpers are typed by `HandlerInterface`. Its first overload takes a handler and returns `HonoBase` with `S & ToSchema<M, P, I, MergeTypedResponse<R>>`, which means the new route's entry is intersected into the schema. The `P`, `I` and `R` parameters are the path, the input and the response of the handler.

Sources: [src/types.ts:127-146](repo://src/types.ts#L127-L146), [src/types.ts:2500-2530](repo://src/types.ts#L2500-L2530)

## The schema shape

A `Schema` maps each path to an object whose keys are methods written with a leading `$`, such as `$get`. Each entry is an `Endpoint` with four fields: the `input`, the `output`, the `outputFormat` and the `status`.

Sources: [src/types.ts:2531-2535](repo://src/types.ts#L2531-L2535), [src/types.ts:2546-2551](repo://src/types.ts#L2546-L2551)

`ToSchema` builds that entry. Its `AddDollar` key and the `AddParam` input are what the client reads. When the response type is `never` or `Promise<void>`, the entry is `{}`, so a route whose handler produces no typed response adds nothing the client can call. When the response type is `any`, the output is left open as `{}`.

Sources: [src/types.ts:2500-2530](repo://src/types.ts#L2500-L2530)

## Paths and parameters

`MergePath` joins a base path and a sub path at the type level, following the same rules as the runtime `mergePath`: a `/` at either end is not doubled, and a base of `/` adds nothing. `#addRoute` applies the runtime version, so the type and the runtime path agree.

Sources: [src/types.ts:2610-2625](repo://src/types.ts#L2610-L2625), [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

Parameters are read from the path string. `ParamKeys` splits the path on `/`, and `ParamKeyToRecord` turns each `:name` into a key. A parameter written as `:name?` becomes an optional key, so `c.req.param('name')` is typed `string | undefined` for it.

Sources: [src/types.ts:2706-2729](repo://src/types.ts#L2706-L2729), [src/request.ts:100-106](repo://src/request.ts#L100-L106)

## Typed responses

`TypedResponse<T, U, F>` is a `Response` type with three phantom fields: `_data` for the body type, `_status` for the status code, and `_format` for the response format. The format defaults to `text` for string bodies and `json` for JSON values. The fields exist only for typing: at run time the value is an ordinary `Response`.

Sources: [src/types.ts:2635-2646](repo://src/types.ts#L2635-L2646)

`ExtractHandlerResponse` reads the return type of a handler. It keeps only `Response` or `TypedResponse` results, drops `void`, and yields `never` for anything else, so a handler that returns a plain value adds nothing to the schema.

Sources: [src/types.ts:2750-2760](repo://src/types.ts#L2750-L2760)

## Merging sub-apps

`route(path, app)` returns the parent type with the child's schema merged in. `MergeSchemaPath` rewrites every key of the child's schema with the new base path, and `MergeEndpointParamsWithPath` rewrites the `param` part of each endpoint's input for that prefix.

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217), [src/types.ts:2563-2575](repo://src/types.ts#L2563-L2575)

## Reading the schema

`ExtractSchema<T>` takes an app type and returns its schema as one intersection. `UnionToIntersection` combines the parts that a union of apps would produce. `ExtractSchemaForStatusCode` then keeps only the endpoints whose `status` matches a given code, which is how a client can type each status separately.

Sources: [src/types.ts:2737-2739](repo://src/types.ts#L2737-L2739), [src/types.ts:2741-2748](repo://src/types.ts#L2741-L2748)

## Validation input

The input part of an endpoint comes from the validators. `ValidationTargets` maps each target name to the shape of the value it provides, so a `json` validator's output or a `query` validator's output is what the client must send for that target.

Sources: [src/types.ts:2683-2691](repo://src/types.ts#L2683-L2691), [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89)

The validator's type parameter `V` holds an `in` and an `out` record for the target, and the middleware it returns is typed as `MiddlewareHandler<E, P, V, ...>`. The `Input` type that a route's handler takes is the same `{ in, out }` shape, which is how the input declared by a validator reaches the handler's `c.req.valid()` type. The run-time behaviour is in [[Validation]].

Sources: [src/validator/validator.ts:46-89](repo://src/validator/validator.ts#L46-L89), [src/types.ts:42-47](repo://src/types.ts#L42-L47)
