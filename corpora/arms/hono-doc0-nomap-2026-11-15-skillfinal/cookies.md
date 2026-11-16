---
title: "Cookies"
---
## Overview

The cookie helper (`hono/cookie`) reads cookies from the request's `Cookie` header and writes them as `Set-Cookie` headers on the response. It is a thin layer over `utils/cookie`, which does the parsing, serialization and HMAC signing. Writing goes through `c.header(..., { append: true })`, so several cookies can be set in one response and they survive later response replacement ([[Context]]).

Sources: [src/helper/cookie/index.ts:6-48](repo://src/helper/cookie/index.ts#L6-L48), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102)

Other parts of Hono use the same functions: the `cookie` validation target calls `getCookie(c)` ([[Validation]]), the `jwt` and `jwk` middleware can read their token with `getCookie` or `getSignedCookie` ([[Authentication Middleware]]), and the language detector caches its result with `setCookie` ([[Request Handling Middleware]]).

Sources: [src/validator/validator.ts:157-159](repo://src/validator/validator.ts#L157-L159), [src/middleware/jwt/jwt.ts:96-117](repo://src/middleware/jwt/jwt.ts#L96-L117), [src/middleware/language/language.ts:212-224](repo://src/middleware/language/language.ts#L212-L224)

## Functions

| Function | Does |
| --- | --- |
| `getCookie(c)` | every cookie as an object |
| `getCookie(c, name, prefix?)` | one cookie, or `undefined` |
| `getSignedCookie(c, secret)` | every cookie, each verified (`false` when the signature fails) |
| `getSignedCookie(c, secret, name, prefix?)` | one verified cookie, `false`, or `undefined` |
| `setCookie(c, name, value, options)` | appends a `Set-Cookie` header |
| `setSignedCookie(c, name, value, secret, options)` | appends a signed `Set-Cookie` header |
| `deleteCookie(c, name, options)` | sets the cookie empty with `Max-Age=0` and returns its previous value |
| `generateCookie` / `generateSignedCookie` | build the header string without setting it |

Sources: [src/helper/cookie/index.ts:10-76](repo://src/helper/cookie/index.ts#L10-L76), [src/helper/cookie/index.ts:78-145](repo://src/helper/cookie/index.ts#L78-L145)

`deleteCookie` must be given the same `path` and `domain` the cookie was set with, since it serializes a new cookie with those options; the default path for every write is `/`.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Parsing

`parse(cookieHeader, name)` splits the header on `;` and trims spaces and tabs around each name and value. Names must be valid RFC 6265 tokens; values may be wrapped in double quotes, which are removed, and must contain only allowed characters, otherwise the pair is skipped. Commas and spaces are accepted in values, which the code comment explains are common in practice. Values containing `%` are decoded with the tolerant decoder from `utils/url`. The first occurrence of a name wins.

Sources: [src/utils/cookie.ts:68-138](repo://src/utils/cookie.ts#L68-L138)

When a single name is requested, `parse` returns `{}` immediately if the name does not occur anywhere in the header, and stops at the first valid match, so reading one cookie does not parse the rest.

Sources: [src/utils/cookie.ts:102-136](repo://src/utils/cookie.ts#L102-L136)

## Prefixes

Cookie names starting with `__Secure-` or `__Host-` carry browser-enforced rules. The `prefix` option (`'secure'` or `'host'`) adds the prefix for you on both reads and writes, and the writers apply the required attributes:

Sources: [src/helper/cookie/index.ts:27-41](repo://src/helper/cookie/index.ts#L27-L41), [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

| Prefix | Name written | Attributes forced |
| --- | --- | --- |
| `secure` | `__Secure-name` | `Secure` (path defaults to `/`) |
| `host` | `__Host-name` | `Secure`, `Path=/`, no `Domain` |

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/utils/cookie.ts:11-35](repo://src/utils/cookie.ts#L11-L35)

At the type level, `serialize` checks the options against the name: a name typed as `__Host-...` requires `secure: true` and `path: '/'`, and `partitioned: true` requires `secure: true`.

Sources: [src/utils/cookie.ts:11-35](repo://src/utils/cookie.ts#L11-L35), [src/utils/cookie.ts:255-262](repo://src/utils/cookie.ts#L255-L262)

## Serialization rules

`serialize` URI-encodes the value and builds `name=value` followed by the attributes. It throws instead of emitting a cookie a browser would reject:

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

| Condition | Error |
| --- | --- |
| name not a valid token | `Invalid cookie name` |
| `__Secure-` name without `secure` | must have Secure attributes |
| `__Host-` name without `secure`, with a path other than `/`, or with a domain | must have Secure / Path "/" / no Domain |
| `domain`, `path`, `sameSite` or `priority` containing `;`, CR or LF | must not contain these characters |
| `maxAge` over 34560000 seconds (400 days) | Max-Age should not exceed 400 days |
| `expires` more than 400 days ahead | Expires should not exceed 400 days |
| `partitioned` without `secure` | Partitioned Cookie must have Secure attributes |

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

Attribute values therefore never contain the `;` that separates attributes or a line break. `Max-Age` is truncated to an integer, and `sameSite` and `priority` are capitalized.

Sources: [src/utils/cookie.ts:194-242](repo://src/utils/cookie.ts#L194-L242)

## Signed cookies

`serializeSigned(name, value, secret)` signs the raw value with HMAC-SHA-256 through `crypto.subtle`, appends `.` and the base64 signature, and then URI-encodes and serializes the whole string. The secret may be a string or a `BufferSource`.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

`parseSigned` parses normally, splits each value at its last `.`, and accepts only a 44-character signature ending in `=`, the length of a base64 SHA-256 HMAC, as the code comment notes. It verifies the signature with `crypto.subtle.verify` and returns the unsigned value, or `false` when verification fails. Values without a well-formed signature are left out entirely, so `getSignedCookie` distinguishes "absent or unsigned" (`undefined`) from "tampered" (`false`).

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)
