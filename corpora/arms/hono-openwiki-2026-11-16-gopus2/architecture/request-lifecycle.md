---
type: architecture
title: Request Lifecycle and Composition
description: End-to-end request flow in HonoBase — entrypoints (fetch, request, fire), path extraction, router matching, the single-handler fast path versus koa-style compose, error and not-found handling, HEAD handling — and how use/on/route/basePath/mount register routes.
tags: [lifecycle, dispatch, middleware, compose, routing, errors]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Request Lifecycle and Composition

This page follows a request through `src/hono-base.ts` and `src/compose.ts`. The objects the handlers receive are described in [Context and HonoRequest](./context-and-request.md). Route matching is described in [Routers](../routing/routers.md).

## Entrypoints

| Method | Use | Behaviour |
| --- | --- | --- |
| `app.fetch(request, env?, executionCtx?)` | Workers, Bun, Deno, adapters | Calls `#dispatch(request, executionCtx, env, request.method)` |
| `app.request(input, init?, env?, executionCtx?)` | Tests and local calls | Accepts a `Request`, URL or path. A relative path is resolved against `http://localhost`. Then calls `fetch` |
| `app.fire()` | Service Worker style | Calls `addEventListener('fetch', …)` and `respondWith(#dispatch(...))`, passing the event as the execution context |

All of them return `Response | Promise<Response>`. A synchronous handler can therefore produce a response without any promise allocation.

## Dispatch

`#dispatch` does the following:

1. **HEAD**: the request is re-dispatched as `GET`, and the result is wrapped in `new Response(null, getResponse)`. Headers and status are kept, the body is dropped. There is no separate HEAD routing.
2. **Path**: `this.getPath(request, { env })`. The default `getPath` (`src/utils/url.ts`) scans the URL string for the path without building a `URL` object. Only paths that contain `%` are passed to `tryDecodeURI`, and `%25` is protected so that it is not decoded twice. `strict: false` uses `getPathNoStrict`, which drops a trailing `/`. A custom `getPath` option can route on, for example, the host header.
3. **Match**: `this.router.match(method, path)` returns every handler and middleware whose route matches, in registration order (see the `Result` format on [Routers](../routing/routers.md)).
4. **Context**: `new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`.
5. **Run handlers** through one of two paths:
   - **Fast path, exactly one match.** The handler is called directly. Its `next` sets `c.res` to the not-found response. A synchronous throw goes to `#handleError`. A returned promise is resolved: a falsy result falls back to `c.res` if the context is finalized, otherwise to the not-found handler. A rejected promise also goes to `#handleError`. An undefined synchronous result goes to the not-found handler.
   - **Composed path.** `compose(matchResult[0], errorHandler, notFoundHandler)` runs the chain. Afterwards, if `context.finalized` is still false, dispatch throws `Context is not finalized. Did you forget to return a Response object or \`await next()\`?`. The thrown error then goes to the error handler.
6. **No match.** The router returns an empty list. This takes the composed path, where `compose` calls the not-found handler at the end of the empty chain.

## `compose` — the onion model

`compose` (`src/compose.ts`) is based on `koa-compose`:

- `dispatch(i)` runs `middleware[i][0][0]` with `next = () => dispatch(i + 1)` and sets `context.req.routeIndex = i`. This index is how `c.req.param()` finds the param map for the route of the handler that is currently running.
- Calling `next()` twice in the same middleware throws `next() called multiple times`.
- After the last handler, an outer `next` is called if one was supplied. This is how a composed sub-chain continues into the parent. Otherwise, if the context is not finalized, the not-found handler runs.
- If a handler throws an `Error` and an `onError` handler is set, `compose` sets `context.error`, calls `onError`, and marks the result as an error. Non-`Error` throws are re-thrown.
- A returned response is assigned to `context.res` only while the context is **not finalized**, or when it comes from the error handler. This lets middleware that ran after `await next()` replace the response by returning a new one, and it guarantees that an error response always wins.

Because `next()` returns after the downstream handlers finish, middleware can run code both before and after the handler (logging, timing, compression, ETag and so on). Downstream errors have already been turned into a response by `onError` by the time `await next()` returns. Middleware that wants to inspect them reads `c.error`.

## Error and not-found handling

- **Default not-found handler**: `c.text('404 Not Found', 404)`. You can replace it with `app.notFound(handler)`.
- **Default error handler**: if the error has `getResponse()` (an `HTTPException`), it returns that response via `c.newResponse(res.body, res)`. Otherwise it logs with `console.error` and returns `500 Internal Server Error`. You can replace it with `app.onError(handler)`.
- `#handleError` only handles `Error` instances. Any other thrown value propagates out of `fetch`.
- **`HTTPException`** (`src/http-exception.ts`) has a `status` (default 500), an optional `message`, a `cause`, and an optional `res`. `getResponse()` returns a copy of `res` with the exception's status, or a plain-text response containing the message. Middleware such as `basic-auth`, `jwt`, `body-limit`, `timeout` and `validator` signal failures by throwing it.

## Route registration

All registration methods go through the private `#addRoute(method, path, handler, baseRoutePath?)`. It upper-cases the method, merges the path with the app's `_basePath`, calls `router.add(method, path, [handler, routerRoute])`, and appends a `RouterRoute` to `app.routes`.

- **`app.get/post/put/delete/options/patch/all(path?, ...handlers)`**: if the first argument is a string, it becomes the current path (`#path`). Otherwise the handlers are registered on the path last used. This allows chaining such as `app.get('/a', h1).post(h2)`. `all` registers with method `ALL`.
- **`app.on(method | methods[], path | paths[], ...handlers)`**: registers custom or multiple methods and paths.
- **`app.use(path?, ...middleware)`**: registers with method `ALL`. Without a path it uses `*`.
- **`app.basePath(path)`** returns a **clone** that shares the same router, `routes` array and handlers but has a merged `_basePath`. Routes added through the clone therefore land in the original app.
- **`app.route(path, subApp)`** copies every route of `subApp` into `this.basePath(path)`. If the sub-app has a custom `onError`, each of its handlers is wrapped in `compose([], subApp.errorHandler)`. Errors thrown in sub-app routes are then handled by the sub-app's handler, and the wrapper keeps the original handler under the `COMPOSED_HANDLER` symbol for introspection. The sub-app's not-found handler is **not** carried over. Routes are copied at call time, so routes added to `subApp` after `route()` are not seen.
- **`app.mount(path, fetchLike, options?)`** registers an `ALL` middleware on `path/*` that hands requests to another framework's handler. By default the request URL is rewritten to strip the mount prefix, and `(c.env, c.executionCtx)` are passed as extra arguments, if they exist. `optionHandler` overrides those arguments. `replaceRequest` customises the rewrite, or disables it when set to `false`. If the mounted handler returns no response, `next()` continues the chain.

Registration order matters. Routers return matches in insertion order, so middleware registered before a handler wraps it, and the first handler to return a response wins.

## Tests

- `src/hono.test.ts` covers routing, chaining, `route` and `basePath`, `mount`, error propagation between parent and sub-apps, HEAD, and strict mode.
- `src/compose.test.ts` covers the onion ordering, the "next() called multiple times" error, and `onError`/`onNotFound` behaviour.
- `src/http-exception.test.ts` covers `getResponse` semantics.
