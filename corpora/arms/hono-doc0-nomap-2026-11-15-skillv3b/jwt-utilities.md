---
title: "JWT Utilities"
---
## Overview

`hono/utils/jwt` implements JSON Web Tokens on top of the Web Crypto API (`crypto.subtle`), with no dependency, so the same code signs and verifies tokens on Workers, Deno, Bun and Node.js. It exports `Jwt = { sign, verify, decode, verifyWithJwks }`, which the `jwt` and `jwk` middleware call (see [[Authentication Middleware]]) and which `hono/jwt` re-exports for issuing tokens. The module is split along the RFCs: `jwa.ts` lists algorithms, `jws.ts` signs and verifies bytes, `jwt.ts` handles tokens and claims, and `types.ts` defines the errors.

Sources: [src/utils/jwt/index.ts:1-7](repo://src/utils/jwt/index.ts#L1-L7), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

## Algorithms

`AlgorithmTypes` lists the thirteen supported algorithms. `getKeyAlgorithm` maps each to its Web Crypto parameters:

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37)

| JWT `alg` | Web Crypto algorithm | Key kind |
| --- | --- | --- |
| `HS256`, `HS384`, `HS512` | `HMAC` with SHA-256/384/512 | Shared secret |
| `RS256`, `RS384`, `RS512` | `RSASSA-PKCS1-v1_5` | RSA key pair |
| `PS256`, `PS384`, `PS512` | `RSA-PSS`, salt length 32/48/64 | RSA key pair |
| `ES256`, `ES384`, `ES512` | `ECDSA` on P-256, P-384, P-521 | EC key pair |
| `EdDSA` | `Ed25519` | Ed25519 key pair, where the runtime supports it |

Sources: [src/utils/jwt/jws.ts:122-224](repo://src/utils/jwt/jws.ts#L122-L224)

`SymmetricAlgorithm` and `AsymmetricAlgorithm` split the list by key kind; the `jwk` middleware only accepts the asymmetric ones. An unknown name throws `JwtAlgorithmNotImplemented`.

Sources: [src/utils/jwt/jwa.ts:23-37](repo://src/utils/jwt/jwa.ts#L23-L37), [src/utils/jwt/jws.ts:221-223](repo://src/utils/jwt/jws.ts#L221-L223)

## Keys

A `SignatureKey` is a string, a JSON Web Key object, or a `CryptoKey`. `jws.ts` imports it according to its shape, so callers can pass whatever form their secret is stored in.

Sources: [src/utils/jwt/jws.ts:21-27](repo://src/utils/jwt/jws.ts#L21-L27)

| Key given | Imported for signing as | Imported for verifying as |
| --- | --- | --- |
| `CryptoKey` | Used as is (must be `private` or `secret`) | Used as is if `public` or `secret`; a private key is converted to its public JWK |
| JWK object | `jwk` | `jwk` |
| PEM string containing `PRIVATE` | `pkcs8` | Imported as private, then its public JWK is derived |
| PEM string containing `PUBLIC` | `raw` (fails) | `spki` |
| Any other string | `raw` UTF-8 bytes (HMAC secret) | `raw` UTF-8 bytes |

Sources: [src/utils/jwt/jws.ts:54-120](repo://src/utils/jwt/jws.ts#L54-L120)

Deriving the public key from a private one means a service can verify its own tokens with the same PEM it signs with. PEM armour and whitespace are stripped before base64 decoding. On Node.js, `isCryptoKey` checks against `crypto.webcrypto.CryptoKey`, because older versions do not expose `CryptoKey` globally.

Sources: [src/utils/jwt/jws.ts:50-52](repo://src/utils/jwt/jws.ts#L50-L52), [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

## sign

`sign(payload, key, alg = 'HS256')` base64url-encodes the header `{ alg, typ: 'JWT' }` and the JSON payload without padding, signs `header.payload` with `crypto.subtle.sign`, and appends the encoded signature. When the key is a JWK with its own `alg`, that algorithm wins and the key's `kid` is written into the header, which is what `verifyWithJwks` uses to find the key later.

Sources: [src/utils/jwt/jwt.ts:31-76](repo://src/utils/jwt/jwt.ts#L31-L76), [src/utils/jwt/jws.ts:29-37](repo://src/utils/jwt/jws.ts#L29-L37)

```ts
import { sign } from 'hono/jwt'

const token = await sign(
  { sub: 'user1', exp: Math.floor(Date.now() / 1000) + 60 * 5 },
  c.env.JWT_SECRET,
  'HS256'
)
```

Sources: [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76)

## verify

`verify(token, key, algOrOptions)` requires the algorithm, either as a string or as `{ alg, ...VerifyOptions }`; a missing algorithm throws `JwtAlgorithmRequired`. Requiring it from the caller, and rejecting a token whose header names another one, prevents algorithm-substitution attacks in which a token claims `none` or an HMAC algorithm keyed with a public key.

Sources: [src/utils/jwt/jwt.ts:78-129](repo://src/utils/jwt/jwt.ts#L78-L129)

The checks run in this order, each throwing its own error class:

Sources: [src/utils/jwt/jwt.ts:118-188](repo://src/utils/jwt/jwt.ts#L118-L188)

1. The token has three parts and decodes (`JwtTokenInvalid`), and the header has a known `alg` and `typ` of `JWT` if present (`JwtHeaderInvalid`).
2. The header's `alg` equals the expected one (`JwtAlgorithmMismatch`).
3. `nbf` is a finite number not in the future (`JwtTokenNotBefore`), `exp` a finite number in the future (`JwtTokenExpired`), `iat` not in the future (`JwtTokenIssuedAt`). Each check can be turned off with `nbf: false`, `exp: false`, `iat: false`, and a claim that is absent is not checked.
4. With `iss`, the payload's issuer equals the string or matches the `RegExp` (`JwtTokenIssuer`).
5. With `aud`, the payload's `aud` (a string or an array) has at least one value equal to the string, contained in the array, or matching the `RegExp`. A payload without `aud` throws `JwtPayloadRequiresAud`, a mismatch `JwtTokenAudience`.
6. The signature verifies over the original `header.payload` bytes (`JwtTokenSignatureMismatched`).

Sources: [src/utils/jwt/jwt.ts:118-188](repo://src/utils/jwt/jwt.ts#L118-L188), [src/utils/jwt/types.ts:6-110](repo://src/utils/jwt/types.ts#L6-L110)

Claims are checked before the signature, so a forged expired token is rejected as expired. The payload is returned only after the signature check passes.

Sources: [src/utils/jwt/jwt.ts:130-188](repo://src/utils/jwt/jwt.ts#L130-L188)

## verifyWithJwks

`verifyWithJwks(token, { keys, jwks_uri, verification, allowedAlgorithms }, init)` verifies a token against a key set, as identity providers publish them:

Sources: [src/utils/jwt/jwt.ts:197-262](repo://src/utils/jwt/jwt.ts#L197-L262)

1. It decodes only the header and requires a `kid` (`JwtHeaderRequiresKid`).
2. It rejects `HS256`, `HS384` and `HS512` outright (`JwtSymmetricAlgorithmNotAllowed`): a public key set must never be usable as an HMAC secret. It then requires the header's algorithm to be in `allowedAlgorithms` (`JwtAlgorithmNotAllowed`).
3. It copies `keys`, and when `jwks_uri` is set, fetches it with `init` and appends the response's `keys` array. A failed fetch or a response without a `keys` array throws a plain `Error`.
4. It picks the key whose `kid` matches; none is `JwtTokenInvalid`. If that key declares an `alg`, it must equal the header's.
5. It calls `verify` with the header's algorithm and the `verification` options.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

The key set is fetched on every call; cache it in `keys` (the middleware accepts a function for that) when the provider's keys change rarely.

Sources: [src/utils/jwt/jwt.ts:228-246](repo://src/utils/jwt/jwt.ts#L228-L246), [src/middleware/jwk/jwk.ts:136-143](repo://src/middleware/jwk/jwk.ts#L136-L143)

## decode

`decode(token)` returns `{ header, payload }` without checking anything, and `decodeHeader(token)` returns the header alone. Both throw `JwtTokenInvalid` for a token that does not have three parts or does not parse. Use them only to inspect a token, never to trust it.

Sources: [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

## Payload type

`JWTPayload` is an open record with the registered claims typed: `exp`, `nbf` and `iat` as numbers (seconds since the epoch), plus `iss` and `aud`. Base64url encoding and decoding come from `utils/encode`.

Sources: [src/utils/jwt/types.ts:131-156](repo://src/utils/jwt/types.ts#L131-L156), [src/utils/encode.ts:1-34](repo://src/utils/encode.ts#L1-L34)
