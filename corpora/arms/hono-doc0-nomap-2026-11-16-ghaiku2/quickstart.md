---
title: "Quickstart"
---
## Overview

This page shows the smallest app and the two ways to run it: a runtime calls `fetch()` with each incoming request, or a test calls `app.request()` with a path. Both end in the same `#dispatch` path described in [[Request Dispatch]].

Sources: [src/hono-base.ts:406-419](repo://src/hono-base.ts#L406-L419)

## Create the app

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33)

`Hono` is exported from the package entry, and `new Hono()` with no options uses the default router, which is set by the subclass in `src/hono.ts`.

Sources: [src/index.ts:53-53](repo://src/index.ts#L53-L53), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

`app.get(path, handler)` stores the path in the instance and adds the handler under the `GET` method. A call that passes only handlers registers them under the path from the most recent call that gave one, so `app.get('/a', h1, h2)` registers both handlers for `GET /a`.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141)

## Run it through fetch

A runtime adapter passes each `Request` to `app.fetch`. In the code, `fetch` takes the environment bindings as its second argument and the execution context as its third, then reads the method from the request and calls `#dispatch`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

`#dispatch` matches `GET /` against the router and creates the `Context`. With one matched handler it calls that handler directly and returns its result.

Sources: [src/hono-base.ts:418-448](repo://src/hono-base.ts#L418-L448)

## Test it with app.request

`app.request()` takes a path or a `Request`. A path is turned into a URL on `http://localhost`, and the call then goes through `fetch`, so tests run the same code path as a server.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
const res = await app.request('/')
res.status // 200
await res.text() // 'Hono!'
```

Sources: [src/context.ts:682-695](repo://src/context.ts#L682-L695)

`c.text()` returns `new Response(text)` when no status, headers or options were set, which is why the status is `200`. Passing a status or headers switches to `#newResponse`, which applies them.

Sources: [src/context.ts:682-695](repo://src/context.ts#L682-L695)
