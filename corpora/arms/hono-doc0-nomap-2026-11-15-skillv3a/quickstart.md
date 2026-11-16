---
title: "Quickstart"
---
## Overview

This page builds a first Hono application: one with routes, path parameters and middleware, exported so a runtime can serve it, and tested without a server. Every step uses the public API from the `hono` package; the internals behind each step are linked where they matter.

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53)

## Create a project

The starter generator sets up a project for a chosen runtime (Cloudflare Workers, Bun, Deno, Node.js and others) with the right entry file and scripts.

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project instead, install the `hono` package. It has no runtime dependencies, so nothing else comes with it.

Sources: [package.json:1-10](repo://package.json#L1-L10)

## Define routes

A route is a method, a path and one or more handlers. A handler receives the [[Context]] `c` and returns a `Response`, usually through one of the context's builders such as `c.text` or `c.json`. Path parameters written as `:name` are read with `c.req.param`, described in [[HonoRequest]].

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

```ts
import { Hono } from 'hono'

const app = new Hono()

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

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

The method helpers `get`, `post`, `put`, `delete`, `options`, `patch` and `all` exist for the common methods; `app.on(method, path, handler)` registers any other method or several at once. When a handler is passed without a path, it reuses the path of the previous call, which is how `app.get('/a', h1).post(h2)` chains several methods on one path. [[The Hono Application]] describes registration, grouping with `route()` and `basePath()`, and custom 404 and error handlers.

Sources: [src/hono-base.ts:126-154](repo://src/hono-base.ts#L126-L154), [src/router.ts:14-22](repo://src/router.ts#L14-L22)

## Add middleware

Middleware is a handler that calls `await next()` to run the rest of the chain and may act before and after it. `app.use` registers middleware for every method, on `*` when no path is given. Built-in middleware is imported from its own subpath.

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

app.get('/api/hello', (c) => c.json({ message: 'hello' }))
```

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95), [src/middleware/cors/index.ts:63-63](repo://src/middleware/cors/index.ts#L63-L63)

Middleware runs in registration order on the way in and in reverse on the way out, the onion model traced in [[Request Lifecycle and Middleware Composition]]. The built-in middleware is catalogued in [[Access Control Middleware]], [[Response Middleware]], [[Request Utility Middleware]] and [[JWT and JWK Authentication]].

Sources: [src/compose.ts:1-73](repo://src/compose.ts#L1-L73)

## Run it on a runtime

The app object has a `fetch(request, env, executionCtx)` method. Cloudflare Workers, Bun and Deno accept an object with `fetch` as their server entry, so `export default app` is enough there. Platforms whose entry point takes an event, such as AWS Lambda, Vercel, Netlify or Cloudflare Pages Functions, wrap the app with that adapter's `handle` function; see [[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]]. Node.js uses the separate `@hono/node-server` package, which the repository uses in its own tests.

Sources: [src/hono-base.ts:468-485](repo://src/hono-base.ts#L468-L485), [package.json:668-675](repo://package.json#L668-L675)

## Test without a server

`app.request` builds a `Request` and runs it through the app. A bare path is resolved against `http://localhost`, and the optional second to fourth arguments are a `RequestInit`, env bindings and an execution context.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
import { describe, expect, it } from 'vitest'
import app from './app'

describe('app', () => {
  it('GET /posts/:id returns the id', async () => {
    const res = await app.request('/posts/42')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '42' })
  })
})
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

`testClient` from `hono/testing` goes one step further: it builds the typed [[RPC Client]] around `app.request`, so tests call routes as typed methods without a network. The routes must be chained on one expression for their types to reach the client, as [[Typed Routes and Schemas]] explains.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)
