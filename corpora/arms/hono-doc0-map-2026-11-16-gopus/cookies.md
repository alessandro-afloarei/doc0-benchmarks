---
title: "Cookies"
---
## Overview

`hono/cookie` reads cookies from the request's `Cookie` header and writes them as `Set-Cookie` response headers through the Context. The helper functions are thin: they choose the cookie name (adding a `__Secure-` or `__Host-` prefix when asked) and default options, and leave parsing, validation, serialisation and signing to `utils/cookie`. Signed cookies carry an HMAC-SHA256 signature made with the Web Crypto API.

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/utils/cookie.ts:37-66](repo://src/utils/cookie.ts#L37-L66)

Other parts of Hono use the same functions: the [[Validator]]'s `cookie` target calls `getCookie(c)`, the `jwt` and `jwk` middleware read tokens with `getCookie` or `getSignedCookie` ([[JWT and JWK]]), and the language detector writes its cookie with `setCookie` ([[Content Negotiation]]).

Sources: [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224)

## The helper functions

| Function | Does |
| --- | --- |
| `getCookie(c, name?, prefix?)` | One value, or all cookies as an object when `name` is omitted |
| `getSignedCookie(c, secret, name?, prefix?)` | Like `getCookie`, but returns the value only when its signature is valid, `false` when it is not |
| `setCookie(c, name, value, options?)` | Appends a `Set-Cookie` header |
| `setSignedCookie(c, name, value, secret, options?)` | Signs the value, then appends the header |
| `deleteCookie(c, name, options?)` | Sets the cookie to `''` with `Max-Age=0` and returns its previous value |
| `generateCookie`, `generateSignedCookie` | Return the `Set-Cookie` string without touching the Context |

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76), [src/helper/cookie/index.ts:78-145](repo://src/helper/cookie/index.ts#L78-L145)

```ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

app.get('/login', (c) => {
  setCookie(c, 'session', 'abc', { httpOnly: true, secure: true, sameSite: 'Lax' })
  return c.text('ok')
})

app.get('/me', (c) => c.text(getCookie(c, 'session') ?? 'anonymous'))

app.get('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.text('bye')
})
```

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

`setCookie` calls `c.header('Set-Cookie', …, { append: true })`, so several cookies can be set in one response, and they survive when middleware later replaces `c.res`, because the Context copies every `Set-Cookie` header over ([[Context and Responses]]). Without a `path` option, cookies are written with `Path=/`.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`deleteCookie` passes its options on to `setCookie`, so a cookie set with a `path` or `domain` must be deleted with the same ones for the browser to match it.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Prefixes

The `prefix` option, `'secure'` or `'host'`, adds `__Secure-` or `__Host-` to the name and forces the attributes the browser requires for it, as the comment in `generateCookie` explains:

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

| Prefix | Name written | Attributes forced |
| --- | --- | --- |
| `'secure'` | `__Secure-name` | `Secure` |
| `'host'` | `__Host-name` | `Secure`, `Path=/`, no `Domain` |

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

When reading, `getCookie(c, 'name', 'host')` looks up `__Host-name`. The type `CookieConstraint<Name>` also makes TypeScript require `secure: true` (and `path: '/'` for `__Host-`) when such a name is passed to `serialize` directly.

Sources: [src/helper/cookie/index.ts:27-41](repo://src/helper/cookie/index.ts#L27-L41), [src/utils/cookie.ts:29-35](repo://src/utils/cookie.ts#L29-L35)

## Parsing

`parse(cookieHeader, name?)` splits the header on `;`, trims spaces and tabs around names and values, and unwraps double-quoted values. A pair is skipped when it has no `=`, when its name contains characters outside the RFC 6265 token set, or when its value contains characters the RFC forbids. A comment explains that commas and spaces are still allowed in values because they are common in practice. Values containing `%` are decoded with `tryDecode`, which never throws.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

The first occurrence of a name wins. When a single name is asked for, `parse` returns `{}` at once if the name does not appear anywhere in the header, and stops at the first valid match. The result object is created with `Object.create(null)`.

Sources: [src/utils/cookie.ts:102-137](repo://src/utils/cookie.ts#L102-L137)

## Serialising and validation

`serialize(name, value, options)` URL-encodes the value and builds the `Set-Cookie` string. `_serialize` refuses invalid input by throwing, so a mistake fails in the handler rather than producing a header the browser ignores:

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

| Rule | Error |
| --- | --- |
| Name outside the token set | `Invalid cookie name` |
| `__Secure-` name without `secure` | `__Secure- Cookie must have Secure attributes` |
| `__Host-` name without `secure`, with a path other than `/`, or with a domain | One error for each case |
| `;`, CR or LF in `domain`, `path`, `sameSite` or `priority` | `… must not contain ";", "\r", or "\n"` |
| `maxAge` over 34,560,000 seconds, or `expires` more than 400 days ahead | `… SHOULD NOT be greater than 400 days …` |
| `partitioned` without `secure` | `Partitioned Cookie must have Secure attributes` |

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

Attributes are written in the order `Max-Age`, `Domain`, `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`, `Priority`, `Partitioned`. `maxAge` is truncated to an integer, and `sameSite` and `priority` are capitalised, so `'lax'` and `'Lax'` give the same header.

Sources: [src/utils/cookie.ts:200-251](repo://src/utils/cookie.ts#L200-L251), [src/utils/cookie.ts:17-28](repo://src/utils/cookie.ts#L17-L28)

## Signed cookies

`serializeSigned` signs the raw value with HMAC-SHA256, using the secret imported as a raw key, and stores `value.signature`, URL-encoded, with the signature in base64. A comment notes that this signature is always 44 characters and ends with `=`.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

`parseSigned` parses the header normally, splits each value at its last `.`, and skips values whose signature part is not 44 characters ending in `=`. The rest are checked with `crypto.subtle.verify`: a valid signature gives the original value, and an invalid one gives `false`, so a handler can tell a tampered cookie (`false`) from a missing one (`undefined`).

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

```ts
import { getSignedCookie, setSignedCookie } from 'hono/cookie'

await setSignedCookie(c, 'session', 'abc', 'my-secret', { httpOnly: true })

const session = await getSignedCookie(c, 'my-secret', 'session')
if (session === false) {
  return c.text('tampered', 401)
}
```

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:130-139](repo://src/helper/cookie/index.ts#L130-L139)

The signature covers only the value, not the name or the attributes. The secret may be a string, encoded as UTF-8, or any `BufferSource`.

Sources: [src/utils/cookie.ts:39-49](repo://src/utils/cookie.ts#L39-L49)
