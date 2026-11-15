---
title: "The Hono Application"
---
## Overview

The application object is where routes are declared and where requests enter. It lives in `HonoBase` (`src/hono-base.ts`), a class that holds the registration API, the error and not-found handlers and the `fetch` entry point, but deliberately no router. The `Hono` class exported from `hono` extends it and only picks the router; the presets `hono/quick` and `hono/tiny` are the same subclass with another router. This page covers how routes get into the router and how apps are composed; what happens when a request arrives is traced in [[Request Lifecycle and Middleware Composition]], and how the router matches is in [[Routers]].

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124), [src/hono.ts:1-34](repo://src/hono.ts#L1-L34)

## Classes and presets

`HonoBase` declares `router!` without assigning it, so it cannot serve a request on its own. Each subclass sets `this.router` in its constructor after calling `super`.

Sources: [src/hono-base.ts:114-118](repo://src/hono-base.ts#L114-L118)

| Import | Class | Router |
| --- | --- | --- |
| `hono` | `Hono` | `options.router`, or `SmartRouter` over `RegExpRouter` then `TrieRouter` |
| `hono/quick` | `Hono` | `SmartRouter` over `LinearRouter` then `TrieRouter` |
| `hono/tiny` | `Hono` | `PatternRouter` |
| `hono/hono-base` | `HonoBase` | none: assign `router` yourself |

Sources: [src/hono.ts:13-34](repo://src/hono.ts#L13-L34), [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24), [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20)

The presets assign their router unconditionally, so a `router` passed in the options is replaced in `hono/quick` and `hono/tiny`; only the default `Hono` honours it. The reasons to pick each router are covered in [[Routers]].

Sources: [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/hono.ts:22-33](repo://src/hono.ts#L22-L33)

## Options

`HonoOptions` has three fields. The constructor copies every option except `strict` onto the instance with `Object.assign`, then decides which `getPath` to use.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | When `false`, a trailing slash is dropped from the request path, so `/hello/` matches `/hello` |
| `router` | set by the subclass | The `Router` that stores and matches routes |
| `getPath` | `getPath` from `utils/url` | Function that turns a `Request` into the path to route; receives `env` too |

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

The default `getPath` scans the URL from the first `/` after the scheme and host to the first `?` or `#`, without building a `URL` object. Only when it meets a `%` does it fall back to `indexOf` and decode the path with `tryDecodeURI`. With `strict: false` the constructor installs `getPathNoStrict`, which wraps the default and trims one trailing slash; a custom `getPath` is ignored in that case, because the ternary only consults `options.getPath` when `strict` is true. A custom `getPath` is how host-based routing works: return `'/' + host + path` and register routes such as `/www1.example.com/hello`.

Sources: [src/utils/url.ts:106-146](repo://src/utils/url.ts#L106-L146), [src/hono-base.ts:66-86](repo://src/hono-base.ts#L66-L86)

## Registering handlers

### Method helpers

The constructor creates one function per method in `METHODS` (`get`, `post`, `put`, `delete`, `options`, `patch`) plus `all`. When the first argument is a string it becomes the current path; otherwise it is a handler for the path of the previous call. Every handler is then added with `#addRoute`. The remembered path, `#path`, is why `app.get('/a', h).post(h2)` registers `POST /a`.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:14-22](repo://src/router.ts#L14-L22)

`app.on(method, path, ...handlers)` accepts a method or an array of methods and a path or an array of paths, and registers each handler for every combination, upper-casing the method. It is the way to register methods without a helper, such as `PURGE`, or the same handler on several paths.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

### Middleware with `use`

`app.use` registers handlers under the method `ALL`. With a string first argument that string is the path; without one the path is `*`. Middleware and handlers go into the same router: what distinguishes middleware at run time is only that it calls `next()`.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

### `#addRoute` and the routes list

Every registration ends in `#addRoute`. It upper-cases the method, prefixes the path with the app's `_basePath` through `mergePath`, builds a `RouterRoute` record `{ basePath, path, method, handler }`, passes `[handler, record]` to `router.add`, and appends the record to `app.routes`. The record travels with the handler into every match result, which is what lets `c.req.routePath` and the route helpers report the pattern that matched; `app.routes` is what `showRoutes` and [[Static Site Generation]] read.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62)

`mergePath` joins segments with exactly one slash, keeps a trailing slash on the base when the sub-path is `/`, and adds a leading slash if the base lacks one.

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

## Composing applications

### `basePath`

`basePath(path)` returns a clone whose `_basePath` is the merged path. `#clone` builds a new `Hono` with the same `router` and `getPath`, and copies the error handler, the not-found handler and the `routes` array by reference. A route added to the clone therefore lands in the same router as the original: `new Hono().basePath('/api')` is a complete app, and the original sees its routes too.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

### `route` for sub-apps

`route(path, subApp)` copies the sub-app's routes into this app. It takes a `basePath(path)` clone and re-adds each of `subApp.routes`, passing the record's own `basePath` so the original grouping is kept. The sub-app is never consulted at request time; only its handlers are reused.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

If the sub-app has its own `onError` handler, each of its handlers is wrapped in a one-element `compose([], subApp.errorHandler)` so errors thrown inside the sub-app reach that handler instead of the parent's. The wrapper is tagged with `COMPOSED_HANDLER` pointing to the original handler, so route introspection can still find it. The sub-app's `notFound` handler is not carried over: not-found is decided once per request by the app that received it.

Sources: [src/hono-base.ts:219-230](repo://src/hono-base.ts#L219-L230), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4)

Because `route` copies routes at call time, routes added to the sub-app after the `route` call are not seen by the parent. The return type merges the sub-app's schema under the prefix, which is how a split-up app keeps its types for the [[RPC Client]]; see [[Typed Routes and Schemas]].

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217)

### `mount` for other frameworks

`mount(path, handler, options)` registers an `ALL` route on `path/*` that calls any `(request, ...args) => Response` function. By default it strips the mount prefix from the URL path and calls the handler with `c.env` and the execution context (when one exists). If the foreign handler returns nothing, the chain continues with `next()`.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

| Option | Effect |
| --- | --- |
| a function, or `optionHandler` | Its return value (an array is spread) replaces `[env, executionCtx]` as the extra arguments |
| `replaceRequest: (req) => Request` | Builds the request passed to the foreign app |
| `replaceRequest: false` | Passes the original request unchanged |

Sources: [src/hono-base.ts:89-96](repo://src/hono-base.ts#L89-L96), [src/hono-base.ts:333-370](repo://src/hono-base.ts#L333-L370)

## Not-found and error handlers

`notFound(handler)` and `onError(handler)` replace the two defaults and return the app. The default not-found handler answers `404 Not Found` as text. The default error handler returns the response of any error that has a `getResponse` method (an `HTTPException`), and otherwise logs the error and answers `500 Internal Server Error`. When each is called is described in [[Request Lifecycle and Middleware Composition]].

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Entry points

| Method | Use |
| --- | --- |
| `fetch(request, env?, executionCtx?)` | The runtime entry: `export default app` exposes it to Workers, Bun and Deno |
| `request(input, init?, env?, executionCtx?)` | Tests: accepts a `Request`, a URL or a bare path resolved against `http://localhost` |
| `fire()` | Deprecated: adds a global `fetch` event listener for Service Worker style runtimes; use `fire` from `hono/service-worker` |

Sources: [src/hono-base.ts:479-542](repo://src/hono-base.ts#L479-L542)

`fetch` forwards to the private `#dispatch` with `request.method`, the env and the execution context. `request` wraps its input in a `Request` (merging `init` when a `Request` is given) and calls `fetch`, so a test runs exactly the code a runtime runs.

Sources: [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)
