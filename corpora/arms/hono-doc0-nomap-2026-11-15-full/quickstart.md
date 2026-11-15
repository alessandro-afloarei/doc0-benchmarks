---
title: "Quickstart"
---
## Overview

This page builds a first Hono app: create the project, add routes and middleware, return different kinds of responses, handle errors, test the app without a server, and deploy it to a runtime. Every step uses the public API that the rest of these docs explain in depth.

Sources: [README.md:23-39](repo://README.md#L23-L39)

## Create a project

The `create-hono` starter scaffolds a project for the runtime you choose (Cloudflare Workers, Deno, Bun, Node.js, AWS Lambda and others):

Sources: [README.md:33-37](repo://README.md#L33-L37)

```bash
npm create hono@latest
```

Sources: [README.md:33-37](repo://README.md#L33-L37)

To add Hono to an existing project, install the `hono` package; it has no dependencies. On Deno, the same modules are published on JSR as `@hono/hono`.

Sources: [package.json:1-10](repo://package.json#L1-L10), [jsr.json:1-12](repo://jsr.json#L1-L12)

## Define routes

`new Hono()` creates an app. Each HTTP method has a registration function (`app.get`, `app.post`, `app.put`, `app.delete`, ...), plus `app.all` for every method and `app.on` for a custom method or a list of methods. A handler receives the [[Context]] `c` and returns a `Response`.

Sources: [src/hono-base.ts:126-154](repo://src/hono-base.ts#L126-L154)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})

app.on(['PUT', 'PATCH'], '/users/:id', (c) => c.text('updated'))

export default app
```

Sources: [src/request.ts:83-104](repo://src/request.ts#L83-L104), [src/context.ts:676-722](repo://src/context.ts#L676-L722)

`c.req` is a [[HonoRequest]]: `param()` reads path parameters, `query()` reads the query string and `json()`, `text()` or `parseBody()` read the body. Path syntax (`:id`, optional `:id?`, regular expressions `:id{[0-9]+}` and wildcards `*`) is covered in [[Router Implementations]].

Sources: [src/request.ts:83-150](repo://src/request.ts#L83-L150)

## Add middleware

`app.use` registers middleware for every method. Without a path it applies to `*`; with a path it applies to the matching routes only. Middleware calls `await next()` to run the rest of the chain and can read or change `c.res` afterwards.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'

const app = new Hono()

app.use(logger())
app.use('/api/*', cors())

app.use(async (c, next) => {
  const start = Date.now()
  await next()
  c.header('X-Response-Time', `${Date.now() - start}ms`)
})
```

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

The order of registration is the order of execution; [[Middleware and Composition]] explains the onion model, and [[Utility Middleware]] and [[Security Middleware]] list the built-in middleware.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## Group routes

`app.route(path, subApp)` mounts every route of another `Hono` instance under a prefix, and `app.basePath(path)` returns a copy of the app whose new routes all start with that prefix. A sub-app keeps its own `onError` handler: `route` wraps its handlers so their errors go to it.

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253)

```ts
const books = new Hono()
books.get('/', (c) => c.text('List books'))
books.get('/:id', (c) => c.text(`Book ${c.req.param('id')}`))

const app = new Hono().basePath('/api')
app.route('/books', books) // GET /api/books, GET /api/books/:id
```

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253)

## Handle errors and missing routes

`app.notFound` replaces the default 404 response, and `app.onError` receives every `Error` a handler or middleware throws. Throwing an `HTTPException` with a status is the usual way to stop a request early; its `getResponse()` builds the response, as [[Error Handling]] explains.

Sources: [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/http-exception.ts:46-78](repo://src/http-exception.ts#L46-L78)

```ts
import { HTTPException } from 'hono/http-exception'

app.get('/admin', (c) => {
  throw new HTTPException(401, { message: 'Unauthorized' })
})

app.notFound((c) => c.text('Nothing here', 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  return c.text('Internal Server Error', 500)
})
```

Sources: [src/http-exception.ts:46-78](repo://src/http-exception.ts#L46-L78)

## Test without a server

`app.request(input, init)` accepts a `Request`, a URL or a bare path, turns a path into `http://localhost/...`, and calls `fetch`. It returns the `Response`, so a test needs no running server.

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

```ts
import { expect, test } from 'vitest'

test('GET /users/42', async () => {
  const res = await app.request('/users/42')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ id: '42' })
})
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

## Run it on a runtime

The app object is a fetch handler. Runtimes that call a default export's `fetch` (Cloudflare Workers, Bun, Deno with `Deno.serve(app.fetch)`) run it as is; others use an adapter's `handle` function, such as `hono/aws-lambda`, `hono/vercel` or `hono/netlify`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/aws-lambda/handler.ts:215-245](repo://src/adapter/aws-lambda/handler.ts#L215-L245)

```ts
// AWS Lambda
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()
app.get('/', (c) => c.text('Hello from Lambda'))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:215-245](repo://src/adapter/aws-lambda/handler.ts#L215-L245)

Each runtime's entry point, static file serving and connection info are described in [[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]].

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8)
