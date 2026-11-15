---
type: subsystem
title: Security and Authentication Middleware
description: Mechanisms, defaults and failure behavior of Hono's security middleware — basic-auth and bearer-auth with timing-safe comparison, jwt and jwk with the src/utils/jwt implementation and algorithm-confusion defenses, csrf via Origin/Sec-Fetch-Site, cors preflight handling, secure-headers with CSP nonces, and ip-restriction with CIDR matching.
tags: [security, authentication, jwt, cors, csrf, middleware]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
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
  - id: openwiki-source-704fe270aa4812b037239378
    resource: repo://src/middleware/jwt/jwt.ts
  - id: openwiki-source-bec7ff0540414557fa30d4ce
    resource: repo://src/middleware/secure-headers/secure-headers.ts
  - id: openwiki-source-df3100f35990271621d0b7be
    resource: repo://src/utils/buffer.ts
  - id: openwiki-source-77b3732d351aa8393874f438
    resource: repo://src/utils/jwt/jwa.ts
  - id: openwiki-source-79563bcc563e362b43cf45a2
    resource: repo://src/utils/jwt/jwt.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Security and Authentication Middleware

All of these middleware fail by **throwing an `HTTPException`** carrying a fully formed `Response` (401, 403, ...), so the response can be customized by catching it in `app.onError` (see [Request Lifecycle](../architecture/request-lifecycle.md#error-and-not-found-handling)). They live in `src/middleware/<name>/` and are exported as `hono/<name>`. General middleware conventions are on the [Built-in Middleware](overview.md) page.

## basic-auth

`basicAuth({ username, password, realm?, hashFunction?, invalidUserMessage?, onAuthSuccess? }, ...moreUsers)` or `basicAuth({ verifyUser(username, password, c) })`.

- Credentials are parsed from `Authorization: Basic ...` by `auth()` in `src/utils/basic-auth.ts`.
- With static users, both username and password are compared with `timingSafeEqual` (see below) against every configured user.
- On failure it throws `HTTPException(401)` with `WWW-Authenticate: Basic realm="..."` (quotes in the realm are escaped; default realm `Secure Area`). `invalidUserMessage` can be a string, an object (sent as JSON) or a function of `c`.
- Constructing it without `username`+`password` or `verifyUser` throws at setup time.

## bearer-auth

`bearerAuth({ token | token[] | verifyToken, prefix = 'Bearer', headerName?, realm?, hashFunction?, ...messages })`:

- Missing header → 401 with `WWW-Authenticate: Bearer realm="..."`.
- Header that does not match `<prefix> <token68>` (token characters `[A-Za-z0-9._~+/-]+=*`; prefix compared case-insensitively; `prefix: ''` expects a bare token) → **400** with `error="invalid_request"`.
- Token mismatch → 401 with `error="invalid_token"`.
- Static tokens are compared with `timingSafeEqual`; `verifyToken(token, c)` allows custom validation.
- Each failure response's message and `WWW-Authenticate` value can be overridden.

### timingSafeEqual

`timingSafeEqual(a, b, hashFunction = sha256)` (`src/utils/buffer.ts`) hashes both inputs, then compares both the hashes and the original strings with a constant-time string comparison. Hashing first equalizes lengths so the comparison time does not reveal the secret's length.

## jwt

`jwt({ secret, alg, cookie?, headerName = 'Authorization', verification? })` (`src/middleware/jwt/jwt.ts`):

- `alg` is **required** (no default), and the middleware throws at setup if `crypto.subtle.importKey` is unavailable.
- The token is read from `Authorization: Bearer <token>` (the header must have exactly two whitespace-separated parts) or, when no header is present, from a cookie (optionally a signed cookie and/or `__Secure-`/`__Host-` prefixed).
- Malformed header → 401 `invalid_request` "invalid credentials structure"; no token → 401 `invalid_request`; verification failure → 401 `invalid_token`, with the verification error attached as `cause`. The `WWW-Authenticate` header includes `realm`, `error` and `error_description`.
- On success, the decoded payload is stored as `c.get('jwtPayload')` (type via `JwtVariables<T>`).

The module also re-exports `sign`, `verify`, `decode` and `verifyWithJwks` from `hono/utils/jwt`.

### JWT implementation (src/utils/jwt)

- `jwa.ts` lists supported algorithms: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA, implemented with Web Crypto in `jws.ts`.
- `verify(token, key, { alg, iss?, aud?, nbf = true, exp = true, iat = true })`:
  - throws `JwtAlgorithmRequired` without `alg`;
  - throws `JwtAlgorithmMismatch` if the token header's `alg` differs from the expected one, so attackers cannot pick the algorithm;
  - validates `nbf`, `exp` and `iat` as finite numbers relative to now (`exp <= now` is expired, `iat` in the future is rejected), and checks `iss` (string or RegExp) and `aud` (string, array or RegExp; a missing `aud` claim fails when `aud` is configured);
  - verifies the signature over `header.payload` and throws `JwtTokenSignatureMismatched` on failure.
- `sign(payload, key, alg = 'HS256')` emits a `typ: 'JWT'` header; when the key is a JWK with `alg`/`kid`, those are used.
- `decode()` parses without verification.

## jwk

`jwk({ keys? | jwks_uri?, alg, allow_anon?, cookie?, headerName?, verification? })` (`src/middleware/jwk/jwk.ts`) verifies asymmetric JWTs against a key set. `keys` and `jwks_uri` may be static or functions of `c`. With `allow_anon: true`, requests without a token pass through unauthenticated.

`verifyWithJwks` enforces:

- The token header must include a `kid`.
- Symmetric algorithms (HS256/384/512) are rejected outright (`JwtSymmetricAlgorithmNotAllowed`) to prevent algorithm-confusion attacks where a public key is used as an HMAC secret.
- The header `alg` must be in the configured `allowedAlgorithms` (the middleware's `alg` option).
- The key is chosen by `kid` from `keys` plus the fetched JWKS (`jwks_uri` must return `{ keys: [...] }`); if the JWK has its own `alg`, it must match the header.

## csrf

`csrf({ origin?, secFetchSite? })` blocks a request with `403 Forbidden` only when **all** of these are true:

1. The method is not `GET`/`HEAD`.
2. The `Content-Type` is one a plain HTML form can send (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`; a missing content type is treated as `text/plain`).
3. `Sec-Fetch-Site` is missing, unknown, or not allowed (default allows only `same-origin`).
4. `Origin` is missing or not allowed (default: equal to the request URL's origin; can be a string, list or function).

JSON APIs are therefore not covered by this check (browsers cannot send cross-site JSON without a CORS preflight); protect those with CORS and authentication.

## cors

`cors({ origin = '*', allowMethods = [GET, HEAD, PUT, POST, DELETE, PATCH], allowHeaders, exposeHeaders, maxAge, credentials })`:

- `Access-Control-Allow-Origin` is set from `origin`: `'*'`, an exact string (echoed only when it equals the request origin), a list, or a function returning the allowed origin (or `null` to deny).
- **Every `OPTIONS` request is answered as a preflight** with `204 No Content` without calling downstream handlers. It sets `Allow-Methods`, `Max-Age`, and `Allow-Headers` (configured list, or the request's `Access-Control-Request-Headers` echoed if none configured, plus `Vary: Access-Control-Request-Headers`).
- For non-wildcard origins, `Vary: Origin` is added.
- Headers are set on `c.res` before `next()`, relying on Context's header carry-over when the handler returns a new response.
- `credentials: true` with `origin: '*'` is not rejected by the middleware; configure explicit origins when using credentials.

## secure-headers

`secureHeaders(options?)` (`src/middleware/secure-headers/secure-headers.ts`) is a Helmet-like middleware that sets headers **after** `next()`:

| Header | Default |
| --- | --- |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | off by default (`require-corp` when enabled) |
| `Origin-Agent-Cluster` | `?1` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` |

Each option accepts `true`/`false` or a custom string. `X-Powered-By` is removed by default. `contentSecurityPolicy` / `contentSecurityPolicyReportOnly` build CSP from a directive object; directive values may include the `NONCE` helper, which generates a 16-byte random nonce per request **before** `next()` and stores it as `c.get('secureHeadersNonce')` so templates (e.g. `<script nonce>` or the [Suspense/css nonce](../jsx/server-jsx.md)) can use the same value. `permissionsPolicy`, `reportingEndpoints` and `reportTo` are also supported.

## ip-restriction

`ipRestriction(getConnInfo, { denyList, allowList }, onError?)` takes the runtime's [`getConnInfo`](../integrations/runtime-adapters.md) (or any function returning an address string):

- Rules can be exact IPv4/IPv6 addresses, CIDR ranges, or `*`. IPv4 rules also match IPv4-mapped IPv6 (`::ffff:a.b.c.d`) and vice versa; addresses are compared as `bigint`s.
- Evaluation order: if the address is missing or invalid → 403; matches `denyList` → denied; matches `allowList` → allowed; else allowed only if `allowList` is empty.
- Denial throws `HTTPException(403, 'Forbidden')` unless `onError(remote, c)` returns a custom response.

Because conninfo for some adapters comes from headers (e.g. `cf-connecting-ip`), the restriction is only as trustworthy as the proxy setting that header.

## Tests

Each middleware has `index.test.ts` beside it; `src/utils/jwt/jwt.test.ts` and `jwa.test.ts` cover signing/verification for every algorithm, and `src/middleware/jwk/keys.test.json` provides test key material.
