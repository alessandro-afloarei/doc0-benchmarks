---
title: "Hono App and Route Registration"
---
## Overview

The application object is where routes are declared and where requests enter. `HonoBase` in `src/hono-base.ts` holds everything an app does: the method helpers (`get`, `post`, `use`, `on`…), sub-app grouping with `route` and `basePath`, mounting foreign handlers, the error and not-found hooks, and the `fetch` entry point. It deliberately has no router; each exported `Hono` class is a thin subclass that picks one.

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124)

Registration is a build-time activity: every call ends in `#addRoute`, which hands the route to the router and appends it to `app.routes`. What happens when a request arrives is covered in [[Request Dispatch and Middleware Composition]]; how routes are matched is covered in [[Routers and Presets]].

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## The Hono class and its options

The `Hono` exported from `hono` calls the base constructor, then installs the router passed in `options.router`, or a `SmartRouter` over `RegExpRouter` and `TrieRouter` by default. The `hono/quick` and `hono/tiny` presets are the same subclass with a different router.

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | When `false`, a trailing slash is stripped from the request path, so `/hello/` matches `/hello` |
| `router` | `SmartRouter` | The `Router<[H, RouterRoute]>` that stores and matches routes |
| `getPath` | `getPath` from `utils/url` | Extracts the routing path from the `Request`; replace it to route on the `Host` header, for example |

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

The constructor copies every option except `strict` onto the instance with `Object.assign`, then sets `getPath`. With `strict: false` the custom `getPath` option is ignored and `getPathNoStrict` is always used.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

## Registering routes

### Method helpers

The constructor builds `get`, `post`, `put`, `delete`, `options`, `patch` and `all` in one loop. Each accepts either a path followed by handlers or handlers alone. A string first argument updates the private `#path`; handlers without a path reuse the last path set on this app, which is what makes chaining work.

Sources: [src/hono-base.ts:130-139](repo://src/hono-base.ts#L130-L139)

```ts
app
  .get('/posts', listPosts)
  .post(createPost) // also /posts
```

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

### on() for custom methods and several paths

`app.on(method, path, ...handlers)` takes a method or an array of methods and a path or an array of paths, upper-cases each method, and registers every handler for every combination. It is how routes for methods outside the built-in list, such as `PURGE`, are added.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

### use() for middleware

`app.use(path?, ...handlers)` registers handlers under the method `ALL`. Without a path it uses `*`, so middleware matches every request. Middleware and handlers are stored the same way; the only difference is that middleware calls `next()` ([[Request Dispatch and Middleware Composition]]).

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/router.ts:6-17](repo://src/router.ts#L6-L17)

### #addRoute and app.routes

`#addRoute` upper-cases the method, prefixes the path with the app's `_basePath` through `mergePath`, and builds a `RouterRoute` record of `basePath`, `path`, `method` and `handler`. The router receives the tuple `[handler, route]`, so a match returns both the function to call and its route metadata, which `c.req.routePath` and the route helper read later. The same record is pushed to `app.routes`, the list `route()` copies from and `showRoutes` prints.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## Grouping with basePath and route

### basePath()

`basePath(path)` returns a clone, not the same app: `#clone` creates a new `HonoBase` that shares the router, `getPath`, error handler, not-found handler and the `routes` array, then sets the merged `_basePath`. Routes added to the clone land in the shared router with the prefix, and the original app keeps its own prefix.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

### route()

`app.route(path, subApp)` copies a sub-app's routes into the parent. It calls `basePath(path)` to get a prefixed clone, then re-adds each of `subApp.routes` with its original method, path and base path. Because the routes are copied when `route()` runs, routes added to the sub-app afterwards are not seen by the parent.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

When the sub-app has its own `onError` handler, each copied handler is wrapped: `compose([], subApp.errorHandler)` runs the original handler and lets the sub-app's handler catch its errors, so a sub-app's error handling survives grouping. The wrapper stores the original under the `COMPOSED_HANDLER` key, and `findTargetHandler` in `utils/handler.ts` follows that key back so tools that inspect handlers see the real function.

Sources: [src/hono-base.ts:219-228](repo://src/hono-base.ts#L219-L228), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

```ts
const books = new Hono()
books.get('/', (c) => c.text('list'))
books.get('/:id', (c) => c.text(`book ${c.req.param('id')}`))

const app = new Hono()
app.route('/books', books) // GET /books, GET /books/:id
```

Sources: [src/hono-base.ts:190-232](repo://src/hono-base.ts#L190-L232)

The return type merges the sub-app's schema under the prefix with `MergeSchemaPath`, which is how the typed client sees grouped routes ([[Env, Handler and Schema Types]]).

Sources: [src/hono-base.ts:208-217](repo://src/hono-base.ts#L208-L217)

## Mounting other applications

`mount(path, handler, options?)` attaches any function that takes a `Request` and returns a `Response`, such as another framework's fetch handler. It registers an `ALL` route on `path/*` whose handler runs three steps.

Sources: [src/hono-base.ts:372-381](repo://src/hono-base.ts#L372-L381)

1. Rewrites the request with `replaceRequest`. By default it strips the mount prefix from the path so the mounted app sees `/hello`, not `/app/hello`; `replaceRequest: false` passes the request through unchanged.
2. Calls the handler with the rewritten request and extra arguments from `optionHandler(c)`, or `[c.env, c.executionCtx]` by default (a missing execution context is tolerated).
3. Returns the handler's response, or calls `next()` when it returned nothing.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

For forwarding to another origin over HTTP instead of calling a function in process, see [[Proxy Helper]].

Sources: [src/hono-base.ts:372-381](repo://src/hono-base.ts#L372-L381)

## Error and not-found hooks

`onError(handler)` and `notFound(handler)` replace the defaults and return the app. The default not-found handler answers `404 Not Found` as text; the default error handler returns an `HTTPException`'s own response (anything with `getResponse`) and otherwise logs the error and answers `500 Internal Server Error`. They are set per app instance; [[Request Dispatch and Middleware Composition]] shows when each runs.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Entry points

| Method | Use |
| --- | --- |
| `fetch(request, env?, executionCtx?)` | The handler runtimes call. Passes `request.method` to `#dispatch` |
| `request(input, init?, env?, executionCtx?)` | Test helper: accepts a `Request`, URL or path; a relative path becomes `http://localhost/...` |
| `fire()` | Deprecated: registers a global `fetch` event listener for Service Worker style runtimes; use `fire` from `hono/service-worker` |

Sources: [src/hono-base.ts:479-542](repo://src/hono-base.ts#L479-L542)

`fetch` is an arrow function property, not a method, so it can be passed as `Deno.serve(app.fetch)` or `export default { fetch: app.fetch }` without losing `this`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

## Path utilities

Route and request paths are normalised by a few functions in `src/utils/url.ts`.

Sources: [src/utils/url.ts:104-169](repo://src/utils/url.ts#L104-L169)

| Function | Behaviour |
| --- | --- |
| `mergePath(base, sub, ...rest)` | Joins paths with exactly one slash; a `sub` of `/` adds nothing, so `mergePath('/api', '/')` is `/api` |
| `getPath(request)` | Slices the path out of `request.url` by scanning characters up to `?` or `#`; only when a `%` appears does it fall back to `indexOf` and `tryDecodeURI` |
| `getPathNoStrict(request)` | `getPath` without a trailing slash, used when `strict` is `false` |
| `checkOptionalParameter(path)` | Expands `/api/animals/:type?` into `/api/animals` and `/api/animals/:type` for routers |
| `tryDecodeURI(str)` | Decodes what it can and leaves invalid percent-encodings as written instead of throwing |

Sources: [src/utils/url.ts:81-200](repo://src/utils/url.ts#L81-L200)

`getPath` avoids `new URL()` on every request: parsing a full URL is the most expensive thing a minimal handler would do, and the fast path is a single character loop. A `%25` in the path is re-escaped before decoding so an encoded percent sign is not decoded twice.

Sources: [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)
