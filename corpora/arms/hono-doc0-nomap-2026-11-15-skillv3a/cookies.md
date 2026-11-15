---
title: "Cookies"
---
## Overview

`hono/cookie` reads cookies from the request's `Cookie` header and writes them as `Set-Cookie` response headers. Besides plain cookies it supports signed cookies, whose value carries an HMAC-SHA256 signature so the server can detect tampering, and the `__Secure-` and `__Host-` name prefixes, which browsers only accept with specific attributes. The helper functions in `src/helper/cookie` take the [[Context]]; the parsing, signing and serialization rules live in `src/utils/cookie.ts`, which the [[RPC Client]] also uses to send cookies. The `jwt` and `jwk` middleware read tokens with these helpers, as described in [[JWT and JWK Authentication]].

Sources: [src/helper/cookie/index.ts:27-145](repo://src/helper/cookie/index.ts#L27-L145), [src/utils/cookie.ts:1-29](repo://src/utils/cookie.ts#L1-L29)

```ts
import { getCookie, setCookie, deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie'

app.get('/login', async (c) => {
  setCookie(c, 'theme', 'dark', { maxAge: 3600, sameSite: 'Lax' })
  await setSignedCookie(c, 'session', 'user-1', SECRET, { httpOnly: true, secure: true, prefix: 'host' })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const theme = getCookie(c, 'theme')
  const session = await getSignedCookie(c, SECRET, 'session', 'host') // string, undefined or false
  return c.json({ theme, session })
})
```

Sources: [src/helper/cookie/index.ts:27-139](repo://src/helper/cookie/index.ts#L27-L139)

## Reading cookies

`getCookie(c, key, prefix?)` returns one value or `undefined`; `getCookie(c)` returns all cookies as an object. With `prefix` set to `'secure'` or `'host'` the key is looked up as `__Secure-key` or `__Host-key`.

Sources: [src/helper/cookie/index.ts:10-48](repo://src/helper/cookie/index.ts#L10-L48)

`parse(header, name?)` does the work. When a name is given and does not occur anywhere in the header, it returns at once. Otherwise it splits on `;`, trims spaces and tabs around each name and value, removes surrounding double quotes, and keeps a pair only when the name matches the RFC 6265 token characters and the value contains only allowed characters (commas and spaces are tolerated, as browsers send them). The first occurrence of a name wins. Values containing `%` are percent-decoded, leaving malformed escapes as they are. With a name, parsing stops at the first match.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

## Writing cookies

`setCookie(c, name, value, options)` appends a `Set-Cookie` header, so several cookies can be set in one response, and the [[Context]] keeps every `Set-Cookie` when a later layer replaces the response. `deleteCookie(c, name, options)` returns the current value and sets the cookie again with an empty value and `Max-Age=0`; pass the same `path`, `domain` and `prefix` used when it was set, or the browser keeps the original.

Sources: [src/helper/cookie/index.ts:99-145](repo://src/helper/cookie/index.ts#L99-L145), [src/context.ts:409-434](repo://src/context.ts#L409-L434)

`Path=/` is the default unless another path is given. `serialize` percent-encodes the value and `_serialize` builds the header:

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/utils/cookie.ts:255-262](repo://src/utils/cookie.ts#L255-L262)

| Option | Output | Validation |
| --- | --- | --- |
| `maxAge` | `Max-Age=<seconds>` | At most 400 days (34,560,000 seconds) |
| `expires` | `Expires=<UTC date>` | At most 400 days in the future |
| `domain` | `Domain=...` | No `;`, CR or LF; omitted for `__Host-` cookies |
| `path` | `Path=...` | No `;`, CR or LF |
| `httpOnly` | `HttpOnly` | |
| `secure` | `Secure` | |
| `sameSite` | `SameSite=Strict`, `Lax` or `None` (capitalized) | No `;`, CR or LF |
| `priority` | `Priority=Low`, `Medium` or `High` | No `;`, CR or LF |
| `partitioned` | `Partitioned` | Requires `secure` |

Sources: [src/utils/cookie.ts:17-28](repo://src/utils/cookie.ts#L17-L28), [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

Invalid input throws instead of producing a header the browser would reject or misread: a name outside the token characters throws `Invalid cookie name`, and attribute values with separators or line breaks throw, which prevents header injection through user-controlled options.

Sources: [src/utils/cookie.ts:167-198](repo://src/utils/cookie.ts#L167-L198)

## Prefixes

Browsers accept a `__Secure-` cookie only with `Secure`, and a `__Host-` cookie only with `Secure`, `Path=/` and no `Domain`. The `prefix` option applies those rules for you: `prefix: 'secure'` adds the name prefix and forces `secure: true`; `prefix: 'host'` adds the prefix, forces `secure: true` and `path: '/'`, and drops `domain`. Setting a prefixed name by hand without the required attributes throws. The `CookieConstraint` type also enforces them at compile time when a literal prefixed name is passed to `serialize`.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/utils/cookie.ts:174-192](repo://src/utils/cookie.ts#L174-L192), [src/utils/cookie.ts:31-35](repo://src/utils/cookie.ts#L31-L35)

## Signed cookies

### Signing

`setSignedCookie(c, name, value, secret, options)` computes an HMAC-SHA256 over the raw value with WebCrypto, base64-encodes the 32-byte signature (always 44 characters ending in `=`), and stores `value.signature`, percent-encoded, as the cookie value. The secret may be a string or bytes.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

### Verifying

`getSignedCookie(c, secret, key, prefix?)` parses the cookie, splits the value at its last `.`, and checks the signature with `crypto.subtle.verify`. The result has three states:

Sources: [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76)

| Result | Meaning |
| --- | --- |
| a string | The cookie exists and its signature is valid; the original value |
| `false` | The cookie exists with a well-formed signature that does not verify (tampered, or signed with another secret) |
| `undefined` | No such cookie, or its value does not look signed (no `.`, or a signature that is not 44 characters ending in `=`) |

Sources: [src/utils/cookie.ts:148-162](repo://src/utils/cookie.ts#L148-L162)

Without a key, `getSignedCookie(c, secret)` returns every signed-looking cookie with the same string-or-`false` values. Signing proves the server issued a value; it does not hide it, since the value is stored in clear text before the signature. Rotating the secret makes every existing signed cookie read as `false`.

Sources: [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)
