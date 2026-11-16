---
type: concept
title: Middleware Composition
description: The koa-compose-style onion model in src/compose.ts that runs matched middleware and handlers in order — next() semantics, routeIndex tracking, how returned responses become c.res, not-found fallthrough, error capture — plus the combine helpers some/every/except.
tags: [core, middleware, compose, next, onion, combine]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-7c59a56e01962fdd144c8972
    resource: repo://src/middleware/combine/index.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Middleware Composition

In Hono, middleware and handlers are the same kind of function, `(c, next) => Response | void | Promise<...>`. The router returns every matching entry — `app.use()` registrations (method `ALL`) and method handlers — **in registration order**, and `compose()` in `src/compose.ts` runs them as a single onion-style chain. The single-handler case bypasses `compose` entirely (see [Application Object and Request Dispatch](application.md)).

## Signature

```ts
compose(middleware, onError?, onNotFound?) => (context, next?) => Promise<Context>
```

`middleware` is the router's match list: an array of `[[handler, routeInfo], params]` tuples (only `[0][0]` — the handler — is used here). The returned function always resolves to the **Context**, not a Response; callers read `context.res`.

## Execution model

The composed function calls `dispatch(0)`. For index `i`:

1. **Re-entrancy guard** — if `i <= index` (the highest index already dispatched), it throws `next() called multiple times`.
2. If a handler exists at `i`, `context.req.routeIndex` is set to `i` so that `c.req.param()`, `c.req.routePath` and `matchedRoutes`-based helpers resolve against the currently executing route. The handler is called with `next = () => dispatch(i + 1)`.
3. Past the end of the array, the outer `next` passed to the composed function is used (this is how nested compositions — `route()` wrappers, `every()` — continue into the parent chain).
4. With no handler at all, if the context is still **not finalized** and an `onNotFound` is given, the not-found handler produces the response.
5. **Result handling:** a truthy return value is assigned to `context.res` **only if the context is not yet finalized** (or the value came from the error handler).

Consequences of rule 5:

- A handler's returned `Response` becomes the response. Code *after* `await next()` in an outer middleware sees `c.res` already set.
- Once finalized, returning a different `Response` from an outer middleware is **ignored**. To replace the response after `next()`, assign it: `c.res = new Response(...)` (the setter merges previously set headers; see [Context](context.md)).
- A middleware that neither returns a response nor calls `next()` leaves the context unfinalized; the app then reports `Context is not finalized...` as an error.

## Errors

Each handler call is wrapped in `try/catch`. If an `Error` is thrown and an `onError` was supplied, the error is stored on `context.error`, `onError(err, context)` produces the response, and that response overwrites `context.res` even if the context was finalized. The error does **not** propagate to outer layers — they resume after `await next()` and can inspect `c.error`. Non-`Error` values, or any error when no `onError` was supplied, are re-thrown. Full semantics are in [Error Handling and HTTPException](error-handling.md).

`compose([], errorHandler)` with an empty middleware list is used as a tiny "error boundary" around a single handler: `route()` uses it to apply a sub-app's `onError`, and the outer `next` is the wrapped handler.

## Combining middleware (`hono/combine`)

`src/middleware/combine/index.ts` builds higher-order middleware on top of compose. Each accepts middleware or boolean condition functions `(c) => boolean`:

- **`some(...m)`** — tries entries in order and stops at the first success. A condition returning `true` (and not finalized) proceeds to `next()`; `false` moves on to the next entry. A thrown error moves on too, **unless** `next()` was already called — then the error is re-thrown immediately to avoid running downstream twice. If nothing succeeds, the last error is thrown (`No successful middleware found` for false conditions).
- **`every(...m)`** — runs all entries as a nested `compose` chain ending in the outer `next`. A condition returning `false` throws `Unmet condition`. It pins `c.req.routeIndex` to the outer value so inner middleware see the same route params.
- **`except(condition, ...m)`** — runs `every(...m)` unless a condition matches. String conditions are path patterns matched with a private `TrieRouter`, so `except('/public/*', auth)` uses full routing syntax.

## Tests

`src/compose.test.ts` (adapted from koa-compose's suite) covers ordering, `next() called multiple times`, error capture, not-found fallthrough, and unfinalized contexts. `src/middleware/combine/index.test.ts` covers `some`/`every`/`except`.

Related: [Request/Response Middleware](../middleware/request-response-middleware.md) and [Security and Authentication Middleware](../middleware/security-and-auth.md) document the built-in middleware that run inside this chain.
