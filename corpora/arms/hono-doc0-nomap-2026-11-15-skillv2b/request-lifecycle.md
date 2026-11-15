---
title: "Request Dispatch and Middleware Composition"
---
## Overview

Every request goes through one private method, `#dispatch` in `HonoBase`. It finds the path, asks the router for every matching handler, wraps the request in a `Context`, and either calls the single matching handler directly or composes all of them into a middleware chain. Errors and unmatched requests are routed to the app's `onError` and `notFound` handlers. Route registration is covered in [[Hono App and Route Registration]]; what handlers do with the `Context` is covered in [[Context and Responses]].

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

## Dispatch step by step

```mermaid
flowchart TD
  start["fetch(request, env, ctx)"] --> head{"method is HEAD?"}
  head -->|yes| asGet["#dispatch as GET,<br>return Response with null body"]
  head -->|no| path["path = getPath(request)"]
  path --> match["matchResult = router.match(method, path)"]
  match --> ctx["c = new Context(request, ...)"]
  ctx --> one{"exactly one handler?"}
  one -->|yes| call["handler(c, next = notFound)"]
  call --> result{"returned a Response?"}
  result -->|yes| done["Response"]
  result -->|no| fin{"c.finalized?"}
  fin -->|yes| cres["c.res"]
  fin -->|no| nf["notFoundHandler(c)"]
  one -->|no| comp["compose(handlers, onError, notFound)(c)"]
  comp --> check{"c.finalized?"}
  check -->|yes| cres
  check -->|no| err["throw 'Context is not finalized'"]
```

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

1. **HEAD requests** are dispatched as `GET`, and the resulting response is copied into a new `Response` with a `null` body. Apps never register `HEAD` routes.
2. **Path extraction** uses the app's `getPath`, which receives `env` so a custom one can read bindings.
3. **Matching** calls `router.match(method, path)` once. The result lists every handler (middleware included) whose method and path match, in registration order, with their parameters ([[Routers and Presets]]).
4. **Context creation** passes the path, the match result, `env`, the execution context and the app's not-found handler to `new Context`. The `HonoRequest` behind `c.req` is created only when a handler reads it.
5. **Execution** takes the single-handler fast path or goes through `compose`.

Sources: [src/hono-base.ts:412-427](repo://src/hono-base.ts#L412-L427)

## The single-handler fast path

When the match result holds exactly one handler, `#dispatch` calls it without building a chain. Its `next` sets `c.res` to the not-found response, so a lone middleware that calls `next()` still produces a 404. Any synchronous throw goes to `#handleError`. A synchronous result is returned as is, or the not-found response when it is `undefined`. A promise is chained: its value, else `c.res` if the context was finalized, else the not-found response; a rejection goes to `#handleError`.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

Avoiding `compose` here avoids allocating a closure and an `async` function per request for the common case of an app without global middleware, and lets a synchronous handler return a `Response` without a promise.

Sources: [src/hono-base.ts:429-433](repo://src/hono-base.ts#L429-L433)

## compose and next()

`compose(middleware, onError, onNotFound)` in `src/compose.ts` returns a function that runs the handlers in order. It is adapted from `koa-compose`: each handler receives `next`, which runs the following one, so code before `await next()` runs on the way in and code after it on the way out.

Sources: [src/compose.ts:4-23](repo://src/compose.ts#L4-L23)

```ts
async function dispatch(i: number): Promise<Context> {
  if (i <= index) {
    throw new Error('next() called multiple times')
  }
  index = i

  let res
  let isError = false
  let handler

  if (middleware[i]) {
    handler = middleware[i][0][0]
    context.req.routeIndex = i
  } else {
    handler = (i === middleware.length && next) || undefined
  }
```

Sources: [src/compose.ts:32-47](repo://src/compose.ts#L32-L47)

The rules `dispatch` keeps follow from that code.

Sources: [src/compose.ts:20-31](repo://src/compose.ts#L20-L31)

- **One call to `next` per handler.** `index` records the highest position reached; calling `next()` a second time from the same handler throws `next() called multiple times`.
- **`routeIndex` follows the chain.** Before each handler runs, `context.req.routeIndex` is set to its position, so `c.req.param()` reads the parameters of the route that registered *this* handler, not the last one ([[HonoRequest: Params, Query, Headers and Body]]).
- **The end of the chain** calls the outer `next` given to the composed function, if any. Otherwise, when no handler has finalized the context, it calls `onNotFound`.
- **A returned value becomes `c.res`** only while the context is not finalized. After a handler returns a `Response`, middleware further out that returns another value does not replace it; middleware changes the response by assigning `c.res` or calling `c.header()`.
- **Errors** thrown by a handler (or by anything it awaited, including the rest of the chain) are caught at that level. When the value is an `Error` and `onError` was given, `c.error` is set, `onError` produces the response, and that response replaces `c.res` even if the context was finalized. Non-`Error` throws are rethrown.

Sources: [src/compose.ts:32-73](repo://src/compose.ts#L32-L73)

Because the error handler runs at the level of the throwing handler, middleware wrapped around it sees a normal return from `await next()` with `c.error` set and `c.res` holding the error response. Middleware that needs to react to failures checks `c.error` after `next()`.

Sources: [src/compose.ts:49-60](repo://src/compose.ts#L49-L60)

## The finalized check

After the composed chain resolves, `#dispatch` requires `context.finalized`. A chain where every handler called `next()` and none returned a response, or where a middleware forgot to `await next()` so its handler's result arrived too late, ends with the error `Context is not finalized. Did you forget to return a Response object or await next()?`, which is then passed to the error handler.

Sources: [src/hono-base.ts:450-466](repo://src/hono-base.ts#L450-L466)

`finalized` becomes `true` whenever `c.res` is assigned, which `compose` does for any returned response and handlers do by assigning `c.res` directly.

Sources: [src/context.ts:414-445](repo://src/context.ts#L414-L445)

## Errors and HTTPException

`#handleError` sends any `Error` to the app's error handler and rethrows anything else. Errors reach it from three places: a synchronous throw on the fast path, a rejected promise on the fast path, and anything that escapes `compose` (including the not-finalized error).

Sources: [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

`HTTPException` is the error type meant for expected failures such as failed authentication. It carries a `status` (default 500), an optional `message`, an optional `cause` and an optional prepared `res`. `getResponse()` returns a new `Response` with the exception's status and either the prepared response's body and headers or the message as text.

Sources: [src/http-exception.ts:46-78](repo://src/http-exception.ts#L46-L78)

The default error handler checks for `getResponse` rather than `instanceof HTTPException`, so an exception class from a second copy of Hono in the bundle is still answered with its own response. Every other error is logged with `console.error` and answered `500 Internal Server Error`. The built-in middleware ([[Basic and Bearer Auth]], [[JWT and JWK Authentication]], [[Body Limit, Timeout, Method Override and Trailing Slash]]) report failures by throwing `HTTPException` so an app's `onError` can reformat them.

Sources: [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

## Not found

The not-found handler runs in three situations: the router matched nothing (an empty chain reaches its end), every matched handler called `next()` without producing a response, or a handler called `c.notFound()` itself. The default answers the text `404 Not Found`. Sub-apps grouped with `route()` share routes with the parent, but the not-found handler is the one of the app whose `fetch` was called.

Sources: [src/hono-base.ts:31-33](repo://src/hono-base.ts#L31-L33), [src/compose.ts:61-65](repo://src/compose.ts#L61-L65), [src/context.ts:776-779](repo://src/context.ts#L776-L779)

## Composed handlers and isMiddleware

`src/utils/handler.ts` holds two helpers used by tooling. `isMiddleware(handler)` treats a function declared with two or more parameters as middleware, which `showRoutes` uses to label routes. `findTargetHandler` unwraps the `COMPOSED_HANDLER` chain that `route()` adds when wrapping a sub-app's handlers with its error handler ([[Testing, Route and Dev Helpers]]).

Sources: [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

The same `compose` function is reused outside dispatch: `route()` uses it with an empty list to attach a sub-app's error handler, and the combine middleware uses it to run a group of middleware as one ([[Combining Middleware and Context Storage]]).

Sources: [src/hono-base.ts:219-227](repo://src/hono-base.ts#L219-L227)
