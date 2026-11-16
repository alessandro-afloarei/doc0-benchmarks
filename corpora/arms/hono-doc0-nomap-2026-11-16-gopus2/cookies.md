---
title: "Cookies"
---
## Overview

The cookie helper (`hono/cookie`) reads the request's `Cookie` header and appends `Set-Cookie` headers to the response. It has plain and signed variants of each operation: signed cookies carry an HMAC-SHA256 signature, so the server can detect a value the client changed. The parsing, serialisation and signing rules live in `utils/cookie`; the helper adds the `Context` plumbing and the `__Secure-` and `__Host-` name prefixes. Other parts of Hono use the helper too: the `jwt` and `jwk` middleware read tokens from cookies ([[JWT and JWK]]), `languageDetector` caches the detected language ([[Content Negotiation]]), and the [[Validator]] reads the `cookie` target with `getCookie`.

Sources: [src/helper/cookie/index.ts:1-27](repo://src/helper/cookie/index.ts#L1-L27), [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159)

| Function | Does |
| --- | --- |
| `getCookie(c, key?, prefix?)` | One cookie value, or all cookies as an object |
| `getSignedCookie(c, secret, key?, prefix?)` | Like `getCookie`, verifying signatures; a bad signature reads as `false` |
| `setCookie(c, name, value, options?)` | Appends a `Set-Cookie` header |
| `setSignedCookie(c, name, value, secret, options?)` | Appends a signed `Set-Cookie` header |
| `deleteCookie(c, name, options?)` | Expires the cookie and returns its old value |
| `generateCookie`, `generateSignedCookie` | Return the header value without touching the context |

Sources: [src/helper/cookie/index.ts:27-145](repo://src/helper/cookie/index.ts#L27-L145)

## Reading cookies

### getCookie

`getCookie(c, key)` reads the raw `Cookie` header and returns the value of `key`, or `undefined` when the header or the cookie is missing. With a `prefix` of `'secure'` or `'host'`, it reads `__Secure-key` or `__Host-key` instead. Without a key it returns every cookie as an object, `{}` when there is no header.

Sources: [src/helper/cookie/index.ts:10-48](repo://src/helper/cookie/index.ts#L10-L48)

```ts
import { getCookie, setCookie } from 'hono/cookie'

app.get('/', (c) => {
  const yummy = getCookie(c, 'yummy_cookie')
  const all = getCookie(c)
  setCookie(c, 'delicious_cookie', 'macha', { httpOnly: true })
  return c.json({ yummy, all })
})
```

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102)

### Parsing rules

`parse(cookie, name)` splits the header on `;` and each pair at its first `=`, trimming spaces and tabs. A pair is skipped when its name is not a valid cookie-name token, when its value contains characters outside the allowed set (control characters, `"`, `;` and `\` are rejected, while spaces and commas are tolerated, as the comment explains, because they are common in practice), or when the same name appeared earlier: the first occurrence wins. Surrounding double quotes are removed, and a value containing `%` is percent-decoded with `tryDecode`, which leaves malformed sequences intact.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138), [src/utils/url.ts:79-92](repo://src/utils/url.ts#L79-L92)

When a single name is requested, `parse` returns `{}` immediately if the name does not occur anywhere in the header, and stops at the first valid match. The result object is created with `Object.create(null)`, so a cookie named `__proto__` cannot touch the prototype.

Sources: [src/utils/cookie.ts:102-136](repo://src/utils/cookie.ts#L102-L136)

## Writing cookies

### setCookie and generateCookie

`setCookie(c, name, value, options)` calls `generateCookie` and appends the result with `c.header('Set-Cookie', ..., { append: true })`, so several cookies can be set on one response. `generateCookie` defaults `path` to `/`. With `prefix: 'secure'` it prepends `__Secure-` and forces `secure: true`; with `prefix: 'host'` it prepends `__Host-`, forces `secure: true` and `path: '/'`, and drops any domain.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102)

Because `Set-Cookie` headers are appended, and the [[Context]] merges `Set-Cookie` values when a later response replaces `c.res`, cookies set by middleware before the handler survive in the final response.

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434)

### Serialisation and validation

`serialize` percent-encodes the value with `encodeURIComponent` and builds the header. It throws, rather than producing an unsafe header, in these cases:

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

- The name is not a valid token.
- A `__Secure-` name without `secure`, or a `__Host-` name without `secure`, without `path: '/'`, or with a `domain`.
- `domain`, `path`, `sameSite` or `priority` containing `;`, `\r` or `\n`.
- `maxAge` above 34,560,000 seconds or `expires` more than 400 days ahead, the limit of RFC 6265bis.
- `partitioned` without `secure`.

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

The attributes are written as `Max-Age`, `Domain`, `Path`, `Expires` (in UTC), `HttpOnly`, `Secure`, `SameSite` and `Priority` (both capitalised), and `Partitioned`. The `CookieConstraint` type enforces the prefix rules at compile time for literal names too.

Sources: [src/utils/cookie.ts:17-35](repo://src/utils/cookie.ts#L17-L35), [src/utils/cookie.ts:200-252](repo://src/utils/cookie.ts#L200-L252)

### deleteCookie

`deleteCookie(c, name, options)` reads the current value (honouring `options.prefix`), then sets the same cookie with an empty value and `maxAge: 0`, and returns the old value. The given `options` are passed through, so the deletion carries the same `path` and `domain` attributes as they specify.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Signed cookies

### Signing

`setSignedCookie(c, name, value, secret, options)` signs the value with HMAC-SHA256 through Web Crypto, using the secret (a string encoded as UTF-8, or raw bytes) as the key. The cookie value becomes `value.signature`, where the signature is standard Base64 (always 44 characters ending in `=`), and the whole is percent-encoded. The prefix handling matches `setCookie`.

Sources: [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139), [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

### Verifying

`getSignedCookie(c, secret, key?, prefix?)` parses the cookies, splits each value at its last `.`, and skips values whose signature part is not 44 characters ending in `=`. The others are verified with `crypto.subtle.verify`: a valid one yields the original value, an invalid one yields `false`. Callers should therefore check for `false` separately from `undefined`, which means the cookie is absent.

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

```ts
import { getSignedCookie, setSignedCookie } from 'hono/cookie'

app.get('/login', async (c) => {
  await setSignedCookie(c, 'session', 'user-42', SECRET, { httpOnly: true, secure: true })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const session = await getSignedCookie(c, SECRET, 'session')
  if (session === false) return c.text('tampered', 400)
  if (session === undefined) return c.text('not logged in', 401)
  return c.text(session)
})
```

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:130-139](repo://src/helper/cookie/index.ts#L130-L139)
