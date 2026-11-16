---
title: "Authentication Middleware"
---
## Overview

Hono ships two middleware that check a shared secret sent in the `Authorization` header: `basicAuth` (`hono/basic-auth`) for user names and passwords, and `bearerAuth` (`hono/bearer-auth`) for opaque tokens. Both compare secrets with `timingSafeEqual`, both accept a callback in place of fixed credentials, and both refuse a request by throwing an `HTTPException` that carries a complete response with a `WWW-Authenticate` header. Signed tokens are handled by the `jwt` and `jwk` middleware described in [[JWT and JWK]].

Sources: [src/middleware/basic-auth/index.ts:80-153](repo://src/middleware/basic-auth/index.ts#L80-L153), [src/middleware/bearer-auth/index.ts:104-221](repo://src/middleware/bearer-auth/index.ts#L104-L221)

Because the refusal is thrown, it reaches the app's error handler. The default handler returns `err.getResponse()`, the response the middleware built, so the client receives the 401 with its headers; a custom `onError` should do the same for `HTTPException`, as [[Request Lifecycle and Middleware]] explains.

Sources: [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

## Choosing between them

| Middleware | Header format | Credentials | Failure statuses |
| --- | --- | --- | --- |
| `basicAuth` | `Basic base64(user:password)` | One or more user/password pairs, or `verifyUser` | 401 |
| `bearerAuth` | `Bearer <token>` (prefix and header configurable) | One token, a list of tokens, or `verifyToken` | 401 missing or wrong token, 400 malformed header |

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/bearer-auth/index.ts:22-66](repo://src/middleware/bearer-auth/index.ts#L22-L66)

## basicAuth

### basicAuth options

`basicAuth(options, ...users)` takes either `username` and `password`, or a `verifyUser(username, password, c)` callback; with neither it throws when the middleware is created. Extra users can be passed as further arguments and are checked after the one in `options`. `realm` defaults to `Secure Area` and `invalidUserMessage` to `Unauthorized`; the message may be a string, an object (sent as JSON), or a function of the context. `onAuthSuccess(c, username)` runs after a successful check, before `next()`, for example to store the user with `c.set`.

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

```ts
import { basicAuth } from 'hono/basic-auth'

app.use(
  '/admin/*',
  basicAuth({
    username: 'hono',
    password: 'acoolproject',
  })
)
```

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

### Parsing the header

`auth(req)` in `utils/basic-auth` matches the header against `Basic <base64>` with the scheme in any case, decodes the Base64 as UTF-8, and splits at the first colon, so a password may contain colons. A header that does not match, invalid Base64, or a decoded value without a colon yields `undefined`, which the middleware treats as wrong credentials.

Sources: [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

### Checking and refusing

With `verifyUser`, the callback decides. Otherwise each configured user is compared: user name and password are compared in parallel with `timingSafeEqual`, and the first user matching on both lets the request through. When nothing matched, the middleware builds a 401 response with `WWW-Authenticate: Basic realm="..."` (quotes in the realm escaped) and the configured message, then throws `HTTPException(401, { res })`.

Sources: [src/middleware/basic-auth/index.ts:105-152](repo://src/middleware/basic-auth/index.ts#L105-L152)

## bearerAuth

### bearerAuth options

`bearerAuth(options)` needs `token` (a string or an array) or `verifyToken(token, c)`, and throws at creation otherwise. `prefix` defaults to `Bearer`; an empty prefix means the whole header value is the token. `headerName` reads the token from a header other than `Authorization`. `realm` defaults to empty.

Sources: [src/middleware/bearer-auth/index.ts:12-14](repo://src/middleware/bearer-auth/index.ts#L12-L14), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120)

### Three failure cases

The middleware tells apart three failures, each with its own status, default `WWW-Authenticate` value and message:

Sources: [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219)

| Case | Status | Default `WWW-Authenticate` | Default body | Options |
| --- | --- | --- | --- | --- |
| Header missing | 401 | `Bearer realm="<realm>"` | `Unauthorized` | `noAuthenticationHeader`, `noAuthenticationHeaderMessage` |
| Prefix missing, or token with characters outside `A-Za-z0-9._~+/-` and trailing `=` | 400 | `Bearer error="invalid_request"` | `Bad Request` | `invalidAuthenticationHeader`, `invalidAuthenticationHeaderMessage` |
| Token does not match | 401 | `Bearer error="invalid_token"` | `Unauthorized` | `invalidToken`, `invalidTokenMessage` |

Sources: [src/middleware/bearer-auth/index.ts:156-219](repo://src/middleware/bearer-auth/index.ts#L156-L219)

Each `*Message` option is a string, an object sent as JSON, or a function of the context. The newer object options also accept `wwwAuthenticateHeader`: a string is used as is, and an object is rendered as `Bearer key="value",...`.

Sources: [src/middleware/bearer-auth/index.ts:16-20](repo://src/middleware/bearer-auth/index.ts#L16-L20), [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154)

### Prefix matching

The prefix is compared case-insensitively and must be followed by a space; spaces after it are trimmed. The token is then checked against the allowed characters before any comparison, so a malformed header never reaches `verifyToken`.

Sources: [src/middleware/bearer-auth/index.ts:170-182](repo://src/middleware/bearer-auth/index.ts#L170-L182)

With a token list, tokens are compared in order and the loop stops at the first match.

Sources: [src/middleware/bearer-auth/index.ts:194-206](repo://src/middleware/bearer-auth/index.ts#L194-L206)

## Timing-safe comparison

`timingSafeEqual(a, b, hashFunction)` from `utils/buffer` hashes both strings, SHA-256 by default or the `hashFunction` option of either middleware, and compares both the hashes and the original strings with a constant-time loop. The loop runs over the longer length, XORs the lengths into the result, and ORs together every character difference, so the time spent does not depend on where the strings first differ. A hash function that returns something other than a string makes the comparison fail.

Sources: [src/utils/buffer.ts:29-63](repo://src/utils/buffer.ts#L29-L63), [src/utils/buffer.ts:76-96](repo://src/utils/buffer.ts#L76-L96)
