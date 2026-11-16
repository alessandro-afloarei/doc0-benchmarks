---
type: concept
title: Route Registration, Grouping and Mounting
description: How Hono records routes - the method helpers (get, post, put, delete, options, patch, all), on() for multiple methods and paths, use() for middleware, the shared #addRoute path that writes each route to both the router and the routes table, base paths and sub-applications through route(), basePath() and mount(), optional parameters, and how strict mode affects matching.
tags: [routing, route, basepath, mount, middleware, registration, sub-app, strict]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Route Registration, Grouping and Mounting

<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Every route in a Hono application is recorded through one private method, `#addRoute`, in `src/hono-base.ts`. The public registration helpers (`get`, `post`, `use`, and the others) are thin wrappers that normalize their arguments and then call it. Grouping features (`route`, `basePath`, `mount`) build on the same method by changing the base path or by reusing another application's route table. This page describes those mechanics; the matching step that consumes the recorded routes is covered in [Router Selection and Matching](/openwiki/routing/router-selection.md).

## Method Helpers

The constructor installs one helper per HTTP method. The list is `get`, `post`, `put`, `delete`, `options`, `patch`, and `all` (which registers the `ALL` method). Each helper accepts two forms:

- `app.get(path, ...handlers)` sets the current path and registers every handler under it.
- `app.get(...handlers)` registers handlers under the path most recently set on the instance. This form exists so that a path can be shared by several chained calls; it is an internal detail that the implementation handles through a private path variable.

Every helper returns the instance, so calls can be chained. The router types in `src/types.ts` track the path and the route's input and output types through the chain, which is why `app.get('/posts/:id', ...)` followed by `app.post(...)` can be typed independently.

`app.on(method | method[], path | path[], ...handlers)` registers the same handlers for several methods and several paths in one call. Methods are upper-cased, and each path is combined with each method. `app.use(path?, ...middleware)` registers middleware with the `ALL` method. Without an explicit path the path is `*`, so the middleware runs for every request.

## The Single Registration Path

`#addRoute(method, path, handler, baseRoutePath?)` does four things:

1. Upper-cases the method.
2. Merges the instance's base path with the given path through `mergePath`, so a route declared on a sub-application lands at its full path.
3. Creates a `RouterRoute` record with `method`, the merged `path`, the `handler`, and a `basePath`. The `basePath` is the instance's base path, unless the caller passes an explicit `baseRoutePath` (used when copying routes from a sub-application).
4. Calls `this.router.add(method, path, [handler, record])` and appends the record to `this.routes`.

<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The router receives the handler together with the record, so matching can return both, and the `routes` array keeps the registration order for introspection (see `inspectRoutes` in [Helper Modules](/openwiki/helpers/helper-modules.md)). Routes cannot be added after the router has finished building its matcher; the router then throws `Can not add a route since the matcher is already built.` (see [Router Selection and Matching](/openwiki/routing/router-selection.md)).

## Base Paths and `basePath()`

`basePath(path)` returns a new instance that shares the parent's router and route table, with `_basePath` set to `mergePath(parentBasePath, path)`. Routes registered on the returned instance are added to the same router, so they behave exactly as if they had been registered on the parent with the full path. `#clone()` implements this: the new instance receives the same `router`, the same `getPath` strategy, the same `routes` array, and the same error and not-found handlers.

`mergePath` joins path segments with single slashes. A root segment (`/`) contributes nothing, and a trailing slash on the base does not duplicate the separator. Optional parameters such as `/animals/:type?` are expanded by `checkOptionalParameter` into two routes, one without the parameter and one with it.

## Grouping with `route()`

`app.route(path, subApp)` copies the sub-application's routes into the parent under `path`:

- The method first creates `subApp = this.basePath(path)`, so every copied route is registered with the correct prefix.
- For each route `r` in `subApp`'s table, the handler is reused as is when the sub-application uses the default error handler. If the sub-application set its own `onError`, each copied handler is wrapped so that the sub-application's error handler runs inside the parent's chain, and the composed function is marked with `COMPOSED_HANDLER` so the original handler can still be recovered.
- The copy is registered with `#addRoute(r.method, r.path, handler, r.basePath)`, which keeps the sub-application's own base path on the record.
- `route` returns the parent instance.

Because the copy happens at registration time, routes added to the sub-application after `route` has been called are not included. Calling `route` after the sub-application is complete is the expected pattern.

## Mounting Another Fetch Handler with `mount()`

`app.mount(path, applicationHandler, options?)` adds a catch-all route, `ALL` on `mergePath(path, '*')`, whose handler forwards the request to a function with the signature `(request, ...args) => Response | Promise<Response>`. Hono and non-Hono applications can both be mounted this way.

- By default the forwarded request has its pathname rewritten to remove the mount prefix. `replaceRequest` can replace that behavior or be disabled with `replaceRequest: false`.
- The arguments after the request come from `optionHandler(c)` when provided, otherwise `[c.env, c.executionCtx]`.
- If the mounted handler returns a falsy value, the middleware calls `next()`, so routes registered after the mount can still answer.

Use `route` when the mounted code is a Hono application that shares types and middleware, and `mount` when the code is an arbitrary fetch-style handler.

## Strict Mode and Matching Rules

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The `strict` option (default `true`) decides whether a trailing slash is significant. In strict mode `/posts` and `/posts/` are different paths. With `strict: false` the request path has one trailing slash removed before matching, so both forms match the same route. This is implemented by choosing `getPathNoStrict` in the constructor, as described in [Request Lifecycle](/openwiki/architecture/request-lifecycle.md).

## Invariants

- A record in `routes` and the corresponding router entry are created together, so introspection and matching agree.
- A sub-application's routes are copied, not referenced, by `route`; later changes to the sub-application do not propagate.

## Extension Seams

<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Custom registration helpers can be written with `app.on` or by calling the public `app.get`/`app.use` family from a wrapper. Custom path handling belongs in the `getPath` option, and custom matching belongs in a `Router` implementation passed through the `router` option (see [Router Selection and Matching](/openwiki/routing/router-selection.md)).
