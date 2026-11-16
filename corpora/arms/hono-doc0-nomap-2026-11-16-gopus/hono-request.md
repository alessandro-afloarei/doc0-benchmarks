---
title: "HonoRequest"
---
## Overview

`c.req` is a `HonoRequest`: a thin wrapper around the standard `Request` that adds route parameters, fast query parsing, body caching and the data validators store. The Context creates it the first time a handler reads `c.req`, passing the raw request, the path the router matched and the router's match result, as [[Context and Responses]] shows. The original request stays available as `c.req.raw`.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Request properties

| Member | Value |
| --- | --- |
| `raw` | The original `Request`. |
| `url` | `raw.url`. |
| `method` | `raw.method`. |
| `path` | The path the router matched, as computed by the app's `getPath`. |
| `routeIndex` | The index of the handler now running among the matched handlers. |
| `routePath` | The registered path of the route whose handler is running, for example `/posts/:id`. |
| `matchedRoutes` | Every matched route record. Deprecated in favour of `matchedRoutes` from `hono/route`. |

Sources: [src/request.ts:51-69](repo://src/request.ts#L51-L69), [src/request.ts:369-442](repo://src/request.ts#L369-L442)

`routeIndex` is what makes `param()` and `routePath` answer for the current handler: `compose` sets it before calling each handler, as [[Request Lifecycle and Error Handling]] describes. The full match result is exposed under the `GET_MATCH_RESULT` symbol for the helpers on [[Route Introspection]].

Sources: [src/compose.ts:42-44](repo://src/compose.ts#L42-L44), [src/request.ts:389-391](repo://src/request.ts#L389-L391), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1)

## Route parameters

`c.req.param('id')` returns one parameter and `c.req.param()` returns all of them as an object. Each match entry carries a map from parameter name to either the value itself or an index. Routers that return a second element in the result, a parameter stash, store indexes, and `#getParamValue` looks the value up in the stash; others store the value directly. [[Routers]] describes the two result shapes.

Sources: [src/request.ts:94-128](repo://src/request.ts#L94-L128)

Values are decoded with `decodeURIComponent` only when they contain `%`, through `tryDecode`, so a malformed escape leaves the value as it was instead of throwing. With `param()`, keys whose value is `undefined`, such as an absent optional parameter, are left out.

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/request.ts:34-34](repo://src/request.ts#L34-L34)

The overloads type the result from the route path: for `/posts/:id`, `param('id')` is a `string`, an optional `:id?` gives `string | undefined`, and `param()` returns an object with one key per parameter.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query string and headers

`query(key)` returns the first value of a query parameter and `query()` all parameters with their first values; `queries(key)` and `queries()` return every value as arrays. Both read `url` directly rather than building a `URL`. For a key without `%` or `+`, `_getQueryParam` searches the URL string for `?key=` or `&key=` and decodes only the value it finds; otherwise it walks every pair. A key without `=` yields an empty string, and `+` is decoded as a space.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:208-293](repo://src/utils/url.ts#L208-L293)

`header(name)` returns one header or `undefined`; `header()` returns every header as a plain object keyed by the lower-case names the `Headers` iterator gives.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198)

## Reading the body

### Cached readers

`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` read the body through `#cachedBody`, which keeps the promise for each format in `bodyCache`. A request body can be read only once, so the cache lets a validator and a handler both read it:

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

1. If the requested format is cached, the cached promise is returned.
2. If another format is cached, its value is wrapped in a new `Response` and converted, with JSON stringified first.
3. Otherwise the raw request is read and the promise is cached.

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

`json()` is built on the cached `text`, then `JSON.parse`; `bytes()` on the cached `arrayBuffer`.

Sources: [src/request.ts:253-303](repo://src/request.ts#L253-L303)

### parseBody

`parseBody(options)` parses form bodies. Only `multipart/form-data` and `application/x-www-form-urlencoded` are parsed; any other content type gives `{}`. The body is read as an `ArrayBuffer`, converted to `FormData`, and that promise is cached as `formData` so a later `c.req.formData()` does not read the body again.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Fields that appear several times become arrays. Without it the last value wins. Keys ending in `[]` are always arrays. |
| `dot` | `false` | Keys with dots become nested objects: `obj.key1` → `{ obj: { key1 } }`. |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

The dot expansion skips any key that has a `__proto__.` segment, so a form field cannot write into an object prototype, and it replaces a non-object value on the way with a fresh null-prototype object.

Sources: [src/utils/body.ts:215-242](repo://src/utils/body.ts#L215-L242)

### Cloning a consumed request

`cloneRawRequest(c.req)` returns a copy of the raw request for forwarding. When the body is unread it uses `raw.clone()`. When it was read through a `HonoRequest` method it rebuilds the request from the first cached format and the raw request's other properties. When it was read straight from `raw`, nothing is cached and the function throws an `HTTPException` with status 500.

Sources: [src/request.ts:444-505](repo://src/request.ts#L444-L505)

## Validated data

`addValidatedData(target, data)` stores data under a validation target such as `json` or `query`, and `valid(target)` returns it. The validator middleware calls the first; handlers call the second, and its return type comes from the route's input types. [[Validation]] covers both sides.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)
