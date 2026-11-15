---
title: "Quickstart"
---
## Overview

This page builds a small Hono application step by step: create the app, register routes, read the request, return responses, add middleware, handle errors, test it, and hand it to a runtime. Every snippet uses only the public API exported from `hono` and its subpaths, so it runs unchanged on any runtime with the Fetch API.

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53), [README.md:22-39](repo://README.md#L22-L39)

## Create a project

1. Scaffold a project with a runtime template: run `npm create hono@latest` and pick a target.
2. Or add Hono to an existing project: run `npm install hono`. The package is an ES module with a CommonJS build, and declares Node.js 16.9.0 as its minimum.

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:1-12](repo://package.json#L1-L12), [package.json:696-698](repo://package.json#L696-L698)

## Hello world

Create an instance of `Hono` and register a handler. A handler receives the `Context` `c` and returns a `Response`; `c.text` builds a `text/plain` response.

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34), [src/context.ts:671-694](repo://src/context.ts#L671-L694)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33)

The default `Hono` picks a router for you: a `SmartRouter` that uses `RegExpRouter` when it can and falls back to `TrieRouter`. Import from `hono/quick` or `hono/tiny` instead for a different trade-off; the API is identical. See [[Overview]] for the presets.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## Define routes

Each HTTP method has a registration function (`get`, `post`, `put`, `delete`, `options`, `patch`), plus `all` for any method and `on` for custom or multiple methods. Every call returns the app, so registrations chain. Path parameters start with `:` and are read with `c.req.param`; query strings are read with `c.req.query`.

Sources: [src/router.ts:17](repo://src/router.ts#L17), [src/hono-base.ts:126-154](repo://src/hono-base.ts#L126-L154), [src/request.ts:94-110](repo://src/request.ts#L94-L110), [src/request.ts:148-152](repo://src/request.ts#L148-L152)

```ts
app
  .get('/posts', (c) => {
    const page = c.req.query('page') ?? '1'
    return c.json({ page })
  })
  .get('/posts/:id', (c) => {
    const id = c.req.param('id')
    return c.json({ id })
  })
  .post('/posts', async (c) => {
    const body = await c.req.json()
    return c.json({ created: body }, 201)
  })

app.on(['PUT', 'DELETE'], '/posts/:id', (c) => {
  return c.json({ postId: c.req.param('id'), method: c.req.method })
})
```

Sources: [src/hono.test.ts:2040-2047](repo://src/hono.test.ts#L2040-L2047), [src/request.ts:253-255](repo://src/request.ts#L253-L255)

Group related routes in a separate app and attach it under a prefix with `route`. The sub-app's routes are copied into the parent at that moment, so register them first.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232), [src/hono.test.ts:568-600](repo://src/hono.test.ts#L568-L600)

```ts
const books = new Hono()
books.get('/', (c) => c.text('List books'))
books.get('/:id', (c) => c.text(`Book ${c.req.param('id')}`))

app.route('/books', books) // GET /books, GET /books/:id
```

Sources: [src/hono-base.ts:190-207](repo://src/hono-base.ts#L190-L207)

[[Routing and Path Patterns]] lists the full path syntax (optional parameters, regular expressions, wildcards) and [[The Hono Application]] covers `basePath`, `route` and `mount`.

Sources: [src/utils/url.ts:51-78](repo://src/utils/url.ts#L51-L78)

## Return responses

The `Context` builds the response. Each helper sets a default `Content-Type` and accepts an optional status and headers.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Call | Response |
| --- | --- |
| `c.text('Hi')` | `text/plain; charset=UTF-8` |
| `c.json({ ok: true }, 201)` | `application/json` with status 201 |
| `c.html('<h1>Hi</h1>')` | `text/html; charset=UTF-8`; also accepts a `Promise<string>` |
| `c.body(data, 200, headers)` | Raw body with no default content type |
| `c.redirect('/login')` | 302 with a `Location` header; pass `301` for permanent |
| `c.notFound()` | Whatever the app's not-found handler returns |
| `c.newResponse(data, init)` | A `Response` carrying headers set earlier with `c.header` |

Sources: [src/context.ts:664-780](repo://src/context.ts#L664-L780)

Set headers and the status before building the body with `c.header` and `c.status`; the response helpers merge them in.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

```ts
app.get('/welcome', (c) => {
  c.header('X-Message', 'Hello!')
  c.status(201)
  return c.body('Thank you for coming')
})
```

Sources: [src/context.ts:643-663](repo://src/context.ts#L643-L663)

[[Context]] documents every response method and [[HonoRequest]] every request reader.

Sources: [src/context.ts:293-352](repo://src/context.ts#L293-L352)

## Add middleware

`app.use` registers middleware for every method. Without a path it applies to `*`, every path; with a path it applies only there. Built-in middleware lives in its own subpath, for example `hono/logger`.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [package.json:229-233](repo://package.json#L229-L233)

```ts
import { logger } from 'hono/logger'

app.use(logger())

app.use('/admin/*', async (c, next) => {
  const start = Date.now()
  await next()
  c.header('X-Response-Time', `${Date.now() - start}ms`)
})
```

Sources: [src/middleware/logger/index.ts:65-95](repo://src/middleware/logger/index.ts#L65-L95)

Middleware runs in registration order around the handler: code before `await next()` runs on the way in, code after it runs on the way out and can still change `c.res`. A middleware can share values with later handlers through `c.set` and `c.get`. Declare their types in the app's `Env` generic to make `c.get` typed.

Sources: [src/compose.ts:32-71](repo://src/compose.ts#L32-L71), [src/context.ts:546-580](repo://src/context.ts#L546-L580), [src/types.ts:30-33](repo://src/types.ts#L30-L33)

```ts
type Env = { Variables: { user: string } }

const api = new Hono<Env>()

api.use(async (c, next) => {
  c.set('user', 'alice')
  await next()
})

api.get('/me', (c) => c.text(`Hello ${c.get('user')}`))
```

Sources: [src/context.ts:532-591](repo://src/context.ts#L532-L591)

[[Middleware and Composition]] explains the chain and the built-in middleware pages start at [[Utility Middleware]].

Sources: [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)

## Handle errors and missing routes

Without configuration, an unmatched request gets `404 Not Found` as text and a thrown error gets `500 Internal Server Error`, after being logged with `console.error`. An error that has a `getResponse` method, such as `HTTPException` from `hono/http-exception`, is answered with its own response instead.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/http-exception.ts:46-77](repo://src/http-exception.ts#L46-L77)

```ts
import { HTTPException } from 'hono/http-exception'

app.get('/secret', (c) => {
  throw new HTTPException(401, { message: 'Unauthorized' })
})

app.notFound((c) => c.text('Custom 404 Message', 404))

app.onError((err, c) => {
  console.error(`${err}`)
  return c.text('Custom Error Message', 500)
})
```

Sources: [src/hono-base.ts:255-294](repo://src/hono-base.ts#L255-L294)

A custom `onError` replaces the default entirely, including its `getResponse` handling: check `err instanceof HTTPException` and return `err.getResponse()` yourself if you want both. [[Error Handling]] covers the rules for sub-apps.

Sources: [src/hono-base.ts:271-274](repo://src/hono-base.ts#L271-L274), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

## Test without a server

`app.request` accepts a path, a URL or a `Request`, prefixes a bare path with `http://localhost`, and runs it through `fetch`. It returns the `Response`, so a test needs no network.

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

```ts
import { describe, expect, it } from 'vitest'

describe('app', () => {
  it('GET /posts/123', async () => {
    const res = await app.request('/posts/123')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '123' })
  })
})
```

Sources: [src/hono.test.ts:2888-2903](repo://src/hono.test.ts#L2888-L2903)

## Run it on a runtime

An app is a `fetch(request, env, executionCtx)` function plus routing state, so connecting it to a runtime means passing `app.fetch`, or the app itself, to that runtime's entry point. Adapters wrap runtimes whose events are not `Request` objects.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

| Runtime | Entry code |
| --- | --- |
| Cloudflare Workers, Bun | `export default app` |
| Deno | `Deno.serve(app.fetch)` |
| Node.js | `serve(app)` from the separate `@hono/node-server` package |
| AWS Lambda | `export const handler = handle(app)` from `hono/aws-lambda` |
| Vercel | `export const GET = handle(app)` from `hono/vercel` |
| Service Worker | `fire(app)` from `hono/service-worker` |

Sources: [src/adapter/aws-lambda/handler.ts:239-250](repo://src/adapter/aws-lambda/handler.ts#L239-L250), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/service-worker/index.ts:10-36](repo://src/adapter/service-worker/index.ts#L10-L36), [package.json:668-672](repo://package.json#L668-L672)

On Cloudflare Workers, `fetch` receives the bindings as its second argument and the execution context as its third. They become `c.env` and `c.executionCtx` inside handlers. Declare `Bindings` in the `Env` generic to type `c.env`.

Sources: [src/hono-base.ts:406-427](repo://src/hono-base.ts#L406-L427), [src/context.ts:385-396](repo://src/context.ts#L385-L396)

```ts
type Bindings = { API_KEY: string }

const app = new Hono<{ Bindings: Bindings }>()

app.get('/key', (c) => c.text(c.env.API_KEY.slice(0, 4)))

export default app
```

Sources: [src/types.ts:30-33](repo://src/types.ts#L30-L33)

[[Runtime Adapters]] covers each platform's extras: static files, WebSockets and connection info.

Sources: [package.json:344-388](repo://package.json#L344-L388)
