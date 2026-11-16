---
title: "JWT Authentication"
---
## Overview

Hono has three JWT pieces that share one verifier. `sign` and `verify` in `utils/jwt` create and check a token with a key the app holds. The `jwt` middleware reads a token from the `Authorization` header or a cookie and runs `verify` on it. `jwk` does the same check with keys from a JSON Web Key Set, which it can fetch from a URI. The other auth middleware, such as `basicAuth`, is listed in [[Built-in Middleware]].

Sources: [src/utils/jwt/jwt.ts:56-58](repo://src/utils/jwt/jwt.ts#L56-L58), [src/utils/jwt/jwt.ts:96-98](repo://src/utils/jwt/jwt.ts#L96-L98), [src/middleware/jwt/jwt.ts:53-62](repo://src/middleware/jwt/jwt.ts#L53-L62), [src/middleware/jwk/jwk.ts:51-51](repo://src/middleware/jwk/jwk.ts#L51-L51)

## Signing

`sign` encodes the payload as base64url JSON, encodes a header with `alg` and `typ: JWT`, signs the two joined parts, and returns `header.payload.signature`. A key object with an `alg` and `kid` takes its algorithm from the key and copies `kid` into the header. The default algorithm is `HS256`.

Sources: [src/utils/jwt/jwt.ts:56-75](repo://src/utils/jwt/jwt.ts#L56-L75)

## Verifying a token

`verify` requires an algorithm, splits the token into three parts, and decodes it. The header's `alg` must equal the algorithm the caller passed, or the call fails with a mismatch error. Then the claims are checked in order: `nbf` must not be in the future, `exp` must be in the future, and `iat` must not be after now. `iss` and `aud` are checked when the caller gives them. `nbf`, `exp` and `iat` are on by default and can be turned off through the `VerifyOptions`.

Sources: [src/utils/jwt/jwt.ts:96-130](repo://src/utils/jwt/jwt.ts#L96-L130), [src/utils/jwt/jwt.ts:130-158](repo://src/utils/jwt/jwt.ts#L130-L158)

Each failure has its own error class, so a caller can tell an expired token from a wrong algorithm. The middleware does not expose those classes to the client: it turns any failure into a 401 response.

Sources: [src/utils/jwt/jwt.ts:96-99](repo://src/utils/jwt/jwt.ts#L96-L99), [src/middleware/jwt/jwt.ts:131-152](repo://src/middleware/jwt/jwt.ts#L131-L152)

## The jwt middleware

The factory checks its options before it returns the handler: a `secret` and an `alg` are required, and `crypto.subtle.importKey` must exist. Each check throws at setup time, so a missing option fails when the app starts rather than on the first request.

Sources: [src/middleware/jwt/jwt.ts:63-75](repo://src/middleware/jwt/jwt.ts#L63-L75)

On each request the handler reads the `Authorization` header by default, or the header named by `headerName`. The header must split into exactly two parts, and the first must be `bearer`, compared case-insensitively. Any other shape is a 401 with an `invalid_request` challenge. Without the header, the handler reads the token from a cookie when the `cookie` option is set, and a signed cookie when it has a secret.

Sources: [src/middleware/jwt/jwt.ts:80-101](repo://src/middleware/jwt/jwt.ts#L80-L101), [src/middleware/jwt/jwt.ts:103-118](repo://src/middleware/jwt/jwt.ts#L103-L118)

When the token verifies, the payload is stored with `c.set('jwtPayload', payload)` and the chain continues. A handler reads the claims with `c.get('jwtPayload')`, which is the same value [[Context]] describes for every variable.

Sources: [src/middleware/jwt/jwt.ts:154-155](repo://src/middleware/jwt/jwt.ts#L154-L155)

## Keys from a JWKS

`verifyWithJwks` takes a token, a list of keys or a `jwks_uri`, and the algorithms it accepts. It decodes the header first, and it requires a `kid`. It rejects the symmetric algorithms `HS256`, `HS384` and `HS512`, and the code comment says this prevents algorithm confusion attacks. Only the algorithms in `allowedAlgorithms` pass.

Sources: [src/utils/jwt/jwt.ts:197-226](repo://src/utils/jwt/jwt.ts#L197-L226)

With `jwks_uri`, the function fetches the set and requires a `keys` array. It appends those keys to any keys given directly. It then finds the key whose `kid` matches the header. A key with its own `alg` must match the header's `alg`, and the verification runs with that key.

Sources: [src/utils/jwt/jwt.ts:226-262](repo://src/utils/jwt/jwt.ts#L226-L262)

The `jwk` middleware wraps this function. It takes `keys` or `jwks_uri`, and the `jwks_uri` may be a function of the context, so one app can pick the URI from its bindings.

Sources: [src/middleware/jwk/jwk.ts:51-68](repo://src/middleware/jwk/jwk.ts#L51-L68), [src/middleware/jwk/jwk.ts:137-141](repo://src/middleware/jwk/jwk.ts#L137-L141)

## Pages

- [[Built-in Middleware]] lists the other auth middleware and where they sit in the catalogue.
- [[Context]] explains `c.set` and `c.get`, which carry the payload.

Sources: [src/middleware/jwt/index.ts:1-4](repo://src/middleware/jwt/index.ts#L1-L4)
