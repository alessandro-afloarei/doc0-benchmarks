---
title: "Request and Connection Helpers"
---
## Overview

These helpers read what the caller sent or tell the handler where the request runs: `hono/cookie` reads and writes cookies, `hono/accepts` negotiates a media type from the `Accept` header, `hono/conninfo` describes the client connection, `hono/adapter` detects the runtime, and `hono/proxy` forwards a request to another server. Each one takes the `Context` (or a `Request`) and returns a value, and none of them produces a response on its own. The request object they read is described in [[Request Object]], and the response helpers are in [[Response and Application Helpers]].

Sources: [src/helper/cookie/index.ts:27-49](repo://src/helper/cookie/index.ts#L27-L49), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/proxy/index.ts:160-175](repo://src/helper/proxy/index.ts#L160-L175)

## Cookies

`getCookie(c, key, prefix)` parses the `Cookie` header. With a key it returns that one value, and a `prefix` of `secure` or `host` looks for the `__Secure-` or `__Host-` name instead. Without a key it returns every cookie as an object, or `{}` when the header is absent.

Sources: [src/helper/cookie/index.ts:27-49](repo://src/helper/cookie/index.ts#L27-L49)

`getSignedCookie` does the same lookup and then checks the value's signature with the secret. The signing functions, `generateSignedCookie` and `setSignedCookie`, sign the value with the secret so that a tampered cookie is rejected on read.

Sources: [src/helper/cookie/index.ts:50-76](repo://src/helper/cookie/index.ts#L50-L76), [src/helper/cookie/index.ts:104-139](repo://src/helper/cookie/index.ts#L104-L139)

`generateCookie` builds the `Set-Cookie` string from the name, value and options. `setCookie` writes that string into the response headers. `deleteCookie` reads the cookie's current value, sets the cookie again with an empty value and `maxAge: 0`, and returns the value it read.

Sources: [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/helper/cookie/index.ts:141-145](repo://src/helper/cookie/index.ts#L141-L145)


## Connection information

`hono/conninfo` exports types only: `ConnInfo`, `GetConnInfo` and `AddressType`. The function itself is different on each runtime, so each adapter exports its own `getConnInfo`, which reads the client address from that runtime's connection object. Middleware that needs the address, such as the IP restriction in [[Security Middleware]], takes that function as an argument.

Sources: [src/helper/conninfo/index.ts:6-6](repo://src/helper/conninfo/index.ts#L6-L6), [src/adapter/bun/conninfo.ts:10-12](repo://src/adapter/bun/conninfo.ts#L10-L12), [src/adapter/lambda-edge/conninfo.ts:11-13](repo://src/adapter/lambda-edge/conninfo.ts#L11-L13)

## Content negotiation

`accepts(c, options)` reads the header named in `options.header`, parses it into media ranges with their quality values, and returns the best match among the types listed in `options.supports`. When the header is missing, the `default` value is returned instead.

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/accepts/index.ts:6-6](repo://src/helper/accepts/index.ts#L6-L6)

## Runtime detection

`getRuntimeKey()` decides which runtime the code runs on. It checks the user agent against a table of known values first, when `navigator.userAgent` exists. Then it checks for the Edge runtime global, the Fastly global, and finally Node through `process.release.name`. Anything else is `other`.

Sources: [src/helper/adapter/index.ts:43-49](repo://src/helper/adapter/index.ts#L43-L49), [src/helper/adapter/index.ts:50-84](repo://src/helper/adapter/index.ts#L50-L84)

`env(c, runtime)` returns the environment object for the runtime: `process.env` on Bun, Node and Edge Runtime, `Deno.env` on Deno, the context's bindings on `workerd`, and an empty object on Fastly and unknown runtimes. It calls `getRuntimeKey` when no runtime is given, so the same handler code reads its configuration on each platform.

Sources: [src/helper/adapter/index.ts:10-42](repo://src/helper/adapter/index.ts#L10-L42)

## Proxying requests

`proxy(input, init)` sends a new `Request` to `input` and returns the response. The init can carry the original request as `raw`, and its headers are copied to the new request unless the caller overrides them. When `strictConnectionProcessing` is set, the headers named in the `Connection` header are removed first, as RFC 9110 requires.

Sources: [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172), [src/helper/proxy/index.ts:58-82](repo://src/helper/proxy/index.ts#L58-L82)

Before the call, the helper deletes the `Accept-Encoding` header from the forwarded request. Calls can replace the `fetch` used with `customFetch`.

Sources: [src/helper/proxy/index.ts:170-173](repo://src/helper/proxy/index.ts#L170-L173)
