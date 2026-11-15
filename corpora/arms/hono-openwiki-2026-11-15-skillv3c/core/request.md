---
type: architecture
title: HonoRequest
description: The HonoRequest wrapper (c.req) in src/request.ts — route params resolved from the router match result and routeIndex, fast query-string parsing, headers, cached body readers, parseBody for forms, validated data storage, matchedRoutes/routePath, and cloneRawRequest.
tags: [core, request, params, query, body, parsebody]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-8d8b1d5204737a950c3145a4
    resource: repo://src/helper/route/index.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# HonoRequest

`HonoRequest` (`src/request.ts`) is the object behind `c.req`. It wraps the raw Web `Request` (available as `c.req.raw`) and adds routing-aware accessors. It is created lazily by [Context](context.md) with the raw request, the extracted `path`, and the router's match result.

## Route parameters

`c.req.param(key)` / `c.req.param()` read params from the router [`Result`](../routing/router-interface.md) for the **currently executing** route, selected by `routeIndex` (updated by `compose` before each handler runs — see [Middleware Composition](middleware-composition.md)). This matters because middleware registered at `/api/*` and a handler at `/api/:id` receive different param maps from the same match.

The result has two shapes and `#getParamValue` handles both:

- `[[handler, paramIndexMap][], paramStash]` (RegExpRouter): the per-route map stores **indices** into the shared stash array.
- `[[handler, params][]]` (TrieRouter, LinearRouter, PatternRouter): the map stores values directly.

Values are URI-decoded with `decodeURIComponent` **only if they contain `%`**, and decoding failures fall back to the raw value (`tryDecode`). `param()` without a key returns all params of the current route, skipping undefined optional params. Type-level overloads derive available keys from the route path (`/users/:id{[0-9]+}?` etc.); see [Type System and Route Schema](../typing/type-system.md).

## Query, headers, URL

- `query(key)` / `query()` — single values; when a key appears multiple times, the **first** value wins. `queries(key)` / `queries()` return arrays of all values.
- The parser in `src/utils/url.ts` is hand-written for speed: for a plain (non-encoded) key it scans for `?key` / `&key` without building a map, and it decodes names/values (treating `+` as space) only if the URL contains `%` or `+`. A key without `=` yields `''`.
- `header(name)` returns `raw.headers.get(name) ?? undefined` (case-insensitive); `header()` returns a plain object of all headers (lower-cased keys).
- `url`, `method`, and `path` (the routing path from `app.getPath`, already decoded) are exposed directly.

## Body readers and caching

`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()`, and `formData()` read the body through `#cachedBody(key)`, which stores the **promise** in `bodyCache`:

- Repeated reads of the same kind return the cached promise.
- A read of a *different* kind after the body was consumed re-materializes from whichever form was cached first, by wrapping it in a `new Response(body)` and calling the requested reader (a cached `json` value is re-stringified first).
- `json()` is implemented as `text()` + `JSON.parse`, so the cache key for JSON is `text`.

This lets middleware (validator, body-limit, logger-like code) and handlers each read the body without "body already used" errors — **as long as everyone uses `c.req.*` rather than `c.req.raw.*`**.

`cloneRawRequest(req)` (exported from `hono/request`) returns a fresh `Request`: `raw.clone()` if the body is unused, otherwise a new `Request` built from the first cached body plus the original request's init properties. If the raw body was consumed without going through the cache it throws an `HTTPException(500)` explaining that `HonoRequest` methods must be used. It is a user-facing utility for forwarding a request (for example to the [proxy helper](../helpers/utility-helpers.md)) after middleware has already read its body.

## `parseBody(options)`

`parseBody` (`src/utils/body.ts`) handles only `multipart/form-data` and `application/x-www-form-urlencoded` (media type compared case-insensitively, parameters ignored); every other content type returns `{}`. It reads the body as an `ArrayBuffer`, converts it with `bufferToFormData`, and stores the resulting `FormData` promise in `bodyCache.formData` so a later `c.req.formData()` works.

Options:

- `all: true` — collect repeated keys into arrays. Keys ending in `[]` are always collected as arrays regardless of `all`.
- `dot: true` — expand `a.b.c` keys into nested objects. Keys containing a `__proto__.` segment are ignored, and nested containers are created with `Object.create(null)` to prevent prototype pollution.

## Validated data

`addValidatedData(target, data)` stores output of the [Validator](../validation/validator.md) per target (`json`, `form`, `query`, `param`, `header`, `cookie`), and `valid(target)` returns it with the type inferred from the route's `Input`.

## Route introspection

`matchedRoutes` lists the `RouterRoute` records of all handlers that matched this request (middleware included) and `routePath` is the registered path of the currently executing one. Both are marked deprecated in favor of `matchedRoutes(c)` / `routePath(c)` in `hono/route`, which read the match result through the `GET_MATCH_RESULT` symbol getter (see [Utility Helpers](../helpers/utility-helpers.md)).

## Tests

`src/request.test.ts` covers params (including encoded values and optional params), query/queries, headers, body caching across different readers, `parseBody` options, and `cloneRawRequest`. `src/utils/body.test.ts` and `src/utils/url.test.ts` cover the parsers in detail.
