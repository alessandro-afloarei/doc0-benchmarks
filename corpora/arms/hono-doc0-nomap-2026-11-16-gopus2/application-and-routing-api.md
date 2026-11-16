---
title: "Application and Routing API"
---
## Overview

A Hono application is an object that collects routes and hands them to a router. The `Hono` class exported from `hono` extends `HonoBase` and only adds a default router; everything an application does when routes are registered lives in `HonoBase`: the method helpers, `use`, `on`, `route`, `basePath`, `mount`, `onError` and `notFound`. This page follows a route from the call that registers it to the router's `add`. What happens when a request arrives is the subject of [[Request Lifecycle and Middleware]], and how the router stores routes is in [[Router Interface and SmartRouter]].

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34), [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124)

`HonoBase` declares a `router` but never sets it; the comment on the field calls the class "like an abstract class" that a subclass completes in its constructor. `Hono` sets `options.router` when one is given, and otherwise a `SmartRouter` over a `RegExpRouter` and a `TrieRouter`. The presets `hono/tiny` and `hono/quick` are other subclasses that set other routers.

Sources: [src/hono-base.ts:114-118](repo://src/hono-base.ts#L114-L118), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20)

## Registering routes

### Method helpers and the current path

The constructor creates `get`, `post`, `put`, `delete`, `options`, `patch` and `all` in a loop over `METHODS` plus `all`. Each helper takes either a path followed by handlers, or handlers alone. A string first argument becomes the app's private `#path`; a handler first argument is registered on the path already stored there. So `app.get('/a', h1).post(h2)` registers `h2` as `POST /a`: the app remembers the last path it was given.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:9-17](repo://src/router.ts#L9-L17)

`on(method, path, ...handlers)` accepts a method or an array of methods, and a path or an array of paths, and registers every handler for every combination with the method upper-cased. It is the way to register methods outside the built-in list, such as `PURGE`.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

### Middleware with use

`use` registers handlers under the method `ALL`. With a string first argument it uses that path; without one it sets the current path to `*` and registers every argument as middleware. Because the current path is shared, a method helper called later without a path also inherits `*`.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/router.ts:6-12](repo://src/router.ts#L6-L12)

Middleware and handlers are stored the same way: there is no separate middleware list. The router returns both in registration order, and [[Request Lifecycle and Middleware]] describes how the chain is run.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

### addRoute and the routes list

Every registration ends in `#addRoute`. It upper-cases the method, prefixes the path with the app's `_basePath` through `mergePath`, builds a `RouterRoute` record of `basePath`, `path`, `method` and `handler`, passes `[handler, route]` to `router.add`, and appends the record to `app.routes`.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62)

```ts
#addRoute(method: string, path: string, handler: H, baseRoutePath?: string): void {
  method = method.toUpperCase()
  path = mergePath(this._basePath, path)
  const r: RouterRoute = {
    basePath:
      baseRoutePath !== undefined ? mergePath(this._basePath, baseRoutePath) : this._basePath,
    path,
    method,
    handler,
  }
  this.router.add(method, path, [handler, r])
  this.routes.push(r)
}
```

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62)

`mergePath` joins a base and a sub path with exactly one slash between them, and treats a sub path of `/` as nothing: `mergePath('/api', '/')` is `/api`, while `mergePath('/api/', '/')` keeps the trailing slash.

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

## Grouping applications

### basePath

`basePath(path)` returns a clone, not the app itself. `#clone` makes a new `HonoBase` that shares the router, `getPath`, the error and not-found handlers, and the same `routes` array, then sets its `_basePath` to the merged path. Routes added through the clone land in the original app's router with the prefix applied.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

### route

`route(path, subApp)` copies a sub-application's routes into this one. It takes a `basePath(path)` clone and re-adds each of the sub-app's `routes` through it, passing the sub-route's `basePath` so the record keeps where the route was grouped. The sub-app's own router is never consulted afterwards: the routes are registered again in the parent's router.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

A sub-app that set its own `onError` keeps it. When its `errorHandler` is not the default, each handler is wrapped in `compose([], app.errorHandler)` so an error thrown inside goes to the sub-app's handler. The wrapper stores the original handler under the `COMPOSED_HANDLER` key, which `findTargetHandler` follows back to the original when routes are inspected.

Sources: [src/hono-base.ts:219-229](repo://src/hono-base.ts#L219-L229), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

```ts
const users = new Hono()
users.get('/:id', (c) => c.text(`user ${c.req.param('id')}`))

const app = new Hono()
app.route('/users', users) // GET /users/:id
```

Sources: [src/hono-base.ts:190-217](repo://src/hono-base.ts#L190-L217)

`notFound`, unlike `onError`, is not carried over by `route`: the parent's not-found handler is the one the `Context` receives for every request.

Sources: [src/hono-base.ts:219-231](repo://src/hono-base.ts#L219-L231), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

### mount

`mount(path, applicationHandler, options)` attaches a handler written for another framework, any function from `Request` to `Response`. It registers one `ALL` middleware on `path/*`. That middleware calls the foreign handler with a rewritten request and extra arguments; when the foreign handler returns a response it is used, otherwise the chain continues with `next()`.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

| Option | Effect |
| --- | --- |
| a function, or `optionHandler` | Its result, wrapped in an array if needed, replaces the extra arguments |
| no option handler | Extra arguments are `c.env` and `c.executionCtx` (undefined when the runtime has none) |
| `replaceRequest` function | Builds the request the foreign app receives |
| `replaceRequest: false` | Passes the original request unchanged |
| no `replaceRequest` | Strips the merged mount prefix from the path, `/` if nothing remains |

Sources: [src/hono-base.ts:333-370](repo://src/hono-base.ts#L333-L370)

## Application options

`HonoOptions` holds three settings. `router` replaces the default router. `strict`, true by default, keeps `/hello` and `/hello/` as different paths; set to false, the app uses `getPathNoStrict`, which drops one trailing slash before matching. `getPath` replaces the function that extracts the routing path from the request, for example to route on the `Host` header.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173), [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

The constructor copies every option except `strict` onto the instance, and a custom `getPath` only applies while `strict` is true: `strict: false` always selects `getPathNoStrict`.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

The default `getPath` scans the URL from the first slash after the scheme and host up to `?` or `#`. Only when it meets a `%` does it fall back to `indexOf` and decode the path with `tryDecodeURI`; the comment explains that undecoded paths are the common case it optimises for.

Sources: [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)

## Inspecting routes

### Route helper

`hono/route` reads the match result of the current request. `matchedRoutes(c)` returns the `RouterRoute` record of every handler and middleware that matched. `routePath(c)` returns the registered path of the handler running now, using `c.req.routeIndex`, which `compose` updates as the chain advances; an index argument picks another entry, and negative indexes count from the end.

Sources: [src/helper/route/index.ts:32-59](repo://src/helper/route/index.ts#L32-L59), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

`baseRoutePath(c)` returns the registered base path, and `basePath(c)` returns the part of the actual request path that base path matched, replacing parameters and wildcards with what the request held. It caches its result per context and index in a `WeakMap`.

Sources: [src/helper/route/index.ts:82-141](repo://src/helper/route/index.ts#L82-L141)

### Dev helper

`hono/dev` reads `app.routes`. `inspectRoutes` returns each route's path, method, handler name and whether it is middleware; a function declaring more than one parameter counts as middleware because it takes `next`. `showRoutes` prints them to the console grouped by method and path, hiding middleware unless `verbose` is set. `getRouterName` triggers a match on `GET /` so a `SmartRouter` settles on its router, then returns that router's name.

Sources: [src/helper/dev/index.ts:23-79](repo://src/helper/dev/index.ts#L23-L79), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)
