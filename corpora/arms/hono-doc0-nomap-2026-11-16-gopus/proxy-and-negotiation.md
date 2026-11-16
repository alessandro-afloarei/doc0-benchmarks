---
title: "Proxy and Content Negotiation"
---
## Overview

Two helpers deal with requests that the handler does not answer from its own data. `proxy` from `hono/proxy` forwards a request to another server and returns that server's response in a form the handler can return directly, cleaning up headers that must not cross a proxy. `accepts` from `hono/accepts` reads an `Accept`-style header and picks the best value the app supports. Both build on the standard `Request`, `Response` and `fetch`; `accepts` shares its header parser, `parseAccept`, with the compress and language middleware on [[Response Middleware]] and [[Request Control Middleware]].

Sources: [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/language/language.ts:74-76](repo://src/middleware/language/language.ts#L74-L76)

## proxy

### Calling it

`proxy(input, init)` has the signature of `fetch`, plus three options: `raw`, a request whose method, body, headers and signal are copied; `customFetch`, used instead of the global `fetch`; and `strictConnectionProcessing`. Passing `c.req`, or spreading it into `init`, supplies `raw`, since `HonoRequest` exposes the original request under that name.

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48), [src/helper/proxy/index.ts:160-166](repo://src/helper/proxy/index.ts#L160-L166), [src/request.ts:51-51](repo://src/request.ts#L51-L51)

```ts
app.get('/proxy/:path', (c) => {
  return proxy(`http://${originServer}/${c.req.param('path')}`, {
    headers: {
      ...c.req.header(), // optional, specify only when forwarding all the request data (including credentials) is necessary.
      'X-Forwarded-For': '127.0.0.1',
      'X-Forwarded-Host': c.req.header('host'),
      Authorization: undefined, // do not propagate request headers contained in c.req.header('Authorization')
    },
  }).then((res) => {
    res.headers.delete('Set-Cookie')
    return res
  })
})
```

Sources: [src/helper/proxy/index.ts:123-158](repo://src/helper/proxy/index.ts#L123-L158)

### Building the outgoing request

The new request starts from `raw`'s properties, then `init`'s, so `init` wins. Its headers start as a copy of `raw`'s with the hop-by-hop headers removed: `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding` and `upgrade`, the list from RFC 2616 cited in the code. A streamed body is forwarded with `duplex: 'half'`.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:50-91](repo://src/helper/proxy/index.ts#L50-L91), [src/helper/proxy/index.ts:168-171](repo://src/helper/proxy/index.ts#L168-L171)

When `init.headers` is a plain object, a key whose value is `undefined` or `null` is dropped, which is how the example above keeps `Authorization` from reaching the origin. `Accept-Encoding` is always deleted, so the origin answers in an encoding the runtime's `fetch` can decode itself.

Sources: [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113), [src/helper/proxy/index.ts:115-122](repo://src/helper/proxy/index.ts#L115-L122), [src/helper/proxy/index.ts:172-172](repo://src/helper/proxy/index.ts#L172-L172)

### The Connection header

By default the incoming `Connection` header's list of names is ignored. The option's documentation explains why: honouring it would let a client name headers, such as one an upstream proxy added, for the proxy to strip, a hop-by-hop header injection. With `strictConnectionProcessing: true`, meant for trusted clients, each listed name is removed as RFC 9110 requires, and a name that is not a valid token throws `HTTPException(400)`.

Sources: [src/helper/proxy/index.ts:21-43](repo://src/helper/proxy/index.ts#L21-L43), [src/helper/proxy/index.ts:58-78](repo://src/helper/proxy/index.ts#L58-L78)

### The returned response

The origin's response is copied into a new `Response` with the same status, status text and body, minus the hop-by-hop headers. When it had `Content-Encoding`, that header and `Content-Length` are removed, because the body has already been decoded and, as the comment notes, the length referred to the compressed bytes. The result has mutable headers, so the handler can adjust it before returning it.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)

Errors from `fetch`, such as a refused connection, are not caught by `proxy` and reach the app's error handler from [[Request Lifecycle and Error Handling]].

Sources: [src/helper/proxy/index.ts:174-174](repo://src/helper/proxy/index.ts#L174-L174)

## accepts

### Choosing a value

`accepts(c, { header, supports, default, match? })` reads the named header. When it is missing, the default is returned. Otherwise the header is parsed and passed to `match`, by default `defaultMatch`, which sorts by quality and returns the first type in `supports`, or the default when none is.

Sources: [src/helper/accepts/accepts.ts:5-49](repo://src/helper/accepts/accepts.ts#L5-L49)

```ts
app.get('/users', (c) => {
  const lang = accepts(c, {
    header: 'Accept-Language',
    supports: ['en', 'zh'],
    default: 'en',
  })
})
```

Sources: [src/helper/accepts/accepts.ts:27-39](repo://src/helper/accepts/accepts.ts#L27-L39)

`defaultMatch` compares strings exactly: a header value of `text/*` or `en-US` does not match `text/html` or `en` in `supports`. A custom `match` receives the parsed list and the options and can implement wildcards or prefixes.

Sources: [src/helper/accepts/accepts.ts:21-25](repo://src/helper/accepts/accepts.ts#L21-L25)

### parseAccept

`parseAccept(header)` in `utils/accept` turns a header such as `text/html, application/json;q=0.9` into `{ type, params, q }` entries. It is a hand-written scanner rather than a split on commas, so quoted parameter values may contain commas and semicolons and backslash escapes are unescaped. Empty types and malformed parameters are skipped instead of failing the whole header.

Sources: [src/utils/accept.ts:1-5](repo://src/utils/accept.ts#L1-L5), [src/utils/accept.ts:66-157](repo://src/utils/accept.ts#L66-L157), [src/utils/accept.ts:159-209](repo://src/utils/accept.ts#L159-L209)

The quality comes from the `q` parameter. Missing, empty, unparsable or out-of-range values count as 1, `NaN` and negative infinity as 0. The list is sorted by quality, highest first, only when an entry has a higher quality than the one before it; the comment notes headers usually arrive sorted already.

Sources: [src/utils/accept.ts:211-266](repo://src/utils/accept.ts#L211-L266)
