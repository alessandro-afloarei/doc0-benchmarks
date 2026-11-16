---
title: "Quickstart"
---
## Overview

A Hono application can be exercised without starting an HTTP server: register a handler and call `app.request`. That method constructs a standard request and sends it through the same `fetch` entry point a runtime uses. This page starts with the repository's Bun setup, then follows a small app into its first response. [[Architecture]] places this entry point within the larger framework.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

## Prepare the checkout

The contribution guide uses Bun as the package manager and installs dependencies from the lockfile. The checkout records Bun `1.2.19`, Node.js `24.7.0` and Deno `2.4.5` in `.tool-versions`; these are the repository's recorded tool versions, rather than a statement about every runtime that can execute a Hono application.

Sources: [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35), [.tool-versions:1-3](repo://.tool-versions#L1-L3)

```bash
bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:33-35](repo://docs/CONTRIBUTING.md#L33-L35)

For a separate starter application, the README supplies `npm create hono@latest`. For work inside this repository, the package scripts expose tests and builds directly. The package publishes built JavaScript and declarations from `dist`, so repository tests use source imports while the public example uses the package name `hono`.

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:5-36](repo://package.json#L5-L36), [src/hono.test.ts:4-13](repo://src/hono.test.ts#L4-L13)

## Create an application

The public module's minimal example creates a `Hono`, registers a GET handler, and exports the app. The callback receives the context as `c`; returning `c.text` produces the response. The export is the application object with its Fetch entry point, which runtime integration can invoke.

Sources: [src/index.ts:6-14](repo://src/index.ts#L6-L14), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [src/index.ts:8-13](repo://src/index.ts#L8-L13)

The checkout's tests import `Hono` from its source module and demonstrate handlers returning a standard `Response` as well as context shortcuts. One route sets a custom header and status before returning HTML; another returns `c.json(c.env)`. These are different response construction paths through the same handler interface. [[Request and Context]] explains the state and header rules when you extend this example.

Sources: [src/hono.test.ts:6-13](repo://src/hono.test.ts#L6-L13), [src/hono.test.ts:53-70](repo://src/hono.test.ts#L53-L70)

## Send an in-process request

`app.request` accepts a `Request`, a URL string, a `URL` object, or a pathname. A pathname is prefixed with `http://localhost` before dispatch. An existing request is passed through directly unless a `RequestInit` is supplied, in which case Hono constructs a replacement request using those options. Await the result because the entry point supports both synchronous responses and promises.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

The repository verifies its `/hello` route with the following test body. The route itself returns `hello`, status 200 and status text `Hono is OK`; the assertions inspect both response metadata and the consumed body.

Sources: [src/hono.test.ts:55-60](repo://src/hono.test.ts#L55-L60), [src/hono.test.ts:89-95](repo://src/hono.test.ts#L89-L95)

```ts
const res = await app.request('/hello')
expect(res).not.toBeNull()
expect(res.status).toBe(200)
expect(res.statusText).toBe('Hono is OK')
expect(await res.text()).toBe('hello')
```

Sources: [src/hono.test.ts:90-94](repo://src/hono.test.ts#L90-L94)

Optional environment bindings occupy the third argument to `app.request`, after `RequestInit`; the execution context is fourth. The environment test supplies bindings to `/hello-env` and expects them back as JSON. This makes environment-dependent routes testable through the same request boundary, without creating a separate handler invocation path.

Sources: [src/hono-base.ts:499-516](repo://src/hono-base.ts#L499-L516), [src/hono.test.ts:68-70](repo://src/hono.test.ts#L68-L70), [src/hono.test.ts:120-124](repo://src/hono.test.ts#L120-L124)

## Check the first result

A missing path reaches the default text response `404 Not Found` with status 404. The app supports `notFound` and `onError` for custom behavior. A handler can return a response directly, while a chain of matching handlers must finish with a response or await its continuation; dispatch raises a context-finalization error when a composed chain completes without one. [[Middleware and Errors]] explains these branches before you add cross-cutting handlers.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:450-464](repo://src/hono-base.ts#L450-L464)

For a runtime handoff, use the app's `fetch(request, env, executionCtx)` entry point or an adapter that constructs those arguments. Handler registration remains part of application setup: the default SmartRouter determines its active router on its first match and then rejects additional registration. [[Routing]] explains that lifecycle; [[Runtime Adapters and Static Files]] covers the platform-specific call boundaries.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/hono.ts:26-32](repo://src/hono.ts#L26-L32), [src/router/smart-router/router.ts:13-18](repo://src/router/smart-router/router.ts#L13-L18), [src/router/smart-router/router.ts:32-49](repo://src/router/smart-router/router.ts#L32-L49)

## Verify changes

The contribution guide asks contributors to pass `bun run test`. Its package script runs the specification TypeScript project and then Vitest; other scripts target Deno, Bun and individual adapter test projects. [[Development and Verification]] describes which checks exercise source typing, runtime integration and package output when your change grows beyond the first route.

Sources: [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39), [package.json:13-36](repo://package.json#L13-L36)
