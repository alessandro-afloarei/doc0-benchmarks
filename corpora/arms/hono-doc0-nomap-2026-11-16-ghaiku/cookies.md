---
title: "Cookies"
---
## Overview

The cookie helper reads cookies from the request and writes `Set-Cookie` headers to the response. It has a plain form and a signed form. The signed form appends an HMAC signature to the value, so a reader can tell whether the value was changed by the client. The helper functions are in `src/helper/cookie/index.ts`, and the parsing, signing and serialising code they call is in `src/utils/cookie.ts`. This page covers the read path, the write path, the name prefixes, and the checks that `serialize` makes. Headers in general are on [[Context]].

Sources: [src/helper/cookie/index.ts:27-47](repo://src/helper/cookie/index.ts#L27-L47), [src/utils/cookie.ts:37-37](repo://src/utils/cookie.ts#L37-L37)

## Reading cookies

`getCookie(c, key, prefix)` reads the `Cookie` header of the raw request. With a key it returns that cookie's value, or `undefined` when the header is absent. With no key it returns every cookie as an object, or an empty object when there is no header. The `prefix` option changes the key looked up to `__Secure-name` or `__Host-name`.

Sources: [src/helper/cookie/index.ts:27-48](repo://src/helper/cookie/index.ts#L27-L48)

`parse` scans the header by splitting on `;`. A pair with no `=` is skipped, and so is a name that does not match the valid-name pattern. A repeated name keeps its first value. Quotes are removed from the value, and a value with `%` is decoded. When a single name is wanted, the scan stops at the first match, and a quick check returns at once when the name does not appear in the header text.

Sources: [src/utils/cookie.ts:102-138](repo://src/utils/cookie.ts#L102-L138)

`getSignedCookie(c, secret, key, prefix)` reads the same header and then verifies each value. A value is split at its last `.`, and a signature that is not 44 characters ending in `=` is dropped. A signed value that fails the check is stored as `false`, so the caller can tell a bad signature from a missing cookie.

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/utils/cookie.ts:140-165](repo://src/utils/cookie.ts#L140-L165)

## Writing cookies

`setCookie(c, name, value, opt)` calls `generateCookie`, and appends the result to the `Set-Cookie` header with `append`, so several cookies can be set on one response. `deleteCookie` reads the cookie's current value, then calls `setCookie` with an empty value and `maxAge: 0`, and returns the value it read.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)

`generateCookie` sets `Path=/` by default. A `secure` prefix adds `__Secure-` to the name and the `Secure` attribute. A `host` prefix adds `__Host-`, forces `Secure` and `Path=/`, and clears the domain. Without a prefix the name is used as it is.

Sources: [src/helper/cookie/index.ts:78-97](repo://src/helper/cookie/index.ts#L78-L97)

`generateSignedCookie` does the same with a signature. The value is signed first, and the result is the value, a dot and the signature, encoded for the header.

Sources: [src/helper/cookie/index.ts:104-128](repo://src/helper/cookie/index.ts#L104-L128), [src/utils/cookie.ts:264-274](repo://src/utils/cookie.ts#L264-L274)

## Checks in serialize

`serialize` percent-encodes the value, and `_serialize` checks the name and attributes before it builds the string. The name must match the valid-name pattern. A `__Secure-` name requires the `secure` attribute. A `__Host-` name requires `secure`, a path of `/` and no domain. The `domain`, `path`, `sameSite` and `priority` attributes may not contain `;`, a carriage return or a newline.

Sources: [src/utils/cookie.ts:255-263](repo://src/utils/cookie.ts#L255-L263), [src/utils/cookie.ts:167-198](repo://src/utils/cookie.ts#L167-L198)

A `maxAge` above 34560000 seconds, which is 400 days, is refused with an error. A `domain` is written unless the prefix is `host`, and `path` is written when it is set.

Sources: [src/utils/cookie.ts:200-216](repo://src/utils/cookie.ts#L200-L216)

The signature uses HMAC with SHA-256, through Web Crypto. The key is built from the secret, which can be a string or a `BufferSource`, and the signature is base64 text of a fixed 44 characters.

Sources: [src/utils/cookie.ts:37-49](repo://src/utils/cookie.ts#L37-L49), [src/utils/cookie.ts:51-66](repo://src/utils/cookie.ts#L51-L66)
