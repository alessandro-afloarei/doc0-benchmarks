---
title: "Quickstart"
---
## Overview

This page builds a small Hono application, serves it on a runtime and tests it without a server. It uses only the public API; [[Hono App and Route Registration]] and [[Context and Responses]] explain what each call does underneath.

Sources: [README.md:22-39](repo://README.md#L22-L39)

## Create a project

The fastest start is the project generator, which asks for a target runtime and writes a ready-to-run template:

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

To add Hono to an existing project, install the `hono` package (`npm install hono`, `bun add hono`, or `deno add jsr:@hono/hono` on Deno). The package has no runtime dependencies and needs Node.js 16.9 or later when run on Node.

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:696-698](repo://package.json#L696-L698)

## Write the app

```ts
import { Hono } from 'hono'
import { logger } from 'hono/logger'

const app = new Hono()

app.use(logger())

app.get('/', (c) => c.text('Hono!'))

app.get('/posts/:id', (c) => {
  const id = c.req.param('id')
  return c.json({ id, title: `Post ${id}` })
})

app.post('/posts', async (c) => {
  const body = await c.req.json()
  return c.json(body, 201)
})

export default app
```

Sources: [src/hono-base.ts:126-173](repo://src/hono-base.ts#L126-L173), [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

What each line does:

- `new Hono()` creates the application with the default router ([[Routers and Presets]]).
- `app.use(logger())` registers middleware for every method and the path `*`; middleware runs before the handler and resumes after it ([[Request Dispatch and Middleware Composition]]).
- `app.get(path, handler)` registers a handler. `:id` is a path parameter read with `c.req.param('id')` ([[HonoRequest: Params, Query, Headers and Body]]).
- `c.text` and `c.json` build a `Response` with the right `Content-Type`; a second argument sets the status ([[Context and Responses]]).
- `export default app` works on runtimes that look for a default export with a `fetch` method.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/context.ts:682-722](repo://src/context.ts#L682-L722)

## Run it

| Runtime | How the app is served |
| --- | --- |
| Cloudflare Workers | `export default app`, then `wrangler dev` |
| Bun | `export default app`, then `bun run src/index.ts` |
| Deno | `Deno.serve(app.fetch)` |
| Node.js | `serve(app)` from `@hono/node-server` |
| AWS Lambda | `export const handler = handle(app)` from `hono/aws-lambda` |
| Vercel, Netlify, Cloudflare Pages | `handle(app)` from the matching `hono/<platform>` adapter |

Every row passes the same `app.fetch(request, env, executionCtx)` to the platform; adapters only translate the platform's event into a `Request` first. See [[Cloudflare, Deno, Bun, Vercel, Netlify and Service Worker Adapters]] and [[AWS Lambda and Lambda@Edge]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/aws-lambda/handler.ts:239-260](repo://src/adapter/aws-lambda/handler.ts#L239-L260), [runtime-tests/node/index.test.ts:1-40](repo://runtime-tests/node/index.test.ts#L1-L40)

## Test it without a server

`app.request()` accepts a path, URL or `Request`, prefixes bare paths with `http://localhost`, and calls `fetch` directly, so tests need no listening port:

```ts
import { describe, expect, it } from 'vitest'
import app from './index'

describe('posts', () => {
  it('returns a post', async () => {
    const res = await app.request('/posts/1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: '1', title: 'Post 1' })
  })

  it('creates a post', async () => {
    const res = await app.request('/posts', {
      method: 'POST',
      body: JSON.stringify({ title: 'Hello' }),
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(201)
  })
})
```

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

The third and fourth arguments pass `env` bindings and an execution context, for code that reads `c.env`. For typed calls, `testClient` from `hono/testing` wraps the same mechanism in the RPC client ([[Testing, Route and Dev Helpers]]).

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## Handle errors and 404s

```ts
import { HTTPException } from 'hono/http-exception'

app.get('/admin', () => {
  throw new HTTPException(401, { message: 'Unauthorized' })
})

app.notFound((c) => c.json({ message: 'Not Found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse()
  }
  return c.json({ message: 'Internal Server Error' }, 500)
})
```

Sources: [src/http-exception.ts:1-78](repo://src/http-exception.ts#L1-L78)

Without these, Hono answers `404 Not Found` as text for unmatched routes, turns an `HTTPException` into its own response, and logs any other error before answering `500 Internal Server Error` ([[Request Dispatch and Middleware Composition]]).

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Next steps

- Group routes into sub-apps with `app.route()`: [[Hono App and Route Registration]].
- Validate input and get a typed client: [[Validator]] and [[RPC Client]].
- Add built-in middleware such as [[CORS, CSRF and Secure Headers]] or [[JWT and JWK Authentication]].
- Render HTML with JSX: [[JSX Server Rendering]].

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53)
