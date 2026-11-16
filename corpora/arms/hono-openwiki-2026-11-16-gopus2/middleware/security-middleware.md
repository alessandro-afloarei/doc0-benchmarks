---
type: subsystem
title: Authentication and Security Middleware
description: Mechanisms, failure behaviour and security-relevant defaults of Hono's basic-auth, bearer-auth, jwt, jwk (and utils/jwt), csrf, cors, secure-headers and ip-restriction middleware.
tags: [security, auth, jwt, jwk, csrf, cors, secure-headers, ip-restriction]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-5eb47cd472f110c959d254bb
    resource: repo://src/middleware/basic-auth/index.ts
  - id: openwiki-source-f8c757c8888f99d3f919731d
    resource: repo://src/middleware/bearer-auth/index.ts
  - id: openwiki-source-963e270a8ebfb612b4c3d5d1
    resource: repo://src/middleware/cors/index.ts
  - id: openwiki-source-eb9e396aa8d9970d4262622e
    resource: repo://src/middleware/csrf/index.ts
  - id: openwiki-source-7d7de7263bece31630d79d9a
    resource: repo://src/middleware/ip-restriction/index.ts
  - id: openwiki-source-b4547eee3cf14a547d5b41a9
    resource: repo://src/middleware/jwk/jwk.ts
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-bec7ff0540414557fa30d4ce
    resource: repo://src/middleware/secure-headers/secure-headers.ts
  - id: openwiki-source-df3100f35990271621d0b7be
    resource: repo://src/utils/buffer.ts
  - id: openwiki-source-79563bcc563e362b43cf45a2
    resource: repo://src/utils/jwt/jwt.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Authentication and Security Middleware

All of these middleware fail by **throwing `HTTPException`**, usually with a prepared `res`. The default `onError` turns that into the response, and a custom `onError` can intercept it by checking `err instanceof HTTPException` (see [Request Lifecycle](../architecture/request-lifecycle.md)). Cryptography uses only Web Crypto (`crypto.subtle`), so the same code runs on every runtime. General conventions are on [Built-in Middleware](./built-in-middleware.md).

## Credential comparison

`timingSafeEqual(a, b, hashFunction?)` (`src/utils/buffer.ts`) is used by `basic-auth` and `bearer-auth` for static credentials. For strings, both values are hashed with SHA-256 (or a custom `hashFunction`). The function then compares the two digests **and** the two original strings with a constant-time string comparison, and returns true only if both comparisons match.

## `basicAuth` (`hono/basic-auth`)

- Configure with `{ username, password }` plus any number of extra user objects, or with `verifyUser(username, password, c)`. Configuring neither throws at construction time.
- The `Authorization: Basic …` header is decoded by `utils/basic-auth.auth`. Static users are checked with `timingSafeEqual` on both username and password.
- `onAuthSuccess(c, username)` runs before `next()`.
- On failure it throws `HTTPException(401)` with `WWW-Authenticate: Basic realm="Secure Area"` (quotes in the realm are escaped). The body is `invalidUserMessage`, which can be a string, an object sent as JSON, or a function.

## `bearerAuth` (`hono/bearer-auth`)

- Configure with `token` (a string or an array), or `verifyToken(token, c)`. The header defaults to `Authorization` (`headerName`) and the prefix to `Bearer` (`prefix: ''` disables it).
- The token must match the RFC 6750 `b64token` character set. The failures are distinguished as follows:
  - **no header** → 401, `WWW-Authenticate: Bearer realm="…"`;
  - **malformed header or token** → **400**, `error="invalid_request"`;
  - **wrong token** → 401, `error="invalid_token"`.
- Messages and `WWW-Authenticate` values can be customised per case (`noAuthenticationHeader`, `invalidAuthenticationHeader`, `invalidToken`).

## JWT (`hono/jwt`, `hono/utils/jwt`)

`jwt({ secret, alg, cookie?, headerName?, verification? })`:

- **`alg` is required.** A missing secret, missing alg, or missing `crypto.subtle.importKey` throws at setup time.
- The token comes from `Authorization: Bearer <token>`. A header that is not exactly two parts with a `bearer` scheme gives 401 `invalid_request`. If no header is present, the token is read from `cookie`, which may be a plain or signed cookie with an optional `__Secure-`/`__Host-` prefix.
- On success the payload is stored as `c.var.jwtPayload`. On failure: 401 with `WWW-Authenticate: Bearer realm="<request URL>",error="invalid_token",error_description="token verification failure"`, and the verification error attached as `cause`.

`utils/jwt` (`Jwt.sign`, `Jwt.verify`, `Jwt.decode`, `verifyWithJwks`) implements JWS through Web Crypto (`jwa.ts`, `jws.ts`):

- `verify` requires an explicit `alg` and rejects a token whose header `alg` differs (`JwtAlgorithmMismatch`). This blocks algorithm-substitution attacks.
- `nbf`, `exp` and `iat` are checked by default and must be finite numbers when present. Each check can be turned off. `iss` and `aud` are checked when configured, and accept a string, a RegExp, or (for `aud`) an array.
- The signature is checked last, over `header.payload`.

## JWK / JWKS (`hono/jwk`)

`jwk({ keys?, jwks_uri?, alg, allow_anon?, cookie?, headerName?, verification? })` verifies with `verifyWithJwks`:

- At least one of `keys` and `jwks_uri` is required. Both may be functions of `c`, so keys can be chosen per request.
- The token header must have a `kid`. **Symmetric algorithms (HS256/384/512) are always rejected**, and the header `alg` must be in the configured `alg` allow-list of asymmetric algorithms. If the selected JWK has an `alg`, it must also match. Together these prevent key-confusion attacks.
- The JWKS is fetched with `fetch(jwks_uri)` on every verification. The middleware does not cache it, so cache at the platform level or pass `keys` if that matters.
- With `allow_anon: true`, requests without a token pass through without a payload.

## `csrf` (`hono/csrf`)

The request is **blocked with 403** only when all of these hold:

1. the method is not GET or HEAD;
2. the `Content-Type` is one a plain HTML form can send (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`; a missing header counts as `text/plain`);
3. `Sec-Fetch-Site` is missing or not allowed (default: only `same-origin`);
4. `Origin` is missing or not allowed (default: the request URL's own origin).

Passing either the `Sec-Fetch-Site` check or the `Origin` check is enough. `origin` and `secFetchSite` accept a string, an array or a predicate. JSON APIs are not covered: a cross-site JSON POST needs a CORS preflight, so CORS is the protection there.

## `cors` (`hono/cors`)

- The defaults are `origin: '*'` and `allowMethods: GET, HEAD, PUT, POST, DELETE, PATCH`. `origin` may be a string, an array (the request origin is echoed back when it is listed), or a function.
- Preflight (`OPTIONS`) is answered immediately with **204** and `Access-Control-Allow-Methods`, `Max-Age`, and `Allow-Headers`. `Allow-Headers` echoes `Access-Control-Request-Headers` when `allowHeaders` is empty. The route handler never runs for a preflight.
- For other requests the headers are set and `next()` runs. Afterwards `Vary: Origin` is appended unless the origin is `*`.
- `credentials: true` adds `Access-Control-Allow-Credentials: true`. Combining it with `origin: '*'` is the caller's responsibility, because browsers reject that combination.

## `secureHeaders` (`hono/secure-headers`)

Adds a Helmet-like set of headers **after** `next()`. The defaults are:

| Header | Default value |
| --- | --- |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` |

`Cross-Origin-Embedder-Policy` (`require-corp`) is **off** by default. `X-Powered-By` is removed. Each option takes `false` to disable it or a string to override it. `contentSecurityPolicy` / `contentSecurityPolicyReportOnly`, `permissionsPolicy` and `reportTo` build their headers from structured options. For CSP nonces, use the exported `NONCE` in a directive (for example `scriptSrc: [NONCE]`). It generates a per-request nonce **before** `next()` and stores it in `c.var.secureHeadersNonce`, so JSX can render `<script nonce={c.get('secureHeadersNonce')}>`.

## `ipRestriction` (`hono/ip-restriction`)

`ipRestriction(getIP, { denyList, allowList }, onError?)`:

- `getIP` is normally an adapter's `getConnInfo` (see [Runtime Adapters](../integrations/runtime-adapters.md)), or a function that returns an address string.
- The rules can be exact IPv4/IPv6 addresses, CIDR ranges, `*`, or predicate functions. They are compiled once by `buildMatcher` (`utils/ipaddr.ts` does the address parsing).
- The evaluation order is: no address → 403. **Deny wins**: a deny match gives 403, or `onError`. Then an allow match → `next()`. With an empty allow list everything else passes. With a non-empty allow list everything else gets 403. An invalid address is treated like a missing one and gets 403.

## Tests

Each middleware has an `index.test.ts`. The most important security regressions are covered by `utils/jwt/jwt.test.ts` (alg mismatch, time claims), `middleware/jwk/index.test.ts` (symmetric-alg rejection, kid handling), `middleware/csrf/index.test.ts` (header combinations) and `middleware/ip-restriction/index.test.ts` (CIDR, IPv6, deny-precedence).
