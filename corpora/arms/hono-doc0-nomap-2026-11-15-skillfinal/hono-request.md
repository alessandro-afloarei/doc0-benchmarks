---
title: "HonoRequest"
---
## Overview

`HonoRequest` is the object behind `c.req`. It wraps the raw `Request` (kept as `c.req.raw`) and adds what a handler usually needs: path parameters from the router, parsed query strings and headers, body readers that can be called more than once, and the data stored by validators. The [[Context]] creates it lazily on first access, passing the routing path and the router's match result.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

This page also covers two helpers that work on the incoming request: `accepts` for content negotiation and `proxy` for forwarding a request to another server. Validation itself is in [[Validation]].

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

## Path parameters

### Reading the match result

A router returns one of two result shapes ([[Routers and Router Selection]]): each matched handler paired with a parameter object, or each paired with a map from parameter name to an index into a shared array of captured strings, which [[RegExpRouter]] produces. `#getParamValue` handles both: when the result has the shared array it looks the index up, otherwise the stored value is the parameter itself.

Sources: [src/request.ts:106-128](repo://src/request.ts#L106-L128), [src/router.ts:66-98](repo://src/router.ts#L66-L98)

The parameters read are always those of the handler currently running, `matchResult[0][routeIndex]`. `compose` updates `routeIndex` before calling each handler, so a middleware on `/user/*` and a handler on `/user/:id` each see their own route's parameters ([[Request Lifecycle and Middleware Composition]]).

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

### Decoding

`c.req.param('id')` returns one value and `c.req.param()` an object of all of them. A value is percent-decoded only if it contains `%`, with `tryDecode`: if `decodeURIComponent` fails on the whole string, it decodes each run of valid escapes separately and leaves malformed ones as written. The overloads type a parameter as `string` when the route path declares it and `string | undefined` when it is optional (`:id?`).

Sources: [src/request.ts:82-124](repo://src/request.ts#L82-L124), [src/utils/url.ts:80-93](repo://src/utils/url.ts#L80-L93)

## Query strings and headers

`c.req.query(key)` returns the first value of a query parameter and `c.req.query()` an object of first values; `c.req.queries(key)` and `c.req.queries()` return every value as arrays. Both scan `c.req.url` directly instead of building `URLSearchParams`. For a single key without `%` or `+`, a fast path searches for `?key` or `&key` and returns as soon as it finds `=`; a key followed by `&` or the end of the URL yields an empty string. Otherwise the full scan decodes names and values (`+` becomes a space, then percent-decoding with the same tolerant decoder) only when the URL contains `%` or `+`.

Sources: [src/request.ts:130-171](repo://src/request.ts#L130-L171), [src/utils/url.ts:208-315](repo://src/utils/url.ts#L208-L315)

`c.req.header(name)` reads one header from the raw request (`undefined` when missing); `c.req.header()` returns every header as a plain object with lower-case names. `c.req.url`, `c.req.method` and `c.req.path` (the routing path computed by the app's `getPath`) round out the request data.

Sources: [src/request.ts:173-198](repo://src/request.ts#L173-L198), [src/request.ts:356-387](repo://src/request.ts#L356-L387)

## Reading the body

### The body cache

A `Request` body can be read only once, but validators, middleware and the handler often each want it. `HonoRequest` keeps the promise from the first read in `bodyCache`, keyed by format. A later read in the same format returns the cached promise. A read in a different format takes whichever format is cached, wraps it in a new `Response` (stringifying cached JSON first) and converts it, so `c.req.text()` after `c.req.formData()` still works.

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

| Method | Cached as | Result |
| --- | --- | --- |
| `json()` | `text` | `JSON.parse` of the text |
| `text()` | `text` | string |
| `arrayBuffer()` | `arrayBuffer` | `ArrayBuffer` |
| `bytes()` | `arrayBuffer` | `Uint8Array` over the buffer |
| `blob()` | `blob` | `Blob` |
| `formData()` | `formData` | `FormData` |

Sources: [src/request.ts:241-331](repo://src/request.ts#L241-L331)

Reading `c.req.raw.body` directly bypasses the cache, and the other readers then fail because the stream is consumed.

Sources: [src/request.ts:236-239](repo://src/request.ts#L236-L239)

### parseBody

`c.req.parseBody(options)` handles HTML form submissions. For `multipart/form-data` or `application/x-www-form-urlencoded` (compared case-insensitively, parameters ignored) it reads the body as an `ArrayBuffer`, parses it with `bufferToFormData`, stores the parsed `FormData` in the cache so a later `formData()` reuses it, and converts it to a plain object. Any other content type yields `{}`.

Sources: [src/request.ts:200-218](repo://src/request.ts#L200-L218), [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141), [src/utils/buffer.ts:106-117](repo://src/utils/buffer.ts#L106-L117)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Repeated fields become arrays. Without it the last value wins, except keys ending in `[]`, which are always arrays. |
| `dot` | `false` | Keys such as `obj.key1` become nested objects. Keys containing a `__proto__.` segment are dropped. |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

## Validated data

Validator middleware store their output with `c.req.addValidatedData(target, data)`, and handlers read it with `c.req.valid(target)`, typed from the validator's output through the `I` type parameter ([[Validation]]).

Sources: [src/request.ts:333-354](repo://src/request.ts#L333-L354)

## Route information

`c.req.matchedRoutes` and `c.req.routePath` are deprecated in favour of the `hono/route` helpers, which read the same match result through the `GET_MATCH_RESULT` symbol getter ([[Route Introspection]]).

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442)

## Content negotiation

`accepts(c, { header, supports, default })` reads an `Accept`-style header, parses it with `parseAccept`, sorts the entries by `q` and returns the first type in `supports`, or `default` when the header is absent or nothing matches. A custom `match` function can replace that choice.

Sources: [src/helper/accepts/accepts.ts:1-49](repo://src/helper/accepts/accepts.ts#L1-L49)

## Forwarding the request

### cloneRawRequest

`cloneRawRequest(c.req)` returns a copy of the raw request for sending elsewhere. If the body is unread it uses `Request.clone()`. If it was read through the cache, it rebuilds a `Request` from the cached body and the original's headers, method, mode, credentials, signal and other init fields. If the body was consumed directly from `c.req.raw`, nothing is cached, and it throws an `HTTPException(500)` explaining that the body must be read through the `HonoRequest` methods.

Sources: [src/request.ts:445-505](repo://src/request.ts#L445-L505)

### proxy()

`proxy(input, init)` from `hono/proxy` fetches another URL and returns a response that can be sent to the client unchanged. Given `raw: c.req.raw` (or a `Request` as the second argument), it copies the method, body, headers and abort signal, strips hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade` and others), and lets `init.headers` override them, deleting any header whose value is `null` or `undefined`. It removes `Accept-Encoding` before fetching.

Sources: [src/helper/proxy/index.ts:9-113](repo://src/helper/proxy/index.ts#L9-L113), [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172)

On the way back it strips hop-by-hop headers from the upstream response and, when the response is encoded, drops `Content-Encoding` and also `Content-Length`, which the code comment notes is the size of the compressed content rather than the body being returned. With `strictConnectionProcessing: true`, header names listed in the request's `Connection` header are removed too, and an invalid name raises `HTTPException(400)`. `customFetch` replaces the global `fetch`.

Sources: [src/helper/proxy/index.ts:24-91](repo://src/helper/proxy/index.ts#L24-L91), [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)
