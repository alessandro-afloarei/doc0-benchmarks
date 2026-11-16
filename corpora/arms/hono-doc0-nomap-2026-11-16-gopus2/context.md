---
title: "Context"
---
## Overview

`Context` is the object every handler and middleware receives as `c`. One is created per request by `#dispatch`, as [[Request Lifecycle and Middleware]] shows, and it carries everything that request needs: the parsed request (`c.req`), the runtime's bindings and execution context, per-request variables, the response being built, and the renderer middleware can install. This page covers what `Context` offers and how it builds responses; reading the request is covered in [[HonoRequest]].

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

The class takes three type parameters: the app's `Env` (its `Bindings` and `Variables`), the route path `P` that types `c.req.param`, and the validated `Input` that types `c.req.valid`. [[Route Types and Factory]] explains where they come from.

Sources: [src/context.ts:293-301](repo://src/context.ts#L293-L301)

## Runtime values

| Member | What it holds | When missing |
| --- | --- | --- |
| `c.req` | A `HonoRequest` over the raw request, created on first access | Never missing |
| `c.env` | The bindings the runtime passed to `fetch` (variables, secrets, KV, D1, R2 on Workers) | `{}` |
| `c.executionCtx` | The `ExecutionContext` with `waitUntil`, `passThroughOnException`, `props` | Throws `This context has no ExecutionContext` |
| `c.event` | The `FetchEvent` when the app runs as a service worker | Throws `This context has no FetchEvent` |
| `c.error` | The error a later handler threw, set by `compose` before calling `onError` | `undefined` |
| `c.finalized` | True once a response has been assigned to `c.res` | `false` |

Sources: [src/context.ts:28-52](repo://src/context.ts#L28-L52), [src/context.ts:302-397](repo://src/context.ts#L302-L397)

`c.event` tells the two kinds of execution context apart by looking for a `respondWith` method, which only a fetch event has.

Sources: [src/context.ts:371-383](repo://src/context.ts#L371-L383)

## Variables

`c.set(key, value)` stores a value in a `Map` created on first use, and `c.get(key)` reads it back, returning `undefined` when nothing was set. `c.var` returns all variables as a read-only plain object built with `Object.fromEntries`, so `c.var.user` reads like a property. Middleware uses variables to hand data to later handlers: a JWT middleware sets `jwtPayload`, a request ID middleware sets `requestId`.

Sources: [src/context.ts:533-602](repo://src/context.ts#L533-L602)

The keys and their types come from two places. An app declares them in its `Env` type, `new Hono<{ Variables: { user: User } }>()`. A library declares them globally by augmenting the empty `ContextVariableMap` interface, which every `get` and `set` signature accepts as well: the `jwt` entry point extends it with `JwtVariables`, and `request-id` with `RequestIdVariables`.

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/context.ts:90-108](repo://src/context.ts#L90-L108), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)

## Building the response

### Status and headers before the response exists

`c.status(code)` records a status for the next response the context builds. `c.header(name, value, options)` sets a header: before any response exists it writes into a `Headers` object the context prepares, and after one exists it writes into that response's headers. Passing no value deletes the header, and `{ append: true }` appends instead of replacing, which `Set-Cookie` needs.

Sources: [src/context.ts:499-531](repo://src/context.ts#L499-L531)

When the context is already finalized, `header` first copies the response with `new Response(body, res)`, because a response returned by `fetch` can have immutable headers.

Sources: [src/context.ts:515-519](repo://src/context.ts#L515-L519)

### Response helpers

All helpers go through `#newResponse(data, statusOrInit, headers)`. It starts from the current response's headers or the prepared headers, merges the headers of an init object (appending `Set-Cookie`, replacing others), then the extra headers record (an array value appends each entry), and picks the status from the argument, the init object or `c.status`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Helper | Body | Content-Type set |
| --- | --- | --- |
| `c.newResponse(data, ...)` | Data as given | None |
| `c.body(data, ...)` | Data as given | None |
| `c.text(text, ...)` | The string | `text/plain; charset=UTF-8` |
| `c.json(object, ...)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, ...)` | The string, or the awaited result of an `HtmlEscapedString` promise | `text/html; charset=UTF-8` |
| `c.redirect(location, status)` | `null` | None; sets `Location`, status 302 by default |
| `c.notFound()` | Whatever the app's not-found handler returns | Set by that handler |

Sources: [src/context.ts:641-733](repo://src/context.ts#L641-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

`c.text` has a fast path: when no headers were prepared, no status set, no argument given and the context is not finalized, it returns `new Response(text)` without the merge, relying on the runtime's own `text/plain` default.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694)

`c.redirect` percent-encodes the location with `encodeURI` only when it contains characters above `\xFF`, so an already encoded URL is left alone. `c.html` given a promise resolves its callbacks in the `Stringify` phase before building the response, which is how async JSX can be passed straight to it; see [[JSX Streaming and Suspense]].

Sources: [src/context.ts:723-762](repo://src/context.ts#L723-L762)

### Typed returns

Each helper's return type is `Response & TypedResponse<T, U, format>`, recording the body type, the status code and the format (`body`, `text`, `json`, `redirect`). `c.json` records `JSONParsed<T>`, the type the object has after a JSON round trip. The status parameter of body-carrying helpers is limited to `ContentfulStatusCode`, which excludes 101, 204, 205 and 304. These types are what the [[RPC Client]] reads back.

Sources: [src/context.ts:118-230](repo://src/context.ts#L118-L230), [src/utils/http-status.ts:63-72](repo://src/utils/http-status.ts#L63-L72)

## c.res and header merging

Reading `c.res` before any handler produced a response returns an empty `Response` carrying the prepared headers, created once. Assigning `c.res` sets `finalized` to true. When a response already existed, the new one is copied and every header of the old one except `Content-Type` is carried over, with `Set-Cookie` values appended one by one so no cookie is lost.

Sources: [src/context.ts:399-434](repo://src/context.ts#L399-L434)

```ts
set res(_res: Response | undefined) {
  if (this.#res && _res) {
    _res = createResponseInstance(_res.body, _res)
    for (const [k, v] of this.#res.headers.entries()) {
      if (k === 'content-type') {
        continue
      }
      if (k === 'set-cookie') {
        const cookies = this.#res.headers.getSetCookie()
        _res.headers.delete('set-cookie')
        for (const cookie of cookies) {
          _res.headers.append('set-cookie', cookie)
        }
      } else {
        _res.headers.set(k, v)
      }
    }
  }
  this.#res = _res
  this.finalized = true
}
```

Sources: [src/context.ts:399-434](repo://src/context.ts#L399-L434)

This merge is what lets middleware set headers after `await next()` and still see a handler's response keep them, and what lets a response replaced by `onError` keep headers set earlier in the chain.

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434), [src/compose.ts:67-70](repo://src/compose.ts#L67-L70)

## Renderer and layout

`c.render(...)` calls the context's renderer. Unless middleware installed one with `c.setRenderer`, the renderer is `(content) => c.html(content)`. The `jsxRenderer` middleware installs a renderer that wraps content in a layout, described in [[JSX Server Rendering]].

Sources: [src/context.ts:436-497](repo://src/context.ts#L436-L497)

The renderer's signature is typed through the empty `ContextRenderer` interface. When an app augments it with a function type, `Renderer` becomes that type and `PropsForRenderer` is its second parameter; otherwise the renderer takes a string or a promise of a string.

Sources: [src/context.ts:59-88](repo://src/context.ts#L59-L88)

`c.setLayout(layout)` and `c.getLayout()` store and return a layout component for the request. `jsxRenderer` uses them so nested renderers can find the layout above them.

Sources: [src/context.ts:453-472](repo://src/context.ts#L453-L472), [src/middleware/jsx-renderer/index.ts:115-128](repo://src/middleware/jsx-renderer/index.ts#L115-L128)
