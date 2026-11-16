---
type: concept
title: Request data and response state
description: Request-scoped context ownership, parameter lookup, body caches, validated data, and response/header finalization.
tags: [context, request, response, state]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-663d89ccefa599120b60c70c
    resource: repo://src/context.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-e5bc41e70e9fb90ca367cb49
    resource: repo://src/utils/body.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Request data and response state

Every dispatch creates a [Context](../../src/context.ts) holding the incoming request, route matches, environment bindings, response state, and optional runtime execution context. The `HonoRequest` wrapper is created lazily on the first access to `c.req`. Application route registration is shared across requests; context variables and request caches belong to the individual context.

## Bindings, variables, and runtime services

Use `c.env` for the bindings supplied at the fetch boundary and `c.set()/c.get()` for values shared among handlers in one request. Variables use a lazily created Map; `c.var` produces an object from that Map. This is request-local coordination, not durable storage.

```ts
import { Hono } from 'hono'

type Env = {
  Bindings: { GREETING: string }
  Variables: { requestLabel: string }
}
const app = new Hono<Env>()
app.use('*', async (c, next) => {
  c.set('requestLabel', c.req.path)
  await next()
})
app.get('/', (c) => c.text(c.env.GREETING))
const res = await app.request('/', undefined, { GREETING: 'Hello' })
```

`c.executionCtx` throws when no execution context was supplied. `c.event` additionally requires a fetch-event-like value with `respondWith`. A successful local `app.request()` does not imply that waitUntil or other platform capabilities are available; see [runtime adapters](../integrations/runtime-adapters.md).

## Reading the request

[HonoRequest](../../src/request.ts) keeps the raw Web Request as `c.req.raw`. Parameter lookup uses the current handler's route index and either direct values or the router's shared parameter stash, then decodes percent-encoded values. Parameters can therefore vary as middleware progresses through different matched routes.

Use `query()` for a single value and `queries()` for repeated values. Header lookup delegates to Web Headers; the all-headers form exposes a record. These are extraction APIs, not application validation.

The body helpers cache the first read by representation. Repeated reads of the same representation return the cached value/promise. A later representation can be derived from the existing cached body through a new Response; JSON caches are stringified first. This is convenience reuse, not a byte-for-byte archive of every original encoding. Reading `c.req.raw` directly bypasses this cache, so coordinate middleware body consumption through the wrapper.

`parseBody()` handles multipart and URL-encoded forms and returns an empty object for other media types. It converts form entries to a null-prototype record. By default a repeated ordinary key keeps the last value; `all: true` or a key ending in `[]` retains multiple values. `dot: true` expands dotted keys into nested structures. Form parsing caches FormData for subsequent wrapper reads.

Validated output is separate from the body cache. `addValidatedData(target, value)` stores a value by validation target and `valid(target)` retrieves it; the getter does not validate or transform data. The [validation workflow](../workflows/validation-and-client.md) explains how middleware populates it.

## Building and replacing responses

`c.text()`, `c.json()`, `c.html()`, and `c.body()` construct responses. Return the result from the handler so dispatch/composition can use it. Calling a builder alone is not the same as assigning `c.res`.

Reading `c.res` lazily constructs an empty response without finalizing the context. Assigning `c.res` sets `finalized`. If replacing an existing response, the setter copies prior headers except Content-Type; Set-Cookie values receive special handling to retain separate cookies.

`c.header()` stores prepared headers before response creation, updates the current response when present, and reconstructs a finalized response before mutation. An undefined value deletes a header; `append: true` appends. `c.status()` stores the status used by subsequent response construction. Explicit response arguments and headers participate in merging inside `newResponse()`.

JSON serialization uses JSON.stringify and defaults to application/json. HTML output sets the HTML content type and resolves escaped-string callbacks or promised output; it does not sanitize a plain string. See [HTML rendering](jsx-and-html.md) for the escaping boundary.

## Regression entrypoints

[context.test.ts](../../src/context.test.ts) exercises immutable response headers, response replacement, cookies, and finalization. [request.test.ts](../../src/request.test.ts) covers query values, parameters, and body access; [body.test.ts](../../src/utils/body.test.ts) covers form conversion.

When a response unexpectedly becomes 404 or 500, follow the finalization checks in [request dispatch](../architecture/request-lifecycle.md) before changing response builders.
