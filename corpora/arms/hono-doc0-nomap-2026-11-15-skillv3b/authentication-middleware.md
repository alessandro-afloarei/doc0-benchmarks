---
title: "Authentication Middleware"
---
## Overview

Hono ships four authentication middleware, each a factory that validates its options once and returns a middleware. They share a failure model: a request that does not authenticate is stopped by throwing an `HTTPException` whose `res` is a complete 401 (or 400) response with a `WWW-Authenticate` header, so the default error handler returns it unchanged and a custom `onError` can still recognise it (see [[Request Lifecycle and Middleware Composition]]). A request that authenticates continues with `await next()`.

Sources: [src/middleware/basic-auth/index.ts:132-151](repo://src/middleware/basic-auth/index.ts#L132-L151), [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/jwt/jwt.ts:160-173](repo://src/middleware/jwt/jwt.ts#L160-L173)

| Import | Checks | Sets on the context | Choose it when |
| --- | --- | --- | --- |
| `hono/basic-auth` | `Authorization: Basic` username and password | nothing (use `onAuthSuccess`) | A small internal tool or admin page with fixed credentials |
| `hono/bearer-auth` | `Authorization: Bearer` against static tokens or a callback | nothing | API keys or opaque tokens you can compare or look up |
| `hono/jwt` | A JWT signed with a shared secret or a known key | `jwtPayload` | Tokens you issue yourself |
| `hono/jwk` | A JWT verified against a JSON Web Key Set | `jwtPayload` | Tokens from an external identity provider |

Sources: [src/middleware/basic-auth/index.ts:80-105](repo://src/middleware/basic-auth/index.ts#L80-L105), [src/middleware/bearer-auth/index.ts:104-121](repo://src/middleware/bearer-auth/index.ts#L104-L121), [src/middleware/jwt/jwt.ts:53-76](repo://src/middleware/jwt/jwt.ts#L53-L76), [src/middleware/jwk/jwk.ts:48-75](repo://src/middleware/jwk/jwk.ts#L48-L75)

## Basic auth

`basicAuth(options, ...moreUsers)` takes either `username` and `password` (plus any number of extra users as further arguments) or a `verifyUser(username, password, c)` callback. The credentials are parsed by `auth()` in `utils/basic-auth`, which matches `Basic <base64>` case-insensitively, decodes it as UTF-8 and splits on the first colon; anything malformed counts as no credentials.

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103), [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

Static users are compared with `timingSafeEqual`, which hashes both strings (SHA-256 by default, or `hashFunction`) and compares hashes and originals in constant time, so response timing does not reveal how much of a password matched. On success `onAuthSuccess(c, username)` runs before `next()`, which is where to `c.set` the user. On failure the response is 401 with `WWW-Authenticate: Basic realm="Secure Area"` (or the configured `realm`) and the body `invalidUserMessage`, which may be a string, an object sent as JSON, or a function of the context.

Sources: [src/middleware/basic-auth/index.ts:105-152](repo://src/middleware/basic-auth/index.ts#L105-L152), [src/utils/buffer.ts:44-63](repo://src/utils/buffer.ts#L44-L63)

## Bearer auth

`bearerAuth` reads the token from `Authorization` (or `headerName`), expecting the `prefix` (default `Bearer`, case-insensitive) followed by a space; an empty `prefix` takes the whole header. Three failures are distinguished, each with its own customisable `message` and `wwwAuthenticateHeader`:

Sources: [src/middleware/bearer-auth/index.ts:156-182](repo://src/middleware/bearer-auth/index.ts#L156-L182)

| Case | Status | Default `WWW-Authenticate` |
| --- | --- | --- |
| No header (`noAuthenticationHeader`) | 401 | `Bearer realm=""` |
| Wrong prefix or a token outside the RFC 6750 character set (`invalidAuthenticationHeader`) | 400 | `Bearer error="invalid_request"` |
| Token does not match (`invalidToken`) | 401 | `Bearer error="invalid_token"` |

Sources: [src/middleware/bearer-auth/index.ts:12-20](repo://src/middleware/bearer-auth/index.ts#L12-L20), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220)

The token is accepted when `verifyToken(token, c)` returns true, or when it equals `token` or any entry of a `token` array under `timingSafeEqual`. A `wwwAuthenticateHeader` given as an object is serialised as `key="value"` pairs after the prefix. The older `noAuthenticationHeaderMessage`, `invalidAuthenticationHeaderMessage` and `invalidTokenMessage` options still work but are deprecated.

Sources: [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:194-216](repo://src/middleware/bearer-auth/index.ts#L194-L216)

## JWT

`jwt({ secret, alg })` requires both options and a runtime with `crypto.subtle.importKey`, and throws at creation otherwise. Per request it finds the token in `Authorization: Bearer <token>` (or `headerName`); a header in another shape is a 401 `invalid_request`. When there is no header and `cookie` is set, it reads the cookie instead: a plain name, or `{ key, secret, prefixOptions }` for a signed or `__Secure-`/`__Host-` prefixed cookie (see [[Cookies]]).

Sources: [src/middleware/jwt/jwt.ts:53-117](repo://src/middleware/jwt/jwt.ts#L53-L117)

The token is checked with `Jwt.verify(token, secret, { alg, ...verification })`, described on [[JWT Utilities]]. Any verification error becomes a 401 `invalid_token` response, with the original error as the exception's `cause`. A valid payload is stored as `c.get('jwtPayload')`; the module augments `ContextVariableMap` so that key is typed in every app, and `JwtVariables<T>` gives it a specific payload type.

Sources: [src/middleware/jwt/jwt.ts:119-158](repo://src/middleware/jwt/jwt.ts#L119-L158), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

`hono/jwt` also re-exports `sign`, `verify`, `decode` and `verifyWithJwks`, so issuing a token at login needs no other import.

Sources: [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

## JWK

`jwk({ keys, jwks_uri, alg })` verifies tokens signed with asymmetric keys published as a JWK Set. `keys` is a list of keys or a function of the context; `jwks_uri` is a URL or a function returning one, fetched per request with the optional `init`; when both are given the fetched keys are merged with `keys`. `alg` lists the asymmetric algorithms accepted, so a token cannot downgrade to a weaker one. Token lookup in the header and cookie is the same as `jwt`.

Sources: [src/middleware/jwk/jwk.ts:48-116](repo://src/middleware/jwk/jwk.ts#L48-L116)

Two behaviours differ from `jwt`. With `allow_anon: true` a request without a token continues unauthenticated, so a route can serve both visitors and signed-in users and check `c.get('jwtPayload')`. And an error whose class is plain `Error` (for example a failure fetching the key set) is re-thrown instead of becoming a 401, so infrastructure problems surface as 500s rather than as rejected tokens.

Sources: [src/middleware/jwk/jwk.ts:118-167](repo://src/middleware/jwk/jwk.ts#L118-L167)

## Combining them

Authentication middleware compose with `hono/combine`: `some(bearerAuth({ token }), jwt({ secret, alg: 'HS256' }))` accepts either credential, and `except('/public/*', jwt(...))` leaves public paths open. [[Writing Middleware and Factories]] explains how those helpers handle the thrown 401s.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)
