---
title: "Context"
---
## Overview

`Context` is the `c` every handler and middleware receives. One is created per request by `#dispatch` (see [[Request Lifecycle and Middleware Composition]]), and it carries everything a layer needs: the request as `c.req`, the runtime's `env` and execution context, per-request variables, and the response being built. Its response builders (`c.text`, `c.json`, `c.html` and the rest) produce standard `Response` objects that also carry type information for the [[RPC Client]]. Reading the request is covered in [[HonoRequest]].

Sources: [src/context.ts:293-369](repo://src/context.ts#L293-L369)

## Construction and request access

The constructor stores the raw `Request` and, when given, the execution context, `env`, the not-found handler, the routed path and the router's match result. It does not build anything else: `c.req` is a getter that creates the `HonoRequest` on first access with `??=`, and `c.res` is created only when someone reads it. A handler that answers without reading the request or touching headers allocates no extra objects.

Sources: [src/context.ts:352-369](repo://src/context.ts#L352-L369), [src/context.ts:403-407](repo://src/context.ts#L403-L407)

## Runtime bindings

| Member | What it holds |
| --- | --- |
| `c.env` | The second argument of `fetch`: Cloudflare bindings (KV, D1, R2, secrets), Lambda's event and context, Netlify's context, or `{}` |
| `c.executionCtx` | The `ExecutionContext` with `waitUntil`, `passThroughOnException` and `props`; throws `This context has no ExecutionContext` when the runtime gave none |
| `c.event` | The `FetchEvent`, only for Service Worker style runtimes; throws when the execution context has no `respondWith` |
| `c.error` | The error a later layer threw, set by `compose` before calling `onError` |

Sources: [src/context.ts:303-333](repo://src/context.ts#L303-L333), [src/context.ts:371-397](repo://src/context.ts#L371-L397), [src/context.ts:31-52](repo://src/context.ts#L31-L52)

`c.executionCtx` is the way to run work after the response is sent, as in `c.executionCtx.waitUntil(promise)`. Because the getter throws when absent, code that also runs where no execution context exists, such as `mount` in [[The Hono Application]], wraps the access in `try`.

Sources: [src/context.ts:391-397](repo://src/context.ts#L391-L397), [src/hono-base.ts:355-361](repo://src/hono-base.ts#L355-L361)

## Variables

`c.set(key, value)` and `c.get(key)` store values in a `Map` created on the first `set`, which is how middleware passes data to later layers: `jwt` stores `jwtPayload`, `requestId` stores `requestId`, and so on. `c.var` returns a read-only snapshot of the same map as a plain object (built with `Object.fromEntries` on each access), so `c.var.user` reads like a property.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Both accessors are typed from two places. The app's `Env['Variables']` types the keys of one app; the global `ContextVariableMap` interface, which middleware extends with declaration merging, types keys everywhere. When the app's `Env` is `any`, `set` and `get` accept any string.

Sources: [src/context.ts:53-57](repo://src/context.ts#L53-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108)

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

## Building responses

### The builders

| Method | Body | Default `Content-Type` | Notes |
| --- | --- | --- | --- |
| `c.body(data, status?, headers?)` | string, `ArrayBuffer`, `Uint8Array`, `ReadableStream` or `null` | none | Typed as a `'body'` response |
| `c.text(text, status?, headers?)` | string | `text/plain; charset=UTF-8` | Fast path when nothing else was set |
| `c.json(object, status?, headers?)` | `JSON.stringify(object)` | `application/json` | Response type carries the JSON shape |
| `c.html(html, status?, headers?)` | string or `Promise<string>` | `text/html; charset=UTF-8` | Resolves JSX callbacks first |
| `c.redirect(location, status = 302)` | none | none | Sets `Location`, encoding non-Latin-1 URLs with `encodeURI` |
| `c.notFound()` | from the app's not-found handler | | Returns the app's 404 response |
| `c.newResponse(data, status?, headers?)` | any `Data` | none | The untyped primitive behind the others |

Sources: [src/context.ts:641-733](repo://src/context.ts#L641-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

Every builder except `text`'s fast path goes through `#newResponse`. It starts from the headers already collected (a copy of the current response's headers, or the prepared headers from `c.header`), applies the headers of a `ResponseInit` or `Response` passed as the second argument (appending `Set-Cookie` instead of replacing it), then applies the third argument, where an array value replaces the header with each item appended. The status is the numeric argument, else `init.status`, else the one set by `c.status()`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`c.text` returns a bare `new Response(text)` when no header, status, argument or earlier response exists, skipping header handling entirely; the platform then supplies `text/plain;charset=UTF-8`. `c.html` checks whether its argument is an object, which covers both promises and the `String` objects that JSX produces, and in that case resolves the pending callbacks through `resolveCallback` before building the response; see [[JSX Server Rendering]].

Sources: [src/context.ts:682-733](repo://src/context.ts#L682-L733)

### Typed responses

The second argument of `text`, `json` and `body` is typed as a `ContentfulStatusCode`, which excludes 101, 204, 205 and 304, because those statuses cannot carry a body. Each builder returns `Response & TypedResponse<Body, Status, Format>`: at run time it is an ordinary `Response`, and at compile time the route's schema records the body, status and format so the client can infer them, as [[Typed Routes and Schemas]] explains.

Sources: [src/utils/http-status.ts:63-72](repo://src/utils/http-status.ts#L63-L72), [src/context.ts:121-208](repo://src/context.ts#L121-L208)

## Headers and status before the response

`c.header(name, value, { append })` sets, appends or (with `value` undefined) deletes a header. Before any response exists the headers go into a prepared `Headers` object that the next builder starts from; after a response exists they go onto that response. When the context is already finalized, `c.header` first copies the response with `new Response(body, res)`, because a response returned by `fetch` or by another layer may have immutable headers.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` stores a status used by the next builder that is not given one explicitly. Header names are typed with the `ResponseHeader` list from `utils/headers` for completion, while any string is still accepted.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:254-262](repo://src/context.ts#L254-L262), [src/utils/headers.ts:252-260](repo://src/utils/headers.ts#L252-L260)

## Replacing the response

Assigning `c.res` is how middleware replaces the response after `await next()`, as compression, ETag and pretty-JSON middleware do. The setter marks the context `finalized`. When a response already existed, it rebuilds the new one and copies every old header onto it except `Content-Type`, and re-appends all `Set-Cookie` values with `getSetCookie()` so cookies set earlier are not merged into one header. The new response keeps its own content type but inherits headers set by outer layers.

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434)

```ts
app.use(async (c, next) => {
  await next()
  c.res = new Response('replaced', c.res)
})
```

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`finalized` is the flag the dispatcher and `compose` read to decide whether a response exists; it becomes true only through this setter. Reading `c.res` before anything set it returns an empty response wrapping the prepared headers, which lets middleware inspect headers without finalizing.

Sources: [src/context.ts:317-317](repo://src/context.ts#L317-L317), [src/context.ts:403-407](repo://src/context.ts#L403-L407)

## Rendering with a layout

`c.render(...args)` calls the renderer set with `c.setRenderer`, or by default wraps the content in `c.html`. The `ContextRenderer` interface is extended by declaration merging to give `c.render` its own signature. `c.setLayout` and `c.getLayout` store a layout component for the request. The `jsxRenderer` middleware uses all three to wrap pages in a document layout, described in [[JSX Server Rendering]].

Sources: [src/context.ts:58-88](repo://src/context.ts#L58-L88), [src/context.ts:448-497](repo://src/context.ts#L448-L497)
