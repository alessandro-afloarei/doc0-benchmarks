---
title: "Security Middleware"
---
## Overview

Built-in security middleware uses the ordinary handler interface: inspect a request, return or throw on failure, and continue on success. Authentication middleware can also attach verified data to the context. Register it on the paths that need it using the execution model in [[Routing and Middleware Execution]]. This catalogue describes the checks implemented here and their failure behavior.

Sources: [src/middleware/basic-auth/index.ts:105-151](repo://src/middleware/basic-auth/index.ts#L105-L151), [src/middleware/jwt/jwt.ts:131-156](repo://src/middleware/jwt/jwt.ts#L131-L156), [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## Authentication choices

| Middleware | Use when the application's credential contract requires |
| --- | --- |
| `basicAuth` | Username/password pairs or an asynchronous user verifier |
| `bearerAuth` | A token matched against configured values or a custom verifier |
| `jwt` | A signed JWT verified with a configured key and algorithm |
| `jwk` | JWT verification using local keys, a JWKS URI, or both |

Sources: [src/middleware/basic-auth/index.ts:80-128](repo://src/middleware/basic-auth/index.ts#L80-L128), [src/middleware/bearer-auth/index.ts:194-215](repo://src/middleware/bearer-auth/index.ts#L194-L215), [src/middleware/jwt/jwt.ts:53-74](repo://src/middleware/jwt/jwt.ts#L53-L74), [src/middleware/jwk/jwk.ts:48-73](repo://src/middleware/jwk/jwk.ts#L48-L73)

Basic authentication requires configured credentials or `verifyUser`. Static credentials are compared with timingSafeEqual; a custom verifier receives username, password and context. On success, an optional `onAuthSuccess` callback runs before downstream handlers. Failure throws HTTPException 401 with a Basic WWW-Authenticate challenge and a configurable text or JSON message.

Sources: [src/middleware/basic-auth/index.ts:80-151](repo://src/middleware/basic-auth/index.ts#L80-L151)

Bearer authentication supports configurable header name and scheme prefix, including an empty prefix. It distinguishes a missing header (401), malformed credential syntax (400), and a rejected token (401). A custom verifier is awaited; configured tokens use timingSafeEqual. The failure options control the message and WWW-Authenticate challenge separately for those cases.

Sources: [src/middleware/bearer-auth/index.ts:122-153](repo://src/middleware/bearer-auth/index.ts#L122-L153), [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219)

## JWT and key-set verification

JWT middleware requires `secret`, `alg`, and Web Crypto key-import support. It reads the configured authorization header first and accepts a two-part Bearer credential. Only when that header is absent does it try the configured cookie, optionally using signed-cookie verification. Missing credentials, malformed header structure, and failed token verification produce 401 responses with a Bearer challenge.

Sources: [src/middleware/jwt/jwt.ts:53-128](repo://src/middleware/jwt/jwt.ts#L53-L128), [src/middleware/jwt/jwt.ts:131-172](repo://src/middleware/jwt/jwt.ts#L131-L172)

The verifier requires three token parts and the expected algorithm, then checks present nbf, exp and iat claims by default. Configured issuer and audience constraints are checked before signature verification. A successful middleware call stores `jwtPayload` for downstream access through the variables described in [[Request and Context]]. The separately exported `decode` helper parses header and payload; it does not perform the signature check.

Sources: [src/utils/jwt/jwt.ts:96-187](repo://src/utils/jwt/jwt.ts#L96-L187), [src/utils/jwt/jwt.ts:264-279](repo://src/utils/jwt/jwt.ts#L264-L279), [src/middleware/jwt/jwt.ts:154-178](repo://src/middleware/jwt/jwt.ts#L154-L178)

JWK middleware can resolve keys and URI dynamically from the context and passes an allowed algorithm list to verifyWithJwks. That helper requires kid, rejects symmetric algorithms, checks the allowlist, fetches configured remote keys, and finds a matching key. If the JWK declares an algorithm, it must match the token header. Anonymous mode skips verification only when no token is found; a supplied invalid token still fails.

Sources: [src/middleware/jwk/jwk.ts:118-166](repo://src/middleware/jwk/jwk.ts#L118-L166), [src/utils/jwt/jwt.ts:211-261](repo://src/utils/jwt/jwt.ts#L211-L261)

Remote JWKS fetch failure and malformed key-set responses throw ordinary Error objects. The JWK middleware rethrows an error whose constructor is exactly Error; other verification failures are wrapped as authentication failures. This preserves the distinction between key retrieval/configuration failure and a rejected credential through the application's error handling.

Sources: [src/utils/jwt/jwt.ts:230-245](repo://src/utils/jwt/jwt.ts#L230-L245), [src/middleware/jwk/jwk.ts:144-161](repo://src/middleware/jwk/jwk.ts#L144-L161)

## Browser request policy

CORS middleware sets Access-Control-Allow-Origin when its configured origin matcher accepts the request. The default origin is `*`; strings, arrays and functions provide alternatives. Credentials and exposed headers are optional. OPTIONS requests are answered directly with status 204, configured allowed methods, requested or configured allowed headers, and no body content headers. Ordinary requests continue, then add Vary: Origin when the origin configuration is not the wildcard.

Sources: [src/middleware/cors/index.ts:63-103](repo://src/middleware/cors/index.ts#L63-L103), [src/middleware/cors/index.ts:106-155](repo://src/middleware/cors/index.ts#L106-L155)

CSRF middleware checks requests that fail its safe-method test and match its form-content-type test. For those requests, rejection occurs only when both the Sec-Fetch-Site check and Origin check fail. Defaults accept same-origin fetch metadata or an Origin equal to the request URL's origin. Missing headers fail their respective checks; configuration accepts explicit values, lists, or async callbacks. A rejected request throws HTTPException 403.

Sources: [src/middleware/csrf/index.ts:94-150](repo://src/middleware/csrf/index.ts#L94-L150)

Secure-headers middleware merges configuration with its defaults and builds the response header list. CSP callbacks run before `next()` so they can populate context values used during rendering; actual headers are applied afterward. The NONCE helper generates and caches a request nonce. By default the middleware removes X-Powered-By after downstream processing, so its placement relative to the middleware in [[HTTP Middleware]] affects the final header set.

Sources: [src/middleware/secure-headers/secure-headers.ts:110-145](repo://src/middleware/secure-headers/secure-headers.ts#L110-L145), [src/middleware/secure-headers/secure-headers.ts:179-228](repo://src/middleware/secure-headers/secure-headers.ts#L179-L228)

## Address and body guards

IP restriction accepts an address provider, deny list, allow list, and optional error callback. It checks denial before allowance. A matching allow entry continues, while an empty allow list permits addresses not denied. A nonempty allow list rejects unmatched addresses. Missing addresses and invalid parsed IP addresses produce 403; ordinary deny/unmatched cases may use the custom callback. Runtime connection helpers supplying addresses are covered in [[Runtime Adapters]].

Sources: [src/middleware/ip-restriction/index.ts:218-278](repo://src/middleware/ip-restriction/index.ts#L218-L278)

Body-limit middleware skips requests without bodies. If Content-Length exists without Transfer-Encoding, it compares that declared size directly. Otherwise it reads the stream before the handler runs, counts byte lengths, and stops on overflow. Accepted chunks are placed into a replacement Request body so downstream consumers can still read them. The default overflow callback throws HTTPException 413; a supplied callback can return a different response.

Sources: [src/middleware/body-limit/index.ts:50-109](repo://src/middleware/body-limit/index.ts#L50-L109)

