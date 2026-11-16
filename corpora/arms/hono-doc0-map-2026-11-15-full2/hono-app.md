---
title: "The Hono App"
---
## Overview

The app object is where routes, middleware and the error and not-found handlers are registered, and its `fetch` method is what a runtime calls. Two classes build it: `HonoBase` in `src/hono-base.ts` holds all of the behaviour but leaves `router` unset, and `Hono` in `src/hono.ts` extends it and installs the default router. The presets in `src/preset/` are further subclasses that only pick another router.

Sources: [src/hono-base.ts:98-125](repo://src/hono-base.ts#L98-L125), [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

`HonoBase` takes four type parameters: `E` (the `Env` with `Bindings` and `Variables`), `S` (the accumulated route `Schema` used by the RPC client), `BasePath` and `CurrentPath`. `Hono` exposes the first three. Each route method returns the app with a widened `S`, which is how [[Type System and Schema Inference]] and [[RPC Client (hc)]] learn the routes.

Sources: [src/hono-base.ts:98-112](repo://src/hono-base.ts#L98-L112), [src/hono.ts:16-20](repo://src/hono.ts#L16-L20)

## Constructor options

`new Hono(options)` accepts a `HonoOptions` object.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `router` | `Router<[H, RouterRoute]>` | `new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] })` | The router that stores and matches routes. |
| `strict` | `boolean` | `true` | When `false`, a trailing slash is dropped from the request path, so `/hello/` matches `/hello`. |
| `getPath` | `(request, options?: { env }) => string` | `getPath` from `src/utils/url.ts` | Extracts the routing path from the request, for example to route on the `Host` header. |

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

The constructor copies every option except `strict` onto the instance with `Object.assign`, then sets `getPath`: the custom `getPath` (or the default) when `strict` is `true` or unset, and `getPathNoStrict` when `strict` is `false`. A custom `getPath` is therefore ignored when `strict: false` is also given. `Hono` then sets `router` to `options.router` or to the default `SmartRouter`.

Sources: [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/utils/url.ts:106-146](repo://src/utils/url.ts#L106-L146)

```ts
import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'

const app = new Hono({ router: new RegExpRouter(), strict: false })

const hostApp = new Hono({
  getPath: (req) =>
    '/' + req.headers.get('host') + req.url.replace(/^https?:\/\/[^/]+(\/[^?]*)/, '$1'),
})
hostApp.get('/www1.example.com/hello', (c) => c.text('hello www1'))
```

Sources: [src/hono-base.ts:56-86](repo://src/hono-base.ts#L56-L86)

## Registering routes

### Method handlers

The constructor creates `get`, `post`, `put`, `delete`, `options`, `patch` and `all` from the `METHODS` list plus `all`. Each takes either a path followed by handlers, or handlers alone. When the first argument is a string it becomes the current path (`#path`); otherwise the first argument is itself a handler registered on the current path. This is what makes chaining work: `app.get('/x', a).post(b)` registers `GET /x` and `POST /x`.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:9-17](repo://src/router.ts#L9-L17)

```ts
app
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id') }))
  .put((c) => c.text('updated'))
  .delete((c) => c.text('deleted'))
```

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

### Custom methods with on

`app.on(method, path, ...handlers)` accepts a method or an array of methods, and a path or an array of paths. Every combination is registered, with the method upper-cased, so it also serves non-standard methods such as `PURGE`.

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

```ts
app.on('PURGE', '/cache', (c) => c.text('purged'))
app.on(['GET', 'POST'], ['/a', '/b'], (c) => c.text('ok'))
```

Sources: [src/hono-base.ts:143-154](repo://src/hono-base.ts#L143-L154)

### Middleware with use

`app.use(path?, ...middleware)` registers handlers under the method `ALL`. Without a path the path becomes `*`, so the middleware runs for every request. Middleware and handlers live in the same router: a request collects every matching entry in registration order, so middleware must be registered before the routes it should wrap. See [[Request Lifecycle and Middleware Composition]].

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

### What #addRoute stores

Every registration ends in `#addRoute`. It upper-cases the method, prefixes the path with the app's `_basePath` through `mergePath`, builds a `RouterRoute` record `{ basePath, path, method, handler }`, adds `[handler, route]` to the router and appends the record to the public `routes` array. The `routes` array is what `route()` copies and what helpers such as `hono/dev` inspect.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/types.ts:57-62](repo://src/types.ts#L57-L62), [src/helper/dev/index.ts:26-35](repo://src/helper/dev/index.ts#L26-L35)

> [!WARNING]
> The default `SmartRouter` builds its matcher on the first request and throws `Can not add a route since the matcher is already built.` if a route is added afterwards. Register every route before serving traffic.

Sources: [src/router/smart-router/router.ts:13-50](repo://src/router/smart-router/router.ts#L13-L50), [src/router.ts:18-22](repo://src/router.ts#L18-L22)

## Grouping and base paths

### basePath

`app.basePath(path)` returns a new instance made by `#clone()`. The clone shares the same `router` and `routes` array and copies the current `getPath`, error handler and not-found handler, but has `_basePath` set to `mergePath(this._basePath, path)`. Routes registered on the clone land in the shared router with the prefix. Because the handlers are copied when the clone is made, an `onError` or `notFound` set on the original afterwards is not seen by a clone made earlier.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

```ts
const api = new Hono().basePath('/api')
api.get('/book', (c) => c.text('List books')) // GET /api/book
```

Sources: [src/hono-base.ts:240-253](repo://src/hono-base.ts#L240-L253)

### route

`app.route(path, subApp)` mounts another Hono app's routes under `path`. It calls `this.basePath(path)` and, for each entry in `subApp.routes`, re-registers the handler on that clone, passing the original `basePath` so it nests correctly. Only the routes present at the time of the call are copied, so build the sub-app before calling `route`.

Sources: [src/hono-base.ts:190-232](repo://src/hono-base.ts#L190-L232)

If the sub-app has its own `onError`, each of its handlers is wrapped in `compose([], subApp.errorHandler)` so errors thrown in those routes go to the sub-app's handler. The wrapper keeps the original handler under the `COMPOSED_HANDLER` key, which `findTargetHandler` in `src/utils/handler.ts` follows to recover it. The sub-app's `notFound` is not carried over: a request that matches nothing is answered by the parent.

Sources: [src/hono-base.ts:218-231](repo://src/hono-base.ts#L218-L231), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

```ts
const books = new Hono()
books.get('/', (c) => c.text('List books'))
books.get('/:id', (c) => c.text(`Book ${c.req.param('id')}`))
books.onError((err, c) => c.text('Books failed', 500))

const app = new Hono()
app.route('/books', books) // GET /books, GET /books/:id
```

Sources: [src/hono-base.ts:190-232](repo://src/hono-base.ts#L190-L232)

### mount

`app.mount(path, applicationHandler, options?)` forwards requests under `path` to any function of the form `(request, ...args) => Response | Promise<Response>`, for instance another framework's fetch handler. It registers one `ALL` route on `path/*`. That handler calls `applicationHandler(replaceRequest(c.req.raw), ...getOptions(c))`; if it returns a response that is the answer, otherwise `next()` is called.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `optionHandler` | `(c: Context) => unknown` | Returns `[c.env, c.executionCtx]` (the latter `undefined` if absent) | Builds the extra arguments passed after the request. An array is spread; anything else is passed as one argument. Can be given directly as the third argument. |
| `replaceRequest` | `(req: Request) => Request`, or `false` | Strips the mount prefix from the path | Rewrites the request before forwarding. `false` forwards it unchanged. |

Sources: [src/hono-base.ts:89-96](repo://src/hono-base.ts#L89-L96), [src/hono-base.ts:333-370](repo://src/hono-base.ts#L333-L370)

The default `replaceRequest` merges the app's base path with `path`, slices that prefix off the path returned by `getPath`, falls back to `/`, and builds a new `Request` with the new URL.

Sources: [src/hono-base.ts:362-370](repo://src/hono-base.ts#L362-L370)

```ts
import { Router as IttyRouter } from 'itty-router'

const ittyRouter = IttyRouter()
ittyRouter.get('/hello', () => new Response('Hello from itty-router'))

const app = new Hono()
app.mount('/itty-router', ittyRouter.handle) // GET /itty-router/hello
app.mount('/app', anotherApp, { replaceRequest: (req) => req })
```

Sources: [src/hono-base.ts:306-326](repo://src/hono-base.ts#L306-L326)

## Error and not-found handlers

`app.onError(handler)` replaces the error handler, `(err, c) => Response`. `app.notFound(handler)` replaces the not-found handler, `(c) => Response`. Both return the app for chaining. The defaults answer `404 Not Found` and, for errors, either `err.getResponse()` for errors that have it or `Internal Server Error` with status 500 after logging. [[Error Handling and HTTPException]] traces how errors reach them.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:255-294](repo://src/hono-base.ts#L255-L294)

## Serving requests

### fetch

`app.fetch(request, env?, executionCtx?)` is the entry point. It is an arrow-function property, so `app.fetch` can be passed by itself without losing `this`. It calls `#dispatch(request, executionCtx, env, request.method)`; the dispatch steps are on [[Request Lifecycle and Middleware Composition]].

Sources: [src/hono-base.ts:468-485](repo://src/hono-base.ts#L468-L485)

### request

`app.request(input, requestInit?, env?, executionCtx?)` is for tests. A `Request` is passed through (re-created with `requestInit` if one is given). A string or `URL` is used as is when it starts with `http://` or `https://`; otherwise it is treated as a path and prefixed with `http://localhost`.

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

```ts
const res = await app.request('/hello')
const res2 = await app.request('/posts', { method: 'POST', body: '{}' })
```

Sources: [src/hono-base.ts:491-517](repo://src/hono-base.ts#L491-L517)

### fire

`app.fire()` registers a global `fetch` event listener that responds with `#dispatch(event.request, event, undefined, method)`, for Service Worker style environments. It is deprecated in favour of `fire(app)` from `hono/service-worker`, which also falls back to the network `fetch` on a 404.

Sources: [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542), [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37)

## Public members

| Member | Kind | Description |
| --- | --- | --- |
| `get`, `post`, `put`, `delete`, `options`, `patch`, `all` | method | Register handlers for one method (or all methods). |
| `on` | method | Register handlers for given method(s) and path(s). |
| `use` | method | Register middleware for all methods. |
| `route` | method | Copy another app's routes under a path. |
| `basePath` | method | Return a clone with a path prefix. |
| `mount` | method | Forward a path prefix to a foreign fetch handler. |
| `onError`, `notFound` | method | Replace the error and not-found handlers. |
| `fetch`, `request`, `fire` | method | Serve a request; test a request; register a Service Worker listener. |
| `router` | property | The `Router` instance. |
| `routes` | property | Every registered `RouterRoute`, in order. |
| `getPath` | property | The function that extracts the routing path. |

Sources: [src/hono-base.ts:104-124](repo://src/hono-base.ts#L104-L124), [src/hono-base.ts:208-294](repo://src/hono-base.ts#L208-L294)

For other router choices, see [[Presets: hono/tiny and hono/quick]] and [[Routers and SmartRouter]].

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)
