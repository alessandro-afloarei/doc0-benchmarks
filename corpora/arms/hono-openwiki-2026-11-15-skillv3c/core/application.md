---
type: architecture
title: Application Object and Request Dispatch
description: How the Hono application class (HonoBase) registers routes and middleware, composes sub-apps with basePath/route/mount, and dispatches a Request through fetch, request, and fire, including HEAD handling and the single-handler fast path.
tags: [core, hono-base, routing, dispatch, fetch, mount, basepath]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Application Object and Request Dispatch

The application object is defined in `src/hono-base.ts` as class `Hono` (exported as `HonoBase`). It owns route registration, sub-application composition, and the per-request dispatch loop. It is deliberately router-less: concrete classes assign `this.router` in their constructor.

- `src/hono.ts` — the default `Hono` (`import { Hono } from 'hono'`) uses `options.router` if given, otherwise `new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] })`.
- `src/preset/quick.ts` — `hono/quick` uses `SmartRouter` over `LinearRouter` + `TrieRouter`.
- `src/preset/tiny.ts` — `hono/tiny` uses `PatternRouter` only.

Router selection and semantics are covered in [Router Contract and SmartRouter](../routing/router-interface.md).

## Constructor options (`HonoOptions`)

| Option | Effect |
| --- | --- |
| `router` | Router instance storing `[handler, RouterRoute]` tuples (honored by `hono` default class; presets ignore it). |
| `strict` | Default `true`. When `false`, the app uses `getPathNoStrict`, which strips one trailing `/` so `/a/` and `/a` match the same route. |
| `getPath` | Custom `(request, { env }) => string` path extractor, e.g. to route on the `Host` header. It is only used when `strict` is not `false`. |

All options except `strict` are copied onto the instance with `Object.assign`.

## Registering routes

The constructor installs methods dynamically:

- **`app.get/post/put/delete/options/patch/all(path?, ...handlers)`** — if the first argument is a string it becomes the "current path"; otherwise it is a handler registered at the *previously set* path. This is what makes chaining like `app.get('/a', h1).post(h2)` register `POST /a`.
- **`app.on(method | method[], path | path[], ...handlers)`** — registers each handler for every method × path combination, upper-casing methods (custom methods such as `PURGE` are allowed).
- **`app.use(path?, ...middleware)`** — registers handlers under method `ALL`. Without a path it uses `*`.

Every registration goes through the private `#addRoute(method, path, handler, baseRoutePath?)`, which upper-cases the method, prefixes the path with the app's `_basePath` via `mergePath`, adds `[handler, routeRecord]` to the router, and appends the `RouterRoute` record (`{ basePath, path, method, handler }`) to `app.routes`. Middleware and handlers share one list — the router returns both, in registration order, and [Middleware Composition](middleware-composition.md) runs them as a chain.

Because routes are added straight to the router, routers that build a matcher lazily (RegExpRouter) throw if you add routes after the first request has been matched.

## Composition: `basePath`, `route`, `mount`

- **`basePath(path)`** returns a *clone* (`#clone`) sharing the same router, `getPath`, error handler, not-found handler, and **the same `routes` array**, with `_basePath` set to `mergePath(current, path)`. Routes registered on the clone are therefore visible to the original app.
- **`route(path, subApp)`** grafts another Hono instance: it creates `this.basePath(path)` and re-adds every `subApp.routes` entry under it, preserving the sub-route's own `basePath`. If the sub-app has a custom `onError`, each grafted handler is wrapped in `compose([], subApp.errorHandler)` so that errors thrown inside the sub-app's handlers are handled by the sub-app's handler; the original handler is kept on the wrapper under the `COMPOSED_HANDLER` symbol (used by `hono/dev` to inspect routes). The sub-app's `notFound` handler is **not** carried over — not-found is always resolved by the top-level app. Routes added to the sub-app after `route()` was called are not included.
- **`mount(path, applicationHandler, options?)`** embeds any fetch-style handler (another framework, or another Hono's `fetch`). It registers an `ALL` route at `path/*` whose handler:
  1. rewrites the request URL to strip the mount prefix (using `this.getPath` and the merged base path; empty becomes `/`), unless `replaceRequest` is provided (`false` passes the original request);
  2. calls `applicationHandler(request, ...extraArgs)` where `extraArgs` default to `[c.env, c.executionCtx]` (the latter omitted when unavailable) or the result of `optionHandler(c)`;
  3. returns the result, or calls `next()` if it returned nothing.

## Handlers for errors and missing routes

`app.onError(handler)` and `app.notFound(handler)` replace the defaults. The default not-found handler returns `404 Not Found` as text; the default error handler returns `err.getResponse()` for objects exposing `getResponse` (such as `HTTPException`) and otherwise logs and returns a 500 `Internal Server Error`. Details are in [Error Handling and HTTPException](error-handling.md).

## Dispatch

`#dispatch(request, executionCtx, env, method)` is the heart of request handling:

1. **HEAD** requests are dispatched recursively as `GET`, and the resulting response is re-wrapped with a `null` body (status and headers kept).
2. The path is extracted with `this.getPath(request, { env })`. The default `getPath` scans the URL once, stopping at `?` or `#`; if it encounters `%` it falls back to `indexOf` and decodes the path with `tryDecodeURI`, deliberately keeping `%25` encoded so a decoded `%` cannot be re-interpreted.
3. `this.router.match(method, path)` returns the matching handlers (middleware included) — see the router `Result` shape.
4. A new `Context` is created with the request, path, match result, env, execution context and the not-found handler (see [Context](context.md)).
5. **Fast path:** when exactly one handler matched, it is called directly without `compose`. Its `next` sets `c.res` from the not-found handler. A sync return value is returned as-is (or the not-found response if `undefined`); a promise is resolved to its value, or to `c.res` if the context was finalized, or else the not-found response. Thrown/rejected `Error`s go to the error handler.
6. **General path:** handlers are combined with `compose(matchResult[0], errorHandler, notFoundHandler)`. After the chain completes, if the context is **not finalized** dispatch throws `Context is not finalized. Did you forget to return a Response object or \`await next()\`?`, which is then routed to the error handler (default: 500). Non-`Error` throwables are re-thrown rather than handled.

## Entry points

- **`app.fetch(request, env?, executionCtx?)`** — the Web-Standard entrypoint used by Cloudflare Workers, Deno, Bun and all [Runtime Adapters](../adapters/runtime-adapters.md). It dispatches with `request.method`.
- **`app.request(input, init?, env?, executionCtx?)`** — testing convenience. A `Request` is used directly (cloned with `init` if given); a string or URL that is not absolute `http(s)://` is resolved against `http://localhost`.
- **`app.fire()`** — legacy Service Worker style: registers a global `fetch` event listener that calls `event.respondWith(dispatch(...))`. The `hono/service-worker` adapter's `fire` is the more capable replacement.

## Key tests

`src/hono.test.ts` covers chaining semantics, `basePath`/`route`/`mount` behavior, strict mode, HEAD handling, custom `getPath`, and the "Context is not finalized" error.
