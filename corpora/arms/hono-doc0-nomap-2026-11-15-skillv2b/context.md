---
title: "Context and Responses"
---
## Overview

Every handler and middleware receives one `Context`, conventionally named `c`. It is created per request by `#dispatch` ([[Request Dispatch and Middleware Composition]]) and carries the runtime bindings, the execution context, per-request variables, the response being built, and the helpers that build it. The request side, `c.req`, is a separate object described in [[HonoRequest: Params, Query, Headers and Body]].

Sources: [src/context.ts:293-364](repo://src/context.ts#L293-L364)

`Context` is generic over three types: `E` (the app's `Env`, giving `c.env` and `c.var` their types), `P` (the route path, giving `c.req.param()` its keys) and `I` (validated input, giving `c.req.valid()` its result). [[Env, Handler and Schema Types]] explains how they are inferred.

Sources: [src/context.ts:293-299](repo://src/context.ts#L293-L299)

## Runtime bindings and execution context

| Member | What it returns |
| --- | --- |
| `c.env` | The second argument of `app.fetch`: Cloudflare bindings, Bun's server object, Lambda event data, depending on the adapter. Typed by `Env['Bindings']` |
| `c.executionCtx` | The third argument of `app.fetch`, with `waitUntil`, `passThroughOnException`, `props` and `exports`. Throws `This context has no ExecutionContext` when the runtime gave none |
| `c.event` | The `FetchEvent` when the app runs as a Service Worker (`fire()`); throws `This context has no FetchEvent` otherwise |

Sources: [src/context.ts:31-52](repo://src/context.ts#L31-L52), [src/context.ts:377-401](repo://src/context.ts#L377-L401)

`c.executionCtx` throwing instead of returning `undefined` makes a missing capability fail loudly; code that must work on runtimes without one wraps the access in `try`, as `app.mount` does.

Sources: [src/context.ts:391-397](repo://src/context.ts#L391-L397), [src/hono-base.ts:355-361](repo://src/hono-base.ts#L355-L361)

## Variables

`c.set(key, value)` and `c.get(key)` store values for the rest of the request, the usual way middleware passes a user, a database client or a request ID to handlers. Storage is a `Map` created on the first `set`. `c.var` returns a read-only object built from the same map, convenient for destructuring (`const { user } = c.var`).

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Keys and value types come from `Env['Variables']` of the app, or from the global `ContextVariableMap` interface that middleware augment with `declare module 'hono'`. When `E` is `any`, any string key is allowed.

Sources: [src/context.ts:57-57](repo://src/context.ts#L57-L57), [src/context.ts:546-559](repo://src/context.ts#L546-L559)

```ts
type Env = { Variables: { user: { id: string } } }
const app = new Hono<Env>()

app.use(async (c, next) => {
  c.set('user', { id: 'u1' })
  await next()
})
app.get('/me', (c) => c.json(c.var.user))
```

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Building a response

### Response helpers

All helpers go through the private `#newResponse(data, statusOrInit, headers)`, so they accept either a status code and a header record, or a `ResponseInit`-like object (or an existing `Response`) as the second argument.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Helper | Content-Type | Notes |
| --- | --- | --- |
| `c.body(data, ...)` | none added | `data` is a string, `ArrayBuffer`, `Uint8Array`, `ReadableStream` or `null` |
| `c.text(text, ...)` | `text/plain; charset=UTF-8` | Returns a bare `new Response(text)` when no header, status or argument was set |
| `c.json(object, ...)` | `application/json` | `JSON.stringify(object)`; the return type records the parsed JSON shape for the RPC client |
| `c.html(html, ...)` | `text/html; charset=UTF-8` | Accepts a string or a promise of one (JSX output); escaped-string callbacks are resolved first |
| `c.redirect(location, status = 302)` | none | Sets `Location`, encoding it with `encodeURI` when it holds non-Latin-1 characters |
| `c.notFound()` | from handler | Calls the app's not-found handler |
| `c.newResponse(...)` | none added | The general form the others build on |

Sources: [src/context.ts:664-733](repo://src/context.ts#L664-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

The status argument is typed: `c.json` and `c.text` accept only `ContentfulStatusCode`, so `c.json(data, 204)` is a type error, while `c.body(null, 204)` is allowed. Each helper returns `Response & TypedResponse<...>`, which is how the response body and status reach the client's types ([[RPC Client]]).

Sources: [src/context.ts:117-166](repo://src/context.ts#L117-L166), [src/utils/http-status.ts:66-72](repo://src/utils/http-status.ts#L66-L72)

### How headers and status merge

`c.header(name, value, { append })` and `c.status(code)` can be called before the response exists. Headers are stored in `#preparedHeaders` and the status in `#status`; `#newResponse` starts from those (or from the existing `c.res` headers), then applies the init object's headers (appending `Set-Cookie`, setting the rest), then the header record (an array value is appended as several headers). An explicit status argument wins over `c.status()`.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531), [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`c.header(name, undefined)` deletes the header. When the context is already finalized, `c.header` first copies the response into a new `Response`, because a `Response`'s headers can be immutable (for example on a response returned by `fetch`).

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

## c.res and finalized

`c.res` is the response the request will return. Reading it before a handler produced one returns an empty response carrying the prepared headers. Assigning it sets `finalized = true`.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

Assigning a new response when one already exists merges headers: the new response is cloned, and every header from the old one except `Content-Type` is copied onto it, with all `Set-Cookie` values preserved. This is what lets middleware replace the body after `await next()` without dropping the CORS or cookie headers other middleware already set.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

```ts
app.use(async (c, next) => {
  await next()
  c.res = new Response(await c.res.text() + '\n', c.res)
})
```

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`c.error` holds the error that the composed chain passed to `onError`, so middleware can inspect failures after `next()` returns.

Sources: [src/context.ts:333-333](repo://src/context.ts#L333-L333), [src/compose.ts:49-56](repo://src/compose.ts#L49-L56)

## Rendering hooks

`c.render(...)` calls the renderer installed with `c.setRenderer`, or `c.html` when none is set. Its signature comes from the `ContextRenderer` interface, which applications augment to give `c.render` typed props. `c.setLayout` and `c.getLayout` store a layout component for the request. These hooks exist so the JSX renderer middleware can wrap each page in a layout ([[JSX Renderer Middleware and CSS Helper]]).

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85), [src/context.ts:448-497](repo://src/context.ts#L448-L497)

## Header and MIME types

`src/utils/headers.ts` lists the IANA request and response header names as string unions, which give `c.header()` and `c.req.header()` autocompletion while still accepting any string. `src/utils/mime.ts` maps file extensions to MIME types (`getMimeType`, `getExtension`), used by `c.header('Content-Type', ...)` typing and by [[Serving Static Files]].

Sources: [src/utils/headers.ts:1-20](repo://src/utils/headers.ts#L1-L20), [src/utils/mime.ts:1-33](repo://src/utils/mime.ts#L1-L33)
