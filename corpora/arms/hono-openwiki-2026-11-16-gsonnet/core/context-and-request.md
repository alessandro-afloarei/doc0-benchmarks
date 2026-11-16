---
type: component
title: Context and HonoRequest
description: How Hono's per-request Context (response builders, header/status staging, variables, res setter merging, renderer/layout, env/executionCtx) and HonoRequest (params, query, headers, cached body parsing, validated data, matched routes, cloneRawRequest) behave.
tags: [context, request, response, body-cache, core]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Context and HonoRequest

Both classes are created per request by `#dispatch` (see [Request Lifecycle](../architecture/request-lifecycle.md)) and are the only objects handlers see: `(c: Context, next) => Response | void`.

## Context (`src/context.ts`)

`Context<E, P, I>` wraps the raw `Request` plus the router's match result and per-request state. Generic parameters: `E` (Env with `Bindings` / `Variables`), `P` (path string, used to type `c.req.param()`), `I` (validated input types).

### Lazy construction
- `c.req` builds a `HonoRequest` on first access from the raw request, path and match result.
- `c.res` getter lazily creates an empty `Response` using the prepared headers; nothing is allocated unless used.
- `c.var` is built from the variable `Map` only when read; `c.set/c.get` lazily create the `Map`.

### Response building
All builders (`c.text`, `c.json`, `c.html`, `c.body`, `c.newResponse`, `c.redirect`, `c.notFound`) go through the private `#newResponse(data, arg, headers)`:
- It starts from the *current* response headers (`this.#res`) if one exists, else the `#preparedHeaders` set via `c.header()` before any response existed, and layers in headers from the `arg` init and the `headers` record (a `set-cookie` in an init is appended rather than overwritten; array-valued headers are appended).
- Status resolves as: numeric arg → `arg.status` → value from `c.status()`.
- `c.text` has a fast path: with no prepared headers, no status, no args and not finalized it returns a plain `new Response(text)`.
- `c.json` stringifies and defaults `Content-Type: application/json`; `c.html` defaults `text/html; charset=UTF-8` and, when given a Promise or escaped-string object, resolves JSX callbacks (`resolveCallback`) before building the response, which is how async JSX and `Suspense` content integrates (see [Hono JSX](../jsx/jsx-system.md)).
- `c.redirect(location, status = 302)` sets `Location` (percent-encoding it only if it contains characters above `\xFF`) and returns a null-body response.
- `c.notFound()` delegates to the app's not-found handler (falling back to an empty response if none was passed).

### `c.res` setter and header merging
Assigning `c.res = response` sets `finalized = true`. If a response already existed, the new one is cloned and the old response's headers are copied onto it — except `content-type` (the new one wins), and `set-cookie`, which is re-appended from the old response's `getSetCookie()` after clearing the new one. This is what lets post-`await next()` middleware (e.g. `secure-headers`, `cors`) add headers to a response produced downstream, and explains why `c.header()` after finalization rebuilds the response object so headers stay mutable.

### Other state
- `c.finalized`, `c.error` (set by `compose` when a handler throws; middleware read it after `await next()`).
- `c.env`, `c.executionCtx` (throws `This context has no ExecutionContext` if absent), `c.event` (throws if the context isn't a FetchEvent — service worker mode).
- Renderer/layout: `c.setRenderer(fn)`, `c.render(...)` (defaults to `c.html`), `c.setLayout/getLayout`. `ContextRenderer` is a module-augmentation hook (see `jsx-renderer` in [Built-in Middleware](../middleware/middleware.md)).
- `ContextVariableMap` is an interface middleware augment to type `c.get/c.set/c.var` keys.

## HonoRequest (`src/request.ts`)

Public fields: `raw` (the platform `Request`), `path`, `routeIndex`, `bodyCache`.

### Params
`c.req.param(key?)` reads `matchResult[0][routeIndex][1]` — the param map of the handler currently executing (compose updates `routeIndex`). Router results come in two shapes (see [Router Implementations](../routing/routers.md)): *indexed* (`[ [handler, paramIndexMap][], paramStash ]` — values are looked up in the stash by index) and *direct* (`[ [handler, params][] ]`). `#getParamValue` handles both, and values containing `%` are decoded with a try/catch `decodeURIComponent` so malformed escapes do not throw.

### Query / headers
`query()`/`queries()` parse from `url` via `getQueryParam(s)` in `utils/url.ts`; `header(name)` is a case-insensitive `Headers.get` that maps `null` to `undefined`, and `header()` with no name returns a plain object with lower-cased keys.

### Body access and caching
`json()`, `text()`, `arrayBuffer()`, `bytes()`, `blob()`, `formData()` share `#cachedBody(key)`:
1. if `bodyCache[key]` exists, return it;
2. else if any other key is cached (the body stream was already consumed), re-derive from that cached value (`json` is re-stringified, then `new Response(body)[key]()`);
3. else call `raw[key]()` and cache the promise.

`json()` is implemented as `JSON.parse(await text())`. `parseBody({ all, dot })` (`src/utils/body.ts`) only parses `multipart/form-data` and `application/x-www-form-urlencoded` (returns `{}` for other types), builds a `FormData` via `bufferToFormData`, caches it in `bodyCache.formData`, and converts it into an object where repeated keys become arrays only if `all: true`, and `a.b` keys become nested objects only if `dot: true`.

Consequence: multiple middleware (validator, body-limit, handler) can all read the body without hitting "body already used" as long as they go through `HonoRequest`, not `req.raw`.

### Validated data
`addValidatedData(target, data)` and `valid(target)` store/retrieve per-target (`json`, `form`, `query`, `param`, `header`, `cookie`) results written by `validator()`. See [Validator and Typed RPC Client](validation-and-client.md).

### Route introspection
`matchedRoutes` lists the `RouterRoute` records of every matched handler (middleware included); `routePath` is the path of `matchedRoutes[routeIndex]`. `hono/route` helpers (`matchedRoutes`, `routePath`, `baseRoutePath`, `basePath`) wrap these. The match result is also exposed through the `GET_MATCH_RESULT` symbol (`src/request/constants.ts`), which `helper/route` reads.

### `cloneRawRequest(req)`
If the raw body is unused, returns `req.raw.clone()`. If the body was consumed through `HonoRequest` methods, it rebuilds a `Request` from the cached body (plus method, headers, mode, signal, etc.). If the body was consumed directly via `req.raw` and nothing is cached, it throws `HTTPException(500)` with an explanatory message. Typical use: forwarding a request after `validator` consumed it.

## Types

`src/types.ts` carries the large generic machinery: `Env`, `Handler`, `MiddlewareHandler`, `H`, `HandlerInterface` (overloads for 1–N handlers that accumulate `Schema` and input types), `ValidationTargets`, `TypedResponse`, `MergePath`, `ParamKeys` and related template-literal types. These feed the `hc` client — see the validation page.
