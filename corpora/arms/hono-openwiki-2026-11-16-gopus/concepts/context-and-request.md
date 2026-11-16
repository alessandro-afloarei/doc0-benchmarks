---
type: concept
title: Context and HonoRequest
description: The per-request Context object (response helpers, header and status staging, c.res merging and the finalized flag, variables, env bindings, execution context, renderer and layout) and HonoRequest (params, query, headers, cached body reading, parseBody, validated data, matched routes).
tags: [context, request, response, body-parsing, variables, api]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Context and HonoRequest

`HonoBase.#dispatch` creates one `Context` (`src/context.ts`) per request. Every middleware and handler receives that same instance as `c`. `c.req` is a lazily created `HonoRequest` (`src/request.ts`) that wraps the raw `Request` together with the router's match result.

## Context

### Construction and environment

`new Context(request, { path, matchResult, env, executionCtx, notFoundHandler })`:

- `c.env` holds the runtime bindings passed to `app.fetch(req, env, ctx)`, such as Cloudflare KV, secrets, or the adapter's env object. It is typed through `Env['Bindings']`.
- `c.executionCtx` returns the `ExecutionContext` (`waitUntil`, `passThroughOnException`, `props`). It **throws** `This context has no ExecutionContext` when none was supplied. Code that has to work on every runtime should wrap the call in `try`; `mount()` does exactly that (see [Request lifecycle](../architecture/request-lifecycle.md)).
- `c.event` returns the Service Worker `FetchEvent`. It throws unless the execution context has `respondWith`.
- `c.req` is created on first access. Contexts that never touch the request skip that allocation.

### Response building

| Method | Behavior |
| --- | --- |
| `c.body(data, status?, headers?)` / `c.newResponse` | Raw response with any `Data` (string, ArrayBuffer, Uint8Array, ReadableStream, null). |
| `c.text(text, ...)` | `text/plain; charset=UTF-8`. Fast path: if no headers or status were staged, nothing else was passed and the context is not finalized, it returns a plain `new Response(text)`. |
| `c.json(obj, ...)` | Serializes with `JSON.stringify`. Content type is `application/json`. |
| `c.html(html, ...)` | `text/html; charset=UTF-8`. If given a Promise or `HtmlEscapedString` with callbacks, it resolves them first (`resolveCallback`) and returns `Promise<Response>`. |
| `c.redirect(location, status = 302)` | Sets `Location`, encoding non-Latin-1 characters with `encodeURI`. Returns an empty-body response. |
| `c.notFound()` | Calls the app's not-found handler. |
| `c.render(...)` | Calls the renderer set with `c.setRenderer`, defaulting to `c.html`. `jsx-renderer` and similar middleware set this. `c.setLayout` and `c.getLayout` store a layout component. |

All of these build the response through `#newResponse`, which merges headers in this order:

1. Headers already on `c.res` (if one exists), or else headers staged with `c.header()`.
2. `init.headers` from a `ResponseInit` or `Response` argument. `Set-Cookie` is appended, while other headers are set.
3. The `headers` record argument. Array values become multiple appended values.

The status comes from the argument, else from `init.status`, else from the status staged with `c.status()`.

The response methods are also typed: they return `Response & TypedResponse<T, Status, Format>`. This is how handler return values feed the [RPC client types](types-and-rpc-client.md).

### `c.header()`, `c.status()` and `c.res`

- `c.header(name, value?, { append? })` writes to the existing `c.res` headers, or to a staged `Headers` object if no response exists yet. A value of `undefined` deletes the header. After finalization, the response is first cloned so its headers become mutable.
- `c.status(code)` stages a status for the next response that is built.
- The `c.res` getter creates an empty `Response` carrying the staged headers if none exists yet.
- The `c.res` setter marks the context `finalized = true`. **If a response already exists**, the new response is cloned. Every header from the old response except `content-type` is copied onto it, and `set-cookie` values are re-appended individually. Middleware headers set before `await next()` (CORS, secure headers, cookies) therefore survive when a handler's response replaces `c.res`.

`finalized` is the signal that `compose()` and `#dispatch` check to decide whether a response exists. `c.error` holds the error that `compose()` caught, so after-`next()` middleware can inspect it.

### Variables

`c.set(key, value)` and `c.get(key)` store per-request values in a `Map` that is created lazily. `c.var` is a read-only object snapshot (`Object.fromEntries`) of the same map. Types come from `Env['Variables']` and from module augmentation of `ContextVariableMap`, which is how middleware such as `jwt`, `requestId` and `contextStorage` declare the keys they add.

## HonoRequest

### Params and routing metadata

- `c.req.param(key)` / `c.req.param()` read from `matchResult[0][routeIndex]`. `compose()` updates `routeIndex`, so each handler sees the params of **its own** route pattern. Values are resolved through the param stash for RegExpRouter results, or used directly for other routers (see [Routers](../architecture/routers.md)). Values containing `%` are decoded with `decodeURIComponent` inside a `try` (`tryDecode`).
- `c.req.matchedRoutes` lists the `RouterRoute` of every handler that matched. `c.req.routePath` is the path pattern of the currently running handler.
- `c.req.path` is the path the app extracted with `getPath`. `url` and `method` come from the raw request.

### Query and headers

- `query(key?)` and `queries(key?)` parse straight from the URL string (`getQueryParam` / `getQueryParams` in `src/utils/url.ts`). `queries` returns every value for a repeated key.
- `header(name)` is a case-insensitive lookup. `header()` returns a plain record of every header.

### Body reading and caching

`text()`, `json()`, `arrayBuffer()`, `bytes()`, `blob()` and `formData()` all go through `#cachedBody`:

1. If this exact body type has already been read, the cached promise is returned.
2. If a *different* type was read, the cached value is converted by wrapping it in `new Response(...)` and calling the requested reader. `json` is re-stringified first.
3. Otherwise the raw body is read and the promise is stored in `bodyCache`.

`json()` is implemented as `text()` followed by `JSON.parse`, so a single text read serves both. This cache is what lets the validator, middleware and handlers each read the body without hitting "body already used" errors. Calling `c.req.raw.json()` directly bypasses the cache.

`parseBody({ all?, dot? })` (`src/utils/body.ts`) only parses `multipart/form-data` and `application/x-www-form-urlencoded`. Every other media type returns `{}`. It reads the body through the cached `arrayBuffer()` and also caches the decoded `formData`.

- Keys ending in `[]`, or every key when `all: true`, collect repeated values into arrays.
- `dot: true` expands `a.b.c` keys into nested objects. Keys that contain a `__proto__.` segment are ignored, to prevent prototype pollution.

`cloneRawRequest(req)` is exported from `hono/request` for user code, such as code that forwards a request after it has been validated. If the raw body has not been read, it returns `raw.clone()`. Otherwise it rebuilds a `Request` from the cached body. If the raw body was consumed outside the cache, it throws `HTTPException(500)`.

### Validated data

`c.req.addValidatedData(target, data)` is called by `validator()`. `c.req.valid(target)` returns that data, typed from the handler's `Input` (see [Validation](validation.md)).

## Tests

- `src/context.test.ts` covers header merging, `c.res` replacement, status, and the renderer.
- `src/request.test.ts` covers params with `routeIndex`, query parsing, body caching across readers, and `cloneRawRequest`.
- `src/utils/body.test.ts` covers the `all` and `dot` options of `parseBody`.
