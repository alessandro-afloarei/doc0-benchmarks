---
title: "Cookie Helper"
---
## Overview

The cookie helper (`hono/cookie`) reads the request's `Cookie` header and writes `Set-Cookie` headers through the [[Context]]. It is a thin layer: `src/helper/cookie/index.ts` decides the final cookie name (adding a `__Secure-` or `__Host-` prefix) and the default attributes, and `src/utils/cookie.ts` does the actual parsing, serialization, validation and HMAC signing with the Web Crypto API, so it runs unchanged on every runtime.

Sources: [src/helper/cookie/index.ts:1-48](repo://src/helper/cookie/index.ts#L1-L48), [src/utils/cookie.ts:1-42](repo://src/utils/cookie.ts#L1-L42)

The helper never keeps state of its own. Reading always goes to `c.req.raw.headers.get('Cookie')`, and writing always appends a header with `c.header(..., { append: true })`, so several cookies set in one handler each produce their own `Set-Cookie` line.

Sources: [src/helper/cookie/index.ts:99-139](repo://src/helper/cookie/index.ts#L99-L139)

## Public interface

| Function | Returns | What it does |
| --- | --- | --- |
| `getCookie(c)` | `Cookie` (`Record<string, string>`) | Parses every cookie in the request; `{}` when there is no header. |
| `getCookie(c, key, prefix?)` | `string \| undefined` | Reads one cookie, adding `__Secure-` or `__Host-` to `key` when `prefix` is `'secure'` or `'host'`. |
| `getSignedCookie(c, secret)` | `Promise<SignedCookie>` | Parses all cookies and verifies each signature; a failed check yields `false`. |
| `getSignedCookie(c, secret, key, prefix?)` | `Promise<string \| undefined \| false>` | Reads and verifies one signed cookie. |
| `generateCookie(name, value, opt?)` | `string` | Builds a `Set-Cookie` value without touching a context. |
| `setCookie(c, name, value, opt?)` | `void` | `generateCookie` then appends `Set-Cookie`. |
| `generateSignedCookie(name, value, secret, opt?)` | `Promise<string>` | Builds a signed `Set-Cookie` value. |
| `setSignedCookie(c, name, value, secret, opt?)` | `Promise<void>` | `generateSignedCookie` then appends `set-cookie`. |
| `deleteCookie(c, name, opt?)` | `string \| undefined` | Returns the current value and sets the cookie again with `Max-Age=0`. |

Sources: [src/helper/cookie/index.ts:10-25](repo://src/helper/cookie/index.ts#L10-L25), [src/helper/cookie/index.ts:27-145](repo://src/helper/cookie/index.ts#L27-L145), [src/utils/cookie.ts:8-9](repo://src/utils/cookie.ts#L8-L9)

```ts
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

app.get('/session', (c) => {
  const theme = getCookie(c, 'theme')
  setCookie(c, 'session', 'abc', { httpOnly: true, sameSite: 'Lax', maxAge: 3600 })
  deleteCookie(c, 'legacy')
  return c.text(theme ?? 'default')
})
```

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48), [src/helper/cookie/index.ts:99-145](repo://src/helper/cookie/index.ts#L99-L145)

## Options

`CookieOptions` carries every attribute `_serialize` knows how to write. Its type is intersected with `PartitionedCookieConstraint`, so `partitioned: true` only type-checks together with `secure: true`; the same rule is enforced again at run time.

Sources: [src/utils/cookie.ts:11-29](repo://src/utils/cookie.ts#L11-L29)

| Option | Type | Written as |
| --- | --- | --- |
| `domain` | `string` | `; Domain=...` (dropped when `prefix` is `'host'`) |
| `path` | `string` | `; Path=...` (the helpers default it to `/`) |
| `maxAge` | `number` | `; Max-Age=n`, only when `n >= 0`, truncated with `\| 0` |
| `expires` | `Date` | `; Expires=` plus `toUTCString()` |
| `httpOnly` | `boolean` | `; HttpOnly` |
| `secure` | `boolean` | `; Secure` |
| `sameSite` | `'Strict' \| 'Lax' \| 'None'` (any case) | `; SameSite=` with the first letter upper-cased |
| `priority` | `'Low' \| 'Medium' \| 'High'` (any case) | `; Priority=` with the first letter upper-cased |
| `partitioned` | `boolean` | `; Partitioned` |
| `prefix` | `'secure' \| 'host'` | Adds `__Secure-` or `__Host-` to the name |

Sources: [src/utils/cookie.ts:17-29](repo://src/utils/cookie.ts#L17-L29), [src/utils/cookie.ts:200-253](repo://src/utils/cookie.ts#L200-L253)

## Cookie prefixes

### Attributes forced by the helper

The `prefix` option is resolved in `generateCookie` and `generateSignedCookie`, which both rewrite the name and the options before serialization. The order of the spread matters: for `'secure'` the caller's options are spread after the default `path: '/'`, so a custom path survives, but `secure: true` is placed last and always wins. For `'host'` the defaults come after the caller's options, so `path: '/'`, `secure: true` and `domain: undefined` override anything passed in.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97), [src/helper/cookie/index.ts:104-128](repo://src/helper/cookie/index.ts#L104-L128)

| `prefix` | Name written | `path` | `secure` | `domain` |
| --- | --- | --- | --- | --- |
| none | `name` | `/` unless given | as given | as given |
| `'secure'` | `__Secure-name` | `/` unless given | always `true` | as given |
| `'host'` | `__Host-name` | always `/` | always `true` | always removed |

Sources: [src/helper/cookie/index.ts:83-96](repo://src/helper/cookie/index.ts#L83-L96)

### Rules checked at serialization

A name that already starts with `__Secure-` or `__Host-` (for example one passed to the lower-level `serialize`) is checked by `_serialize` itself, following RFC 6265bis: a `__Secure-` cookie without `secure` throws, and a `__Host-` cookie throws unless it is `secure`, has `path` exactly `/` and has no `domain`. At the type level `CookieConstraint<Name>` gives the same rules to `serialize`, picking `SecureCookieConstraint` or `HostCookieConstraint` from the template-literal name.

Sources: [src/utils/cookie.ts:14-35](repo://src/utils/cookie.ts#L14-L35), [src/utils/cookie.ts:174-192](repo://src/utils/cookie.ts#L174-L192)

On the read side, `getCookie` and `getSignedCookie` apply the same naming: passing `'secure'` or `'host'` as the third (or fourth) argument looks up `__Secure-key` or `__Host-key`. `deleteCookie` passes `opt.prefix` to `getCookie` for this reason.

Sources: [src/helper/cookie/index.ts:27-76](repo://src/helper/cookie/index.ts#L27-L76), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

## Parsing

`parse(cookie, name?)` splits the header on `;` and builds a prototype-less object (`Object.create(null)`), so a cookie called `__proto__` cannot pollute anything. Each pair goes through the steps below.

Sources: [src/utils/cookie.ts:102-109](repo://src/utils/cookie.ts#L102-L109)

1. Skips the pair when it has no `=`.
2. Trims spaces and tabs from the name with `trimCookieWhitespace`.
3. Skips the pair when a `name` was requested and this is a different one, when the name fails `validCookieNameRegEx`, or when the name was already seen, so the first occurrence of a duplicate wins.
4. Trims the value and strips one pair of surrounding double quotes.
5. Keeps the value only when it matches `validCookieValueRegEx`, percent-decoding it with `tryDecode(..., decodeURIComponent_)` only if it contains `%`.
6. Stops at the first match when a single `name` was requested.

Sources: [src/utils/cookie.ts:79-138](repo://src/utils/cookie.ts#L79-L138)

When one name is requested and the raw header does not contain it at all (`cookie.indexOf(name) === -1`), `parse` returns `{}` before splitting anything. This is why `getCookie(c, key)` is cheap even on large cookie headers.

Sources: [src/utils/cookie.ts:102-106](repo://src/utils/cookie.ts#L102-L106)

The two validation patterns follow RFC 6265 section 4.1.1. Names allow word characters and ``!#$%&'*.^`|~+-``. Values allow printable ASCII except `"`, `;` and `\`; comma and space are deliberately accepted because real clients send them.

Sources: [src/utils/cookie.ts:68-77](repo://src/utils/cookie.ts#L68-L77)

## Serialization and validation

`serialize` percent-encodes the value with `encodeURIComponent` and hands it to `_serialize`, which builds `name=value` and appends attributes in a fixed order: `Max-Age`, `Domain`, `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`, `Priority`, `Partitioned`.

Sources: [src/utils/cookie.ts:167-262](repo://src/utils/cookie.ts#L167-L262)

`_serialize` throws an `Error` instead of writing a cookie the browser would reject or misread, so a bad option fails in the handler rather than silently in the browser.

Sources: [src/utils/cookie.ts:167-170](repo://src/utils/cookie.ts#L167-L170)

| Condition | Error message |
| --- | --- |
| Name fails `validCookieNameRegEx` | `Invalid cookie name` |
| `__Secure-` name without `secure` | `__Secure- Cookie must have Secure attributes` |
| `__Host-` name without `secure` | `__Host- Cookie must have Secure attributes` |
| `__Host-` name with `path` other than `/` | `__Host- Cookie must have Path attributes with "/"` |
| `__Host-` name with `domain` | `__Host- Cookie must not have Domain attributes` |
| `domain`, `path`, `sameSite` or `priority` containing `;`, `\r` or `\n` | `<key> must not contain ";", "\r", or "\n"` |
| `maxAge` above 34560000 seconds (400 days) | `Cookies Max-Age SHOULD NOT be greater than 400 days ...` |
| `expires` more than 400 days ahead | `Cookies Expires SHOULD NOT be greater than 400 days ...` |
| `partitioned` without `secure` | `Partitioned Cookie must have Secure attributes` |

Sources: [src/utils/cookie.ts:167-253](repo://src/utils/cookie.ts#L167-L253)

> [!WARNING]
> The checks on `;`, `\r` and `\n` in attribute values stop header injection through `domain` or `path` built from user input. The cookie value itself is always percent-encoded, so it cannot inject attributes either.

Sources: [src/utils/cookie.ts:194-198](repo://src/utils/cookie.ts#L194-L198), [src/utils/cookie.ts:255-262](repo://src/utils/cookie.ts#L255-L262)

## Signed cookies

### Signing

`serializeSigned` signs the raw value with HMAC-SHA-256 and stores `value.signature`, then percent-encodes the whole string and runs the same `_serialize` checks. `getCryptoKey` imports the secret (a string is UTF-8 encoded first) as a raw `HMAC` key for both `sign` and `verify`, and `makeSignature` base64-encodes the 32-byte result, which is always 44 characters ending in `=`.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

### Verification

`parseSigned` first runs `parse`, then splits each value at its last `.`. Values without a dot (or starting with one) and signatures that are not 44 characters ending in `=` are skipped entirely, so they do not appear in the result. A well-formed signature is checked with `crypto.subtle.verify`; a match stores the unsigned value, a mismatch stores `false`. `verifySignature` catches decoding errors from `atob` and reports them as a failed check.

Sources: [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

```ts
import { getSignedCookie, setSignedCookie } from 'hono/cookie'

app.post('/login', async (c) => {
  await setSignedCookie(c, 'uid', '42', c.env.COOKIE_SECRET, { prefix: 'host', httpOnly: true })
  return c.text('ok')
})

app.get('/me', async (c) => {
  const uid = await getSignedCookie(c, c.env.COOKIE_SECRET, 'uid', 'host')
  if (uid === false) return c.text('tampered', 400)
  return c.text(uid ?? 'anonymous')
})
```

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

> [!IMPORTANT]
> Check for `false` separately from `undefined`: `undefined` means the cookie is absent or malformed, `false` means it was present with a valid-looking signature that did not verify.

Sources: [src/utils/cookie.ts:156-161](repo://src/utils/cookie.ts#L156-L161)

## Deleting cookies

`deleteCookie` reads the current value with `getCookie`, then calls `setCookie` with an empty value and `maxAge: 0`, which the browser treats as immediate expiry. Because it reuses `setCookie`, the deletion cookie gets the same default `path: '/'` and prefix handling; pass the same `path` and `domain` the cookie was set with, or the browser keeps the original.

Sources: [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145), [src/helper/cookie/index.ts:93-95](repo://src/helper/cookie/index.ts#L93-L95)

## Related pages

- [[Context]]: `c.header` and the request object the helper reads.
- [[Security Middleware]]: CSRF and secure headers that often accompany cookie sessions.
- [[Authentication Middleware]]: JWT middleware can read its token from a cookie.

Sources: [src/middleware/jwt/jwt.ts:96-110](repo://src/middleware/jwt/jwt.ts#L96-L110), [src/helper/cookie/index.ts:99-102](repo://src/helper/cookie/index.ts#L99-L102)
