---
title: "Quickstart"
---
## Overview

The smallest Hono application creates a `Hono` instance, registers a handler, and exports the app. Its handler receives a context and returns a standard response. This walkthrough uses the repository's own examples to establish that request-to-response loop, then shows how to exercise it without starting a server. The larger relationship between the framework, client, and runtimes is mapped in [[Hono Overview]].

Sources: [README.md:22-39](repo://README.md#L22-L39), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

## Create an application

The README starts a new application with the following command. It invokes the Hono application generator; the framework repository itself supplies the library rather than a single application-specific development server. Keep the generated application's runtime entry separate from the library's contributor workflow, which is covered in [[Testing and Development]].

Sources: [README.md:35-39](repo://README.md#L35-L39), [package.json:13-36](repo://package.json#L13-L36), [docs/CONTRIBUTING.md:27-39](repo://docs/CONTRIBUTING.md#L27-L39)

```bash
npm create hono@latest
```

Sources: [README.md:37-39](repo://README.md#L37-L39)

Use the minimal app shown in the README as the initial route definition. The root import exports `Hono`; the constructor supplies the default router. `app.get` registers the path and handler, and the callback's `c.text` returns a response containing the provided text. Exporting the app exposes its `fetch` method to a compatible host.

Sources: [src/index.ts:17-53](repo://src/index.ts#L17-L53), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/hono-base.ts:126-140](repo://src/hono-base.ts#L126-L140), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/context.ts:682-694](repo://src/context.ts#L682-L694)

```ts
import { Hono } from 'hono'
const app = new Hono()

app.get('/', (c) => c.text('Hono!'))

export default app
```

Sources: [README.md:26-33](repo://README.md#L26-L33)

Register all routes before sending the first request. The default router chooses its implementation on first match and subsequently rejects new registrations. This matters when experimenting interactively: adding a handler after an earlier `app.request` call can fail even though the same registration would work during application setup. [[Routing and Dispatch]] covers grouping, prefixes, and alternative router choices.

Sources: [src/router/smart-router/router.ts:13-60](repo://src/router/smart-router/router.ts#L13-L60)

## Exercise the first request

Call `app.request('/')` on the exported app and await its result. With the root handler above, the expected status is 200 and the response text is `Hono!`. A pathname is expanded against `http://localhost` and passed through `fetch`; an absolute HTTP URL or an existing `Request` is also accepted. No listener is created by this method, making it useful for checking application behavior in a test.

Sources: [README.md:26-33](repo://README.md#L26-L33), [src/context.ts:682-694](repo://src/context.ts#L682-L694), [src/hono-base.ts:488-517](repo://src/hono-base.ts#L488-L517)

The core tests demonstrate the same pattern with a `/hello` route. The handler below deliberately returns a native response so that its body, status, and status text can all be asserted. Context response helpers are conveniences around the same HTTP response contract, rather than a requirement for every endpoint.

Sources: [src/hono.test.ts:49-60](repo://src/hono.test.ts#L49-L60), [src/hono.test.ts:76-95](repo://src/hono.test.ts#L76-L95)

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

Sources: [src/hono.test.ts:89-95](repo://src/hono.test.ts#L89-L95)

The assertion fragment belongs inside a test environment that provides `expect`. For a request with bindings, the third `app.request` argument supplies the environment object. The repository verifies this by sending `HELLO: 'world'` to a handler that returns `c.env` as JSON. The fourth argument supplies an execution context when one is needed; [[Request and Context]] explains how handlers access both values.

Sources: [src/hono.test.ts:68-70](repo://src/hono.test.ts#L68-L70), [src/hono.test.ts:120-124](repo://src/hono.test.ts#L120-L124), [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## Return structured data

For an endpoint that returns an object, use the context's JSON helper. It serializes the object and supplies the JSON content type. The example below is taken from the helper's source documentation; register it alongside the initial route before making requests. Await `res.json()` in the caller to read its data, as the environment test does.

Sources: [src/context.ts:696-721](repo://src/context.ts#L696-L721), [src/hono.test.ts:120-124](repo://src/hono.test.ts#L120-L124)

```ts
app.get('/api', (c) => {
  return c.json({ message: 'Hello!' })
})
```

Sources: [src/context.ts:701-706](repo://src/context.ts#L701-L706)

Headers and status can also be prepared on the context before returning a response helper. The tests combine `c.header`, `c.status(201)`, and `c.html`, then verify the resulting status, custom header, content type, and body. When the output needs templates or JSX rather than a literal string, [[HTML and Server Rendering]] extends this response step.

Sources: [src/hono.test.ts:62-66](repo://src/hono.test.ts#L62-L66), [src/hono.test.ts:105-112](repo://src/hono.test.ts#L105-L112)

## Diagnose initial failures

An unmatched path returns the default 404 response. Ordinary unhandled errors are logged and become a 500 response; errors exposing `getResponse` can supply their own response. An application can customize these outcomes with `app.notFound` and `app.onError`. In a composed handler chain, reaching the end without a finalized response raises the diagnostic asking whether a response or `await next()` was forgotten. [[Middleware and Diagnostics]] explains that contract before adding middleware.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465)

Once in-process requests succeed, connect the app to the chosen runtime's entry point. `app.fetch` accepts a request, optional bindings, and optional execution context, while adapters such as Lambda translate host events before calling it. [[Runtime Adapters]] documents the supported conversion paths so that the route definitions stay focused on application behavior.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/adapter/aws-lambda/handler.ts:252-275](repo://src/adapter/aws-lambda/handler.ts#L252-L275)

