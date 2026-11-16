---
type: feature-catalog
title: Built-in Middleware Catalog
description: Catalog of middleware under src/middleware, the shared factory-returning-MiddlewareHandler convention, HTTPException-based error signalling, and detailed behavior of jwt, cors, csrf, body-limit, serve-static, combine and context-storage.
tags: [middleware, auth, jwt, cors, csrf, body-limit, serve-static, combine]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-7c59a56e01962fdd144c8972
    resource: repo://src/middleware/combine/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Built-in Middleware Catalog

Each directory in `src/middleware/<name>/` is a standalone subpath export (`hono/<name>`, listed in `package.json`/`jsr.json`, see [Build and Packaging](../operations/build-and-packaging.md)). They are ordinary `MiddlewareHandler`s: `(c, next) => Promise<Response | void>`, run by [compose](../architecture/middleware-composition.md) and registered with `app.use(path?, mw)`.

## Conventions

- **Factory pattern.** Each module exports a function such as `cors(options)` or `jwt(options)` that validates options *eagerly* (e.g. `jwt` throws at construction for a missing `secret`/`alg` or missing `crypto.subtle.importKey`) and returns a named async function. Named functions (`return async function cors(c, next)`) give readable stack traces and route listings in `showRoutes` ([Helpers](helpers.md)).
- **Failing a request.** Middleware signals HTTP errors by throwing `HTTPException(status, { res?, message?, cause? })` (`src/http-exception.ts`). `getResponse()` returns the supplied `res` re-wrapped with the exception's status, or a plain-text message. The default app error handler turns this into the response, and a custom `app.onError` can intercept it ([App Core](../architecture/app-core.md)). Providing `res` lets middleware control headers such as `WWW-Authenticate`.
- **Sharing data.** Middleware passes data downstream via `c.set(key, value)` with typed `Variables` (e.g. `JwtVariables` adds `jwtPayload`) ([Context](../architecture/context-and-request.md)).
- **Post-processing.** Response-modifying middleware (`cors`, `secure-headers`, `etag`, `compress`, `cache`, `logger`, `timing`, `pretty-json`, `powered-by`) works after `await next()` and mutates `c.res`; the Context `res` setter preserves headers across replacement.

## Catalog by purpose

| Purpose | Modules |
| --- | --- |
| Authentication | `basic-auth`, `bearer-auth`, `jwt`, `jwk` (verify via remote JWKS), `ip-restriction` |
| Browser security | `cors`, `csrf`, `secure-headers` |
| Request limits/shaping | `body-limit`, `timeout`, `method-override`, `trailing-slash`, `language` (Accept-Language detection) |
| Response optimisation | `compress`, `etag`, `cache` (Cache API wrapper) |
| Observability | `logger`, `timing` (Server-Timing), `request-id`, `powered-by` |
| Rendering/serving | `jsx-renderer` ([JSX](jsx.md)), `serve-static`, `pretty-json` |
| Composition/utilities | `combine` (`some`, `every`, `except`), `context-storage` |

Runtime-specific `serveStatic` wrappers (Bun, Deno, Cloudflare Workers) are in [Runtime Adapters](../platform/adapters.md).

## Notable implementations

### jwt (`src/middleware/jwt/jwt.ts`)
Reads the token from the `Authorization` header (default; `headerName` configurable), expecting exactly `Bearer <token>` (otherwise 401 `invalid_request`). If no header is present it falls back to a cookie option (plain or signed via `getSignedCookie`, with optional prefix). Missing token yields 401; verification via `Jwt.verify(token, secret, { alg, ...verification })` failure yields 401 `invalid_token` with the original error as `cause`. On success the payload is stored as `jwtPayload` and `next()` runs. All 401s carry a `WWW-Authenticate: Bearer ...` header. `alg` is **required** at construction (the middleware throws without it), so the caller must explicitly choose the accepted algorithm.

### cors (`src/middleware/cors/index.ts`)
Resolves `origin` (string, `'*'`, array or async function) into an allow-origin finder, sets `Access-Control-Allow-Origin` (and optionally credentials/expose headers) on every response, and for `OPTIONS` preflight adds `Vary: Origin` (when origin is not `*`), max-age, allowed methods and headers (echoing `Access-Control-Request-Headers` when `allowHeaders` is empty), deletes `Content-Length`/`Content-Type` and answers with a body-less `204` response without calling downstream handlers. For non-preflight requests it calls `next()` and then appends `Vary: Origin` when the origin is not `*`.

### csrf (`src/middleware/csrf/index.ts`)
Only inspects requests that use a non-safe method **and** a form-style content type (a missing `Content-Type` is treated as `text/plain`). Such a request is allowed if *either* the `Sec-Fetch-Site` header is acceptable (default: only `same-origin`) *or* the `Origin` header is acceptable (default: same origin as the request URL); a missing header always counts as not acceptable. If both fail, it throws `HTTPException(403)` with a `Forbidden` body. Both checks accept a string, array or predicate.

### body-limit (`src/middleware/body-limit/index.ts`)
If the request has no body it proceeds. With only `Content-Length` it trusts and compares it to `maxSize`. If `Transfer-Encoding` is present (or neither header exists) it **reads the body up-front** while counting bytes, rejects as soon as the limit is exceeded (default error: 413 `Payload Too Large` via `HTTPException`, or custom `onError`), and otherwise replaces `c.req.raw` with a new `Request` over the buffered chunks so handlers can still read the body.

### serve-static (`src/middleware/serve-static/index.ts`)
A runtime-agnostic core that takes a `getContent(path, c)` callback (plus optional `join`, `isDir`, `pathResolve`) and is specialised by adapters. It skips if the context is already finalized, rejects traversal (`..`, `//`, backslashes) by falling through to `next()`, appends `index.html` for directories, sets `Content-Type` from `getMimeType`, and with `precompressed` serves `.br`/`.zst`/`.gz` siblings according to `Accept-Encoding` (adding `Content-Encoding` and `Vary`). `onFound`/`onNotFound` hooks run around the lookup; a miss calls `next()`.

### combine (`src/middleware/combine/index.ts`)
- `some(...mws)`: runs middleware in order and stops at the first that succeeds (returns `true`, a response, or completes without throwing); failures are remembered and rethrown if all fail, but once `next()` has been invoked later errors abort immediately.
- `every(...mws)`: runs all through a nested `compose`, treating a `false` return (conditions) as failure (`Unmet condition`) and restoring `routeIndex` so params stay correct.
- `except(pathOrCondition, ...mws)`: skips the middleware when a path pattern (matched with a `TrieRouter`) or condition matches.

### context-storage (`src/middleware/context-storage/index.ts`)
Stores the `Context` in a module-level `AsyncLocalStorage` for the duration of `next()`, so `getContext()` / `tryGetContext()` can be called from code that has no access to `c` (throws `Context is not available` outside a request). It imports `node:async_hooks`, so it only works on runtimes that provide it.

## Writing your own

Return a `MiddlewareHandler`, `await next()` when you want downstream and post-processing, throw `HTTPException` for HTTP failures, and use `createMiddleware` from the factory helper for typed `Env`/`Variables` ([Helpers](helpers.md)).
