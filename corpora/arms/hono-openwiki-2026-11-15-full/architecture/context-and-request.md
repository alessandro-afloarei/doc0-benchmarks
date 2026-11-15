---
type: architecture
title: Context and HonoRequest
description: How Hono's per-request Context object builds responses, carries variables, env bindings and execution context, and how HonoRequest exposes params, query, headers, cached body parsing and validated data.
tags: [context, request, response, core, body-parsing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Context and HonoRequest

Every request dispatched by `HonoBase` (see [Request Lifecycle](request-lifecycle.md)) gets exactly one `Context` instance (`src/context.ts`). Handlers and middleware receive it as `c`. It owns the response being built, the request wrapper (`c.req`, a `HonoRequest` from `src/request.ts`), per-request variables, environment bindings and the runtime's execution context.

## Context construction

`HonoBase#dispatch` creates the context with `new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`. The constructor only stores these values; the `HonoRequest` wrapper is created lazily on first access of `c.req` (`this.#req ??= new HonoRequest(rawRequest, path, matchResult)`), so handlers that never touch `c.req` pay nothing for it.

| Member | Behavior |
| --- | --- |
| `c.env` | Runtime bindings passed as the second argument of `app.fetch(request, env, ctx)` (Cloudflare bindings, Lambda event data, etc.). Defaults to `{}`. |
| `c.executionCtx` | Getter that throws `This context has no ExecutionContext` when the runtime did not supply one. |
| `c.event` | Getter returning the `FetchEvent` only when the execution context has `respondWith` (Service Worker style); otherwise throws. |
| `c.error` | Set by `compose()` when a handler throws and the app error handler ran, so outer middleware can inspect it after `await next()`. |
| `c.finalized` | `true` once a response has been assigned to `c.res`. Used by `compose()` and dispatch to detect handlers that never produced a response. |

## Building responses

All response helpers funnel through a private `#newResponse(data, arg, headers)`:

- Headers start from the current `c.res` headers if a response already exists, otherwise from headers prepared by earlier `c.header()` calls.
- If `arg` is a `ResponseInit`/`Response` with `headers`, those are merged; `set-cookie` values are appended rather than overwritten.
- An explicit `headers` record is applied; array values replace the header with multiple appended values.
- Status comes from a numeric `arg`, then `arg.status`, then the value set by `c.status()`.

Helpers on top of it:

- `c.body(data, status?, headers?)` – raw body.
- `c.text()` – sets `text/plain; charset=UTF-8`. It has a fast path: if no headers were prepared, no status was set, no extra arguments were passed and the context is not finalized, it returns `new Response(text)` directly.
- `c.json()` – `JSON.stringify` plus `application/json`.
- `c.html()` – sets `text/html; charset=UTF-8`; when passed a promise (e.g. async JSX), it resolves HTML escaped callbacks (`resolveCallback` from `src/utils/html.ts`) before building the response and therefore returns a `Promise<Response>`.
- `c.redirect(location, status = 302)` – sets `Location`, percent-encoding it with `encodeURI` only when it contains characters outside `\x00-\xFF`.
- `c.notFound()` – invokes the app's not-found handler (or an empty `Response` if the context was created without one).
- `c.render()` / `c.setRenderer()` / `c.setLayout()` / `c.getLayout()` – a pluggable renderer used by the [jsx-renderer middleware](../jsx/server-jsx.md). The default renderer is `c.html(content)`.

The typed return values (`TypedResponse<T, Status, Format>`) are what let the [RPC client](../integrations/rpc-client.md) infer response bodies and status codes; see [Type System](../concepts/type-system.md).

### Header and response mutation rules

- `c.header(name, value, { append })` writes into prepared headers before a response exists, or into the existing `c.res` headers afterwards. If the context is already finalized, it first clones `c.res` so headers of an immutable upstream response can be modified. Passing `undefined` deletes the header.
- Assigning `c.res = newResponse` after a response already exists copies headers from the old response onto the new one (except `content-type`), and re-appends every `set-cookie` value individually. This is how middleware that set headers before `await next()` (CORS, secure-headers, etc.) keep them when a later handler returns a fresh `Response`. Assignment always sets `finalized = true`.

## Variables

`c.set(key, value)` / `c.get(key)` store request-scoped values in a lazily created `Map`. `c.var` returns a read-only snapshot object (`Object.fromEntries`) of the map. Keys are typed through the app's `Env['Variables']` generic and the globally augmentable `ContextVariableMap` interface. Middleware such as `jwt` (`jwtPayload`), `request-id` and `context-storage` publish data this way.

## HonoRequest

`HonoRequest` wraps the raw `Request` (still available as `c.req.raw`) with routing-aware accessors.

### Path parameters

The router returns either `[[handler, paramIndexMap][], paramStash]` or `[[handler, params][]]` (see [Routers](../routing/routers.md)). `c.req.param(key)` reads the entry for the *current* handler, chosen by `routeIndex`, which `compose()` updates before invoking each handler. If the match result has a param stash, the per-handler map holds indexes into it; otherwise it holds values directly. Values are URI-decoded only when they contain `%`, using a decoder that returns the original string on malformed input. `c.req.param()` without a key returns all decoded params for the current handler.

### Query and headers

- `query(key?)` / `queries(key?)` parse directly from `c.req.url` using `getQueryParam`/`getQueryParams` in `src/utils/url.ts`; `queries` returns all values for repeated keys.
- `header(name)` delegates to `raw.headers.get`; `header()` returns all headers as a plain record (lower-cased keys).

### Body parsing and caching

A `Request` body can be read only once, so `HonoRequest` keeps a `bodyCache` keyed by format (`json`, `text`, `arrayBuffer`, `blob`, `formData`):

1. If the requested format is cached, the cached promise is returned.
2. Otherwise, if *any* format was already read, the cached value is converted by wrapping it in a new `Response` and calling the requested reader (JSON is re-stringified first).
3. Otherwise the raw request reader is called and its promise cached.

`c.req.json()` is implemented as `text()` + `JSON.parse`, so its cache entry is `text`. `bytes()` is built from `arrayBuffer`. This is what lets multiple validators, or a validator plus the handler, read the same body.

`c.req.parseBody({ all, dot })` (`src/utils/body.ts`) handles only `multipart/form-data` and `application/x-www-form-urlencoded` (by media type, ignoring parameters) and returns `{}` for other content types. It reads the body as an `ArrayBuffer`, converts it to `FormData`, and stores that promise in `bodyCache.formData` so a later `c.req.formData()` reuses it. `all: true` collects repeated fields into arrays (default keeps the last value); `dot: true` turns `a.b` keys into nested objects.

### Validated data

`addValidatedData(target, data)` and `valid(target)` store and retrieve per-target results written by the [validator middleware](../concepts/validation.md). The type of `valid()` comes from the route's `Input` generic.

### Route introspection

`matchedRoutes` and `routePath` (both deprecated in favor of `hono/route` helpers) read route metadata from the match result; the match result is also exposed via the `GET_MATCH_RESULT` symbol key for those helpers.

### cloneRawRequest

`cloneRawRequest(c.req)` returns `raw.clone()` if the body is unused. If the body was consumed through `HonoRequest` methods, it rebuilds a new `Request` from the first cached body format plus the original request's metadata. If the body was consumed via `c.req.raw` directly (so nothing is cached) it throws an `HTTPException(500)`.

## Tests

- `src/context.test.ts` – response helpers, header merging, `set-cookie` handling, renderer/layout.
- `src/request.test.ts` – params decoding, query parsing, body cache conversions, `cloneRawRequest`.
- `src/utils/body.test.ts` – `parseBody` `all`/`dot` semantics.
