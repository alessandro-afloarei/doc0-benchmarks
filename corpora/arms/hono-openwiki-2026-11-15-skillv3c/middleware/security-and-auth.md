---
type: reference
title: Security and Authentication Middleware
description: How Hono's built-in security middleware verify requests and fail — basicAuth and bearerAuth with timing-safe comparison, jwt and jwk with the utils/jwt verification pipeline, csrf via Sec-Fetch-Site/Origin, cors preflight handling, secureHeaders with CSP nonces, and ipRestriction with CIDR matching.
tags: [middleware, security, auth, jwt, jwk, cors, csrf, secure-headers, ip-restriction]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
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
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Security and Authentication Middleware

These middleware live in `src/middleware/*` and share a convention: **failures throw an `HTTPException` carrying a fully built `Response`**, so the app's error handler (default: `err.getResponse()`) returns that response — see [Error Handling and HTTPException](../core/error-handling.md). A custom `onError` that ignores `HTTPException` will therefore change their failure responses. They run inside the normal [compose chain](../core/middleware-composition.md).

## Timing-safe comparison

`timingSafeEqual(a, b, hashFunction?)` (`src/utils/buffer.ts`) hashes both strings (default SHA-256 from `src/utils/crypto.ts`), compares the hashes in constant time, **and** compares the originals in constant time; both must match. Basic and bearer auth use it for static credentials, with an optional custom `hashFunction`.

## `basicAuth({ username, password } | { verifyUser }, ...moreUsers)`

- Parses `Authorization: Basic <base64>` (case-insensitive scheme), UTF-8 decodes it and splits at the first `:` (`src/utils/basic-auth.ts`); malformed headers count as missing credentials.
- With static users, each `{ username, password }` (the options pair plus any extra users) is compared with `timingSafeEqual`. With `verifyUser(username, password, c)` the callback decides.
- On success it runs `onAuthSuccess(c, username)` (if given) and `next()`.
- On failure it throws `401` with `WWW-Authenticate: Basic realm="Secure Area"` (realm configurable, quotes escaped) and body `invalidUserMessage` (string, object → JSON, or function of `c`).
- Throws at setup if neither credentials nor `verifyUser` are provided.

## `bearerAuth({ token | verifyToken, prefix?, headerName?, realm?, ... })`

- Reads `Authorization` (or `headerName`). Missing header → `401` with `WWW-Authenticate: Bearer realm="..."`.
- The prefix (default `Bearer`, case-insensitive, must be followed by a space; `prefix: ''` means the whole header is the token) is stripped and the token must match the RFC 6750 token68 syntax `[A-Za-z0-9._~+/-]+=*`; otherwise `400` with `error="invalid_request"`.
- The token is compared against `token` (string or array, timing-safe) or passed to `verifyToken(token, c)`. Mismatch → `401` with `error="invalid_token"`.
- Each failure's `WWW-Authenticate` value and body can be customized (`noAuthenticationHeader`, `invalidAuthenticationHeader`, `invalidToken`, or the older `*Message` options).

## JWT — `jwt({ secret, alg, cookie?, headerName?, verification? })`

- `secret` and `alg` are **required** (setup throws otherwise), and `crypto.subtle.importKey` must exist.
- Token source: the header (default `Authorization`) must be exactly two whitespace-separated parts with scheme `bearer`; else `401 invalid_request`. If there is no header, an optional cookie is used — plain, prefixed (`__Secure-`/`__Host-`), or signed via `getSignedCookie`.
- No token → `401` (`no authorization included in request`). Verification failure → `401` with `error="invalid_token"` and the underlying JWT error as `cause`.
- On success the payload is available as `c.get('jwtPayload')`.
- `sign`, `verify`, `decode`, `verifyWithJwks` are re-exported from `hono/jwt`.

### Verification pipeline (`src/utils/jwt/jwt.ts`)

`verify(token, key, alg | { alg, iss?, aud?, nbf?, exp?, iat? })`:

1. An algorithm is mandatory; the token must have three parts and a header whose `alg` is a known algorithm and `typ` (if present) is `JWT`.
2. **The header `alg` must equal the expected `alg`** (prevents algorithm-confusion attacks).
3. Time claims are validated when present (each check can be disabled): `nbf` must be ≤ now, `exp` must be > now, `iat` must be ≤ now; non-numeric values fail.
4. `iss` (string or RegExp) and `aud` (string, array, or RegExp; payload `aud` may be a string or array) are checked when configured; a configured check fails if the claim is missing.
5. The signature is verified with Web Crypto (`src/utils/jwt/jws.ts` / `jwa.ts`: HS*, RS*, PS*, ES*, EdDSA).

Each failure throws a specific error class from `src/utils/jwt/types.ts` (`JwtTokenExpired`, `JwtAlgorithmMismatch`, ...).

## JWK — `jwk({ keys? | jwks_uri?, alg, allow_anon?, cookie?, headerName?, verification? })`

Same token extraction and failure responses as `jwt` (except that `allow_anon: true` lets requests without a token continue unauthenticated), but verification uses `verifyWithJwks` with `alg` as the required list of allowed **asymmetric** algorithms:

- The token header must have a `kid`; **symmetric algorithms (HS256/384/512) are rejected**, and the algorithm must be in the allowed asymmetric list.
- Keys come from `keys` and/or a fetched `jwks_uri` (both may be functions of `c`); fetched keys are appended. A non-OK fetch or a response without a `keys` array throws.
- The key with matching `kid` is selected (no match → invalid token); if the key declares an `alg` it must match the header.

## `csrf({ origin?, secFetchSite? })`

Blocks only requests that are **unsafe** (not GET/HEAD) **and** form-like (`Content-Type` of `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, or missing) **and** fail both checks:

- `Sec-Fetch-Site` allowed — default only `same-origin`; configurable as value, list, or function. Unknown values are rejected.
- `Origin` allowed — default equals the request URL's origin; configurable as string, list, or function. A missing `Origin` is not allowed.

Blocked requests receive `403 Forbidden`. JSON APIs are not affected (browsers can't send cross-site JSON without a CORS preflight).

## `cors({ origin = '*', allowMethods, allowHeaders, exposeHeaders, maxAge, credentials })`

- Sets `Access-Control-Allow-Origin` from a string (`'*'` or exact match), a list, or a function `(origin, c) => string | null` (may be async). Credentials and expose headers are added if configured.
- **Every `OPTIONS` request is treated as a preflight**: it sets `Access-Control-Max-Age`, `Access-Control-Allow-Methods` (default `GET,HEAD,PUT,POST,DELETE,PATCH`; can be a function), and `Access-Control-Allow-Headers` (configured list, or **reflecting `Access-Control-Request-Headers`** when none is configured, plus `Vary: Access-Control-Request-Headers`), then returns `204` without calling downstream handlers.
- For non-wildcard origins, `Vary: Origin` is set/appended.
- Headers are written onto `c.res` before `next()`; the `res` setter carries them over to the final response.

## `secureHeaders(options)`

Sets a helmet-like default set of headers after `next()`: `Cross-Origin-Resource-Policy: same-origin`, `Cross-Origin-Opener-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Frame-Options: SAMEORIGIN`, `X-Permitted-Cross-Domain-Policies: none`, `X-XSS-Protection: 0`. `Cross-Origin-Embedder-Policy` is off by default. Each can be disabled (`false`) or overridden with a string. It also removes `X-Powered-By` by default.

Optional `contentSecurityPolicy`, `contentSecurityPolicyReportOnly`, `permissionsPolicy`, and `reportingEndpoints` build their headers from structured options. CSP directive values may include the `NONCE` helper (or a custom function); these callbacks run **before** `next()` so the nonce — 16 random bytes, base64, stored as `c.get('secureHeadersNonce')` and reused within the request — is available to handlers (e.g. to stamp `<script nonce>` or the JSX `StreamingContext`).

## `ipRestriction(getIP, { denyList, allowList }, onError?)`

- `getIP` is usually an adapter's `getConnInfo` (see [Runtime Adapters](../adapters/runtime-adapters.md#connection-info-getconninfo)) or a `(c) => string`.
- Rules can be `'*'`, exact IPv4/IPv6 addresses, CIDR ranges (validated prefix, IPv4-mapped IPv6 handled by converting to IPv4 semantics), or predicate functions. Invalid rules throw `TypeError` at setup.
- Evaluation order: **deny list first** (match → `onError` or `403`), then allow list (match → `next()`). If the allow list is empty, unmatched addresses pass; otherwise they are rejected.
- A missing or unparsable remote address is rejected with `403`.

## Tests

Each middleware has an `index.test.ts`; JWT internals are covered by `src/utils/jwt/jwt.test.ts` and `jwa.test.ts`, and the JWK middleware uses fixture keys in `src/middleware/jwk/keys.test.json`.
