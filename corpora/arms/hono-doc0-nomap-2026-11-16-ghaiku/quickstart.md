---
title: "Quickstart"
---
## Overview

This page shows the smallest working app: create a `Hono` instance, register a route, and export the instance so that a runtime can call it. The steps are the same on every runtime. Only the export and the entry command change, and the [[Runtime Adapters]] page covers those differences.

Sources: [README.md:22-24](repo://README.md#L22-L24)

## Create the app

Import `Hono` from the package root, create an instance, and register handlers with the method helpers. The handler `(c) => c.text('Hono!')` takes the context and returns a `Response`; [[Context]] lists the other response builders.

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:27-32](repo://README.md#L27-L32), [src/index.ts:1-53](repo://src/index.ts#L1-L53)

The package root exports the `Hono` class from `src/index.ts`. Creating the instance with no options gives the default router, a `SmartRouter` over `RegExpRouter` and `TrieRouter`, as [[The Hono Class]] describes.

Sources: [src/index.ts:53-53](repo://src/index.ts#L53-L53), [src/hono.ts:27-33](repo://src/hono.ts#L27-L33)

## Export for a runtime

The default export is the app itself. Most runtimes call the app's `fetch` method, which takes a `Request` and returns a `Response`. `fetch` is defined as an arrow function on the instance, so it can be passed around without losing `this`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

Runtime-specific helpers live in adapter modules. For example, the Cloudflare Workers adapter entry exports `serveStatic`, `upgradeWebSocket` and `getConnInfo`.

Sources: [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8)

The package exports a subpath for each adapter. The `./bun` entry points to the Bun adapter, and `./vercel` to the Vercel adapter, so an app imports the adapter it needs by that subpath, for example `hono/bun`.

Sources: [package.json:359-363](repo://package.json#L359-L363), [package.json:369-373](repo://package.json#L369-L373)

## Create a project

The README points to the project generator as the way to start a new app.

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

## Next steps

Read [[Registering Routes]] to see how the method helpers store each route, and [[Request Dispatch]] to see what runs when the app receives a request. Read [[HonoRequest]] to learn how a handler reads the path parameters, query and body.
