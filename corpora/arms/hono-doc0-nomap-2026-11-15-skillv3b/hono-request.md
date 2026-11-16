---
title: "HonoRequest"
---
## Overview

`HonoRequest` is `c.req`: a thin wrapper over the standard `Request` that adds route parameters, fast query parsing, a body cache so the body can be read more than once, and the store for validated input. The `Context` creates it only when `c.req` is first read, passing the raw request, the routing path and the router's match result, so a handler that never touches `c.req` pays nothing for it (see [[Context and Response Building]]).

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

| Member | Returns |
| --- | --- |
| `raw` | The original `Request`, for runtime-specific fields such as Cloudflare's `cf` |
| `path` | The routing path computed by `getPath` |
| `url`, `method` | Read from `raw` |
| `param(key?)` | One path parameter, or all of them as an object |
| `query(key?)`, `queries(key?)` | First value, or every value, of query parameters |
| `header(name?)` | One header, or all headers as a record with lower-case keys |
| `json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()`, `formData()` | The body, cached |
| `parseBody(options?)` | A form body as a plain object |
| `valid(target)` | Data stored by the validator |

Sources: [src/request.ts:51-68](repo://src/request.ts#L51-L68), [src/request.ts:94-198](repo://src/request.ts#L94-L198), [src/request.ts:253-354](repo://src/request.ts#L253-L354)

## Path parameters

`param()` does not parse anything itself; it reads the router's match result. The result is either `[[handler, paramIndexMap][], paramStash]`, where each handler's map gives indexes into a shared array of captured values (the `RegExpRouter` shape), or `[[handler, params][]]` with the values inline (the other routers). `#getParamValue` handles both: with a stash it indexes into it, without one the map entry is the value. [[Routers and Route Syntax]] describes both shapes.

Sources: [src/request.ts:102-128](repo://src/request.ts#L102-L128), [src/router.ts:66-98](repo://src/router.ts#L66-L98)

The map is chosen by `routeIndex`, which `compose` sets to the index of the running handler. A middleware on `/posts/*` and a handler on `/posts/:id` therefore see different parameters: the middleware's route has no `id`. Values are percent-decoded only when they contain `%`, through `tryDecodeURIComponent`, which leaves a malformed sequence as it is instead of throwing.

Sources: [src/request.ts:55-55](repo://src/request.ts#L55-L55), [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

The parameter names are typed from the route path `P`: `c.req.param('id')` on `/posts/:id` is `string`, an optional `:id?` is `string | undefined`, and an unknown key is a type error. [[Type System and Route Schemas]] covers `ParamKeys`.

Sources: [src/request.ts:94-101](repo://src/request.ts#L94-L101)

## Query strings

`query()` and `queries()` call `getQueryParam` and `getQueryParams` on the raw URL string rather than building a `URL` and `URLSearchParams`. For a single unencoded key, the parser searches for `?key=` or `&key=` directly and decodes only that value. Otherwise it walks every `&`-separated pair, decoding `+` as a space and percent escapes only when the URL contains `%` or `+`.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:208-253](repo://src/utils/url.ts#L208-L253)

`query('tag')` returns the first value of a repeated key (`results[name] ??= value`); `queries('tag')` returns all of them as an array. A key without `=` has the value `''`.

Sources: [src/utils/url.ts:255-315](repo://src/utils/url.ts#L255-L315)

## Reading the body

### The body cache

A `Request` body is a stream that can be read once. `HonoRequest` keeps each read in `bodyCache` so middleware and handlers can all read the body. `#cachedBody(key)` returns the cached promise for that format when there is one. When a different format was cached, it converts: it waits for the cached body and reads it again through `new Response(body)[key]()`, stringifying a cached `json` first. Only when nothing is cached does it call `raw[key]()` and cache the promise.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json()` is built on the `text` cache and `JSON.parse`, and `bytes()` on the `arrayBuffer` cache, so a validator that reads JSON and a handler that reads text share one read.

Sources: [src/request.ts:253-331](repo://src/request.ts#L253-L331)

> [!WARNING]
> Reading `c.req.raw` directly (for example `c.req.raw.json()`) bypasses the cache. Later `c.req` readers then fail because the stream is consumed, and `cloneRawRequest` cannot rebuild the request.

Sources: [src/request.ts:476-487](repo://src/request.ts#L476-L487)

### parseBody

`parseBody(options)` handles `multipart/form-data` and `application/x-www-form-urlencoded`; for any other content type it returns `{}`. It reads the body as an `ArrayBuffer`, turns it into `FormData` with `bufferToFormData`, stores that promise in `bodyCache.formData` so a later `formData()` reuses it, and converts it to an object.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Repeated fields become arrays; otherwise the last value wins. Keys ending in `[]` are always arrays |
| `dot` | `false` | `obj.key=value` becomes `{ obj: { key: value } }`; keys containing a `__proto__.` segment are ignored |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-242](repo://src/utils/body.ts#L151-L242)

## Validated data

The validator middleware stores its output with `addValidatedData(target, data)`, keyed by target (`json`, `form`, `query`, `param`, `header`, `cookie`), and handlers read it back with `c.req.valid(target)`. The return type comes from the `I` input type parameter, so `valid('json')` has the schema's output type. [[Validation]] explains how the middleware fills it.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Route metadata

`matchedRoutes` and `routePath` read the match result: the list of `RouterRoute` records for every matched handler, and the path pattern of the route at `routeIndex`. Both getters are deprecated in favour of the `hono/route` helpers, which use the `GET_MATCH_RESULT` symbol getter to reach the same data; see [[Helpers Catalogue]].

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1)

## Cloning the request

`cloneRawRequest(c.req)` returns a new `Request` with the same body, for forwarding a request to another service after it has been read. When the raw body is untouched it simply calls `raw.clone()`. When it has been consumed, it takes the first cached format, awaits it through the matching `HonoRequest` reader, and builds a new `Request` with that body and the original method, headers, mode, credentials, redirect, referrer and signal. If the body was consumed outside the cache it throws an `HTTPException` with status 500.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)
