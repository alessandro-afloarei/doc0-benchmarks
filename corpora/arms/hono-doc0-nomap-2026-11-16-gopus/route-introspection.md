---
title: "Route Introspection"
---
## Overview

Every route an app registers is kept twice: in the router, for matching, and as a `RouterRoute` record in `app.routes`, with its method, path, base path and handler, as [[Application and Routing]] describes. The router hands the record back with every match, so code running in a request can ask which routes matched and which one it belongs to. `hono/route` answers those questions for the current request; `hono/dev` lists an app's whole table for debugging and tooling.

Sources: [src/types.ts:57-62](repo://src/types.ts#L57-L62), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

| Function | Module | Returns |
| --- | --- | --- |
| `matchedRoutes(c)` | `hono/route` | Every route record that matched this request |
| `routePath(c, index?)` | `hono/route` | The registered path of the current or given route |
| `baseRoutePath(c, index?)` | `hono/route` | The registered base path of that route |
| `basePath(c, index?)` | `hono/route` | The base path with parameters filled in from the request |
| `inspectRoutes(app)` | `hono/dev` | All routes with handler names and a middleware flag |
| `showRoutes(app, options?)` | `hono/dev` | Prints the route table |
| `getRouterName(app)` | `hono/dev` | The name of the router in use |

Sources: [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79)

## Routes of the current request

### matchedRoutes

`matchedRoutes(c)` reads the router's result from `c.req` through the `GET_MATCH_RESULT` symbol and returns the route record of each entry, in the order the handlers run. Combined with `c.req.routeIndex`, which `compose` sets to the handler now running, a logging middleware can show which handler responded:

Sources: [src/helper/route/index.ts:12-34](repo://src/helper/route/index.ts#L12-L34), [src/request.ts:389-391](repo://src/request.ts#L389-L391), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

```ts
app.use('*', async function logger(c, next) {
  await next()
  matchedRoutes(c).forEach(({ handler, method, path }, i) => {
    const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
    console.log(
      method,
      ' ',
      path,
      ' '.repeat(Math.max(10 - path.length, 0)),
      name,
      i === c.req.routeIndex ? '<- respond from here' : ''
    )
  })
})
```

Sources: [src/helper/route/index.ts:12-34](repo://src/helper/route/index.ts#L12-L34), [src/request.ts:389-391](repo://src/request.ts#L389-L391), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

`c.req.matchedRoutes` and `c.req.routePath` on [[HonoRequest]] give the same information and are kept for compatibility; `matchedRoutes` on `HonoRequest` is marked deprecated in favour of this helper.

Sources: [src/request.ts:392-442](repo://src/request.ts#L392-L442)

### routePath and baseRoutePath

`routePath(c)` returns the `path` of the route whose handler is running, such as `/posts/:id`. The optional index works like `Array.prototype.at`: `routePath(c, -1)` called from a `*` middleware returns the path of the last matched route, typically the final handler.

Sources: [src/helper/route/index.ts:36-59](repo://src/helper/route/index.ts#L36-L59)

`baseRoutePath(c)` returns the route's `basePath`, the prefix it was mounted under with `basePath()` or `route()`, still as a pattern: for a sub-app mounted with `app.route('/:sub', subApp)`, it is `/:sub`.

Sources: [src/helper/route/index.ts:61-83](repo://src/helper/route/index.ts#L61-L83)

### basePath

`basePath(c)` returns that prefix as it appears in this request's path, `/requested-sub-app-path` in the same example. A prefix without `:` or `*` is returned as it is. Otherwise the prefix is split into segments and walked alongside the request path: a literal segment advances by its length, a parameter or wildcard by the length of the text its pattern matches there. The result is the request path up to that point, cached per Context and index.

Sources: [src/helper/route/index.ts:85-141](repo://src/helper/route/index.ts#L85-L141)

This is useful in sub-apps that build links relative to where they were mounted without knowing the mount path.

Sources: [src/helper/route/index.ts:92-104](repo://src/helper/route/index.ts#L92-L104)

## The whole route table

### inspectRoutes

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`. Handlers wrapped by `route()` for a sub-app's error handler are unwrapped first with `findTargetHandler`, which follows the `COMPOSED_HANDLER` property to the original function. A handler counts as middleware when it declares more than one parameter, `(c, next)`; its name is the function's name, or `[middleware]` or `[handler]` for anonymous functions.

Sources: [src/helper/dev/index.ts:16-37](repo://src/helper/dev/index.ts#L16-L37), [src/utils/handler.ts:6-15](repo://src/utils/handler.ts#L6-L15)

### showRoutes

`showRoutes(app)` prints one line per method and path with the method in green, columns aligned. By default middleware entries are left out; `verbose: true` includes them and prints the names of all handlers registered for each method and path under it. `colorize` overrides the colour detection, which follows `NO_COLOR` as described on [[Logging and Timing Middleware]].

Sources: [src/helper/dev/index.ts:11-14](repo://src/helper/dev/index.ts#L11-L14), [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74), [src/utils/color.ts:14-27](repo://src/utils/color.ts#L14-L27)

```text
GET   /
GET   /posts/:id
POST  /posts
```

Sources: [src/helper/dev/index.ts:63-64](repo://src/helper/dev/index.ts#L63-L64)

### getRouterName

`getRouterName(app)` calls `app.router.match('GET', '/')` and returns `app.router.name`. The match is needed because a `SmartRouter` only picks its router, and takes the name `SmartRouter + RegExpRouter` or `SmartRouter + TrieRouter`, on its first match, as [[Routers]] explains. The call builds the matcher, so routes cannot be added to the app afterwards.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-61](repo://src/router/smart-router/router.ts#L13-L61)
