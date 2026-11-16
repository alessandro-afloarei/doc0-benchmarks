---
title: "Request Object"
---
## Overview

`c.req` is a `HonoRequest`, a wrapper around the runtime's `Request`. It adds the things the router knows, such as the path parameters of the matched route, and it caches the body so that several readers can use it. Validators also store their results on it. The `Context` creates it on first use, as [[Context]] describes, and the validation step is in [[Validation]].

Sources: [src/request.ts:36-98](repo://src/request.ts#L36-L98), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Constructor and fields

The constructor keeps the raw `Request` as `raw`, the path, and the match result from the router. It starts with an empty validated-data record and a `routeIndex` of `0`. The `routeIndex` is advanced by `compose` as the chain moves, so the same request object knows which handler is running.

Sources: [src/request.ts:71-98](repo://src/request.ts#L71-L98), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

## Path parameters

`c.req.param(name)` reads the parameter for the current handler, not for the whole route. It looks up the handler's parameter map at `routeIndex` in the match result, then reads the value from the parameter stash when the router produced one. Values that contain `%` are decoded with `tryDecodeURIComponent`. When the whole value cannot be decoded, each escape is decoded on its own and the malformed ones are kept as written, so a bad escape does not throw.

Sources: [src/request.ts:100-146](repo://src/request.ts#L100-L146), [src/utils/url.ts:81-93](repo://src/utils/url.ts#L81-L93)

Calling `param()` with no name decodes every parameter of the handler in one pass. The router's match result maps each parameter name to its position, so a route such as `/posts/:id` gives `{ id }` as one object.

Sources: [src/request.ts:112-124](repo://src/request.ts#L112-L124), [src/router.ts:57-64](repo://src/router.ts#L57-L64)

## Query and headers

`query(key)` and `queries(key)` read the URL's search parameters through `getQueryParam`. `queries` returns every value of a repeated key as an array, and calling either with no key returns all of them.

Sources: [src/request.ts:148-183](repo://src/request.ts#L148-L183)

`header(name)` reads one header from the raw request, and with no name it copies every header into a plain object. Header names are case-insensitive in the `Headers` object that the runtime provides.

Sources: [src/request.ts:185-200](repo://src/request.ts#L185-L200)

## Body readers and the cache

`text()`, `json()`, `arrayBuffer()`, `blob()`, `formData()` and `bytes()` all go through `#cachedBody`. The first reader reads the raw body and stores its promise in `bodyCache` under its name. A later reader that asks for another format converts the cached body instead of reading the stream again: `json()` reads the cached text and parses it.

Sources: [src/request.ts:202-266](repo://src/request.ts#L202-L266), [src/request.ts:269-283](repo://src/request.ts#L269-L283)

`parseBody()` delegates to the shared `parseBody` in `src/utils/body.ts`. That function reads the `Content-Type` media type and parses form data only for `multipart/form-data` and `application/x-www-form-urlencoded`; any other type gives an empty object.

Sources: [src/request.ts:212-217](repo://src/request.ts#L212-L217), [src/utils/body.ts:97-113](repo://src/utils/body.ts#L97-L113)

## Validated data

`addValidatedData(target, data)` stores the result of a validator under its target name, such as `json` or `query`. `valid(target)` reads it back and is what handlers use after `validator()`, so the typed data reaches the handler without parsing the body again.

Sources: [src/request.ts:339-367](repo://src/request.ts#L339-L367)

## Routing information

`matchedRoutes` maps the match result to the list of `RouterRoute` records for the request. `routePath` returns the path of the route at `routeIndex`, so a middleware can report the pattern it is running under, not the request path.

Sources: [src/request.ts:420-443](repo://src/request.ts#L420-L443)

## Cloning the request

`cloneRawRequest` returns a copy of the raw request. When the body has not been read it calls `clone()`. When the body was already read through `HonoRequest`, it rebuilds the request from the cached body. If the body was read directly from `raw` and never cached, it throws an `HTTPException` with status `500` that asks the caller to use the `HonoRequest` readers.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)
