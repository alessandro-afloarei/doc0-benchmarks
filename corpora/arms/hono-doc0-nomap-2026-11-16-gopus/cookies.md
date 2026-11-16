---
title: "Cookies"
---
## Overview

`hono/cookie` reads cookies from the request's `Cookie` header and writes `Set-Cookie` headers on the response, with optional HMAC signatures and support for the `__Secure-` and `__Host-` name prefixes. The helper functions in `src/helper/cookie` take the Context; the parsing, serializing and signing they call live in `src/utils/cookie.ts`, which other parts of Hono also use: the [[RPC Client]] serializes cookie arguments with it, the `cookie` validation target on [[Validation]] reads cookies through `getCookie`, and the jwt middleware on [[Authentication Middleware]] can read its token from a plain or signed cookie.

Sources: [src/helper/cookie/index.ts:1-8](repo://src/helper/cookie/index.ts#L1-L8), [src/client/client.ts:98-104](repo://src/client/client.ts#L98-L104), [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117)

| Function | Does |
| --- | --- |
| `getCookie(c)` | All cookies as an object. |
| `getCookie(c, name, prefix?)` | One cookie's value, or `undefined`. |
| `getSignedCookie(c, secret, name?, prefix?)` | Verified values; `false` for a cookie whose signature fails. |
| `setCookie(c, name, value, options?)` | Appends a `Set-Cookie` header. |
| `setSignedCookie(c, name, value, secret, options?)` | Appends a signed `Set-Cookie` header. |
| `deleteCookie(c, name, options?)` | Expires the cookie and returns its old value. |
| `generateCookie`, `generateSignedCookie` | Return the header value without setting it. |

Sources: [src/helper/cookie/index.ts:10-102](repo://src/helper/cookie/index.ts#L10-L102), [src/helper/cookie/index.ts:104-145](repo://src/helper/cookie/index.ts#L104-L145)

```ts
import { getCookie, setCookie } from 'hono/cookie'

app.get('/', (c) => {
  const visits = Number(getCookie(c, 'visits') ?? 0) + 1
  setCookie(c, 'visits', String(visits), { httpOnly: true, sameSite: 'Lax' })
  return c.text(`Visit ${visits}`)
})
```

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102)

## Reading cookies

`getCookie` reads the raw `Cookie` header and passes it to `parse`. With a name, it returns that cookie only; with `prefix: 'secure'` or `'host'` it looks up `__Secure-name` or `__Host-name`. Without a header it returns `undefined` for a name and `{}` for all.

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48)

`parse(cookie, name?)` splits the header on `;` and, for each pair:

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

1. skips pairs without `=`, and names that are not valid RFC 6265 tokens;
2. trims spaces and tabs around the name and the value, and removes surrounding double quotes;
3. keeps the first value seen for a name and ignores later duplicates;
4. keeps the value only if it uses allowed characters, which the comment says include spaces and commas because they are common in practice;
5. URI-decodes values that contain `%`, leaving malformed escapes as they are.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

When a name is requested, `parse` returns `{}` at once if the name does not appear anywhere in the header, and stops at the first valid match.

Sources: [src/utils/cookie.ts:102-106](repo://src/utils/cookie.ts#L102-L106), [src/utils/cookie.ts:128-135](repo://src/utils/cookie.ts#L128-L135)

## Writing cookies

`setCookie` appends rather than sets `Set-Cookie`, so several cookies can be written in one response, and the Context keeps them when a later middleware replaces the response, as [[Context and Responses]] explains. The path defaults to `/`.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`serialize` URI-encodes the value and writes the attributes:

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-253](repo://src/utils/cookie.ts#L200-L253)

| Option | Attribute |
| --- | --- |
| `maxAge` | `Max-Age`, truncated to an integer; more than 400 days throws |
| `expires` | `Expires` in UTC; more than 400 days ahead throws |
| `domain` | `Domain`, omitted for host-prefixed cookies |
| `path` | `Path` |
| `httpOnly`, `secure` | `HttpOnly`, `Secure` |
| `sameSite` | `SameSite=Strict`, `Lax` or `None`, capitalized |
| `priority` | `Priority=Low`, `Medium` or `High` |
| `partitioned` | `Partitioned`; throws without `secure` |

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-253](repo://src/utils/cookie.ts#L200-L253)

The 400-day limits cite the cookie specification draft in the code. An invalid name throws `Invalid cookie name`, and `domain`, `path`, `sameSite` or `priority` containing `;`, `\r` or `\n` throws, so a value cannot add attributes.

Sources: [src/utils/cookie.ts:167-198](repo://src/utils/cookie.ts#L167-L198)

`deleteCookie(c, name, options)` reads the current value, then sets the cookie to an empty value with `maxAge: 0`. The options must name the same path and domain the cookie was set with for the browser to remove it.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Cookie prefixes

The `prefix` option adds the name prefix and enforces its rules, which the code's comment summarizes from MDN:

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

- `prefix: 'secure'` names the cookie `__Secure-name` and forces `secure: true`.
- `prefix: 'host'` names it `__Host-name`, forces `secure: true` and `path: '/'`, and removes `domain`.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

`serialize` checks the same rules for names that already carry a prefix and throws when a `__Secure-` cookie lacks `Secure`, or a `__Host-` cookie lacks `Secure`, has a path other than `/`, or has a domain. At the type level, `CookieConstraint` requires the same options for prefixed names.

Sources: [src/utils/cookie.ts:31-35](repo://src/utils/cookie.ts#L31-L35), [src/utils/cookie.ts:174-192](repo://src/utils/cookie.ts#L174-L192)

## Signed cookies

`setSignedCookie` signs the value with HMAC-SHA-256 through `crypto.subtle`, using a string secret encoded as UTF-8 or a `BufferSource`, and stores `value.signature` with the base64 signature, URI-encoded.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

`getSignedCookie` parses the header, splits each value at its last `.`, and skips values whose signature part is not 44 characters ending in `=`, the length a base64 SHA-256 HMAC always has, as a comment notes. The rest are verified: a valid one yields the original value, an invalid one yields `false`. A cookie that is absent is `undefined`, so callers can tell a missing cookie from a tampered one.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76)

The signature proves the server set the value; it does not hide it. The value stays readable to anyone who sees the cookie.

Sources: [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)
