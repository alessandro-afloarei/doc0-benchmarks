---
title: "Quickstart"
---
## Overview

This page builds a small Hono app, adds middleware, tests it without a server, and exports it for a runtime. Every step uses only the public API; [[Hono Application]] explains what each call does inside.

Sources: [README.md:24-39](repo://README.md#L24-L39)

## Create a project

The fastest start is the project generator, which asks for a target runtime and writes a template for it:

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project, install the `hono` package. It has no runtime dependencies and runs on Node.js 16.9 or later as well as on edge runtimes.

Sources: [package.json:668-699](repo://package.json#L668-L699)

## Write the app

An app is a `Hono` instance. Each method call (`get`, `post`, `put`, `delete`, `patch`, `options`, `all`) registers handlers for a path, and `use` registers middleware for every method. A handler receives the context `c` and returns a `Response`, usually through a helper such as `c.text` or `c.json`.

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168)

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.text('Hono!'))

app.get('/posts/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

app.post('/posts', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})

export default app
```

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/request.ts:100-150](repo://src/request.ts#L100-L150)

`app.use(logger())` with no path registers the middleware on `*`, so it wraps every route. Middleware and handlers run in the order they were registered; a middleware calls `await next()` to run the rest of the chain. [[Middleware Composition and Error Handling]] covers the chain and [[Context and Responses]] lists the response helpers.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

## Test it without a server

`app.request` builds a `Request` from a path or URL and passes it to `app.fetch`, so a test needs no listening socket. A bare path is resolved against `http://localhost`.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
import { describe, expect, it } from 'vitest'
import app from './app'

describe('app', () => {
  it('answers GET /', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hono!')
  })

  it('creates a post', async () => {
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

A path that matches no route answers `404 Not Found` from the default not-found handler, and an uncaught error answers `500 Internal Server Error` after being logged. Both can be replaced with `app.notFound` and `app.onError`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Run it on a runtime

Runtimes that call an exported object's `fetch` (Cloudflare Workers, Bun, Deno) run `export default app` as it is. Others take an adapter that wraps the app:

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

| Runtime | Entry |
| --- | --- |
| Cloudflare Workers, Bun | `export default app` |
| Deno | `Deno.serve(app.fetch)` |
| Service Worker | `fire(app)` from `hono/service-worker` |
| AWS Lambda | `export const handler = handle(app)` from `hono/aws-lambda` |
| Cloudflare Pages | `export const onRequest = handle(app)` from `hono/cloudflare-pages` |
| Vercel, Netlify | `handle(app)` from `hono/vercel` or `hono/netlify` |

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/service-worker/index.ts:28-36](repo://src/adapter/service-worker/index.ts#L28-L36), [src/adapter/service-worker/handler.ts:18-37](repo://src/adapter/service-worker/handler.ts#L18-L37)

[[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]] explain what each adapter converts. On Bun, `getBunServer(c)` returns the Bun server object passed as the app's env.

Sources: [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

## Pick a preset

`hono` uses the fastest router for long-running servers. Two presets trade that for size or start-up time and are imported in place of `hono`:

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

```ts
import { Hono } from 'hono/tiny' // PatternRouter: smallest bundle
// or
import { Hono } from 'hono/quick' // LinearRouter: no compile step on start
```

Sources: [src/preset/tiny.ts:11-19](repo://src/preset/tiny.ts#L11-L19), [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24)

[[Routing and Router Selection]] compares the routers: `RegExpRouter` compiles every route into one regular expression, which is fastest per request but costs a build step on the first request.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## Next steps

- Group routes into sub-apps with `app.route` and `basePath`: [[Hono Application]].
- Validate input and type it end to end: [[Validation]], [[RPC Client]].
- Add authentication and security headers: [[Basic and Bearer Authentication]], [[CORS, CSRF and Secure Headers]].
- Render HTML with JSX: [[JSX Server Rendering]].

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253)
