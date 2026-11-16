---
title: "JWT and JWK"
---
## Overview

Hono signs and verifies JSON Web Tokens with the Web Crypto API only, so the same code works on every runtime that provides `crypto.subtle`. The token functions live in `utils/jwt` and are exported as `Jwt` from `hono/utils/jwt` and as `sign`, `verify`, `decode` and `verifyWithJwks` from `hono/jwt`. Two middleware use them: `jwt` verifies tokens against one secret or key, and `jwk` verifies them against a set of JSON Web Keys, fetched from a JWKS URL if needed.

Sources: [src/utils/jwt/index.ts:1-7](repo://src/utils/jwt/index.ts#L1-L7), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178), [src/utils/jwt/jws.ts:29-48](repo://src/utils/jwt/jws.ts#L29-L48)

Both middleware put the verified payload in the Context as `jwtPayload`. The module augments `ContextVariableMap` with it, so `c.get('jwtPayload')` is typed in every app that imports `hono/jwt` ([[Context and Responses]]). Basic and bearer-token checks are on [[Authentication Middleware]].

Sources: [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9), [src/middleware/jwt/jwt.ts:154-154](repo://src/middleware/jwt/jwt.ts#L154-L154)

## Signing

`sign(payload, privateKey, alg = 'HS256')` builds the header and payload as JSON, base64url-encodes both without padding, signs `header.payload`, and appends the encoded signature. When the key is a JSON Web Key object with an `alg`, that algorithm replaces the argument and the key's `kid` is written into the header.

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76)

```ts
import { sign } from 'hono/jwt'

const token = await sign(
  { sub: 'user123', exp: Math.floor(Date.now() / 1000) + 60 * 5 },
  'my-secret'
)
```

Sources: [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76)

## Keys and algorithms

A `SignatureKey` is a string, a JSON Web Key or a `CryptoKey`. `importPrivateKey` and `importPublicKey` turn it into a `CryptoKey` with the usage they need:

Sources: [src/utils/jwt/jws.ts:23-120](repo://src/utils/jwt/jws.ts#L23-L120)

| Key | Imported as |
| --- | --- |
| `CryptoKey` | Used as is; signing needs `private` or `secret`. For verifying, a private key is exported to a public JWK first |
| JSON Web Key object | `jwk` |
| String containing `PRIVATE` | PEM, `pkcs8`; for verifying, its public part is derived |
| String containing `PUBLIC` | PEM, `spki` (verify only) |
| Any other string | `raw` bytes, the HMAC secret |

Sources: [src/utils/jwt/jws.ts:23-120](repo://src/utils/jwt/jws.ts#L23-L120)

`getKeyAlgorithm` maps each JWA name to Web Crypto parameters: `HS*` to HMAC, `RS*` to RSASSA-PKCS1-v1_5, `PS*` to RSA-PSS with the salt length matching the hash, `ES*` to ECDSA on P-256, P-384 and P-521, and `EdDSA` to Ed25519. Any other name throws `JwtAlgorithmNotImplemented`. A comment notes that Ed25519 support depends on the runtime.

Sources: [src/utils/jwt/jws.ts:122-224](repo://src/utils/jwt/jws.ts#L122-L224), [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37)

`isCryptoKey` checks against `crypto.webcrypto.CryptoKey` on Node.js, where a comment says `CryptoKey` is not global in Node v18, and against the global `CryptoKey` elsewhere.

Sources: [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

## Verifying

`verify(token, publicKey, algOrOptions)` requires the algorithm; without it, it throws `JwtAlgorithmRequired`, so a token cannot choose its own algorithm. The checks run in this order, each throwing its own error class from `utils/jwt/types`:

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188)

1. The token has three parts, and its header decodes to a known `alg` with `typ` absent or `JWT` (`JwtTokenInvalid`, `JwtHeaderInvalid`).
2. The header's `alg` equals the expected one (`JwtAlgorithmMismatch`).
3. `nbf` is not in the future, `exp` is in the future, and `iat` is not in the future. Each claim is checked when present and must be a finite number (`JwtTokenNotBefore`, `JwtTokenExpired`, `JwtTokenIssuedAt`).
4. When `iss` is given as a string or `RegExp`, the payload's issuer must match (`JwtTokenIssuer`).
5. When `aud` is given as a string, an array or a `RegExp`, one of the payload's audiences must match (`JwtPayloadRequiresAud`, `JwtTokenAudience`).
6. The signature verifies over `header.payload` (`JwtTokenSignatureMismatched`).

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188)

The time checks can be turned off one by one with `nbf: false`, `exp: false` or `iat: false` in the options. All of them use the current time in whole seconds.

Sources: [src/utils/jwt/jwt.ts:78-94](repo://src/utils/jwt/jwt.ts#L78-L94), [src/utils/jwt/jwt.ts:105-145](repo://src/utils/jwt/jwt.ts#L105-L145)

`decode(token)` returns `{ header, payload }` without verifying anything, and `decodeHeader(token)` only the header. Both throw `JwtTokenInvalid` for a token that is not three parts or whose parts are not base64url JSON.

Sources: [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

## Verifying with a key set

`verifyWithJwks(token, { keys, jwks_uri, verification, allowedAlgorithms }, init?)` picks the key by the token's `kid`:

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

1. The header must be valid and carry a `kid` (`JwtHeaderRequiresKid`).
2. `HS256`, `HS384` and `HS512` are refused with `JwtSymmetricAlgorithmNotAllowed`; a comment says this prevents algorithm confusion attacks. The header's `alg` must also be in `allowedAlgorithms`.
3. Keys come from `keys`, plus the `keys` array of the JSON fetched from `jwks_uri` with `init`. A failed fetch or a response without a `keys` array throws a plain `Error`.
4. The key with the matching `kid` is used; none matching throws `JwtTokenInvalid`, and a key whose own `alg` differs from the header's throws `JwtAlgorithmMismatch`.
5. `verify` runs with the header's algorithm and the `verification` options.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

## The jwt middleware

```ts
import { jwt } from 'hono/jwt'

app.use('/auth/*', jwt({ secret: 'my-secret', alg: 'HS256' }))

app.get('/auth/page', (c) => c.json(c.get('jwtPayload')))
```

Sources: [src/middleware/jwt/jwt.ts:53-158](repo://src/middleware/jwt/jwt.ts#L53-L158)

`jwt(options)` requires `secret` and `alg`, and throws at setup without them or without `crypto.subtle.importKey`.

Sources: [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74)

| Option | Effect |
| --- | --- |
| `secret` | The `SignatureKey` to verify with |
| `alg` | The required algorithm |
| `headerName` | Header to read instead of `Authorization` |
| `cookie` | A cookie name, or `{ key, secret?, prefixOptions? }` to read a signed or prefixed cookie |
| `verification` | `iss`, `aud`, `nbf`, `exp` and `iat` options for `verify` |

Sources: [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74)

The token comes from the header when it is present; it must be exactly two whitespace-separated parts starting with `Bearer` (any case). Only when the header is absent is the cookie read, through `getCookie` or `getSignedCookie` ([[Cookies]]).

Sources: [src/middleware/jwt/jwt.ts:76-117](repo://src/middleware/jwt/jwt.ts#L76-L117)

Every failure throws `HTTPException(401)` with a response whose `WWW-Authenticate` header is `Bearer realm="<request URL>",error="…",error_description="…"`:

Sources: [src/middleware/jwt/jwt.ts:81-173](repo://src/middleware/jwt/jwt.ts#L81-L173)

| Failure | `error` | `error_description` |
| --- | --- | --- |
| Header not `Bearer <token>` | `invalid_request` | `invalid credentials structure` |
| No token in header or cookie | `invalid_request` | `no authorization included in request` |
| `verify` threw | `invalid_token` | `token verification failure` |

Sources: [src/middleware/jwt/jwt.ts:81-173](repo://src/middleware/jwt/jwt.ts#L81-L173)

The verification error is kept as the exception's `cause`, so an error handler can log which check failed.

Sources: [src/middleware/jwt/jwt.ts:131-152](repo://src/middleware/jwt/jwt.ts#L131-L152)

## The jwk middleware

`jwk(options, init?)` from `hono/jwk` reads the token the same way as `jwt` and verifies it with `verifyWithJwks`. It requires `keys` or `jwks_uri`, and both may be functions of the Context, resolved on every request. `alg` is the list of allowed asymmetric algorithms, and `init` is passed to the JWKS fetch.

Sources: [src/middleware/jwk/jwk.ts:48-143](repo://src/middleware/jwk/jwk.ts#L48-L143)

Two behaviours differ from `jwt`. With `allow_anon: true`, a request without a token goes on to `next()` without a payload. And when verification fails with a plain `Error`, such as a failed JWKS fetch, that error is re-thrown instead of being turned into a 401, so it reaches the app's error handler as a server error.

Sources: [src/middleware/jwk/jwk.ts:118-162](repo://src/middleware/jwk/jwk.ts#L118-L162)
