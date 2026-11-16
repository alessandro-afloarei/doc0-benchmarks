---
type: architecture
title: Context and HonoRequest
description: How Hono's Context (response building, headers, status, variables, rendering, finalization) and HonoRequest (params, query, headers, cached body parsing, validated data) are created per request and used by handlers and middleware.
tags: [hono, context, request, response, middleware, body-parsing, params]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Context and HonoRequest

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every request that reaches `Hono.#dispatch` gets one `Context` instance (see [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)). `Context` is the object handlers and middleware receive as `c`. It wraps the incoming `Request` and owns the outgoing `Response`. `HonoRequest` is the request-side view exposed as `c.req`. Both are defined in `src/context.ts` and `src/request.ts`.

## Context construction

`Context` is constructed as `new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`. The constructor only stores these values; nothing is parsed eagerly.

- `c.env` holds platform bindings (set from the second argument of `app.fetch`, defaulting to `{}`).
- `c.executionCtx` and `c.event` throw if the runtime did not provide an `ExecutionContext` or `FetchEvent`, so callers must guard them on platforms that have neither.
- `c.req` is created lazily on first access, as `new HonoRequest(rawRequest, path, matchResult)`, and cached.
- `c.finalized` is a plain boolean. It becomes `true` when a response is assigned through the `res` setter. The dispatcher checks it to decide whether a handler actually produced a response.

## Response building

Context has two layers for producing responses.

**Stateless helpers** return a `Response` and do not change `c.res`:

- `c.text()`, `c.json()`, `c.html()`, `c.body()` and `c.newResponse()` build a `Response`. `c.body()` takes raw data; the others set `Content-Type` by default (`text/plain`, `application/json`, `text/html; charset=UTF-8`).
- Each helper takes an optional status, a `ResponseInit`, or a status number, plus extra headers.
- Fast path: `text`, `json`, and `html` return a bare `new Response(...)` when no prepared headers, status, options, or extra headers exist and the context is not finalized. Otherwise they route through the internal `#newResponse`.
- `c.redirect()` and `c.notFound()` are also built on `newResponse`. `notFound()` calls the app's configured not-found handler.

**Stateful headers and status** are accumulated before a response exists:

- `c.header(name, value, { append })` writes into `#preparedHeaders` while no response is set, or into the current `c.res` headers after one exists. Passing `undefined` deletes the header.
- If `c.header` is called after the context is finalized, it first clones the current response so the headers can be mutated (the `Response` headers are immutable in some runtimes).
- `c.status(code)` stores a default status used by later helper calls that do not pass one.

### Assigning `c.res`

Reading `c.res` lazily creates an empty `Response` with the prepared headers. Assigning `c.res = r` does three things: if a previous response exists, it copies the previous response's headers onto the new one (except `content-type`, and with `set-cookie` values preserved as multiple entries); it stores the response; and it sets `finalized = true`. This is how middleware can run `await next()` and then modify headers on the response that the downstream handler produced.

## Variables and environment

- `c.set(key, value)` and `c.get(key)` store request-scoped values in a `Map` created on first use. The key type is constrained by `Env['Variables']` and the `ContextVariableMap` interface, so custom middleware can extend the typed variable set.
- `c.var` returns the variables as a plain object snapshot.
- `c.env` and `c.executionCtx` are described above. `c.error` holds the error the compose chain caught for the error handler.

## Rendering and layouts

- `c.render(...)` calls a renderer. If none is set, the default renderer is `c.html`.
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `c.setRenderer(fn)` installs a renderer; `c.setLayout(layout)` and `c.getLayout()` store a layout component used by renderers. The `jsx-renderer` middleware is the usual place these are set (see [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)).

## HonoRequest

`HonoRequest` wraps `c.req.raw` (the original `Request`), the matched path, and the route match result.

- **Params.** `c.req.param(name)` reads the matched route parameter from the match result at `routeIndex`. Values containing `%` are decoded with `tryDecodeURIComponent`. `c.req.param()` with no argument returns all decoded params.
- **Query and headers.** `c.req.query()`, `c.req.queries()`, and `c.req.header()` read from the URL and `Headers` directly. Headers are read live from `raw.headers`.
- **Body methods.** `json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()`, and `formData()` read the body. `parseBody()` is a higher-level form parser.
- **Body caching.** All body readers go through `#cachedBody(key)`. The first read stores the promise in `bodyCache`. A later read of a different format reconstructs the body from the cached one: for example, `json()` reads `text`, and if `arrayBuffer` was read first, the cached buffer is wrapped in a new `Response` to produce the requested format. This means a request body can be consumed by several middleware and handlers without hitting the underlying stream twice. Reads that go through `raw` directly bypass the cache.
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Validated data.** `c.req.addValidatedData(target, data)` stores the output of a validator for one target (`json`, `form`, `query`, `param`, `header`, `cookie`). `c.req.valid(target)` returns it. The validator middleware is described in [Validator Middleware and Input Types](/openwiki/validation/validator.md).

## Lifecycle and consequences

- Because `HonoRequest` reads headers and body from the live `Request`, middleware that rewrites the request must do so before handlers read it. The `mount` helper creates a new `Request` for sub-applications for this reason (see the request lifecycle page).
- `c.res` and `c.finalized` together define whether a route answered. A handler that returns `undefined` without assigning a response leaves `finalized` false; the dispatcher reports this as an error in the composed path.
- Header and status mutations made after finalization are applied to the response that already exists, so middleware that runs after `await next()` can add headers such as CORS or timing headers without building a new response.

## Representative tests

- `src/context.test.ts` covers Context behaviour such as response helpers, header handling, and finalization.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Validator Middleware and Input Types](/openwiki/validation/validator.md)
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)
