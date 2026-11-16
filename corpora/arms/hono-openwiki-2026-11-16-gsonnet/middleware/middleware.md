---
type: component-group
title: Built-in Middleware
description: Conventions and behaviour of Hono's built-in middleware under src/middleware — the MiddlewareHandler contract, auth (basic, bearer, jwt, jwk), security (cors, csrf, secure-headers, ip-restriction), transport (compress, etag, cache, body-limit, timeout), serve-static, combine, and context utilities.
tags: [middleware, auth, jwt, cors, csrf, compress, serve-static, security]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-5eb47cd472f110c959d254bb
    resource: repo://src/middleware/basic-auth/index.ts
  - id: openwiki-source-f8c757c8888f99d3f919731d
    resource: repo://src/middleware/bearer-auth/index.ts
  - id: openwiki-source-c6eb362a94bf78796a7832b4
    resource: repo://src/middleware/body-limit/index.ts
  - id: openwiki-source-b506e9e559730c86c05d203e
    resource: repo://src/middleware/cache/index.ts
  - id: openwiki-source-7c59a56e01962fdd144c8972
    resource: repo://src/middleware/combine/index.ts
  - id: openwiki-source-c52e34c02912599687c48998
    resource: repo://src/middleware/compress/index.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-ef88a825b039e386354ea111
    resource: repo://src/middleware/etag/index.ts
  - id: openwiki-source-7d7de7263bece31630d79d9a
    resource: repo://src/middleware/ip-restriction/index.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
  - id: openwiki-source-3a62e700d7a5e8fe8b34e1d0
    resource: repo://src/middleware/timeout/index.ts
  - id: openwiki-source-79563bcc563e362b43cf45a2
    resource: repo://src/utils/jwt/jwt.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Built-in Middleware

Each directory in `src/middleware` is its own public entry (`hono/cors`, `hono/jwt`, `hono/compress`, …; see [Architecture Overview](../architecture/overview.md)). All are factories returning a `MiddlewareHandler` — `(c, next) => Promise<Response | void>` — executed by `compose` (see [Request Lifecycle](../architecture/request-lifecycle.md)).

## Conventions

- **Pre vs post processing.** Code before `await next()` sees the request only; code after sees `c.res`. Response-decorating middleware (`cors`, `secure-headers`, `etag`, `compress`, `timing`, `powered-by`, `pretty-json`) generally operate on `c.res` (the `c.res` setter merges headers, see [Context and HonoRequest](../core/context-and-request.md)).
- **Short-circuiting.** Returning a `Response` without calling `next` ends the chain; failing middleware usually `throw new HTTPException(status, { res?, message? })` so the app `onError` (or default handler) turns it into a response and so custom handlers can recognise it.
- **Passing data.** Middleware store results with `c.set(key, value)`; types are published by augmenting `ContextVariableMap` (e.g. `jwt` declares `jwtPayload`, `secure-headers` declares its nonce variable) via `declare module '../..'`.
- **Option validation at construction time.** Misconfiguration throws when the middleware is created (e.g. `jwt` requires `secret` and `alg` and `crypto.subtle.importKey`; `bearerAuth` requires `token` or `verifyToken`; `cache` rejects `vary: '*'`), so it fails at startup rather than per request.
- **Registration order.** Because the router returns handlers in registration order, a middleware only guards handlers registered after it on matching paths.

## Authentication

- **`basic-auth`** — parses `Authorization: Basic`, compares username/password using `timingSafeEqual` (`utils/buffer.ts`, hashing both sides before comparison) across all configured users to avoid early exit; failure returns 401 with `WWW-Authenticate: Basic realm=…`.
- **`bearer-auth`** — validates `Authorization: Bearer <token>` against a token string/array (constant-time compare, optionally with a `hashFunction`) or a custom `verifyToken(token, c)`; distinct customisable messages and `WWW-Authenticate` values for a missing header (401), a malformed header or token (400, `error="invalid_request"`) and a rejected token (401). A token regexp rejects unexpected characters.
- **`jwt`** (`middleware/jwt/jwt.ts`) — takes the `Authorization` header (`Bearer <token>`, custom `headerName` possible) or, if absent, a cookie (plain, or signed via `getSignedCookie`, with prefix options). Missing/malformed credentials → `HTTPException(401)` with an RFC 6750-style `WWW-Authenticate` response; verification via `Jwt.verify` (`utils/jwt/jwt.ts`); on success `c.set('jwtPayload', payload)`. `alg` is mandatory and must equal the token header's `alg` (`JwtAlgorithmMismatch`), blocking algorithm confusion. `verify` also checks `nbf`, `exp`, `iat` (each may be disabled), `iss` (string or RegExp) and `aud`. Related exports: `sign`, `verify`, `decode`, `verifyWithJwks`.
- **`jwk`** — verifies tokens against a JWK set (`keys` and/or `jwks_uri`, fetched with `fetch`). `verifyWithJwks` requires a `kid` in the header, explicitly rejects symmetric algorithms (HS256/384/512) and requires the algorithm to be in `allowedAlgorithms`, again to prevent algorithm confusion.

## Security

- **`cors`** — options `origin` (string, `'*'` default, array, or async function), `allowMethods`, `allowHeaders`, `exposeHeaders`, `maxAge`, `credentials`. Sets `Access-Control-Allow-Origin` when the request origin is allowed, and for `OPTIONS` preflight adds `Vary: Origin` (when origin isn't `*`), `Max-Age`, methods, and headers (falling back to echoing `Access-Control-Request-Headers`); the preflight is answered directly with 204 without running downstream handlers.
- **`csrf`** — blocks unsafe-method (non GET/HEAD) requests whose `Content-Type` is a form type (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`) unless `Sec-Fetch-Site` is allowed (default `same-origin`) **or** `Origin` is allowed (default: equals the request URL's origin). Violations throw `HTTPException(403, 'Forbidden')`. JSON requests are not checked (they trigger CORS preflight).
- **`secure-headers`** — sets headers such as CSP, HSTS, X-Frame-Options, etc.; exposes a `NONCE` helper and a `secureHeadersNonce` context variable for CSP script nonces.
- **`ip-restriction`** — takes deny/allow rule lists (exact IPv4/IPv6, CIDR, `*`, or predicate) compiled by `buildMatcher` into static sets and bigint CIDR masks; IPv4-mapped IPv6 addresses are normalised so `::ffff:1.2.3.4` matches IPv4 rules; rules are validated at construction (`TypeError: Invalid rule`). The client address comes from a `getConnInfo`-style function (see [Runtime Adapters](../runtimes/adapters.md)).

## Transport and performance

- **`compress`** — runs after `next()`, skipping partial (206), already-encoded or chunked responses, HEAD, content below `threshold` (default 1024 bytes when `Content-Length` is known), non-compressible content types (`COMPRESSIBLE_CONTENT_TYPE_REGEX`, overridable) and `Cache-Control: no-transform`. It picks `gzip` or `deflate` from `Accept-Encoding` honouring q-values (or the single configured `encoding`), pipes the body through `CompressionStream`, removes `Content-Length`, sets `Content-Encoding`, and downgrades a strong `ETag` to weak.
- **`etag`** — after `next()`, uses an existing `ETag` or hashes a clone of the body (SHA-1 via `crypto.subtle` by default; `generateDigest` pluggable; `weak` option). If `If-None-Match` matches, replaces the response with a bodiless 304 keeping only `RETAINED_304_HEADERS` (cache-control, date, etag, expires, vary, …).
- **`cache`** — wraps the Web Cache API (`caches`): if `globalThis.caches` is missing it logs (or calls `onCacheNotAvailable`) and becomes a no-op. Responses are stored for cacheable statuses (default 200) unless they have `Set-Cookie`, `Cache-Control: private/no-store/no-cache`, or a `Vary` not covered by the configured `vary`; `cacheControl` and `vary` options append headers; `wait` (default false) controls whether `cache.put` is awaited (otherwise it is handed to `executionCtx.waitUntil`).
- **`body-limit`** — rejects bodies over `maxSize` with `413 Payload Too Large` (as an `HTTPException` carrying the response, or via `onError`). With a `Content-Length` and no `Transfer-Encoding` it decides from the header alone; otherwise it reads the stream chunk by chunk, aborting as soon as the limit is exceeded, then replaces `c.req.raw` with a new `Request` over the buffered chunks so later readers still work.
- **`timeout`** — races `next()` against a timer and rejects with an `HTTPException` (default `504 Gateway Timeout`, or a per-request factory); the timer is cleared in `finally`. It cannot cancel the downstream work, only stop waiting for it.

## Static files

`serve-static` (`middleware/serve-static/index.ts`) is runtime-agnostic: it needs a `getContent(path, c)` and optionally `join`, `isDir`. Per request it skips if `c.finalized`; derives the filename from `options.path` or the decoded `c.req.path`, **rejecting paths containing `.`/`..` segments, empty segments or backslashes** (falls through via `onNotFound` + `next()`); applies `rewriteRequestPath` and `root`; appends `index.html` for directories; serves a returned `Response` as-is or sets `Content-Type` from the mime table (with `mimes` overrides, default `application/octet-stream`); with `precompressed` it looks for `.br`, `.zst` or `.gz` sibling files (in that order) matching `Accept-Encoding` and sets `Content-Encoding` and `Vary`. Runtime wrappers (`adapter/bun`, `adapter/deno`, `adapter/cloudflare-workers`, `adapter/cloudflare-pages`) provide `getContent`.

## Composition (`combine`)

`some(...mws)` runs middleware in order until one succeeds (a handler "fails" by throwing or returning `false` for a condition function); `every(...mws)` composes all of them with `compose` and fails if any throws; `except(condition, ...mws)` applies `mws` unless a condition matches — string conditions are compiled into a `TrieRouter` so path patterns like `/api/*` work, function conditions receive `c`.

## Context and utility middleware

- **`context-storage`** — `contextStorage()` runs the rest of the chain inside `AsyncLocalStorage<Context>`; `getContext()` / `tryGetContext()` retrieve the current request's `Context` from anywhere (requires `node:async_hooks` support).
- **`request-id`** — generates/propagates `X-Request-Id`; **`logger`** — prints method/path/status/time; **`timing`** — `Server-Timing` headers; **`powered-by`**, **`pretty-json`**, **`trailing-slash`** (redirect), **`method-override`** (override method from form/header/query), **`language`** (detect language from header/cookie/query with fallback), **`jsx-renderer`** (see [Hono JSX](../jsx/jsx-system.md)).
