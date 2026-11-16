---
type: workflow
title: Request Lifecycle
description: Step-by-step trace of how a Web Standards Request becomes a Response in Hono - entrypoints (fetch, request, fire), HEAD handling, path extraction and strict mode, router matching, the single-handler fast path versus compose, not-found and error handling, and the finalization check.
tags: [request-lifecycle, dispatch, fetch, compose, routing, error-handling, hono-base]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Request Lifecycle

<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every request, whatever runtime it arrives on, passes through a single private method of `HonoBase`: `#dispatch`. This page traces the path from the public entrypoints down to the returned `Response`. The router internals are covered in [Router Selection and Matching](/openwiki/routing/router-selection.md), and the middleware contract in [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md).

## 1. Entrypoints

`HonoBase` exposes three public ways to start a dispatch. All three end in `#dispatch`.

- **`fetch(request, env?, executionCtx?)`** is the Web Standards entrypoint that adapters and `export default app` use. It forwards the request method, the bindings (`env`), and the execution context to `#dispatch`.
- **`request(input, requestInit?, env?, executionCtx?)`** is a test-friendly helper. A string or `URL` input is turned into a `Request` against `http://localhost` (or the absolute URL if one is given), then sent through `fetch`.
- **`fire()`** registers a global `fetch` event listener and calls `event.respondWith(#dispatch(...))`. It is the service-worker form and passes the event itself as the execution context.

<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Adapters ([Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md)) call `fetch`, so platform-specific behavior is limited to how bindings and the execution context are supplied.

## 2. HEAD Requests

If the incoming method is `HEAD`, `#dispatch` re-dispatches the request as `GET` and returns a `Response` with a `null` body and the resulting status and headers. Routes therefore do not need separate `HEAD` registrations, and handlers never run a body-less variant of their logic.

## 3. Path Resolution

`#dispatch` calls `this.getPath(request, { env })`. The strategy is chosen once in the constructor:

- If `strict` is `true` (the default), it uses `options.getPath` when supplied, otherwise the built-in `getPath`.
- If `strict` is `false`, it uses `getPathNoStrict`, which runs `getPath` and then removes one trailing slash from paths longer than one character.

The built-in `getPath` slices the path out of `request.url` without constructing a `URL` object. It stops at `?` or `#`, and only when the path contains `%` does it decode the path. When decoding is needed, the implementation first doubles any literal `%25` so that encoded percent signs are not confused with escape sequences. A custom `getPath` can read other request properties, such as the `host` header, which is how host-based routing is implemented.

## 4. Matching

The resolved path and method are passed to `this.router.match(method, path)`. The result is a list of `[handler, params]` pairs in registration order, plus an optional parameter stash, as defined by the `Result` type in `src/router.ts`. Middleware and handlers that match a path appear in the same list; middleware registered with `use` uses the `ALL` method and wildcard paths.

A `Context` is then constructed with the path, the match result, bindings, the execution context, and the current not-found handler. Each request gets its own `Context`; nothing request-specific is stored on the `Hono` instance.

## 5. Single Handler versus Composed Chain

Two execution paths exist, chosen by the number of matched entries:

- **Exactly one match.** The handler is invoked directly with a `next` function that only sets `c.res` to the not-found response. If the handler returns a value, that value is the response; if it returns a promise, the result is passed through the not-found fallback and the error handler on rejection. This avoids allocating the composition machinery for the common case of one terminal handler.
- **Zero or more than one match.** The entries are passed to `compose(matchResult[0], this.errorHandler, this.#notFoundHandler)` and run asynchronously. After the chain finishes, the dispatch checks `context.finalized`. If the flag is false, dispatch throws an error whose message explains that the handler forgot to return a `Response` or to `await next()`, and that error is then handled by `#handleError`.

<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The compose function is described in detail in [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md). Two details matter for lifecycle reasoning: `next()` may be called only once per middleware (a second call throws `next() called multiple times`), and `context.req.routeIndex` is updated as each entry runs, which is how `c.req.param()` finds the parameters that belong to the currently executing handler.

## 6. Not Found

If no handler returns a response, the not-found handler runs. The default writes `404 Not Found` as plain text. The handler is set with `app.notFound(...)` and is also used when the chain ends without a finalized context. The single-handler path calls the not-found handler both when the handler returns `undefined` and when a promise resolves to `undefined` without the context being finalized.

## 7. Errors

Any exception thrown by a handler or middleware is caught in `#dispatch` (or inside `compose`) and handed to `#handleError`:

- A value that is not an `Error` instance is re-thrown unchanged.
- An `Error` is passed to `this.errorHandler(err, c)`. The default handler returns the `HTTPException` response when the error has `getResponse`, and otherwise logs the error with `console.error` and returns `500 Internal Server Error` as text.

Inside `compose`, an error is delivered to `onError` only when an error handler is configured and the error is an `Error`. The error is also stored on `context.error` before `onError` runs, so later middleware can inspect it.

## 8. Ordering Guarantees

- Handlers and middleware run in registration order for matching entries, which is the order the router returns them.
- When a middleware or handler returns a `Response`, `compose` assigns it to `context.res` only if the context is not yet finalized or an error handler produced it. Setting `c.res` directly through the `Context` setter merges headers from the previous response (including `set-cookie` values) into the new one.
- `#dispatch` returns `context.res` only after the whole chain completes and the finalization check passes; an exception raised at any point in the chain goes through the error handler.

## Failure Modes Worth Knowing

- **Missing `await next()`.** The finalization check turns this into an explicit error instead of an empty response.
- **Calling `next()` twice.** This throws `next() called multiple times` from inside `compose`, which is also routed to the error handler.
- **Path mismatch under strict mode.** A trailing slash is significant unless `strict: false` is set in the constructor options.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Colocated tests cover these paths, including `src/hono.test.ts` and `src/compose.test.ts`. For focused runs, see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md).
