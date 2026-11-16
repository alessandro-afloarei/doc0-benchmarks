---
title: "Route Introspection"
---
## Overview

Hono keeps two records that tools can read. Every app has `app.routes`, the list of `RouterRoute` entries (`method`, `path`, `basePath`, `handler`) pushed by each registration ([[Hono Application]]). Every request has the router's match result, the handlers that matched it, stored on `HonoRequest` ([[HonoRequest]]). The dev helper, `hono/dev`, reads the first to list an app's routes; the route helper, `hono/route`, reads the second to tell a handler which route it is running under.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62), [src/request.ts:389-391](repo://src/request.ts#L389-L391)

## Listing an app's routes

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`. The handler is first unwrapped with `findTargetHandler`, which follows the `COMPOSED_HANDLER` property that `app.route()` sets when it wraps a sub-app's handlers ([[Request Dispatch and Middleware]]), so the original function is reported.

Sources: [src/helper/dev/index.ts:16-37](repo://src/helper/dev/index.ts#L16-L37), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

A handler counts as middleware when it declares more than one parameter, that is, when it takes `next`. Its name is the function's `name`, or `[middleware]` or `[handler]` for anonymous functions. Naming middleware functions, as the built-in ones do (`async function cors(c, next)`), makes the listing readable.

Sources: [src/utils/handler.ts:8-8](repo://src/utils/handler.ts#L8-L8), [src/helper/dev/index.ts:23-25](repo://src/helper/dev/index.ts#L23-L25), [src/middleware/cors/index.ts:96-96](repo://src/middleware/cors/index.ts#L96-L96)

`showRoutes(app, { verbose?, colorize? })` prints the routes with `console.log`, one line per method and path with the method padded to a column and coloured green when colour is on. Middleware entries are hidden unless `verbose` is set; with `verbose`, the name of every handler on the path is printed under it. `colorize` defaults to `getColorEnabled()`, which honours `NO_COLOR` ([[Logging, Timing and Request IDs]]).

Sources: [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74), [src/utils/color.ts:14-27](repo://src/utils/color.ts#L14-L27)

```ts
import { showRoutes } from 'hono/dev'

showRoutes(app, { verbose: true })
// GET   /posts
//         [handler]
// POST  /posts
//         [middleware]
//         [handler]
```

Sources: [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74)

`getRouterName(app)` returns `app.router.name`. It calls `app.router.match('GET', '/')` first so that a `SmartRouter` picks its router and reports a name such as `SmartRouter + RegExpRouter` ([[Router Interface and Presets]]). Because that match builds the router, no routes can be added afterwards.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-61](repo://src/router/smart-router/router.ts#L13-L61)

## The route a handler runs under

The route helper's functions take the Context and read `c.req[GET_MATCH_RESULT]`, a getter keyed by a private symbol that returns the match result. `c.req.routeIndex`, which `compose` sets before each handler, says which entry of that result is running.

Sources: [src/helper/route/index.ts:1-34](repo://src/helper/route/index.ts#L1-L34), [src/request/constants.ts:1-1](repo://src/request/constants.ts#L1-L1), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

| Function | Returns |
| --- | --- |
| `matchedRoutes(c)` | Every matched `RouterRoute`, middleware included, in run order |
| `routePath(c, index?)` | The registered path of the running route, such as `/posts/:id` |
| `baseRoutePath(c, index?)` | The base path it was registered under, such as `/:sub` |
| `basePath(c, index?)` | That base path with its parameters filled in from the request, such as `/blog` |

Sources: [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141)

`index` works like `Array.prototype.at`: by default it is `c.req.routeIndex`, and a negative value counts from the end, so `routePath(c, -1)` is the path of the last matched route. A missing entry gives `''`.

Sources: [src/helper/route/index.ts:58-83](repo://src/helper/route/index.ts#L58-L83), [src/helper/route/index.ts:85-91](repo://src/helper/route/index.ts#L85-L91)

```ts
import { matchedRoutes, routePath } from 'hono/route'

app.use('*', async function logger(c, next) {
  await next()
  matchedRoutes(c).forEach(({ method, path }, i) => {
    console.log(method, path, i === c.req.routeIndex ? '<- respond from here' : '')
  })
})

app.get('/posts/:id', (c) => c.text(routePath(c))) // '/posts/:id'
```

Sources: [src/helper/route/index.ts:6-34](repo://src/helper/route/index.ts#L6-L34), [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59)

When a middleware reads `routeIndex` after `await next()`, as in this example, the index points at the last handler `compose` ran, which is the one that produced the response.

Sources: [src/compose.ts:32-51](repo://src/compose.ts#L32-L51)

## Resolving basePath

`basePath(c)` answers the question "under which concrete prefix was this sub-app mounted for this request?". When the registered base path has no `:` or `*`, it is returned as is. Otherwise the function walks the base path's segments with `getPattern`, the same pattern parser `TrieRouter` uses ([[TrieRouter]]). For each parameter it measures how much of the request path the parameter's pattern (or `[^/]+`) matches, for each literal it adds the literal's length, and it returns that many characters of `c.req.path`.

Sources: [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141), [src/utils/url.ts:51-78](repo://src/utils/url.ts#L51-L78)

Results are cached per Context and index in a `WeakMap`, so calling `basePath` several times in one request costs one computation.

Sources: [src/helper/route/index.ts:106-113](repo://src/helper/route/index.ts#L106-L113), [src/helper/route/index.ts:137-140](repo://src/helper/route/index.ts#L137-L140)

`c.req.matchedRoutes` and `c.req.routePath` return the same data as the first two functions, but are deprecated in favour of `hono/route`.

Sources: [src/request.ts:393-442](repo://src/request.ts#L393-L442)
