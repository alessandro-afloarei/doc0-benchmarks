---
title: "Proxy Helper"
---
## Overview

`proxy(input, init)` from `hono/proxy` forwards a request to another server and returns a `Response` the handler can return as is. It has the same signature as `fetch`, plus a few proxy options, and fixes what a plain `fetch` gets wrong when relaying: it strips hop-by-hop headers in both directions, stops the upstream from compressing responses the runtime would then decompress, and removes headers that no longer describe the body. Use it to put a Hono app in front of another HTTP service. To run another framework's handler in the same process, use `app.mount` instead ([[Hono Application]]).

Sources: [src/helper/proxy/index.ts:115-190](repo://src/helper/proxy/index.ts#L115-L190)

```ts
import { proxy } from 'hono/proxy'

app.all('/api/*', (c) => {
  const url = new URL(c.req.url)
  return proxy(`https://backend.internal${url.pathname}${url.search}`, {
    ...c.req, // method, body, headers and signal of the incoming request
    headers: {
      ...c.req.header(),
      'X-Forwarded-Host': c.req.header('host'),
      Authorization: undefined, // do not forward credentials
    },
  })
})
```

Sources: [src/helper/proxy/index.ts:123-158](repo://src/helper/proxy/index.ts#L123-L158)

## Options

`init` accepts everything `RequestInit` does, plus:

Sources: [src/helper/proxy/index.ts:24-44](repo://src/helper/proxy/index.ts#L24-L44)

| Option | Effect |
| --- | --- |
| `raw` | An incoming `Request` to copy method, body, headers and abort signal from |
| `headers` | A `Headers`, an array of pairs, or a record in which an `undefined` or `null` value removes the header |
| `customFetch` | Replaces the global `fetch`, e.g. a service binding's `fetch` |
| `strictConnectionProcessing` | Honour the `Connection` header's list of headers to drop (default `false`) |

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48)

Spreading `...c.req` works because `HonoRequest` exposes the incoming request as `raw` (see [[Reading Requests]]). Passing a `Request` itself as `init` is treated the same as `{ raw: request }`.

Sources: [src/helper/proxy/index.ts:160-166](repo://src/helper/proxy/index.ts#L160-L166), [src/request.ts:51-51](repo://src/request.ts#L51-L51)

## Building the upstream request

### Merging sources

`proxy` builds a new `Request` from two layers. The later layer wins key by key, so passing `headers` replaces the copied header set entirely; spread `c.req.header()` into it to keep the incoming headers.

Sources: [src/helper/proxy/index.ts:168-171](repo://src/helper/proxy/index.ts#L168-L171)

1. From `raw`, `buildRequestInitFromRequest` copies the method, the body (streamed, with `duplex: 'half'`), the headers and the abort signal. If the client disconnects, the upstream request is cancelled too.
2. The remaining `init` fields are applied on top. `preprocessRequestInit` turns a header record into `Headers`, skipping keys whose value is `undefined` or `null`.

Sources: [src/helper/proxy/index.ts:50-113](repo://src/helper/proxy/index.ts#L50-L113)

### Hop-by-hop headers

Headers that describe one connection, not the message, must not be forwarded. These are `Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding` and `Upgrade`. They are removed from the headers copied from `raw`.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:80-82](repo://src/helper/proxy/index.ts#L80-L82)

RFC 9110 also lets a client name extra per-connection headers in `Connection`, which a proxy should remove. Hono does this only with `strictConnectionProcessing: true`. It then checks that each listed name is a valid token, answering `HTTPException(400)` otherwise, and deletes those headers. It is off by default because an untrusted client could list `Authorization` or another header the app sets for the upstream and have it stripped.

Sources: [src/helper/proxy/index.ts:21-22](repo://src/helper/proxy/index.ts#L21-L22), [src/helper/proxy/index.ts:32-43](repo://src/helper/proxy/index.ts#L32-L43), [src/helper/proxy/index.ts:60-78](repo://src/helper/proxy/index.ts#L60-L78)

### Accept-Encoding

`Accept-Encoding` is always deleted before sending. The runtime's `fetch` then negotiates an encoding it can decode itself, and the body the app receives is already decoded.

Sources: [src/helper/proxy/index.ts:172-172](repo://src/helper/proxy/index.ts#L172-L172)

## Building the response

The upstream response is copied into a new `Response` with the same status, status text and body stream, after cleaning its headers:

Sources: [src/helper/proxy/index.ts:174-189](repo://src/helper/proxy/index.ts#L174-L189)

- hop-by-hop headers are removed;
- if `Content-Encoding` is present, it is removed together with `Content-Length`, because `fetch` has already decoded the body and the original length counts compressed bytes.

Sources: [src/helper/proxy/index.ts:176-183](repo://src/helper/proxy/index.ts#L176-L183)

The result is a normal mutable response. A handler can adjust it before returning, for example deleting `Set-Cookie`, and middleware such as `compress` can re-encode it for the client ([[ETag, Cache and Compression]]).

Sources: [src/helper/proxy/index.ts:133-136](repo://src/helper/proxy/index.ts#L133-L136), [src/helper/proxy/index.ts:185-189](repo://src/helper/proxy/index.ts#L185-L189)

> [!WARNING]
> Forwarding `...c.req.header()` sends every incoming header, including `Authorization` and `Cookie`, to the upstream. Remove credentials the upstream should not see by setting them to `undefined`, and build the upstream URL from trusted parts so a client cannot point the proxy at an arbitrary host.

Sources: [src/helper/proxy/index.ts:125-132](repo://src/helper/proxy/index.ts#L125-L132)
