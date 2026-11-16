---
title: "Quickstart"
---
## Overview

This page builds a small Hono application: create the app, add routes and middleware, serve it on a runtime, and test it without a server. Everything here uses the `Hono` class from the root `hono` module and the `Context` object passed to each handler.

Sources: [src/index.ts:1-15](repo://src/index.ts#L1-L15), [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

## Create a project

The project scaffolder sets up a template for the runtime you pick.

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:37-39](repo://README.md#L37-L39)

To add Hono to an existing project, install the `hono` package. It has no dependencies and ships ES module, CommonJS and type declaration builds for every subpath.

Sources: [package.json:1-12](repo://package.json#L1-L12), [package.json:38-48](repo://package.json#L38-L48)

## Write the app

### Routes

`new Hono()` creates an app with the default router. `app.get`, `app.post`, `app.put`, `app.delete`, `app.options`, `app.patch` and `app.all` register a handler for a path; a handler receives the `Context` `c` and returns a `Response`, usually built with `c.text`, `c.json` or `c.html`. Path parameters such as `:id` are read with `c.req.param`.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/context.ts:682-721](repo://src/context.ts#L682-L721), [src/request.ts:82-104](repo://src/request.ts#L82-L104)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/posts/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, title: `Post ${id}` })
})

app.post('/posts', async (c) => {
  const body = await c.req.json()
  return c.json({ created: body }, 201)
})

export default app
```

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/context.ts:708-721](repo://src/context.ts#L708-L721)

### Middleware

`app.use` registers middleware for every method. Without a path it applies to `*`. Middleware is an `async (c, next) => ...` function: code before `await next()` runs on the way in, code after it runs once the handler has produced `c.res`. Built-in middleware is imported from its own subpath, for example `logger` from `hono/logger`.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

app.use('/api/*', async (c, next) => {
  const start = Date.now()
  await next()
  c.header('X-Response-Time', `${Date.now() - start}ms`)
})

app.get('/api/hello', (c) => c.json({ message: 'Hello!' }))
```

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:75-95](repo://src/middleware/logger/index.ts#L75-L95)

### Errors and 404

Throw an `HTTPException` to stop a request with a status code; customise the fallback responses with `app.onError` and `app.notFound`. Details are in [[Error Handling and HTTPException]].

Sources: [src/http-exception.ts:20-46](repo://src/http-exception.ts#L20-L46), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

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
  return c.text('Something broke', 500)
})
```

Sources: [src/http-exception.ts:46-78](repo://src/http-exception.ts#L46-L78), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Run it

An app is served through its `fetch(request, env, executionCtx)` property, an arrow function bound to the instance so it can be passed around on its own. How you hand it to the runtime depends on the platform.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

| Runtime | How to serve |
| --- | --- |
| Cloudflare Workers, Bun | `export default app` (the runtime calls `app.fetch`) |
| Deno | `Deno.serve(app.fetch)` |
| AWS Lambda | `export const handler = handle(app)` from `hono/aws-lambda` |
| Vercel | `export const GET = handle(app)` from `hono/vercel` |
| Service Worker | `fire(app)` from `hono/service-worker` |
| Node.js | The separate `@hono/node-server` package's `serve(app)` |

Sources: [src/adapter/aws-lambda/handler.ts:239-252](repo://src/adapter/aws-lambda/handler.ts#L239-L252), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/service-worker/index.ts:10-36](repo://src/adapter/service-worker/index.ts#L10-L36), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

On Cloudflare Workers the second and third arguments of `fetch` are the bindings and the `ExecutionContext`; Hono exposes them as `c.env` and `c.executionCtx`. [[Runtime Adapters]] covers each platform, and [[AWS Lambda and Lambda@Edge]] the Lambda event conversion.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/context.ts:352-397](repo://src/context.ts#L352-L397)

> [!NOTE]
> `app.fire()` still exists on the app but is deprecated; use `fire` from `hono/service-worker` instead.

Sources: [src/hono-base.ts:519-542](repo://src/hono-base.ts#L519-L542)

## Test it

`app.request(input, requestInit, env, executionCtx)` runs a request through the app in-process and returns the `Response`. A string that does not start with `http://` or `https://` is treated as a path and prefixed with `http://localhost`, so a test needs neither a server nor a full URL.

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

```ts
import { describe, expect, it } from 'vitest'
import app from './app'

describe('app', () => {
  it('GET /posts/:id returns JSON', async () => {
    const res = await app.request('/posts/123')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '123', title: 'Post 123' })
  })

  it('POST /posts creates a post', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hello' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })
})
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

For typed tests, `testClient(app)` from `hono/testing` builds an `hc` client whose `fetch` is `app.request`, so routes are called as typed methods; see [[RPC Client (hc)]] and [[Factory, Testing, Proxy and Other Helpers]].

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Next steps

- [[The Hono App]]: grouping with `route`, `basePath`, `mount` and the constructor options.
- [[Request Lifecycle and Middleware Composition]]: how middleware and handlers run.
- [[Context]] and [[HonoRequest]]: everything available on `c` and `c.req`.
- [[Validator]]: validating request bodies, queries and params.

Sources: [src/hono-base.ts:98-125](repo://src/hono-base.ts#L98-L125)
