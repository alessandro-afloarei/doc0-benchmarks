---
title: "Request Helpers"
---
## Overview

Three helpers read or forward a request, and none of them changes the response by itself. `accepts` picks one of a list of supported values from a request header such as `Accept` or `Accept-Language`. `route` reads the routes that matched the request and the position of the one that is running. `proxy` sends a request to another URL and returns that server's response, with the hop-by-hop headers removed. This page covers each one. The matching data that `route` reads is described on [[HonoRequest]].

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/proxy/index.ts:160-171](repo://src/helper/proxy/index.ts#L160-L171)

## accepts

`accepts(c, { header, supports, default, match })` reads the named header. When the header is absent it returns the default. Otherwise it parses the header into a list of entries, each with a type, parameters and a quality value `q`. The list is passed to `match`, which by default returns the highest-quality entry that is in `supports`, and the default value when no entry is supported.

Sources: [src/helper/accepts/accepts.ts:5-25](repo://src/helper/accepts/accepts.ts#L5-L25), [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

The entries come from `parseAccept`, which scans the header by hand, skipping whitespace and parameters that do not parse.

Sources: [src/utils/accept.ts:1-33](repo://src/utils/accept.ts#L1-L33), [src/utils/accept.ts:211-211](repo://src/utils/accept.ts#L211-L211)

The default matcher sorts the entries by `q`, highest first, and takes the first one that `supports` lists. Ties keep the order in which the header lists them, because the sort is applied to the array the parser returned. The matcher sorts the array in place.

Sources: [src/helper/accepts/accepts.ts:21-25](repo://src/helper/accepts/accepts.ts#L21-L25)

## route

`matchedRoutes(c)` returns the route record of every entry that matched the request, middleware included. `routePath(c, index)` and `baseRoutePath(c, index)` return the path or base path of one of them, and the index defaults to the running route, `c.req.routeIndex`. Both return an empty string when there is no such route.

Sources: [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59), [src/helper/route/index.ts:82-83](repo://src/helper/route/index.ts#L82-L83)

`basePath(c, index)` returns the part of the request path that matches the base path of a route, so that a base path with parameters gives the concrete prefix. It uses `getPattern` on each segment of the base path, and measures how much of the request path each segment consumes. The result is cached per context and per index in a `WeakMap`.

Sources: [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)

## proxy

`proxy(input, init)` builds a new `Request` for `input`, and sends it with `fetch` or with `customFetch` when one is given. A `Request` passed as `raw` supplies the method, body, headers and signal. Its hop-by-hop headers are removed, such as `connection`, `keep-alive`, `te` and `transfer-encoding`, and so is `accept-encoding`. A `headers` object in `init` replaces the copied headers, and any key whose value is `null` or `undefined` is left out.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:50-91](repo://src/helper/proxy/index.ts#L50-L91), [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113), [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172)

With `strictConnectionProcessing`, the names listed in the `Connection` header are also removed from the request. A name that is not a valid header token makes the helper throw a 400 `HTTPException`, before anything is sent.

Sources: [src/helper/proxy/index.ts:58-77](repo://src/helper/proxy/index.ts#L58-L77), [src/helper/proxy/index.ts:21-22](repo://src/helper/proxy/index.ts#L21-L22)

The response is copied into a new `Response` with the same status and body. Hop-by-hop headers are removed from it too. When the upstream response has a `Content-Encoding`, both that header and `Content-Length` are removed, because the length describes the compressed body and the runtime may decode it.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)
