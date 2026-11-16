---
title: "Type System"
---
## Overview

Most of Hono's types exist only at compile time. They say what the `c.env` bindings are, which variables a handler may set, what a handler returns, and what routes the typed client may call. None of them change the code that runs. The runtime pieces are the handlers themselves and the `Context` class, and [[Context]] describes those. This page lists the types a user writes against and the helper that reuses them.

Sources: [src/types.ts:26-35](repo://src/types.ts#L26-L35)

## Environment and variables

`Env` is an object type with two optional keys. `Bindings` describes the values in `c.env`, such as Cloudflare bindings or environment variables. `Variables` describes the values that `c.set` and `c.get` store. The `Context` class is generic over `E`, so the typed `env`, `set` and `get` take their key types from the `Env` the app declares.

Sources: [src/types.ts:26-33](repo://src/types.ts#L26-L33), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/context.ts:546-556](repo://src/context.ts#L546-L556)

Applications can add keys to the variable map without editing the framework. `ContextVariableMap` is an empty interface that the application may extend, and `get` and `set` accept its keys when no `Variables` type is given.

Sources: [src/context.ts:54-58](repo://src/context.ts#L54-L58), [src/context.ts:95-108](repo://src/context.ts#L95-L108)

## Handlers and middleware

`Handler` is a function of the context and `next`, and returns the handler's result type `R`. `MiddlewareHandler` is the same shape but returns a `Promise` of `R` or nothing, because a middleware may call `next()` and return nothing. The type `H` is the union of the two, which is what the router stores.

Sources: [src/types.ts:76-95](repo://src/types.ts#L76-L95)

The error and not-found handlers have their own types. `NotFoundHandler` returns a `Response`, and `ErrorHandler` takes an `Error` or an `HTTPResponseError` with a `getResponse` method. An application can change the type of the not-found response by extending the empty `NotFoundResponse` interface.

Sources: [src/types.ts:97-119](repo://src/types.ts#L97-L119)

## Routes and the client

`Schema` maps each path string to an object whose keys are method names with a `$` prefix, such as `$get`, and whose values are `Endpoint` types. The app's type carries this schema, and the typed client reads it to type each call. `route` merges the sub-app's schema into the parent's, with the parent's base path added to each path.

Sources: [src/types.ts:2531-2535](repo://src/types.ts#L2531-L2535), [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217)

`TypedResponse` carries the body type, the status code and the format as three fields, `_data`, `_status` and `_format`. The fields are only for inference: the runtime object is a plain `Response`. The format defaults to `text` for a string body and `json` for a JSON value.

Sources: [src/types.ts:2635-2647](repo://src/types.ts#L2635-L2647)

`ValidationTargets` names the six parts of a request that the validator can read: `json`, `form`, `query`, `param`, `header` and `cookie`. The input types of the validator and the client both come from this map, as [[Validation]] shows.

Sources: [src/types.ts:2683-2690](repo://src/types.ts#L2683-L2690)

## The factory helper

`createFactory` returns a `Factory`, which holds the environment type and an optional `initApp` and default options. Its `createApp` builds a `Hono` with the default options merged with the call's options, then calls `initApp` on it, so a set of apps shares one setup.

Sources: [src/helper/factory/index.ts:332-351](repo://src/helper/factory/index.ts#L332-L351), [src/helper/factory/index.ts:363-366](repo://src/helper/factory/index.ts#L363-L366)

`createMiddleware` and the `Factory` method of the same name return their argument unchanged. The parameter is typed with the factory's `Env` and path, so the middleware's `c` has the types of the app it is written for. The code does nothing else.

Sources: [src/helper/factory/index.ts:353-355](repo://src/helper/factory/index.ts#L353-L355), [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

`createHandlers` returns the list of handlers it was given, minus any `undefined` entries. Its overloads keep the input and output type of each handler in the list, so the list can be spread into a route call.

Sources: [src/helper/factory/index.ts:357-360](repo://src/helper/factory/index.ts#L357-L360)
