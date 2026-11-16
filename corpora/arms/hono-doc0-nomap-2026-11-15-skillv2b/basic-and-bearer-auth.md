---
title: "Basic and Bearer Auth"
---
## Overview

`basicAuth` (`hono/basic-auth`) and `bearerAuth` (`hono/bearer-auth`) protect routes with credentials sent in the `Authorization` header. Both are middleware factories: they validate options once when called, then return a middleware that either calls `next()` for a valid request or throws an `HTTPException` carrying a ready-made `401` or `400` response with a `WWW-Authenticate` challenge. Throwing instead of returning means an app's `onError` can rewrite every authentication failure in one place ([[Request Dispatch and Middleware Composition]]).

Sources: [src/middleware/basic-auth/index.ts:80-153](repo://src/middleware/basic-auth/index.ts#L80-L153), [src/middleware/bearer-auth/index.ts:104-221](repo://src/middleware/bearer-auth/index.ts#L104-L221)

Both compare secrets with `timingSafeEqual` so the response time does not reveal how many characters of a guess were right. Signed tokens such as JWTs are verified by [[JWT and JWK Authentication]] instead.

Sources: [src/utils/buffer.ts:29-63](repo://src/utils/buffer.ts#L29-L63)

```ts
import { basicAuth } from 'hono/basic-auth'
import { bearerAuth } from 'hono/bearer-auth'

app.use('/admin/*', basicAuth({ username: 'admin', password: 'secret' }))
app.use('/api/*', bearerAuth({ token: ['token-a', 'token-b'] }))
```

Sources: [src/middleware/basic-auth/index.ts:80-103](repo://src/middleware/basic-auth/index.ts#L80-L103), [src/middleware/bearer-auth/index.ts:104-120](repo://src/middleware/bearer-auth/index.ts#L104-L120)

## Basic auth

### Basic auth options

| Option | Default | Effect |
| --- | --- | --- |
| `username`, `password` | | One allowed user. Further users can be passed as extra arguments: `basicAuth(opts, user2, user3)` |
| `verifyUser(username, password, c)` | | Replaces the static list with a custom check (database lookup, for example) |
| `realm` | `Secure Area` | Shown by browsers in the login prompt |
| `hashFunction` | SHA-256 | Hash used before comparing |
| `invalidUserMessage` | `Unauthorized` | String, object (sent as JSON) or function of `c` |
| `onAuthSuccess(c, username)` | | Called before `next()` on success, for example to `c.set` the user |

Sources: [src/middleware/basic-auth/index.ts:14-29](repo://src/middleware/basic-auth/index.ts#L14-L29)

The factory throws at setup time when neither `username`/`password` nor `verifyUser` is given.

Sources: [src/middleware/basic-auth/index.ts:84-103](repo://src/middleware/basic-auth/index.ts#L84-L103)

### Parsing credentials

`auth(req)` in `src/utils/basic-auth.ts` matches `Authorization` against `Basic <base64>` (case-insensitive scheme, surrounding spaces allowed), decodes the base64 as UTF-8, and splits at the first `:`. Any decoding failure returns `undefined` rather than throwing, so malformed headers fall through to the same `401` as wrong credentials.

Sources: [src/utils/basic-auth.ts:1-26](repo://src/utils/basic-auth.ts#L1-L26)

### Checking users

With `verifyUser`, the function decides. Otherwise every configured user is checked in turn, comparing username and password in parallel with `timingSafeEqual`. On failure, the middleware builds a `401` with `WWW-Authenticate: Basic realm="..."` (quotes in the realm escaped) and the message as text or JSON, and throws it inside an `HTTPException`.

Sources: [src/middleware/basic-auth/index.ts:105-152](repo://src/middleware/basic-auth/index.ts#L105-L152)

## Bearer auth

### Bearer auth options

| Option | Default | Effect |
| --- | --- | --- |
| `token` | | A token or an array of accepted tokens |
| `verifyToken(token, c)` | | Custom check instead of `token` |
| `realm` | `''` | Included in the challenge |
| `prefix` | `Bearer` | Scheme expected before the token; `''` means the header is the bare token |
| `headerName` | `Authorization` | Header to read |
| `hashFunction` | SHA-256 | Hash used before comparing |
| `noAuthenticationHeader`, `invalidAuthenticationHeader`, `invalidToken` | | Per-case `{ wwwAuthenticateHeader, message }` overrides (string, object or function) |

Sources: [src/middleware/bearer-auth/index.ts:22-66](repo://src/middleware/bearer-auth/index.ts#L22-L66)

The older `noAuthenticationHeaderMessage`, `invalidAuthenticationHeaderMessage` and `invalidTokenMessage` options are still read when the newer objects do not set a message.

Sources: [src/middleware/bearer-auth/index.ts:160-215](repo://src/middleware/bearer-auth/index.ts#L160-L215)

### Three failure cases

The middleware distinguishes three cases and answers each as RFC 6750 describes.

Sources: [src/middleware/bearer-auth/index.ts:156-158](repo://src/middleware/bearer-auth/index.ts#L156-L158)

| Case | Status | Default `WWW-Authenticate` |
| --- | --- | --- |
| Header missing | 401 | `Bearer realm="<realm>"` |
| Header present but prefix wrong, or token has characters outside `[A-Za-z0-9._~+/-]+=*` | 400 | `Bearer error="invalid_request"` |
| Token well-formed but not accepted | 401 | `Bearer error="invalid_token"` |

Sources: [src/middleware/bearer-auth/index.ts:156-218](repo://src/middleware/bearer-auth/index.ts#L156-L218)

The prefix check is case-insensitive and requires a space after the prefix. A `wwwAuthenticateHeader` given as an object is serialised as `Bearer key="value",...`.

Sources: [src/middleware/bearer-auth/index.ts:122-154](repo://src/middleware/bearer-auth/index.ts#L122-L154), [src/middleware/bearer-auth/index.ts:170-180](repo://src/middleware/bearer-auth/index.ts#L170-L180)

## Timing-safe comparison

`timingSafeEqual(a, b, hashFunction)` hashes both strings (SHA-256 by default, through Web Crypto) and compares the hashes and the original strings with `constantTimeEqualString`. That function always walks the length of the longer string and folds every difference, including the length difference, into one value, so it takes the same time whether the first or last character differs. Hashing first also hides the length of the secret from the timing.

Sources: [src/utils/buffer.ts:29-63](repo://src/utils/buffer.ts#L29-L63)

```ts
const constantTimeEqualString = (a: string, b: string): boolean => {
  const aLen = a.length
  const bLen = b.length
  const maxLen = Math.max(aLen, bLen)
  let out = aLen ^ bLen
  for (let i = 0; i < maxLen; i++) {
    const aChar = i < aLen ? a.charCodeAt(i) : 0
    const bChar = i < bLen ? b.charCodeAt(i) : 0
    out |= aChar ^ bChar
  }
  return out === 0
}
```

Sources: [src/utils/buffer.ts:29-40](repo://src/utils/buffer.ts#L29-L40)

A `hashFunction` returning `null` or a non-string makes the comparison fail closed. Signatures that pass non-string values are deprecated.

Sources: [src/utils/buffer.ts:55-57](repo://src/utils/buffer.ts#L55-L57), [src/utils/buffer.ts:65-88](repo://src/utils/buffer.ts#L65-L88)

## Using the authenticated identity

Neither middleware sets a context variable by default. With basic auth, `onAuthSuccess` is the hook for storing the user; with bearer auth, `verifyToken` receives `c` and can call `c.set` before returning `true`. Variables should be declared in the app's `Env` so handlers read them typed ([[Context and Responses]]).

Sources: [src/middleware/basic-auth/index.ts:108-128](repo://src/middleware/basic-auth/index.ts#L108-L128), [src/middleware/bearer-auth/index.ts:194-196](repo://src/middleware/bearer-auth/index.ts#L194-L196)
