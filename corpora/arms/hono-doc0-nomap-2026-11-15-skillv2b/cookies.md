---
title: "Cookies"
---
## Overview

The cookie helper (`hono/cookie`) reads the request's `Cookie` header and writes `Set-Cookie` headers on the response, with optional HMAC signing and enforcement of the `__Secure-` and `__Host-` name prefixes. The helper functions in `src/helper/cookie` take the `Context`; the parsing, serialising and signing rules live in `src/utils/cookie.ts`, which the RPC client also uses to send cookies ([[RPC Client]]) and the validator uses for its `cookie` target ([[Validator]]).

Sources: [src/helper/cookie/index.ts:27-145](repo://src/helper/cookie/index.ts#L27-L145), [src/utils/cookie.ts:1-35](repo://src/utils/cookie.ts#L1-L35)

```ts
import { getCookie, setCookie, deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'

app.post('/login', async (c) => {
  await setSignedCookie(c, 'session', 'user-123', c.env.COOKIE_SECRET, {
    httpOnly: true,
    sameSite: 'Lax',
    prefix: 'host',
    maxAge: 60 * 60 * 24,
  })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const session = await getSignedCookie(c, c.env.COOKIE_SECRET, 'session', 'host')
  if (!session) return c.text('Unauthorized', 401) // undefined (absent) or false (tampered)
  return c.text(session)
})
```

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:130-139](repo://src/helper/cookie/index.ts#L130-L139)

## Reading cookies

| Call | Returns |
| --- | --- |
| `getCookie(c)` | Every cookie as an object; `{}` without a `Cookie` header |
| `getCookie(c, name)` | One value or `undefined` |
| `getCookie(c, name, 'secure' \| 'host')` | The value of `__Secure-name` or `__Host-name` |
| `getSignedCookie(c, secret)` | Every cookie with a valid-looking signature, mapped to its value or `false` |
| `getSignedCookie(c, secret, name, prefix?)` | One value, `false` if the signature does not verify, or `undefined` if absent |

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76)

`parse(cookieHeader, name?)` splits the header on `;`, trims spaces and tabs, and skips pairs without `=`, names that are not valid tokens, and values outside the allowed character set. The first occurrence of a name wins, a quoted value is unquoted, and values containing `%` are decoded tolerantly. When a name is requested, it returns `{}` immediately if the name does not appear anywhere in the header, and stops at the first match. The result object has a null prototype, so a cookie named `__proto__` cannot pollute it.

Sources: [src/utils/cookie.ts:70-138](repo://src/utils/cookie.ts#L70-L138)

## Writing cookies

### setCookie and deleteCookie

`setCookie(c, name, value, options)` serialises the cookie and appends it with `c.header('Set-Cookie', ..., { append: true })`, so several cookies produce several headers. `deleteCookie(c, name, options)` returns the current value and sets the cookie to an empty value with `Max-Age=0`; the `path` and `domain` options must match the ones used to set it.

Sources: [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

`Path=/` is added by default. `generateCookie` and `generateSignedCookie` return the header string without touching a context, for code that builds responses by hand.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/helper/cookie/index.ts:104-128](repo://src/helper/cookie/index.ts#L104-L128)

### Options

| Option | Attribute | Rule enforced |
| --- | --- | --- |
| `maxAge` | `Max-Age` | Must not exceed 400 days (34,560,000 s) |
| `expires` | `Expires` | Must not be more than 400 days in the future |
| `domain`, `path` | `Domain`, `Path` | No `;`, CR or LF |
| `httpOnly`, `secure` | `HttpOnly`, `Secure` | |
| `sameSite` | `SameSite` | `Strict`, `Lax` or `None`, any case |
| `priority` | `Priority` | `Low`, `Medium` or `High` |
| `partitioned` | `Partitioned` | Requires `secure` |
| `prefix` | name prefix | `secure` or `host`, see below |

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

Violations throw an `Error` from `_serialize` rather than producing a cookie the browser would reject or truncate: an invalid name, a 401-day lifetime, or a `domain` containing `;` that could inject attributes. The value is always `encodeURIComponent`-encoded.

Sources: [src/utils/cookie.ts:167-198](repo://src/utils/cookie.ts#L167-L198), [src/utils/cookie.ts:255-262](repo://src/utils/cookie.ts#L255-L262)

### Prefixes

With `prefix: 'secure'` the name becomes `__Secure-name` and `secure: true` is forced. With `prefix: 'host'` the name becomes `__Host-name`, `secure: true` and `path: '/'` are forced and `domain` is removed. Writing a `__Secure-` or `__Host-` name directly without those attributes throws. Browsers only accept prefixed cookies set this way, which is what makes a `__Host-` cookie impossible for a sibling subdomain to overwrite.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/utils/cookie.ts:174-192](repo://src/utils/cookie.ts#L174-L192)

The types encode the same rules: `CookieConstraint<Name>` requires `secure: true` for names starting with `__Secure-`, and `secure`, `path: '/'` and no `domain` for `__Host-` names, so mistakes show up at compile time when the name is a literal.

Sources: [src/utils/cookie.ts:11-35](repo://src/utils/cookie.ts#L11-L35)

## Signed cookies

Signing protects a cookie's integrity, not its secrecy: the value stays readable. `serializeSigned` computes an HMAC-SHA256 of the value with the secret through Web Crypto, base64-encodes it, and stores `value.signature` (URI-encoded) as the cookie value.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

`parseSigned` splits each value at its last `.`, requires the signature to be 44 base64 characters ending in `=` (the length of a SHA-256 HMAC), and verifies it with `crypto.subtle.verify`, which compares in constant time. A malformed signature is skipped, so that cookie is absent from the result. A well-formed signature that does not verify maps the cookie to `false`, which lets the app tell tampering apart from absence.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

The secret may be a string or a `BufferSource`. Rotating it invalidates every existing signed cookie. The JWT middleware can read its token from a signed cookie by passing `cookie: { key, secret }` ([[JWT and JWK Authentication]]).

Sources: [src/utils/cookie.ts:39-42](repo://src/utils/cookie.ts#L39-L42), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117)
