---
title: "Quickstart"
---
## Overview

This page takes you from an empty file to a running Hono app, shows how to test it without starting a server, and lists the commands for working on this repository. The concepts behind each step are in [[Hono Overview]] and [[Application and Request Lifecycle]].

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:12-36](repo://package.json#L12-L36)

## Create an app

The README scaffolds a project with `npm create hono@latest`. The minimal app is a `Hono` instance with one route, exported as the default export so a runtime such as Cloudflare Workers or Bun can call its `fetch`.

Sources: [README.md:35-39](repo://README.md#L35-L39), [src/index.ts:6-15](repo://src/index.ts#L6-L15)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:27-33](repo://README.md#L27-L33), [src/index.ts:6-15](repo://src/index.ts#L6-L15)

The handler receives a `Context` (`c`) and returns a `Response`; `c.text` builds one with a `text/plain` content type (see [[Context and Responses]]). Other runtimes wrap the app with an adapter such as `handle` from `hono/vercel` ([[Runtime Adapters]]).

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694), [src/adapter/vercel/handler.ts:1-8](repo://src/adapter/vercel/handler.ts#L1-L8)

## Pick a preset

`hono` uses `SmartRouter` over `RegExpRouter` and `TrieRouter`. Two other entry points swap the router: `hono/quick` (`LinearRouter` first, then `TrieRouter`) is the other alternative, and `hono/tiny` (`PatternRouter` only) is the lightest, using one router. You can also pass your own router with the `router` option. The routers are compared in [[Router Interface and SmartRouter]].

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/preset/tiny.ts:15-20](repo://src/preset/tiny.ts#L15-L20), [src/hono-base.ts:55-65](repo://src/hono-base.ts#L55-L65)

```ts
import { Hono } from 'hono/quick'
import { Hono as TinyHono } from 'hono/tiny'
```

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/preset/tiny.ts:15-20](repo://src/preset/tiny.ts#L15-L20), [src/hono-base.ts:55-65](repo://src/hono-base.ts#L55-L65)

## Test without a server

`app.request` accepts a path, URL or `Request` and returns the `Response`. A bare path is resolved against `http://localhost`, and the call goes through `app.fetch`, so middleware and error handlers run exactly as in production. Extra arguments pass `env` and an execution context.

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

```ts
test('GET /hello is ok', async () => {
  const res = await app.request('/hello')
  expect(res.status).toBe(200)
})
```

Sources: [src/hono-base.ts:487-517](repo://src/hono-base.ts#L487-L517)

## Work on the repository

The project uses Bun as its package manager. Install with a frozen lockfile, then use the scripts in `package.json`.

Sources: [docs/CONTRIBUTING.md:27-60](repo://docs/CONTRIBUTING.md#L27-L60)

```bash
bun install --frozen-lockfile
bun run test      # type-check specs, then vitest
bun run lint
bun run build
```

Sources: [docs/CONTRIBUTING.md:27-60](repo://docs/CONTRIBUTING.md#L27-L60), [package.json:12-36](repo://package.json#L12-L36)

`test` first type-checks `tsconfig.spec.json` and then runs vitest; there are also per-runtime scripts (`test:node`, `test:workerd`, `test:deno`, `test:bun`, `test:lambda`, …). How these projects are wired is on [[Build, Exports and Testing]].

Sources: [package.json:12-26](repo://package.json#L12-L26)
