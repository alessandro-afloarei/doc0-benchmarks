---
title: "JWT and JWK"
---
## Overview

Hono implements JSON Web Tokens itself on top of Web Crypto (`crypto.subtle`), with no dependency, so the same code signs and verifies tokens on Workers, Deno, Bun and Node.js. Three layers build on each other:

Sources: [src/utils/jwt/jws.ts:29-48](repo://src/utils/jwt/jws.ts#L29-L48)

| Layer | Module | Role |
| --- | --- | --- |
| JWS | `utils/jwt/jws.ts` | Maps algorithm names to Web Crypto parameters, imports keys, signs and verifies bytes |
| JWT | `utils/jwt/jwt.ts` (`hono/utils/jwt`) | `sign`, `verify`, `decode`, `verifyWithJwks`: encoding plus claim checks |
| Middleware | `hono/jwt`, `hono/jwk` | Extract the token from a header or cookie, verify it, set `c.var.jwtPayload` |

Sources: [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76), [src/middleware/jwt/jwt.ts:53-61](repo://src/middleware/jwt/jwt.ts#L53-L61), [src/middleware/jwk/jwk.ts:48-64](repo://src/middleware/jwk/jwk.ts#L48-L64)

Use `jwt` when the app holds the secret or public key, and `jwk` when keys come from an identity provider's JWKS endpoint. Shared-secret checks without signatures are on [[Basic and Bearer Authentication]].

Sources: [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

## Algorithms and keys

### Supported algorithms

`AlgorithmTypes` lists `HS256/384/512` (HMAC), `RS256/384/512` (RSASSA-PKCS1-v1_5), `PS256/384/512` (RSA-PSS), `ES256/384/512` (ECDSA) and `EdDSA` (Ed25519). `getKeyAlgorithm` turns each into Web Crypto parameters, such as a PSS salt length of the hash size in bytes; any other name throws `JwtAlgorithmNotImplemented`.

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37), [src/utils/jwt/jws.ts:122-224](repo://src/utils/jwt/jws.ts#L122-L224)

### Key formats

A `SignatureKey` is a string, a JSON Web Key object, or a `CryptoKey`. The importers pick the format from the value:

Sources: [src/utils/jwt/jws.ts:21-27](repo://src/utils/jwt/jws.ts#L21-L27)

| Key | Signing (`importPrivateKey`) | Verifying (`importPublicKey`) |
| --- | --- | --- |
| `CryptoKey` | Used if `private` or `secret` | Used if `public` or `secret`; a private key is converted to its public JWK |
| JWK object | `jwk` import | `jwk` import |
| PEM with `PRIVATE` | `pkcs8` import | Imported, then its public half is exported and used |
| PEM with `PUBLIC` | not accepted | `spki` import |
| Any other string | `raw` HMAC secret | `raw` HMAC secret |

Sources: [src/utils/jwt/jws.ts:50-120](repo://src/utils/jwt/jws.ts#L50-L120)

On Node.js, `isCryptoKey` checks against `crypto.webcrypto.CryptoKey`, since older versions do not expose `CryptoKey` globally.

Sources: [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

## Signing and decoding

`sign(payload, key, alg = 'HS256')` base64url-encodes the header `{ alg, typ: 'JWT' }` and the JSON payload without padding, signs `header.payload`, and appends the encoded signature. When the key is a JWK with its own `alg`, that algorithm wins and the key's `kid` goes into the header.

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76)

`decode(token)` splits a three-part token and parses header and payload without checking the signature; `decodeHeader` parses only the header. Both throw `JwtTokenInvalid` for anything malformed.

Sources: [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

## Verifying a token

### Checks with one key

`verify(token, key, algOrOptions)` requires an algorithm, either as a string or as `alg` in an options object; omitting it throws `JwtAlgorithmRequired`. Requiring it closes the classic attack where a token picks its own algorithm, for example `HS256` with a public key used as the HMAC secret.

Sources: [src/utils/jwt/jwt.ts:78-116](repo://src/utils/jwt/jwt.ts#L78-L116)

The checks run in this order, each throwing its own error class from `utils/jwt/types`:

Sources: [src/utils/jwt/jwt.ts:118-188](repo://src/utils/jwt/jwt.ts#L118-L188)

1. Three parts, decodable header and payload (`JwtTokenInvalid`).
2. A header whose `alg` is a known algorithm and whose `typ`, if present, is `JWT` (`JwtHeaderInvalid`).
3. The header's `alg` equals the expected one (`JwtAlgorithmMismatch`).
4. `nbf` not in the future, `exp` in the future, `iat` not in the future; each check runs only if the claim is present and its option is not `false`, and a non-numeric claim fails.
5. `iss` equals a string or matches a `RegExp`, when the `iss` option is set.
6. `aud` (a string or an array in the token) contains the expected string, any of an array, or matches a `RegExp`, when the `aud` option is set; a missing claim throws `JwtPayloadRequiresAud`.
7. The signature over `header.payload` verifies (`JwtTokenSignatureMismatched`).

Sources: [src/utils/jwt/jwt.ts:118-188](repo://src/utils/jwt/jwt.ts#L118-L188)

Claims are compared to the current time in whole seconds, with no clock-skew allowance.

Sources: [src/utils/jwt/jwt.ts:130-145](repo://src/utils/jwt/jwt.ts#L130-L145)

### Verifying with a key set

`verifyWithJwks(token, { keys, jwks_uri, verification, allowedAlgorithms })` reads the header first and requires a `kid`. It rejects the symmetric `HS*` algorithms outright and any algorithm missing from `allowedAlgorithms`. It then combines the static `keys` with the `keys` array fetched from `jwks_uri`, picks the key whose `kid` matches, checks that the key's own `alg` (if any) agrees with the header, and finally calls `verify` with the header's algorithm and the verification options.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

## The jwt middleware

```ts
import { jwt } from 'hono/jwt'

app.use('/api/*', jwt({ secret: env.JWT_SECRET, alg: 'HS256' }))
app.get('/api/me', (c) => c.json(c.get('jwtPayload')))
```

Sources: [src/middleware/jwt/jwt.ts:53-61](repo://src/middleware/jwt/jwt.ts#L53-L61)

`jwt({ secret, alg, cookie, headerName, verification })` checks at setup that `secret` and `alg` are present and that Web Crypto exists. Per request it looks for the token in this order:

Sources: [src/middleware/jwt/jwt.ts:62-117](repo://src/middleware/jwt/jwt.ts#L62-L117)

1. The `Authorization` header (or `headerName`), which must be exactly two whitespace-separated parts starting with `Bearer` in any case; any other shape is a 401 `invalid_request`.
2. Only if no header is present, the `cookie` option: a cookie name, or `{ key, secret, prefixOptions }` to read a signed or `__Secure-`/`__Host-` prefixed cookie through the [[Cookies]] helpers.

Sources: [src/middleware/jwt/jwt.ts:76-117](repo://src/middleware/jwt/jwt.ts#L76-L117)

No token is a 401 with `no authorization included in request`. A token that fails `verify` is a 401 `invalid_token`, and the underlying error is kept as the exception's `cause` for logging. On success the payload is stored with `c.set('jwtPayload', payload)`; the module augments `ContextVariableMap` so `c.get('jwtPayload')` is typed everywhere.

Sources: [src/middleware/jwt/jwt.ts:119-158](repo://src/middleware/jwt/jwt.ts#L119-L158), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

Every failure response is built by `unauthorizedResponse`: status 401, body `Unauthorized`, and `WWW-Authenticate: Bearer realm="<request URL>",error="...",error_description="..."`. It is attached as the `res` of an `HTTPException`, so it reaches the client through the error handler (see [[Middleware Composition and Error Handling]]).

Sources: [src/middleware/jwt/jwt.ts:160-173](repo://src/middleware/jwt/jwt.ts#L160-L173)

## The jwk middleware

`jwk({ keys, jwks_uri, alg, allow_anon, cookie, headerName, verification }, init)` reads the token exactly like `jwt`, then verifies it with `verifyWithJwks`. Its differences:

Sources: [src/middleware/jwk/jwk.ts:48-131](repo://src/middleware/jwk/jwk.ts#L48-L131)

- `alg` is the list of accepted asymmetric algorithms, passed as `allowedAlgorithms`.
- `keys` and `jwks_uri` may be functions of the context, resolved per request, for example to read a URL from `c.env`.
- `allow_anon: true` lets a request without any token through without setting `jwtPayload`; a request with an invalid token is still rejected.
- `init` is passed to `fetch` when retrieving the key set.

Sources: [src/middleware/jwk/jwk.ts:48-64](repo://src/middleware/jwk/jwk.ts#L48-L64), [src/middleware/jwk/jwk.ts:118-146](repo://src/middleware/jwk/jwk.ts#L118-L146)

> [!WARNING]
> The key set is fetched on every request that carries a token; nothing is cached. Pass `keys` as a function that caches the set (or put a cache in front of the JWKS URL) on busy routes. A failed fetch or malformed key set throws a plain `Error`, which the middleware rethrows instead of answering 401, so it surfaces as a 500 from the error handler.

Sources: [src/utils/jwt/jwt.ts:228-246](repo://src/utils/jwt/jwt.ts#L228-L246), [src/middleware/jwk/jwk.ts:133-162](repo://src/middleware/jwk/jwk.ts#L133-L162)
