---
type: architecture
title: Context and HonoRequest
description: How Hono's per-request Context builds responses, carries headers, status, variables, renderer and runtime bindings, and how HonoRequest exposes params, query, headers, cached body parsing and validated data.
tags: [context, request, response, core]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Context and HonoRequest

Every request dispatched by `HonoBase` gets exactly one `Context` (`src/context.ts`). Handlers and middleware receive it as `c`. The `Context` owns the outgoing response state. The `HonoRequest` wrapper (`src/request.ts`), available as `c.req`, owns everything about the incoming request.

See [Request Lifecycle and Composition](./request-lifecycle.md) for where the Context gets created, and [Validation](../concepts/validation.md) for how `c.req.valid()` gets filled.

## Construction

`HonoBase#dispatch` builds the Context with the raw `Request` and a `ContextOptions` object: `env` (bindings), `executionCtx` (a Workers-style `ExecutionContext` or a `FetchEvent`), the app's `notFoundHandler`, the resolved `path`, and the router's `matchResult`.

The `HonoRequest` is created lazily. The `c.req` getter builds it on first access from the raw request, path and match result. A handler that never touches `c.req` never pays for it.

## Runtime bindings

- `c.env` holds the bindings passed to `app.fetch(request, env, executionCtx)`, e.g. Cloudflare KV/D1 bindings or Lambda event data supplied by an adapter. It defaults to `{}`.
- `c.executionCtx` returns the execution context and **throws** `This context has no ExecutionContext` if none was given. `c.event` returns it only if it is a `FetchEvent` (has `respondWith`) and otherwise throws. Code that runs on several runtimes should wrap these calls in `try`. `app.mount()` does this itself.

## Response state

The Context keeps the response state in private fields:

| State | Purpose |
| --- | --- |
| `#preparedHeaders` | Headers set with `c.header()` before any Response exists |
| `#status` | Status set with `c.status()` |
| `#res` | The current `Response` (read/written via `c.res`) |
| `finalized` | `true` once `c.res` has been assigned |
| `error` | Set by `compose` when a handler throws and `onError` handles it |

Key behaviours:

- **`c.res` getter** lazily creates an empty `Response` that uses the prepared headers.
- **`c.res` setter** marks the context `finalized`. If a response already existed, the setter copies its headers onto the new response, except `content-type`. `set-cookie` values are re-appended one by one, so multiple cookies survive. This is how middleware that runs before `next()` can set headers and still see them on the handler's response.
- **`c.header(name, value, { append })`** writes to the prepared headers, or to the existing response. After finalization it first clones the response, so the headers can be changed. Passing `undefined` as the value deletes the header.
- **`c.newResponse` / `c.body`** merge headers in this order: the existing response's headers or prepared headers, then any `ResponseInit.headers` (`set-cookie` is appended, everything else is set), then the explicit header record (array values are appended). The status is the explicit argument, then `init.status`, then `c.status()`.
- **`c.text`** has a fast path. If nothing has been prepared (no headers, no status, no arguments, not finalized), it returns `new Response(text)` directly. Otherwise it goes through `#newResponse` with `text/plain; charset=UTF-8`.
- **`c.json`** sends `JSON.stringify(object)` with `application/json`. The return type is `TypedResponse<JSONParsed<T>>`, which the RPC client consumes (see [Type System and RPC Client](../concepts/types-and-rpc-client.md)).
- **`c.html`** accepts a string or a `Promise<string>`. For an object (an `HtmlEscapedString` from JSX or `html```), it first resolves pending async callbacks via `resolveCallback(..., Stringify)` and returns a `Promise<Response>`.
- **`c.redirect(location, status = 302)`** sets `Location`. If the location contains characters outside Latin-1, it is passed through `encodeURI` first.
- **`c.notFound()`** calls the app's not-found handler. If no handler was configured (for example, a Context made in a test), it falls back to an empty `Response`.

## Rendering and layouts

`c.render(...)` calls the renderer set with `c.setRenderer()`. The default renderer is `c.html(content)`. The `jsx-renderer` middleware uses `setRenderer`, `setLayout` and `getLayout` to wrap handler output in a layout component. The `ContextRenderer` interface can be augmented to change `render`'s signature. See [JSX Runtime](../jsx/jsx-runtime.md).

## Variables

`c.set(key, value)` and `c.get(key)` store per-request values in a lazily created `Map`. `c.var` returns a read-only snapshot object built with `Object.fromEntries`. Types come from `Env['Variables']` and from the global `ContextVariableMap` interface. Middleware such as `jwt`, `request-id` and `language` augment that interface so their variables are typed everywhere.

## HonoRequest

`HonoRequest` wraps the raw `Request` (`c.req.raw`) and adds:

- **Path params**: `param(key)` / `param()` read from `matchResult[0][routeIndex]`. `routeIndex` is updated by `compose` as each handler runs, so params are specific to the current handler's route. With the index-map result format (RegExpRouter), the value is looked up in the param stash `matchResult[1]`. Otherwise the stored value is used directly. Values that contain `%` are URI-decoded with `tryDecode`, so malformed escapes are left as they are instead of throwing.
- **Query**: `query()` / `queries()` delegate to `getQueryParam(s)` in `src/utils/url.ts`, which parse the URL string directly.
- **Headers**: `header(name)` or `header()` for all headers as a record.
- **Body**: `json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` all go through `#cachedBody`. The first read stores the promise in `bodyCache`. A later read of a *different* type is rebuilt from the cached value through `new Response(body)[key]()`, so the body can be read several times even though the underlying stream can only be consumed once. `json()` is implemented on top of the cached `text`.
- **`parseBody({ all, dot })`** (`src/utils/body.ts`) only parses `multipart/form-data` and `application/x-www-form-urlencoded` and returns `{}` for other content types. It stores its `FormData` promise in `bodyCache.formData` so later `formData()` calls reuse it. `all` gathers repeated keys into arrays, and `dot` turns `a.b` keys into nested objects.
- **Validated data**: `addValidatedData(target, data)` is called by the validator, and `valid(target)` reads it back with types inferred from the route's `Input`.
- `matchedRoutes` and `routePath` are deprecated in favour of the `hono/route` helper.

### `cloneRawRequest`

`cloneRawRequest(req)` returns `req.raw.clone()` if the body is unused. Otherwise it rebuilds a `Request` from the first cached body entry and copies method, headers and fetch options. It throws `HTTPException(500)` if the body was consumed directly through `req.raw` without going through the cache. This is the supported way to forward a request after validation.

## Tests

- `src/context.test.ts` covers header merging, `set-cookie` handling, status precedence, and the renderer and layout.
- `src/request.test.ts` covers param decoding, body caching across types, and `cloneRawRequest`.
