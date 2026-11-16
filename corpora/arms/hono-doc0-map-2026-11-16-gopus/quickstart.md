---
title: "Quickstart"
---
## Overview

This page builds a small Hono app, runs it on a runtime and tests it without a server. Each step names the page that explains the part it uses; the [[Hono Overview]] shows how the parts fit together.

Sources: [README.md:24-39](repo://README.md#L24-L39)

## Create a project

The README's quick start scaffolds a project with the `create-hono` starter, which asks for the runtime to target:

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project instead, install the `hono` package. Its `package.json` declares ESM and CommonJS builds for every subpath, so `import { Hono } from 'hono'` works in both module systems.

Sources: [package.json:1-48](repo://package.json#L1-L48)

## Write the app

An app is a `Hono` instance. `get`, `post`, `put`, `delete`, `options`, `patch` and `all` register a handler for one method; `use` registers middleware that runs for every method. Every handler receives the Context `c` and returns a `Response`.

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168)

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.text('Hono!'))

app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  const page = c.req.query('page')
  return c.json({ id, page })
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})

export default app
```

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168), [src/request.ts:94-150](repo://src/request.ts#L94-L150), [src/request.ts:253-268](repo://src/request.ts#L253-L268), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

`c.text` and `c.json` set the `Content-Type` header for you and take an optional status code as their second argument. When `c.text` is called with no status, no headers and nothing prepared on the context, it answers a bare `new Response(text)` without copying headers. The full set of response builders is on [[Context and Responses]]; params, query strings and bodies are on [[HonoRequest]].

Sources: [src/context.ts:682-721](repo://src/context.ts#L682-L721)

A path with no handler answers `404 Not Found`, and an uncaught error answers `500 Internal Server Error` after logging it. `app.notFound()` and `app.onError()` replace both, as [[Hono Application]] explains.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Run it

`app.fetch` has the signature `(request, env?, executionCtx?)`. Cloudflare Workers, Deno and Bun all call the `fetch` of a module's default export with a `Request`, so `export default app` is enough on those runtimes.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

Other environments use an adapter that converts their event into a `Request`. A Service Worker, for example, registers the app with `fire`, which adds a `fetch` event listener that calls `app.fetch` and, by default in `handle`, falls back to the network `fetch` when the app answers 404:

Sources: [src/adapter/service-worker/handler.ts:18-36](repo://src/adapter/service-worker/handler.ts#L18-L36)

```ts
import { Hono } from 'hono'
import { fire } from 'hono/service-worker'

const app = new Hono()

app.get('/', (c) => c.text('Hi'))

fire(app)
```

Sources: [src/adapter/service-worker/index.ts:10-34](repo://src/adapter/service-worker/index.ts#L10-L34), [src/adapter/service-worker/handler.ts:18-36](repo://src/adapter/service-worker/handler.ts#L18-L36)

The adapters for AWS Lambda, Lambda@Edge, Cloudflare Pages, Netlify and Vercel are described in [[AWS Lambda and Lambda@Edge]] and [[Runtime Adapters]]. Runtime-specific bindings arrive as the `env` argument and are typed through the app's `Bindings` generic; on Bun, `getBunServer(c)` reads the server object from `c.env`.

Sources: [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14), [src/hono.ts:16-20](repo://src/hono.ts#L16-L20)

## Test it

`app.request` sends a request through the app in memory. It accepts a `Request`, a full URL or just a path; a path is prefixed with `http://localhost`. It returns the app's `Response`, so a test can check the status and body directly:

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
test('GET /users/123', async () => {
  const res = await app.request('/users/123?page=2')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ id: '123', page: '2' })
})
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

`app.request` also takes a `RequestInit`, the bindings and an execution context as its second to fourth arguments, which lets a test pass the same `env` a runtime would. For typed calls against the app's routes, the [[RPC Client]] page describes `testClient`.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## Next steps

- Group routes into sub-apps with `app.route()` and add a base path with `basePath()`: [[Hono Application]].
- Write your own middleware with `await next()`: [[Request Dispatch and Middleware]].
- Validate input and share the app's type with a client: [[Validator]] and [[RPC Client]].
- Render HTML with JSX: [[JSX Server Rendering]].

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)
