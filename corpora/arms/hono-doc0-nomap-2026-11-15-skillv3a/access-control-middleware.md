---
title: "Access Control Middleware"
---
## Overview

These five middleware decide whether a request may reach its handler, or (for CORS) which other origins may read the response. Each is a factory imported from its own subpath that returns a `MiddlewareHandler`. The ones that refuse a request do so by throwing an `HTTPException` that carries a prepared `Response`, so the app's error handler returns it unchanged unless a custom `onError` ignores `getResponse()` (see [[Request Lifecycle and Middleware Composition]]). Token authentication with JWTs is covered separately in [[JWT and JWK Authentication]].

Sources: [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

| Middleware | Import | Checks | Refusal |
| --- | --- | --- | --- |
| `basicAuth` | `hono/basic-auth` | `Authorization: Basic` credentials | 401 with `WWW-Authenticate: Basic realm=...` |
| `bearerAuth` | `hono/bearer-auth` | `Authorization: Bearer` token | 401 missing or wrong token, 400 malformed header |
| `ipRestriction` | `hono/ip-restriction` | Client IP against allow and deny lists | 403 `Forbidden`, or `onError` |
| `cors` | `hono/cors` | `Origin`, preflight requests | Never refuses; omits headers for disallowed origins |
| `csrf` | `hono/csrf` | `Sec-Fetch-Site` and `Origin` on form-like unsafe requests | 403 `Forbidden` |

Sources: [package.json:74-92](repo://package.json#L74-L92), [package.json:124-133](repo://package.json#L124-L133)

## basicAuth

`basicAuth(options, ...moreUsers)` needs either `username` and `password` (optionally more users as extra arguments) or a `verifyUser(username, password, c)` function. It parses the header with `auth()` from `utils/basic-auth`, which accepts the `Basic` scheme in any case, base64-decodes the credentials as UTF-8 and splits at the first colon; a malformed header counts as no credentials.

Sources: [src/middleware/basic-auth/index.ts:80-104](repo://src/middleware/basic-auth/index.ts#L80-L104), [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

With static users, each candidate is compared with `timingSafeEqual`, which hashes both values (SHA-256 by default, or `hashFunction`) and compares both the hashes and the strings in constant time, so the comparison does not leak how many characters matched. On success `onAuthSuccess(c, username)` runs and the chain continues. On failure the middleware throws a 401 whose body is `invalidUserMessage` (a string, an object sent as JSON, or a function of `c`; default `Unauthorized`) and whose `WWW-Authenticate` names `realm` (default `Secure Area`), so browsers show their login prompt.

Sources: [src/middleware/basic-auth/index.ts:105-152](repo://src/middleware/basic-auth/index.ts#L105-L152), [src/utils/buffer.ts:44-63](repo://src/utils/buffer.ts#L44-L63)

Choose it for small internal tools or staging sites where a browser prompt is acceptable.

Sources: [src/middleware/basic-auth/index.ts:132-136](repo://src/middleware/basic-auth/index.ts#L132-L136)

## bearerAuth

`bearerAuth(options)` needs `token` (one string or several) or `verifyToken(token, c)`. It reads `headerName` (default `Authorization`), requires the `prefix` (default `Bearer`, matched case-insensitively and followed by a space; `''` means the whole header is the token), and checks the token against the RFC 6750 token characters. Static tokens are compared with `timingSafeEqual`.

Sources: [src/middleware/bearer-auth/index.ts:104-121](repo://src/middleware/bearer-auth/index.ts#L104-L121), [src/middleware/bearer-auth/index.ts:156-221](repo://src/middleware/bearer-auth/index.ts#L156-L221)

| Situation | Status | Default `WWW-Authenticate` | Override |
| --- | --- | --- | --- |
| No header | 401 | `Bearer realm="..."` | `noAuthenticationHeader` |
| Wrong prefix or invalid characters | 400 | `Bearer error="invalid_request"` | `invalidAuthenticationHeader` |
| Token does not match | 401 | `Bearer error="invalid_token"` | `invalidToken` |

Sources: [src/middleware/bearer-auth/index.ts:156-217](repo://src/middleware/bearer-auth/index.ts#L156-L217)

Each override takes a `message` and a `wwwAuthenticateHeader`, either a string, an object rendered as `key="value"` pairs after the prefix, or a function of `c`. Choose `bearerAuth` for API keys and opaque tokens; use `verifyToken` to look tokens up in a store.

Sources: [src/middleware/bearer-auth/index.ts:16-20](repo://src/middleware/bearer-auth/index.ts#L16-L20), [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154)

## ipRestriction

`ipRestriction(getIP, { denyList, allowList }, onError)` takes the runtime's `getConnInfo` (see [[Runtime Adapters]]) or any function returning an address string. Rules are IPv4 or IPv6 addresses, CIDR ranges, `*`, or predicate functions.

Sources: [src/middleware/ip-restriction/index.ts:218-237](repo://src/middleware/ip-restriction/index.ts#L218-L237), [src/middleware/ip-restriction/index.ts:23-38](repo://src/middleware/ip-restriction/index.ts#L23-L38)

`buildMatcher` prepares each list once. Static addresses go into string and `bigint` sets, including both the IPv4 form and its IPv4-mapped IPv6 form (`::ffff:a.b.c.d`), so either notation matches. CIDR rules become an address and mask pair compared on `bigint` values; a `/32` or `/128` rule is treated as static. Invalid rules throw a `TypeError` when the middleware is created.

Sources: [src/middleware/ip-restriction/index.ts:51-167](repo://src/middleware/ip-restriction/index.ts#L51-L167)

For each request the deny list is checked first and wins. Then an allow-list match passes. With no match the request passes only when the allow list is empty. A missing or unparseable client address is refused. A refusal calls `onError({ addr, type }, c)` when given, otherwise throws a 403.

Sources: [src/middleware/ip-restriction/index.ts:238-278](repo://src/middleware/ip-restriction/index.ts#L238-L278)

## cors

`cors(options)` adds CORS headers and answers preflight requests. Defaults allow every origin (`*`) and the methods `GET, HEAD, PUT, POST, DELETE, PATCH`.

Sources: [src/middleware/cors/index.ts:63-70](repo://src/middleware/cors/index.ts#L63-L70)

| Option | Effect |
| --- | --- |
| `origin` | `*`, one origin, a list, or a function `(origin, c)` returning the allowed origin or `null` |
| `allowMethods` | Array or `(origin, c) => string[]`; sent on preflight |
| `allowHeaders` | Sent on preflight; when empty, the request's `Access-Control-Request-Headers` are echoed |
| `exposeHeaders` | `Access-Control-Expose-Headers` on every response |
| `credentials` | Adds `Access-Control-Allow-Credentials: true` |
| `maxAge` | `Access-Control-Max-Age` on preflight |

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:72-94](repo://src/middleware/cors/index.ts#L72-L94)

On every request the middleware resolves the allowed origin and sets `Access-Control-Allow-Origin` only when one is returned. An `OPTIONS` request is treated as a preflight and answered at once with 204 and the method, header and max-age headers, without running the handler. Other requests continue, and afterwards `Vary: Origin` is appended when the origin is not `*`, so caches keep per-origin copies.

Sources: [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156)

> [!NOTE]
> Because preflight is answered by the middleware, register `cors` with `app.use` on the paths it covers (for example `/api/*`), not only on a `GET` route; otherwise `OPTIONS` requests never reach it.

Sources: [src/middleware/cors/index.ts:114-148](repo://src/middleware/cors/index.ts#L114-L148)

## csrf

`csrf(options)` protects against cross-site form submissions. It only looks at requests that browsers can send cross-site without a preflight: methods other than `GET` and `HEAD` whose `Content-Type` is `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` (a missing type counts as `text/plain`). JSON requests are not checked because a cross-origin JSON request needs a CORS preflight first.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150)

Such a request passes if either check succeeds:

Sources: [src/middleware/csrf/index.ts:138-147](repo://src/middleware/csrf/index.ts#L138-L147)

- **`Sec-Fetch-Site`**: allowed values come from `secFetchSite` (a value, a list or a function); the default allows only `same-origin`. A missing or unknown value fails this check.
- **`Origin`**: allowed origins come from `origin` (a string, a list or a function); the default is the request URL's own origin. A missing header fails this check.

Sources: [src/middleware/csrf/index.ts:94-136](repo://src/middleware/csrf/index.ts#L94-L136)

When both fail, the middleware throws a 403 `Forbidden`. Choose it for apps that accept cookie-authenticated form posts; it relies on headers modern browsers set, so it needs no token in the form.

Sources: [src/middleware/csrf/index.ts:144-147](repo://src/middleware/csrf/index.ts#L144-L147)
