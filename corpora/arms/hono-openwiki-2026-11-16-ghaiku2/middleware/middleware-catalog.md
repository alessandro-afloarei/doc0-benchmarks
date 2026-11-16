---
type: reference
title: Built-in Middleware Catalog
description: Catalog of the built-in middleware under src/middleware, grouped into authentication, security, request and response handling, observability, routing and context, and rendering, with each module's main export, its shared patterns, and where its implementation and tests live.
tags: [hono, middleware, auth, cors, csrf, jwt, logging, compression, cache, i18n, jsx]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-7c59a56e01962fdd144c8972
    resource: repo://src/middleware/combine/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-785846e8d46887671c6d2d0b
    resource: repo://src/middleware/request-id/request-id.ts
  - id: openwiki-source-bec7ff0540414557fa30d4ce
    resource: repo://src/middleware/secure-headers/secure-headers.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Built-in Middleware Catalog

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Each built-in middleware is a folder under `src/middleware/<name>/` with an `index.ts` that exports one factory function, and usually a `<name>.test.ts` or `index.test.ts` next to it. Subpaths are published as `hono/<name>` (for example `hono/cors`, `hono/jwt`). Factories follow one convention: they take an options object (optional) and return a `MiddlewareHandler` that reads the `Context`, either calls `next()` or returns a response, and may set headers on `c.res` after `await next()` (see [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)). About 29 middleware directories exist; the table below groups them by purpose.

## Inventory

| Group | Middleware (directory) | Main export | What it does |
| --- | --- | --- | --- |
| Authentication | `basic-auth` | `basicAuth` | HTTP Basic authentication with a verifier or a list of users. |
| | `bearer-auth` | `bearerAuth` | Bearer token check against a token list or a verifier function. |
| | `jwt` | `jwt`, `sign`, `verify`, `decode`, `verifyWithJwks` | Verifies JWTs from the `Authorization` header and exposes the decoded payload. |
| | `jwk` | `jwk` | Verifies JWTs against keys from a JWKS endpoint or local JWK set. |
| Security | `cors` | `cors` | Cross-origin headers and preflight responses. Default origin is `*`. |
| | `csrf` | `csrf` | Origin check for unsafe methods. Default allows only the request's own origin. |
| | `secure-headers` | `secureHeaders`, `NONCE` | Sets security headers such as `Strict-Transport-Security` (default `max-age=15552000; includeSubDomains`) and `X-Frame-Options` (default `SAMEORIGIN`); supports CSP nonces. |
| | `ip-restriction` | `ipRestriction` | Allows or denies requests by client IP address. |
| Request handling | `body-limit` | `bodyLimit` | Rejects bodies over a size limit with `413` by throwing an `HTTPException`. |
| | `method-override` | `methodOverride` | Rewrites `POST` to another method from a form field or header. |
| | `timeout` | `timeout` | Races the handler against a timer and returns a `504` by default. |
| | `trailing-slash` | `trimTrailingSlash`, `appendTrailingSlash` | Normalizes the trailing slash on the path. |
| Response handling | `compress` | `compress` | Compresses responses whose content type matches the compressible-type pattern (`COMPRESSIBLE_CONTENT_TYPE_REGEX` in `src/utils/compress.ts`). |
| | `etag` | `etag` | Generates an `ETag` digest and returns `304` on a match; keeps `RETAINED_304_HEADERS`. |
| | `cache` | `cache` | Stores responses in the Web `caches` API (`caches.open` then `cache.match`) under a cache key derived from the request. |
| | `pretty-json` | `prettyJSON` | Pretty-prints JSON response bodies. |
| | `serve-static` | `serveStatic` | Serves files from a root directory via a platform file-system adapter; `defaultJoin` builds paths. |
| | `powered-by` | `poweredBy` | Adds `X-Powered-By`. |
| Observability | `logger` | `logger` | Logs request method, path, status, and duration. |
| | `timing` | `timing` | Adds `Server-Timing` entries; `startTime`, `endTime`, `setMetric`, and `wrapTime` record metrics. |
| | `request-id` | `requestId` | Sets a request identifier, from an incoming header or `crypto.randomUUID()` by default. |
| Routing and context | `context-storage` | `contextStorage`, `getContext`, `tryGetContext` | Makes the current `Context` available outside handlers via `AsyncLocalStorage`. |
| | `combine` | `every`, `some`, `except` | Composes several middleware into one conditional chain. |
| | `language` | `languageDetector` | Detects the language from a cookie, header, path, or query, using the detector functions in `language.ts`. |
| Rendering | `jsx-renderer` | `jsxRenderer`, `useRequestContext` | Installs an HTML renderer and layout for `c.render()`. |

## Shared patterns

- **Options objects.** Every factory has an optional options argument with defaults documented in its JSDoc. Factories that accept a function (for example `basicAuth`'s verifier, `cors`'s `origin`, `csrf`'s origin handler) normalize a static value into a function internally.
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Error responses.** Most middleware either returns a `Response` directly (for example `cors` preflights and `bearerAuth` challenges) or throws `HTTPException`, which the app's error handler converts to a response (see [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)). `body-limit` and `timeout` use `HTTPException`, and `timeout` takes a custom exception factory.
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Post-processing.** Middleware that changes responses (`secure-headers`, `timing`, `etag`, `compress`, `request-id`) calls `await next()` and then edits `c.res` or the headers of the returned response. This works because assigning `c.res` finalizes the context and headers are carried over (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).
- **Platform dependencies.** Most middleware uses only Web Standards (`crypto.randomUUID`, `caches`, `Request`/`Response`). Two use Node-specific modules: `context-storage` imports `AsyncLocalStorage` from `node:async_hooks`, and `serve-static` depends on a runtime adapter for file access. Keep these in mind when targeting edge runtimes.
- **Conditional composition.** `combine` (`every`, `some`, `except`) wraps other middleware so that a path or request condition decides whether it runs, which avoids duplicating route patterns.

## Notable behaviour

- `cors` defaults to `origin: '*'` and the methods `GET, HEAD, PUT, POST, DELETE, PATCH`. Combining the wildcard origin with credentials needs an explicit origin, so review the options when enabling credentials.
- `csrf` defaults to an origin check that compares the `Origin` header with the request URL's origin, so a cross-site form post is rejected unless the origin list is configured.
- `secure-headers` applies a default header set (for example `Strict-Transport-Security` and `X-Frame-Options`), and its options let applications override or disable individual headers.
- `request-id` takes its identifier from a generator function, which defaults to `crypto.randomUUID()` and can be replaced through options.
- `context-storage` must be registered before any code that calls `getContext()`, because the store is populated per request in the middleware.

## Where to look

- Implementation: `src/middleware/<name>/index.ts` (and helper modules such as `jwt/jwt.ts`, `language/language.ts`, `secure-headers/secure-headers.ts`).
- Shared helpers used by several middleware: `src/utils/jwt/` for JWT primitives, `src/utils/basic-auth.ts`, `src/utils/compress.ts`, `src/utils/cookie.ts`, and `src/utils/buffer.ts`.
- Tests: each folder has its own test file, and most are named `index.test.ts`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md)
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Validator Middleware and Input Types](/openwiki/validation/validator.md)
