---
title: "JWT Utilities"
---
## Overview

`hono/utils/jwt` signs, verifies and decodes JSON Web Tokens with the Web Crypto API (`crypto.subtle`), so it runs unchanged on every runtime Hono supports. It exports one object, `Jwt`, with four functions; `hono/jwt` re-exports the same four next to the middleware on [[Authentication Middleware]]. The code is split by specification: `jwt.ts` handles tokens and claims (RFC 7519), `jws.ts` keys and signatures (RFC 7515), and `jwa.ts` the algorithm names (RFC 7518).

Sources: [src/utils/jwt/index.ts:1-7](repo://src/utils/jwt/index.ts#L1-L7), [src/utils/jwt/jwt.ts:1-5](repo://src/utils/jwt/jwt.ts#L1-L5), [src/utils/jwt/jws.ts:1-5](repo://src/utils/jwt/jws.ts#L1-L5), [src/utils/jwt/jwa.ts:1-5](repo://src/utils/jwt/jwa.ts#L1-L5)

| Function | Does |
| --- | --- |
| `Jwt.sign(payload, privateKey, alg = 'HS256')` | Returns a signed compact token. |
| `Jwt.verify(token, publicKey, algOrOptions)` | Checks header, claims and signature; returns the payload or throws. |
| `Jwt.verifyWithJwks(token, options, init)` | Picks a key from a key set by `kid`, then calls `verify`. |
| `Jwt.decode(token)` | Returns `{ header, payload }` without checking anything. |

Sources: [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76), [src/utils/jwt/jwt.ts:96-100](repo://src/utils/jwt/jwt.ts#L96-L100), [src/utils/jwt/jwt.ts:197-206](repo://src/utils/jwt/jwt.ts#L197-L206), [src/utils/jwt/jwt.ts:264-279](repo://src/utils/jwt/jwt.ts#L264-L279)

## Algorithms and keys

### Supported algorithms

`AlgorithmTypes` lists the thirteen accepted `alg` values. Each maps to a Web Crypto algorithm in `getKeyAlgorithm`:

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37), [src/utils/jwt/jws.ts:122-224](repo://src/utils/jwt/jws.ts#L122-L224)

| `alg` | Web Crypto algorithm |
| --- | --- |
| `HS256`, `HS384`, `HS512` | `HMAC` with SHA-256/384/512 |
| `RS256`, `RS384`, `RS512` | `RSASSA-PKCS1-v1_5` with SHA-256/384/512 |
| `PS256`, `PS384`, `PS512` | `RSA-PSS` with salt length 32/48/64 bytes |
| `ES256`, `ES384`, `ES512` | `ECDSA` on P-256, P-384 and P-521 |
| `EdDSA` | `Ed25519` |

Sources: [src/utils/jwt/jwa.ts:7-37](repo://src/utils/jwt/jwa.ts#L7-L37), [src/utils/jwt/jws.ts:122-224](repo://src/utils/jwt/jws.ts#L122-L224)

The `HS*` names are typed as `SymmetricAlgorithm` and the rest as `AsymmetricAlgorithm`. A comment at `EdDSA` notes that only some runtimes support Ed25519 in Web Crypto. Any other name throws `JwtAlgorithmNotImplemented`.

Sources: [src/utils/jwt/jwa.ts:23-37](repo://src/utils/jwt/jwa.ts#L23-L37), [src/utils/jwt/jws.ts:214-223](repo://src/utils/jwt/jws.ts#L214-L223)

### Key formats

A `SignatureKey` is a string, a JSON Web Key (`HonoJsonWebKey`, a `JsonWebKey` with an optional `kid`) or a `CryptoKey`. `importPrivateKey`, used for signing, and `importPublicKey`, used for verifying, turn it into a `CryptoKey`:

Sources: [src/utils/jwt/jws.ts:21-27](repo://src/utils/jwt/jws.ts#L21-L27), [src/utils/jwt/jws.ts:50-120](repo://src/utils/jwt/jws.ts#L50-L120)

| Key | Signing | Verifying |
| --- | --- | --- |
| `CryptoKey` | Used as it is; must be `private` or `secret`. | Used if `public` or `secret`; an extractable private key is reduced to its public JWK. |
| JWK object | Imported with format `jwk`. | Imported with format `jwk`. |
| PEM containing `PRIVATE` | Imported as `pkcs8`. | Imported as `pkcs8`, then reduced to its public JWK. |
| PEM containing `PUBLIC` | Imported as `raw` bytes. | Imported as `spki`. |
| Any other string | Imported as a `raw` HMAC secret. | Imported as a `raw` HMAC secret. |

Sources: [src/utils/jwt/jws.ts:21-27](repo://src/utils/jwt/jws.ts#L21-L27), [src/utils/jwt/jws.ts:50-120](repo://src/utils/jwt/jws.ts#L50-L120)

PEM text is stripped of its `-----BEGIN ...-----` and `-----END ...-----` lines and whitespace, then base64-decoded. Both import functions throw when `crypto.subtle.importKey` does not exist. On Node.js, `isCryptoKey` checks against `crypto.webcrypto.CryptoKey`, because the comment says `CryptoKey` is not a global in Node 18.

Sources: [src/utils/jwt/jws.ts:50-57](repo://src/utils/jwt/jws.ts#L50-L57), [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

## Signing

`sign` serializes the header and the payload as JSON, encodes each as base64url without padding, signs `header.payload` with `crypto.subtle.sign`, and appends the encoded signature. The header is `{ alg, typ: 'JWT' }`; when the key is a JWK with an `alg`, that `alg` replaces the argument and the key's `kid` is added to the header.

Sources: [src/utils/jwt/jwt.ts:31-36](repo://src/utils/jwt/jwt.ts#L31-L36), [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76), [src/utils/jwt/jws.ts:29-37](repo://src/utils/jwt/jws.ts#L29-L37)

```ts
import { sign } from 'hono/jwt'

const token = await sign({ sub: 'user123', exp: Math.floor(Date.now() / 1000) + 60 * 5 }, secret)
```

Sources: [src/utils/jwt/jwt.ts:56-60](repo://src/utils/jwt/jwt.ts#L56-L60)

## Verifying

### The steps

`verify` requires an algorithm, given as a string or as `alg` in an options object; without one it throws `JwtAlgorithmRequired`. It then checks, in order:

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188), [src/utils/jwt/jwt.ts:44-54](repo://src/utils/jwt/jwt.ts#L44-L54)

1. The token has three parts, or `JwtTokenInvalid`.
2. The decoded header has a known `alg` and, if present, `typ: 'JWT'`, or `JwtHeaderInvalid`.
3. The header's `alg` equals the expected one, or `JwtAlgorithmMismatch`. A token cannot choose its own algorithm.
4. The time claims, against the current time in seconds.
5. `iss` and `aud`, when the options ask for them.
6. The signature over `header.payload`, with `crypto.subtle.verify`, or `JwtTokenSignatureMismatched`.

Sources: [src/utils/jwt/jwt.ts:96-188](repo://src/utils/jwt/jwt.ts#L96-L188), [src/utils/jwt/jwt.ts:44-54](repo://src/utils/jwt/jwt.ts#L44-L54)

### Claim options

| Option | Default | Check |
| --- | --- | --- |
| `nbf` | `true` | If present, `nbf` must be a finite number not after now, or `JwtTokenNotBefore`. |
| `exp` | `true` | If present, `exp` must be a finite number after now, or `JwtTokenExpired`. |
| `iat` | `true` | If present, `iat` must be a finite number not after now, or `JwtTokenIssuedAt`. |
| `iss` | none | A string must equal the claim; a `RegExp` must match it; a missing claim fails. Error: `JwtTokenIssuer`. |
| `aud` | none | A string, array or `RegExp`; one audience of the claim, string or array, must match. A missing claim throws `JwtPayloadRequiresAud`, a mismatch `JwtTokenAudience`. |

Sources: [src/utils/jwt/jwt.ts:78-94](repo://src/utils/jwt/jwt.ts#L78-L94), [src/utils/jwt/jwt.ts:130-174](repo://src/utils/jwt/jwt.ts#L130-L174)

The time claims are only checked when present: a token without `exp` never expires unless the application checks for it. Setting an option to `false` skips that check.

Sources: [src/utils/jwt/jwt.ts:131-145](repo://src/utils/jwt/jwt.ts#L131-L145), [src/utils/jwt/types.ts:131-154](repo://src/utils/jwt/types.ts#L131-L154)

## Verifying with a key set

`verifyWithJwks(token, { keys, jwks_uri, verification, allowedAlgorithms }, init)` is for tokens signed by an identity provider that publishes its keys:

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

1. The header is decoded on its own and must be valid and have a `kid`, or `JwtHeaderRequiresKid`.
2. `HS256`, `HS384` and `HS512` are refused with `JwtSymmetricAlgorithmNotAllowed`; the comment calls this protection against algorithm confusion attacks.
3. The header's `alg` must be in `allowedAlgorithms`, or `JwtAlgorithmNotAllowed`.
4. The candidate keys are `keys` plus, when `jwks_uri` is set, the `keys` array fetched from it with `init`. A failed fetch or a response without a `keys` array throws a plain `Error`, as does giving neither source.
5. The key whose `kid` equals the header's is chosen, or `JwtTokenInvalid`. If that key has its own `alg`, it must equal the header's, or `JwtAlgorithmMismatch`.
6. `verify` runs with the key, the header's algorithm and the `verification` options.

Sources: [src/utils/jwt/jwt.ts:190-262](repo://src/utils/jwt/jwt.ts#L190-L262)

The key set is fetched on every call; nothing is cached.

Sources: [src/utils/jwt/jwt.ts:228-246](repo://src/utils/jwt/jwt.ts#L228-L246)

## Decoding

`decode` splits the token, base64url-decodes and parses the header and payload, and throws `JwtTokenInvalid` when there are not three parts or a part is not valid JSON. It does not check the signature, so its result must not be trusted on its own. `decodeHeader` does the same for the header alone.

Sources: [src/utils/jwt/jwt.ts:264-291](repo://src/utils/jwt/jwt.ts#L264-L291)

## Errors

Every failure is an instance of a named `Error` subclass from `utils/jwt/types.ts`, whose `name` equals the class name, so callers can tell a bad signature from an expired token. The [[Authentication Middleware]] turns any of them into a 401 and keeps the error as the exception's `cause`.

Sources: [src/utils/jwt/types.ts:6-115](repo://src/utils/jwt/types.ts#L6-L115), [src/middleware/jwt/jwt.ts:131-152](repo://src/middleware/jwt/jwt.ts#L131-L152)
