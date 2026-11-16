---
type: workflow
title: Validation and typed HTTP clients
description: Input extraction and validation, schema propagation through route types, client request serialization, and in-process RPC testing.
tags: [validation, client, typescript, rpc]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-fcbdfb5eaab568f04bde39d5
    resource: repo://src/client/client.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-c457d3d1a63d5dc86f0da7ef
    resource: repo://src/types.ts
  - id: openwiki-source-ea3982abb05691c971809cae
    resource: repo://src/validator/validator.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Validation and typed HTTP clients

The validator and client are connected by TypeScript route schemas. At runtime the validator extracts and checks input, and the client constructs Fetch requests. There is no generated wire protocol or runtime schema negotiation between them.

## Extract, validate, store

`validator(target, callback)` supports json, form, query, param, header, and cookie targets. It initializes input to an empty object and extracts data according to the target. JSON and form extraction require matching Content-Type; an absent or mismatched type leaves the empty object for the callback. Malformed accepted JSON or form data raises HTTPException 400.

Form extraction reuses cached FormData when available or parses an ArrayBuffer and stores the result in the request cache. Repeated form fields become arrays, including names ending in []. Query values become a string when there is one value and an array when repeated. Param/header/cookie targets use their respective request helpers.

The callback may transform input or return a Response to short-circuit. Other callback results are stored with `c.req.addValidatedData(target, result)`, then execution continues through next. Endpoints consume that result with `c.req.valid(target)`. Parsing JSON by itself does not validate its shape; the callback owns acceptance and transformation.

```ts
import { Hono } from 'hono'
import { validator } from 'hono/validator'

const app = new Hono().get(
  '/hello',
  validator('query', (value, c) => {
    if (typeof value.name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }
    return { name: value.name }
  }),
  (c) => c.json({ greeting: `Hello, ${c.req.valid('query').name}` })
)

export type AppType = typeof app
```

## How types reach the client

Route registration overloads accumulate method/path input and output schemas in the returned Hono type. ToSchema maps validation input and typed response information into endpoint schemas, including path parameters and response status/format. TypedResponse is a compile-time structure carrying data, status, and format information; it does not introduce a second runtime response object.

Keep the chained registration result when exporting AppType. A separately declared blank Hono variable does not automatically gain a new static type merely because methods mutate its runtime route table. Subapplication route composition merges child schema paths, as described in [routing](../architecture/routing.md).

Validator output types exclude Response results from successful validated data. Its response types also propagate into handler typing. A raw Response usually carries less precise application output information than c.json with a literal status, so type-focused changes need compiler checks as well as runtime assertions.

## Client request flow

`hc<AppType>(baseUrl, options)` returns a Proxy. Property access accumulates path segments, and a terminal method such as $get or $post selects an HTTP method. The proxy deliberately avoids a then property so it does not behave like a promise.

ClientRequestImpl serializes form values into FormData or JSON into a string with JSON content type, replaces path parameters, builds query strings, merges configured headers, and calls the configured fetch implementation or global fetch. GET and HEAD omit the generated body. Explicit init options are spread last and can override the computed request initialization.

Base and per-call headers can be functions, including asynchronous ones; when both exist the client merges their resolved values with per-call headers taking precedence. Options are merged before dispatch. The client returns the Fetch response without automatically throwing for non-success HTTP status, so callers inspect status or ok and parse the response.

```ts
import { hc } from 'hono/client'
import type { AppType } from './app'

const client = hc<AppType>('https://example.test')
const response = await client.hello.$get({ query: { name: 'Ada' } })
if (response.status === 200) {
  const data = await response.json()
}
```

$url and $path construct addresses without issuing HTTP requests. $ws builds a WebSocket URL and uses the configured WebSocket factory or the global constructor. HTTP serialization and WebSocket query construction follow separate implementation branches.

## Testing and reusable handlers

`testClient(app, bindings?, executionContext?, options?)` uses hc with a custom fetch that delegates to app.request. This exercises serialization, validation, middleware, and response behavior without starting a server. It also lets tests provide the same bindings and execution capabilities that [Context](../concepts/request-context.md) expects.

The factory helper packages typed middleware/handler definitions and can create apps with default options and an initialization callback. Its middleware wrappers preserve a handler's type while returning the handler itself.

Use validator tests for content-type gates, malformed bodies, transformations, and short circuits; client tests for serialization and inferred types; and helper/testing tests for in-process transport. Run TypeScript checking alongside targeted Vitest tests because type regressions may leave runtime output unchanged. See [testing and build](../operations/testing-and-build.md).
