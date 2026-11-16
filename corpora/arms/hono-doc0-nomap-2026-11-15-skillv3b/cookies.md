---
title: "Cookies"
---
## Overview

`hono/cookie` reads cookies from the request's `Cookie` header and writes them as `Set-Cookie` headers on the response. It adds two things on top of plain parsing: signed cookies, whose value carries an HMAC-SHA256 signature so the server can detect tampering, and the `__Secure-` and `__Host-` name prefixes, whose browser rules it enforces when writing. The parsing and serialisation live in `utils/cookie` and are also used by the validator's `cookie` target, the JWT middleware's cookie option, the language detector and the RPC client.

Sources: [src/helper/cookie/index.ts:27-102](repo://src/helper/cookie/index.ts#L27-L102), [src/utils/cookie.ts:1-35](repo://src/utils/cookie.ts#L1-L35)

| Function | Does |
| --- | --- |
| `getCookie(c)` / `getCookie(c, name, prefix?)` | All cookies as a record, or one value |
| `setCookie(c, name, value, options?)` | Appends a `Set-Cookie` header |
| `deleteCookie(c, name, options?)` | Sets the cookie empty with `Max-Age=0`; returns the old value |
| `getSignedCookie(c, secret, name?, prefix?)` | Verified value, `false` when the signature is wrong, `undefined` when absent |
| `setSignedCookie(c, name, value, secret, options?)` | Appends a signed `Set-Cookie` header |
| `generateCookie`, `generateSignedCookie` | Return the header string without setting it |

Sources: [src/helper/cookie/index.ts:27-145](repo://src/helper/cookie/index.ts#L27-L145)

## Reading cookies

`getCookie` reads `c.req.raw.headers.get('Cookie')` and parses it with `parse`. With a `prefix` of `'secure'` or `'host'`, it looks up `__Secure-name` or `__Host-name`, so code refers to cookies by their base name.

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48)

`parse(header, name?)` splits on `;`, trims spaces and tabs, and keeps a pair only when the name is a valid RFC 6265 token and the value contains only allowed characters (spaces and commas are tolerated, as browsers send them). Surrounding double quotes are removed, and values containing `%` are percent-decoded, leaving malformed escapes as they are. The first occurrence of a name wins. When a single name is requested, the parser returns immediately if the name does not appear in the header at all, and stops at the first match.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

## Writing cookies

### setCookie and serialize

`setCookie` calls `generateCookie` and appends the result with `c.header('Set-Cookie', value, { append: true })`, so several cookies on one response are separate header lines. Those lines survive a later `c.res` replacement, because the context merges `Set-Cookie` headers when the response is swapped (see [[Context and Response Building]]). `Path` defaults to `/`.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`serialize(name, value, options)` percent-encodes the value and builds the header. It throws, rather than writing a cookie a browser would reject or misread, when:

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

- the name is not a valid token;
- `domain`, `path`, `sameSite` or `priority` contains `;`, a carriage return or a line feed, which would inject attributes;
- `maxAge` or `expires` is more than 400 days away, the limit in the cookie specification draft;
- `partitioned` is set without `secure`;
- a `__Secure-` name lacks `secure`, or a `__Host-` name lacks `secure`, has a path other than `/`, or has a domain.

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

| Option | Attribute |
| --- | --- |
| `maxAge` | `Max-Age` (seconds, truncated to an integer) |
| `expires` | `Expires` in UTC |
| `domain`, `path` | `Domain`, `Path` |
| `httpOnly`, `secure`, `partitioned` | `HttpOnly`, `Secure`, `Partitioned` |
| `sameSite` | `SameSite=Strict`, `Lax` or `None` (any case accepted) |
| `priority` | `Priority=Low`, `Medium` or `High` |
| `prefix` | `'secure'` or `'host'`, see below |

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-250](repo://src/utils/cookie.ts#L200-L250)

### Prefixes

With `prefix: 'secure'`, the helper writes `__Secure-name` and forces `secure: true`. With `prefix: 'host'`, it writes `__Host-name` and forces `secure: true`, `path: '/'` and no domain, overriding the options passed, so a prefixed cookie always satisfies the rules `serialize` checks. At the type level, `CookieConstraint<Name>` also requires those options when a prefixed name is passed to `serialize` directly.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/utils/cookie.ts:31-35](repo://src/utils/cookie.ts#L31-L35)

## Signed cookies

### Signing

`serializeSigned` imports the secret (a string or bytes) as an HMAC-SHA256 key with Web Crypto, signs the raw value, and stores `value.signature`, where the signature is the 44-character base64 encoding of the 32-byte MAC. The whole string is then percent-encoded like any other value. The value itself is not encrypted: anyone can read it, but nobody without the secret can change it.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

### Verifying

`parseSigned` parses the header, splits each value at its last `.`, and skips values whose signature part is not 44 characters ending in `=`. It verifies the rest with `crypto.subtle.verify`, which compares in constant time. A verified cookie maps to its value and a failed one to `false`, so `getSignedCookie` can tell "tampered" (`false`) from "missing" (`undefined`) and the application can react differently.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76)

```ts
import { getSignedCookie, setSignedCookie } from 'hono/cookie'

app.post('/login', async (c) => {
  await setSignedCookie(c, 'session', 'user-1', c.env.COOKIE_SECRET, {
    httpOnly: true,
    sameSite: 'Lax',
    prefix: 'host',
  })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const session = await getSignedCookie(c, c.env.COOKIE_SECRET, 'session', 'host')
  if (!session) return c.text('Unauthorized', 401)
  return c.text(`hello ${session}`)
})
```

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

## Where cookies are used elsewhere

The [[Validation]] middleware's `cookie` target validates `getCookie(c)`. The `jwt` and `jwk` middleware on [[Authentication Middleware]] can read their token from a plain or signed cookie, with prefix options. The `languageDetector` on [[Logging, Timing and Request Context Middleware]] stores the detected language with `setCookie`. The [[RPC Client]] serialises a `cookie` argument into the `Cookie` request header with `serialize`.

Sources: [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/client/client.ts:98-104](repo://src/client/client.ts#L98-L104)
