---
title: "Cookies"
---
## Overview

The cookie helper, imported from `hono/cookie`, reads cookies from the request's `Cookie` header and writes `Set-Cookie` headers on the response. It offers plain and HMAC-signed variants of each operation and handles the `__Secure-` and `__Host-` name prefixes for you.

Sources: [src/helper/cookie/index.ts:1-48](repo://src/helper/cookie/index.ts#L1-L48), [src/helper/cookie/index.ts:78-145](repo://src/helper/cookie/index.ts#L78-L145)

The helper is a thin layer over `src/utils/cookie.ts`, which holds the parser (`parse`, `parseSigned`), the serializer (`serialize`, `serializeSigned`) and the option types. Those utilities are also used elsewhere: the [[Validator]] reads the `cookie` target with `getCookie`, the JWT and JWK middleware read tokens from cookies (see [[Authentication Middleware]]), the language middleware stores the detected language, and the [[RPC Client (hc)]] serializes cookies it sends.

Sources: [src/validator/validator.ts:155-160](repo://src/validator/validator.ts#L155-L160), [src/middleware/jwt/jwt.ts:96-116](repo://src/middleware/jwt/jwt.ts#L96-L116), [src/middleware/language/language.ts:135-139](repo://src/middleware/language/language.ts#L135-L139), [src/client/client.ts:1-5](repo://src/client/client.ts#L1-L5)

## Usage

```ts
import { Hono } from 'hono'
import { getCookie, setCookie, deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'

const app = new Hono()

app.get('/login', async (c) => {
  setCookie(c, 'theme', 'dark', { maxAge: 3600, httpOnly: true, sameSite: 'Lax' })
  setCookie(c, 'session', 'abc', { prefix: 'host' }) // __Host-session=abc; Path=/; Secure
  await setSignedCookie(c, 'uid', '42', c.env.SECRET, { prefix: 'secure' })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const theme = getCookie(c, 'theme') // string | undefined
  const all = getCookie(c) // Record<string, string>
  const session = getCookie(c, 'session', 'host') // reads __Host-session
  const uid = await getSignedCookie(c, c.env.SECRET, 'uid', 'secure') // string | undefined | false
  if (uid === false) return c.text('tampered', 401)
  return c.json({ theme, all, session, uid })
})

app.post('/logout', (c) => {
  deleteCookie(c, 'theme')
  return c.text('bye')
})
```

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76), [src/helper/cookie/index.ts:78-145](repo://src/helper/cookie/index.ts#L78-L145)

## Reading cookies

### getCookie

`getCookie` has three overloads: with a key it returns that cookie's value or `undefined`; without a key it returns every cookie as a `Record<string, string>` (an empty object when there is no `Cookie` header); with a key and a `CookiePrefixOptions` value of `'secure'` or `'host'` it prepends `__Secure-` or `__Host-` to the key before looking it up. With a key, it calls `parse(cookie, finalKey)`, which takes the single-key fast path described below.

Sources: [src/helper/cookie/index.ts:10-48](repo://src/helper/cookie/index.ts#L10-L48)

### getSignedCookie

`getSignedCookie(c, secret, key?, prefix?)` mirrors `getCookie` but is async and goes through `parseSigned`. For each cookie the result is the original value when the signature verifies, `false` when a well-formed signature does not match, and the key is absent when the value does not look signed at all. A missing cookie with a key returns `undefined`. The `secret` may be a string or a `BufferSource`.

Sources: [src/helper/cookie/index.ts:16-25](repo://src/helper/cookie/index.ts#L16-L25), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76)

> [!IMPORTANT]
> Distinguish `false` (tampered or signed with another secret) from `undefined` (not sent). A check like `if (!value)` treats both the same.

Sources: [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

### The parser

`parse(cookie, name?)` splits the header on `;` and, for each pair, trims spaces and tabs around the name and value with `trimCookieWhitespace`. It applies these rules in order:

Sources: [src/utils/cookie.ts:102-138](repo://src/utils/cookie.ts#L102-L138)

1. If `name` is given and the raw header does not contain it, return `{}` immediately.
2. Skip pairs without `=`.
3. Skip a pair whose name differs from the requested `name`, fails the RFC 6265 token regex `validCookieNameRegEx`, or was already seen (the first occurrence wins).
4. Strip one pair of surrounding double quotes from the value.
5. Keep the value only if it matches `validCookieValueRegEx` (printable ASCII except `"`, `;` and `\`; comma and space are allowed for real-world compatibility).
6. URL-decode the value with `tryDecode` only when it contains `%`, so malformed escapes leave the raw value.
7. When a `name` was requested, stop after the first match.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

The result object is created with `Object.create(null)`, so a cookie named `__proto__` or `constructor` cannot reach the object prototype.

Sources: [src/utils/cookie.ts:107-108](repo://src/utils/cookie.ts#L107-L108)

## Writing cookies

### setCookie and generateCookie

`setCookie(c, name, value, opt?)` builds the header string with `generateCookie` and appends it with `c.header('Set-Cookie', cookie, { append: true })`, so several calls produce several `Set-Cookie` headers. `generateCookie` is exported for code that needs the string without a context. It defaults `path` to `/` and handles the `prefix` option:

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102)

| `prefix` | Cookie name | Forced attributes |
| --- | --- | --- |
| none | `name` | `path: '/'` unless you set another |
| `'secure'` | `__Secure-name` | `secure: true`; `path` defaults to `/` |
| `'host'` | `__Host-name` | `path: '/'`, `secure: true`, `domain: undefined` (your values are overridden) |

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102)

### setSignedCookie and generateSignedCookie

`generateSignedCookie` applies the same prefix rules and calls `serializeSigned`, and `setSignedCookie` appends its result as a `set-cookie` header. Signing uses Web Crypto: the secret is imported as an HMAC SHA-256 key, the raw value is signed, and the signature is base64 encoded. The cookie value becomes `value.signature` and is then URL-encoded.

Sources: [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139), [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

On read, `parseSigned` splits at the last `.`, skips a value whose signature is not exactly 44 characters ending in `=` (the length of a base64 SHA-256 HMAC), and verifies the rest with `crypto.subtle.verify`. A signature that fails to decode counts as unverified.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

### deleteCookie

`deleteCookie(c, name, opt?)` reads the current value with `getCookie(c, name, opt?.prefix)`, then sets the cookie to an empty value with `maxAge: 0`, and returns the old value. Pass the same `path`, `domain` and `prefix` used when setting it, otherwise the browser treats it as a different cookie and keeps the original.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Cookie options

`CookieOptions` controls the attributes `_serialize` appends, in this order: `Max-Age`, `Domain`, `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`, `Priority`, `Partitioned`.

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-252](repo://src/utils/cookie.ts#L200-L252)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `domain` | `string` | none | `Domain=` attribute; omitted when `prefix` is `'host'`. |
| `expires` | `Date` | none | `Expires=` in UTC string form. |
| `httpOnly` | `boolean` | `false` | Adds `HttpOnly`. |
| `maxAge` | `number` | none | `Max-Age=` in seconds, truncated to an integer; negative values are ignored. |
| `path` | `string` | `'/'` (set by the helper) | `Path=` attribute. |
| `secure` | `boolean` | `false` | Adds `Secure`. |
| `sameSite` | `'Strict' \| 'Lax' \| 'None'` (any case) | none | `SameSite=` with the first letter capitalized. |
| `partitioned` | `boolean` | `false` | Adds `Partitioned` (CHIPS); requires `secure: true`. |
| `priority` | `'Low' \| 'Medium' \| 'High'` (any case) | none | `Priority=` with the first letter capitalized. |
| `prefix` | `'secure' \| 'host'` | none | Adds the `__Secure-` or `__Host-` name prefix in the helper. |

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-250](repo://src/utils/cookie.ts#L200-L250), [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

The types encode two constraints: `partitioned: true` requires `secure: true`, and `CookieConstraint<Name>` makes `serialize` require `secure: true` for a name starting with `__Secure-`, and `secure: true` with `path: '/'` and no `domain` for a name starting with `__Host-`.

Sources: [src/utils/cookie.ts:11-35](repo://src/utils/cookie.ts#L11-L35), [src/utils/cookie.ts:255-262](repo://src/utils/cookie.ts#L255-L262)

## Validation errors

`_serialize` throws an `Error` instead of writing a cookie the browser would reject or that could inject header content. Because `setCookie` calls it synchronously, these errors surface from the handler and reach `app.onError` (see [[Error Handling and HTTPException]]).

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

| Condition | Message |
| --- | --- |
| Name fails `validCookieNameRegEx` | `Invalid cookie name` |
| `__Secure-` name without `secure` | `__Secure- Cookie must have Secure attributes` |
| `__Host-` name without `secure` | `__Host- Cookie must have Secure attributes` |
| `__Host-` name with `path` other than `/` | `__Host- Cookie must have Path attributes with "/"` |
| `__Host-` name with `domain` | `__Host- Cookie must not have Domain attributes` |
| `domain`, `path`, `sameSite` or `priority` containing `;`, `\r` or `\n` | `<key> must not contain ";", "\r", or "\n"` |
| `maxAge` above 34560000 seconds (400 days) | `Cookies Max-Age SHOULD NOT be greater than 400 days ...` |
| `expires` more than 400 days in the future | `Cookies Expires SHOULD NOT be greater than 400 days ...` |
| `partitioned` without `secure` | `Partitioned Cookie must have Secure attributes` |

Sources: [src/utils/cookie.ts:167-250](repo://src/utils/cookie.ts#L167-L250)

The value itself is always passed through `encodeURIComponent` by `serialize` and `serializeSigned`, so it never needs validating: `;`, quotes and non-ASCII characters are percent-encoded and decoded again by `parse`.

Sources: [src/utils/cookie.ts:255-274](repo://src/utils/cookie.ts#L255-L274), [src/utils/cookie.ts:128-131](repo://src/utils/cookie.ts#L128-L131)
