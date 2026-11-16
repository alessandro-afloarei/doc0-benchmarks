---
title: "Authentication Middleware and JWT"
---
## Overview

Hono ships four authentication middleware: `basicAuth`, `bearerAuth`, `jwt` and `jwk`. All follow the same pattern as other middleware in [[Application and Request Dispatch]]: they read credentials from the request, call `await next()` when valid, and otherwise throw an `HTTPException` carrying a ready-made 401 (or 400) `Response`, which the app's error handler returns unchanged. `jwt` and `jwk` rely on the token code in `src/utils/jwt`, which is described here too. Everything else is in [[Built-in Middleware Catalogue]].

Sources: [src/middleware/basic-auth/index.ts:105-152](repo://src/middleware/basic-auth/index.ts#L105-L152), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

| Middleware | Credential | Checked against | On success |
| --- | --- | --- | --- |
| `basicAuth` | `Authorization: Basic ...` | Configured users or a `verifyUser` callback | Runs `onAuthSuccess`, then `next()` |
| `bearerAuth` | `Authorization: Bearer ...` (name and prefix configurable) | One token, a list of tokens, or `verifyToken` | `next()` |
| `jwt` | Bearer header or a cookie | Shared or public key and a required `alg` | Stores `jwtPayload` on the context |
| `jwk` | Bearer header or a cookie | Public keys and/or a remote JWKS | Stores `jwtPayload` on the context |

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/bearer-auth/index.ts:22-30](repo://src/middleware/bearer-auth/index.ts#L22-L30), [src/middleware/jwt/jwt.ts:53-61](repo://src/middleware/jwt/jwt.ts#L53-L61), [src/middleware/jwk/jwk.ts:48-64](repo://src/middleware/jwk/jwk.ts#L48-L64)

## Basic auth

`basicAuth(options, ...users)` needs either `username` and `password` or `verifyUser`; otherwise it throws at creation time. The realm defaults to `Secure Area` and the failure message to `Unauthorized`. When username and password are given they are put first in the users list.

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

Per request, `auth(request)` in `src/utils/basic-auth.ts` parses the `Authorization` header: it matches the `Basic` scheme, base64-decodes the credential, and splits it at the first `:`; any failure returns undefined.

Sources: [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

With `verifyUser`, the callback decides. Otherwise every configured user is compared with `timingSafeEqual` for both name and password, so the comparison does not depend on where the strings differ. `timingSafeEqual` hashes both sides (SHA-256 unless `hashFunction` is given) and compares both the hashes and the originals in constant time.

Sources: [src/middleware/basic-auth/index.ts:105-131](repo://src/middleware/basic-auth/index.ts#L105-L131), [src/utils/buffer.ts:44-63](repo://src/utils/buffer.ts#L44-L63)

A failed check builds a 401 with `WWW-Authenticate: Basic realm="..."` (quotes in the realm are escaped). `invalidUserMessage` can be a string, an object (sent as JSON) or a function of the context; the response is wrapped in an `HTTPException`.

Sources: [src/middleware/basic-auth/index.ts:132-151](repo://src/middleware/basic-auth/index.ts#L132-L151)

## Bearer auth

`bearerAuth` requires `token` or `verifyToken`. It reads `Authorization` (or `headerName`), and the prefix defaults to `Bearer`; an empty prefix means the whole header is the token. Three outcomes can follow:

Sources: [src/middleware/bearer-auth/index.ts:156-218](repo://src/middleware/bearer-auth/index.ts#L156-L218)

| Situation | Status | `WWW-Authenticate` default | Message default |
| --- | --- | --- | --- |
| No header | 401 | `Bearer realm=""` | `Unauthorized` |
| Wrong prefix or token characters outside `[A-Za-z0-9._~+/-]+=*` | 400 | `Bearer error="invalid_request"` | `Bad Request` |
| Token not accepted | 401 | `Bearer error="invalid_token"` | `Unauthorized` |

Sources: [src/middleware/bearer-auth/index.ts:12-14](repo://src/middleware/bearer-auth/index.ts#L12-L14), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120), [src/middleware/bearer-auth/index.ts:156-218](repo://src/middleware/bearer-auth/index.ts#L156-L218)

Validity is checked by `verifyToken(token, c)` if given, otherwise by `timingSafeEqual` against `token`, which may be a string or an array tried in turn. Each failure type has its own customisable header and message (`noAuthenticationHeader`, `invalidAuthenticationHeader`, `invalidToken`, with deprecated flat `...Message` options still honoured). `throwHTTPException` renders either a string body or a JSON one, as `basicAuth` does.

Sources: [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:193-217](repo://src/middleware/bearer-auth/index.ts#L193-L217)

## JWT middleware

`jwt({ secret, alg, cookie?, headerName?, verification? })` throws at creation if `secret` or `alg` is missing, or if `crypto.subtle.importKey` is not available in the runtime.

Sources: [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74)

On each request it looks for the token in this order. The `Authorization` header (or `headerName`) must be exactly `Bearer <token>` in two parts, otherwise 401 `invalid credentials structure`. Only when there is no header does it read the cookie named by `options.cookie`, which can be a plain key, or an object with a `key`, an optional `secret` (a signed cookie read with `getSignedCookie`) and `prefixOptions`. No token at all gives 401 `no authorization included in request`.

Sources: [src/middleware/jwt/jwt.ts:76-129](repo://src/middleware/jwt/jwt.ts#L76-L129)

The token goes to `Jwt.verify(token, secret, { alg, ...verification })`. Any exception becomes a 401 `HTTPException` whose `cause` is the original error and whose `WWW-Authenticate` header is `Bearer realm="<url>",error="invalid_token",...`. On success the payload is stored with `ctx.set('jwtPayload', payload)`. The module also re-exports `sign`, `verify`, `decode` and `verifyWithJwks` from `Jwt`.

Sources: [src/middleware/jwt/jwt.ts:131-178](repo://src/middleware/jwt/jwt.ts#L131-L178)

## JWK middleware

`jwk` has the same header-then-cookie token extraction, but verifies with public keys: `keys` (an array or a function of the context), `jwks_uri` (a string or function) or both, and `alg`, an array of allowed asymmetric algorithms. Setting `allow_anon` lets a request with no token pass through to `next()`. The second argument `init` is passed to the JWKS `fetch`.

Sources: [src/middleware/jwk/jwk.ts:48-131](repo://src/middleware/jwk/jwk.ts#L48-L131)

It calls `Jwt.verifyWithJwks` with the resolved keys and URI. If verification throws a plain `Error` (as opposed to a subclass such as a `Jwt...` error) the error is rethrown as is; this covers failures like an unreachable JWKS endpoint. Anything else becomes the same 401 as in `jwt`, and success stores `jwtPayload`.

Sources: [src/middleware/jwk/jwk.ts:133-167](repo://src/middleware/jwk/jwk.ts#L133-L167)

## The JWT utilities

### Signing and decoding

`src/utils/jwt` exposes `Jwt = { sign, verify, decode, verifyWithJwks }`.

Sources: [src/utils/jwt/index.ts:1-7](repo://src/utils/jwt/index.ts#L1-L7)

`sign(payload, privateKey, alg = 'HS256')` base64url-encodes a header (`alg`, `typ: 'JWT'`, plus `kid` when the key is a JWK object with an `alg`) and the payload, signs `header.payload` with `signing`, and appends the signature. `decode` splits a token into exactly three parts and JSON-parses header and payload, throwing `JwtTokenInvalid` otherwise.

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76), [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

### Verification order

`verify(token, publicKey, algOrOptions)` runs these checks and throws a distinct error class for each:

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188)

1. The algorithm is required (`JwtAlgorithmRequired`) and the token needs three parts (`JwtTokenInvalid`).
2. The header must be valid and its `alg` equal to the expected one (`JwtHeaderInvalid`, `JwtAlgorithmMismatch`).
3. Time claims, each checked only if present and enabled (all default to on): `nbf` not in the future, `exp` not passed, `iat` not in the future (`JwtTokenNotBefore`, `JwtTokenExpired`, `JwtTokenIssuedAt`).
4. `iss`, if requested, against a string or regular expression (`JwtTokenIssuer`), and `aud` against a string, array or regular expression (`JwtPayloadRequiresAud`, `JwtTokenAudience`).
5. Finally the signature is verified with `verifying`, throwing `JwtTokenSignatureMismatched` on failure.

Sources: [src/utils/jwt/jwt.ts:78-188](repo://src/utils/jwt/jwt.ts#L78-L188), [src/utils/jwt/types.ts:1-115](repo://src/utils/jwt/types.ts#L1-L115)

### Verifying with a JWKS

`verifyWithJwks` first decodes only the header. It requires a `kid`, rejects HS256, HS384 and HS512 outright (the comment says this prevents algorithm confusion attacks) and rejects any algorithm not in `allowedAlgorithms`. It then builds the key list from `keys` plus, if `jwks_uri` is set, the `keys` array from a fetch of that URL (non-OK responses and a missing or non-array `keys` throw plain errors). The key whose `kid` matches the header is used, its own `alg` must agree with the header's, and `verify` finishes the job.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

### Algorithms and keys

`AlgorithmTypes` lists HS, RS, PS and ES at 256/384/512 bits plus `EdDSA`; the types split them into symmetric (HS) and asymmetric sets.

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37)

`signing` and `verifying` in `jws.ts` map the algorithm name to Web Crypto parameters with `getKeyAlgorithm` (for example `RS256` is `RSASSA-PKCS1-v1_5` with SHA-256, `PS256` is `RSA-PSS` with salt length 32, `ES512` is ECDSA on `P-521`, and `EdDSA` is `Ed25519`; an unknown name throws `JwtAlgorithmNotImplemented`). The key may be a string, a JWK object or a `CryptoKey`. Strings are treated as PEM when they contain `PRIVATE` or `PUBLIC` (PKCS#8 or SPKI) and otherwise as raw secret bytes. Given a private PEM or key for verification, the code derives the public JWK first.

Sources: [src/utils/jwt/jws.ts:27-120](repo://src/utils/jwt/jws.ts#L27-L120), [src/utils/jwt/jws.ts:122-234](repo://src/utils/jwt/jws.ts#L122-L234)
