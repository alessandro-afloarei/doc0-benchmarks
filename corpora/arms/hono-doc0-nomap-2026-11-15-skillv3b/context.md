---
title: "Context and Response Building"
---
## Overview

`Context` is the `c` every handler and middleware receives. One is created per request by `#dispatch` (see [[Request Lifecycle and Middleware Composition]]) and carries the four things a handler needs: the request as `c.req`, the runtime's bindings and execution context, a per-request variable store, and the response being built. Its methods `c.text`, `c.json`, `c.html`, `c.body` and `c.redirect` create the `Response` a handler returns. The request side, `c.req`, is the [[HonoRequest]] page.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361)

The class takes three type parameters: `E` (the app's `Env` with `Bindings` and `Variables`), `P` (the route path, used to type `c.req.param()`) and `I` (the validated input, used by `c.req.valid()`). [[Type System and Route Schemas]] explains how they are filled in.

Sources: [src/context.ts:293-299](repo://src/context.ts#L293-L299)

## Runtime values

| Member | What it holds | When it is missing |
| --- | --- | --- |
| `c.env` | The bindings passed as the second argument of `fetch`: Cloudflare KV, D1, secrets; on Node and Bun usually empty | Defaults to `{}` |
| `c.executionCtx` | The `ExecutionContext` with `waitUntil`, `passThroughOnException`, `props` | Throws `This context has no ExecutionContext` |
| `c.event` | The `FetchEvent` when the app runs as a Service Worker | Throws `This context has no FetchEvent` |
| `c.error` | The error a downstream handler threw, set by `compose` | `undefined` |

Sources: [src/context.ts:28-52](repo://src/context.ts#L28-L52), [src/context.ts:315-333](repo://src/context.ts#L315-L333), [src/context.ts:377-397](repo://src/context.ts#L377-L397)

`c.event` is recognised by duck typing: the execution context is treated as an event only when it has `respondWith`.

Sources: [src/context.ts:377-383](repo://src/context.ts#L377-L383)

## Variables

`c.set(key, value)` and `c.get(key)` store values for the rest of the request in a `Map` that is created on the first `set`. `c.var` is a read-only object snapshot of the same map (`Object.fromEntries`), handy for destructuring: `const { user } = c.var`. Middleware uses variables to hand results to handlers; for example the JWT middleware stores the decoded payload.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Keys and value types come from `E['Variables']`, or from the global `ContextVariableMap` interface that a middleware package can augment so its key is typed in every app:

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108)

```ts
declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
  }
}
```

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57)

## Building responses

### Prepared headers and status

`c.header(name, value, { append })` and `c.status(code)` prepare the response before it exists. Headers go to a lazily created `Headers` object (`#preparedHeaders`), or to the existing response once one is set; passing `undefined` deletes a header. `status` is remembered and used by the next builder that is not given an explicit status. When the context is already finalized, `header()` first clones `c.res` so the headers of a response another handler returned can be changed.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

### The builders

All builders funnel into `#newResponse(data, arg, headers)`. It starts from the existing response's headers or the prepared headers, applies the headers of an init object (appending `Set-Cookie` instead of replacing it), then the explicit header record (an array value becomes several header lines), and takes the status from a number argument, the init object, or `c.status()`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Method | Body | Content-Type |
| --- | --- | --- |
| `c.body(data, status?, headers?)` | `string`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` or `null` | none set |
| `c.text(text, ...)` | string | `text/plain; charset=UTF-8` |
| `c.json(object, ...)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, ...)` | string, or a promise of one from JSX | `text/html; charset=UTF-8` |
| `c.redirect(location, status = 302)` | none, `Location` header | none |
| `c.newResponse(...)` | same as `body`, untyped | none set |
| `c.notFound()` | the app's not-found response | from that handler |

Sources: [src/context.ts:641-733](repo://src/context.ts#L641-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

Every builder accepts either `(data, status, headers)` or `(data, init)`, where `init` is a `ResponseInit` or another `Response` whose status and headers are copied. The second argument's type is `ContentfulStatusCode` for builders with a body, which excludes 101, 204, 205 and 304, so `c.json(x, 204)` is a type error.

Sources: [src/context.ts:113-166](repo://src/context.ts#L113-L166), [src/utils/http-status.ts:63-72](repo://src/utils/http-status.ts#L63-L72)

`c.text` has a fast path: with no prepared headers, no status, no arguments and an unfinalized context it returns `new Response(text)` directly, relying on the runtime's default `text/plain;charset=UTF-8`. `c.html` accepts a promise because JSX with async components renders to a `Promise<string>`; the promise is resolved through `resolveCallback`, described in [[Streaming JSX and Suspense]]. `c.redirect` percent-encodes a location containing characters above `\xFF`.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694), [src/context.ts:723-762](repo://src/context.ts#L723-L762)

Each builder's return type is `Response & TypedResponse<T, U, format>`, recording the body type, status and format. That is how the RPC client knows what a route returns; see [[RPC Client]].

Sources: [src/context.ts:156-208](repo://src/context.ts#L156-L208)

## Replacing c.res

`c.res` reads the current response, creating an empty one with the prepared headers if none exists. Assigning `c.res` is how middleware replaces the response after `await next()`, and how `compose` stores a handler's return value. The setter merges: when a response already exists, the new one is cloned and every header of the old one except `Content-Type` is copied onto it, with all `Set-Cookie` lines preserved. Then `finalized` becomes `true`.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

The merge means a header set by a middleware before `await next()` survives even when the handler returns a fresh `Response`, and `Set-Cookie` lines from both are kept. To drop a header from a response, delete it with `c.header(name, undefined)` after `next()`.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434), [src/context.ts:515-527](repo://src/context.ts#L515-L527)

## Rendering with layouts

`c.render(...args)` calls the renderer set with `c.setRenderer`, falling back to `c.html(content)`. A middleware sets the renderer once (for example a page shell) and each handler calls `c.render(<Page />, props)`. `setLayout` and `getLayout` store a layout component that the JSX renderer passes down to nested renderers. The `ContextRenderer` interface can be augmented to type `c.render`'s arguments. The `jsxRenderer` middleware that uses all three is described in [[JSX Server Rendering]].

Sources: [src/context.ts:59-88](repo://src/context.ts#L59-L88), [src/context.ts:448-497](repo://src/context.ts#L448-L497)

## Typed header names

`c.header` and `c.req.header` autocomplete standard names: `ResponseHeader` and `RequestHeader` list the registered HTTP header names, `BaseMime` lists the MIME types for `Content-Type`, and `CustomHeader` keeps any other string allowed.

Sources: [src/utils/headers.ts:8-20](repo://src/utils/headers.ts#L8-L20), [src/utils/headers.ts:252-260](repo://src/utils/headers.ts#L252-L260), [src/utils/headers.ts:333-333](repo://src/utils/headers.ts#L333-L333), [src/utils/mime.ts:28-33](repo://src/utils/mime.ts#L28-L33)
