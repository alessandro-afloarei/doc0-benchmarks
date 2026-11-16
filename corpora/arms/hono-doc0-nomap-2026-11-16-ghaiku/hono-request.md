---
title: "HonoRequest"
---
## Overview

`c.req` is a `HonoRequest`, a wrapper around the standard `Request` that adds what the router knows: the route parameters of the matched route, the list of matched routes, and the values that validators produced. It also caches the request body so that several readers can use it. The constructor takes the raw request, the path and the match result, which [[Context]] passes in. This page covers the readers and the caching. The validators that fill `valid()` are on [[Validation]].

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:363-369](repo://src/context.ts#L363-L369)

## Route parameters

`c.req.param(key)` reads one route parameter, and `c.req.param()` returns all of them as an object. Both read the match result at `routeIndex`, which the composer sets to the entry that is running, so a middleware sees the parameters of the route it is attached to. The value is decoded only when it contains a `%`, and a sequence that cannot be decoded is left as it is.

Sources: [src/request.ts:94-104](repo://src/request.ts#L94-L104), [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/request.ts:34-34](repo://src/request.ts#L34-L34)

The stored parameter may be an index into the match stash rather than a value. `#getParamValue` looks the index up in the stash when the match result has one, and otherwise returns the value as it is. The two forms are the two shapes of the `Result` type that [[Router Interface and SmartRouter]] defines.

Sources: [src/request.ts:126-128](repo://src/request.ts#L126-L128), [src/router.ts:98-98](repo://src/router.ts#L98-L98)

## Query strings and headers

`c.req.query(key)` and `c.req.queries(key)` parse the query string of `url`. With a key they return one value or the array of all values, and with no key they return the whole object. The parsing is done by `getQueryParam` and `getQueryParams` in the URL utilities.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:302-318](repo://src/utils/url.ts#L302-L318)

`c.req.header(name)` reads one header from the raw request's `Headers`, and returns `undefined` when it is missing. With no name it copies every header into a plain object, with the names in the lower-case form that `Headers` uses.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198)

## Reading the body

The body readers `json`, `text`, `arrayBuffer`, `bytes`, `blob` and `formData` do not read the stream directly. Each one calls `#cachedBody` with a key: `json` and `text` use the `text` key and parse the result, and `bytes` uses `arrayBuffer` and wraps it in a `Uint8Array`.

Sources: [src/request.ts:253-255](repo://src/request.ts#L253-L255), [src/request.ts:269-271](repo://src/request.ts#L269-L271), [src/request.ts:285-303](repo://src/request.ts#L285-L303), [src/request.ts:315-331](repo://src/request.ts#L315-L331)

`#cachedBody` stores the first read in `bodyCache` and returns the same promise on later calls. If a different reader has already run, the stored body is converted: for a cached `json` value it is stringified, and then a new `Response` built from it is read with the requested method. This lets a validator and a handler each read the body without consuming the stream twice.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`parseBody` is a separate helper that parses a `multipart/form-data` or urlencoded body into typed fields. It is implemented by `parseBody` in `utils/body`, and takes the `HonoRequest` or the raw `Request`.

Sources: [src/request.ts:200-218](repo://src/request.ts#L200-L218), [src/utils/body.ts:97-105](repo://src/utils/body.ts#L97-L105)

## Validated data

`addValidatedData(target, data)` stores the value a validator produced for one target, such as `json` or `query`. `valid(target)` returns that value, and it returns `undefined` for a target that no validator has run for. The validator writes with this method only after its function has returned a value that is not a `Response`.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354), [src/validator/validator.ts:162-168](repo://src/validator/validator.ts#L162-L168)

## Matched routes and the path

`matchedRoutes` returns the route record of each entry in the match result, so a handler can list every route that matched the request, including middleware. `routePath` returns the path of the route that is running at `routeIndex`. It is deprecated in favour of the `routePath` helper in `hono/route`.

Sources: [src/request.ts:420-442](repo://src/request.ts#L420-L442)

`url` and `method` return the raw request's values, and `path` is the path that dispatch computed with `getPath`, which can differ from the URL path when a custom `getPath` is set.

Sources: [src/request.ts:369-387](repo://src/request.ts#L369-L387), [src/request.ts:64-68](repo://src/request.ts#L64-L68)
