---
title: "Quickstart"
---
## Overview

This page builds a small app with the public API: routes, middleware, grouping, error handling and testing. Each step names the class members that do the work and links to the page that explains them. For where the package fits, see [[Hono Overview]].

Sources: [src/index.ts:1-15](repo://src/index.ts#L1-L15)

## Create an app and a route

Import `Hono`, register a handler with a method function and export the app. The exported object has a `fetch` method, which is what Workers-style runtimes call.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [src/index.ts:6-14](repo://src/index.ts#L6-L14)

`get`, `post`, `put`, `delete`, `options`, `patch` and `all` are defined in the constructor from the `METHODS` list plus `all`. Each accepts `(path, ...handlers)` or just `(...handlers)`, in which case the path remembered from the previous call is reused. Every call returns the app so calls can be chained. `app.on(method, path, ...handlers)` takes one or several methods and paths.

Sources: [src/hono-base.ts:126-154](repo://src/hono-base.ts#L126-L154), [src/router.ts:17](repo://src/router.ts#L17)

## Add middleware

`app.use(...)` registers handlers for every method. With no path it uses `'*'`, so the middleware runs for all routes. A middleware receives `(c, next)`; it calls `await next()` to continue to later handlers.

Sources: [src/compose.ts:49-52](repo://src/compose.ts#L49-L52)

```ts
app.use(async (c, next) => {
  await next()
})
```

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

Handlers run in registration order, so register middleware before the routes it should wrap. How the chain executes is in [[Application and Request Dispatch]]; the built-in ones are listed in [[Authentication and Security Middleware]] and [[Response, Observability and Utility Middleware]].

Sources: [src/compose.ts:32-59](repo://src/compose.ts#L32-L59)

## Build responses

Handlers receive a `Context`. `c.text`, `c.json`, `c.html`, `c.body`, `c.redirect` and `c.notFound` return a `Response`; `c.req` gives the parsed request. See [[Context and Responses]] and [[Request Parsing and Validation]].

Sources: [src/context.ts:1-12](repo://src/context.ts#L1-L12), [src/request.ts:1-20](repo://src/request.ts#L1-L20)

## Group routes

`app.route(path, subApp)` copies every route of `subApp` under `path`. `app.basePath(path)` returns a clone whose later routes are prefixed.

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253)

```ts
const app = new Hono()
const app2 = new Hono()

app2.get('/user', (c) => c.text('user'))
app.route('/api', app2) // GET /api/user
```

Sources: [src/hono-base.ts:190-232](repo://src/hono-base.ts#L190-L232), [src/hono-base.ts:234-253](repo://src/hono-base.ts#L234-L253)

If the sub-app has its own `onError` handler, `route` wraps each of its handlers so that errors are handled by the sub-app's handler, not the parent's.

Sources: [src/hono-base.ts:219-230](repo://src/hono-base.ts#L219-L230)

## Customise errors and 404

`app.onError((err, c) => ...)` replaces the error handler and `app.notFound((c) => ...)` replaces the not-found handler. The defaults answer `404 Not Found` and `Internal Server Error` with status 500, and use an `HTTPException`'s own response when one was thrown.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:255-294](repo://src/hono-base.ts#L255-L294)

## Test without a server

`app.request` accepts a path, URL or `Request`, and calls `fetch` with `http://localhost` as the origin for paths. You can pass an environment object and an execution context as the third and fourth arguments.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
test('GET /hello is ok', async () => {
  const res = await app.request('/hello')
  expect(res.status).toBe(200)
})
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

## Options

`new Hono(options)` accepts `strict` (default `true`; whether a trailing slash is significant), `router` and `getPath`. When `strict` is false, `getPathNoStrict` is used instead. See [[Routers and Router Selection]] for the `router` option.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

## Run it on a platform

An app's `fetch` is the only thing a platform needs. Some runtimes use the default export directly; others need a wrapper such as `handle(app)` from the matching adapter. See [[Platform Adapters and Connection Info]].

Sources: [src/hono-base.ts:468-485](repo://src/hono-base.ts#L468-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8)
