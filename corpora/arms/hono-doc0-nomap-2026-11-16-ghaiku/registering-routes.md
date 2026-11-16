---
title: "Registering Routes"
---
## Overview

Every route an application serves enters the app through one private method, `#addRoute`. The public helpers `get`, `post`, `on`, `use`, `route`, `basePath` and `mount` all end there, or in a call that ends there. This page follows how each helper turns its arguments into a stored route. The matching that later uses these routes starts at [[Router Interface and SmartRouter]], and the shape of a path is on [[Route Path Patterns]].

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## Method helpers

The constructor creates one helper per method name. The list is the six methods in `METHODS` plus `all`, so `app.get`, `app.post`, `app.put`, `app.delete`, `app.options`, `app.patch` and `app.all` share one implementation.

Sources: [src/hono-base.ts:127-141](repo://src/hono-base.ts#L127-L141), [src/router.ts:17-17](repo://src/router.ts#L17-L17)

The helper takes either a path followed by handlers, or handlers only. A string argument sets the stored path `#path`, and the helper then adds each handler under that path. The stored path stays set, so a later call with no path string registers its handlers under the same path. A call that passes handlers only uses the stored path.

Sources: [src/hono-base.ts:130-139](repo://src/hono-base.ts#L130-L139)

The method name goes to `#addRoute` as given. `#addRoute` upper-cases it, so `app.get` stores `GET`, and `app.all` stores `ALL`, which the router later treats as a match for every method.

Sources: [src/hono-base.ts:385-387](repo://src/hono-base.ts#L385-L387), [src/router.ts:9-9](repo://src/router.ts#L9-L9)

## The on and use helpers

`on(method, path, ...handlers)` accepts a single method or a list, and a single path or a list. For each path it sets `#path`, then adds each handler once for each method, so `app.on(['GET', 'POST'], ['/a', '/b'], h)` makes four routes.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

`use` is the registration for middleware. When its first argument is a string, that string becomes the stored path and the rest are handlers. When it is not a string, the path is `*` and the first argument is put at the front of the handler list. Each handler is added under the `ALL` method.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## What #addRoute stores

`#addRoute` merges the app's base path into the route path with `mergePath`, then builds a `RouterRoute` record. The record holds `basePath`, `path`, `method` and `handler`. The router receives the handler together with the record as one value, and the record is pushed onto `routes`.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

`mergePath` joins two paths with one slash between them. A second path of `/` adds nothing, so its comment shows `mergePath('/api', '/')` returning `/api`, while `mergePath('/api/', '/')` returns `/api/`.

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

## Grouping sub-apps with route

`route(path, app)` copies every route of another app into this one. It first calls `basePath(path)` to get a clone that shares the router and the routes list. Then, for each route of the sub-app, it adds the route to the clone, so the route is stored in the parent's router with the parent's base path merged in.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

When the sub-app has its own error handler, `route` does not reuse the handler. It wraps the original handler in a function that runs the sub-app's error handler through `compose`, and it marks the wrapper with `COMPOSED_HANDLER` so that [[Middleware Composition]] can find the original handler.

Sources: [src/hono-base.ts:221-227](repo://src/hono-base.ts#L221-L227), [src/utils/handler.ts:9-15](repo://src/utils/handler.ts#L9-L15)

## Mounting another application

`mount(path, applicationHandler, options)` forwards requests under `path` to a function that takes a `Request` and returns a `Response`, which is how an app built with another framework is run inside Hono. The route is registered for every method under `path/*`.

Sources: [src/hono-base.ts:296-306](repo://src/hono-base.ts#L296-L306), [src/hono-base.ts:381-381](repo://src/hono-base.ts#L381-L381)

By default `mount` rewrites the request URL so that the mount prefix is removed from the pathname. A `replaceRequest` option replaces that step, and `false` passes the original request through unchanged. If the mounted function returns nothing, the middleware calls `next()` and the chain continues.

Sources: [src/hono-base.ts:341-370](repo://src/hono-base.ts#L341-L370), [src/hono-base.ts:372-380](repo://src/hono-base.ts#L372-L380)

The arguments after the request come from `optionHandler` when it is given. Otherwise they are the environment bindings and the execution context, so the mounted function receives the same bindings the Hono app received.

Sources: [src/hono-base.ts:350-361](repo://src/hono-base.ts#L350-L361)
