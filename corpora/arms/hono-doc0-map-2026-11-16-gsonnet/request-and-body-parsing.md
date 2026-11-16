---
title: "Request and Body Parsing"
---
## Overview

`HonoRequest` (`src/request.ts`) is what `c.req` returns. It wraps the standard `Request` (kept as `raw`) and adds the things a router and a framework know: path parameters, the cached body readers, validated data and the matched routes. `Context` creates it lazily with the request, the path and the router's match result; see [[Context and Responses]].

Sources: [src/request.ts:36-80](repo://src/request.ts#L36-L80), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Path parameters

The router returns, for the matched route chain, a list of `[handler, params]` entries, optionally followed by a stash of captured strings (the two `Result` shapes are described in [[Router Interface and Selection]]). `HonoRequest` stores that result and a `routeIndex`; `compose` sets `routeIndex` before calling each handler, so `c.req.param()` always reads the params of the route that is currently running.

Sources: [src/request.ts:53-80](repo://src/request.ts#L53-L80), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

`param(key)` looks up `matchResult[0][routeIndex][1][key]`. When the result has a stash (`matchResult[1]`, produced by the RegExp-based router) that value is an index into the stash; otherwise it is the string itself. Values containing `%` are decoded with `decodeURIComponent`, falling back to the raw string if decoding fails. `param()` with no key returns an object of all decoded params, skipping any that are undefined.

Sources: [src/request.ts:102-128](repo://src/request.ts#L102-L128)

## Query strings and headers

`query(key)` and `queries(key)` read straight from `this.url` through `getQueryParam` and `getQueryParams` in `src/utils/url.ts`, with no `URLSearchParams` object. For a plain key with no `%` or `+` it scans the URL with `indexOf` for the key and returns the decoded slice, returning `''` for `?key` with no value. Otherwise it splits the whole query string, keeping the first value for a repeated name (`query`) or all values in an array (`queries`).

Sources: [src/request.ts:148-171](repo://src/request.ts#L148-L171), [src/utils/url.ts:219-315](repo://src/utils/url.ts#L219-L315)

`header(name)` returns `raw.headers.get(name)` or undefined; `header()` copies every header into a plain object. `url`, `method` and `path` are plain accessors for the raw request and the path that was matched.

Sources: [src/request.ts:188-198](repo://src/request.ts#L188-L198), [src/request.ts:369-387](repo://src/request.ts#L369-L387)

## Cached body readers

A request body can be read only once, so `HonoRequest` keeps a `bodyCache` object keyed by `json`, `text`, `arrayBuffer`, `blob` or `formData`, each holding a promise. `#cachedBody(key)` returns the cached promise if there is one. If a different key was cached first, it awaits that body, re-stringifies it when it was `json`, and converts with `new Response(body)[key]()`. Only when nothing is cached does it call `raw[key]()` and store the promise.

Sources: [src/request.ts:20-27](repo://src/request.ts#L20-L27), [src/request.ts:220-239](repo://src/request.ts#L220-L239)

This means middleware and handlers can call `c.req.json()` and then `c.req.text()` in any order. The public readers are thin: `json()` parses the cached `text`, `text()`, `arrayBuffer()`, `blob()` and `formData()` return their cache entry, and `bytes()` wraps the `arrayBuffer` in a `Uint8Array`.

Sources: [src/request.ts:253-331](repo://src/request.ts#L253-L331)

> [!WARNING]
> Reading `c.req.raw` directly consumes the body outside the cache. `cloneRawRequest` copes with a consumed request only when something was cached through a `HonoRequest` method, and otherwise throws an `HTTPException` with status 500.

Sources: [src/request.ts:476-505](repo://src/request.ts#L476-L505)

## parseBody for forms

`parseBody(options)` delegates to `parseBody` in `src/utils/body.ts`. It reads the `Content-Type` media type and handles only `multipart/form-data` and `application/x-www-form-urlencoded`; any other type returns `{}`. For those it reads the `arrayBuffer`, builds a `FormData` with `bufferToFormData`, and stores that promise in `bodyCache.formData` so a later `c.req.formData()` still works.

Sources: [src/request.ts:212-218](repo://src/request.ts#L212-L218), [src/utils/body.ts:97-141](repo://src/utils/body.ts#L97-L141)

The conversion starts from an object with no prototype. By default a repeated key keeps its last value and files are `File` values. Two options change that:

Sources: [src/utils/body.ts:151-166](repo://src/utils/body.ts#L151-L166)

| Option | Default | Effect |
| --- | --- | --- |
| `all` | `false` | Fields with multiple values become arrays; a key ending in `[]` is always collected as an array |
| `dot` | `false` | Keys containing `.` become nested objects, and the dotted key is deleted |

Sources: [src/utils/body.ts:43-75](repo://src/utils/body.ts#L43-L75), [src/utils/body.ts:151-179](repo://src/utils/body.ts#L151-L179)

## Validated data and route info

`addValidatedData(target, data)` stores validated input per target and `valid(target)` returns it. The validator middleware calls the first; handlers call the second, and its type comes from the `I` type parameter. See [[Validation]].

Sources: [src/request.ts:339-354](repo://src/request.ts#L339-L354)

`matchedRoutes` maps the match result to its `RouterRoute` entries and `routePath` returns the path registered for the current `routeIndex`. Both getters are marked deprecated in favour of helpers in `hono/route` (see [[Helpers Catalogue]]).

Sources: [src/request.ts:420-442](repo://src/request.ts#L420-L442)
