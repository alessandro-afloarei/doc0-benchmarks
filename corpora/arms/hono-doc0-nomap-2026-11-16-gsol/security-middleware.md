---
title: "Security Middleware"
---
## Overview

Hono's security middleware participates in the same routed handler chain as an endpoint. Authentication checks credentials before continuing; origin middleware manages cross-origin headers or rejects selected requests; body and address policies decide whether a request can proceed. [[Middleware and Errors]] explains continuation and HTTPException recovery. Configure each policy for the route where it applies, using the concrete behavior below rather than treating all checks as interchangeable.

Sources: [src/middleware/basic-auth/index.ts:105-151](repo://src/middleware/basic-auth/index.ts#L105-L151), [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156), [src/middleware/body-limit/index.ts:61-109](repo://src/middleware/body-limit/index.ts#L61-L109)

## Select an authentication check

| Import | Choose it for | Successful output |
| --- | --- | --- |
| `hono/basic-auth` | Username/password pairs or `verifyUser` | Optional `onAuthSuccess`, then continuation |
| `hono/bearer-auth` | A token, token list, or `verifyToken` callback | Continuation after comparison |
| `hono/jwt` | Verification with an explicit secret/key and algorithm | `jwtPayload` context variable |
| `hono/jwk` | Public keys or a JWKS URI with allowed asymmetric algorithms | `jwtPayload` context variable |

Sources: [src/middleware/basic-auth/index.ts:80-128](repo://src/middleware/basic-auth/index.ts#L80-L128), [src/middleware/bearer-auth/index.ts:104-119](repo://src/middleware/bearer-auth/index.ts#L104-L119), [src/middleware/bearer-auth/index.ts:194-219](repo://src/middleware/bearer-auth/index.ts#L194-L219), [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74), [src/middleware/jwt/jwt.ts:131-156](repo://src/middleware/jwt/jwt.ts#L131-L156), [src/middleware/jwk/jwk.ts:48-73](repo://src/middleware/jwk/jwk.ts#L48-L73), [src/middleware/jwk/jwk.ts:133-166](repo://src/middleware/jwk/jwk.ts#L133-L166)

Basic authentication requires either username/password options or `verifyUser`; invalid construction throws an ordinary error. Static users are compared with `timingSafeEqual` for both fields. Successful authentication can await `onAuthSuccess` before continuing. Failure throws HTTPException 401 with a Basic challenge. The default realm is `Secure Area`, and the default failure body is `Unauthorized`; a configured message can be a string, an object, or a callback returning either.

Sources: [src/middleware/basic-auth/index.ts:80-151](repo://src/middleware/basic-auth/index.ts#L80-L151)

Bearer authentication lets the caller change the header name, prefix, comparison function, and failure messages/challenges. Missing authentication returns 401; malformed token structure returns 400; a token that fails verification returns 401. An empty prefix makes the whole header the token. Static token values use timing-safe comparison, while `verifyToken` can make an asynchronous decision from the token and context. It does not populate the JWT payload variable.

Sources: [src/middleware/bearer-auth/index.ts:104-154](repo://src/middleware/bearer-auth/index.ts#L104-L154), [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219)

## Verify JWTs and public keys

JWT middleware requires `secret`, `alg`, and Web Crypto key-import support. It reads a Bearer token from the configured header, falling back to the configured cookie only when that header is absent. A cookie can be ordinary or signed. Missing tokens, malformed credential structure, and failed verification produce 401 exceptions with Bearer challenge information. Successful verification writes `jwtPayload` before awaiting the next handler, using the request-local storage described in [[Request and Context]].

Sources: [src/middleware/jwt/jwt.ts:53-156](repo://src/middleware/jwt/jwt.ts#L53-L156)

The verification options include issuer and audience expectations and switches for `nbf`, `exp`, and `iat` checks. The verifier requires the token header algorithm to equal the configured algorithm. Time checks default to enabled when their claims are present; invalid claim types and out-of-range time values fail verification. The middleware forwards its `verification` options into that operation. Standalone `sign`, `verify`, `decode`, and `verifyWithJwks` are also exported by the JWT implementation.

Sources: [src/utils/jwt/jwt.ts:78-165](repo://src/utils/jwt/jwt.ts#L78-L165), [src/middleware/jwt/jwt.ts:131-137](repo://src/middleware/jwt/jwt.ts#L131-L137), [src/middleware/jwt/jwt.ts:175-178](repo://src/middleware/jwt/jwt.ts#L175-L178)

JWK middleware resolves configured keys and a JWKS URI, including context-dependent callbacks, then calls `verifyWithJwks` with the allowed algorithms and verification options. It supports the same header/cookie token sources. `allow_anon` permits an absent token to continue; it does not turn a supplied invalid token into a successful authentication. Verification failures generally become 401, while a plain `Error` from the verification operation is rethrown by its explicit branch.

Sources: [src/middleware/jwk/jwk.ts:75-130](repo://src/middleware/jwk/jwk.ts#L75-L130), [src/middleware/jwk/jwk.ts:133-166](repo://src/middleware/jwk/jwk.ts#L133-L166)

## Apply origin policies

CORS defaults to wildcard origin and the listed GET, HEAD, PUT, POST, DELETE, and PATCH methods. Origin can be a string, list, or callback; methods can also be computed. It sets allow-origin when the resolver supplies one, and can set credentials and exposed headers. OPTIONS handling returns a null-body 204 with preflight headers, uses requested headers when no allow-header list is supplied, and removes content length and type. Ordinary requests continue downstream and append `Vary: Origin` for non-wildcard configuration.

Sources: [src/middleware/cors/index.ts:63-94](repo://src/middleware/cors/index.ts#L63-L94), [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156)

CSRF protection checks unsafe methods with form-compatible content types, including the missing-content-type fallback of plain text. It rejects only when both the fetch-site and origin checks fail. Defaults accept `same-origin` fetch-site or an origin equal to the request URL's origin. Missing values fail their respective checks. Strings, arrays, and callbacks can customize both policies. A rejected request produces `Forbidden` through HTTPException 403.

Sources: [src/middleware/csrf/index.ts:13-32](repo://src/middleware/csrf/index.ts#L13-L32), [src/middleware/csrf/index.ts:94-150](repo://src/middleware/csrf/index.ts#L94-L150)

## Bound request admission

`bodyLimit` requires `maxSize` and optionally accepts `onError`; its default failure is 413. With no body it continues. With content length and no transfer encoding, it compares that length directly. Otherwise it reads chunks before invoking the handler and rejects as soon as the accumulated byte count exceeds the limit. For an accepted body it replaces the raw request with a replayable stream of those chunks, so downstream body parsing can still consume the input.

Sources: [src/middleware/body-limit/index.ts:50-109](repo://src/middleware/body-limit/index.ts#L50-L109)

`ipRestriction` accepts a runtime connection-info function or address extractor, deny and allow rules, and an optional failure callback. A deny match wins before the allow check. With no allow entries, an address not denied continues; with an allow list, it must match. Missing and invalid addresses use a 403 failure branch. Obtain the connection-info function for the actual runtime as described in [[Runtime Adapters]]; the middleware consumes that address rather than discovering the platform itself.

Sources: [src/middleware/ip-restriction/index.ts:180-184](repo://src/middleware/ip-restriction/index.ts#L180-L184), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

## Set response security headers

`secureHeaders` merges its defaults with caller options, supports string overrides for mapped headers, and can construct CSP, report-only CSP, permissions policy, and reporting headers. CSP values can include context callbacks. Its nonce helper stores `secureHeadersNonce` on the context and returns a CSP nonce value. The middleware runs downstream before setting its prepared headers and can remove `X-Powered-By`, which is enabled by default. [[HTML and JSX Rendering]] explains where server rendering can consume per-request values.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-147](repo://src/middleware/secure-headers/secure-headers.ts#L94-L147), [src/middleware/secure-headers/secure-headers.ts:160-230](repo://src/middleware/secure-headers/secure-headers.ts#L160-L230), [src/middleware/secure-headers/secure-headers.ts:240-285](repo://src/middleware/secure-headers/secure-headers.ts#L240-L285)

## Read and write authentication cookies

`getCookie` returns one parsed cookie or the parsed collection. `getSignedCookie` is asynchronous and distinguishes a string value, absence, and failed verification through its return type. Setters generate a serialized value and append `Set-Cookie`; generators return that value without changing the response. The secure prefix forces `secure`, while the host prefix additionally forces path `/` and removes the domain. `deleteCookie` returns the previous value and writes an empty value with maximum age zero.

Sources: [src/helper/cookie/index.ts:10-75](repo://src/helper/cookie/index.ts#L10-L75), [src/helper/cookie/index.ts:78-144](repo://src/helper/cookie/index.ts#L78-L144)
