---
type: concept
title: Middleware Composition and Error Handling
description: How Hono chains middleware and handlers with compose() - the next() continuation and its single-call invariant, how responses returned by a handler are assigned to the context, the onError and onNotFound hooks and how they interact with thrown errors, how HTTPException converts to a Response, and the middleware authoring contract including createMiddleware and the factory helper.
tags: [middleware, compose, next, error-handling, httpexception, onerror, notfound, createmiddleware]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-5eb47cd472f110c959d254bb
    resource: repo://src/middleware/basic-auth/index.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Middleware Composition and Error Handling

<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono runs a request through a list of handlers and middleware in registration order. The list is built by the router (see [Router Selection and Matching](/openwiki/routing/router-selection.md)), and the chain is executed by `compose` in `src/compose.ts`. This page covers the execution rules a middleware author depends on, the error and not-found hooks, and the `HTTPException` class. The end-to-end dispatch is described in [Request Lifecycle](/openwiki/architecture/request-lifecycle.md).

## The `compose` Contract

`compose(middleware, onError?, onNotFound?)` returns a function `(context, next?) => Promise<Context>`. Calling it starts a continuation-passing chain driven by an internal `dispatch(i)` function:

1. **Single advance.** `dispatch` records the index it has reached. If a middleware calls its `next` more than once, the second call sees an index that is not greater than the recorded one and throws `next() called multiple times`. That error is then handled like any other thrown error.
2. **Entry selection.** For index `i`, if an entry exists, its handler is invoked with the context and a `next` that calls `dispatch(i + 1)`. The entry's index is also stored in `context.req.routeIndex`, so `c.req.param()` reads the parameters of the entry that is running. When the list is exhausted, the optional `next` passed to the composed function is used, which lets an outer caller continue the chain. Otherwise there is no handler.
3. **Response assignment.** If a handler returns a value, `compose` assigns it to `context.res` when the context is not yet finalized, or when the value came from the error handler. A returned `undefined` changes nothing.
4. **Not-found.** When there is no handler for the current index and the context has not been finalized, `onNotFound` (if provided) is called and its return value is treated as a response.

The chain's result is the same context object. The dispatch that called `compose` decides what to return by reading `context.res` and checking `context.finalized`.

A middleware therefore has two valid shapes:

- **Pre-processing and post-processing.** Call `await next()`, then inspect or modify `c.res`. The downstream handler has already written its response by the time `next` resolves.
- **Short-circuit.** Return a `Response` without calling `next()`, or throw an `HTTPException` that carries the response. The built-in authentication middleware (`basicAuth`, `bearerAuth`, `jwt`) takes the second route and throws, so their failure responses pass through the error handler.

## Error Handling

When a handler or middleware throws, the `compose` catch block decides what happens:

- If an error handler exists and the thrown value is an `Error`, `compose` sets `context.error` to the error, awaits `onError(err, context)`, and uses the returned value as the response. The `isError` flag makes the assignment happen even if the context was already finalized, so a response written before the throw can be replaced by the error response.
- Otherwise the exception is re-thrown to the caller of `dispatch`, which is the `next()` call in the parent middleware. An outer middleware with its own `try`/`catch` can observe it.

The app-level hook is set with `app.onError(handler)`. The default handler, defined in `src/hono-base.ts`, returns the response carried by an `HTTPException` when there is one; otherwise it logs the error with `console.error` and returns `500 Internal Server Error` as plain text. A custom handler receives the error and the context and should return a `Response`.

<!-- openwiki: broken internal link [/openwiki/helpers/static-site-generation.md] link "/openwiki/helpers/static-site-generation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The app-level not-found hook is set with `app.notFound(handler)`. The default returns `404 Not Found` as plain text. A middleware can call `c.notFound()` to invoke the same handler explicitly; the SSG helper uses this to skip dynamic routes during generation (see [Static Site Generation (SSG) Helper](/openwiki/helpers/static-site-generation.md)).

## `HTTPException`

`HTTPException` (`src/http-exception.ts`) extends `Error` and carries a `status`, an optional `message`, an optional `cause`, and an optional prebuilt `res`. Its `getResponse()` method is what the default error handler calls:

- If `res` was supplied, `getResponse()` returns a new `Response` with the same body and headers as `res` and the exception's `status`.
- Otherwise it returns a `Response` whose body is the message and whose status is the exception's status.

<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Built-in middleware uses `HTTPException` for protocol-level failures, for example `401` from `jwt` and `bearerAuth`, `403` from `csrf`, `413` from `bodyLimit`, and `504` from `timeout` (see [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md)). Some of these carry a complete `res`. An application with a custom error handler should either handle `HTTPException` explicitly or call `err.getResponse()` to keep the middleware's responses.

## Authoring Middleware

`MiddlewareHandler` is the type of a middleware function. Two helpers exist for typing one:

- **`createMiddleware(fn)`** (exported from `hono/factory`) returns `fn` unchanged. Its purpose is type inference: the environment, path, and return types are inferred from the function, so middleware can declare the variables it sets.
<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`createFactory().createMiddleware`** is the same helper bound to a factory's environment type, so middleware in one module can be typed against a shared environment (see [Helper Modules](/openwiki/helpers/helper-modules.md)).

Guidelines that follow from the contract:

- Call `next()` at most once, and `await` it when you need post-processing.
- Setting `c.res` before `next()` is allowed, but a later handler that returns its own response replaces the body, and the earlier headers are merged into the new response.
- Let errors propagate, or convert them to a `Response` with `HTTPException`. Swallowing an error makes the chain continue as if nothing failed.

## Invariants and Edge Cases

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- A middleware that neither calls `next()` nor returns a `Response` leaves the context unfinalized. The dispatch then throws the finalization error described in [Request Lifecycle](/openwiki/architecture/request-lifecycle.md), which is routed to the error handler.
- Errors thrown after a response has been assigned still go through `onError`, which can replace that response.
- `onError` is not called for thrown values that are not `Error` instances; those are re-thrown unchanged.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/compose.test.ts` covers the `next()` invariant, error propagation, and hook ordering, and `src/http-exception.test.ts` covers `getResponse()`. See [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md).
