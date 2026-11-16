---
title: "Quickstart"
---
## Overview

This page walks one small app from its constructor to a `Response`. It shows the calls a user makes and names the code each call reaches, so you can follow the rest of the docs. The steps are the same on every runtime: only the way the app is started changes, and [[Runtime Adapters]] covers that.

Sources: [src/index.ts:6-14](repo://src/index.ts#L6-L14)

## Create an app and a route

The package example creates a `Hono` instance, registers a `GET /` handler that returns text, and exports the app as the default export. The handler receives the `Context` and returns a `Response`, built here by `c.text`.

Sources: [src/index.ts:6-14](repo://src/index.ts#L6-L14)

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [src/index.ts:6-14](repo://src/index.ts#L6-L14)

`app.get` stores the handler against the method and path; [[Registering Routes]] shows how the entry is kept. `c.text` builds a `text/plain` response, as [[Context]] explains.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/context.ts:682-688](repo://src/context.ts#L682-L688)

## Send a request

A runtime calls the app's `fetch` with a `Request`. The app answers with a `Response`, which is a Web Standard object, so the same call works in any runtime that provides one.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

```ts
const response = await app.fetch(new Request('http://localhost/'))
console.log(await response.text()) // "Hono!"
```

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

`fetch` passes the request, bindings and execution context to the dispatch step. [[Request Dispatch]] follows that call through the router and the `Context`.

Sources: [src/hono-base.ts:406-418](repo://src/hono-base.ts#L406-L418)

For tests the app offers `request`, which takes a path or a full URL and builds the `Request` for you. A bare path gets `http://localhost` in front of it.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
const res = await app.request('/')
expect(res.status).toBe(200)
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517), [src/hono-base.ts:492-494](repo://src/hono-base.ts#L492-L494)

## Choose a preset

The default `Hono` class uses a `SmartRouter` over a `RegExpRouter` and a `TrieRouter`. Two presets change that choice. `preset/tiny` uses a `PatternRouter` alone, and `preset/quick` uses a `SmartRouter` over a `LinearRouter` and a `TrieRouter`. [[Router Selection]] explains how each router is chosen and used.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/tiny.ts:14-19](repo://src/preset/tiny.ts#L14-L19), [src/preset/quick.ts:14-23](repo://src/preset/quick.ts#L14-L23)

## Add a middleware

`app.use` registers a handler for every method and path, or for a path you give. It is stored in the same route list as the handlers, in the order it was added, and it calls `next` to pass control on. [[Built-in Middleware]] lists the middleware the package ships, and [[Request Dispatch]] shows how `next` moves through them.

Sources: [src/hono-base.ts:157-168](repo://src/hono-base.ts#L157-L168), [src/compose.ts:32-51](repo://src/compose.ts#L32-L51)

## Next

- [[Context]]: the response helpers and values shared between handlers.
- [[HonoRequest]]: how a handler reads params, query, headers and bodies.
- [[Runtime Adapters]]: how the same app is started on Bun, Deno, Workers and Lambda.

Sources: [src/context.ts:293-300](repo://src/context.ts#L293-L300), [src/request.ts:36-40](repo://src/request.ts#L36-L40), [src/adapter/bun/index.ts:1-11](repo://src/adapter/bun/index.ts#L1-L11)
