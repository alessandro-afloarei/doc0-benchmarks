---
title: "Quickstart"
---
## Overview

This page builds a small Hono application, tests it without a server, and runs it on a runtime. A Hono app is a `Hono` instance with routes; the runtime calls its `fetch` method for each request, so the code below is the same on every platform until the last step.

Sources: [README.md:26-39](repo://README.md#L26-L39), [src/index.ts:40-53](repo://src/index.ts#L40-L53)

## Create a project

The starter generator scaffolds a project for a chosen runtime.

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project instead, install the `hono` package. It has no dependencies; every feature is a subpath import such as `hono/logger` or `hono/cors`, listed in the package's `exports`.

Sources: [package.json:1-12](repo://package.json#L1-L12), [package.json:41-60](repo://package.json#L41-L60)

## Write the app

The app below registers a logger, three routes, an error case and a custom 404.

Sources: [src/hono-base.ts:126-173](repo://src/hono-base.ts#L126-L173)

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { HTTPException } from 'hono/http-exception'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.text('Hono!'))

app.get('/posts/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

app.post('/posts', async (c) => {
  const body = await c.req.json()
  if (!body.title) {
    throw new HTTPException(400, { message: 'title is required' })
  }
  return c.json(body, 201)
})

app.notFound((c) => c.text('Nothing here', 404))

export default app
```

Sources: [src/hono-base.ts:126-173](repo://src/hono-base.ts#L126-L173), [src/http-exception.ts:44-78](repo://src/http-exception.ts#L44-L78)

`app.use(logger())` registers middleware for every path and method, because `use` without a path registers on `*` with the `ALL` method. `app.get` and `app.post` add handlers for one method. A thrown `HTTPException` reaches the default error handler, which turns it into a response with its status; any other error becomes a 500. `notFound` replaces the default `404 Not Found` text response. [[Application and Route Registration]] covers the registration methods, and [[Request Lifecycle and Middleware Composition]] what happens to each request.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:291-294](repo://src/hono-base.ts#L291-L294), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

Inside a handler, `c` is the [[Context and Response Building]] object: `c.text`, `c.json` and `c.html` build the `Response`, and `c.req` is the [[HonoRequest]] with `param`, `query`, `header` and the body readers.

Sources: [src/context.ts:682-733](repo://src/context.ts#L682-L733), [src/request.ts:94-171](repo://src/request.ts#L94-L171)

## Test it without a server

`app.request()` accepts a path, a URL or a `Request`. A bare path is prefixed with `http://localhost`, and the request goes straight to `app.fetch`, so a test needs no network.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
import { describe, expect, it } from 'vitest'
import app from './app'

describe('app', () => {
  it('returns a post', async () => {
    const res = await app.request('/posts/42')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '42' })
  })

  it('rejects a post without a title', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
  })
})
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

For typed calls, `testClient(app)` from `hono/testing` returns an [[RPC Client]] whose `fetch` is `app.request`, so tests call routes as typed methods; see [[Helpers Catalogue]].

Sources: [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## Run it

How the app is started depends on the runtime. [[Runtime Adapters]] lists them all; the table shows the common cases.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

| Runtime | Entry |
| --- | --- |
| Cloudflare Workers, Bun, Deno | `export default app`: the runtime calls `app.fetch(request, env, ctx)` |
| Deno (explicit) | `Deno.serve(app.fetch)` |
| Vercel | `export const GET = handle(app)` from `hono/vercel` |
| AWS Lambda | `export const handler = handle(app)` from `hono/aws-lambda` |
| Node.js | the separate `@hono/node-server` package |

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/aws-lambda/index.ts:1-14](repo://src/adapter/aws-lambda/index.ts#L1-L14)

Each runtime module also exports what depends on the platform: `serveStatic`, `upgradeWebSocket` and `getConnInfo` for Bun and Cloudflare Workers, and `toSSG` for Bun. [[Serving Static Files]] and [[WebSockets]] explain them.

Sources: [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

## Where to go next

- Add input checks with [[Validation]], then call the API from a browser with the [[RPC Client]].
- Pick middleware from [[Security Middleware]], [[Authentication Middleware]] and [[Response Processing Middleware]].
- Render HTML with [[JSX Server Rendering]].

Sources: [src/validator/validator.ts:86-171](repo://src/validator/validator.ts#L86-L171), [src/client/client.ts:133-140](repo://src/client/client.ts#L133-L140)
