---
type: architecture
title: "Hono App Core: HonoBase, Presets and Route Registration"
description: How the HonoBase class registers routes and middleware, composes sub-apps with route(), basePath() and mount(), handles errors and 404s, and how the Hono, tiny and quick presets pick a router.
tags: [hono-base, routing, presets, app-core, sub-apps]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Hono App Core

`src/hono-base.ts` defines `HonoBase` (exported as `Hono` inside the file, re-exported as `HonoBase`). It is deliberately "like an abstract class": it **has no router of its own**, and a subclass must assign `this.router` in its constructor. Everything user-facing (route registration, sub-app composition, error handling, `fetch`) lives here; matching strategy is injected. For the runtime flow after registration see [Request Lifecycle](request-lifecycle.md).

## Presets: choosing a router

Three thin subclasses supply the router and nothing else:

| Import | Class file | Router |
| --- | --- | --- |
| `hono` (default) | `src/hono.ts` | `SmartRouter([RegExpRouter, TrieRouter])`, unless `options.router` is given |
| `hono/quick` | `src/preset/quick.ts` | `SmartRouter([LinearRouter, TrieRouter])` |
| `hono/tiny` | `src/preset/tiny.ts` | `PatternRouter` |

Note that only the default `Hono` honours `options.router`; the `quick` and `tiny` presets always overwrite it. `HonoOptions` (`strict`, `router`, `getPath`) is the full constructor surface. The routers are described in [Router Contract and SmartRouter](../routing/router-contract-and-smart-router.md).

## Registering handlers

The constructor builds the HTTP-verb methods dynamically rather than as prototype methods:

- `get/post/put/delete/options/patch/all` are generated from `METHODS` plus `'all'`. `app.get('/path', h1, h2)` stores the path in the private `#path` field and adds each handler; `app.get(handler)` with no path reuses the **last path used** (this enables the chained `app.get('/x', a).post(b)` style).
- `app.on(method | method[], path | path[], ...handlers)` registers each combination and upper-cases methods.
- `app.use(...)` registers with the pseudo-method `ALL` (`METHOD_NAME_ALL`); with no path argument the path becomes `*`.

Every route funnels through the private `#addRoute(method, path, handler, baseRoutePath?)`, which merges `_basePath` with the path, builds a `RouterRoute` `{basePath, path, method, handler}`, calls `router.add(method, path, [handler, route])`, and appends the record to the public `routes` array. The router therefore stores the tuple `[handler, RouterRoute]`, which is how later code (e.g. `c.req.routePath`) can recover route metadata from a match result.

## Sub-apps: basePath, route, mount

- **`basePath(path)`** returns a *clone* (`#clone()`) sharing the same `router`, `routes` array, `getPath`, error handler and not-found handler, but with its own `_basePath`. Routes added through the clone land in the shared router with the prefix baked in.
- **`route(path, subApp)`** copies every entry of `subApp.routes` into the parent via `basePath(path)`. If the sub-app has a custom `onError`, each copied handler is wrapped so that errors thrown inside it are handled by the **sub-app's** error handler (via `compose([], app.errorHandler)`), and the original handler is kept under the `COMPOSED_HANDLER` symbol. If the sub-app still uses the default error handler, handlers are copied unwrapped and parent error handling applies.
- **`mount(path, fetchHandler, options)`** adds an `ALL` route on `path/*` that calls a foreign `(Request, ...args) => Response` application. By default it strips the mounted prefix from the URL (`replaceRequest`; `false` disables rewriting) and passes `[c.env, executionCtx]` (execution context is optional and read defensively). `optionHandler` can supply a custom argument list. If the mounted app returns a falsy value the chain continues with `next()`.

## Error and not-found handling

Defaults are module-level functions: the not-found handler returns `404 Not Found` text, and the default error handler returns `err.getResponse()` when the error exposes one (this is how `HTTPException` works) and otherwise logs and returns `500 Internal Server Error`. `onError(handler)` and `notFound(handler)` replace them per app instance (and are inherited by `basePath` clones at clone time). `#handleError` only calls the error handler for `Error` instances; **non-Error throwables are rethrown** out of `fetch`.

## Path normalisation

The constructor selects `getPath`: strict mode (default, `strict: true`) uses `options.getPath ?? getPath`; with `strict: false` it uses `getPathNoStrict`, which strips one trailing slash so `/hello/` and `/hello` are equivalent. Both live in `src/utils/url.ts`; `getPath` extracts the path from the raw URL without constructing a `URL`, and percent-decodes only when a `%` is present (re-escaping `%25` first so encoded percent signs survive). Note that a custom `getPath` is ignored when `strict: false`.

## Entry points

- `fetch(request, env?, executionCtx?)` is the universal entry and delegates to `#dispatch`.
- `request(input, init?, env?, ctx?)` is a test-friendly wrapper that accepts a string/URL and resolves relative inputs against `http://localhost`.
- `fire()` registers a service-worker `fetch` listener and answers with `event.respondWith(...)`.

## Related

- [Middleware Composition](middleware-composition.md) for how matched handlers are chained.
- [Context and HonoRequest](context-and-request.md) for what handlers receive.
- [Built-in Middleware Catalog](../features/middleware-catalog.md) for `HTTPException`-driven middleware.
