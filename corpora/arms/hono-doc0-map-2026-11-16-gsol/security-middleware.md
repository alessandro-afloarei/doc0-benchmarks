---
title: "Security Middleware"
---
## Overview

Security middleware uses the normal handler continuation to admit requests, attach authenticated data, or produce a failure response before the endpoint runs. The built-ins cover credentials, signed tokens, browser origin checks, response policies, body size and remote addresses. Apply their route scope using [[Routing]] and read [[Middleware and Errors]] for composition and HTTP exception recovery; this catalogue focuses on each policy's actual decision.

Sources: [src/middleware/basic-auth/index.ts:105-150](repo://src/middleware/basic-auth/index.ts#L105-L150), [src/middleware/jwt/jwt.ts:119-156](repo://src/middleware/jwt/jwt.ts#L119-L156), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150), [src/middleware/body-limit/index.ts:61-109](repo://src/middleware/body-limit/index.ts#L61-L109), [src/middleware/ip-restriction/index.ts:238-277](repo://src/middleware/ip-restriction/index.ts#L238-L277)

## Credential policies

| Middleware | Required policy | Admission and failure behavior |
| --- | --- | --- |
| `basicAuth` | Username/password entries or `verifyUser` | Verifies parsed credentials, optionally awaits `onAuthSuccess`, then advances; invalid credentials produce a Basic challenge and 401 |
| `bearerAuth` | One or more tokens or `verifyToken` | Checks a configurable header and prefix; missing/invalid tokens produce 401 and malformed credentials produce 400 |
| `jwt` | Secret/key and explicit `alg` | Verifies a header or fallback cookie token and stores `jwtPayload`; failures produce 401 |
| `jwk` | Local keys and/or `jwks_uri`, with allowed asymmetric algorithms | Resolves a key by token `kid`, verifies, and stores `jwtPayload`; `allow_anon` permits a missing token |

Sources: [src/middleware/basic-auth/index.ts:80-150](repo://src/middleware/basic-auth/index.ts#L80-L150), [src/middleware/bearer-auth/index.ts:104-119](repo://src/middleware/bearer-auth/index.ts#L104-L119), [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219), [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74), [src/middleware/jwt/jwt.ts:119-156](repo://src/middleware/jwt/jwt.ts#L119-L156), [src/middleware/jwk/jwk.ts:48-72](repo://src/middleware/jwk/jwk.ts#L48-L72), [src/middleware/jwk/jwk.ts:118-166](repo://src/middleware/jwk/jwk.ts#L118-L166), [src/utils/jwt/jwt.ts:209-258](repo://src/utils/jwt/jwt.ts#L209-L258)

Basic authentication checks configured usernames and passwords with `timingSafeEqual`, or delegates to the asynchronous `verifyUser` callback. The success callback receives the context and username before downstream execution, making it the extension for setting user state. Bearer authentication separately customizes missing-header, malformed-header and invalid-token messages and `WWW-Authenticate` values; the values can be computed from the context. These policies authenticate credentials without imposing an application-specific user model.

Sources: [src/middleware/basic-auth/index.ts:105-140](repo://src/middleware/basic-auth/index.ts#L105-L140), [src/middleware/bearer-auth/index.ts:122-153](repo://src/middleware/bearer-auth/index.ts#L122-L153), [src/middleware/bearer-auth/index.ts:156-215](repo://src/middleware/bearer-auth/index.ts#L156-L215)

## JWT verification and key selection

JWT middleware requires Web Crypto's `subtle.importKey` and an explicit algorithm. It checks the configured header first, requires a two-part Bearer credential, and consults cookies only when that header is absent. A cookie may be plain or signed and may use secure/host prefix options. Successful verification writes `jwtPayload` through `ctx.set`, using the per-request state described in [[Request and Context]]. The original verification failure is attached as the cause of its unauthorized exception.

Sources: [src/middleware/jwt/jwt.ts:53-117](repo://src/middleware/jwt/jwt.ts#L53-L117), [src/middleware/jwt/jwt.ts:131-156](repo://src/middleware/jwt/jwt.ts#L131-L156)

The shared verifier checks the token's three-part structure and header algorithm, validates present `nbf`, `exp` and `iat` claims by default, and optionally enforces issuer and audience. It then verifies the signature over the encoded header and payload. `sign` creates signed tokens, while `decode` only decodes header and payload; the latter does not run these verification branches. Verification options control claim checks, and are passed through by the JWT and JWK middleware.

Sources: [src/utils/jwt/jwt.ts:56-75](repo://src/utils/jwt/jwt.ts#L56-L75), [src/utils/jwt/jwt.ts:96-185](repo://src/utils/jwt/jwt.ts#L96-L185), [src/utils/jwt/jwt.ts:264-278](repo://src/utils/jwt/jwt.ts#L264-L278), [src/middleware/jwk/jwk.ts:135-143](repo://src/middleware/jwk/jwk.ts#L135-L143)

JWKS verification requires a `kid`, rejects symmetric algorithms to prevent algorithm confusion, and checks the explicit algorithm allowlist. Remote keys are fetched and appended to supplied keys; the response must contain a `keys` array. The first matching `kid` is selected, and a key's own algorithm must agree with the header when present. JWK middleware propagates a plain `Error` from infrastructure failures while translating token-verification failures into unauthorized responses.

Sources: [src/utils/jwt/jwt.ts:209-261](repo://src/utils/jwt/jwt.ts#L209-L261), [src/middleware/jwk/jwk.ts:135-161](repo://src/middleware/jwk/jwk.ts#L135-L161)

## Cookies in authentication flows

Cookie helpers read named or all cookie values; signed reads can return false for an invalid signature. Writers append `Set-Cookie` so multiple values coexist. Prefix generation forces `secure` for `__Secure-`, and forces secure, root path and no domain for `__Host-`. `deleteCookie` returns the old value and sets an empty value with `maxAge: 0`. These helpers manage token transport and signing independently of JWT payload verification.

Sources: [src/helper/cookie/index.ts:10-75](repo://src/helper/cookie/index.ts#L10-L75), [src/helper/cookie/index.ts:78-144](repo://src/helper/cookie/index.ts#L78-L144)

## Browser request and response policies

CSRF middleware checks non-GET/HEAD requests with form-compatible content types, treating an absent content type as text/plain. It allows the request if either the `Sec-Fetch-Site` policy or the origin policy passes. Defaults accept `same-origin` or an origin equal to the request URL's origin. Missing or unrecognized metadata fails that individual check; failure of both checks produces 403. Strings, arrays and context-aware callbacks customize the accepted values. CORS response behavior is covered separately in [[HTTP Middleware]].

Sources: [src/middleware/csrf/index.ts:23-30](repo://src/middleware/csrf/index.ts#L23-L30), [src/middleware/csrf/index.ts:94-150](repo://src/middleware/csrf/index.ts#L94-L150)

`secureHeaders` exposes boolean switches and string overrides for its fixed header map, plus CSP, report-only CSP, reporting and permissions-policy options. Defaults enable headers including HSTS, no-sniff, same-origin resource/opener policy and frame protection; cross-origin embedder policy starts disabled. Per-request CSP callbacks evaluate with the context. Headers are applied after `await next()`, and the merged `removePoweredBy` option controls deleting `X-Powered-By`.

Sources: [src/middleware/secure-headers/secure-headers.ts:69-124](repo://src/middleware/secure-headers/secure-headers.ts#L69-L124), [src/middleware/secure-headers/secure-headers.ts:220-237](repo://src/middleware/secure-headers/secure-headers.ts#L220-L237), [src/middleware/secure-headers/secure-headers.ts:240-287](repo://src/middleware/secure-headers/secure-headers.ts#L240-L287)

## Size and address decisions

`bodyLimit` compares `Content-Length` when it is present without transfer encoding. Otherwise it reads and counts all chunks before calling the endpoint, rejecting above `maxSize` and rebuilding the raw request body on success. Transfer encoding takes precedence over content length. A custom `onError` can supply the overflow response; the default throws a 413 `Payload Too Large` exception. Place it before body-consuming handlers so this admission decision runs first.

Sources: [src/middleware/body-limit/index.ts:50-109](repo://src/middleware/body-limit/index.ts#L50-L109)

`ipRestriction` takes an address getter or runtime connection-info getter and compiles static, CIDR, wildcard and function rules. Deny matches run first, then allow matches; an empty allow list permits remaining addresses. Missing or invalid addresses are blocked, and a configured allow list blocks unmatched addresses. Normal rule rejection may call `onError`; missing addresses and caught invalid-address errors use the built-in 403 exception. [[Runtime Adapters and Static Files]] explains where connection details enter the context.

Sources: [src/middleware/ip-restriction/index.ts:51-118](repo://src/middleware/ip-restriction/index.ts#L51-L118), [src/middleware/ip-restriction/index.ts:218-277](repo://src/middleware/ip-restriction/index.ts#L218-L277)
