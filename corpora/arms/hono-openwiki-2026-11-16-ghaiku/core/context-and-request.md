---
type: concept
title: Context and HonoRequest
description: The per-request API surface of Hono - the Context object (environment and execution context, response builders such as text, json, html, redirect and newResponse, header and status control, request variables, and the render and layout hooks) and HonoRequest (route parameters, query and header access, cached body parsing, and validated-data retrieval).
tags: [context, request, response, params, body-parsing, variables, rendering, api]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Context and HonoRequest

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every handler and middleware receives a `Context` (usually named `c`). The context wraps the native `Request` through a `HonoRequest` accessor at `c.req`, exposes the bindings and execution context of the current invocation, and builds the `Response` that the dispatch returns. A context is created once per dispatch in `#dispatch` (see [Request Lifecycle](/openwiki/architecture/request-lifecycle.md)) and is not shared between requests. Source: `src/context.ts` and `src/request.ts`.

## Context: Construction and Environment

`new Context(req, options)` stores the raw request and, when options are present, the execution context, the bindings (`env`), the not-found handler, the resolved path, and the router match result. `c.env` is a plain property holding the bindings that the adapter or caller provided; `c.executionCtx` is a getter that throws `This context has no ExecutionContext` when no execution context was supplied. `c.finalized` is a public boolean that the dispatch uses to decide whether a response exists.

`c.req` lazily creates a `HonoRequest` from the raw request, the resolved path, and the match result. `c.error` holds the error currently being handled when `onError` runs.

## Context: Response Construction

Response builders all go through one private method, `#newResponse`, which decides the status and headers:

- The status is taken from the explicit numeric argument, from a `ResponseInit`-style object, or from the value set by `c.status(...)`.
- Headers start from the headers already staged on the context (either the previous `c.res` or headers set with `c.header`), then are merged with any `headers` in the argument. A `set-cookie` value in the argument is appended rather than replacing earlier cookies, while other names are replaced.

The public builders are:

- **`c.text(text, status?, headers?)`** sends `text/plain; charset=UTF-8` unless a content type is supplied. When nothing has been staged, it returns a plain `new Response(text)` as a fast path.
<!-- openwiki: broken internal link [/openwiki/client/typed-rpc-client.md] link "/openwiki/client/typed-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`c.json(object, status?, headers?)`** serializes with `JSON.stringify` and sets `application/json`. Its return type carries the object type and status, which is how the typed client infers responses (see [Typed RPC Client](/openwiki/client/typed-rpc-client.md)).
- **`c.html(html, status?, headers?)`** accepts a string or a JSX-style promise. Promises are resolved and stringified before the response is built, with `text/html; charset=UTF-8` as the default type.
- **`c.body(data, status?, headers?)`** sends raw bytes or streams without a content type default; **`c.newResponse(data, ...)`** is the general form that accepts a `ResponseInit`.
- **`c.redirect(location, status?)`** sets the `Location` header, encoding non-Latin-1 characters with `encodeURI`, and returns a null-body response with status `302` by default.
- **`c.notFound()`** calls the not-found handler that the dispatch passed into the context (the application's handler, which by default returns `404 Not Found` as text) and returns its result.

Two staging methods shape responses built later: `c.header(name, value, { append })` writes to the staged headers (or, after finalization, copies the current response first), and `c.status(code)` sets the default status for the next builder. Passing `undefined` as a header value deletes that header.

## Context: Rendering and Variables

- **Variables** are per-request key-value pairs. `c.set(key, value)` stores them and `c.get(key)` reads them; `c.var` returns a read-only snapshot. Their type is declared through the `Variables` field of the environment type, so middleware that sets a variable can be typed for handlers that read it.
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Rendering** is pluggable. `c.setRenderer(fn)` installs a renderer, and `c.render(...args)` calls it. The default renderer is `c.html`. `c.setLayout` and `c.getLayout` store a layout component that the JSX renderer middleware (see [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md)) consults.

## Context: Response Ownership

`c.res` is a getter-and-setter pair. The getter lazily creates an empty response that carries the staged headers, so middleware can read and modify it even before a handler has returned. The setter merges the headers of the previous response into the new one, skipping `content-type` (so the new body's type wins) and appending `set-cookie` values rather than dropping them. This is the mechanism by which headers set by an early middleware survive a handler's `return c.text(...)`.

## HonoRequest: Routing Information

`HonoRequest` is constructed with the raw `Request`, the path, and the match result. It keeps a `routeIndex` that compose updates as each entry in the chain runs, so that `c.req.param()` reads parameters from the entry that is currently executing (a middleware registered at `/users/*` sees its own captured parameters, and a handler registered at `/users/:id` sees its own). `c.req.routePath` and `c.req.matchedRoutes` expose the route pattern and the chain of matched routes for diagnostics.

- **`c.req.param(name?)`** returns one decoded parameter, or all of them when called without an argument. Values are passed through `tryDecodeURIComponent` only when they contain `%`, so a plain value is never decoded twice.
- **`c.req.query(name?)` and `c.req.queries(name?)`** read the query string. `queries` returns arrays for repeated keys.
- **`c.req.header(name?)`** returns a header value or a map of all headers, reading from the native `Headers` object.
- **`c.req.url`, `c.req.path`, `c.req.method`** expose the request URL, the path used for routing, and the method.

## HonoRequest: Body Access and Caching

The body can be read once natively, but Hono needs it in several forms (validator, parser, and handler). `HonoRequest` therefore caches the first read in `bodyCache`:

- `text()`, `json()`, `arrayBuffer()`, `blob()`, `formData()`, and `bytes()` all go through the private `#cachedBody(key)`.
- If the requested form is cached, the cached promise is returned. If a different form was cached first, the cached body is converted through a new `Response` for the requested form. For `json`, the cache is re-serialized to text before conversion.
- Otherwise the native method is called on the raw request and its promise is stored in `bodyCache`.

`c.req.parseBody()` builds on this cache and parses `multipart/form-data` and `application/x-www-form-urlencoded` bodies (see `src/utils/body.ts`). The validator middleware uses the same cache so that a handler reading the body after validation does not trigger a second read.

## HonoRequest: Validated Data

<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`addValidatedData(target, data)` stores the result of a validator under a target such as `json`, `query`, or `param`. `c.req.valid(target)` returns that result with its inferred type. If the validator did not run for the target, the method returns `undefined` at runtime, so handlers that depend on validated data must be mounted behind the corresponding validator middleware. See [Validator and Typed Inputs](/openwiki/validation/validator.md).

## Invariants And Failure Behavior

- Context values are request-scoped. Nothing stored on the context survives to another request, because each dispatch constructs a new context.
- Building a response does not by itself change the final response. The dispatch uses the value a handler or middleware returns, or the value assigned to `c.res`; a builder call whose result is discarded has no effect.
- Reading `c.executionCtx` on an app invoked without an execution context throws, so code that may run on runtimes without one should guard the access.
- Body reads are cached across all forms, but the first read consumes the native stream; reading `raw.text()` directly bypasses the cache and will break subsequent reads through `c.req`.

## Extension Seams

- `c.setRenderer` replaces the default HTML rendering for an entire application or a single middleware chain.
<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Middleware typically extends the context type through `createMiddleware` (see [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md)) and writes variables with `c.set`.

## Tests

The behavior described here is covered by `src/context.test.ts` and `src/request.test.ts`, which exercise response merging, header semantics, and body caching.
