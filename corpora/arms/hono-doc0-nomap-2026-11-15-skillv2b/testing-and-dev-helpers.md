---
title: "Testing, Route and Dev Helpers"
---
## Overview

Four small helpers answer questions about the app rather than serve requests. `hono/testing` gives tests a typed client that calls the app without a network. `hono/route` tells a handler which registered route matched. `hono/dev` lists an app's routes and reports which router it uses. `hono/adapter` detects the runtime and reads environment variables in a portable way. None of them changes how requests are dispatched.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27), [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79), [src/helper/adapter/index.ts:10-90](repo://src/helper/adapter/index.ts#L10-L90)

## testClient

`testClient(app, env?, executionCtx?, options?)` returns `hc<typeof app>('http://localhost', { ...options, fetch })` where `fetch` calls `app.request(input, init, env, executionCtx)`. Requests therefore go straight into the app's `fetch`, with the bindings and execution context a test supplies, while keeping all of the RPC client's typing ([[RPC Client]]).

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)

```ts
import { testClient } from 'hono/testing'

const app = new Hono().get('/search', (c) => c.json({ q: c.req.query('q') }))

it('searches', async () => {
  const res = await testClient(app).search.$get({ query: { q: 'hono' } })
  expect(await res.json()).toEqual({ q: 'hono' })
})
```

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

Typing only works when the app's routes are chained, as for the RPC client. For untyped tests, `app.request(path, init)` is enough ([[Quickstart]]).

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## Route helper

### Which route matched

`matchedRoutes(c)` returns the `RouterRoute` records of every handler matched for the request, middleware included, read from the match result through the `GET_MATCH_RESULT` symbol on `c.req`. `routePath(c, index?)` returns the registered path of the handler currently running (or of the route at `index`, negative values counting from the end), such as `/posts/:id`. `baseRoutePath(c, index?)` returns the base path the route was registered under, such as `/api/:version` for a sub-app mounted there.

Sources: [src/helper/route/index.ts:1-83](repo://src/helper/route/index.ts#L1-L83)

"Currently running" comes from `c.req.routeIndex`, which `compose` updates before each handler, so the same helper returns different paths in a middleware and in the final handler ([[Request Dispatch and Middleware Composition]]).

Sources: [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

### The actual base path

`basePath(c, index?)` returns the concrete prefix of the current URL that corresponds to the route's base path: for a sub-app mounted at `/api/:version`, a request to `/api/v2/users` gives `/api/v2`. A base path without parameters or wildcards is returned as is. Otherwise it is split into segments, each pattern segment is matched against the request path to measure how many characters it consumed, and the request path is cut at that length. Results are cached per context and index in a `WeakMap`.

Sources: [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)

These helpers replace the deprecated `c.req.matchedRoutes` and `c.req.routePath` ([[HonoRequest: Params, Query, Headers and Body]]). Typical uses are logging metrics by route pattern instead of raw URL, and building links relative to where a sub-app is mounted.

Sources: [src/request.ts:389-442](repo://src/request.ts#L389-L442)

## Dev helper

| Function | Returns |
| --- | --- |
| `inspectRoutes(app)` | One `{ path, method, name, isMiddleware }` per entry of `app.routes` |
| `showRoutes(app, { verbose?, colorize? })` | Prints routes to the console, one line per method and path |
| `getRouterName(app)` | The router's name after forcing it to initialise, such as `SmartRouter + RegExpRouter` |

Sources: [src/helper/dev/index.ts:11-79](repo://src/helper/dev/index.ts#L11-L79)

`inspectRoutes` unwraps sub-app error-handler wrappers with `findTargetHandler`, names each handler by its function name or `[middleware]`/`[handler]`, and classifies middleware by parameter count with `isMiddleware`. `showRoutes` hides middleware unless `verbose` is set, aligns methods and paths in columns, prints handler names under each route in verbose mode, and colours methods unless colour is disabled by `NO_COLOR` ([[Logger, Server Timing, Request ID and Powered-By]]).

Sources: [src/helper/dev/index.ts:23-74](repo://src/helper/dev/index.ts#L23-L74), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

`getRouterName` calls `app.router.match('GET', '/')` first because `SmartRouter` only picks its router on the first match ([[Routers and Presets]]). Calling it seals the router, so routes cannot be added afterwards.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-19](repo://src/router/smart-router/router.ts#L13-L19)

## Adapter helper

### getRuntimeKey

`getRuntimeKey()` returns `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` against known prefixes (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then checks for the `EdgeRuntime` global (Vercel Edge), the `fastly` global, and `process.release.name === 'node'` for Node.js versions older than 21.1 that lack `navigator.userAgent`.

Sources: [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

### env

`env<T>(c, runtime?)` returns environment variables as an object, from wherever the runtime keeps them.

Sources: [src/helper/adapter/index.ts:10-24](repo://src/helper/adapter/index.ts#L10-L24)

| Runtime | Source |
| --- | --- |
| `node`, `bun`, `edge-light` | `process.env` |
| `deno` | `Deno.env.toObject()` |
| `workerd` | `c.env` (the Worker's bindings) |
| `fastly`, `other` | `{}` |

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

Code that reads configuration through `env(c)` runs unchanged on Workers and on Node.js, which is what the runtime tests check for each platform ([[Build, Package Exports and Testing]]). The `runtime` argument overrides detection, which is useful in tests.

Sources: [src/helper/adapter/index.ts:23-40](repo://src/helper/adapter/index.ts#L23-L40), [runtime-tests/node/index.test.ts:17-40](repo://runtime-tests/node/index.test.ts#L17-L40)
