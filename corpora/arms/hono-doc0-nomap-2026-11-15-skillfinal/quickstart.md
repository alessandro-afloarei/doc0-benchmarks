---
title: "Quickstart"
---
## Overview

This page builds a first Hono app: create it, add routes and middleware, test it without a server, and hand it to a runtime. Every step uses the plain `Hono` class from the package root, which [[The Hono App and Route Registration]] covers in depth.

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53)

The README names `npm create hono@latest` as the way to scaffold a project with a runtime template already chosen. The steps below show what such a project contains.

Sources: [README.md:35-39](repo://README.md#L35-L39)

## Write the app

### Step 1: create the app and a route

A handler receives the [[Context]] `c` and returns a `Response`, here built by `c.text()`. `app.get(path, ...handlers)` registers each handler for `GET` on that path.

Sources: [src/hono-base.ts:126-142](repo://src/hono-base.ts#L126-L142)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33)

### Step 2: add middleware

`app.use(handler)` without a path string registers the middleware for method `ALL` on path `*`, so it runs for every route. Middleware runs in registration order, as [[Request Lifecycle and Middleware Composition]] explains; the built-in logger prints each request, then its status and duration after `await next()`.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

```ts
const app = new Hono()

app.use(logger())
app.get('/', (c) => c.text('Hello Hono!'))
```

Sources: [src/middleware/logger/index.ts:73-79](repo://src/middleware/logger/index.ts#L73-L79)

### Step 3: read input and return JSON

Handlers read the path, query, headers and body through `c.req` ([[HonoRequest]]) and answer with helpers such as `c.json()`, which serializes the value and sets `Content-Type: application/json`.

Sources: [src/request.ts:94-152](repo://src/request.ts#L94-L152), [src/context.ts:708-721](repo://src/context.ts#L708-L721)

## Test it without a server

`app.request()` accepts a path, a URL or a `Request`. A bare path is prefixed with `http://localhost`, and the request goes straight to `app.fetch`, so a test needs no listening port. The third and fourth arguments are the environment bindings and execution context passed through to `fetch`, so a test can supply the same `c.env` a runtime would.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
test('GET /hello is ok', async () => {
  const res = await app.request('/hello')
  expect(res.status).toBe(200)
})
```

Sources: [src/hono-base.ts:487-498](repo://src/hono-base.ts#L487-L498)

For calls typed from the routes, `testClient` from `hono/testing` builds the [[RPC Client]] with a `fetch` that calls `app.request`.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Run it on a runtime

### Runtimes that call fetch

The README example ends with `export default app`. The exported instance carries `fetch(request, Env, executionCtx)`, so a runtime that calls a default export's `fetch` runs the app directly, and the bindings and execution context it passes become `c.env` and `c.executionCtx` in the [[Context]].

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

### Runtimes with their own event shape

Other platforms call a function with their own arguments, so an adapter's `handle(app)` converts them. The Vercel adapter passes the `Request` straight through; the AWS Lambda adapter turns an API Gateway, ALB or function URL event into a `Request` and the `Response` back into a Lambda result.

Sources: [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8), [src/adapter/aws-lambda/handler.ts:199-209](repo://src/adapter/aws-lambda/handler.ts#L199-L209)

```js
import { Hono } from 'hono'
import { handle } from 'hono/aws-lambda'

const app = new Hono()

app.get('/', (c) => c.text('Hello from Lambda'))
app.get('/json', (c) => c.json({ message: 'Hello JSON' }))

export const handler = handle(app)
```

Sources: [src/adapter/aws-lambda/handler.ts:211-222](repo://src/adapter/aws-lambda/handler.ts#L211-L222)

The Lambda `handle` returns an async function that builds the `Request` with the event's processor, calls `app.fetch` with the event and Lambda context as bindings, and converts the result; [[AWS Lambda and Lambda@Edge]] follows that conversion, and [[Runtime Adapters]] lists the entry point for every other runtime.

Sources: [src/adapter/aws-lambda/handler.ts:239-276](repo://src/adapter/aws-lambda/handler.ts#L239-L276)

## Choose a preset

`hono` uses the `SmartRouter` default, `hono/tiny` builds the same app on `PatternRouter`, and `hono/quick` on a `SmartRouter` of `LinearRouter` and `TrieRouter`. All three export a class named `Hono` with the same API, so switching is a change of import; [[Routers and Router Selection]] explains the trade-offs.

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34), [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20), [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24)
