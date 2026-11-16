---
type: architecture
title: Middleware Composition (compose)
description: How compose() in src/compose.ts chains matched handlers into an onion-style pipeline, including next() semantics, double-next detection, routeIndex tracking, error and not-found integration, and the single-handler fast path in HonoBase.
tags: [compose, middleware, next, error-handling, onion-model]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Middleware Composition

Hono treats middleware and final handlers uniformly: the router returns *every* handler matching `(method, path)` in registration order, and `compose` (`src/compose.ts`, adapted from `koa-compose`) turns that list into one async function. It is called from `HonoBase.#dispatch` ([Request Lifecycle](request-lifecycle.md)) and also by `route()` to isolate a sub-app's error handler ([App Core](app-core.md)).

## Signature

`compose(middleware, onError?, onNotFound?)` takes `[[handler, routeInfo], ...]` tuples (only element `[i][0]` is used) and returns `(context, next?) => Promise<Context>`. Note that it resolves to the **Context**, not a Response; the caller reads `context.res` / `context.finalized`.

## The dispatch loop

Each invocation of the returned function creates a fresh `index = -1` and runs `dispatch(0)`. `dispatch(i)`:

1. **Detects misuse:** if `i <= index` it throws `next() called multiple times`. Because `index` is shared per run, calling `next()` twice from one middleware re-enters with an index that was already used.
2. Chooses the handler: `middleware[i][0][0]` (and sets `context.req.routeIndex = i`, which lets `c.req.param()` and `routePath` follow the current handler, see [Context and HonoRequest](context-and-request.md)). When the array is exhausted, the optional outer `next` is used only when `i === middleware.length`.
3. Awaits `handler(context, () => dispatch(i + 1))`. So `next()` returns a promise that resolves when all downstream handlers (and their post-`next` code) finished: the classic onion model, enabling code before and after `await next()`.
4. **Error path:** if the handler throws an `Error` and `onError` exists, the error is stored on `context.error`, `onError(err, context)` produces the response, and that response is forced onto the context (`isError = true`). Non-`Error` throwables or a missing `onError` rethrow.
5. **Not found:** if there is no handler to run and the context is not finalized and `onNotFound` exists, its result becomes the response. This is what produces a 404 after the last middleware calls `next()` with no terminal handler.
6. **Commit rule:** a returned value is assigned to `context.res` only when `context.finalized === false` or it came from the error handler. Consequently, once a downstream handler has produced a response, an upstream middleware's returned value is ignored; a middleware that wants to replace the response after `await next()` must assign `c.res = ...` (merged by Context's setter) rather than rely on its return value.

Handlers may return a `Response` (or a promise of one), which `compose` commits as above, or return nothing after calling `next()`.

## Interplay with HonoBase.#dispatch

- **Fast path:** if exactly one handler matched (`matchResult[0].length === 1`), `#dispatch` calls it directly without `compose`, passing a `next` that sets `c.res` to the not-found response. A synchronous return value is used as-is (falling back to not-found for `undefined`); a promise is resolved with `resolved || (c.finalized ? c.res : notFound)`, and rejections go to the error handler.
- **Composed path:** otherwise `compose(matchResult[0], this.errorHandler, this.#notFoundHandler)` runs, and if the resulting context is still not finalized, `#dispatch` throws `Context is not finalized. Did you forget to return a Response object or \`await next()\`?`, which is then routed through the error handler (typically a 500). This is the usual symptom of a middleware that neither returns a response nor awaits `next()`.

## Practical consequences

- Middleware order is registration order across `use()` and verb handlers, because routers preserve insertion order within each path match (see [Router Contract](../routing/router-contract-and-smart-router.md)).
- Forgetting `await` on `next()` still compiles but breaks post-processing and may trip the finalization check.
- A sub-app with its own `onError` is wrapped with `compose([], app.errorHandler)` so errors thrown inside it never reach the parent's error handler.
- Behaviour is pinned by `src/compose.test.ts` (error handling, not-finalized detection, multiple `next()` calls, koa-compose parity cases).
