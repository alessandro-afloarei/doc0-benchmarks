---
title: "App and Routing"
---
## Overview

Every registration method on `Hono` ends in one private method, `#addRoute`, which records the route and hands the handler to the router. This page follows a call such as `app.get('/items', h)` from the method helper to that record. Matching a request against the records is in [[Routers]], and running the handlers is in [[Request Dispatch]].

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## Method helpers and on

The constructor creates one function per method: `get`, `post`, `put`, `delete`, `options`, `patch` and `all`. A string first argument sets the current path for later calls; any other first argument is a handler and is added under that path together with every handler after it.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

`app.on(method, path, ...handlers)` accepts arrays for both arguments. It loops over each path and each method, upper-cases the method, and adds every handler, so one call can register several methods and paths.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

## Middleware with use

`app.use(...handlers)` registers its handlers under the method `ALL` and the path `*`. When the first argument is a string it becomes the path, and the handlers after it are registered under that path. A middleware therefore runs for every method that reaches the matched path, not only for one verb.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## How a route is stored

`#addRoute` uppercases the method and joins the instance's base path with the route path using `mergePath`. It builds a `RouterRoute` with `basePath`, `path`, `method` and `handler`, passes `[handler, route]` to `router.add`, and pushes the record onto `routes`. The router therefore keeps the handler and its route metadata together.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62)

`mergePath` avoids doubled or missing slashes: a base of `/api` and a path of `/items` give `/api/items`, and a path of `/` adds nothing to the base.

Sources: [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

## Base paths

`basePath(path)` returns a copy of the app with `_basePath` merged with the new path. The copy is made by `#clone`, which passes the same router and the same `routes` array, so routes added to the copy land in the original app's router.

Sources: [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253), [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184)

## Grouping with route

`route(path, app)` copies each route of another app into this one under `path`. It reads `app.routes` when the call runs, so a route added to the other app later is not included. When the other app has its own error handler, each copied handler is wrapped in `compose` with that handler and tagged with `COMPOSED_HANDLER`, so the group keeps its error behaviour.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4)

## Mounting other apps

`mount(path, applicationHandler, options)` registers one `ALL` route at `path/*`. The handler calls `applicationHandler` with a request rewritten to strip the mount prefix from the pathname; by default the extra arguments are the bindings and the execution context. If the mounted handler returns no `Response`, the handler calls `next()`, so the chain goes on to the rest of the app.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

```ts
app.mount('/itty-router', ittyRouter.handle)
```

Sources: [src/hono-base.ts:315-316](repo://src/hono-base.ts#L315-L316)

The request rewrite uses the length of the merged mount path, so the mounted application sees the path without its prefix. Passing `replaceRequest: false` in the options keeps the original request object.

Sources: [src/hono-base.ts:362-370](repo://src/hono-base.ts#L362-L370), [src/hono-base.ts:341-345](repo://src/hono-base.ts#L341-L345)

## Path options

The `strict` option, which defaults to `true`, decides how the request path is read. In strict mode the app uses `getPath` (or a custom `getPath` passed in the options), so a trailing slash is part of the path. Otherwise the app uses `getPathNoStrict`, which removes one trailing slash, so `/hello/` and `/hello` match the same route.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172), [src/utils/url.ts:141-147](repo://src/utils/url.ts#L141-L147)

`getPath` reads the pathname from the request URL and decodes percent-encoded characters, stopping at `?` or `#`. The path it returns is what the router matches.

Sources: [src/utils/url.ts:106-139](repo://src/utils/url.ts#L106-L139)

## Error and not-found handlers

`onError` and `notFound` store one handler each on the instance and return the app, so they chain. `#clone` copies both at the time `basePath()` is called, so a handler set on the original app before `basePath()` applies to the returned app, and one set afterwards does not.

Sources: [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184)
