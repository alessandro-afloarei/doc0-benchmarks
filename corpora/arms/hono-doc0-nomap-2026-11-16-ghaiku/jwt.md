---
title: "JWT and JWK"
---
## Overview

Hono has JSON Web Token support in two layers. The utility `Jwt` in `src/utils/jwt` signs, verifies and decodes tokens with the Web Crypto API. The middleware `jwt` and `jwk` build on it: each reads a token from a header or cookie, verifies it, and stores the payload in the context as `jwtPayload`. This page covers the utility functions and the checks `verify` makes, the algorithm modules, and the two middlewares. The header and cookie helpers that the middleware reads are on [[Cookies]], and the simpler credential checks are on [[Authentication Middleware]].

Sources: [src/utils/jwt/index.ts:7-7](repo://src/utils/jwt/index.ts#L7-L7), [src/middleware/jwt/jwt.ts:53-61](repo://src/middleware/jwt/jwt.ts#L53-L61)

## Signing and decoding

`sign(payload, key, alg)` encodes the header and payload as base64url JSON, signs the two joined parts, and returns the three-part token. The default algorithm is `HS256`. If the key is an object with an `alg` field, that algorithm is used and the key's `kid` goes into the header.

Sources: [src/utils/jwt/jwt.ts:56-76](repo://src/utils/jwt/jwt.ts#L56-L76)

`decode` splits the token into three parts and decodes the first two as the header and the payload. It does not check the signature, and any failure to split or parse throws `JwtTokenInvalid`. `decodeHeader` is the same check for the header only.

Sources: [src/utils/jwt/jwt.ts:264-280](repo://src/utils/jwt/jwt.ts#L264-L280)

## Verification checks

`verify(token, key, algOrOptions)` takes an algorithm name or an options object. The options set the algorithm and the claim checks: `iss`, `aud`, and the switches `nbf`, `exp` and `iat`, which all default to `true`. Each switch controls one time claim, and the checks are applied only when the claim is present in the payload.

Sources: [src/utils/jwt/jwt.ts:78-112](repo://src/utils/jwt/jwt.ts#L78-L112)

The checks run in this order. The token must have three parts, and its header must be valid. The header's `alg` must equal the requested algorithm. Then `nbf`, `exp` and `iat` are compared with the current time in seconds, with `nbf` refused when it is in the future and `exp` refused when it is not after now. The issuer is checked against a string or a pattern, and the audience against a string, an array or a pattern. The signature is checked last, against the header and payload text.

Sources: [src/utils/jwt/jwt.ts:114-187](repo://src/utils/jwt/jwt.ts#L114-L187)

Each refusal throws its own error class, such as `JwtTokenExpired` or `JwtTokenAudience`, so a caller can tell the reason apart. The `jwt` middleware does not look at those classes, and turns any failure into a 401.

Sources: [src/utils/jwt/jwt.ts:136-139](repo://src/utils/jwt/jwt.ts#L136-L139), [src/middleware/jwt/jwt.ts:131-152](repo://src/middleware/jwt/jwt.ts#L131-L152)

## The jwt middleware

`jwt({ secret, alg, cookie, headerName, verification })` checks its options when it is created. It requires `secret` and `alg`, and it requires `crypto.subtle.importKey`. The middleware takes the token from the header, which defaults to `Authorization`. The header must have exactly two parts, with `bearer` as the first, or the request gets a 401 with `invalid_request`.

Sources: [src/middleware/jwt/jwt.ts:53-95](repo://src/middleware/jwt/jwt.ts#L53-L95)

When the header is absent and a `cookie` option is set, the token comes from the cookie. A string names a plain cookie, and an object with a `secret` reads a signed cookie through `getSignedCookie`. A missing token gets a 401 with the message `no authorization included in request`.

Sources: [src/middleware/jwt/jwt.ts:96-129](repo://src/middleware/jwt/jwt.ts#L96-L129)

A token that fails `Jwt.verify` gets a 401 whose `cause` is the original error. On success the payload is stored with `ctx.set('jwtPayload', payload)` and the chain continues. The typed `JwtVariables` type lets the handler read that value with the same name.

Sources: [src/middleware/jwt/jwt.ts:131-158](repo://src/middleware/jwt/jwt.ts#L131-L158), [src/middleware/jwt/jwt.ts:18-20](repo://src/middleware/jwt/jwt.ts#L18-L20)

## The jwk middleware

`jwk({ keys, jwks_uri, alg })` verifies a token against a set of public keys instead of one secret. The keys can be given directly, fetched from a `jwks_uri`, or both, and either can be a function of the context. Creation fails unless one of `keys` or `jwks_uri` is given.

Sources: [src/middleware/jwk/jwk.ts:48-68](repo://src/middleware/jwk/jwk.ts#L48-L68)

`verifyWithJwks` requires the token header to have a `kid`. It refuses the symmetric algorithms `HS256`, `HS384` and `HS512` to prevent algorithm confusion, and refuses any algorithm that is not in the middleware's `alg` list. A key set from `jwks_uri` is fetched with `fetch`, and its `keys` array is added to any keys given directly. The key whose `kid` matches the header is then checked against the header's algorithm, and the token is verified with it.

Sources: [src/utils/jwt/jwt.ts:197-262](repo://src/utils/jwt/jwt.ts#L197-L262)

The `jwk` middleware stores the payload in `jwtPayload` as the `jwt` middleware does. When verification fails with a plain `Error`, that error is rethrown; any other failure becomes a 401 with the cause attached.

Sources: [src/middleware/jwk/jwk.ts:133-166](repo://src/middleware/jwk/jwk.ts#L133-L166)

## Algorithms

`jwa.ts` holds the algorithm names as the `AlgorithmTypes` table, and `SignatureAlgorithm` is the key type of that table. `SymmetricAlgorithm` is the three HMAC names, and `AsymmetricAlgorithm` is the list used for JWK verification. `jws.ts` holds the signing and verifying functions that `sign` and `verify` call, which the RFC references in each file describe.

Sources: [src/utils/jwt/jwa.ts:1-30](repo://src/utils/jwt/jwa.ts#L1-L30), [src/utils/jwt/jws.ts:1-10](repo://src/utils/jwt/jws.ts#L1-L10)
