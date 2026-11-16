---
title: "HonoRequest: Params, Query, Headers and Body"
---
## Overview

`c.req` is a `HonoRequest`: a thin wrapper around the standard `Request` (kept as `c.req.raw`) that adds typed access to path parameters, query strings and headers, cached body readers, and storage for validated input. [[Context and Responses]] creates it lazily on first access to `c.req`, passing the routing path and the router's match result.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

The wrapper never parses the URL with `new URL()`. Query values are scanned out of `request.url` by string search, and parameters are looked up in the match result that routing already produced, so a handler that reads one parameter pays for nothing else.

Sources: [src/utils/url.ts:219-300](repo://src/utils/url.ts#L219-L300)

## Path parameters

### Reading the match result

`c.req.param('id')` reads from `#matchResult[0][routeIndex][1]`, the parameter map of the handler currently running. Routers return one of two result shapes ([[Routers and Presets]]): with a parameter stash, the map holds an index into the stash array; without one, the map holds the value itself. `#getParamValue` handles both by checking whether a stash exists.

Sources: [src/request.ts:102-128](repo://src/request.ts#L102-L128)

`routeIndex` is set by `compose` before each handler runs, so middleware registered at `/users/:id/*` and the handler at `/users/:id/:action` each see their own parameters even though they share one `HonoRequest` ([[Request Dispatch and Middleware Composition]]).

Sources: [src/request.ts:55-55](repo://src/request.ts#L55-L55), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

### Decoding

Values containing `%` are decoded with `decodeURIComponent` through `tryDecode`, which keeps any invalid percent-sequence as written instead of throwing. `c.req.param()` without a key returns all parameters of the current route, decoded, skipping those that are `undefined` (an optional parameter that was absent).

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/utils/url.ts:81-93](repo://src/utils/url.ts#L81-L93)

### Types

The overloads of `param` derive keys from the route path type `P`: a required parameter returns `string`, an optional one (`:type?`) returns `string | undefined`, and the no-argument form returns an object of all keys. On a route registered with a plain `string` path, any key is accepted.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query strings

| Call | Returns |
| --- | --- |
| `c.req.query('q')` | The first value of `q`, `''` when present without `=`, `undefined` when absent |
| `c.req.query()` | Object of every key to its first value |
| `c.req.queries('tag')` | Array of every value of `tag` |
| `c.req.queries()` | Object of every key to its array of values |

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171)

`_getQueryParam` in `src/utils/url.ts` implements all four. For a single key that needs no decoding it searches the URL for `?key` or `&key` and slices out the value, returning without looking at the rest of the string. Otherwise it walks every `&`-separated pair, and only when the URL contains `%` or `+` does it decode names and values (turning `+` into a space). For duplicate keys the single-value form keeps the first value.

Sources: [src/utils/url.ts:208-315](repo://src/utils/url.ts#L208-L315)

## Headers, URL and method

`c.req.header(name)` returns `raw.headers.get(name)` or `undefined`; header names are case-insensitive as in the Fetch API. Without a name it returns a plain object of all headers with lower-case keys. `c.req.url`, `c.req.method` and `c.req.path` (the routing path from `getPath`) are direct reads.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198), [src/request.ts:369-387](repo://src/request.ts#L369-L387)

## Reading the body

### Cached readers

`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` all go through `#cachedBody`, because a `Request` body can be read only once and middleware such as a validator often reads it before the handler does.

Sources: [src/request.ts:220-331](repo://src/request.ts#L220-L331)

`#cachedBody(key)` follows three steps.

Sources: [src/request.ts:220-222](repo://src/request.ts#L220-L222)

1. If `bodyCache[key]` holds a promise, return it.
2. If another form was cached, derive this one from it by wrapping the cached value in a new `Response` and calling the requested reader (a cached JSON value is stringified first).
3. Otherwise read from `raw` and store the promise in `bodyCache`.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json()` is built on the cached text and parsed with `JSON.parse`, so `c.req.text()` after `c.req.json()` costs nothing; `bytes()` is a `Uint8Array` view of the cached `arrayBuffer`.

Sources: [src/request.ts:253-303](repo://src/request.ts#L253-L303)

### parseBody for forms

`c.req.parseBody(options)` parses `multipart/form-data` and `application/x-www-form-urlencoded` bodies into a plain object; any other content type yields `{}`. JSON bodies are read with `c.req.json()`, not `parseBody`.

Sources: [src/utils/body.ts:97-113](repo://src/utils/body.ts#L97-L113)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Keep every value of a repeated field as an array. Fields named with a `[]` suffix are always arrays |
| `dot` | `false` | Turn `a.b.c` field names into nested objects |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206)

The parsed `FormData` promise is stored in `bodyCache.formData`, so a later `c.req.formData()` reuses it. The result object is created with `Object.create(null)`, and with `dot` a key containing a `__proto__.` segment is ignored, which keeps a crafted field name from reaching `Object.prototype`.

Sources: [src/utils/body.ts:123-141](repo://src/utils/body.ts#L123-L141), [src/utils/body.ts:215-242](repo://src/utils/body.ts#L215-L242)

### cloneRawRequest

`cloneRawRequest(req)` returns a fresh `Request` for forwarding. If the body was never read it clones `raw`; otherwise it rebuilds the request from the first cached body and the original's init fields. A body consumed directly through `req.raw` cannot be recovered, and the function throws an `HTTPException(500)` explaining that.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

## Validated data

`addValidatedData(target, data)` stores the output of a validator for one target (`json`, `form`, `query`, `param`, `header`, `cookie`), and `valid(target)` returns it, typed from the route's input type `I`. [[Validator]] shows how the validator middleware fills it.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Route information

`c.req.matchedRoutes` lists the `RouterRoute` record of every handler matched for this request, and `c.req.routePath` is the registered path of the handler currently running. Both are marked deprecated in favour of the route helper ([[Testing, Route and Dev Helpers]]), which reads the match result through the `GET_MATCH_RESULT` symbol getter instead of a public property.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1), [src/helper/route/index.ts:30-35](repo://src/helper/route/index.ts#L30-L35)
