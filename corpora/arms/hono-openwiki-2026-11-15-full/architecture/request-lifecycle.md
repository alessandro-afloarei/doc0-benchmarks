---
type: architecture
title: Request Lifecycle and Middleware Composition
description: Step-by-step flow of a request through Hono — route registration, path extraction, router matching, Context creation, the single-handler fast path, koa-style compose(), error and not-found handling, HEAD handling, and the semantics of route(), basePath() and mount().
tags: [request-lifecycle, compose, middleware, routing, error-handling]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Request Lifecycle and Middleware Composition

All request handling lives in `src/hono-base.ts` and `src/compose.ts`. This page traces a request from registration time to the final `Response`. See [Context and HonoRequest](context-and-request.md) for the per-request object and [Routers](../routing/routers.md) for matching algorithms.

## Registration

The `HonoBase` constructor generates `get`, `post`, `put`, `delete`, `options`, `patch` and `all` methods, plus `on` and `use`. All of them end in the private `#addRoute(method, path, handler)`:

1. The method is upper-cased and the path is joined to the instance's `_basePath` with `mergePath`.
2. A `RouterRoute` record `{ basePath, path, method, handler }` is built.
3. `router.add(method, path, [handler, route])` registers it, and the record is appended to `app.routes`.

Notable behaviors:

- `app.get(path, h1, h2)` registers **each handler as a separate route entry** with the same path; chaining handlers is therefore just multiple matches executed in order.
- The path argument is sticky: `app.get('/a', h).post(h2)` registers `POST /a` because the generated methods remember the last path in a private `#path` field.
- `app.use(handler)` without a path registers on `*`; `app.use(path, ...)` registers with method `ALL`.
- `app.on(methods, paths, ...handlers)` accepts arrays of methods and paths (custom methods such as `PURGE` are allowed).

Because routers keep registration order, **handlers run in the order they were registered**, regardless of whether they are middleware or endpoints. A RegExpRouter freezes after the first match (`MESSAGE_MATCHER_IS_ALREADY_BUILT`), so routes must be registered before serving.

## Dispatch

`app.fetch(request, env, executionCtx)` calls `#dispatch(request, executionCtx, env, request.method)`:

1. **HEAD**: a `HEAD` request is dispatched as `GET`, and the result is re-wrapped as `new Response(null, getResponse)` – status and headers kept, body dropped.
2. **Path extraction**: `this.getPath(request, { env })`. The default `getPath` (`src/utils/url.ts`) slices the pathname out of `request.url` without constructing a `URL`. If the path contains `%`, it is decoded with `tryDecodeURI` (which leaves invalid escapes intact) while preserving `%25` so an encoded `%` is not double-decoded. With `strict: false`, `getPathNoStrict` strips a trailing slash.
3. **Match**: `router.match(method, path)` returns all matching `[handler, route]` pairs in registration order, plus param data.
4. **Context**: `new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`.
5. **Fast path**: if exactly one handler matched, it is called directly with a `next` that sets `c.res` to the not-found response. A returned `Promise` is awaited; a falsy result falls back to `c.res` if the context was finalized, else to the not-found handler. Synchronous throws and rejected promises go to the error handler.
6. **Composed path**: otherwise `compose(matchResult[0], errorHandler, notFoundHandler)` runs the chain. If the context is still not finalized afterwards, dispatch throws `Context is not finalized. Did you forget to return a Response object or `await next()`?`, which is then routed to the error handler.

`app.request(input, init?, env?, ctx?)` is a testing convenience: strings/URLs without a scheme are prefixed with `http://localhost`, then `fetch` is called. `app.fire()` (deprecated; use `hono/service-worker`) installs a global `fetch` event listener.

## compose()

`compose` (`src/compose.ts`, derived from `koa-compose`) returns a function that dispatches handler `i` with `next = () => dispatch(i + 1)`:

- Calling `next()` twice from the same handler throws `next() called multiple times`.
- Before each handler runs, `context.req.routeIndex = i`, so `c.req.param()` returns the params of the route that matched *that* handler.
- After the last handler, an optional outer `next` is invoked (used for nested composition, e.g. sub-app error handlers); if none exists and the context is not finalized, the not-found handler runs.
- If a handler throws an `Error` and an `onError` was provided, `context.error` is set and the error handler's response becomes the result. Non-`Error` throws are re-thrown.
- A handler's returned response is assigned to `context.res` only if the context was not finalized yet **or** an error was handled. So a middleware that returns after `await next()` does not overwrite the response produced downstream; to replace it, assign `c.res` explicitly.

Middleware therefore follows the "onion" model: code before `await next()` runs on the way in, code after it runs on the way out and can read or modify `c.res`.

## Error and not-found handling

- Default not-found handler: `c.text('404 Not Found', 404)`. Replace with `app.notFound(handler)`.
- Default error handler: if the error has `getResponse()` (an [`HTTPException`](overview.md#errors)), its response is returned; otherwise the error is `console.error`ed and `500 Internal Server Error` is returned. Replace with `app.onError(handler)`.
- `#handleError` only handles `Error` instances; anything else thrown propagates out of `fetch`.

## Composition of apps

### route(path, subApp)

`app.route('/api', sub)` creates a base-path clone of the parent and re-registers every route from `sub.routes` on the parent's router under the merged path. It is a **copy at call time**: routes added to `sub` afterwards are not visible. If the sub-app set a custom `onError`, each copied handler is wrapped as `compose([], sub.errorHandler)(c, () => handler(c, next))`, so errors raised in that sub-app's handlers are handled by the sub-app's handler, not the parent's. The wrapped handler records the original under the `__COMPOSED_HANDLER` key so `hono/route` and dev helpers can find the real handler (`src/utils/handler.ts`). A sub-app's custom `notFound` is not carried over.

### basePath(path)

Returns a clone sharing the same `router`, `routes` array, `getPath`, error and not-found handlers, with `_basePath` set to the merged path. Routes registered on the clone therefore land in the original app's router.

### mount(path, fetchHandler, options?)

Mounts a non-Hono application (any `(request, ...args) => Response` function) on `path/*` with method `ALL`:

- By default the request is rebuilt with the mount prefix stripped from the pathname, and the handler is called with `(request, c.env, c.executionCtx)` (execution context omitted if unavailable).
- `optionHandler(c)` customizes the extra arguments; `replaceRequest` customizes or (when `false`) disables the request rewrite.
- If the mounted handler returns a falsy value, `next()` is called so later Hono routes can respond.

## Invariants worth remembering

- Every request gets a fresh `Context`; nothing is shared between requests except the app and router.
- Route order equals execution order; registering middleware after a route means it will not run for that route if the route returns without calling `next()`.
- A response must be produced (returned or assigned to `c.res`) or dispatch reports "Context is not finalized".

## Tests

- `src/compose.test.ts` – ordering, `next()` misuse, error propagation, `routeIndex` param handling.
- `src/hono.test.ts` – HEAD handling, `route`/`basePath`/`mount`, sub-app error handlers, strict mode, `getPath` customization, not-finalized error.
- `src/utils/url.test.ts` – `getPath`, `mergePath`, decoding edge cases.
