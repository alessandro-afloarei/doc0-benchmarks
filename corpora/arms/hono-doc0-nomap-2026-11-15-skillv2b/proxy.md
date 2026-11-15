---
title: "Proxy Helper"
---
## Overview

`proxy(input, init)` from `hono/proxy` forwards a request to another origin and returns the upstream response, ready to be returned from a handler. It is a thin layer over `fetch` that fixes the details a naive `return fetch(url, c.req.raw)` gets wrong: it strips hop-by-hop headers in both directions, copies method, body and abort signal from the incoming request, and repairs headers when the runtime has already decompressed the body.

Sources: [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

`app.mount` is the in-process counterpart: it calls another framework's fetch handler directly, while `proxy` crosses the network ([[Hono App and Route Registration]]).

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

```ts
import { proxy } from 'hono/proxy'

app.all('/api/:path{.+}', (c) =>
  proxy(`https://backend.internal/${c.req.param('path')}`, {
    ...c.req,
    headers: {
      ...c.req.header(),
      'X-Forwarded-For': '127.0.0.1',
      Authorization: undefined, // do not forward
    },
  })
)
```

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48), [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113)

## Options

`init` is a `RequestInit` extended with three fields. It can also be a `Request`, which is treated as `{ raw: request }`.

Sources: [src/helper/proxy/index.ts:24-44](repo://src/helper/proxy/index.ts#L24-L44), [src/helper/proxy/index.ts:160-166](repo://src/helper/proxy/index.ts#L160-L166)

| Field | Effect |
| --- | --- |
| `raw` | The incoming request to copy method, body, headers and signal from. Spreading `...c.req` provides it, because `HonoRequest` exposes the original as `raw` |
| `headers` | Headers for the upstream request, applied over those copied from `raw`; a header set to `undefined` or `null` is removed |
| `customFetch(request)` | Replacement for the global `fetch`, for service bindings, mocks or retries |
| `strictConnectionProcessing` | Also remove every header named in the incoming `Connection` header (default `false`) |
| any other `RequestInit` field | Passed to the upstream `Request` |

Sources: [src/helper/proxy/index.ts:24-44](repo://src/helper/proxy/index.ts#L24-L44)

## Building the upstream request

`proxy` creates `new Request(input, { ...fromRaw, ...requestInit })`, so explicit options win over values copied from `raw`.

Sources: [src/helper/proxy/index.ts:168-171](repo://src/helper/proxy/index.ts#L168-L171)

`buildRequestInitFromRequest(raw)` copies the method, the body (with `duplex: 'half'` so it streams instead of being buffered), the headers and the abort signal. Passing the signal means that when the client disconnects, the upstream request is cancelled too. From the copied headers it removes the hop-by-hop set from RFC 2616: `Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding` and `Upgrade`. These describe the client-to-proxy connection and must not be forwarded.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:50-91](repo://src/helper/proxy/index.ts#L50-L91)

With `strictConnectionProcessing: true`, it also parses the `Connection` header and deletes each header it lists, as RFC 9110 requires of intermediaries. A listed name that is not a valid HTTP token makes it throw `HTTPException(400)` rather than guess. The option is off by default, so existing proxies keep forwarding those headers unless they opt in.

Sources: [src/helper/proxy/index.ts:21-22](repo://src/helper/proxy/index.ts#L21-L22), [src/helper/proxy/index.ts:60-78](repo://src/helper/proxy/index.ts#L60-L78)

`preprocessRequestInit` converts a plain-object `headers` option into a `Headers` instance, skipping `undefined` and `null` values. Because the object form replaces the copied headers, writing `{ ...c.req.header(), Authorization: undefined }` is the way to forward everything except one header.

Sources: [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113)

Finally `Accept-Encoding` is deleted from the upstream request. The runtime's `fetch` then negotiates compression itself and hands back a decoded body, which avoids forwarding an encoding the proxy's own client may not support.

Sources: [src/helper/proxy/index.ts:172-174](repo://src/helper/proxy/index.ts#L172-L174)

## Returning the response

The upstream response's headers are copied with the hop-by-hop set removed. If `Content-Encoding` is still present, it is removed together with `Content-Length`: `fetch` has already decompressed the body, so both would describe bytes the client never receives. A new `Response` with the upstream body stream, status and status text is returned.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)

The body is streamed, not buffered, so large downloads and server-sent events pass through as they arrive ([[Streaming and Server-Sent Events]]). Middleware after the proxy call can still change headers, because the returned response has a fresh, mutable `Headers` object.

Sources: [src/helper/proxy/index.ts:185-189](repo://src/helper/proxy/index.ts#L185-L189)

## Security notes

- Building the upstream URL from request input, as in the example, must be limited to the intended host; `proxy` forwards to whatever URL it is given.
- Credentials such as `Authorization` and `Cookie` are forwarded unless removed with `undefined`.
- When the backend needs the client address, add `X-Forwarded-For` from [[Connection Info and IP Restriction]] rather than trusting an incoming one.

Sources: [src/helper/proxy/index.ts:160-171](repo://src/helper/proxy/index.ts#L160-L171)
