---
title: "Registering Routes"
---
## Overview

Registration turns each `app.get`, `app.post`, `app.on`, `app.use` or `app.route` call into one entry in the router and one entry in `app.routes`. The methods are created in the `Hono` constructor, so each one shares the same storage path. [[Request Dispatch]] reads these entries back when a request arrives, and [[Router Selection]] explains how the router stores them.

Sources: [src/hono-base.ts:124-141](repo://src/hono-base.ts#L124-L141)

## Method and path handlers

The constructor defines `get`, `post`, `put`, `delete`, `options`, `patch` and `all`. Each one accepts either a path followed by handlers, or handlers alone. A handler-only call reuses the path left by the last string argument, so several calls can share a path.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

`on` registers one or more methods against one or more paths, and `use` registers middleware. `use` with a path argument stores the handlers under that path; `use` without one stores them under `*`, and always stores them under the `ALL` method so every request reaches them.

Sources: [src/hono-base.ts:143-168](repo://src/hono-base.ts#L143-L168), [src/router.ts:9-13](repo://src/router.ts#L9-L13)

## Storing a route

Each call ends in `#addRoute`. It upper-cases the method, joins the path with the instance's base path through `mergePath`, and builds a `RouterRoute` record with the method, the merged path, the handler and the base path. The record goes into the router with the handler, and into `routes` for later reads such as `matchedRoutes`.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/utils/url.ts:158-160](repo://src/utils/url.ts#L158-L160)

The router receives the handler and its record together as one value, so `match` returns both. Handlers in a middleware chain come back in the order they were added, which is why the order of `use` and route calls decides which runs first.

Sources: [src/hono-base.ts:395](repo://src/hono-base.ts#L395), [src/router/reg-exp-router/router.ts:132-140](repo://src/router/reg-exp-router/router.ts#L132-L140)

## Base paths

`basePath` returns a clone of the app with a longer base path, and the clone shares the router, the `routes` array, the error handler and the not-found handler. Routes added to the clone are stored in the shared router with the base path merged in, so the parent app sees them.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

## Grouping with route and mount

`route` copies another app's routes into this one under a path. For each route it adds a new entry on a base-path clone. When the sub-app has its own error handler, the copied handler is wrapped in that handler's `compose` call, so the sub-app's error handler sees errors from its routes.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

```ts
const app = new Hono()
const app2 = new Hono()

app2.get("/user", (c) => c.text("user"))
app.route("/api", app2) // GET /api/user
```

Sources: [src/hono-base.ts:201-205](repo://src/hono-base.ts#L201-L205)

`mount` takes a function that answers a `Request`, such as another framework's handler. It registers one `ALL` middleware on `path/*`. The middleware sends a rewritten request to the function, with the path prefix removed, and calls `next` only when the function returns nothing.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

## Pages

- [[Request Dispatch]] reads these entries when a request arrives.
- [[Router Selection]] and [[RegExp Router]] explain how the router stores and matches them.
- [[Context]] explains what a handler returns.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)
