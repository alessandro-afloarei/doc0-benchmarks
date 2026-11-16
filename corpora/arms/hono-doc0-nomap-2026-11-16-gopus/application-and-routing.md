---
title: "Application and Routing"
---
## Overview

An application is an instance of `Hono`. It holds the route table, the router that matches requests against it, and the error and not-found handlers. Everything about building the table lives in `HonoBase` in `src/hono-base.ts`; the exported `Hono` class only adds a default router. This page covers how routes get into the table. How a request then travels through it is on [[Request Lifecycle and Error Handling]], and how the router finds a match is on [[Routers]].

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124), [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

## HonoBase and Hono

`HonoBase` is written like an abstract class: its comment says it "does not have a router" and must be inherited by a class that sets `router` in its constructor. `Hono` from `hono` does that, choosing `options.router` when given and otherwise a `SmartRouter` over `RegExpRouter` and `TrieRouter`.

Sources: [src/hono-base.ts:113-118](repo://src/hono-base.ts#L113-L118), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

Two presets subclass `HonoBase` the same way with a fixed router. `hono/tiny` uses `PatternRouter` alone; `hono/quick` uses `SmartRouter` over `LinearRouter` and `TrieRouter`. Neither reads `options.router`. [[Routers]] says what each router trades.

Sources: [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20), [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24)

The three type parameters, `E` for the environment, `S` for the schema and `BasePath`, are inferred as routes are added; [[Typed Routes and Schemas]] explains them.

Sources: [src/hono.ts:16-20](repo://src/hono.ts#L16-L20)

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | When `false`, a trailing slash is dropped from the request path, so `/hello/` and `/hello` match the same route. |
| `router` | `SmartRouter` over `RegExpRouter` and `TrieRouter` | The `Router` that stores and matches routes. |
| `getPath` | `getPath` from `utils/url` | Computes the path the router matches, from the `Request` and the bindings. |

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

The constructor copies every option except `strict` onto the instance, then picks the path function with `(strict ?? true) ? (options.getPath ?? getPath) : getPathNoStrict`. With `strict: false` a custom `getPath` is therefore ignored. `getPathNoStrict` calls `getPath` and slices off one trailing `/` when the path is longer than one character.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172), [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

The default `getPath` scans the URL from the first `/` after the scheme up to `?` or `#`. Only when it meets a `%` does it fall back to `indexOf` and decode the path with `tryDecodeURI`; the comment says the slower branch is acceptable because paths without percent encoding are the common case.

Sources: [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)

A custom `getPath` can route on more than the path. The option's documentation shows one that prefixes the `host` header, so `app.get('/www1.example.com/hello', ...)` matches only that host:

Sources: [src/hono-base.ts:66-86](repo://src/hono-base.ts#L66-L86)

```ts
const app = new Hono({
  getPath: (req) =>
    '/' + req.headers.get('host') + req.url.replace(/^https?:\/\/[^/]+(\/[^?]*)/, '$1'),
})
```

Sources: [src/hono-base.ts:66-86](repo://src/hono-base.ts#L66-L86)

## Registering routes

### Method handlers

The constructor creates one method per entry of `METHODS` (`get`, `post`, `put`, `delete`, `options`, `patch`) plus `all`. Each accepts either a path followed by handlers, or handlers alone. A path argument is stored in the private `#path`; a call without one reuses the last stored path, so calls can be chained:

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:8-17](repo://src/router.ts#L8-L17)

```ts
app
  .get('/endpoint', (c) => c.text('GET /endpoint'))
  .post((c) => c.text('POST /endpoint'))
```

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:8-17](repo://src/router.ts#L8-L17)

Every handler passed in one call becomes its own route entry with the same method and path. Several handlers on one route therefore run in turn, each continuing with `await next()`.

Sources: [src/hono-base.ts:130-139](repo://src/hono-base.ts#L130-L139)

### on

`app.on(method, path, ...handlers)` takes a method or an array of methods and a path or an array of paths, and registers every handler for every pair. Method names are upper-cased, so custom methods such as `PURGE` can be routed.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

### use

`app.use(path, ...middleware)` registers under the method `ALL`. Without a path it registers under `*`, matching every request. Middleware and handlers live in the same table: the only difference is the method and the path pattern they are registered with.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

### The route table

All registration goes through `#addRoute`. It upper-cases the method, joins the path to the app's `_basePath` with `mergePath`, builds a `RouterRoute` record of `basePath`, `path`, `method` and `handler`, passes `[handler, record]` to `router.add`, and appends the record to `app.routes`. The router returns the record with every match, which is how [[Route Introspection]] can name the route that handled a request.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

`mergePath` joins segments with exactly one `/` between them and always starts with `/`; a sub-path of `/` adds nothing.

Sources: [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

## Grouping routes

### basePath

`basePath(path)` returns a clone whose `_basePath` is the old one merged with `path`. The clone shares the router, the `getPath` function, the error and not-found handlers and the `routes` array with the original, so routes added to it go into the same table, prefixed.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

```ts
const api = new Hono().basePath('/api')
api.get('/book', (c) => c.text('List Books')) // GET /api/book
```

Sources: [src/hono-base.ts:234-253](repo://src/hono-base.ts#L234-L253)

### route

`app.route(path, subApp)` copies every record already in `subApp.routes` into this app under `path`, keeping each record's own base path. The copy is made at the call, so routes added to the sub-app afterwards are not included.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

When the sub-app has its own `onError` handler, each copied handler is wrapped in `compose([], subApp.errorHandler)` so errors thrown inside it reach the sub-app's handler, and the original handler is kept on the wrapper under the `COMPOSED_HANDLER` key (`__COMPOSED_HANDLER`) so tools can find it. The sub-app's `notFound` handler is not copied: unmatched paths always reach the parent's.

Sources: [src/hono-base.ts:218-229](repo://src/hono-base.ts#L218-L229), [src/utils/constants.ts:1-4](repo://src/utils/constants.ts#L1-L4)

## Mounting other applications

`mount(path, handler, options)` serves any function of the form `(request, ...args) => Response` under `path`, such as another framework's fetch handler. It registers one `ALL` route at `path/*`.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

```mermaid
flowchart TD
  req["Request under /path/*"] --> replace["replaceRequest(c.req.raw)"]
  replace --> args["getOptions(c): optionHandler(c) or [c.env, executionCtx]"]
  args --> call["applicationHandler(request, ...args)"]
  call -->|Response| ret["Return it"]
  call -->|falsy| next["await next()"]
```

Sources: [src/hono-base.ts:349-381](repo://src/hono-base.ts#L349-L381)

By default the request is rebuilt with the mount prefix removed from its path, or `/` when nothing is left. `replaceRequest` replaces that rewrite with a function of its own, and `replaceRequest: false` passes the request through unchanged. The mounted handler's extra arguments are the bindings and the execution context, unless `optionHandler` (or a function passed as `options`) returns other values; a single value is wrapped in an array.

Sources: [src/hono-base.ts:333-370](repo://src/hono-base.ts#L333-L370)

## Error and not-found handlers

`onError(handler)` and `notFound(handler)` replace the app's handlers and return the app. Without them, an unmatched request gets `404 Not Found` as text, and an error is answered with the response of an `HTTPException` or, for other errors, logged with `console.error` and answered with `Internal Server Error` and status 500. [[Request Lifecycle and Error Handling]] traces when each one runs.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

`errorHandler` is a TypeScript `private` field rather than a `#` field. The code says why: `route()` reads another app's `errorHandler`, which needs the field visible at JavaScript runtime.

Sources: [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188), [src/hono-base.ts:218-221](repo://src/hono-base.ts#L218-L221)
