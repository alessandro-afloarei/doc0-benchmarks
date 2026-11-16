---
title: "Authentication and Security Middleware"
---
## Overview

These middleware sit in front of handlers to reject or annotate requests. They share one shape: a factory such as `basicAuth(options)` validates its options immediately (throwing an `Error` for missing ones) and returns an `async (c, next)` function. A rejection is thrown as an `HTTPException` that carries a ready-made `Response`, so the default error handler returns it unchanged (see [[Application and Request Dispatch]]). Register them with `app.use(path, middleware)` before the routes they protect.

Sources: [src/middleware/basic-auth/index.ts:80-105](repo://src/middleware/basic-auth/index.ts#L80-L105), [src/middleware/basic-auth/index.ts:151-152](repo://src/middleware/basic-auth/index.ts#L151-L152), [src/hono-base.ts:35-39](repo://src/hono-base.ts#L35-L39)

| Middleware | Use it to | Failure response |
| --- | --- | --- |
| `basicAuth` | Check a username and password from the `Authorization` header | 401 with `WWW-Authenticate: Basic realm=...` |
| `bearerAuth` | Check an opaque bearer token against fixed tokens or your own `verifyToken` | 400 malformed header, 401 missing or wrong token |
| `jwt` | Verify a signed JWT with a shared secret or key | 401 with `Bearer ... error=` |
| `jwk` | Verify a JWT with public keys, either given or fetched from a `jwks_uri` | 401, or pass through when `allow_anon` |
| `cors` | Answer cross-origin requests and preflight | 204 for `OPTIONS` |
| `csrf` | Reject cross-site form-type writes | 403 `Forbidden` |
| `secureHeaders` | Add security headers to every response | none |
| `ipRestriction` | Allow or deny by client IP, IPv4 or IPv6, with CIDR rules | 403 `Forbidden` |
| `bodyLimit` | Cap the request body size | 413 `Payload Too Large` |

Sources: [src/middleware/basic-auth/index.ts:132-151](repo://src/middleware/basic-auth/index.ts#L132-L151), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220), [src/middleware/jwt/jwt.ts:119-158](repo://src/middleware/jwt/jwt.ts#L119-L158), [src/middleware/jwk/jwk.ts:118-168](repo://src/middleware/jwk/jwk.ts#L118-L168), [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150), [src/middleware/ip-restriction/index.ts:238-278](repo://src/middleware/ip-restriction/index.ts#L238-L278), [src/middleware/body-limit/index.ts:50-61](repo://src/middleware/body-limit/index.ts#L50-L61)

## Credential checks

### Basic auth

`basicAuth` takes either `username` and `password` (plus optional extra users as further arguments) or a `verifyUser(username, password, c)` function. It reads the header with `auth(ctx.req.raw)`. With static users it compares username and password with `timingSafeEqual`, optionally hashing both with `hashFunction`; with `verifyUser` it awaits your function. On success it calls `onAuthSuccess(c, username)` and then `next()`. Otherwise it answers 401 with `realm` (default `Secure Area`) and an `invalidUserMessage` (default `Unauthorized`), which may be a string, an object sent as JSON, or a function of the context.

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:84-151](repo://src/middleware/basic-auth/index.ts#L84-L151)

### Bearer auth

`bearerAuth` needs `token` (a string or array) or `verifyToken(token, c)`. It reads `Authorization` (or `headerName`), expects the `Bearer` prefix (configurable, may be empty) followed by a space and a token matching `[A-Za-z0-9._~+/-]+=*`. Three failures have separate options for the `WWW-Authenticate` header and the message: no header (401), a malformed header (400, `error="invalid_request"`) and a wrong token (401, `error="invalid_token"`). Token comparison uses `timingSafeEqual`, trying each array entry in turn.

Sources: [src/middleware/bearer-auth/index.ts:12-66](repo://src/middleware/bearer-auth/index.ts#L12-L66), [src/middleware/bearer-auth/index.ts:156-220](repo://src/middleware/bearer-auth/index.ts#L156-L220)

### JWT

`jwt({ secret, alg, cookie, headerName, verification })` requires `secret` and `alg` and needs `crypto.subtle.importKey`. The token comes from the `Authorization` header as `Bearer <token>` (any other structure is a 401 `invalid_request`), or, when no header is present, from a cookie named by `cookie` (plain, signed when a `secret` is given, with optional prefix options). `Jwt.verify` then checks it; on success the payload is stored with `ctx.set('jwtPayload', payload)` for handlers to read through `c.get`, and `JwtVariables` types that key. A failed verification is a 401 `invalid_token` with the original error as `cause`.

Sources: [src/middleware/jwt/jwt.ts:17-20](repo://src/middleware/jwt/jwt.ts#L17-L20), [src/middleware/jwt/jwt.ts:53-158](repo://src/middleware/jwt/jwt.ts#L53-L158)

### JWK

`jwk` has the same token extraction and `jwtPayload` result as `jwt` but verifies with public keys: `keys` (an array or function of the context) and/or `jwks_uri` (string or function), and an `alg` list of asymmetric algorithms. It calls `Jwt.verifyWithJwks`, passing an optional `RequestInit` for the key fetch. With `allow_anon: true` a request without a token goes on to `next()` without a payload. A plain `Error` thrown while verifying (not a verification failure) is rethrown instead of being converted into a 401.

Sources: [src/middleware/jwk/jwk.ts:48-64](repo://src/middleware/jwk/jwk.ts#L48-L64), [src/middleware/jwk/jwk.ts:75-168](repo://src/middleware/jwk/jwk.ts#L75-L168)

## Browser-facing protection

### CORS

`cors(options)` defaults to origin `*` and allowed methods `GET, HEAD, PUT, POST, DELETE, PATCH`. `origin` can be a string, a list, or a function returning the origin to echo (or nothing). It sets `Access-Control-Allow-Origin` and, if configured, `-Allow-Credentials` and `-Expose-Headers`. For `OPTIONS` it also sets `Access-Control-Max-Age`, `-Allow-Methods` and `-Allow-Headers` (falling back to the request's `Access-Control-Request-Headers`), removes `Content-Length` and `Content-Type`, and returns a 204 itself without calling `next()`. For other methods it calls `next()` and, when the origin is not `*`, appends `Vary: Origin`.

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:63-156](repo://src/middleware/cors/index.ts#L63-L156)

### CSRF

`csrf` only checks requests that are not `GET` or `HEAD` and whose `Content-Type` is one a form can send (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, or absent). Such a request passes if either check allows it: `Sec-Fetch-Site` equals an allowed value (default only `same-origin`) or `Origin` is allowed (default: the request URL's own origin). A missing header counts as not allowed. Otherwise it throws a 403.

Sources: [src/middleware/csrf/index.ts:12-31](repo://src/middleware/csrf/index.ts#L12-L31), [src/middleware/csrf/index.ts:94-150](repo://src/middleware/csrf/index.ts#L94-L150)

### Secure headers

`secureHeaders(options)` merges your options over defaults and builds the list of headers once. By default it sets `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, `Origin-Agent-Cluster`, `Referrer-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Frame-Options`, `X-Permitted-Cross-Domain-Policies` and `X-XSS-Protection`; `Cross-Origin-Embedder-Policy` is off. A string option replaces a header's value. `contentSecurityPolicy`, its report-only twin, `permissionsPolicy`, `reportingEndpoints` and `reportTo` add structured headers.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:179-238](repo://src/middleware/secure-headers/secure-headers.ts#L179-L238)

Headers are written after `await next()`, and `removePoweredBy` (on by default) deletes `X-Powered-By`. A CSP value may include functions; the exported `NONCE` function generates a random nonce, stores it under the context variable `secureHeadersNonce` and inserts `'nonce-...'`, which a page can read to emit matching script tags. Callback values are evaluated before `next()` so the nonce is available to handlers.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

## Request admission

### IP restriction

`ipRestriction(getIP, { denyList, allowList }, onError)` takes a function that yields the client address: either a `getConnInfo` function (see [[Platform Adapters and Connection Info]]) or a function returning a string. Rules are exact IPv4 or IPv6 addresses, CIDR ranges, or functions; IPv4 rules also match the IPv4-mapped IPv6 form. A request without an address is blocked. A matching deny rule blocks it (via `onError` when supplied, else a 403 `HTTPException`); a matching allow rule lets it through; with no allow rules everything not denied passes, and with allow rules everything not matched is blocked. An invalid address is also blocked.

Sources: [src/middleware/ip-restriction/index.ts:23-79](repo://src/middleware/ip-restriction/index.ts#L23-L79), [src/middleware/ip-restriction/index.ts:218-278](repo://src/middleware/ip-restriction/index.ts#L218-L278)

### Body limit

`bodyLimit({ maxSize, onError })` ignores requests without a body. When only `Content-Length` is present it trusts it and compares with `maxSize`. When `Transfer-Encoding` is present or no length is given, it reads the whole body first, rejecting as soon as the running size exceeds the limit, then replaces `c.req.raw` with a new `Request` over the buffered chunks so later `c.req.json()` or `c.req.formData()` calls still work. The default rejection is a 413 `Payload Too Large` `HTTPException`.

Sources: [src/middleware/body-limit/index.ts:10-16](repo://src/middleware/body-limit/index.ts#L10-L16), [src/middleware/body-limit/index.ts:50-110](repo://src/middleware/body-limit/index.ts#L50-L110)
