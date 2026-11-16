---
type: architecture
title: Context and HonoRequest
description: How Context builds and merges responses, stores per-request variables and renderer/layout, and how HonoRequest resolves route params from the router match result, caches bodies and carries validated data.
tags: [context, request, response, headers, body-cache, params]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Context and HonoRequest

Every handler receives a `Context` (`src/context.ts`), created once per request in `HonoBase.#dispatch` with the path, router match result, `env`, execution context and not-found handler (see [Request Lifecycle](request-lifecycle.md)). `c.req` is a lazily created `HonoRequest` (`src/request.ts`) wrapping the standard `Request`.

## Context

### Response building

- `c.text()`, `c.json()`, `c.html()`, `c.body()` and `c.newResponse()` all route through the private `#newResponse(data, arg, headers)`. It starts from the headers already accumulated on the context (the committed `#res` headers if a response exists, otherwise the `#preparedHeaders` bag), overlays headers from an init/`Response` argument (`set-cookie` is *appended*, other headers replace), then overlays the explicit headers record, and uses the status from the argument, then `c.status()`, then default. Content type defaults are applied through `setDefaultContentType`, so a caller-supplied `Content-Type` wins.
- `c.text()` has a fast path: with no prepared headers, no status, no extra args and an unfinalized context it returns a bare `new Response(text)`.
- `c.redirect(location, status = 302)` sets `Location` (percent-encoding via `encodeURI` when the string has characters above `\xFF`) and returns an empty-bodied response. `c.notFound()` invokes the app's not-found handler, falling back to an empty `Response`.
- `c.header()` before any response exists writes to `#preparedHeaders`; after finalization it clones the existing response so headers remain mutable (`undefined` value deletes, `{append: true}` appends). `c.status()` only records a status used by the next response constructed.

### The `res` accessor and merging

`c.res` lazily creates an empty response that shares the prepared headers. The **setter** is the important invariant: when a response already exists and a new one is assigned (typical when middleware replaces a downstream response after `await next()`), the new response is rebuilt and the old response's headers are copied onto it, except `content-type` (the new response wins) while multiple `set-cookie` headers are preserved. Assigning marks `c.finalized = true`. `compose` and `#dispatch` rely on `finalized` to decide whether a 404 must be produced and whether to accept a handler's returned response ([Middleware Composition](middleware-composition.md)).

### Variables, renderer, layout, execution context

- `c.set/get` store per-request values in a lazily allocated `Map`; `c.var` returns a read-only object snapshot built from it. Types come from `Env['Variables']` and the global-augmentable `ContextVariableMap` interface.
- `c.setRenderer()/c.render()` and `c.setLayout()/c.getLayout()` back middleware such as the JSX renderer ([JSX](../features/jsx.md)); `render` defaults to `c.html(content)` if no renderer has been set.
- `c.executionCtx` and `c.event` **throw** when the host did not provide an execution context / `FetchEvent`, which is why `mount()` wraps the lookup in a try/catch. `c.env` carries platform bindings (adapters decide what it holds; see [Runtime Adapters](../platform/adapters.md)).
- `c.error` is set by `compose` when a handler throws before the error handler runs, so middleware can inspect the failure after `await next()`.

## HonoRequest

- **Params.** The router returns, per handler, a param description plus (for the RegExp router) a shared capture array. `HonoRequest.param(key)` looks up `matchResult[0][routeIndex][1][key]` and, if a capture array exists, indexes into it; the PatternRouter/TrieRouter/LinearRouter embed actual values instead. Values containing `%` are decoded with a safe `tryDecode` that leaves malformed sequences untouched. `routeIndex` is updated by `compose` for each running handler, so `c.req.param()` is correct inside each middleware of a chain.
- **Introspection.** `matchedRoutes` maps the match result to `RouterRoute` records and `routePath` returns the path of the handler at `routeIndex`; helpers in `src/helper/route` build on these. The match result is also exposed under a private `GET_MATCH_RESULT` symbol.
- **Query/headers.** `query()`/`queries()` parse from the URL on demand; `header()` reads from the raw `Headers` (returning a lower-cased record when called with no name).
- **Body cache.** `json/text/arrayBuffer/blob/formData/bytes` go through `#cachedBody`: the first call stores the promise under its key in `bodyCache`; later calls for a *different* representation re-derive it from whichever cached body exists (re-stringifying cached JSON) so a request body can be read in several forms despite streams being single-use. `json()` is `text()` plus `JSON.parse`.
- **`parseBody(options)`** (implemented in `src/utils/body.ts`) only handles `multipart/form-data` and `application/x-www-form-urlencoded`, returning `{}` for other types; options `all` (collect repeated keys into arrays) and `dot` (expand `a.b` keys into nested objects).
- **Validated data.** `addValidatedData(target, data)` and `valid(target)` hold the output of `validator()` middleware per target, which is how typed `c.req.valid('json')` works ([Validator and RPC client](../features/validation-and-rpc-client.md)).

## Why it matters

Because the router, `compose`, `Context` and `HonoRequest` communicate only through `matchResult`, `routeIndex` and `finalized`, custom routers must follow the `Result` contract exactly ([Router Contract](../routing/router-contract-and-smart-router.md)), and middleware that swaps `c.res` can rely on header carry-over rather than copying headers manually.
