---
type: concept
title: Error Handling and HTTPException
description: How Hono turns thrown errors and unmatched routes into responses — HTTPException, the default and custom onError/notFound handlers, where errors are caught inside the middleware chain, c.error, and how sub-app handlers behave under route().
tags: [core, errors, http-exception, onerror, notfound]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-4e968602dc62924b082c5c1f
    resource: repo://src/hono.test.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Error Handling and HTTPException

Hono has two "fallback" handlers on every application: an **error handler** (`app.onError`) and a **not-found handler** (`app.notFound`). Both are invoked from the dispatch and compose machinery described in [Application Object and Request Dispatch](application.md) and [Middleware Composition](middleware-composition.md).

## `HTTPException`

`src/http-exception.ts` (`hono/http-exception`) defines `HTTPException extends Error` for failures that should map to a specific HTTP response — built-in middleware such as basic/bearer auth, JWT, CSRF, body-limit, timeout and the validator throw it.

- `new HTTPException(status = 500, { message?, res?, cause? })`. The status is typed as a `ContentfulStatusCode`.
- `getResponse()` returns a new `Response` built from `options.res`'s body and headers **with the exception's status**, or, when no `res` was supplied, a plain `Response(message, { status })`.

Because `getResponse()` re-creates the response, the exception's `status` always wins over the status of the supplied `res`.

## Default handlers

In `src/hono-base.ts`:

- **Not found:** `c.text('404 Not Found', 404)`.
- **Error:** if the error has a `getResponse` method (duck-typed, so it works across module copies of `HTTPException`), its response is returned via `c.newResponse(res.body, res)` — which also merges headers already staged on the context. Any other error is logged with `console.error` and answered with `500 Internal Server Error`.

Custom handlers replace these: `app.onError((err, c) => Response)` and `app.notFound((c) => Response)`. Custom error handlers commonly check `err instanceof HTTPException` and call `err.getResponse()`.

## Where errors are caught

- In the **multi-handler path**, `compose` wraps each handler call in `try/catch`. When a handler (or anything it awaits further down the chain) throws an `Error`, the innermost `dispatch` level catches it, stores it on `c.error`, and calls the error handler; that response is assigned to `c.res` **even if the context was already finalized**. Outer middleware therefore resume normally after `await next()` — they see a response and can inspect `c.error` — rather than seeing the exception propagate.
- In the **single-handler fast path**, synchronous throws and promise rejections are routed to the error handler directly.
- Errors thrown by the **not-found handler** are handled the same way, so `onError` can catch them.
- If the chain finishes without producing a response, dispatch raises `Context is not finalized. Did you forget to return a Response object or \`await next()\`?`, which the error handler converts (500 by default).
- **Non-`Error` throwables** (e.g. `throw 'string'` or a thrown `Response`) are not handled: compose and dispatch re-throw them to the runtime.

## Sub-applications

When mounting a sub-app with `app.route(path, sub)`:

- If `sub` has a custom `onError`, each of its handlers is wrapped so that errors raised in the sub-app's handlers are handled by **the sub-app's** error handler; routes without such a wrapper fall back to the parent's handler.
- `sub.notFound` is **not** used. Not-found is resolved once per request by the top-level app, including for paths under the sub-app's prefix and for sub-app handlers that return nothing.

`app.mount()` (for foreign fetch handlers) does not participate: the mounted handler is responsible for its own errors, and if it returns nothing the chain continues with `next()`.

## Interaction with adapters and middleware

- Cloudflare Pages' `handleMiddleware` converts an `HTTPException` on `context.error` into `getResponse()` and re-throws other errors (see [Runtime Adapters](../adapters/runtime-adapters.md)).
- Middleware that wrap the response after `await next()` (logger, timing, CORS, secure headers) still run when a downstream handler threw, because compose converted the error into a response first.

## Tests

`src/http-exception.test.ts` covers `getResponse` with and without a custom `res`, status precedence and `cause`. `src/hono.test.ts` contains the `onError`, `onError for a single handler`, `notFound`, and `Error in notFound()` suites demonstrating sub-app and fallback behavior.
