---
title: "Quickstart"
---
## Overview

A minimal Hono application imports `Hono`, creates an instance, registers a handler, and exports the application. The handler receives a context and returns a response. This page takes that example through an in-process request and the repository's development setup. [[Hono Overview]] maps the larger systems; the steps here use the same public application boundary that runtime adapters call.

Sources: [README.md:26-39](repo://README.md#L26-L39), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

## Create an application

The README's starting command scaffolds a Hono application. Run it when creating an application that consumes the framework. The repository itself is the framework package, with a separate contributor workflow described below; its package scripts build and test Hono rather than defining one universal application development server.

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:1-36](repo://package.json#L1-L36)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

Use the README's minimal application as the entry module. A GET request to `/` returns the text `Hono!`. The package's main entry exports the `Hono` class and common handler and context types, so the example needs only the root import.

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/index.ts:17-53](repo://src/index.ts#L17-L53)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:27-32](repo://README.md#L27-L32)

Complete route registration before making the first request. The default router chooses an implementation when it first matches, then rejects further additions. This matters in tests as well as deployed applications: constructing routes after an initial smoke request can fail even when the route declaration itself is valid. [[Routing]] explains grouping, path patterns and the router lifecycle.

Sources: [src/hono.ts:26-32](repo://src/hono.ts#L26-L32), [src/router/smart-router/router.ts:13-49](repo://src/router/smart-router/router.ts#L13-L49)

## Exercise the handler

Call `app.request('/')` and await the result to exercise the example in the same process. `request` accepts a pathname, full URL, URL object or existing `Request`; relative inputs are turned into localhost URLs. Read the returned response with `text()` and inspect its status. A request to an unregistered path reaches the default 404 response. [[Testing and Development]] extends this approach to typed clients and the repository's test projects.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517), [src/hono-base.ts:31-33](repo://src/hono-base.ts#L31-L33), [src/hono.test.ts:89-118](repo://src/hono.test.ts#L89-L118)

The repository demonstrates this with a `/hello` handler and an assertion against the response body. These are excerpts from the same test suite; the handler deliberately returns a standard `Response`, showing that context response helpers are optional.

Sources: [src/hono.test.ts:53-60](repo://src/hono.test.ts#L53-L60), [src/hono.test.ts:89-95](repo://src/hono.test.ts#L89-L95)

```ts
    app.get('/hello', async () => {
      return new Response('hello', {
        status: 200,
        statusText: 'Hono is OK',
      })
    })
```

Sources: [src/hono.test.ts:55-60](repo://src/hono.test.ts#L55-L60)

```ts
      const res = await app.request('/hello')
      expect(res).not.toBeNull()
      expect(res.status).toBe(200)
      expect(res.statusText).toBe('Hono is OK')
      expect(await res.text()).toBe('hello')
```

Sources: [src/hono.test.ts:90-94](repo://src/hono.test.ts#L90-L94)

## Add request and response behavior

Choose the handler's response helper according to the output: `c.text` returns text, `c.json` serializes an object, and `c.html` emits HTML. The tests also demonstrate setting a header and status before returning HTML. [[Request Context and Middleware]] covers how these prepared values combine with the eventual response and how middleware can inspect it after downstream handlers run.

Sources: [src/context.ts:682-733](repo://src/context.ts#L682-L733), [src/hono.test.ts:62-70](repo://src/hono.test.ts#L62-L70), [src/hono.test.ts:105-111](repo://src/hono.test.ts#L105-L111)

For input, `c.req.param` reads route parameters, `query` reads a query value, `queries` preserves repeated values, and `header` reads request headers. These are accessors; application validation is a separate step. When a route must transform or reject input before the final handler, use the middleware flow in [[Validation and Typed Clients]], which stores successful validation results for later handlers.

Sources: [src/request.ts:94-127](repo://src/request.ts#L94-L127), [src/request.ts:148-198](repo://src/request.ts#L148-L198), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

## Connect a runtime

The application exposes `fetch(request, env, executionCtx)`. A runtime can call that entry point with a standard request, or an adapter can convert its event format first. For example, the Lambda adapter exports `handle(app)` and passes the original event, request context and Lambda context as bindings. [[Runtime Adapters and Static Files]] describes those concrete integration contracts; the exported application alone does not select a platform-specific event converter.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/aws-lambda/handler.ts:211-222](repo://src/adapter/aws-lambda/handler.ts#L211-L222), [src/adapter/aws-lambda/handler.ts:252-274](repo://src/adapter/aws-lambda/handler.ts#L252-L274)

## Work on this repository

For a checkout of Hono itself, the contribution guide specifies Bun as the package manager and installs from the committed lockfile. Run the following command in the repository. The package's test script first checks TypeScript test types and then invokes Vitest, while build produces distributable package files. [[Testing and Development]] explains the runtime-specific checks and build stages.

Sources: [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39), [package.json:13-36](repo://package.json#L13-L36)

```bash
bun install --frozen-lockfile
```

Sources: [docs/CONTRIBUTING.md:27-35](repo://docs/CONTRIBUTING.md#L27-L35)

The contribution guide asks for `bun run test` to pass. If an initial application request instead returns 500, check whether the handler threw or failed to finalize the context: the dispatcher reports a missing returned response or missing `await next()` explicitly in its composed path. Custom error and not-found handlers are available through `onError` and `notFound`, as described in [[Request Context and Middleware]].

Sources: [docs/CONTRIBUTING.md:37-39](repo://docs/CONTRIBUTING.md#L37-L39), [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465)
