---
title: "Cookies"
---
## Overview

`hono/cookie` reads cookies from the request's `Cookie` header and writes them as `Set-Cookie` headers on the response. It handles the details that are easy to get wrong by hand: percent-encoding values, the `__Secure-` and `__Host-` name prefixes and their required attributes, limits from the current cookie specification, and HMAC-signed cookies that detect tampering. The parsing and serialization live in `utils/cookie.ts`; `helper/cookie` wraps them around the [[Context and Responses]].

Sources: [src/helper/cookie/index.ts:6-8](repo://src/helper/cookie/index.ts#L6-L8), [src/utils/cookie.ts:1-35](repo://src/utils/cookie.ts#L1-L35)

```ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

app.get('/', (c) => {
  const theme = getCookie(c, 'theme') ?? 'light'
  setCookie(c, 'visited', '1', { httpOnly: true, sameSite: 'Lax', maxAge: 3600 })
  return c.text(theme)
})

app.post('/logout', (c) => {
  deleteCookie(c, 'session')
  return c.redirect('/')
})
```

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Reading cookies

### getCookie

`getCookie(c, name)` returns one value or `undefined`; `getCookie(c)` returns all cookies as an object (empty if there is no header). With a prefix option, `getCookie(c, 'id', 'host')` reads `__Host-id` and `'secure'` reads `__Secure-id`.

Sources: [src/helper/cookie/index.ts:10-48](repo://src/helper/cookie/index.ts#L10-L48)

### The parser

`parse(header, name?)` splits the header on `;` and, for each `name=value` pair:

Sources: [src/utils/cookie.ts:102-138](repo://src/utils/cookie.ts#L102-L138)

1. trims spaces and tabs around name and value;
2. skips names that are not valid RFC 6265 tokens, and repeats of a name already seen, so the first occurrence wins;
3. removes surrounding double quotes from the value;
4. keeps the value only if it contains allowed characters (printable ASCII except `"`, `;` and `\`; comma and space are tolerated because real browsers send them);
5. percent-decodes values containing `%`, keeping the raw value if decoding fails.

Sources: [src/utils/cookie.ts:68-100](repo://src/utils/cookie.ts#L68-L100), [src/utils/cookie.ts:109-136](repo://src/utils/cookie.ts#L109-L136)

When a single name is requested, the parser returns early if the name does not appear in the header at all and stops at the first match. The result object has no prototype, so a cookie named `__proto__` cannot reach `Object.prototype`.

Sources: [src/utils/cookie.ts:102-108](repo://src/utils/cookie.ts#L102-L108), [src/utils/cookie.ts:128-134](repo://src/utils/cookie.ts#L128-L134)

## Writing cookies

### setCookie and generateCookie

`setCookie(c, name, value, options)` appends a `Set-Cookie` header through `c.header(..., { append: true })`, so several cookies can be set in one response, and middleware can set cookies before or after the handler (see [[Context and Responses]] for how headers carry over). `generateCookie` returns the same string without a context, for use with `new Response` or `c.newResponse`.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102)

Unless given, `path` defaults to `/`. The `prefix` option adds the name prefix and enforces its rules:

Sources: [src/helper/cookie/index.ts:83-96](repo://src/helper/cookie/index.ts#L83-L96)

| `prefix` | Name | Forced attributes |
| --- | --- | --- |
| `'secure'` | `__Secure-name` | `Secure` |
| `'host'` | `__Host-name` | `Secure`, `Path=/`, no `Domain` |

Sources: [src/helper/cookie/index.ts:84-93](repo://src/helper/cookie/index.ts#L84-L93)

### Serialization rules

`serialize` percent-encodes the value with `encodeURIComponent`, then `_serialize` validates and appends the attributes in a fixed order: `Max-Age`, `Domain`, `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`, `Priority`, `Partitioned`.

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

It throws instead of emitting a cookie a browser would reject or that could inject headers:

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

| Condition | Error |
| --- | --- |
| Name is not a valid token | `Invalid cookie name` |
| `__Secure-` name without `secure` | must have Secure |
| `__Host-` name without `secure`, with a path other than `/`, or with `domain` | must have Secure / Path `/` / no Domain |
| `domain`, `path`, `sameSite` or `priority` contains `;`, CR or LF | must not contain those characters |
| `maxAge` over 400 days (34,560,000 s) or `expires` more than 400 days ahead | SHOULD NOT be greater than 400 days |
| `partitioned` without `secure` | Partitioned Cookie must have Secure |

Sources: [src/utils/cookie.ts:168-198](repo://src/utils/cookie.ts#L168-L198), [src/utils/cookie.ts:200-226](repo://src/utils/cookie.ts#L200-L226), [src/utils/cookie.ts:244-250](repo://src/utils/cookie.ts#L244-L250)

`sameSite` and `priority` accept any letter case and are written capitalized (`SameSite=Lax`). The TypeScript types already reject a `__Host-` name without `secure: true` and `path: '/'`, and `partitioned: true` without `secure: true`, so most of these errors surface at compile time.

Sources: [src/utils/cookie.ts:11-35](repo://src/utils/cookie.ts#L11-L35), [src/utils/cookie.ts:236-242](repo://src/utils/cookie.ts#L236-L242)

### deleteCookie

`deleteCookie(c, name, options)` reads the current value, then sets the cookie to an empty value with `Max-Age=0`, and returns the old value. Pass the same `path`, `domain` and `prefix` the cookie was set with, or the browser keeps the original.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Signed cookies

### Signing

`setSignedCookie(c, name, value, secret, options)` appends an HMAC-SHA-256 signature to the value as `value.signature`. The signature is computed with Web Crypto using `secret` (a string or bytes) as the raw key and encoded in base64, which is always 44 characters ending in `=`. The combined string is then percent-encoded and serialized with the same rules as above. `generateSignedCookie` returns the header string instead.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

### Verifying

`getSignedCookie(c, secret, name, prefix?)` returns:

Sources: [src/helper/cookie/index.ts:16-25](repo://src/helper/cookie/index.ts#L16-L25), [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76)

- the original value when the signature verifies;
- `false` when the cookie exists but its signature is wrong, for example because the value was edited;
- `undefined` when the cookie is missing.

Sources: [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

`parseSigned` splits each value at its last `.`, ignores values whose signature part is not 44 characters ending in `=` (these are plain cookies, not signed ones), and checks the signature with `crypto.subtle.verify`, which compares in constant time. Malformed base64 makes verification return `false` instead of throwing.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:148-162](repo://src/utils/cookie.ts#L148-L162)

> [!NOTE]
> Signing proves the server set the value; it does not hide it. The value is readable by anyone with the cookie. Store only identifiers or non-sensitive data, or encrypt before signing.

Sources: [src/utils/cookie.ts:270-272](repo://src/utils/cookie.ts#L270-L272)

## Where cookies are used

The `jwt` and `jwk` middleware can read their token from a cookie, plain or signed, with a prefix ([[JWT and JWK]]). The `languageDetector` middleware stores the chosen language in a cookie ([[Content Negotiation and Language]]), and the `cookie` validation target reads all cookies through `getCookie` ([[Validation]]).

Sources: [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224), [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159)
