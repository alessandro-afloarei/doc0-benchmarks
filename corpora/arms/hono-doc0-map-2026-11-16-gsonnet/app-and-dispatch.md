---
title: "Application and Request Dispatch"
---
## Overview

`HonoBase` in `src/hono-base.ts` is the application object. It records routes in a router, and turns one `Request` into one `Response` by matching, building a `Context`, and running the matching handlers. It does not choose a router itself: the subclass in `src/hono.ts` assigns one, as the comment above the `router` field explains.

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124), [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

This page follows route registration and one request through `fetch`. The `Context` object is in [[Context and Responses]], the router algorithms in [[Router Interface and Selection]] and [[RegExpRouter and TrieRouter]].

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

## Registering routes

The constructor assigns the method helpers as closures. For each of `get`, `post`, `put`, `delete`, `options`, `patch` and `all`, a string first argument only updates the private `#path`; handlers (the first argument when it is not a string, plus the rest) are each added with `#addRoute`. `on` loops over arrays of paths and methods, upper-casing each method. `use` registers every handler under the method `ALL`, defaulting the path to `*`.

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168)

`#addRoute` is the single place routes enter the app. It upper-cases the method, merges the app's `_basePath` with the path using `mergePath`, builds a `RouterRoute` of `basePath`, `path`, `method` and `handler`, passes `[handler, route]` to `router.add`, and appends the route to the public `routes` array.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

`mergePath` joins two segments with exactly one slash, so `mergePath('/api', '/user')` gives `/api/user` and a sub path of `/` adds nothing.

Sources: [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

The constructor ends by copying all options but `strict` onto the instance (so `router` and `getPath` are set) and choosing the path extractor: with `strict` true (the default) it uses the supplied `getPath` or the built-in one, otherwise `getPathNoStrict`, which drops a trailing slash so `/hello/hey/` and `/hello/hey` match the same route.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172), [src/utils/url.ts:106-146](repo://src/utils/url.ts#L106-L146)

## Grouping: basePath and route

`basePath(path)` clones the app with `#clone` and sets `_basePath` on the clone to the merged path. The clone shares the router, the `routes` array and the error and not-found handlers, so routes added through it land in the same router with the prefix applied.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

`route(path, app)` copies another app's routes into this one under a prefix. It makes `subApp = this.basePath(path)` and re-adds each of `app.routes` through `subApp.#addRoute`, passing the original `r.basePath` so the route keeps its own base. When the sub app has a custom error handler, each route handler is wrapped so that errors it throws are handled by the sub app's handler: the wrapper runs `compose([], app.errorHandler)` around `r.handler`, and records the original under the `COMPOSED_HANDLER` key. Apps still using the default `errorHandler` are not wrapped.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4)

`onError` and `notFound` just store the handler on the instance. Defaults answer `404 Not Found` with `c.text`, and for errors use `getResponse()` when the error has one (as `HTTPException` does) or else log and answer `500 Internal Server Error`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

`HTTPException` carries a status and either a supplied `Response` or a message. Its `getResponse()` builds a new `Response` from the stored one's body and headers with the exception's status, or from the message.

Sources: [src/http-exception.ts:46-77](repo://src/http-exception.ts#L46-L77)

## Mounting other applications

`mount(path, applicationHandler, options)` forwards requests under a prefix to any function that takes a `Request` and returns a `Response`. Options can be a function (`optionHandler`) or an object with `optionHandler` and `replaceRequest`. Without an option handler, the extra arguments are `[c.env, executionContext]`, where reading `c.executionCtx` is wrapped in try/catch because it may throw. Without `replaceRequest`, the default rewrites the URL: it strips the merged mount prefix from `getPath(request)`, falling back to `/`, and builds a new `Request`. Passing `replaceRequest: false` hands the original request through.

Sources: [src/hono-base.ts:328-370](repo://src/hono-base.ts#L328-L370)

The mount registers a middleware on `mergePath(path, '*')` for method `ALL`. It awaits the foreign handler, returns its response when there is one, and otherwise calls `next()`.

Sources: [src/hono-base.ts:372-382](repo://src/hono-base.ts#L372-L382)

## Dispatching a request

### Entry points and matching

`fetch` and `request` both end in `#dispatch(request, executionCtx, env, method)`. `fetch(request, Env, executionCtx)` passes `rest[1]` as the context and `rest[0]` as env. `fire()` (deprecated in favour of `hono/service-worker`) registers a `fetch` event listener that dispatches with the event as execution context.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/hono-base.ts:536-542](repo://src/hono-base.ts#L536-L542)

```mermaid
flowchart TD
  start["#dispatch"] --> head{"method is HEAD?"}
  head -->|yes| rerun["dispatch as GET, return body-less Response"]
  head -->|no| path["getPath, router.match"]
  path --> ctx["new Context"]
  ctx --> one{"one matched handler?"}
  one -->|yes| call["call handler with notFound as next"]
  one -->|no| comp["compose(handlers, errorHandler, notFoundHandler)"]
  comp --> fin{"context.finalized?"}
  fin -->|no| throwErr["throw: Context is not finalized"]
  fin -->|yes| ret["return context.res"]
  call --> ret
  throwErr --> handle["#handleError"]
```

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

A `HEAD` request is re-dispatched as `GET` and the result becomes `new Response(null, response)`, so the status and headers are kept but the body is dropped.

Sources: [src/hono-base.ts:412-416](repo://src/hono-base.ts#L412-L416)

Otherwise `#dispatch` computes the path with `getPath(request, { env })`, calls `router.match(method, path)`, and builds a `Context` with the path, match result, env, execution context and the not-found handler.

Sources: [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

### Single-handler fast path

When `matchResult[0]` has exactly one entry the app skips `compose` and calls the handler directly, with a `next` that sets `c.res` to the not-found response. A synchronous throw goes to `#handleError`. A promise result is resolved: a returned `Response` wins, otherwise `c.res` is used if the context is finalized and the not-found handler runs if not; rejections go to `#handleError`. A non-promise result falls back to the not-found handler when it is nullish.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

### Composed chain

With more handlers, `compose(matchResult[0], errorHandler, notFoundHandler)` builds one function. It tracks the last index called; calling `next()` twice from one handler throws `next() called multiple times`. For each index it sets `context.req.routeIndex` (which lets request code pick that route's params, see [[Request and Body Parsing]]), then calls the handler with a `next` that dispatches the following index.

Sources: [src/compose.ts:20-51](repo://src/compose.ts#L20-L51)

If a handler throws an `Error` and an error handler exists, `compose` stores it on `context.error`, calls the handler and marks `isError`. Past the last handler it calls the optional outer `next`, and when nothing is left and the context is not finalized it calls the not-found handler. A returned response is assigned to `context.res` when the context is not finalized yet or when it came from the error handler.

Sources: [src/compose.ts:49-72](repo://src/compose.ts#L49-L72)

After the chain returns, `#dispatch` throws `Context is not finalized. Did you forget to return a Response object or `await next()`?` when no response was set; any thrown error is sent to `#handleError`.

Sources: [src/hono-base.ts:452-465](repo://src/hono-base.ts#L452-L465)

### Failure handling

`#handleError` calls the app's error handler only when the thrown value is an `Error`; anything else is rethrown to the caller.

Sources: [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

## Options

`HonoOptions` has three fields: `strict` (default true), `router` (any `Router<[H, RouterRoute]>`) and `getPath`, which can be used to route on the Host header, as the option's doc comment shows.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)
