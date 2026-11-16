---
title: "Authentication Middleware"
---
## Overview

Hono has four built-in middleware that decide whether a request is authenticated: `basicAuth`, `bearerAuth`, `jwt` and `jwk`. Each is a factory that validates its options once, when the middleware is created, and returns a middleware that either calls `next()` or throws an `HTTPException` carrying a ready `401` (or `400`) response with a `WWW-Authenticate` header. The default error handler returns that response unchanged ([[Request Lifecycle and Middleware Composition]]).

Sources: [src/middleware/basic-auth/index.ts:80-153](repo://src/middleware/basic-auth/index.ts#L80-L153), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

| Middleware | Credential | Check | On success |
| --- | --- | --- | --- |
| `basicAuth` | `Authorization: Basic ...` | fixed users or `verifyUser` | optional `onAuthSuccess` |
| `bearerAuth` | `Authorization: Bearer ...` (configurable) | fixed token(s) or `verifyToken` | nothing stored |
| `jwt` | bearer header or cookie | `Jwt.verify` with a secret and one algorithm | `c.set('jwtPayload', payload)` |
| `jwk` | bearer header or cookie | `Jwt.verifyWithJwks` against public keys | `c.set('jwtPayload', payload)` |

Sources: [src/middleware/basic-auth/index.ts:105-131](repo://src/middleware/basic-auth/index.ts#L105-L131), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220), [src/middleware/jwt/jwt.ts:76-157](repo://src/middleware/jwt/jwt.ts#L76-L157), [src/middleware/jwk/jwk.ts:75-167](repo://src/middleware/jwk/jwk.ts#L75-L167)

## Constant-time comparison

`basicAuth` and `bearerAuth` compare secrets with `timingSafeEqual(a, b, hashFunction)`. For strings it hashes both sides (SHA-256 by default, or the `hashFunction` option), then compares the hashes and the original strings with a loop that always runs over the longer length and accumulates differences with XOR, so the time taken does not reveal where the strings differ. A hash function that returns `null` or a non-string makes the comparison fail.

Sources: [src/utils/buffer.ts:29-96](repo://src/utils/buffer.ts#L29-L96)

## basicAuth

`basicAuth(options, ...users)` accepts either `username` and `password` (plus any number of extra users as further arguments) or a `verifyUser(username, password, c)` callback; creating it with neither throws. `realm` defaults to `Secure Area` and `invalidUserMessage` to `Unauthorized`.

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

The `auth` utility extracts credentials from the `Authorization` header with a case-insensitive `Basic` scheme, base64-decodes them as UTF-8, and splits at the first colon; malformed input yields no user. With `verifyUser` the callback decides. Otherwise every configured user is tried, comparing username and password in parallel with `timingSafeEqual`. On success `onAuthSuccess(c, username)` runs before `next()`.

Sources: [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26), [src/middleware/basic-auth/index.ts:105-131](repo://src/middleware/basic-auth/index.ts#L105-L131)

On failure it throws `HTTPException(401)` with `WWW-Authenticate: Basic realm="..."` (quotes in the realm escaped). `invalidUserMessage` may be a string, an object sent as JSON, or a function of the context returning either.

Sources: [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152)

## bearerAuth

`bearerAuth(options)` accepts `token` (one string or an array) or `verifyToken(token, c)`, plus `realm`, `prefix` (default `Bearer`, may be empty), `headerName` (default `Authorization`) and `hashFunction`. The token itself must match `[A-Za-z0-9._~+/-]+=*`.

Sources: [src/middleware/bearer-auth/index.ts:12-66](repo://src/middleware/bearer-auth/index.ts#L12-L66), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120)

| Situation | Status | `WWW-Authenticate` |
| --- | --- | --- |
| header missing | 401 | `Bearer realm="..."` |
| prefix missing, or token has invalid characters | 400 | `Bearer error="invalid_request"` |
| token does not match | 401 | `Bearer error="invalid_token"` |

Sources: [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220)

The prefix match is case-insensitive and requires a space after it. Each situation's body and header can be customised with `noAuthenticationHeader`, `invalidAuthenticationHeader` and `invalidToken` (each `{ wwwAuthenticateHeader, message }`, where a header object is rendered as `key="value"` pairs) or the deprecated `...Message` options.

Sources: [src/middleware/bearer-auth/index.ts:122-180](repo://src/middleware/bearer-auth/index.ts#L122-L180)

## jwt

### Options and token lookup

`jwt({ secret, alg, cookie, headerName, verification })` requires `secret` and `alg` and checks that `crypto.subtle.importKey` exists, throwing at creation otherwise. The middleware reads the token from the header (default `Authorization`), which must be exactly two whitespace-separated parts starting with `Bearer`. Without a header it falls back to the `cookie` option: a cookie name, or `{ key, secret, prefixOptions }` to read a signed or `__Secure-`/`__Host-` prefixed cookie through the [[Cookies]] helper.

Sources: [src/middleware/jwt/jwt.ts:53-117](repo://src/middleware/jwt/jwt.ts#L53-L117)

### Verification

`Jwt.verify(token, secret, { alg, ...verification })` rejects a token that is not three parts, whose header `alg` differs from the configured one, or whose claims fail: `nbf` in the future, `exp` reached, `iat` in the future (each checked unless disabled), `iss` not equal to (or not matching) the expected issuer, or `aud` not among the allowed audiences. Only then is the signature verified.

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188)

The verified payload is stored as `jwtPayload`, typed through `JwtVariables`. Every failure throws `HTTPException(401)` with a response whose `WWW-Authenticate` is `Bearer realm="<url>",error="...",error_description="..."`; a verification error is attached as the exception's `cause`. The module re-exports `sign`, `verify`, `decode` and `verifyWithJwks` for use outside middleware.

Sources: [src/middleware/jwt/jwt.ts:17-20](repo://src/middleware/jwt/jwt.ts#L17-L20), [src/middleware/jwt/jwt.ts:119-178](repo://src/middleware/jwt/jwt.ts#L119-L178)

## jwk

`jwk({ keys, jwks_uri, alg, allow_anon, cookie, headerName, verification }, init)` verifies tokens signed with asymmetric keys. It requires `keys` or `jwks_uri` (either may be a function of the context) and a list of allowed asymmetric algorithms. Token lookup is the same as `jwt`, except that with `allow_anon` a request without a token proceeds to `next()`.

Sources: [src/middleware/jwk/jwk.ts:48-121](repo://src/middleware/jwk/jwk.ts#L48-L121)

`verifyWithJwks` decodes the header and requires a `kid`. It rejects `HS256`, `HS384` and `HS512` outright, as the code comment says, to prevent algorithm confusion, and rejects any algorithm not in the allowed list. It fetches `jwks_uri` with the `init` options and appends its `keys` to the static ones, picks the key whose `kid` matches, checks that the key's own `alg` (if present) equals the header's, and then calls `verify` with that key.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262), [src/middleware/jwk/jwk.ts:133-143](repo://src/middleware/jwk/jwk.ts#L133-L143)

Token errors become the same `401` response as `jwt`. A plain `Error` (for example a failed JWKS fetch or a malformed JWKS response) is re-thrown as-is instead, so it reaches the app's error handler as a server error rather than an authentication failure.

Sources: [src/middleware/jwk/jwk.ts:144-168](repo://src/middleware/jwk/jwk.ts#L144-L168), [src/utils/jwt/jwt.ts:230-246](repo://src/utils/jwt/jwt.ts#L230-L246)
