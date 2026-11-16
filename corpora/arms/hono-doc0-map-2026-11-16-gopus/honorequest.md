---
title: "HonoRequest"
---
## Overview

`HonoRequest` is the `c.req` object. It wraps the raw `Request` together with the path the app matched and the router's match result, and reads from them on demand: path parameters, query strings, headers and the body. It parses nothing up front, so a handler that never reads the query never pays for parsing it.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80)

The Context creates it lazily on the first access to `c.req`, passing the raw request, the path from `getPath` and the match result ([[Context and Responses]]). Validated input read with `c.req.valid()` is filled in by the [[Validator]].

Sources: [src/context.ts:366-369](repo://src/context.ts#L366-L369), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Raw request, path, URL and method

| Member | Value |
| --- | --- |
| `raw` | The original `Request`, for runtime extensions such as Cloudflare's `cf` property |
| `path` | The pathname the router matched, as returned by `getPath` |
| `url` | `raw.url` |
| `method` | `raw.method` |

Sources: [src/request.ts:36-68](repo://src/request.ts#L36-L68), [src/request.ts:369-387](repo://src/request.ts#L369-L387)

## Path parameters

`param(key)` returns one parameter and `param()` returns all of them as an object. Both read the match result entry for the handler that is running, selected by `routeIndex`, which `compose` updates before each handler. A middleware registered on `/posts/*` and a handler on `/posts/:id` can therefore see different parameters for the same request.

Sources: [src/request.ts:94-128](repo://src/request.ts#L94-L128), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

Routers return parameters in one of two shapes ([[Router Interface and Presets]]). `#getParamValue` handles both: when the match result has a second element, the parameter stash, the handler's map holds indexes into it; otherwise the map already holds the values.

Sources: [src/request.ts:126-128](repo://src/request.ts#L126-L128), [src/router.ts:66-98](repo://src/router.ts#L66-L98)

Values are decoded only when they contain `%`, with `decodeURIComponent` wrapped in `tryDecode`. When decoding the whole value fails, `tryDecode` decodes each run of percent sequences separately and leaves the runs it cannot decode as they are, so a malformed parameter never throws.

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/utils/url.ts:80-93](repo://src/utils/url.ts#L80-L93)

The overloads of `param` are typed from the route path `P`. A key from the path returns `string`; an optional key such as `:type?` returns `string | undefined`; `param()` returns an object of every key. The type helpers are on [[Route Types and Schema]].

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query strings

`query(key)` returns the first value of a query parameter and `query()` returns an object of first values. `queries(key)` returns every value as an array, and `queries()` an object of arrays. Both read `this.url` on each call through `getQueryParam` and `getQueryParams`.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:302-315](repo://src/utils/url.ts#L302-L315)

The parser in `_getQueryParam` has a fast path for the common call `query('name')` with a key that holds no `%` or `+`. It searches the URL for `?name` or `&name` directly and slices out the value without building an object. It falls back to the full scan when the key is not found and the URL contains encoded characters, because the key might appear encoded.

Sources: [src/utils/url.ts:219-253](repo://src/utils/url.ts#L219-L253)

The full scan walks each `&`-separated pair, decodes names and values only when the URL contains `%` or `+` (turning `+` into a space), skips empty names, and gives a name without `=` the value `''`. For a single value per name, the first occurrence wins.

Sources: [src/utils/url.ts:208-300](repo://src/utils/url.ts#L208-L300)

## Headers

`header(name)` returns one header from `raw.headers`, or `undefined` when it is missing. `header()` returns every header as a plain object with lower-case names, as the `Headers` iterator gives them. The name argument is typed with the `RequestHeader` list for completion, and accepts any string.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198)

## Body methods and the body cache

`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` read the body through `#cachedBody`, which stores each body promise in `bodyCache`. A body stream can be read only once, so the cache lets several middleware and the handler read the same body:

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

1. If the requested kind is cached, the cached promise is returned.
2. If another kind is cached, its value is turned into a new `Response` and read as the requested kind. A cached JSON object is stringified first.
3. Otherwise the raw request is read and the promise cached.

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

`json()` is built on the cached text and calls `JSON.parse`, so reading `text()` after `json()` costs no second read. `bytes()` is built on the cached `arrayBuffer`.

Sources: [src/request.ts:253-303](repo://src/request.ts#L253-L303)

`cloneRawRequest(req)`, exported from `hono/request`, returns a copy of the raw `Request`. When the body is still unread it uses `raw.clone()`. When it was read through the methods above, it rebuilds the request from the first cached body and the raw request's properties. When the body was consumed directly on `raw`, it throws an `HTTPException` 500, because nothing is left to rebuild from.

Sources: [src/request.ts:444-505](repo://src/request.ts#L444-L505)

## parseBody for forms

`parseBody(options?)` parses `multipart/form-data` and `application/x-www-form-urlencoded` bodies into a plain object. For any other content type, including JSON, it returns `{}`. It reads the body through `arrayBuffer()`, so the read is cached, and stores the resulting `FormData` promise as the cached `formData` so that a later `c.req.formData()` reuses it.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

The object is built from the `FormData` entries with two options:

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Keep every value of a repeated field as an array; without it the last value wins. A key ending in `[]` is always an array |
| `dot` | `false` | Split keys on `.` into nested objects, so `user.name` becomes `{ user: { name } }` |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

The result is created with `Object.create(null)`, and nested parsing skips any key with a `__proto__.` segment, so form fields cannot reach the object prototype.

Sources: [src/utils/body.ts:151-155](repo://src/utils/body.ts#L151-L155), [src/utils/body.ts:215-242](repo://src/utils/body.ts#L215-L242)

```ts
app.post('/upload', async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = body['files[]'] // (string | File)[]
  return c.text(`received ${[files].flat().length} files`)
})
```

Sources: [src/utils/body.ts:188-206](repo://src/utils/body.ts#L188-L206)

## Validated data

`addValidatedData(target, data)` stores the output of a validator for a target such as `json` or `query`, and `valid(target)` returns it. The return type of `valid` comes from the `I` type parameter of `HonoRequest`, which the validator middleware adds to the handler's input type. The [[Validator]] page traces that flow.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Matched routes

`matchedRoutes` lists the `RouterRoute` records of every handler in the match result, and `routePath` returns the registered path of the running handler. Both are marked deprecated in favour of the helpers in `hono/route`, which read the same data through the `GET_MATCH_RESULT` symbol getter; [[Route Introspection]] covers them.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1)
