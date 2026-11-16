---
title: "Authentication and Security Middleware"
---
## Overview

These middleware sit in front of handlers and decide whether a request may proceed. They share conventions. Each is a factory returning a `MiddlewareHandler`; each validates its options when the factory is called, not per request; and when a check fails, most of them `throw new HTTPException(status, { res })` with a prepared `Response`, so the app's error handler can render it ([[Middleware Composition and Error Handling]]). Order matters: they run in the order `app.use` registered them ([[Application and Request Lifecycle]]).

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103), [src/middleware/body-limit/index.ts:50-59](repo://src/middleware/body-limit/index.ts#L50-L59), [src/middleware/csrf/index.ts:138-147](repo://src/middleware/csrf/index.ts#L138-L147)

| Middleware | Checks | Failure |
| --- | --- | --- |
| `basicAuth` | `Authorization: Basic` credentials | 401 with `WWW-Authenticate` |
| `bearerAuth` | `Authorization: Bearer` token | 401 or 400 |
| `jwt` | Signed JWT (symmetric secret) | 401 |
| `jwk` | Signed JWT checked against a JWK set | 401 |
| `csrf` | `Sec-Fetch-Site` and `Origin` on form-like writes | 403 |
| `cors` | Not a gate: sets CORS headers, answers preflight | 204 for `OPTIONS` |
| `secureHeaders` | Not a gate: adds security headers | none |
| `ipRestriction` | Client IP against allow and deny rules | 403 |
| `bodyLimit` | Request body size | 413 |

Sources: [src/middleware/basic-auth/index.ts:105-151](repo://src/middleware/basic-auth/index.ts#L105-L151), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220), [src/middleware/jwt/jwt.ts:76-152](repo://src/middleware/jwt/jwt.ts#L76-L152), [src/middleware/jwk/jwk.ts:75-162](repo://src/middleware/jwk/jwk.ts#L75-L162), [src/middleware/csrf/index.ts:138-147](repo://src/middleware/csrf/index.ts#L138-L147), [src/middleware/ip-restriction/index.ts:238-277](repo://src/middleware/ip-restriction/index.ts#L238-L277), [src/middleware/body-limit/index.ts:61-73](repo://src/middleware/body-limit/index.ts#L61-L73)

## Passwords and tokens: basicAuth and bearerAuth

`basicAuth(options, ...users)` needs either `username` and `password` in the options or a `verifyUser(username, password, c)` function; otherwise it throws at creation. It parses the request with `auth(c.req.raw)`. With `verifyUser` it awaits that function; otherwise it compares the supplied name and password to every configured user with `timingSafeEqual` (the comparison from `utils/buffer`, optionally with a custom `hashFunction`), checking both fields without short-circuiting between them. On success it optionally calls `onAuthSuccess(c, username)` and then `next()`. On failure it throws an `HTTPException(401)` whose response has `WWW-Authenticate: Basic realm="…"` (default realm `Secure Area`) and the `invalidUserMessage`, which can be a string, an object (sent as JSON) or a function of the context.

Sources: [src/middleware/basic-auth/index.ts:80-153](repo://src/middleware/basic-auth/index.ts#L80-L153)

`bearerAuth` takes a `token` (string or array) or a `verifyToken(token, c)` function. It reads `Authorization` (or `headerName`) and distinguishes three failures, each with its own status and `WWW-Authenticate` value that can be overridden:

Sources: [src/middleware/bearer-auth/index.ts:104-154](repo://src/middleware/bearer-auth/index.ts#L104-L154)

| Situation | Status | Default `WWW-Authenticate` |
| --- | --- | --- |
| Header missing | 401 | `Bearer realm=""` |
| Header does not start with the prefix and a space, or the token has characters outside `[A-Za-z0-9._~+/-]+=*` | 400 | `Bearer error="invalid_request"` |
| Token does not match | 401 | `Bearer error="invalid_token"` |

Sources: [src/middleware/bearer-auth/index.ts:104-220](repo://src/middleware/bearer-auth/index.ts#L104-L220)

The prefix defaults to `Bearer`, may be changed, and may be set to the empty string, in which case the whole header value is the token. Matching of the prefix is case-insensitive, and token comparison uses `timingSafeEqual`.

Sources: [src/middleware/bearer-auth/index.ts:113-120](repo://src/middleware/bearer-auth/index.ts#L113-L120), [src/middleware/bearer-auth/index.ts:172-206](repo://src/middleware/bearer-auth/index.ts#L172-L206)

## JSON Web Tokens: jwt and jwk

Both take a token from `Authorization: Bearer <token>` (or another `headerName`) or, if the header is absent, from a cookie: a plain cookie, or a signed cookie when `cookie.secret` is given, optionally with cookie prefix options. A header that is not exactly two parts with a `bearer` first part gives `401` with `error="invalid_request"`; a missing token gives `401` too. The verified payload is stored with `ctx.set('jwtPayload', payload)`, so handlers read it with `c.get('jwtPayload')` (typed by `JwtVariables`).

Sources: [src/middleware/jwt/jwt.ts:76-128](repo://src/middleware/jwt/jwt.ts#L76-L128), [src/middleware/jwt/jwt.ts:154-156](repo://src/middleware/jwt/jwt.ts#L154-L156), [src/middleware/jwt/jwt.ts:160-173](repo://src/middleware/jwt/jwt.ts#L160-L173)

`jwt({ secret, alg, … })` requires `secret` and `alg` and the Web Crypto `crypto.subtle.importKey`, and verifies with `Jwt.verify(token, secret, { alg, ...verification })`. A verification failure becomes a `401` HTTPException with `error="invalid_token"` and the original error as `cause`. The module re-exports `sign`, `verify`, `decode` and `verifyWithJwks` from `utils/jwt`.

Sources: [src/middleware/jwt/jwt.ts:53-75](repo://src/middleware/jwt/jwt.ts#L53-L75), [src/middleware/jwt/jwt.ts:131-152](repo://src/middleware/jwt/jwt.ts#L131-L152), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

`jwk({ keys | jwks_uri, alg, … })` is for asymmetric keys published as a JWK set. `keys` and `jwks_uri` may be functions of the context; at least one is required. With `allow_anon: true` a request without a token passes through. Verification goes through `Jwt.verifyWithJwks`, which requires a `kid` in the token header, refuses symmetric algorithms (`HS256`, `HS384`, `HS512`) and algorithms not in `alg`, and fetches the JWKS from `jwks_uri` when given. An error that is a bare `Error` (such as a failed JWKS fetch) is rethrown as is; other verification failures become `401`.

Sources: [src/middleware/jwk/jwk.ts:48-74](repo://src/middleware/jwk/jwk.ts#L48-L74), [src/middleware/jwk/jwk.ts:118-162](repo://src/middleware/jwk/jwk.ts#L118-L162), [src/utils/jwt/jwt.ts:190-260](repo://src/utils/jwt/jwt.ts#L190-L260)

The shared `Jwt.verify` in `src/utils/jwt/jwt.ts` checks the algorithm, then `nbf`, `exp` and `iat` (each only if present and enabled in the verification options), the issuer `iss` (string or `RegExp`) and the audience `aud` (string, array or `RegExp`) if requested, and finally the signature, throwing a distinct error class for each failure.

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188)

## Cross-site protection: csrf and cors

`csrf` rejects requests that look like a cross-site form post. It only inspects requests that are not `GET` or `HEAD` and whose `Content-Type` is `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` (or missing, treated as `text/plain`). For those it allows the request if either `Sec-Fetch-Site` is allowed (default: `same-origin`) or `Origin` is allowed (default: the origin of the request URL); a missing header counts as not allowed. If neither passes, it throws a `403 Forbidden`. `origin` and `secFetchSite` options accept a value, a list or a function.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151)

`cors(options)` defaults to origin `*` and the methods `GET, HEAD, PUT, POST, DELETE, PATCH`. On every request it sets `Access-Control-Allow-Origin` if the origin resolver (a string, a list or a function) returns a value, plus `Access-Control-Allow-Credentials` and `Access-Control-Expose-Headers` when configured. For an `OPTIONS` preflight it adds `Vary: Origin` (for non-wildcard origins), `Max-Age`, `Allow-Methods`, and `Allow-Headers` (from the option or by echoing `Access-Control-Request-Headers`), removes `Content-Length` and `Content-Type`, and returns `204 No Content` without calling the handler. For other methods it calls `next()` and then appends `Vary: Origin` when the origin is not `*`.

Sources: [src/middleware/cors/index.ts:63-157](repo://src/middleware/cors/index.ts#L63-L157)

## Response hardening: secureHeaders

`secureHeaders(options)` computes its header list once at creation and sets it on `c.res` after `next()`. The defaults come from `DEFAULT_OPTIONS` and `HEADERS_MAP`: for example `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=15552000; includeSubDomains`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`; `Cross-Origin-Embedder-Policy` is off by default. Each option can be `false` to remove, `true` for the default or a string to override. `removePoweredBy` (default on) deletes `X-Powered-By`.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229), [src/middleware/secure-headers/secure-headers.ts:231-238](repo://src/middleware/secure-headers/secure-headers.ts#L231-L238)

Content Security Policy options are written as camelCase directive names with arrays of values, converted to kebab-case. A value may be a function `(ctx, directive) => string`; because those need the request, the header list is recomputed per request before `next()` so a function can call `ctx.set`. The exported `NONCE` is such a function: it creates (or reuses) a 16-byte base64 nonce stored under `secureHeadersNonce` and returns `'nonce-…'`, so templates can read it from `c.get('secureHeadersNonce')`. `permissionsPolicy`, `reportingEndpoints` and `reportTo` produce the `Permissions-Policy`, `Reporting-Endpoints` and `Report-To` headers.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-223](repo://src/middleware/secure-headers/secure-headers.ts#L215-L223), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288), [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328)

## Limiting access: ipRestriction and bodyLimit

`ipRestriction(getIP, { denyList, allowList }, onError?)` takes a function that returns the client address: a `getConnInfo` from an adapter ([[Runtime Adapters]]) or a function returning a string. Rules are exact IPv4 or IPv6 addresses, CIDR ranges such as `192.168.0.0/16`, or custom functions, compiled once into matchers; a malformed rule throws a `TypeError` at creation. Per request, a deny match blocks first; an allow match passes; if there are allow rules and none matched, it blocks; with no allow rules, anything not denied passes. A missing address, or one that fails to parse, blocks with `403 Forbidden`. `onError` can supply the response instead of the default exception.

Sources: [src/middleware/ip-restriction/index.ts:23-63](repo://src/middleware/ip-restriction/index.ts#L23-L63), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

`bodyLimit({ maxSize, onError })` has three paths. A request without a body proceeds. A request with only `Content-Length` is compared to `maxSize` directly. When `Transfer-Encoding` is present or no length is known, the body is read chunk by chunk, counting bytes and failing as soon as the total exceeds `maxSize`; the buffered chunks are then wrapped in a new `ReadableStream` and installed as `c.req.raw` so the handler can still read the body. The default failure is `413 Payload Too Large`.

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111)
