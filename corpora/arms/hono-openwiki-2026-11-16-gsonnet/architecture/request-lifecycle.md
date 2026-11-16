---
type: workflow
title: Request Lifecycle and Middleware Composition
description: Step-by-step trace of how Hono's fetch() turns a Request into a Response — path extraction, router match, Context creation, the single-handler fast path, compose() onion execution, error and 404 handling, HEAD, and sub-app grouping via route/basePath/mount.
tags: [request-lifecycle, compose, middleware, error-handling, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Request Lifecycle and Middleware Composition

Entry point: `app.fetch(request, env?, executionCtx?)` in `src/hono-base.ts`, which delegates to the private `#dispatch(request, executionCtx, env, method)`. Platform adapters (see [Runtime Adapters](../runtimes/adapters.md)) and `app.request()` (test helper that builds a `Request` for `http://localhost<path>` unless given an absolute URL) all end up here. `app.fire()` (deprecated; use `hono/service-worker`) attaches a `fetch` event listener that calls `#dispatch` directly.

## Dispatch steps

1. **HEAD**: if `method === 'HEAD'`, dispatch again as `GET` and wrap the resulting status/headers in `new Response(null, res)`, so `app.get()` implicitly serves HEAD.
2. **Path**: `this.getPath(request, { env })`. The default `getPath` (`src/utils/url.ts`) slices the path out of `request.url` without constructing a `URL`, only decoding percent-encoding if a `%` is present (with `%25` re-escaped to avoid double decoding). `getPathNoStrict` additionally strips a trailing slash. Choosing between them is the `strict` option.
3. **Match**: `this.router.match(method, path)` returns `[ [ [ [handler, routeRecord], paramIndexMap|params ], … ], paramStash? ]` — all handlers (middleware and final) registered for that method/path, in registration order. See [Router Implementations](../routing/routers.md).
4. **Context**: `new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`. `c.req` (a `HonoRequest`) is created lazily from the same match result. See [Context and HonoRequest](../core/context-and-request.md).
5. **Execute** — one of two paths:
   - *Fast path* — exactly one matched handler: it is called directly with a `next` that sets `c.res` to the not-found response. A synchronous throw goes to `#handleError`; a returned promise is chained so that a falsy result becomes `c.res` if `c.finalized`, else the not-found response; rejections go to `#handleError`. A synchronous non-promise result of `undefined` yields not-found.
   - *Composed path* — `compose(matchResult[0], errorHandler, notFoundHandler)(c)`. After it resolves, if `context.finalized` is still false, dispatch throws `"Context is not finalized. Did you forget to return a Response object or \`await next()\`?"`, which is itself routed to the error handler. Otherwise `context.res` is returned.

## compose(): the onion model

`src/compose.ts` (based on `koa-compose`) returns `(context, next?) => Promise<Context>` and tracks `index` per request:

- `dispatch(i)` throws `next() called multiple times` if `i <= index`, preventing a middleware from calling `next` twice.
- For `middleware[i]` it sets `context.req.routeIndex = i` (used by `c.req.routePath` / `matchedRoutes`, and by the router's param lookup to pick the right param map for the handler currently running) and invokes the handler with `next = () => dispatch(i + 1)`.
- When `i === middleware.length`, the optional outer `next` is used instead (this is how a nested `compose` chains into its caller, e.g. in `hono/combine`'s `every`).
- A thrown `Error` with an `onError` supplied sets `context.error`, calls `onError(err, context)`, and marks the result as an error response; non-`Error` throws, or no `onError`, propagate.
- If no handler remains and `context.finalized === false`, `onNotFound(context)` supplies the 404 response.
- A returned `res` is assigned to `context.res` only if the context is not yet finalized **or** it came from the error handler. So a later middleware's returned Response wins only when no earlier handler already finalized one — and post-`await next()` code can inspect or replace `c.res` (setting `c.res` again merges headers; see Context page).

Handlers therefore either `return` a Response, or `await next()` and optionally modify `c.res` afterwards.

## Errors and not-found

Defaults live at the top of `hono-base.ts`:

- `notFoundHandler`: `c.text('404 Not Found', 404)`; override with `app.notFound(handler)`.
- `errorHandler`: if the error has `getResponse` (i.e. `HTTPException`, `src/http-exception.ts`) it returns that response (`c.newResponse(res.body, res)`); otherwise it `console.error`s and returns `500 Internal Server Error`. Override with `app.onError(handler)`.

`HTTPException(status = 500, { res?, message?, cause? })` is the sanctioned way for middleware to abort with a specific status; if `res` is provided, that response is used verbatim, which is how `jwt`/`bearer-auth` attach `WWW-Authenticate` headers. `#handleError` only handles `Error` instances; anything else is rethrown out of `fetch`.

## Grouping sub-apps

- `app.route(path, subApp)` — copies each of `subApp.routes` into the parent under `basePath(path)` via `#addRoute`, preserving the sub-app's original `basePath` on the route record. If the sub-app has a custom `onError`, each handler is wrapped so errors thrown inside it are handled by the sub-app's own error handler (`compose([], app.errorHandler)`), and the original handler is stashed under `COMPOSED_HANDLER` for introspection. Routes registered on the sub-app *after* `route()` are not seen. Not-found handlers are not inherited per sub-app.
- `app.basePath(path)` — returns a `#clone()` (same router, `routes` array, error and not-found handlers) with `_basePath` merged; registrations through the clone go to the shared router with the prefixed path.
- `app.mount(path, handler, options?)` — registers an `ALL` route at `<path>/*` that calls a foreign `(Request, ...args) => Response` handler (itty-router, another framework). By default the request URL is rewritten to strip the mount prefix; `replaceRequest: false` passes it unchanged, a function customises it. Extra args are `[c.env, executionCtx]` (execution context access is try/caught) unless an `optionHandler` returns them. If the foreign handler returns a falsy value, the chain continues with `next()`.

## Registration-time facts that affect execution

- Order matters: middleware only wraps handlers registered *after* it, because routers return handlers in insertion order.
- `app.use(handler)` without a path registers under `'*'`; `app.use(path, ...)` and `app.on(method(s), path(s), ...)` accept multiple paths/methods.
- `app.get(...)` with only handlers reuses the previous `#path`, which is how chained calls like `app.get('/a', h1).post(h2)` share a path.
- After the first `match()`, routers are built/frozen: later `add` throws `Can not add a route since the matcher is already built.`

Related: [Built-in Middleware](../middleware/middleware.md) for how middleware use `next`, `c.error` and `HTTPException`.
