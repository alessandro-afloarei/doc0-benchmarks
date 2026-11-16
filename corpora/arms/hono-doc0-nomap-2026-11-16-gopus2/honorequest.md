---
title: "HonoRequest"
---
## Overview

`HonoRequest` is the request object handlers read as `c.req`. It wraps the standard `Request` (kept as `c.req.raw`) and adds what the router learned about it: the routing path, the matched routes and their parameters. On top it offers query parsing, header access, body readers that can be called more than once, and the store of validated data. The [[Context]] builds it lazily on first access to `c.req`, passing the path and the match result from dispatch.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:363-369](repo://src/context.ts#L363-L369)

`c.req.url` and `c.req.method` read through to the raw request, and `c.req.path` is the routing path that `getPath` produced, already decoded and without the query string.

Sources: [src/request.ts:356-387](repo://src/request.ts#L356-L387), [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)

## Path parameters

### Reading from the match result

The router's match result holds, for each matched handler, either a map of parameter names to values or a map of names to indexes into a shared array of values; [[Router Interface and SmartRouter]] describes the two shapes. `param(key)` looks the key up in the entry at `routeIndex`, the position of the handler running now, which `compose` updates as the chain advances. `#getParamValue` then reads the value through the shared array when the result has one, or uses the stored value directly.

Sources: [src/request.ts:102-128](repo://src/request.ts#L102-L128), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

Because the lookup uses `routeIndex`, a middleware registered on `/users/*` and a handler on `/users/:id` see different parameter sets for the same request: each reads the entry of its own route.

Sources: [src/request.ts:106-115](repo://src/request.ts#L106-L115)

### Decoding and types

A value is decoded with `decodeURIComponent` only when it contains a `%`. `param()` without a key returns every parameter of the current route, decoded the same way, skipping undefined values. Decoding goes through `tryDecode`, which on a malformed sequence decodes each valid `%XX` run separately and leaves invalid ones as they were instead of throwing.

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/utils/url.ts:79-92](repo://src/utils/url.ts#L79-L92)

The overloads type the key from the route path `P`: a required parameter returns `string`, an optional one (`:type?`) returns `string | undefined`, and the no-argument form returns a record of all names.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query strings

`query(key)` returns the first value for a key and `query()` returns an object with the first value of each key; `queries(key)` and `queries()` return every value as arrays. Both parse `c.req.url` directly with `getQueryParam` and `getQueryParams` rather than building a `URL`.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:302-315](repo://src/utils/url.ts#L302-L315)

For a single key containing no `%` or `+`, the parser searches for `?key` or `&key` and slices out the value, returning an empty string for a key without `=`. It falls back to the full loop when the URL has encoded characters. The full loop walks every `&`-separated pair, decodes names and values (turning `+` into a space) only if the URL contains `%` or `+`, skips empty names, and keeps the first value of a repeated key unless all values were asked for.

Sources: [src/utils/url.ts:208-300](repo://src/utils/url.ts#L208-L300)

## Headers

`header(name)` returns one header from the raw request, or `undefined` when it is absent. `header()` returns every header as an object; names come lower-cased from the `Headers` iterator. The name parameter is typed against the `RequestHeader` list in `utils/headers` so common names autocomplete, while any string is still accepted.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198), [src/utils/headers.ts:8-30](repo://src/utils/headers.ts#L8-L30)

## Body readers

### The body cache

A standard request body can be read once. `HonoRequest` keeps a `bodyCache` so the body can be read several times and in several forms, which lets a validator parse the JSON and the handler call `c.req.json()` again. `#cachedBody(key)` returns the cached promise for that form if there is one. If another form was cached, it waits for it and converts it through `new Response(body)[key]()` (re-stringifying a cached JSON object first). Otherwise it reads the raw body and caches the promise.

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

```ts
#cachedBody = (key: keyof Body) => {
  const { bodyCache, raw } = this
  const cachedBody = bodyCache[key]

  if (cachedBody) {
    return cachedBody
  }

  const anyCachedKey = Object.keys(bodyCache)[0]
  if (anyCachedKey) {
    return (bodyCache[anyCachedKey as keyof Body] as Promise<BodyInit>).then((body) => {
      if (anyCachedKey === 'json') {
        body = JSON.stringify(body)
      }
      return new Response(body)[key]()
    })
  }

  return (bodyCache[key] = raw[key]())
}
```

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

### Reader methods

| Method | Reads | Notes |
| --- | --- | --- |
| `text()` | `text` | |
| `json()` | `text` | Parses the cached text with `JSON.parse` |
| `arrayBuffer()` | `arrayBuffer` | |
| `bytes()` | `arrayBuffer` | Wraps the buffer in a `Uint8Array` |
| `blob()` | `blob` | |
| `formData()` | `formData` | |
| `parseBody(options)` | form data | Returns a plain object; see below |

Sources: [src/request.ts:212-331](repo://src/request.ts#L212-L331)

### parseBody

`parseBody` only parses `multipart/form-data` and `application/x-www-form-urlencoded`; for any other content type it returns `{}`. It reads the body as an array buffer, turns it into `FormData`, and stores that promise in `bodyCache.formData` so a later `c.req.formData()` reuses it.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

The resulting object keeps one value per key. Two options change that. `all: true` collects repeated keys into arrays, and a key ending in `[]` is always collected. `dot: true` turns `user.name` into a nested `{ user: { name } }`; keys holding `__proto__.` are skipped, and objects are created with `Object.create(null)`, so a form cannot reach the prototype.

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

### Cloning the raw request

`cloneRawRequest(req)` returns a copy of the raw request for code that needs a fresh `Request`, such as forwarding it. If the raw body is unused it calls `raw.clone()`. If it was consumed through a `HonoRequest` reader, it rebuilds the request from the cached body and the original request's settings. If the body was consumed directly on `req.raw`, nothing is cached and it throws an `HTTPException` with status 500.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

## Validated data

`addValidatedData(target, data)` stores the output of a validator under its target (`json`, `form`, `query`, `param`, `header`, `cookie`), and `valid(target)` returns it. The return type of `valid` comes from the `Input` type parameter, which the validator middleware widens; [[Validator]] covers that flow.

Sources: [src/request.ts:333-354](repo://src/request.ts#L333-L354)

## Matched routes

`c.req.matchedRoutes` returns the `RouterRoute` records of every matched handler, and `c.req.routePath` the path of the current one. Both are deprecated in favour of `matchedRoutes` and `routePath` from `hono/route`, which [[Application and Routing API]] describes. Those helpers read the match result through the `GET_MATCH_RESULT` symbol getter, which keeps it out of the public property list.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1), [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34)
