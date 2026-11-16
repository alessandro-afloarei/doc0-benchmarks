---
type: workflow
title: Typed routes and the HTTP client
description: Preserve server route schemas, call them with hc, control request serialization and response parsing, and test the same client locally without a server.
tags: [client, rpc, types, validation, testing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-af57a068e7b3792cc509bb62
    resource: repo://src/client/fetch-result-please.ts
  - id: openwiki-source-e55496b6dec0986c8ee44315
    resource: repo://src/client/utils.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# Typed routes and the HTTP client

Hono connects the inferred schema of a server application to an HTTP client through TypeScript. [Route types](../../src/types.ts) accumulate path, method, input, output format, status, and response data information. [hc](../../src/client/client.ts) uses that schema for its type surface and a JavaScript Proxy for runtime request construction. No route discovery request or generated client source is needed.

## Preserve the route-bearing type

Capture the value returned by chained registration or grouping so its schema remains visible to the client:

```ts
// server.ts
import { Hono } from 'hono'

const routes = new Hono()
  .get('/users/:id', (c) => c.json({ id: c.req.param('id'), name: 'Ada' }))
export type AppType = typeof routes
export default routes
```

```ts
// client.ts
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('https://api.example.test')
const response = await client.users[':id'].$get({ param: { id: '42' } })
const user = await response.json()
```

At runtime, registration mutates the app. At compile time, the return type carries accumulated schema information. An earlier variable declared with a broad or empty schema does not retroactively gain a different static type merely because later calls mutate the object. Avoid widening the exported route-bearing value to a plain `Hono` when consumers need precise inference.

The [ToSchema machinery](../../src/types.ts) adds route parameters to input and derives response data, status, and format from typed response helpers. `route()` merges a child schema under its prefix. Validator middleware contributes its accepted input and transformed output types; [request validation](../concepts/request-context-validation.md) owns the actual runtime checks. Plain Response values or broad annotations can lose precision compared with `c.json` and other typed helpers.

## Turn property access into a request

The proxy accumulates path segments until called. A trailing `$get`, `$post`, or another method name becomes the HTTP method. The string `then` is excluded from proxy traversal to avoid accidental Promise-like behavior.

Request arguments are target-shaped:

| Argument | Runtime serialization |
| --- | --- |
| `param` | Substitute named path parameters, including supported constraint/optional syntax. |
| `query` | Serialize through URLSearchParams; arrays repeat the key by default. |
| `form` | Build FormData, appending array items individually and skipping undefined fields. |
| `json` | JSON.stringify the supplied truthy value and set application/json. |
| `header` | Add request-specific header fields. |
| `cookie` | Serialize cookie fields into the Cookie header. |

Path substitution in [client utilities](../../src/client/utils.ts) uses supplied parameter strings directly; it does not automatically apply encodeURIComponent. The caller owns encoding when values contain path delimiters or other significant characters. URL construction also normalizes the client `index` segment according to its helper rules.

GET and HEAD do not get a constructed body. The final fetch call spreads `options.init` after its generated method, headers, and body, so `init` has the highest priority and can replace them. Prefer the dedicated `headers` option for adding headers while retaining client construction.

Base and per-call options are merged. Header records or asynchronous header factories can be supplied at both levels; per-call headers override base fields. `fetch` injects a transport, `buildSearchParams` changes query serialization, and `webSocket` injects WebSocket construction. These are useful extension seams for authentication, testing, and host differences.

## URLs, responses, and errors

`$url()` builds a URL object and `$path()` builds a path string without sending a request. Both accept parameter/query arguments and use the query builder. A WebSocket route's `$ws()` switches the HTTP URL protocol to its WebSocket equivalent, adds arguments, and establishes the socket. Its runtime transport is separate from ordinary fetch; see [WebSockets](../integrations/streaming-websockets.md).

[Client response types](../../src/client/types.ts) specialize status, ok, and body readers from the endpoint schema. `InferRequestType` and `InferResponseType` can extract those types for other application code. Runtime `hc` calls still return the transport's ordinary response; they do not validate server response bodies against the TypeScript schema or automatically throw for HTTP failure status.

Use `parseResponse()` when the desired contract is parsed data or a structured error. Its implementation reads JSON for recognized JSON content types and text otherwise, skips null-body statuses, and throws `DetailedError` on a non-ok response with status information and parsed error data. Fetch/parse failures can still reject independently.

Global `onError` responses and other application-wide failures are not inferred solely from an endpoint's return expressions. The exported `ApplyGlobalResponse` utility can describe a shared response type surface; it changes types, not server behavior. Keep declared response contracts aligned with actual middleware and error policy.

## Exercise the client without opening a port

```ts
import { testClient } from 'hono/testing'
import app from './server'

const local = testClient(app)
const res = await local.users[':id'].$get({ param: { id: '42' } })
```

[testClient](../../src/helper/testing/index.ts) injects a fetch implementation that forwards to `app.request`, with optional environment and execution context. This tests serialization, routing, middleware, and response behavior together. It does not exercise a network server or an adapter's event conversion. Provide execution context when testing middleware that schedules background work.

Use [client behavior tests](../../src/client/client.test.ts), [client type tests](../../src/client/types.test.ts), and [core type tests](../../src/types.test.ts) when changing inference or serialization. [Development and testing](development-and-testing.md) explains why compiler checks accompany runtime tests, and [routing](../architecture/routing.md) covers grouped app registration.
