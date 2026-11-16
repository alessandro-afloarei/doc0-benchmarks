---
title: "Authentication Middleware"
---
## Overview

Hono ships two middleware for credentials sent in the `Authorization` header: `basicAuth` from `hono/basic-auth` for HTTP Basic authentication, and `bearerAuth` from `hono/bearer-auth` for opaque bearer tokens. Both let the request through with `await next()` when the credentials match, and otherwise throw an `HTTPException` that carries a complete response, which the app's error handler returns as it is ([[Request Dispatch and Middleware]]). Signed tokens are handled by the `jwt` and `jwk` middleware on [[JWT and JWK]].

Sources: [src/middleware/basic-auth/index.ts:80-153](repo://src/middleware/basic-auth/index.ts#L80-L153), [src/middleware/bearer-auth/index.ts:104-221](repo://src/middleware/bearer-auth/index.ts#L104-L221), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

Both compare secrets with `timingSafeEqual` from `utils/buffer`, described at the end of this page.

Sources: [src/middleware/basic-auth/index.ts:117-129](repo://src/middleware/basic-auth/index.ts#L117-L129), [src/middleware/bearer-auth/index.ts:194-206](repo://src/middleware/bearer-auth/index.ts#L194-L206)

## basicAuth

```ts
import { basicAuth } from 'hono/basic-auth'

app.use(
  '/admin/*',
  basicAuth({ username: 'hono', password: 'acoolproject' }, { username: 'alice', password: 's3cret' })
)
```

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

`basicAuth(options, ...users)` takes either a `username` and `password` or a `verifyUser(username, password, c)` function, and throws at setup when it gets neither. Extra users passed after the options are accepted in the first form; the options' own user is put first in the list.

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103)

| Option | Default | Effect |
| --- | --- | --- |
| `username`, `password` | | A user to accept |
| `verifyUser` | | Decides instead of the user list; may be async and receives the Context |
| `realm` | `Secure Area` | The realm in `WWW-Authenticate` |
| `hashFunction` | SHA-256 | Hash used by the constant-time comparison |
| `invalidUserMessage` | `Unauthorized` | A string, an object (sent as JSON), or a function of the Context returning either |
| `onAuthSuccess` | | Called with the Context and the username before `next()` |

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29), [src/middleware/basic-auth/index.ts:93-99](repo://src/middleware/basic-auth/index.ts#L93-L99)

The `auth` helper parses the header. It matches `Basic <base64>` case-insensitively, decodes the base64 as UTF-8, and splits at the first `:`, so a password may contain colons. Invalid base64 makes `atob` throw, which `auth` catches and treats as no credentials.

Sources: [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

For each request, with credentials present, the middleware either awaits `verifyUser` or compares the username and the password against each user in turn, both in parallel with `timingSafeEqual`. On the first match it runs `onAuthSuccess` and `next()`.

Sources: [src/middleware/basic-auth/index.ts:105-131](repo://src/middleware/basic-auth/index.ts#L105-L131)

Otherwise it answers 401 with `WWW-Authenticate: Basic realm="…"`, with quotes in the realm escaped. A string message is sent as the body; an object is sent as JSON with `content-type: application/json`. The response is thrown inside `HTTPException(401, { res })`.

Sources: [src/middleware/basic-auth/index.ts:132-152](repo://src/middleware/basic-auth/index.ts#L132-L152)

## bearerAuth

```ts
import { bearerAuth } from 'hono/bearer-auth'

app.use('/api/*', bearerAuth({ token: ['token-a', 'token-b'] }))
```

Sources: [src/middleware/bearer-auth/index.ts:22-44](repo://src/middleware/bearer-auth/index.ts#L22-L44)

`bearerAuth(options)` takes a `token` (a string or an array) or a `verifyToken(token, c)` function, and throws at setup when neither is given.

Sources: [src/middleware/bearer-auth/index.ts:104-109](repo://src/middleware/bearer-auth/index.ts#L104-L109)

| Option | Default | Effect |
| --- | --- | --- |
| `token` | | Accepted token, or list of tokens |
| `verifyToken` | | Decides instead of `token`; may be async |
| `headerName` | `Authorization` | Header to read |
| `prefix` | `Bearer` | Scheme before the token; `''` reads the whole header as the token |
| `realm` | `''` | The realm in `WWW-Authenticate` |
| `hashFunction` | SHA-256 | Hash used by the constant-time comparison |
| `noAuthenticationHeader`, `invalidAuthenticationHeader`, `invalidToken` | | `{ wwwAuthenticateHeader, message }` for each failure; each also has an older `…Message` option |

Sources: [src/middleware/bearer-auth/index.ts:12-66](repo://src/middleware/bearer-auth/index.ts#L12-L66), [src/middleware/bearer-auth/index.ts:110-120](repo://src/middleware/bearer-auth/index.ts#L110-L120)

The middleware fails in three distinct ways, each with its own status and default `WWW-Authenticate` value:

Sources: [src/middleware/bearer-auth/index.ts:156-221](repo://src/middleware/bearer-auth/index.ts#L156-L221)

| Failure | Status | Default `WWW-Authenticate` | Default body |
| --- | --- | --- | --- |
| Header missing | 401 | `Bearer realm="…"` | `Unauthorized` |
| Header does not start with the prefix and a space, or the token has characters outside `[A-Za-z0-9._~+/-]+=*` | 400 | `Bearer error="invalid_request"` | `Bad Request` |
| Token does not match | 401 | `Bearer error="invalid_token"` | `Unauthorized` |

Sources: [src/middleware/bearer-auth/index.ts:156-221](repo://src/middleware/bearer-auth/index.ts#L156-L221)

The prefix comparison ignores case, and whitespace after it is trimmed. A `wwwAuthenticateHeader` given as an object is written as `key="value"` pairs after the prefix, and messages follow the same string-or-JSON rule as `basicAuth`.

Sources: [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:172-180](repo://src/middleware/bearer-auth/index.ts#L172-L180)

When `token` is an array, each entry is compared in turn until one matches. An empty array accepts no token.

Sources: [src/middleware/bearer-auth/index.ts:194-216](repo://src/middleware/bearer-auth/index.ts#L194-L216)

## Constant-time comparison

`timingSafeEqual(a, b, hashFunction?)` hashes both strings, SHA-256 by default, and compares the hashes and the original strings with `constantTimeEqualString`. That function folds the length difference and every character difference into one value with XOR and OR, and loops over the longer length, so its running time does not reveal where the strings first differ. If either hash is missing or not a string, the result is `false`.

Sources: [src/utils/buffer.ts:29-63](repo://src/utils/buffer.ts#L29-L63)

Calling it with non-string arguments is deprecated; that path hashes both values first and compares the hashes as strings.

Sources: [src/utils/buffer.ts:65-96](repo://src/utils/buffer.ts#L65-L96)
