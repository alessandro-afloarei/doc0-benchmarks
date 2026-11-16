---
title: "Hono Application"
---
## Overview

The application object is where routes are registered and where every request enters. `HonoBase` in `src/hono-base.ts` holds the routing API, the error and not-found handlers, and the `fetch` entry point, but it has no router: a comment calls it "like an abstract class" whose subclasses set `router` in their constructor. The `Hono` class exported from `hono` and the two presets are those subclasses.

Sources: [src/hono-base.ts:98-124](repo://src/hono-base.ts#L98-L124)

This page covers how routes are added, grouped and mounted, and how the app is configured and called. What happens to a request once `fetch` is called is on [[Request Dispatch and Middleware]]; how routers store and match paths is on [[Router Interface and Presets]].

Sources: [src/hono-base.ts:385-485](repo://src/hono-base.ts#L385-L485)

## Hono and the presets

The three exported classes differ only in the router they create:

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:16-23](repo://src/preset/quick.ts#L16-L23), [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19)

| Import | Router |
| --- | --- |
| `hono` | `options.router`, or `SmartRouter` over `RegExpRouter` and `TrieRouter` |
| `hono/quick` | `SmartRouter` over `LinearRouter` and `TrieRouter` |
| `hono/tiny` | `PatternRouter` |

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:16-23](repo://src/preset/quick.ts#L16-L23), [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19)

Only the default `Hono` reads `options.router` in its own constructor, but `HonoBase` also copies every option except `strict` onto the instance with `Object.assign`, so a `router` passed to a preset is assigned first and then overwritten by the preset's own. All three classes take the same type parameters, `E` (the `Env`), `S` (the schema) and `BasePath`, described on [[Route Types and Schema]].

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173), [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20)

## Options

`HonoOptions` has three fields:

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

| Option | Default | Effect |
| --- | --- | --- |
| `strict` | `true` | When `false`, a trailing slash is dropped from the path, so `/hello/` and `/hello` match the same route |
| `router` | depends on the class | The `Router<[H, RouterRoute]>` that stores routes |
| `getPath` | `getPath` from `utils/url` | Turns a `Request` into the path the router matches, for example to route on the host header |

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

The constructor picks the path function from `strict` first: with `strict` left at `true` it uses `options.getPath` or the default `getPath`, and with `strict: false` it uses `getPathNoStrict`. A custom `getPath` is therefore ignored when `strict` is `false`.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173), [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146)

The default `getPath` scans the URL once from the first `/` after the scheme and stops at `?` or `#`. Only when it meets a `%` does it look up the query and hash with `indexOf` and decode the path with `tryDecodeURI`, which keeps invalid percent sequences as they are instead of throwing. A comment notes the slower branch is accepted because paths without percent encoding are the common case.

Sources: [src/utils/url.ts:80-134](repo://src/utils/url.ts#L80-L134)

## Registering routes

The constructor creates one function per method in `METHODS` (`get`, `post`, `put`, `delete`, `options`, `patch`) plus `all`. Each function accepts either a path followed by handlers, or handlers alone. A string first argument becomes the app's current path, kept in the private `#path` field; handlers without a path are added to whatever path was set last.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:9-17](repo://src/router.ts#L9-L17)

Because each method returns the app, a chain can register several methods on one path:

Sources: [src/hono-base.ts:128-141](repo://src/hono-base.ts#L128-L141)

```ts
app
  .get('/posts', (c) => c.text('list'))
  .post((c) => c.text('created')) // POST /posts
```

Sources: [src/hono-base.ts:128-141](repo://src/hono-base.ts#L128-L141)

`on(method, path, ...handlers)` takes a method name or an array of names, upper-cased before they reach the router, and a path or an array of paths, and registers every handler for each combination. This is how custom methods such as `PURGE` are routed.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

`use()` registers middleware under the method `ALL`. With a path first, the middleware applies to that path; without one, the path becomes `*` and the middleware matches every request. Middleware and handlers live in the same router, and they run in the order they were registered, which [[Request Dispatch and Middleware]] traces.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

Every registration ends in `#addRoute`. It upper-cases the method, prefixes the path with the app's base path through `mergePath`, and builds a `RouterRoute` record of `basePath`, `path`, `method` and `handler`. The pair `[handler, record]` goes to `router.add`, and the record is pushed onto `app.routes`, the list the dev helper and `route()` read.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

`mergePath` joins path pieces with exactly one slash between them, and treats a sub path of `/` as nothing, so `mergePath('/api', '/')` is `/api`.

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

## Base paths and sub-apps

`basePath(path)` returns a clone of the app whose `_basePath` is the merged path. The clone is built by `#clone`, which shares the same `router` and the same `routes` array and copies the error and not-found handlers. Routes added to the clone therefore land in the original app's router, only with the prefix.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

`route(path, subApp)` groups another app under a path. It takes a `basePath(path)` clone of the parent and re-adds each record in `subApp.routes` to it, keeping the record's own base path. If the sub-app has its own `onError` handler, each of its handlers is wrapped so that errors are caught by `compose([], subApp.errorHandler)` and never reach the parent's handler; the wrapper keeps the original under the `COMPOSED_HANDLER` symbol so introspection can find it.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

```ts
const books = new Hono()
books.get('/', (c) => c.text('list books'))
books.get('/:id', (c) => c.text(`book ${c.req.param('id')}`))

const app = new Hono()
app.route('/books', books) // GET /books, GET /books/:id
```

Sources: [src/hono-base.ts:190-232](repo://src/hono-base.ts#L190-L232)

> [!NOTE]
> `route()` copies the sub-app's routes at the moment it is called. Routes added to the sub-app afterwards are not registered on the parent, and the sub-app's `notFound` handler is not carried over, only its `onError` handler.

Sources: [src/hono-base.ts:217-232](repo://src/hono-base.ts#L217-L232)

## Mounting other applications

`mount(path, applicationHandler, options?)` forwards matching requests to any function that takes a `Request` and returns a `Response`, such as another framework's fetch handler. It registers one `ALL` route on `path/*`.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

The handler rewrites the request before calling the application. By default it strips the mounted prefix (including the app's base path) from the pathname and builds a new `Request`, so the mounted app sees `/hello` for `/itty-router/hello`. The extra arguments it passes are `c.env` and the execution context, read inside a `try` because `c.executionCtx` throws when the runtime gave none. If the mounted application returns nothing, the route calls `next()` and later handlers run.

Sources: [src/hono-base.ts:349-380](repo://src/hono-base.ts#L349-L380)

`options` is either a function or an object:

Sources: [src/hono-base.ts:89-96](repo://src/hono-base.ts#L89-L96), [src/hono-base.ts:333-347](repo://src/hono-base.ts#L333-L347)

| Option | Effect |
| --- | --- |
| a function, or `optionHandler` | Called with the Context; its result, or each element if it returns an array, becomes the arguments after the request |
| `replaceRequest` | A function that builds the request passed on; `false` passes the original request unchanged |

Sources: [src/hono-base.ts:89-96](repo://src/hono-base.ts#L89-L96), [src/hono-base.ts:333-347](repo://src/hono-base.ts#L333-L347)

## Error and not-found handlers

`onError(handler)` and `notFound(handler)` replace the app's two fallback handlers and return the app. The defaults are a `404 Not Found` text response and an error handler that answers the error's own response when it has a `getResponse` method (as `HTTPException` does) and otherwise logs it and answers `500 Internal Server Error`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

```ts
app.notFound((c) => c.text('Custom 404 Message', 404))

app.onError((err, c) => {
  console.error(`${err}`)
  return c.text('Custom Error Message', 500)
})
```

Sources: [src/hono-base.ts:263-294](repo://src/hono-base.ts#L263-L294)

Both handlers belong to the app they are set on. `basePath()` clones copy them at the time of cloning, so a handler set on the parent after creating a clone does not reach the clone. How the error handler is called during dispatch is on [[Request Dispatch and Middleware]].

Sources: [src/hono-base.ts:175-188](repo://src/hono-base.ts#L175-L188)

## Entry points

| Member | Use |
| --- | --- |
| `fetch(request, env?, executionCtx?)` | The runtime entry point; calls `#dispatch` with the request's method |
| `request(input, init?, env?, executionCtx?)` | For tests: accepts a `Request`, a URL or a path, and prefixes a path with `http://localhost` |
| `fire()` | Deprecated; adds a global `fetch` event listener. Use `fire` from `hono/service-worker` |

Sources: [src/hono-base.ts:479-542](repo://src/hono-base.ts#L479-L542)

`request` merges `init` into a `Request` argument with `new Request(input, init)` when both are given, and runs a path through `mergePath('/', input)` so a missing leading slash is added. The Service Worker version of `fire` and the other runtime wrappers are on [[Runtime Adapters]].

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)
