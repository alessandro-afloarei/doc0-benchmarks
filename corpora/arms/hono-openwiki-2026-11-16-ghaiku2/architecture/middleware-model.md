---
type: architecture
title: Middleware Model and Composition
description: How Hono registers middleware with app.use and route handlers, chains them through next() using the compose function, propagates errors to onError and falls back to notFound, and how sub-applications keep their own error handlers when mounted with route().
tags: [hono, middleware, compose, next, error-handling, not-found, sub-app]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Middleware Model and Composition

Hono treats middleware and route handlers as one ordered list of handlers. Each entry is stored in the router with the HTTP method it applies to, and the matched list is run as a chain by `compose` in `src/compose.ts`. Understanding this chain explains execution order, how `await next()` wraps downstream work, and where errors and not-found responses are produced.

## Registration

Middleware is registered through `app.use` in `src/hono-base.ts` (around lines 157-168):

- `app.use(handler)` with no path registers the handler under the path `*` for every method.
- `app.use('/path/*', handler1, handler2)` registers each handler under the given path, using the method `ALL`.
- Every registration goes through the private `#addRoute`, which merges the instance's `basePath`, uppercases the method, adds the `[handler, routeRecord]` pair to the router, and pushes the route record to `app.routes`.

Route handlers (`app.get`, `app.post`, and so on) use the same `#addRoute` path. Registration order is therefore execution order: the router returns matches in the order they were added, so middleware added before a route runs first for matching requests.

`createMiddleware` (in `src/helper/factory/index.ts`) is an identity helper: it returns the function unchanged but gives it a typed signature for reuse across modules. It has no runtime behaviour.

## The compose chain

`compose(middleware, onError?, onNotFound?)` returns a function `(context, next?) => Promise<Context>`. Inside, `dispatch(i)` runs handler `i`:

1. It throws `next() called multiple times` if `dispatch` is re-entered for an index that has already run. The guard is the shared `index` variable.
2. It sets `context.req.routeIndex = i` so that `c.req.param()` reads the parameters for the handler currently running.
3. It calls the handler with `(context, () => dispatch(i + 1))`. The second argument is `next`; awaiting it runs the rest of the chain and returns once the downstream handler completes.
4. If `i` is past the end of the list, the chain uses the `next` function passed to `compose` (in `Hono.#dispatch` the not-found handler is used through `onNotFound`).
5. If the handler returns a `Response` and the context is not yet finalized, the response is assigned to `context.res`. Returning a response is therefore equivalent to calling `c.res = ...`.

<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Because `next()` returns a promise, middleware that wraps work in `await next()` can inspect or modify `c.res` after downstream handlers finish. This is how timing, logging, and CORS-style middleware add headers to responses they did not create (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).

## Error propagation

When a handler throws an `Error`:

- If an `onError` handler was supplied to `compose`, `dispatch` stores the error in `context.error`, calls `onError(err, context)`, and assigns the returned response to `context.res` even if the context was already finalized (the `isError` flag allows this).
- Non-`Error` throws, and errors when no `onError` is supplied, are rethrown.

In `Hono`, `compose` receives `this.errorHandler` and `this.#notFoundHandler`. The default error handler returns the response from `HTTPException.getResponse()` when the error has that method, or logs the error and returns `500 Internal Server Error`. Custom handlers are installed with `app.onError(fn)`.

Errors thrown in the single-handler fast path of `#dispatch` (when only one handler matched) are handled by `#handleError`, which calls the same `errorHandler` directly.

## Not-found behaviour

`notFound` is reached in two ways:

- If `i` moves past the last handler and the context has not been finalized, `onNotFound(context)` is called. The default not-found handler returns `404 Not Found` as text. Customize it with `app.notFound(fn)`.
- In the fast path, if the single handler returns `undefined` and the context is not finalized, the not-found handler is used.

If the whole chain completes without a finalized context, `#dispatch` throws `Context is not finalized. Did you forget to return a Response object or await next()?`, which the error handler then converts into a response.

## Sub-applications and error handlers

`app.route(path, subApp)` copies each of the sub-app's routes into the parent. The copy depends on whether the sub-app has a custom error handler:

- If `subApp.errorHandler` is still the default, the route handler is copied unchanged.
- Otherwise the route handler is wrapped so that the sub-app's own error handler runs for errors thrown inside its routes. The wrapper is tagged with `COMPOSED_HANDLER`, which keeps the original handler reachable.

`app.basePath(path)` clones the instance with a merged base path, sharing the router and route list. `app.mount(path, fn)` registers a catch-all `ALL` route that calls an external request handler; if it returns nothing, control passes to `next()`.

## Invariants and consequences

- A handler must either return a `Response`, assign `c.res`, or await `next()` to avoid the "not finalized" error.
- Calling `next()` more than once from a handler throws, and the error is handled like any other handler error.
- Middleware registered after a route does not run for requests that route already answered, because the route handler does not call `next()`.
- Because `routeIndex` is set per handler, parameters read inside middleware reflect the route that matched, not the middleware's own path.

## Representative tests

- `src/compose.test.ts` is the focused test file for the compose chain.
- `src/hono.test.ts` exercises `use`, `route`, and not-found handling through the public API.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)
