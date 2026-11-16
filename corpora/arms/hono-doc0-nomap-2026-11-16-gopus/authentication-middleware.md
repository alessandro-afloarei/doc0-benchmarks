---
title: "Authentication Middleware"
---
## Overview

Hono ships four middleware that check who is calling before a handler runs. Each reads a credential from the request, compares or verifies it, and either calls `next()` or throws an `HTTPException` that carries a ready `401` or `400` response with a `WWW-Authenticate` header. Because they throw rather than return, the app's error handler sees the failure; the default one answers with the exception's response, as [[Request Lifecycle and Error Handling]] describes.

Sources: [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152), [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/jwt/jwt.ts:119-152](repo://src/middleware/jwt/jwt.ts#L119-L152)

| Middleware | Import | Credential | Checked against |
| --- | --- | --- | --- |
| `basicAuth` | `hono/basic-auth` | `Authorization: Basic base64(user:pass)` | Fixed users, or a `verifyUser` function |
| `bearerAuth` | `hono/bearer-auth` | `Authorization: Bearer <token>` | Fixed tokens, or a `verifyToken` function |
| `jwt` | `hono/jwt` | A JWT in `Authorization` or a cookie | A secret or public key and one algorithm |
| `jwk` | `hono/jwk` | A JWT in `Authorization` or a cookie | A JSON Web Key Set, inline or fetched |

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/bearer-auth/index.ts:22-66](repo://src/middleware/bearer-auth/index.ts#L22-L66), [src/middleware/jwt/jwt.ts:53-61](repo://src/middleware/jwt/jwt.ts#L53-L61), [src/middleware/jwk/jwk.ts:48-64](repo://src/middleware/jwk/jwk.ts#L48-L64)

## basicAuth

`basicAuth(options, ...users)` takes either `username` and `password`, or a `verifyUser(username, password, c)` function; it throws at creation when neither is given. Extra users can be passed as further arguments.

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

```ts
app.use(
  '/auth/*',
  basicAuth({
    username: 'hono',
    password: 'ahotproject',
  })
)
```

Sources: [src/middleware/basic-auth/index.ts:50-57](repo://src/middleware/basic-auth/index.ts#L50-L57)

The credentials are parsed by `auth` in `utils/basic-auth`. The header must match `Basic <base64>` with the scheme in any case; the decoded text is split at the first `:`, so a password may contain colons. A header that does not decode is treated as missing.

Sources: [src/utils/basic-auth.ts:3-26](repo://src/utils/basic-auth.ts#L3-L26)

With fixed users, both the username and the password are compared with `timingSafeEqual`, which hashes both sides (SHA-256 unless `hashFunction` is given) and compares the hashes and the strings in constant time. Every listed user is tried. On success, `onAuthSuccess(c, username)` runs before `next()`, so it can store the user with `c.set`.

Sources: [src/middleware/basic-auth/index.ts:105-131](repo://src/middleware/basic-auth/index.ts#L105-L131), [src/utils/buffer.ts:44-63](repo://src/utils/buffer.ts#L44-L63)

On failure the response is `401` with `WWW-Authenticate: Basic realm="Secure Area"` (or the `realm` option, with quotes escaped). Its body is `invalidUserMessage`, `Unauthorized` by default; an object or a function's object result is sent as JSON.

Sources: [src/middleware/basic-auth/index.ts:93-99](repo://src/middleware/basic-auth/index.ts#L93-L99), [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152)

## bearerAuth

`bearerAuth(options)` takes `token`, a string or an array of strings, or a `verifyToken(token, c)` function. It reads `options.headerName`, `Authorization` by default, and expects the `prefix`, `Bearer` by default, compared case-insensitively and followed by a space. With `prefix: ''` the whole header is the token. The token must match the token68 character set `[A-Za-z0-9._~+/-]+=*`.

Sources: [src/middleware/bearer-auth/index.ts:12-14](repo://src/middleware/bearer-auth/index.ts#L12-L14), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120), [src/middleware/bearer-auth/index.ts:156-182](repo://src/middleware/bearer-auth/index.ts#L156-L182)

The middleware distinguishes three failures, each with its own status, default header and message option:

Sources: [src/middleware/bearer-auth/index.ts:156-218](repo://src/middleware/bearer-auth/index.ts#L156-L218)

| Failure | Status | Default `WWW-Authenticate` | Message options |
| --- | --- | --- | --- |
| No header | 401 | `Bearer realm=""` | `noAuthenticationHeader.message`, `noAuthenticationHeaderMessage` |
| Wrong prefix or bad characters | 400 | `Bearer error="invalid_request"` | `invalidAuthenticationHeader.message`, `invalidAuthenticationHeaderMessage` |
| Token does not match | 401 | `Bearer error="invalid_token"` | `invalidToken.message`, `invalidTokenMessage` |

Sources: [src/middleware/bearer-auth/index.ts:156-218](repo://src/middleware/bearer-auth/index.ts#L156-L218)

Each of the three option objects can also set `wwwAuthenticateHeader`, as a string, a function, or an object whose entries are written as `key="value"` pairs after the prefix. Fixed tokens are compared with `timingSafeEqual` like basic auth's passwords.

Sources: [src/middleware/bearer-auth/index.ts:17-20](repo://src/middleware/bearer-auth/index.ts#L17-L20), [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:194-206](repo://src/middleware/bearer-auth/index.ts#L194-L206)

## jwt

`jwt({ secret, alg, ... })` verifies a signed JWT and exposes its payload. `secret` and `alg` are required, and the middleware throws at creation when either is missing or when `crypto.subtle.importKey` is unavailable.

Sources: [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74)

The token is read from the header named by `headerName`, `Authorization` by default, which must be exactly two words with the first one `bearer` in any case. When that header is absent and a `cookie` option is set, the token is read from the cookie: a string names the cookie, and an object adds a `secret` for a signed cookie and `prefixOptions` for `__Secure-` or `__Host-` names, as [[Cookies]] describes.

Sources: [src/middleware/jwt/jwt.ts:76-117](repo://src/middleware/jwt/jwt.ts#L76-L117)

Verification is `Jwt.verify(token, secret, { alg, ...verification })`, with the claim options covered on [[JWT Utilities]]. Any error makes the middleware throw a 401 whose `cause` is that error. On success the payload is stored with `c.set('jwtPayload', payload)`; the module augments `ContextVariableMap`, so `c.get('jwtPayload')` is typed in any app that imports `hono/jwt`.

Sources: [src/middleware/jwt/jwt.ts:131-157](repo://src/middleware/jwt/jwt.ts#L131-L157), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

Every failure answers `401 Unauthorized` with `WWW-Authenticate: Bearer realm="<request URL>",error="...",error_description="..."`, where the error is `invalid_request` for a malformed or missing credential and `invalid_token` for a failed verification.

Sources: [src/middleware/jwt/jwt.ts:160-173](repo://src/middleware/jwt/jwt.ts#L160-L173)

`hono/jwt` also re-exports `sign`, `verify`, `decode` and `verifyWithJwks` from the JWT utilities, and `AlgorithmTypes`.

Sources: [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178), [src/middleware/jwt/index.ts:1-4](repo://src/middleware/jwt/index.ts#L1-L4)

## jwk

`jwk(options, init)` verifies JWTs signed with asymmetric keys from a key set. It needs `keys`, `jwks_uri` or both; each may be a value or a function of the Context, evaluated per request. `alg` lists the asymmetric algorithms accepted, and `init` is the `RequestInit` used when fetching `jwks_uri`.

Sources: [src/middleware/jwk/jwk.ts:48-73](repo://src/middleware/jwk/jwk.ts#L48-L73)

Reading the token, from the header or a cookie, works exactly as in `jwt`. Two behaviours differ:

Sources: [src/middleware/jwk/jwk.ts:118-131](repo://src/middleware/jwk/jwk.ts#L118-L131), [src/middleware/jwk/jwk.ts:133-167](repo://src/middleware/jwk/jwk.ts#L133-L167), [src/utils/jwt/jwt.ts:230-246](repo://src/utils/jwt/jwt.ts#L230-L246)

- With `allow_anon: true`, a request without a token continues to the handler unauthenticated instead of failing.
- When verification fails with a plain `Error` rather than one of the JWT error classes, which is what `verifyWithJwks` throws when the key set cannot be fetched or has no `keys` array, the error is re-thrown as it is and reaches the error handler as a server error instead of a 401.

Sources: [src/middleware/jwk/jwk.ts:118-131](repo://src/middleware/jwk/jwk.ts#L118-L131), [src/middleware/jwk/jwk.ts:133-167](repo://src/middleware/jwk/jwk.ts#L133-L167), [src/utils/jwt/jwt.ts:230-246](repo://src/utils/jwt/jwt.ts#L230-L246)

On success the payload is stored as `jwtPayload`, like `jwt`. Key selection by `kid` and fetching of `jwks_uri` happen in `verifyWithJwks`, covered on [[JWT Utilities]]; the middleware calls it on every request.

Sources: [src/middleware/jwk/jwk.ts:164-167](repo://src/middleware/jwk/jwk.ts#L164-L167)
