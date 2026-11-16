---
title: "Authentication Middleware"
---
## Overview

The authentication middleware in `src/middleware` decides who the caller is, and stops the chain with a `401` when the check fails. There are four: `basicAuth`, `bearerAuth`, `jwt` and `jwk`. They share one pattern: read a credential from the request, check it, store the result on the context, and call `next()`. They differ in where the credential comes from and how it is checked. Origin and access rules are in [[Security Middleware]], and the general rule for a middleware that throws is in [[Request Dispatch]].

Sources: [src/middleware/basic-auth/index.ts:80-98](repo://src/middleware/basic-auth/index.ts#L80-L98), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120), [src/middleware/jwt/jwt.ts:53-56](repo://src/middleware/jwt/jwt.ts#L53-L56), [src/middleware/jwk/jwk.ts:48-58](repo://src/middleware/jwk/jwk.ts#L48-L58)

## Basic auth

`basicAuth` takes either a `username` and `password` pair in its options, or a `verifyUser` function, plus any number of extra `{ username, password }` users. Calling it without one of those throws at setup. The realm defaults to `Secure Area`, and the failure message defaults to `Unauthorized`.

Sources: [src/middleware/basic-auth/index.ts:80-98](repo://src/middleware/basic-auth/index.ts#L80-L98)

The credentials come from the `Authorization` header through the shared `auth` helper. With the static list, each stored user is compared with `timingSafeEqual` on both the name and the password, in list order, until one pair matches. With `verifyUser`, the function receives the name, the password and the context and decides.

Sources: [src/middleware/basic-auth/index.ts:99-131](repo://src/middleware/basic-auth/index.ts#L99-L131), [src/utils/buffer.ts:76-76](repo://src/utils/buffer.ts#L76-L76)

On success, the optional `onAuthSuccess` callback runs with the user name and the chain continues. On failure the middleware throws an `HTTPException` with status `401`, a `WWW-Authenticate: Basic` header carrying the realm, and the message. A string message is sent as text, and any other value is sent as JSON.

Sources: [src/middleware/basic-auth/index.ts:133-151](repo://src/middleware/basic-auth/index.ts#L133-L151)

## Bearer auth

`bearerAuth` reads a token from a header, `Authorization` by default, and expects the form `Bearer <token>`. The `prefix` and `headerName` options change those names. The default prefix is `Bearer`; a `prefix` of the empty string means no prefix is expected. The token must match a fixed character set, `[A-Za-z0-9._~+/-]+=*`.

Sources: [src/middleware/bearer-auth/index.ts:9-14](repo://src/middleware/bearer-auth/index.ts#L9-L14), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120), [src/middleware/bearer-auth/index.ts:78-78](repo://src/middleware/bearer-auth/index.ts#L78-L78)

The token can be given as a string or a list in `token`, compared with `timingSafeEqual`, or checked by a `verifyToken` function. Each failure kind has its own message option: a missing header, a malformed header and an invalid token. The `noAuthenticationHeader`, `invalidAuthenticationHeader` and `invalidToken` options add a custom `WWW-Authenticate` value for each.

Sources: [src/middleware/bearer-auth/index.ts:24-60](repo://src/middleware/bearer-auth/index.ts#L24-L60), [src/middleware/bearer-auth/index.ts:121-153](repo://src/middleware/bearer-auth/index.ts#L121-L153)

## JWT

`jwt({ secret, alg })` reads the token from the `Authorization` header, or from a cookie when the header is absent and a `cookie` option is set. The cookie option is a name, or an object with a key and an optional signing `secret`. A header that is not `Bearer <token>` gives a `401`.

Sources: [src/middleware/jwt/jwt.ts:77-79](repo://src/middleware/jwt/jwt.ts#L77-L79), [src/middleware/jwt/jwt.ts:52-72](repo://src/middleware/jwt/jwt.ts#L52-L72)

The token is checked with `Jwt.verify` using the configured algorithm. A verification error produces a `401` whose `WWW-Authenticate` header is a `Bearer` challenge with `error` and `error_description` values. On success the decoded payload is stored in the context under `jwtPayload`, which handlers read with `c.get('jwtPayload')`.

Sources: [src/middleware/jwt/jwt.ts:86-104](repo://src/middleware/jwt/jwt.ts#L86-L104), [src/middleware/jwt/jwt.ts:154-156](repo://src/middleware/jwt/jwt.ts#L154-L156)

`verify`, `sign` and `decode` are the same functions exported for direct use, so the same JWT code can run outside the middleware. The signature and verification code is in `src/utils/jwt`.

Sources: [src/middleware/jwt/index.ts:1-5](repo://src/middleware/jwt/index.ts#L1-L5), [src/utils/jwt/jwt.ts:56-96](repo://src/utils/jwt/jwt.ts#L56-L96)

## JWK

`jwk` verifies tokens signed with asymmetric keys. Its keys come from a `keys` list, from a `jwks_uri` URL that is fetched, or from both. Setting either one is required, and the middleware throws at setup without `crypto.subtle`.

Sources: [src/middleware/jwk/jwk.ts:48-70](repo://src/middleware/jwk/jwk.ts#L48-L70)

The token is read in the same order as `jwt`: the header first, then the cookie. When no token is present, `allow_anon` lets the request continue without a payload, and otherwise the request is refused. A verified payload is stored as `jwtPayload` and the chain continues.

Sources: [src/middleware/jwk/jwk.ts:76-120](repo://src/middleware/jwk/jwk.ts#L76-L120), [src/middleware/jwk/jwk.ts:160-167](repo://src/middleware/jwk/jwk.ts#L160-L167)

## Choosing one

`basicAuth` is the choice for a fixed set of accounts or a `verifyUser` check, `bearerAuth` for tokens that the app can check itself, `jwt` when the app holds the signing secret, and `jwk` when the tokens are signed with asymmetric keys that are given directly or fetched from a `jwks_uri`. The two JWT middlewares leave the caller's claims in `c.get('jwtPayload')`, while `basicAuth` reports the user name only through its `onAuthSuccess` callback and stores nothing on the context.

Sources: [src/middleware/basic-auth/index.ts:80-98](repo://src/middleware/basic-auth/index.ts#L80-L98), [src/middleware/jwt/jwt.ts:154-156](repo://src/middleware/jwt/jwt.ts#L154-L156)
