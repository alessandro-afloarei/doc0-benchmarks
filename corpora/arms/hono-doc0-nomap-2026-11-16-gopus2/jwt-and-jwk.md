---
title: "JWT and JWK"
---
## Overview

Hono signs and verifies JSON Web Tokens with the Web Crypto API only. The utilities in `utils/jwt` implement `sign`, `verify`, `decode` and `verifyWithJwks` over `crypto.subtle`, and two middleware build on them: `jwt` (`hono/jwt`) checks tokens against one secret or key, and `jwk` (`hono/jwk`) checks them against a JSON Web Key Set, possibly fetched from a URL. Both read the token from a header or a cookie and store the verified payload as `c.get('jwtPayload')`. Shared-secret schemes without signatures are covered in [[Authentication Middleware]].

Sources: [src/utils/jwt/index.ts:1-7](repo://src/utils/jwt/index.ts#L1-L7), [src/middleware/jwt/jwt.ts:53-158](repo://src/middleware/jwt/jwt.ts#L53-L158), [src/middleware/jwk/jwk.ts:48-75](repo://src/middleware/jwk/jwk.ts#L48-L75)

`hono/jwt` also re-exports `sign`, `verify`, `decode`, `verifyWithJwks` and `AlgorithmTypes`, and declares `jwtPayload` in `ContextVariableMap` so `c.get('jwtPayload')` is typed in every app that imports it.

Sources: [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

## Algorithms and keys

The supported algorithms are HMAC (`HS256`, `HS384`, `HS512`), RSA PKCS#1 (`RS256`…`RS512`), RSA-PSS (`PS256`…`PS512`), ECDSA (`ES256`, `ES384`, `ES512`) and `EdDSA`. Only the three HMAC ones are symmetric.

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37)

A key (`SignatureKey`) is a string, a JSON Web Key object, or a `CryptoKey`. For signing, a string containing `PRIVATE` is imported as a PKCS#8 PEM, any other string as raw HMAC secret bytes, and an object as a JWK. For verification, a string containing `PUBLIC` is imported as an SPKI PEM; a private key, as a PEM or a `CryptoKey`, is converted to its public JWK first, so the same key can sign and verify.

Sources: [src/utils/jwt/jws.ts:23-105](repo://src/utils/jwt/jws.ts#L23-L105)

## Signing

`sign(payload, privateKey, alg = 'HS256')` encodes the header `{ alg, typ: 'JWT' }` and the payload as unpadded Base64URL JSON, signs `header.payload` with `crypto.subtle.sign`, and appends the encoded signature. When the key is a JWK object with an `alg`, that algorithm overrides the argument and the key's `kid` goes into the header.

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76), [src/utils/jwt/jws.ts:29-37](repo://src/utils/jwt/jws.ts#L29-L37)

```ts
import { sign } from 'hono/jwt'

const token = await sign(
  { sub: 'user123', role: 'admin', exp: Math.floor(Date.now() / 1000) + 60 * 5 },
  'mySecretKey'
)
```

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76), [src/utils/jwt/jws.ts:29-37](repo://src/utils/jwt/jws.ts#L29-L37)

## Verifying

### Steps

`verify(token, publicKey, algOrOptions)` requires the algorithm: passing none throws `JwtAlgorithmRequired`. The token's header is never trusted to choose it. Verification runs in this order, each failure throwing its own error class:

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188), [src/utils/jwt/jwt.ts:44-54](repo://src/utils/jwt/jwt.ts#L44-L54)

1. The token must have three parts and decode as JSON (`JwtTokenInvalid`).
2. The header must name a known algorithm with `typ` absent or `JWT` (`JwtHeaderInvalid`), and that algorithm must equal the expected one (`JwtAlgorithmMismatch`).
3. `nbf` must not be in the future, `exp` must be in the future, and `iat` must not be in the future. Each check applies only when the claim is present and can be switched off; a claim that is not a finite number fails.
4. `iss`, when the option is set, must equal the string or match the regular expression.
5. `aud`, when the option is set, must be present and one of its values must equal the string, appear in the array, or match the regular expression.
6. The signature must verify with `crypto.subtle.verify` (`JwtTokenSignatureMismatched`).

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188), [src/utils/jwt/jwt.ts:44-54](repo://src/utils/jwt/jwt.ts#L44-L54)

### Options

| Option | Default | Effect |
| --- | --- | --- |
| `alg` | required | Expected algorithm |
| `nbf` | `true` | Check the not-before claim |
| `exp` | `true` | Check the expiry claim |
| `iat` | `true` | Check the issued-at claim |
| `iss` | none | Required issuer, string or `RegExp` |
| `aud` | none | Accepted audience, string, array or `RegExp` |

Sources: [src/utils/jwt/jwt.ts:78-94](repo://src/utils/jwt/jwt.ts#L78-L94)

`decode(token)` returns the header and payload without any check, and `decodeHeader` only the header. Both throw `JwtTokenInvalid` for a malformed token.

Sources: [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

## Verifying with a key set

`verifyWithJwks(token, { keys, jwks_uri, verification, allowedAlgorithms }, init)` picks the key by the token's `kid`. It refuses tokens whose header has no `kid` (`JwtHeaderRequiresKid`), whose algorithm is HMAC (`JwtSymmetricAlgorithmNotAllowed`, a guard against algorithm confusion, where a public key would be used as an HMAC secret), or whose algorithm is not in `allowedAlgorithms`.

Sources: [src/utils/jwt/jwt.ts:190-226](repo://src/utils/jwt/jwt.ts#L190-L226)

Keys come from `keys`, from `jwks_uri`, or from both: the URI is fetched with `init` on every call and its `keys` array is appended. A failed fetch or a response without a `keys` array throws a plain `Error`. The key with the matching `kid` is used; if it declares an `alg`, that must equal the token's. Verification then continues as in `verify` with the token's algorithm and the `verification` options.

Sources: [src/utils/jwt/jwt.ts:228-262](repo://src/utils/jwt/jwt.ts#L228-L262)

## jwt middleware

`jwt({ secret, alg, cookie, headerName, verification })` requires `secret` and `alg`, and `crypto.subtle.importKey` to exist, failing when the middleware is created otherwise.

Sources: [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74)

For each request it looks for the token in this order:

Sources: [src/middleware/jwt/jwt.ts:76-117](repo://src/middleware/jwt/jwt.ts#L76-L117)

1. The `Authorization` header, or `headerName`. It must be exactly `Bearer <token>` (scheme in any case); any other shape is refused with `invalid credentials structure`.
2. When there is no such header and `cookie` is set, the cookie: a name string reads a plain cookie, and `{ key, secret, prefixOptions }` reads a signed cookie when `secret` is given, through the [[Cookies]] helper.

Sources: [src/middleware/jwt/jwt.ts:76-117](repo://src/middleware/jwt/jwt.ts#L76-L117)

A missing token, a malformed header and a failed verification all throw `HTTPException(401)` whose response has `WWW-Authenticate: Bearer realm="<url>",error="...",error_description="..."`, with `invalid_request` for the first two and `invalid_token` for the last; the verification error is kept as the exception's `cause`. On success the payload is stored with `ctx.set('jwtPayload', payload)` before `next()`.

Sources: [src/middleware/jwt/jwt.ts:119-173](repo://src/middleware/jwt/jwt.ts#L119-L173)

```ts
import { jwt } from 'hono/jwt'

app.use('/auth/*', jwt({ secret: 'it-is-very-secret', alg: 'HS256' }))

app.get('/auth/page', (c) => {
  const payload = c.get('jwtPayload')
  return c.json(payload)
})
```

Sources: [src/middleware/jwt/jwt.ts:53-158](repo://src/middleware/jwt/jwt.ts#L53-L158)

## jwk middleware

`jwk({ keys, jwks_uri, alg, allow_anon, cookie, headerName, verification }, init)` reads the token exactly like `jwt` and verifies it with `verifyWithJwks`, passing `alg` as the list of allowed asymmetric algorithms. It requires `keys` or `jwks_uri`. Both may be functions of the context, evaluated on every request, so keys can come from bindings or a cache.

Sources: [src/middleware/jwk/jwk.ts:48-116](repo://src/middleware/jwk/jwk.ts#L48-L116), [src/middleware/jwk/jwk.ts:133-146](repo://src/middleware/jwk/jwk.ts#L133-L146)

Two behaviours differ from `jwt`. With `allow_anon: true`, a request without any token passes through to `next()` without a payload. And a plain `Error`, as thrown when the key set cannot be fetched or parsed, is rethrown as it is rather than turned into a 401, so an outage of the key server surfaces as a server error instead of a rejected login.

Sources: [src/middleware/jwk/jwk.ts:118-168](repo://src/middleware/jwk/jwk.ts#L118-L168), [src/utils/jwt/jwt.ts:230-246](repo://src/utils/jwt/jwt.ts#L230-L246)
