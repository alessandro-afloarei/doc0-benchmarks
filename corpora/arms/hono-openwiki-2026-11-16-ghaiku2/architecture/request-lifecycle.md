---
type: architecture
title: Request Lifecycle and Dispatch
description: Step-by-step trace of how Hono.fetch turns a Request into a Response, covering path extraction, HEAD handling, router matching, the single-handler fast path versus compose, error and not-found handling, and the finalized-response check.
tags: [hono, dispatch, fetch, lifecycle, routing, error-handling, head-method]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Request Lifecycle and Dispatch

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every entry point of a Hono app (`app.fetch`, `app.request`, the runtime adapters, and `fire()` for service workers) funnels into one private method, `#dispatch`, in `src/hono-base.ts`. This page traces that method and the helpers it calls. The middleware chain itself is covered in [Middleware Model and Composition](/openwiki/architecture/middleware-model.md), and the router internals in [Routing and Router Implementations](/openwiki/architecture/routing.md).

## Entry points

- `app.fetch(request, env?, executionCtx?)` is the main entry. Its signature is `(request, Env, executionCtx)`, and it calls `#dispatch(request, rest[1], rest[0], request.method)`, so the second argument is the bindings or env object and the third is the execution context.
- `app.request(input, init?, env?, executionCtx?)` builds a `Request` for testing. A bare path such as `/hello` becomes `http://localhost/hello`; a full URL is used as-is.
- `app.fire()` registers a `fetch` event listener for service-worker-style runtimes.
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Adapters call `app.fetch` with their platform objects (see [Runtime Adapters](/openwiki/adapters/runtime-adapters.md)).

## Step 1: resolve the path

`this.getPath(request, { env })` produces the routing path. The default `getPath` in `src/utils/url.ts` slices the pathname out of the URL string without building a `URL` object, and percent-decodes it with `tryDecodeURI` only when the path contains `%`. Query strings and fragments are excluded. A `%25` sequence is double-escaped before decoding so that an encoded percent sign is not mistaken for an escape.

Two constructor options change this step:

- `strict: false` replaces `getPath` with `getPathNoStrict`, which also removes one trailing slash, so `/hello/` and `/hello` match the same route.
- `getPath` lets an application compute the routing path itself, for example from the `Host` header.

## Step 2: HEAD requests

If the method is `HEAD`, `#dispatch` re-enters itself with `GET` and returns `new Response(null, <GET result>)`. HEAD therefore runs the GET handlers and discards the body, and no separate HEAD routes are needed.

## Step 3: match and build the context

<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`this.router.match(method, path)` returns a `Result` containing the ordered handler list and parameter data. A `Context` is then created with the request, the path, the match result, `env`, the execution context, and the current not-found handler (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).

The method passed to `match` is the request method, and routes registered with `app.use` or `ALL` match any method, so middleware is included in the handler list in registration order.

## Step 4a: single-handler fast path

If the match returned exactly one handler, `compose` is skipped:

- The handler is called directly with `(c, next)`, where `next` assigns `c.res` from the not-found handler.
- A synchronous result is returned as is, or replaced by the not-found response when it is `undefined`.
- For a promise, a resolved `undefined` value is replaced with the context's response if the context is finalized, or with the not-found response otherwise.
- Any thrown error goes to `#handleError`.

This path avoids allocating the compose closure for the common case of one route with no middleware.

## Step 4b: composed chain

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
With zero or several handlers, `compose(matchResult[0], this.errorHandler, this.#notFoundHandler)` builds the chain and `#dispatch` awaits it. The chain semantics, including `next()` and the multiple-call guard, are in [Middleware Model and Composition](/openwiki/architecture/middleware-model.md).

After the chain resolves, `#dispatch` checks `context.finalized`. If it is false, the method throws `Context is not finalized. Did you forget to return a Response object or await next()?`, and the throw is routed through `#handleError`. Otherwise it returns `context.res`.

## Error and not-found handling

- `#handleError(err, c)` calls the configured error handler for `Error` instances and rethrows anything else. The default error handler returns `err.getResponse()` for HTTP exceptions and otherwise logs the error and returns a `500` text response.
- The not-found handler defaults to a `404` text response and is replaced by `app.notFound(fn)`. It is invoked from the fast path and from the composed chain when no response has been produced.

## Sub-apps and mounting

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `app.route(path, subApp)` copies each route of the sub-app into the parent, merging base paths. If the sub-app has its own error handler, the copied handler is wrapped so that the sub-app's handler runs for its errors (see [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)).
- `app.basePath(path)` returns a clone that shares the same router and route list but prefixes new registrations with the merged base path.
- `app.mount(path, handler)` registers an `ALL` catch-all route at `path/*`. Its handler calls the mounted function with a request whose pathname has the mount prefix removed (unless `replaceRequest: false` is given). If the mounted function returns nothing, the chain continues via `next()`.

## Invariants

<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- With the default `SmartRouter`, the matcher is frozen after the first request: it selects a concrete router on the first `match` call, and adding a route afterwards throws `Can not add a route since the matcher is already built` (see [Routing and Router Implementations](/openwiki/architecture/routing.md)).
- The response a handler returns must be the one that finalizes the context, or the dispatcher reports a non-finalized context.
- Errors thrown from the not-found handler are not caught by the composed chain's error handler; they reach `#dispatch`'s own error path.

## Failure behaviour to know

- A thrown non-`Error` value is rethrown from `fetch`, so the runtime sees a rejected promise rather than a Hono response.
- A missing handler chain for an unmatched route still produces a response via the not-found handler, so unmatched paths never return `undefined` to the runtime.

## Representative tests

- `src/hono.test.ts` covers the public `fetch` and `request` behaviour.
- `src/compose.test.ts` covers the composed chain.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Routing and Router Implementations](/openwiki/architecture/routing.md)
<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)
