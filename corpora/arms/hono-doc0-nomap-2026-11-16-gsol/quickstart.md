---
title: "Quickstart"
---
## Overview

A Hono application starts with one instance, one route, and a handler that returns a response. The repository's opening example uses `c.text` and exports the application itself. You can exercise that application with `app.request` before choosing a runtime entry point. [[Hono Architecture]] explains the same boundary at a system level: both a platform adapter and an in-process request eventually enter `app.fetch`.

Sources: [README.md:22-39](repo://README.md#L22-L39), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

## Create an application

The README provides the following scaffold command. It is the repository's starting point for a new application; the framework source in this checkout is also directly exercised by its own runtime tests.

Sources: [README.md:35-39](repo://README.md#L35-L39), [runtime-tests/bun/index.test.tsx:1-14](repo://runtime-tests/bun/index.test.tsx#L1-L14)

```bash
npm create hono@latest
```

Sources: [README.md:35-39](repo://README.md#L35-L39)

Use the minimal app as the first route to verify. Importing `Hono` from the package selects the default router configuration. `get` registers the root handler, and the callback returns the response produced by its context. Exporting the instance exposes its `fetch` property to a runtime integration. This example has no environment bindings or middleware configuration to supply.

Sources: [src/index.ts:6-17](repo://src/index.ts#L6-L17), [src/hono.ts:26-32](repo://src/hono.ts#L26-L32), [src/hono-base.ts:126-140](repo://src/hono-base.ts#L126-L140), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [src/index.ts:8-13](repo://src/index.ts#L8-L13)

## Exercise the first request

`app.request` accepts a `Request`, a URL, or a path string. A path is placed under `http://localhost` and turned into a standard request. A supplied initialization object can set the method, headers, or body. The helper then calls the application's `fetch` method; it does not create a listening server. Await its result because dispatch can return either a response immediately or a promise, depending on the handler path.

Sources: [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

The framework's own test registers `/hello`, returns a standard response with status 200, and calls the helper with `/hello`. The response assertions check the status, status text, and body. These checks demonstrate that context shortcuts are optional: a route may return a standard response directly. [[Testing and Development]] expands this pattern to the typed test client and the repository's test commands.

Sources: [src/hono.test.ts:53-60](repo://src/hono.test.ts#L53-L60), [src/hono.test.ts:89-103](repo://src/hono.test.ts#L89-L103)

```ts
const res = await app.request('/hello')
expect(res).not.toBeNull()
expect(res.status).toBe(200)
expect(res.statusText).toBe('Hono is OK')
expect(await res.text()).toBe('hello')
```

Sources: [src/hono.test.ts:90-94](repo://src/hono.test.ts#L90-L94)

Register the routes before sending the first request. The default SmartRouter selects a concrete router on its first match, releases its buffered route list, and rejects subsequent additions. This makes a test's setup phase significant: finish application construction before starting assertions. [[Routing and Application Composition]] describes grouping and base paths when more than one route needs the same prefix.

Sources: [src/router/smart-router/router.ts:13-18](repo://src/router/smart-router/router.ts#L13-L18), [src/router/smart-router/router.ts:26-60](repo://src/router/smart-router/router.ts#L26-L60), [src/hono-base.ts:208-252](repo://src/hono-base.ts#L208-L252)

## Read inputs and choose a response

The Bun runtime test adds a path parameter and a query parameter to the same route. Its handler reads both from `c.req`, sets response headers, and returns text. The test sends `/a/foo?q=bar` and verifies the headers contain `foo` and `bar`. That is the basic data path for a handler: inspect the request wrapper, update response metadata on the context, then return the body response. [[Request and Context]] explains the accessors and their body cache in detail.

Sources: [runtime-tests/bun/index.test.tsx:27-42](repo://runtime-tests/bun/index.test.tsx#L27-L42)

```ts
app.get('/a/:foo', (c) => {
  c.header('x-param', c.req.param('foo'))
  c.header('x-query', c.req.query('q'))
  return c.text('Hello Bun!')
})
```

Sources: [runtime-tests/bun/index.test.tsx:29-33](repo://runtime-tests/bun/index.test.tsx#L29-L33)

Use the response helper that matches the route's output. `text` produces a text response, `json` stringifies a value and supplies a JSON content type, and `html` supplies an HTML content type and can resolve asynchronous escaped content. A status can be set on the context or passed into a response helper. The shortcut test sets a header and status 201 before returning HTML, then verifies all three properties on the resulting response.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:682-733](repo://src/context.ts#L682-L733), [src/hono.test.ts:62-66](repo://src/hono.test.ts#L62-L66), [src/hono.test.ts:105-111](repo://src/hono.test.ts#L105-L111)

## Connect the runtime boundary

The application entry is `fetch(request, env, executionCtx)`. A runtime with that interface can supply the arguments directly. An adapter can translate a different interface: Cloudflare Pages' `handle` forwards its event request, environment, and execution functions; Lambda's `handle` creates a request from an event and converts the response into a platform result. [[Runtime Adapters]] documents those choices and the bindings each integration exposes.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/aws-lambda/handler.ts:250-275](repo://src/adapter/aws-lambda/handler.ts#L250-L275)

## Recognize the first failure

An unmatched request receives the default text response `404 Not Found` with status 404. An ordinary handler error is logged and becomes `Internal Server Error` with status 500; an error exposing `getResponse` supplies its own response through the context builder. These defaults can be replaced with `notFound` and `onError`. [[Middleware and Errors]] explains those hooks and the requirement to return a response or await the middleware continuation.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465)
