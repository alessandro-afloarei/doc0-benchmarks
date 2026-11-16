---
title: "Proxy Helper"
---
## Overview

`proxy(input, init)` from `hono/proxy` forwards a request to another server and returns a `Response` a handler can return as is. It has the same parameters as `fetch`, plus a few proxy-specific options, and it cleans up what a plain `fetch` would get wrong for a proxy: hop-by-hop headers in both directions, the client's `Accept-Encoding`, and the encoding headers of a response the runtime already decompressed. Forwarding to a framework running in the same process is done with `app.mount` instead, described in [[Application and Routing API]].

Sources: [src/helper/proxy/index.ts:115-190](repo://src/helper/proxy/index.ts#L115-L190)

```ts
import { proxy } from 'hono/proxy'

app.get('/proxy/:path', (c) => {
  return proxy(`http://${originServer}/${c.req.param('path')}`, {
    headers: {
      ...c.req.header(),
      'X-Forwarded-For': '127.0.0.1',
      'X-Forwarded-Host': c.req.header('host'),
      Authorization: undefined,
    },
  })
})
```

Sources: [src/helper/proxy/index.ts:115-159](repo://src/helper/proxy/index.ts#L115-L159)

## Options

`init` accepts every `RequestInit` field, with headers also allowed as a plain record, plus three options:

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48)

| Option | Effect |
| --- | --- |
| `raw` | A `Request` whose method, body, headers and abort signal are copied into the outgoing request |
| `customFetch(request)` | Used instead of the global `fetch` |
| `strictConnectionProcessing` | Also remove the headers named in the incoming `Connection` header (default `false`) |

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48)

Passing a `Request` directly as `init` is the same as `{ raw: request }`. Spreading the Hono request, `{ ...c.req }`, also works, because `HonoRequest` keeps the original request in its own `raw` property; this forwards the client's method, body and headers.

Sources: [src/helper/proxy/index.ts:160-166](repo://src/helper/proxy/index.ts#L160-L166), [src/request.ts:36-51](repo://src/request.ts#L36-L51)

## Building the outgoing request

### From raw

`buildRequestInitFromRequest(raw)` copies the method, the body stream (with `duplex: 'half'` when there is one), the headers and the `signal`, so cancelling the client request aborts the upstream one. It deletes the hop-by-hop headers listed in RFC 2616: `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding` and `upgrade`.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:50-91](repo://src/helper/proxy/index.ts#L50-L91)

### Connection header processing

RFC 9110 says a proxy must also remove the headers that the `Connection` header names. Hono does that only with `strictConnectionProcessing: true`. The option's doc comment gives the reason: by default the `Connection` header is ignored to prevent hop-by-hop header injection from untrusted clients, and the strict mode is meant for trusted environments only. In strict mode every listed name must be a valid token; an invalid one throws `HTTPException(400)`.

Sources: [src/helper/proxy/index.ts:21-43](repo://src/helper/proxy/index.ts#L21-L43), [src/helper/proxy/index.ts:58-78](repo://src/helper/proxy/index.ts#L58-L78)

### Explicit headers

Headers given in `init.headers` are applied over those copied from `raw`. A plain record is turned into `Headers` by `preprocessRequestInit`, which skips keys whose value is `null` or `undefined`. Combined with spreading `c.req.header()`, writing `Authorization: undefined` keeps a client header out of the forwarded request.

Sources: [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113), [src/helper/proxy/index.ts:168-171](repo://src/helper/proxy/index.ts#L168-L171)

Last, `accept-encoding` is deleted from the outgoing request, so the runtime's `fetch` negotiates an encoding it can decode itself.

Sources: [src/helper/proxy/index.ts:172-172](repo://src/helper/proxy/index.ts#L172-L172)

## Returning the response

The upstream response is fetched with `customFetch` or `fetch`. Its headers are copied, the same hop-by-hop headers are removed, and when `content-encoding` is present both it and `content-length` are removed: as the source comment notes, the length would describe the compressed body while the body the runtime hands back has already been decoded. A new `Response` with the upstream body stream, status and status text is returned.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)

The result is a normal response, so it can be post-processed before returning it, for example by deleting `Set-Cookie` from `res.headers`, and middleware such as `compress` from [[Response and Observability Middleware]] can re-encode it for the client.

Sources: [src/helper/proxy/index.ts:126-137](repo://src/helper/proxy/index.ts#L126-L137), [src/middleware/compress/index.ts:86-122](repo://src/middleware/compress/index.ts#L86-L122)
