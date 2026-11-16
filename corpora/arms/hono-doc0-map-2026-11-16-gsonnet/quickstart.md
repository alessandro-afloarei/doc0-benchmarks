---
title: "Quickstart"
---
## Overview

This page takes you from an empty file to a running app, shows how to call it without a server, and explains the three presets. For the pipeline behind these calls see [[Application and Request Dispatch]]; for the big picture see [[Hono Overview]].

Sources: [src/hono-base.ts:406-485](repo://src/hono-base.ts#L406-L485)

The README scaffolds a project with `npm create hono@latest`.

Sources: [README.md:35-39](repo://README.md#L35-L39)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

## Create an app

1. Import `Hono` from `hono` and create an instance.
2. Register handlers with the method helpers. A handler receives a `Context` ([[Context and Responses]]) and returns a `Response`; `c.text` builds a text one.
3. Export the app. Runtimes that follow the module-worker convention call its `fetch` method.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [README.md:26-33](repo://README.md#L26-L33)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/index.ts:1-14](repo://src/index.ts#L1-L14)

A method helper takes either `(path, ...handlers)` or `(...handlers)`. In the second form the path from the last call is used again, which is how `app.get('/a', h1).post(h2)` registers two methods on one path. `app.use(handler)` without a path registers the handler as middleware for `*`, and `app.on(method, path, ...handlers)` accepts arrays for both method and path.

Sources: [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168)

## Call the app without a server

`app.request` is meant for tests. A string or URL that is not absolute is placed on `http://localhost`, and the resulting `Request` goes to `fetch`. A real `Request` can be passed too, optionally with a `RequestInit` that is merged into a new request.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

```ts
const res = await app.request('/hello')
expect(res.status).toBe(200)
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

`fetch(request, env, executionCtx)` is the real entry point: the second and third arguments become `c.env` and the execution context, which adapters such as [[Runtime Adapters]] supply. Any path that no route matches receives `404 Not Found`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/hono-base.ts:31-33](repo://src/hono-base.ts#L31-L33)

## Choose a preset

All three presets extend `HonoBase` and differ only in the router they assign. Import the one that fits your size and speed trade-off.

Sources: [src/hono.ts:16-34](repo://src/hono.ts#L16-L34), [src/preset/quick.ts:12-20](repo://src/preset/quick.ts#L12-L20), [src/preset/tiny.ts:9-20](repo://src/preset/tiny.ts#L9-L20)

| Import | Router used | Source |
| --- | --- | --- |
| `hono` | `SmartRouter` over `RegExpRouter` then `TrieRouter` | `src/hono.ts` |
| `hono/quick` | `SmartRouter` over `LinearRouter` then `TrieRouter` | `src/preset/quick.ts` |
| `hono/tiny` | `PatternRouter` | `src/preset/tiny.ts` |

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:12-20](repo://src/preset/quick.ts#L12-L20), [src/preset/tiny.ts:9-20](repo://src/preset/tiny.ts#L9-L20)

The README describes the `hono/tiny` preset as under 12kB. How each router matches is covered in [[Router Interface and Selection]] and [[RegExpRouter and TrieRouter]]. With the default `Hono` class you can pass your own router, as in `new Hono({ router: new RegExpRouter() })`: the constructor uses `options.router` when given and builds the `SmartRouter` only otherwise.

Sources: [README.md:44](repo://README.md#L44), [src/hono-base.ts:55-65](repo://src/hono-base.ts#L55-L65), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## Add middleware and validation

Middleware are ordinary handlers that call `await next()`; each built-in lives under its own subpath such as `hono/cors`. The [[Built-in Middleware Catalogue]] and [[Authentication Middleware and JWT]] pages list them, and [[Validation]] covers typed input checking.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [package.json:13-48](repo://package.json#L13-L48)

## Run this repository's tests

The project uses Bun as its package manager. After cloning, install with the frozen lockfile, then run the test script, which type-checks the spec project and runs vitest once.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [package.json:13-15](repo://package.json#L13-L15)

```bash
bun install --frozen-lockfile
bun run test
```

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [package.json:13-15](repo://package.json#L13-L15)

Runtime-specific suites have their own scripts (`test:deno`, `test:bun`, `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge`); see [[Build and Package Layout]].

Sources: [package.json:13-23](repo://package.json#L13-L23)
