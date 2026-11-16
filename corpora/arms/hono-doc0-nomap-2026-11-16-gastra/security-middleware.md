---
title: "Security Middleware"
---
## Overview

Hono's security middleware participates in the same handler chain as application routes. Authentication middleware can stop execution with an `HTTPException`, while response policy middleware can apply headers after downstream execution. Register these handlers on the paths they should cover using the composition model in [[Request Context and Middleware]]. This catalogue describes the policies implemented by the repository, including their actual failure branches.

Sources: [src/middleware/basic-auth/index.ts:105-151](repo://src/middleware/basic-auth/index.ts#L105-L151), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228), [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## Select an authentication mechanism

| Middleware | Configuration and successful result |
| --- | --- |
| `basicAuth` | Username/password pairs or `verifyUser`; optional `onAuthSuccess` runs before continuing |
| `bearerAuth` | One token, an array of tokens, or `verifyToken`; continues when verification passes |
| `jwt` | Secret/key and explicit algorithm; stores verified data in `jwtPayload` |
| `jwk` | Public keys, a JWKS URI, or callbacks providing them, plus allowed algorithms; stores `jwtPayload` |

Sources: [src/middleware/basic-auth/index.ts:80-129](repo://src/middleware/basic-auth/index.ts#L80-L129), [src/middleware/bearer-auth/index.ts:193-219](repo://src/middleware/bearer-auth/index.ts#L193-L219), [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74), [src/middleware/jwt/jwt.ts:131-156](repo://src/middleware/jwt/jwt.ts#L131-L156), [src/middleware/jwk/jwk.ts:48-73](repo://src/middleware/jwk/jwk.ts#L48-L73), [src/middleware/jwk/jwk.ts:133-166](repo://src/middleware/jwk/jwk.ts#L133-L166)

Basic authentication parses the original request's credentials. A custom verifier may be asynchronous; otherwise both username and password are compared with `timingSafeEqual`. Invalid credentials produce 401 with a Basic challenge. The realm defaults to `Secure Area`, and the invalid-user response can be text, an object serialized as JSON, or a callback. Missing credential configuration throws at middleware construction.

Sources: [src/middleware/basic-auth/index.ts:80-151](repo://src/middleware/basic-auth/index.ts#L80-L151)

Bearer authentication defaults to the `Authorization` header and `Bearer` prefix. A missing header produces 401, an invalid header/token structure produces 400, and failed token verification produces 401. Header name, prefix and each failure's message and challenge are configurable. An empty prefix accepts a bare token value. Static token comparisons use `timingSafeEqual`; a verifier receives the token and request context.

Sources: [src/middleware/bearer-auth/index.ts:12-14](repo://src/middleware/bearer-auth/index.ts#L12-L14), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120), [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219)

## JWT and key-set verification

JWT middleware requires a secret and an algorithm and checks for Web Crypto key import support. It reads a Bearer header first and consults a configured cookie only when that header is absent; signed cookie options are supported. Missing tokens, malformed credentials and failed verification produce 401 challenges. Successful verification sets `c.get('jwtPayload')` for later middleware or handlers.

Sources: [src/middleware/jwt/jwt.ts:53-117](repo://src/middleware/jwt/jwt.ts#L53-L117), [src/middleware/jwt/jwt.ts:119-172](repo://src/middleware/jwt/jwt.ts#L119-L172)

The underlying verifier requires the configured algorithm to match the token header. It checks present `nbf`, `exp` and `iat` claims by default, with options to disable those checks; issuer and audience checks activate when configured. It then verifies the signature. `decode` only parses header and payload, while `sign` produces a signed token. These exported helpers serve different operations and should not be treated as interchangeable verification paths.

Sources: [src/utils/jwt/jwt.ts:56-75](repo://src/utils/jwt/jwt.ts#L56-L75), [src/utils/jwt/jwt.ts:96-187](repo://src/utils/jwt/jwt.ts#L96-L187), [src/utils/jwt/jwt.ts:264-278](repo://src/utils/jwt/jwt.ts#L264-L278), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

JWK middleware can allow a missing token with `allow_anon`, but supplied tokens still go through verification. Key-set verification requires `kid`, rejects symmetric algorithms, checks the allowed algorithm list, merges supplied and fetched keys, and selects by `kid`. A JWK algorithm, when present, must match the token. Plain `Error` failures such as a failed JWKS fetch propagate from the middleware; token verification failures are wrapped as 401.

Sources: [src/middleware/jwk/jwk.ts:118-166](repo://src/middleware/jwk/jwk.ts#L118-L166), [src/utils/jwt/jwt.ts:197-261](repo://src/utils/jwt/jwt.ts#L197-L261)

## Cross-origin policies

`cors` generates response headers from a wildcard, exact origin, origin list or asynchronous origin callback. Defaults allow `*` and the listed standard methods. A nonmatching origin omits the allow-origin header; ordinary requests still run downstream. OPTIONS requests return 204 directly, with configured methods, optional credentials and max age, and either configured allowed headers or the requested header list. Non-wildcard origin configuration adds `Vary: Origin`.

Sources: [src/middleware/cors/index.ts:63-111](repo://src/middleware/cors/index.ts#L63-L111), [src/middleware/cors/index.ts:114-155](repo://src/middleware/cors/index.ts#L114-L155)

`csrf` evaluates requests outside GET and HEAD when their content type is form-compatible: URL-encoded, multipart or text/plain; an absent content type is treated as text/plain. It allows the request if either `Sec-Fetch-Site` or origin validation passes. Defaults accept `same-origin` fetch metadata or an origin equal to the request URL's origin. Missing or unrecognized fetch metadata does not pass that check; if neither policy allows the request, it throws 403.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:94-150](repo://src/middleware/csrf/index.ts#L94-L150)

## Request limits and address rules

`bodyLimit` accepts a byte `maxSize` and optional `onError`. Requests without a body continue immediately. With Content-Length and no Transfer-Encoding, it compares the declared length. Otherwise it reads the body before downstream execution, counts bytes, and stops at overflow. A successful streamed read is reconstructed as the request body. The default overflow response is 413. This placement ensures the unknown-length branch completes its size check even if the final handler never consumes the body.

Sources: [src/middleware/body-limit/index.ts:50-110](repo://src/middleware/body-limit/index.ts#L50-L110)

`ipRestriction` takes a runtime connection-info function or address-returning callback. Rules support literal addresses, CIDR ranges, `*` and predicates; IPv4-mapped IPv6 addresses are normalized for comparisons. The deny list is checked before the allow list. A nonempty allow list requires a match, while an empty one does not impose that additional restriction. Invalid or unavailable addresses are blocked, and denied requests use a custom error callback or the default 403. Runtime address sources are catalogued in [[Runtime Adapters and Static Files]].

Sources: [src/middleware/ip-restriction/index.ts:60-118](repo://src/middleware/ip-restriction/index.ts#L60-L118), [src/middleware/ip-restriction/index.ts:122-165](repo://src/middleware/ip-restriction/index.ts#L122-L165), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

## Response security headers

`secureHeaders` merges options with defaults, prepares header values, waits for downstream execution and applies them. Defaults include same-origin cross-origin resource/opener policies, no-referrer, HSTS, nosniff, SAMEORIGIN framing and removal of `X-Powered-By`; cross-origin embedder policy is disabled by default. Boolean options enable or disable mapped headers, and string values override their defaults. CSP, report-only CSP, permissions policy and reporting endpoints are additional configuration.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:179-237](repo://src/middleware/secure-headers/secure-headers.ts#L179-L237)

The `NONCE` callback creates a random value once per context and stores it as `secureHeadersNonce`. CSP callbacks run before `next` specifically so a page can read that value while rendering; headers are written afterward. This ties policy configuration to [[Server Rendering]] without moving response generation into the security middleware. Nonsecurity response transformations, such as compression and ETags, are covered in [[HTTP and Observability Middleware]].

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228)
