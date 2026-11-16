---
title: "The Hono Class"
---
## Overview

The `Hono` class is the object an application creates. Its behaviour is in `HonoBase` in `src/hono-base.ts`, which is written like an abstract class: it has no router of its own and gets one from its subclass. The `Hono` class in `src/hono.ts` supplies the default router, and the presets in `src/preset` supply others. This page covers the constructor options, the router choices, and the fields an app keeps. Route registration is on [[Registering Routes]], and the request path is on [[Request Dispatch]].

Sources: [src/hono-base.ts:114-118](repo://src/hono-base.ts#L114-L118), [src/hono.ts:16-33](repo://src/hono.ts#L16-L33)

## Constructor options

`HonoBase` takes an options object with three keys. `strict` defaults to `true`, `router` takes any object that implements the `Router` interface, and `getPath` takes a function that turns a `Request` into the path used for matching.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | Keeps a trailing slash significant; `false` uses `getPathNoStrict` |
| `router` | `SmartRouter` on `RegExpRouter` and `TrieRouter` | The router that stores routes and matches them |
| `getPath` | `getPath` from `src/utils/url.ts` | Maps the request to the path that is matched |

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172), [src/hono.ts:27-33](repo://src/hono.ts#L27-L33)

The constructor copies every option except `strict` onto the instance with `Object.assign`. That is how `router` and `getPath` reach the instance. The `strict` value is read once, to choose between `getPath` and `getPathNoStrict`, and is not stored.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172)

When `strict` is `false`, `getPathNoStrict` removes one trailing slash from a path longer than `/`, so `/hello/` and `/hello` match the same route.

Sources: [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

## The default router

`Hono` sets `this.router` after `super(options)` returns. If the caller passed a `router` option, that value is used; otherwise a `SmartRouter` is built over a `RegExpRouter` and a `TrieRouter`. The `SmartRouter` chooses between these two on the first match, as [[Router Interface and SmartRouter]] describes.

Sources: [src/hono.ts:27-33](repo://src/hono.ts#L27-L33)

## The presets

A preset is a subclass of `HonoBase` that sets a different router and nothing else. The `tiny` preset uses `PatternRouter` alone, and the `quick` preset uses a `SmartRouter` over `LinearRouter` and `TrieRouter`. Both are exported as subpaths, so an application chooses one by its import. Their routers are described on [[Linear and Pattern Routers]].

Sources: [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [package.json:59-67](repo://package.json#L59-L67)

## Base paths and clones

`basePath(path)` returns a new app whose base path is the merged path, and whose routes will be stored under that base. The new app is built by `#clone`, which shares the router, the `getPath` function, the routes list, the error handler and the not-found handler with the original. Because the router is shared, a route added to the clone is visible to the original app's matching.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

## Fields an app keeps

An app holds five pieces of state. `routes` is a public array of every route record. `errorHandler` and `#notFoundHandler` hold the handlers used when a request fails or matches nothing. `_basePath` holds the prefix that `#addRoute` merges into each route path. `#path` holds the path that a later `app.get` call without a path string uses.

Sources: [src/hono-base.ts:119-124](repo://src/hono-base.ts#L119-L124), [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188)

The `fire` method is marked `@deprecated`. It adds a global `fetch` listener, and the comment points to `fire` in `hono/service-worker` instead.

Sources: [src/hono-base.ts:519-536](repo://src/hono-base.ts#L519-L536)
