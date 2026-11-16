---
title: "Route Introspection"
---
## Overview

Hono keeps two records that code can inspect. At registration, every route is appended to `app.routes`; at request time, the router's match result lists every route that applies to the current request. The dev helper (`hono/dev`) reads the first to print or return the route table, and the route helper (`hono/route`) reads the second to tell a handler which route it is running under.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/helper/dev/index.ts:27-37](repo://src/helper/dev/index.ts#L27-L37), [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34)

## What a route record holds

### Fields of RouterRoute

Each `RouterRoute` has the full `path` (base path already merged), the upper-case `method` (`ALL` for middleware), the `handler`, and the `basePath` it was registered under. The app passes `[handler, route]` to the router, so match results carry the same objects ([[The Hono App and Route Registration]]).

Sources: [src/types.ts:57-62](repo://src/types.ts#L57-L62), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

### Unwrapping wrapped handlers

`app.route()` wraps a sub-app's handlers when the sub-app has its own error handler, and stores the original function under the `__COMPOSED_HANDLER` key. `findTargetHandler` follows that key recursively to the original, and `isMiddleware` classifies a function as middleware when it declares more than one parameter, that is, when it takes `next`.

Sources: [src/hono-base.ts:219-229](repo://src/hono-base.ts#L219-L229), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

The same pair of functions is used by static site generation to keep only `GET` and `ALL` handlers that are not middleware ([[Static Site Generation]]).

Sources: [src/helper/ssg/utils.ts:61-71](repo://src/helper/ssg/utils.ts#L61-L71)

## The dev helper

| Function | Returns | Behavior |
| --- | --- | --- |
| `inspectRoutes(app)` | `{ path, method, name, isMiddleware }[]` | One entry per `app.routes` record, with the unwrapped handler's name, or `[middleware]` / `[handler]` for anonymous functions. |
| `showRoutes(app, { verbose, colorize })` | nothing; logs | Prints one line per method and path. Without `verbose` middleware are hidden; with it, each line is followed by the names of every handler registered there. |
| `getRouterName(app)` | string | Calls `app.router.match('GET', '/')` first, so a `SmartRouter` settles and reports its final name, such as `SmartRouter + RegExpRouter`. |

Sources: [src/helper/dev/index.ts:11-79](repo://src/helper/dev/index.ts#L11-L79)

`showRoutes` groups entries by `method-path`, pads the method column to the longest method, and colors methods green unless `colorize` is `false` or color is disabled. Without the option it consults `getColorEnabled`, which returns `false` when Deno's `noColor` is set or `NO_COLOR` is present in `process.env`.

Sources: [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74), [src/utils/color.ts:6-27](repo://src/utils/color.ts#L6-L27)

Because `getRouterName` performs a match, calling it before all routes are registered settles a `SmartRouter` early, and later registrations throw ([[Routers and Router Selection]]).

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-19](repo://src/router/smart-router/router.ts#L13-L19)

## The route helper

### Which routes matched

`matchedRoutes(c)` returns the `RouterRoute` of every handler that matched the request, in the order they run, by reading the match result through the `GET_MATCH_RESULT` symbol on `c.req`. `c.req.routeIndex` is the position of the handler currently running, which `compose` updates before each call ([[Request Lifecycle and Middleware Composition]]).

Sources: [src/helper/route/index.ts:1-34](repo://src/helper/route/index.ts#L1-L34), [src/request.ts:389-391](repo://src/request.ts#L389-L391), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

### Paths of a route

| Function | Returns |
| --- | --- |
| `routePath(c, index?)` | The registered path of the route, such as `/posts/:id`. |
| `baseRoutePath(c, index?)` | The registered base path, such as `/:sub` for a sub-app mounted with `app.route('/:sub', subApp)`. |
| `basePath(c, index?)` | The base path with its parameters filled in from the actual request path. |

Sources: [src/helper/route/index.ts:36-107](repo://src/helper/route/index.ts#L36-L107)

The `index` argument works like `Array.prototype.at`: it defaults to the current `routeIndex`, and a negative value counts from the end, so `routePath(c, -1)` inside a `*` middleware gives the path of the final handler. A missing entry yields an empty string.

Sources: [src/helper/route/index.ts:36-83](repo://src/helper/route/index.ts#L36-L83)

### How basePath fills parameters

`basePath` returns `baseRoutePath` unchanged when it has no `:` or `*`. Otherwise it splits the registered base path with `splitRoutingPath`, then walks the request path segment by segment: a literal segment advances by its length, a parameter or wildcard advances by the length of what its pattern (or `[^/]+`) matches next, and each step adds one for the slash. The request path cut at that length is the result. Results are cached per context and index in a `WeakMap`, so repeated calls in one request do no work.

Sources: [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141), [src/utils/url.ts:16-21](repo://src/utils/url.ts#L16-L21)

The older `c.req.matchedRoutes` and `c.req.routePath` getters return the same data and are marked deprecated in favour of these functions ([[HonoRequest]]).

Sources: [src/request.ts:393-442](repo://src/request.ts#L393-L442)
