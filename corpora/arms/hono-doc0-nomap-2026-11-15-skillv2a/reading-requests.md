---
title: "Reading Requests"
---
## Overview

`c.req` is a `HonoRequest`: a thin wrapper around the standard `Request` (kept as `c.req.raw`) that adds what a handler needs from routing and makes the body readable more than once. It is created lazily by the [[Context and Responses]] on first access, from the raw request, the routing path and the router's match result.

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

The wrapper never copies the request. Path parameters are looked up in the match result on demand, query values are scanned out of the URL string, and body readers cache the promise of the first read. Validated data from [[Validation]] is stored on the same object and read back with `c.req.valid()`.

Sources: [src/request.ts:51-80](repo://src/request.ts#L51-L80)

## Path parameters

`param(key)` returns one parameter and `param()` returns all of them as an object. Both read from the entry of the match result at `routeIndex`, the index of the handler currently running, so each middleware sees the parameters of its own route pattern.

Sources: [src/request.ts:94-128](repo://src/request.ts#L94-L128)

Routers return parameters in one of two shapes (see [[Routing and Router Selection]]): `RegExpRouter` returns a map from name to an index into a shared array of captured values, while the other routers return the values directly. `#getParamValue` hides the difference: when the match result has a second element, the stored value is an index into it.

Sources: [src/request.ts:126-128](repo://src/request.ts#L126-L128), [src/router.ts:66-98](repo://src/router.ts#L66-L98)

Values are decoded with `decodeURIComponent` only if they contain `%`, and a malformed escape leaves the raw value in place instead of throwing. Optional parameters (`/:id?`) are typed `string | undefined` and absent from `param()` when missing.

Sources: [src/request.ts:106-124](repo://src/request.ts#L106-L124), [src/utils/url.ts:81-104](repo://src/utils/url.ts#L81-L104)

## Query strings and headers

| Call | Returns |
| --- | --- |
| `query('page')` | The first value of `page`, `''` for `?page`, `undefined` if absent |
| `query()` | An object with the first value of every key |
| `queries('tag')` | Every value of `tag` as an array |
| `queries()` | An object of arrays for every key |
| `header('X-Name')` | The header value, or `undefined` |
| `header()` | All headers as an object with lower-case keys |

Sources: [src/request.ts:148-198](repo://src/request.ts#L148-L198)

The query helpers parse `c.req.url` directly instead of building a `URL` object. For a single unencoded key, `_getQueryParam` searches for `?key` or `&key` and slices the value out without visiting the other parameters. Only when the key or the URL contains `%` or `+` does it walk every pair and decode names and values, treating `+` as a space.

Sources: [src/utils/url.ts:219-300](repo://src/utils/url.ts#L219-L300)

`url` and `method` are getters over the raw request, and `path` is the routing path that dispatch computed with the app's `getPath` (so with `strict: false` it has no trailing slash).

Sources: [src/request.ts:68-80](repo://src/request.ts#L68-L80), [src/request.ts:369-387](repo://src/request.ts#L369-L387)

## Reading the body

### Cached readers

A `Request` body is a stream that can be read once. `HonoRequest` makes its readers (`json`, `text`, `arrayBuffer`, `bytes`, `blob`, `formData`) safe to call repeatedly and from several middleware through `#cachedBody`:

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

1. If this kind of body was already read, return the cached promise.
2. If another kind was read, wait for it and convert through `new Response(body)[kind]()`; a cached JSON value is stringified first.
3. Otherwise read the raw body and cache the promise under its kind.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json()` reads and caches `text` and parses it each time, and `bytes()` wraps the cached `arrayBuffer`. A validator that read the body as JSON therefore leaves it readable by a later `c.req.text()` in the handler.

Sources: [src/request.ts:253-331](repo://src/request.ts#L253-L331)

> [!WARNING]
> Reading `c.req.raw` directly (for example `await c.req.raw.json()`) bypasses the cache. Later `c.req` readers then fail because the stream is consumed. Use the `c.req` methods, which also lets `cloneRawRequest` rebuild the request when it must be forwarded.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

`cloneRawRequest(req)` returns `req.raw.clone()` while the body is unread. Once it has been read through `c.req`, it builds a new `Request` with the cached body and the original method, headers, mode, credentials, signal and other fields; if the body was consumed without the cache, it throws an `HTTPException(500)`.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

### parseBody for forms

`parseBody(options)` handles `multipart/form-data` and `application/x-www-form-urlencoded` and returns `{}` for any other content type. It reads the cached `arrayBuffer`, converts it to `FormData`, and also stores that `FormData` in the body cache so a later `c.req.formData()` does not fail.

Sources: [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Keep every value of a repeated key as an array; keys ending in `[]` always do |
| `dot` | `false` | Turn `user.name=x` into `{ user: { name: 'x' } }` |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-179](repo://src/utils/body.ts#L151-L179)

Without `all`, a repeated key keeps its last value. With `dot`, keys whose path contains `__proto__.` are dropped, and the nested objects are created with `Object.create(null)`, so form input cannot pollute prototypes.

Sources: [src/utils/body.ts:188-242](repo://src/utils/body.ts#L188-L242)

> [!NOTE]
> Query strings and forms resolve duplicates differently: `query('k')` returns the first value, while `parseBody()` without `all` returns the last.

Sources: [src/utils/url.ts:289-296](repo://src/utils/url.ts#L289-L296), [src/utils/body.ts:157-165](repo://src/utils/body.ts#L157-L165)

## Validated data

`addValidatedData(target, data)` is called by the `validator` middleware; `valid(target)` returns what it stored. Its return type comes from the route's `Input` type parameter, so `c.req.valid('json')` is typed as the validator's output. [[Validation]] covers how the data is produced.

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

## Route information

`matchedRoutes` lists the `RouterRoute` record (method, path, base path, handler) of every handler matched for this request, and `routePath` is the registered path of the one now running, taken from `routeIndex`. These getters are deprecated on `HonoRequest` in favour of the functions in `hono/route`, described on [[Routing and Router Selection]], which read the same match result through the `GET_MATCH_RESULT` symbol.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1)
