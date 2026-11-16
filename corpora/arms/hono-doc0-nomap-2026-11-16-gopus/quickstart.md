---
title: "Quickstart"
---
## Overview

This page builds a small Hono app: two routes, one middleware, an export a runtime can serve, and a test that calls the app without a server. Each step names the page that explains the part it uses; the flow they share is drawn in [[Hono Overview]].

Sources: [README.md:26-33](repo://README.md#L26-L33)

## Create a project

The README's starter command scaffolds a project for a chosen runtime:

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project, install the `hono` package. It has no runtime dependencies and needs Node.js 16.9 or later when it runs on Node.

Sources: [package.json:1-12](repo://package.json#L1-L12), [package.json:696-698](repo://package.json#L696-L698)

## Define routes

Create an app with `new Hono()` and register a handler per method and path. A handler receives the Context `c` and returns a `Response`; `c.text` sets `text/plain` and `c.json` serializes its argument with `JSON.stringify` and sets `application/json`. A `:name` segment in the path is read back with `c.req.param('name')`.

Sources: [src/context.ts:670-721](repo://src/context.ts#L670-L721), [src/request.ts:95-104](repo://src/request.ts#L95-L104)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})
```

Sources: [src/context.ts:670-721](repo://src/context.ts#L670-L721), [src/request.ts:95-104](repo://src/request.ts#L95-L104)

Registration methods, grouping with `app.route()` and `basePath()`, and the options of `new Hono()` are on [[Application and Routing]]. Every response helper on `c` is on [[Context and Responses]], and every way to read the request is on [[HonoRequest]].

Sources: [src/hono-base.ts:126-173](repo://src/hono-base.ts#L126-L173)

## Add a middleware

`app.use(middleware)` registers a handler for every method and path (`*`). A middleware runs code before and after the rest of the chain by awaiting `next()`. The built-in `logger` does exactly that: it logs the incoming method and path, awaits `next()`, then logs the status and the time taken.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

```ts
import { logger } from 'hono/logger'

app.use(logger())
```

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

Order matters: middleware and handlers run in the order they were registered, as [[Request Lifecycle and Error Handling]] traces. The built-in middleware is grouped by kind, starting with [[Security Middleware]] and [[Authentication Middleware]].

Sources: [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)

## Export the app

The app's entry point is `app.fetch(request, env, executionCtx)`. Runtimes that call a default export's `fetch` method, such as Cloudflare Workers, Deno and Bun, serve the app as it is:

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

```ts
export default app
```

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

Other platforms receive events in their own shape and need an adapter that converts them. On AWS Lambda, `handle(app)` from `hono/aws-lambda` returns the Lambda handler:

Sources: [src/adapter/aws-lambda/handler.ts:209-243](repo://src/adapter/aws-lambda/handler.ts#L209-L243)

```ts
import { handle } from 'hono/aws-lambda'

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:209-243](repo://src/adapter/aws-lambda/handler.ts#L209-L243)

[[Runtime Adapters]] lists the adapter for each platform, and [[AWS Lambda and Lambda@Edge]] covers the Lambda event formats.

Sources: [src/adapter/vercel/handler.ts:4-8](repo://src/adapter/vercel/handler.ts#L4-L8)

## Test without a server

`app.request` builds a `Request` and passes it to `app.fetch`. A string without a scheme is treated as a path on `http://localhost`, and the optional arguments are the `RequestInit`, the bindings and the execution context.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
test('GET /users/42', async () => {
  const res = await app.request('/users/42')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ id: '42' })
})
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

For typed tests, `testClient(app)` from `hono/testing` returns an RPC client whose `fetch` is `app.request`, so calls are checked against the app's routes at compile time: see [[RPC Client]].

Sources: [src/helper/testing/index.ts:14-27](repo://src/helper/testing/index.ts#L14-L27)
