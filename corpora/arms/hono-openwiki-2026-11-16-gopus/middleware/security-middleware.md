---
type: reference
title: Security and authentication middleware
description: How Hono's basic-auth, bearer-auth, jwt, jwk, cors, csrf, secure-headers and ip-restriction middleware work — credential extraction, timing-safe comparison, JWT/JWKS verification rules in utils/jwt, CORS preflight handling, Origin/Sec-Fetch-Site CSRF checks, default security headers and CSP nonces, and allow/deny IP matching — including their failure responses.
tags: [security, authentication, jwt, cors, csrf, secure-headers, ip-restriction]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
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
  - id: openwiki-source-77b3732d351aa8393874f438
    resource: repo://src/utils/jwt/jwa.ts
  - id: openwiki-source-79563bcc563e362b43cf45a2
    resource: repo://src/utils/jwt/jwt.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Security and authentication middleware

These middleware follow the general conventions described in [Built-in middleware](built-in-middleware.md). All of them reject a request in the same way: they **throw an `HTTPException` that carries a prebuilt `res`**. The default error handler returns that `res` unchanged (see [Request lifecycle](../architecture/request-lifecycle.md)), so status codes and `WWW-Authenticate` headers reach the client. A custom `app.onError` must check for `HTTPException` and call `err.getResponse()` to keep that behavior.

## Credential comparison

`timingSafeEqual(a, b, hashFunction = sha256)` lives in `src/utils/buffer.ts`. It hashes both inputs, then compares in constant time **both the hashes and the original strings**. It returns `false` if either hash is not a string. `basicAuth` and `bearerAuth` use it whenever they compare against configured credentials.

## Basic auth (`hono/basic-auth`)

```ts
basicAuth({ username, password, realm?, hashFunction?, invalidUserMessage?, onAuthSuccess? }, ...moreUsers)
basicAuth({ verifyUser: (user, pass, c) => boolean, ... })
```

- The options must include either `username` and `password`, or `verifyUser`. Without one of them, the factory throws.
- The middleware decodes the `Authorization: Basic` header (`src/utils/basic-auth.ts`).
  - Static users are compared with `timingSafeEqual`. When several users are configured, the request passes if any of them matches.
  - With `verifyUser`, the result of that callback decides.
  - On success it calls `onAuthSuccess(c, username)` and then `next()`.
- On failure it throws `HTTPException(401)`. The response carries `WWW-Authenticate: Basic realm="<realm>"`, where the realm defaults to `Secure Area` and quotes in it are escaped. The body is `invalidUserMessage`, which defaults to `Unauthorized`. It can be a string, an object (sent as JSON), or a function.

## Bearer auth (`hono/bearer-auth`)

```ts
bearerAuth({ token | token[] | verifyToken, realm?, prefix = 'Bearer', headerName = 'Authorization', hashFunction?, noAuthenticationHeader?, invalidAuthenticationHeader?, invalidToken? })
```

Failures map to three outcomes:

| Situation | Status | `WWW-Authenticate` |
| --- | --- | --- |
| Header missing | 401 | `Bearer realm="..."` |
| Wrong prefix, or a token that does not match the RFC 6750 token syntax | 400 | `Bearer error="invalid_request"` |
| Token mismatch (checked with `timingSafeEqual` against each configured token, or with `verifyToken(token, c)`) | 401 | `Bearer error="invalid_token"` |

Each outcome's message and header can be customized, either statically or with a function. The prefix comparison is case-insensitive. `prefix: ''` accepts the raw header value as the token.

## JWT (`hono/jwt`, `src/utils/jwt`)

`jwt({ secret, alg, cookie?, headerName = 'Authorization', verification? })`:

- **Construction-time checks.** It throws when `secret` or `alg` is missing, or when `crypto.subtle.importKey` is unavailable.
- **Token source.**
  - It first reads the configured header, which must be exactly `Bearer <token>`. Any other shape returns 401 with `invalid_request` and `invalid credentials structure`.
  - If the header is absent, it reads a cookie. The cookie can be plain, signed (via `getSignedCookie`), or carry the `__Secure-`/`__Host-` prefix (see [Helpers](../helpers/helpers.md)).
  - If neither yields a token, it returns 401 with `no authorization included in request`.
- **Verification.** It calls `Jwt.verify(token, secret, { alg, ...verification })`. On success the payload is stored as `c.get('jwtPayload')`. Any failure becomes 401 with `invalid_token`, and the original error is kept as `cause`.

`verify()` in `src/utils/jwt/jwt.ts` enforces these rules:

1. An algorithm is required.
2. The token must have exactly 3 parts.
3. The header must be valid, and `header.alg` **must equal the configured `alg`**. This blocks algorithm-confusion attacks.
4. `nbf`, `exp` and `iat` are checked by default against the current time in seconds. They must be finite numbers. Each check can be disabled through `verification`.
5. `iss` (a string or RegExp) and `aud` (a string, an array, or a RegExp) are checked only when configured. If configured, the claim must be present.
6. The signature is verified over `header.payload` with Web Crypto (`jws.ts`). Supported algorithms are HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA (`AlgorithmTypes` in `jwa.ts`).

`hono/jwt` also exports `sign`, `verify`, `decode` and `verifyWithJwks` for use outside the middleware.

## JWK / JWKS (`hono/jwk`)

`jwk({ keys? | jwks_uri?, alg: AsymmetricAlgorithm[], allow_anon?, cookie?, headerName?, verification? }, fetchInit?)` extracts the token the same way as `jwt`. With `allow_anon: true`, a request without a token passes straight to `next()`.

`verifyWithJwks` checks the token in this order:

1. The token must have a `kid` header.
2. Symmetric (`HS*`) algorithms are always rejected.
3. `header.alg` must be in the allowed `alg` list.
4. Keys come from the static `keys` and/or the JSON fetched from `jwks_uri`. Both options may be functions of `c`. A JWKS response that is not ok, or that has a missing or non-array `keys`, throws.
5. The key whose `kid` matches is selected. If that key declares an `alg`, it must equal the header's `alg`. The token is then verified with `verify()`.

## CORS (`hono/cors`)

`cors({ origin = '*', allowMethods = [GET, HEAD, PUT, POST, DELETE, PATCH], allowHeaders = [], exposeHeaders = [], maxAge?, credentials? })`:

- **`origin`** may be `'*'`, a single string (an exact match is echoed back), an array, or `(origin, c) => string | null` (which may be async). When nothing matches, no `Access-Control-Allow-Origin` header is set. `allowMethods` may also be a function.
- **Preflight (`OPTIONS`).** The middleware sets the following, then returns **204 without calling `next()`**, after removing `Content-Length` and `Content-Type`:
  - `Access-Control-Max-Age` and `Access-Control-Allow-Methods`;
  - `Access-Control-Allow-Headers`, taken from `allowHeaders`, or echoed from `Access-Control-Request-Headers` when `allowHeaders` is empty. In that case `Vary: Access-Control-Request-Headers` is also set;
  - `Vary: Origin` when `origin` is not `'*'`.
- **Actual requests.** Origin, credentials and expose headers are written to `c.res.headers` before `next()`. They survive the handler's response because of how `c.res` assignment merges headers (see [Context and HonoRequest](../concepts/context-and-request.md)). After `next()`, `Vary: Origin` is appended when `origin` is not `'*'`.

## CSRF (`hono/csrf`)

`csrf({ origin?, secFetchSite? })` blocks a request only when **all** of these are true:

- the method is not GET or HEAD;
- the `Content-Type` is a value a plain HTML form can send: `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`. A missing content type is treated as `text/plain`;
- `Sec-Fetch-Site` is missing or not allowed. By default only `same-origin` is allowed. The option accepts a value, an array, or a function;
- `Origin` is missing or not allowed. By default it must equal the request URL's origin. The option accepts a string, an array, or a function.

A blocked request gets `HTTPException(403)` with the body `Forbidden`. JSON APIs are not affected, because browsers must send a CORS preflight before a cross-origin JSON request.

## Secure headers (`hono/secure-headers`)

`secureHeaders(options)` sets its headers **after** `next()`. The defaults are:

- `Cross-Origin-Resource-Policy: same-origin`
- `Cross-Origin-Opener-Policy: same-origin`
- `Origin-Agent-Cluster: ?1`
- `Referrer-Policy: no-referrer`
- `Strict-Transport-Security: max-age=15552000; includeSubDomains`
- `X-Content-Type-Options: nosniff`
- `X-DNS-Prefetch-Control: off`
- `X-Download-Options: noopen`
- `X-Frame-Options: SAMEORIGIN`
- `X-Permitted-Cross-Domain-Policies: none`
- `X-XSS-Protection: 0`

`Cross-Origin-Embedder-Policy` (`require-corp`) is off by default. `X-Powered-By` is removed by default (`removePoweredBy: true`). Any of these options can be `false` to disable the header, or a string to override its value.

These headers are built from options only when explicitly configured:

- `contentSecurityPolicy` / `contentSecurityPolicyReportOnly`
- `permissionsPolicy`
- `reportingEndpoints` / `reportTo`

CSP directive values may be callbacks. Callbacks run **before** `next()`, so the `NONCE` helper can generate a 16-byte base64 nonce and store it in `c.var.secureHeadersNonce` for templates to embed. The JSX `StreamingContext` can pass the same nonce to Suspense scripts (see [JSX engine](../jsx/jsx.md)).

## IP restriction (`hono/ip-restriction`)

`ipRestriction(getIP, { denyList = [], allowList = [] }, onError?)`:

- `getIP` is usually a runtime's `getConnInfo` (see [Runtime adapters](../integrations/runtime-adapters.md)). It may also return a plain string.
- A rule can be an exact IPv4 or IPv6 address (IPv4-mapped IPv6 forms are matched too), a CIDR range, `'*'` (matches everything), or a predicate function. Parsing comes from `src/utils/ipaddr.ts`. An invalid static rule throws a `TypeError` when the middleware is created.
- Rules are evaluated in this order:
  1. No address, or an invalid one, gives 403.
  2. A deny-list match gives 403, or the result of `onError`.
  3. An allow-list match calls `next()`.
  4. If the allow list is empty, the request is allowed. Otherwise it gets 403, or the result of `onError`.

The 403 body is `Forbidden`.

## Tests

Each middleware's `index.test.ts` covers its success and failure cases. JWT internals are tested in `src/utils/jwt/jwt.test.ts` and `jwa.test.ts`. JWK uses `keys.test.json` fixtures, and its `jwks_uri` fetching is mocked with MSW.
