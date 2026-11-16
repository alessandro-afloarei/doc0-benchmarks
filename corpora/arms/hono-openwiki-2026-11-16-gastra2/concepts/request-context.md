---
type: concept
title: Request data and response context
description: Per-request state, cached body parsing, validated inputs, and response/header ownership in Context and HonoRequest.
tags: [context, request, response, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Request data and response context

A `Context` is created for each dispatch. It owns the raw request, lazy `HonoRequest` wrapper, environment binding reference, execution context, variables, renderer, and response state. These objects connect the [dispatch lifecycle](../architecture/request-lifecycle.md) to endpoint and middleware code.

## State and capability boundaries

`c.req` constructs its wrapper only on first access. `c.env` receives the bindings passed to the application; it is distinct from values set with `c.set()`, which live in a lazily allocated per-context Map. `c.get()` reads that map and `c.var` exposes an object snapshot. Environment and variable types are supplied through the application's Env generic.

Runtime execution context is optional. Reading `c.executionCtx` throws if it was not supplied; reading `c.event` also requires an object exposing `respondWith`. Middleware using background tasks must therefore account for the selected adapter and how tests supply runtime arguments.

## Request access and body lifetime

Route parameters come from the current matched handler, indexed by `c.req.routeIndex`. The wrapper supports both direct values and shared router parameter stashes and decodes percent-encoded values. Query/header access and body parsing operate on the underlying Fetch request.

Body methods such as `json()`, `text()`, `arrayBuffer()`, `blob()`, and `formData()` share `bodyCache`. A repeated method returns its stored promise. If another representation was read first, the wrapper attempts conversion through a new Response, stringifying a cached JSON value first. This is a parsing cache, not a guarantee that every conversion preserves original wire bytes.

Consuming `c.req.raw` directly bypasses the cache. `cloneRawRequest()` clones an unused raw request; after consumption it reconstructs from cached data, but throws an HTTPException with status 500 if no cached representation exists. Prefer wrapper methods when validators, proxies, or later middleware need the body again.

`parseBody()` delegates to the form-body utility. It supports options for collecting repeated fields and expanding dotted keys. This convenience parser is separate from `c.req.valid(target)`: validated data is a second store populated by validation middleware, not a side effect of reading JSON or form input. See [validation and clients](../workflows/validation-and-client.md).

## Response construction and finalization

Reading `c.res` lazily creates an empty response with prepared headers. That getter alone does not finalize the context. Assigning `c.res` sets `finalized = true`. The composer ordinarily performs that assignment for a handler's returned response.

When replacing an existing response, the setter recreates the incoming response and copies previous headers except Content-Type. Set-Cookie receives special treatment: existing cookies are copied individually. Therefore response replacement through the context is not identical to discarding all earlier middleware headers.

`c.header()` writes prepared headers before a response exists, or response headers afterward; after finalization it first recreates the response so headers can be changed. Undefined deletes a header, while the append option adds another value. `c.status()` stores a status for subsequent response construction.

`c.newResponse()` combines context headers with explicit initialization. `c.text()` has a fast path for an otherwise untouched context. `c.json()` serializes with JSON.stringify and sets JSON content type; its generic return type also feeds client schema inference. `c.html()` sets HTML content type and supports asynchronous escaped-string callback resolution. Rendering behavior is expanded in [rendering and streaming](../workflows/rendering-and-streaming.md).

## Testing consequences

Use `src/context.test.ts` for header precedence, response replacement, finalization, and response helpers; use `src/request.test.ts` for body caching, cloning, route parameters, and validated data. `src/utils/body.test.ts` covers form-field transformations.

When diagnosing a missing response, distinguish creating a response from returning or assigning it. When diagnosing lost headers or a consumed body, trace which layer owns the response setter or the first body read.
