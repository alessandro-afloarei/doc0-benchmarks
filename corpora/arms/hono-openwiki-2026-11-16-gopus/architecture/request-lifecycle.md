---
type: architecture
title: Request lifecycle and composition
description: How HonoBase registers routes and dispatches each Request through router matching, Context creation, compose() middleware chaining, error and not-found handling, HEAD fallback, and sub-app composition with route(), basePath() and mount().
tags: [request-lifecycle, dispatch, compose, middleware, error-handling, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-b6e31ddca68e7ac800c3482e
    resource: repo://src/utils/handler.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Request lifecycle and composition

Everything on this page lives in `src/hono-base.ts` and `src/compose.ts`. Those two files hold the whole runtime core of Hono. Routers, `Context` and middleware all plug into the flow described here.

## Route registration

The `HonoBase` constructor builds one registration method for each verb in `METHODS` (`get, post, put, delete, options, patch`), plus `all`, `on` and `use`.

- `app.get(path, ...handlers)` saves `path` in a private `#path` cursor. It then registers each handler under that path. If the first argument is a handler and not a string, the cursor path from the previous call is reused. That is how chained calls such as `app.get('/a', h1).post(h2)` work.
- `app.use(...)` registers handlers under method `ALL`. With no path, the path is `'*'`.
- `app.on(method | method[], path | path[], ...handlers)` registers the cross product of methods and paths. Method names are upper-cased.
- Every registration ends in `#addRoute`. It upper-cases the method and joins the path onto the instance's `_basePath` with `mergePath`. It then builds a `RouterRoute { basePath, path, method, handler }`, calls `router.add(method, path, [handler, route])`, and appends the route to `app.routes`.

Middleware and handlers are stored the same way: as router entries in registration order. The router returns every matching entry, in that order, for a request. Middleware is simply an entry that calls `next()`.

## Dispatch: `fetch` → `#dispatch`

```text
fetch(request, env?, executionCtx?)
  └─ #dispatch(request, executionCtx, env, request.method)
       ├─ HEAD? → dispatch as GET, return new Response(null, getResponse)
       ├─ path = getPath(request, { env })
       ├─ matchResult = router.match(method, path)
       ├─ c = new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })
       ├─ exactly 1 handler → call it directly (fast path)
       └─ otherwise → compose(matchResult[0], errorHandler, notFoundHandler)(c)
```

Entry points:

- `app.fetch(request, env, executionCtx)` follows the Workers-style module signature. This is the main integration point for runtimes and adapters.
- `app.request(input, init?, env?, ctx?)` is a testing convenience. It accepts a `Request`, a URL, or a path string. A relative string becomes `http://localhost<path>`.
- `app.fire()` registers a global `fetch` event listener for Service Worker–style runtimes. It passes the `FetchEvent` in as the execution context. The method is deprecated in favor of the `hono/service-worker` adapter's `fire`.

### HEAD requests

`HEAD` is never routed directly. `#dispatch` runs the request as `GET`, then returns a new `Response` with a `null` body and the GET response's status and headers.

### Single-handler fast path

If the match holds exactly one handler, `#dispatch` skips `compose()` and calls the handler directly. Its `next` sets `c.res` from the not-found handler. If the handler returns nothing, the result is `c.res` when the context is finalized, and the not-found response otherwise. Sync throws and async rejections both go to `#handleError`.

### Composed path and the "not finalized" guard

When several handlers match, `#dispatch` composes them. If the composed chain ends while `c.finalized` is still false, it throws `Context is not finalized. Did you forget to return a Response object or `await next()`?`. That error goes through the error handler, which by default produces a 500. This guard catches middleware that neither returned a response nor awaited `next()`.

## `compose()` semantics

`compose(middleware, onError?, onNotFound?)` (`src/compose.ts`) is adapted from `koa-compose`:

- `dispatch(i)` records `context.req.routeIndex = i`. This lets `HonoRequest` resolve the params and `routePath` for the handler that is currently running.
- Each handler is called as `handler(context, () => dispatch(i + 1))`.
- A call to `next()` from an index that has already run throws `next() called multiple times`.
- After the last matched handler, `compose` calls the outer `next` if one was passed in (nested composition). Otherwise, if the context is still not finalized, it calls `onNotFound`.
- If a handler throws an `Error` and `onError` exists, compose sets `context.error`, and the `onError` result becomes the response. Non-`Error` throws, or errors with no `onError`, are re-thrown.
- A handler's return value becomes `context.res` only if the context is not yet finalized, or if that value came from error handling. A handler that returns a response after a downstream handler already finalized does not overwrite it. Middleware that wants to replace the response must assign `c.res` explicitly.

`compose` resolves to the `Context`, not to a `Response`. Callers read `context.res`.

## Error and not-found handling

| Hook | Default | Override |
| --- | --- | --- |
| Not found | `c.text('404 Not Found', 404)` | `app.notFound(handler)` |
| Error | If the error has `getResponse()` (for example `HTTPException`), returns `c.newResponse(res.body, res)`. Otherwise `console.error(err)` and `c.text('Internal Server Error', 500)`. | `app.onError(handler)` |

`HTTPException` (`src/http-exception.ts`) carries a `status` and an optional `res` and `message`. `getResponse()` returns a copy of `res` with the exception's status, or else a plain response whose body is `message`. Middleware such as auth, body-limit and timeout signals failure by throwing it.

`#handleError` passes only `Error` instances to the error handler. Anything else is re-thrown to the runtime.

## Sub-application composition

### `basePath(path)`

`basePath(path)` returns a clone that shares the same router, `routes` array, error handler and not-found handler. The clone's `_basePath` is the merged path. Routes registered on the clone land in the parent's router with the prefix added.

### `route(path, subApp)`

`route(path, subApp)` replays every entry of `subApp.routes` into `this.basePath(path)`. If the sub-app has a custom `onError`, each of its handlers is wrapped in `compose([], subApp.errorHandler)`. This keeps the sub-app's error handler scoped to its own routes. Each wrapper is tagged with the `COMPOSED_HANDLER` symbol-like key, so tooling can find the original handler later (`src/utils/handler.ts` `findTargetHandler`, used by `hono/dev` and SSG). The sub-app's not-found handler is not carried over. Not-found handling is decided once, by the parent app.

Route registration is eager. Routes added to a sub-app after `app.route()` has been called do not appear in the parent.

### `mount(path, fetchLikeHandler, options?)`

`mount` embeds any `(Request, ...args) => Response` application, such as another framework's fetch handler. It registers an `ALL` route at `path/*`. By default it rewrites the request URL to drop the mount prefix, and passes `(c.env, c.executionCtx)` as the extra arguments. If `executionCtx` is not available, `undefined` is passed in its place.

- `options.optionHandler(c)` (or a bare function) replaces those extra arguments.
- `options.replaceRequest` supplies a custom request rewrite. `false` passes the request through unchanged.
- If the mounted handler returns a falsy value, the chain continues with `next()`.

## Related tests

- `src/compose.test.ts`: ordering, the `next() called multiple times` guard, error propagation, not-found and not-finalized cases.
- `src/hono.test.ts`: routing, `route`/`basePath`/`mount`, HEAD, `strict`, and error handlers.

See also [Routers](routers.md), [Context and HonoRequest](../concepts/context-and-request.md) and [Built-in middleware](../middleware/built-in-middleware.md).
