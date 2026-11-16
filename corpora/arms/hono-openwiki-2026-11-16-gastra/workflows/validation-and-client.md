---
type: workflow
title: Validation and typed HTTP clients
description: How validation extracts and transforms request data, feeds route schemas, and drives typed client serialization and testing.
tags: [validation, client, rpc, types]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Validation and typed HTTP clients

Hono connects request validation to compile-time client contracts. The server still performs runtime validation: client types alone do not validate incoming HTTP data or verify a remote response body.

## Extraction, validation, and storage

The [validator middleware](../../src/validator/validator.ts) extracts one target, invokes the supplied callback, then either returns its Response or stores the transformed output for `c.req.valid(target)` and awaits next.

| Target | Extracted value |
| --- | --- |
| json | Parsed JSON when Content-Type matches the JSON media-type pattern |
| form | Multipart or URL-encoded form entries, retaining repeated keys |
| query | One value as a string; repeated values as arrays |
| param | Decoded path parameters from the active route match |
| header | Request-header record |
| cookie | Parsed cookies through the cookie helper |

Missing or nonmatching JSON/form Content-Type leaves the initial value as an empty object; the validation callback still runs. Malformed recognized JSON or FormData produces HTTPException 400. The form path cooperates with the [request body cache](../concepts/request-and-context.md), avoiding an independent read of already-consumed form data.

A validator can transform the extracted value. Consumers should use `valid()` after validation rather than re-reading raw input and bypassing the transformation.

```ts
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { testClient } from 'hono/testing'

const app = new Hono().get(
  '/search',
  validator('query', (value, c) => {
    if (typeof value.q !== 'string' || value.q.trim() === '') {
      return c.json({ error: 'q is required' }, 400)
    }
    return { q: value.q.trim() }
  }),
  (c) => c.json({ query: c.req.valid('query').q })
)

const client = testClient(app)
const response = await client.search.$get({ query: { q: 'Hono' } })
```

The callback owns application constraints. Hono's validator is a middleware adapter for those checks, not a built-in schema language.

## Preserve the route type

[Handler overloads and ToSchema](../../src/types.ts) accumulate path, method, input, output, response format, and status information into the returned app type. TypedResponse carries compile-time output/status/format information. Validator types distinguish input accepted at the boundary from transformed output available in the handler, and include typed early responses.

Capture the chained route result, as in the example, or export the returned routed app type. Avoid widening it to a bare Hono type before passing it to the client: runtime routes remain registered, but the detailed generic schema may be lost.

`createFactory()` centralizes environment types and default app options and can run an initApp callback. Its `createHandlers()` retains handler typing and filters undefined handlers; it does not execute or compose the middleware. `createMiddleware()` returns the original function with the declared middleware type.

## Client request flow

[hc](../../src/client/client.ts) builds nested proxies from property access. A call such as `client.posts[':id'].$get(...)` becomes a path plus HTTP method. The app's generic type describes the allowed surface; there is no server-schema discovery request.

For network use:

```ts
import { hc } from 'hono/client'

const client = hc<typeof app>('https://api.example.test')
const response = await client.search.$get({ query: { q: 'Hono' } })
```

The request implementation constructs FormData or JSON, merges headers, substitutes path parameters, and serializes query parameters. Default query serialization repeats array-valued keys and skips undefined values. Path parameter substitution uses supplied strings directly; encode values appropriately when they represent a single URL segment.

GET and HEAD omit generated bodies. A custom fetch can replace global fetch. The `init` option is spread last and can override generated method, headers, or body; use the dedicated headers option for ordinary header additions. Base and call-specific header callbacks can be asynchronous and are merged when both exist.

`$url()` and `$path()` construct addresses without a request. `$ws()` maps HTTP(S) to WS(S), adds parameters and queries, and creates a WebSocket using an optional custom factory.

## Response and test boundaries

Ordinary hc calls return the fetch response; HTTP error statuses do not automatically throw. Inspect status/ok before choosing a response variant. `parseResponse()` is an optional helper that parses JSON or text and throws DetailedError for a non-ok response.

[testClient](../../src/helper/testing/index.ts) injects a fetch implementation that delegates to `app.request()`, carrying optional bindings and execution context. It exercises client serialization, routing, middleware, and response handling without opening a listener. It cannot prove platform event conversion or network streaming behavior.

[Validator tests](../../src/validator/validator.test.ts) cover malformed data, content-type gates, transformations, form caching, and typed early responses. [Client tests](../../src/client/client.test.ts) combine runtime assertions with type expectations. Run both the relevant Vitest tests and the spec TypeScript check from [testing](testing.md). See [dispatch](../architecture/request-lifecycle.md) for short-circuit and error semantics.
