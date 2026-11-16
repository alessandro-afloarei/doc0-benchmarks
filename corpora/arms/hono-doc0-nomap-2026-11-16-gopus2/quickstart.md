---
title: "Quickstart"
---
## Overview

This page builds a small Hono application, tests it without a server, and exports it for a runtime. It uses only the public API: the `Hono` class, the `Context` object every handler receives, and `app.request` for tests. [[Application and Routing API]] explains how the routes are stored, and [[Context]] lists every response helper.

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53)

## Create a project

The README's starting point is the `create-hono` template, which asks for the target runtime and writes a project for it:

Sources: [README.md:37-41](repo://README.md#L37-L41)

```bash
npm create hono@latest
```

Sources: [README.md:37-41](repo://README.md#L37-L41)

To add Hono to an existing project, install the `hono` package. It has no runtime dependencies and only uses the Web Standard API, so the same package serves every runtime.

Sources: [README.md:43-45](repo://README.md#L43-L45), [package.json:1-10](repo://package.json#L1-L10)

## Write the first routes

An app is a `Hono` instance. Each method helper (`get`, `post`, `put`, `delete`, `options`, `patch`, `all`) takes a path and one or more handlers, and returns the app so calls chain. A handler receives the `Context` and returns a `Response`; `c.text` and `c.json` build one with the right `Content-Type`.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/context.ts:682-721](repo://src/context.ts#L682-L721), [src/request.ts:94-105](repo://src/request.ts#L94-L105), [src/request.ts:253-268](repo://src/request.ts#L253-L268)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

app.get('/users/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id })
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})

export default app
```

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/context.ts:682-721](repo://src/context.ts#L682-L721), [src/request.ts:94-105](repo://src/request.ts#L94-L105), [src/request.ts:253-268](repo://src/request.ts#L253-L268)

`c.req` is a [[HonoRequest]]: `param` reads the `:id` segment the router captured, and `json` parses the body. The status passed as the second argument of `c.json` becomes the response status.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639), [src/context.ts:363-369](repo://src/context.ts#L363-L369)

## Add middleware

`app.use` registers middleware for every method. Without a path it applies to `*`, every path. Middleware receives `next` as its second argument: code before `await next()` runs on the way in, code after it runs once the handler has produced the response.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73), [src/context.ts:515-527](repo://src/context.ts#L515-L527)

```ts
app.use(async (c, next) => {
  const start = Date.now()
  await next()
  c.header('X-Response-Time', `${Date.now() - start}ms`)
})

app.use('/admin/*', async (c, next) => {
  if (c.req.header('Authorization') !== 'Bearer secret') {
    return c.text('Unauthorized', 401)
  }
  await next()
})
```

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73), [src/context.ts:515-527](repo://src/context.ts#L515-L527)

Middleware runs in the order it was registered, ahead of any handler registered after it on a matching path. [[Request Lifecycle and Middleware]] traces how `compose` runs the chain, and the Built-in Middleware pages, starting with [[Security Middleware]], list the middleware the package ships.

Sources: [src/compose.ts:15-73](repo://src/compose.ts#L15-L73)

## Handle errors and missing routes

A request no route matches gets `404 Not Found` from the default not-found handler, and an error thrown by a handler gets `500 Internal Server Error` from the default error handler. Both can be replaced:

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

```ts
app.notFound((c) => c.text('No such page', 404))

app.onError((err, c) => {
  console.error(err)
  return c.text('Something went wrong', 500)
})
```

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Test without a server

`app.request` accepts a path, a URL or a `Request`, turns a bare path into `http://localhost/...`, and calls `app.fetch`, so a test runner can check responses directly:

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
const res = await app.request('/users/42')
console.log(res.status) // 200
console.log(await res.json()) // { id: '42' }
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

`testClient` from `hono/testing` goes one step further: it builds an [[RPC Client]] whose fetch is `app.request`, so tests call routes as typed methods.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Run it on a runtime

Runtimes that accept a module with a `fetch` export (Cloudflare Workers, Deno, Bun) run `export default app` as it is, because `app.fetch(request, env, executionCtx)` is the whole interface. Other platforms wrap the app with their adapter's `handle`, such as `hono/aws-lambda` or `hono/vercel`: see [[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/aws-lambda/handler.ts:239-250](repo://src/adapter/aws-lambda/handler.ts#L239-L250)
