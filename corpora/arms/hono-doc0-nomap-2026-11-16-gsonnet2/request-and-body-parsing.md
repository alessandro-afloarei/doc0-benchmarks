---
title: "HonoRequest and Body Parsing"
---
## Overview

`HonoRequest` (`src/request.ts`) is what `c.req` returns. It wraps the standard `Request` as `raw` and adds what the router knows: decoded path parameters, query access, header access, a body cache so the body can be read in several forms, and storage for validated input. The `Context` creates it lazily ([[Context and Responses]]).

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:363-369](repo://src/context.ts#L363-L369)

## Path parameters

The router's result is stored on the request as `#matchResult`. It has the shape `[[[handler, route], params][], stash?]` ([[Router Interface and SmartRouter]]). `routeIndex` starts at 0 and is overwritten by `compose` as each handler runs, so `c.req.param()` always reads the parameters of the route that is currently executing ([[Middleware Composition and Error Handling]]).

Sources: [src/request.ts:53-80](repo://src/request.ts#L53-L80), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

`param(key)` reads `matchResult[0][routeIndex][1][key]`. If the router returned a parameter stash (`matchResult[1]`, produced by `RegExpRouter`), that value is an index into the stash, otherwise it is the value itself. Values containing `%` are decoded with `tryDecodeURIComponent`, which falls back to decoding the valid parts instead of throwing. `param()` without a key returns every parameter decoded, skipping those whose value is undefined.

Sources: [src/request.ts:94-128](repo://src/request.ts#L94-L128), [src/utils/url.ts:80-93](repo://src/utils/url.ts#L80-L93)

## Query and headers

`query(key?)` and `queries(key?)` read the query string from `request.url` through `getQueryParam` and `getQueryParams`. `query()` returns one string per key; `queries()` returns arrays, for URLs like `?tags=A&tags=B`. For a plain key (no `%` or `+`), the implementation searches the URL string for `?key=` or `&key=` directly and only decodes the value it finds, instead of parsing every parameter.

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:219-249](repo://src/utils/url.ts#L219-L249), [src/utils/url.ts:302-315](repo://src/utils/url.ts#L302-L315)

`header(name)` returns the value from `raw.headers` or `undefined`; `header()` returns an object of all headers. `url`, `method`, `path`, `matchedRoutes` and `routePath` give the request URL, method, the path the router saw, every route that matched this request and the pattern of the current one.

Sources: [src/request.ts:185-198](repo://src/request.ts#L185-L198), [src/request.ts:369-387](repo://src/request.ts#L369-L387), [src/request.ts:420-442](repo://src/request.ts#L420-L442)

## Body access and the cache

`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` all go through `#cachedBody(key)`. A web `Request` body can be consumed once, so the cache stores the first promise in `bodyCache[key]`. A second call for the same form returns the stored promise. A call for a different form finds any cached entry and converts it: it awaits that entry, JSON-stringifies it first if it was cached as `json`, and builds `new Response(body)[key]()`. Only the very first read touches `raw`.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

```ts
return (bodyCache[key] = raw[key]())
```

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json()` itself reads the `text` form and runs `JSON.parse`, so a `json()` followed by `text()` reuses one network read. `bytes()` wraps the `arrayBuffer` form in a `Uint8Array`.

Sources: [src/request.ts:253-255](repo://src/request.ts#L253-L255), [src/request.ts:301-303](repo://src/request.ts#L301-L303)

`cloneRawRequest(req)` makes a fresh `Request` from a `HonoRequest`. If `raw` has not been read, it clones it. If the body was consumed, it rebuilds a `Request` from the first cached form and copies the request options. If nothing was cached it throws `HTTPException(500)` asking you to use the `HonoRequest` methods instead of consuming `raw`.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

## Parsing form bodies

`parseBody(options)` delegates to `parseBody` in `src/utils/body.ts`. It reads the media type from `Content-Type`; only `multipart/form-data` and `application/x-www-form-urlencoded` are parsed, and every other type yields `{}`.

Sources: [src/request.ts:216-218](repo://src/request.ts#L216-L218), [src/utils/body.ts:97-113](repo://src/utils/body.ts#L97-L113)

`parseFormData` reads the body once as an `ArrayBuffer`, converts it with `bufferToFormData`, and stores the form data promise in `request.bodyCache.formData`, so a later `c.req.formData()` reuses it. Two options reshape the result. By default each key keeps one value (the last one for duplicates). With `all: true`, or for keys ending in `[]`, repeated keys become arrays. With `dot: true`, a key such as `obj.key` is turned into a nested object; keys containing `__proto__` segments are ignored to avoid prototype pollution.

Sources: [src/utils/body.ts:123-141](repo://src/utils/body.ts#L123-L141), [src/utils/body.ts:151-206](repo://src/utils/body.ts#L151-L206), [src/utils/body.ts:215-242](repo://src/utils/body.ts#L215-L242)

## Validated data

`addValidatedData(target, data)` stores the output of a validator in a per-target slot, and `valid(target)` returns it. Nothing in `HonoRequest` populates it by itself: the validator middleware does, after parsing and checking the input ([[Validator and Typed Routes]]).

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)
