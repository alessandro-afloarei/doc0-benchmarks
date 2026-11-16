---
type: reference
title: Crypto, JWT and Encoding Utilities
description: The shared utilities behind Hono's authentication, cookie, and content-handling features - the JWT implementation (sign, verify, verifyWithJwks, and decode, with the JWS signing layer and JWA algorithm names), constant-time comparison and hashing, base64 and base64url helpers, signed and plain cookie parsing and serialization, request body parsing, and the compressible content-type rule - and which middleware and helpers depend on each.
tags: [utils, jwt, jws, jwa, crypto, encoding, base64, cookies, timing-safe, body-parsing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
  - id: openwiki-source-df3100f35990271621d0b7be
    resource: repo://src/utils/buffer.ts
  - id: openwiki-source-9b3cb71a5f30f07d371346e8
    resource: repo://src/utils/compress.ts
  - id: openwiki-source-a49b959930b2834e410ba9de
    resource: repo://src/utils/cookie.ts
  - id: openwiki-source-77b3732d351aa8393874f438
    resource: repo://src/utils/jwt/jwa.ts
  - id: openwiki-source-79563bcc563e362b43cf45a2
    resource: repo://src/utils/jwt/jwt.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Crypto, JWT and Encoding Utilities

<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Several public features are thin layers over a small set of utilities in `src/utils/`. They use Web Crypto (`crypto.subtle`) and Web Standards encodings, so they run on the same runtimes as the rest of the framework. This page describes the utilities that carry security-relevant behavior and the consumers that depend on them. Consumers are described in [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md) and [Helper Modules](/openwiki/helpers/helper-modules.md).

## JWT: Signing and Verification

`src/utils/jwt/` implements JSON Web Tokens in three layers: `jwt.ts` (token format and claims), `jws.ts` (signing and verification with Web Crypto), and `jwa.ts` (algorithm names). `src/utils/jwt/index.ts` exports them together as the `Jwt` object with `sign`, `verify`, `decode`, and `verifyWithJwks`.

- **Algorithms.** `AlgorithmTypes` lists `HS256` through `HS512`, `RS256` through `RS512`, `PS256` through `PS512`, `ES256` through `ES512`, and `EdDSA`. `SignatureAlgorithm` is the union of these names, and `SymmetricAlgorithm` is the HMAC subset.
- **Signing.** `sign(payload, key, alg = 'HS256')` encodes the payload, builds a header with `alg` and `typ: "JWT"`, and signs `header.payload` with `signing`. When the key is a JWK object that carries its own `alg` and `kid`, those values replace the defaults in the header.
- **Verification.** `verify(token, key, algOrOptions)` requires an algorithm (passed directly or as `alg` in the options) and rejects tokens that do not have exactly three parts. It rejects a header whose `alg` differs from the requested one, then checks the time claims: `nbf`, `exp`, and `iat` are validated when present and enabled (all three default to enabled), and `iss` and `aud` are checked when given, as a string, a regular expression, or a list. Only after these checks does it verify the signature over `header.payload` with the key.
- **Key-set verification.** `verifyWithJwks(token, { keys?, jwks_uri?, verification?, allowedAlgorithms }, init?)` requires a `kid` in the header, rejects symmetric algorithms outright to prevent algorithm confusion, and enforces the `allowedAlgorithms` list. If `jwks_uri` is given, it fetches the set with `fetch` and requires a `keys` array in the response. It then selects the key whose `kid` matches the header, checks that the key's own `alg` matches, and calls `verify` with the header's algorithm.
- **Decoding.** `decode(token)` parses both parts without verifying them, and `decodeHeader` parses only the header. Both are for inspection only and must not be used to make authorization decisions.

Errors are typed. `JwtTokenExpired`, `JwtTokenNotBefore`, `JwtTokenIssuedAt`, `JwtTokenIssuer`, `JwtTokenAudience`, `JwtAlgorithmMismatch`, `JwtAlgorithmNotAllowed`, `JwtSymmetricAlgorithmNotAllowed`, and related classes are defined in `src/utils/jwt/types.ts`, so callers can distinguish failure reasons.

<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The `jwt` middleware calls `Jwt.verify` on the configured secret and algorithm; `jwk` builds on `verifyWithJwks` (see [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md)).

## JWS: Keys and Web Crypto

`jws.ts` converts the key material supplied by callers into `CryptoKey` objects and performs the operation. `SignatureKey` is a string (an HMAC secret), a `HonoJsonWebKey` (a JWK with an optional `kid`), or a `CryptoKey`. `signing` and `verifying` select the Web Crypto algorithm from the JWA name. Key import accepts PEM text, from which the header and footer are stripped and the body is base64-decoded. Keys whose usage does not match the operation are rejected. The runtime detection helper (`getRuntimeKey` in `src/helper/adapter`) is consulted when runtime-specific behavior is needed. A missing `crypto.subtle.importKey` raises a clear error that names the JWT middleware.

## Constant-Time Comparison and Hashing

`src/utils/buffer.ts` provides `timingSafeEqual(a, b, hashFunction?)`. For strings it hashes both values (with `sha256` by default, or the supplied `hashFunction`) and compares the digests and the original values with constant-time string comparison; both checks must succeed. For buffers it hashes both sides and compares the results. This is the function that `basicAuth` uses for credentials, which keeps comparison time independent of where the first differing character appears.

`src/utils/crypto.ts` exposes `sha256`, `sha1`, `md5`, and `createHash(data, algorithm)`, each resolving to a digest string or `null`. The module does not provide random generation; the request-id middleware uses `crypto.randomUUID()` directly by default.

## Encoding

`src/utils/encode.ts` provides `encodeBase64` and `decodeBase64` for byte arrays, using `btoa` and `atob` over a byte-to-character loop so that binary data round-trips correctly. `encodeBase64Url` and `decodeBase64Url` swap the `+` and `/` characters for `-` and `_` and back, which is the form JWTs use for their parts. Keep these helpers for protocol encodings; for text, the utilities in `src/utils/html.ts` and the body helpers are the appropriate layer.

## Cookies

<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/utils/cookie.ts` contains the cookie grammar behind `hono/cookie`. `parse(cookie, name?)` reads a `Cookie` header into a record, and `serialize` produces a `Set-Cookie` value from `CookieOptions` (path, domain, expiry, `httpOnly`, `secure`, `sameSite`, and so on). `parseSigned` and `serializeSigned` add an HMAC-SHA-256 signature so that a value can be verified with the secret before it is trusted. Prefix constraints (`CookiePrefixOptions` is `host` or `secure`) are enforced at the type level for names beginning with `__Host-` and `__Secure-`. The helper layer that exposes these functions to handlers is described in [Helper Modules](/openwiki/helpers/helper-modules.md).

## Request Body Parsing

`src/utils/body.ts` implements `parseBody(request, { all?, dot? })`, which reads `multipart/form-data` and `application/x-www-form-urlencoded` bodies. The `all` option changes how repeated fields are returned (as arrays of every value) and `dot` controls handling of dotted field names. Other content types are not parsed and produce an empty object, so callers that expect a particular encoding should check the content type themselves. The parsed form data is cached on the request so that a later `formData()` call reuses it. `HonoRequest.parseBody` and the method-override middleware use this function.

`src/utils/buffer.ts` also provides `bufferToFormData(arrayBuffer, contentType)`, which the validator uses to rebuild form data from a buffered body, and `bufferToString`.

## Compression Rules

`src/utils/compress.ts` exports `COMPRESSIBLE_CONTENT_TYPE_REGEX`, which matches text types, common application types such as JSON, XML, and JavaScript, font and image types that are text-like, and structured-syntax suffixes such as `+json` and `+xml`. The regular expression is the default filter for the compression middleware and for precompressed static serving, so both agree on which responses are worth compressing.

## Invariants and Failure Behavior

- `verify` checks the algorithm, the time claims, and the issuer and audience before it checks the signature. Those checks reject tokens early but do not make the claims trustworthy; a token is accepted only when every check, including the signature, passes.
- `verifyWithJwks` rejects symmetric algorithms even when the caller includes them in `allowedAlgorithms`, so a shared secret cannot be used as a public key.
- The signing and verification functions throw when Web Crypto is unavailable instead of falling back to a weaker implementation.
- Parsed cookie and form values are strings. Typing a value as a number or a boolean is the caller's responsibility.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Colocated tests cover each module: `src/utils/jwt/jwt.test.ts`, `src/utils/jwt/jwa.test.ts`, `src/utils/buffer.test.ts`, `src/utils/crypto.test.ts`, `src/utils/encode.test.ts`, `src/utils/cookie.test.ts`, `src/utils/body.test.ts`, and `src/utils/mime.test.ts`. See [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md).
