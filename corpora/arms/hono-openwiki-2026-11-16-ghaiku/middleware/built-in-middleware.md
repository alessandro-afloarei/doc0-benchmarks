---
type: reference
title: Built-in Middleware Catalog
description: Catalog of the first-party middleware under src/middleware, grouped by concern - authentication (basic, bearer, JWT, JWK), request and response security (CORS, CSRF, secure headers, IP restriction, body limit), response processing (compress, ETag, cache, serve-static, pretty-json), request handling (request-id, timeout, method-override, trailing-slash, language, combine, context-storage), observability (logger, timing), and rendering - with the key mechanisms, defaults, and failure responses of each.
tags: [middleware, authentication, security, cors, csrf, jwt, cache, compression, logging, catalog]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-5eb47cd472f110c959d254bb
    resource: repo://src/middleware/basic-auth/index.ts
  - id: openwiki-source-f8c757c8888f99d3f919731d
    resource: repo://src/middleware/bearer-auth/index.ts
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-1b54b0033c153265ad5e31a3
    resource: repo://src/middleware/language/language.ts
  - id: openwiki-source-785846e8d46887671c6d2d0b
    resource: repo://src/middleware/request-id/request-id.ts
  - id: openwiki-source-bec7ff0540414557fa30d4ce
    resource: repo://src/middleware/secure-headers/secure-headers.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
  - id: openwiki-source-9adc4d1bf2d0eec0fe711cf5
    resource: repo://src/middleware/timing/timing.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Built-in Middleware Catalog

<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Each first-party middleware lives in its own directory under `src/middleware/` and is published as a subpath export (for example `hono/cors`, `hono/jwt`, `hono/timing`). All of them follow the `MiddlewareHandler` contract described in [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md): each is a factory that returns a `(c, next)` function, which either calls `next()` or returns a `Response`, and which reports failures by returning a response or by throwing an `HTTPException`. The groups below follow the options types declared in each module.

## Authentication

- **`basicAuth`** (`src/middleware/basic-auth/index.ts`) requires either `username` and `password` options or a `verifyUser(username, password, c)` callback, and throws at construction when neither is given. Defaults are `realm` `Secure Area` and `invalidUserMessage` `Unauthorized`. Credentials are compared with `timingSafeEqual`, which can hash both sides with `hashFunction` first. A failed attempt responds `401`, and `onAuthSuccess(c, username)` runs before `next()` on success.
- **`bearerAuth`** (`src/middleware/bearer-auth/index.ts`) requires a static `token` or a `verifyToken` callback. It reads the `Authorization` header, expects the prefix `Bearer` by default (configurable through `prefix`), and checks the token format with a regular expression before verifying. Missing or invalid tokens raise `401` with a `WWW-Authenticate` challenge built from `realm`, and malformed requests raise `400`.
<!-- openwiki: broken internal link [/openwiki/utils/crypto-jwt-and-encoding.md] link "/openwiki/utils/crypto-jwt-and-encoding.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`jwt`** (`src/middleware/jwt/jwt.ts`) verifies a JWT read from the `Authorization` header (or from `headerName`), or from a cookie when `cookie` names one. The `alg` option is required and selects among HS, RS, PS, ES, and EdDSA algorithms. On success the decoded payload is stored as the `jwtPayload` context variable; on failure the middleware throws `401`. The token machinery is described in [Crypto, JWT and Encoding Utilities](/openwiki/utils/crypto-jwt-and-encoding.md).
- **`jwk`** (`src/middleware/jwk/jwk.ts`) validates tokens against JSON Web Keys supplied as `keys`, as a `jwks_uri` (a string or a function of the context), or both. Keys fetched from `jwks_uri` are merged with the static keys. The middleware throws at construction when neither `keys` nor `jwks_uri` is given.

## Request and Response Security

- **`cors`** (`src/middleware/cors/index.ts`) defaults to `origin: '*'`, the methods `GET HEAD PUT POST DELETE PATCH`, and empty allowed and exposed header lists. `origin` may be a string, a list, or a function. A specific origin is echoed back only when it matches, and `allowMethods` may be a function of the origin. `maxAge` and `credentials` control the remaining `Access-Control-*` headers.
- **`csrf`** (`src/middleware/csrf/index.ts`) checks every method except `GET` and `HEAD`. By default a request is allowed only when its `Origin` header equals the origin of the request URL, or when `Sec-Fetch-Site` is `same-origin`. A request missing the relevant header is denied. `origin` and `secFetchSite` accept a value, a list, or a function. A denial raises `403` with the body `Forbidden`.
- **`secureHeaders`** (`src/middleware/secure-headers/secure-headers.ts`) sets a default set of headers, including `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `X-Content-Type-Options: nosniff`, and `X-Frame-Options: SAMEORIGIN`, and it removes `X-Powered-By`. Options can override or disable each header, add `Content-Security-Policy` and `Content-Security-Policy-Report-Only` directives (a per-request nonce is exposed through the `secureHeadersNonce` variable), `Permissions-Policy`, and `Reporting-Endpoints`.
- **`ipRestriction`** (`src/middleware/ip-restriction/index.ts`) takes a runtime-specific `getIP` function and `denyList` and `allowList` rules. A rule is an address string or a predicate over the address and its type. A blocked request receives `403`, or the response produced by `onError`.
- **`bodyLimit`** (`src/middleware/body-limit/index.ts`) enforces `maxSize` on the request body. When `Content-Length` is present and the body is not chunked, it compares that value. Otherwise it reads the body stream and counts bytes as they arrive. An oversized body yields `413`, or the response from `onError`.

## Response Processing

- **`compress`** (`src/middleware/compress/index.ts`) compresses responses with `gzip` or `deflate`. The `encoding` option restricts the choice to one scheme, and `Accept-Encoding` selects among the allowed ones. `threshold` (default 1024 bytes) and `contentTypeFilter` decide which responses are eligible.
- **`etag`** (`src/middleware/etag/index.ts`) computes an entity tag for the response body and answers `If-None-Match` with `304 Not Modified`, keeping the headers listed in `RETAINED_304_HEADERS` (or in a `retainedHeaders` option). `weak: true` prefixes the tag with `W/`.
- **`cache`** (`src/middleware/cache/index.ts`) stores responses in the Cache API (`globalThis.caches`) under `cacheName`, which may be a string or a function of the context. `cacheControl` sets the outgoing `Cache-Control` directives, and `wait` controls whether the write is awaited. When the Cache API is unavailable, the middleware logs a message unless `onCacheNotAvailable` replaces or disables it.
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`serveStatic`** (`src/middleware/serve-static/index.ts`) is the generic static-file middleware. The runtime adapters supply its `getContent`, `join`, and `isDir` functions (see [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md)). Options include `root`, `path`, `rewriteRequestPath`, `mimes`, `onFound`, and `onNotFound`. With `precompressed` it looks for `.br`, `.zst`, or `.gz` siblings that match the request's `Accept-Encoding`. When no file matches, it calls `next()`.
- **`prettyJSON`** (`src/middleware/pretty-json/index.ts`) indents JSON responses. The `query` option names the query parameter that enables it (default `pretty`), `space` sets the indentation width, and a force option applies it regardless of the query.
- **`poweredBy`** (`src/middleware/powered-by/index.ts`) adds an `X-Powered-By` header with a configurable value.

## Request Handling

- **`timeout`** (`src/middleware/timeout/index.ts`) bounds the downstream handler's running time. The default error is an `HTTPException` with status `504`. `exception` may be an exception object or a function that returns one.
- **`requestId`** (`src/middleware/request-id/request-id.ts`) reads the header named by `headerName` (default `X-Request-Id`) or creates an ID with `generator` (default `crypto.randomUUID()`). It stores the ID as the `requestId` context variable and writes it back to the response header.
- **`methodOverride`** (`src/middleware/method-override/index.ts`) rewrites a `POST` to another method when a form field (default `_method`) or a header names one. The form body is parsed from a clone of the request, so the original body remains readable by handlers.
- **`trailingSlash`** (`src/middleware/trailing-slash/index.ts`) removes trailing slashes. By default it redirects only when the route is not found (404); `alwaysRedirect: true` redirects every request that has a trailing slash.
- **`language`** (`src/middleware/language/language.ts`) detects a language code from the query string, cookie, header, or path. The default `order` is `querystring`, `cookie`, `header`, and `fallbackLanguage` defaults to `en`. Option names such as `lookupQueryString` and `lookupCookie` choose the keys to read, and `cookieOptions` controls the cookie the middleware may set.
- **`combine`** (`src/middleware/combine/index.ts`) composes middleware conditionally: `some` runs middleware until one applies, `every` requires all to apply, and `except` skips a middleware when a condition matches.
- **`contextStorage`** (`src/middleware/context-storage/index.ts`) keeps the current context in a Node `AsyncLocalStorage`, and `getContext()` returns it so that helper code can reach the context without receiving `c` as an argument.

## Observability

- **`logger`** (`src/middleware/logger/index.ts`) prints an incoming-request line and a completion line; the completion line includes the status (colorized by status class) and the elapsed time measured with `Date.now()`. Output goes through `fn` (default `console.log`).
- **`timing`** (`src/middleware/timing/timing.ts`) adds a `Server-Timing` header built from the entries that handlers record. `total` (default `true`) includes the overall response time, `totalDescription` names it, and `enabled` (a boolean or a function of the context) decides whether the header is emitted.

## Rendering

<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`jsxRenderer`** (`src/middleware/jsx-renderer/index.ts`) installs a layout and a renderer on the context. It is described in [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md).

## Composition Notes

- Order matters. Headers and preflight responses from `cors` and `secureHeaders` should be installed before handlers and authentication so that early error responses still carry them.
- Errors thrown by middleware go through the app's `onError` handler, so one error handler covers authentication and limit failures alike.
- Middleware that short-circuits returns a response instead of calling `next()`. Middleware that only annotates responses calls `next()` first and then changes `c.res`.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Each directory has colocated tests, for example `src/middleware/jwt/index.test.ts`. The JWK tests use the fixture `src/middleware/jwk/keys.test.json`. See [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md) for how they are run.
