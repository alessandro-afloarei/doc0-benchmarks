---
title: "Context"
---
## Overview

`Context` is the `c` every handler and middleware receives. It is created once per request by the dispatcher in [[Request Lifecycle and Middleware Composition]] and carries everything a handler needs: the request wrapper `c.req`, the runtime's bindings and execution context, per-request variables, and the helpers that build the `Response`. It also holds the response being built, so middleware can read and change it after `await next()`.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361)

The constructor only stores what it is given (raw request, path, match result, bindings, execution context, not-found handler). The [[HonoRequest]] behind `c.req` is created on first access, and the response object only when something asks for it.

Sources: [src/context.ts:352-369](repo://src/context.ts#L352-L369)

## Runtime bindings

| Member | Value | When absent |
| --- | --- | --- |
| `c.env` | the second argument of `app.fetch` (Workers bindings, Lambda event, Bun server, ...) | `{}` when constructed without options |
| `c.executionCtx` | the third argument of `app.fetch`, with `waitUntil`, `passThroughOnException`, `props` | throws `This context has no ExecutionContext` |
| `c.event` | the `FetchEvent` passed by service-worker style entry points | throws `This context has no FetchEvent` |

Sources: [src/context.ts:28-52](repo://src/context.ts#L28-L52), [src/context.ts:302-315](repo://src/context.ts#L302-L315), [src/context.ts:371-397](repo://src/context.ts#L371-L397)

`c.event` is recognised by the presence of `respondWith` on the stored execution context, which is how `app.fire()` and the service-worker adapter's `FetchEvent` reach it ([[Runtime Adapters]]).

Sources: [src/context.ts:377-383](repo://src/context.ts#L377-L383)

## Building responses

### Response helpers

All helpers go through one private `#newResponse`, so headers prepared with `c.header()` and a status set with `c.status()` apply to whichever helper runs.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Helper | Body | Content-Type set |
| --- | --- | --- |
| `c.body(data, status?, headers?)` | string, `ArrayBuffer`, `Uint8Array` or `ReadableStream`, or `null` | none |
| `c.text(text, ...)` | string | `text/plain; charset=UTF-8` |
| `c.json(value, ...)` | `JSON.stringify(value)` | `application/json` |
| `c.html(html, ...)` | string, or a promise of one such as rendered JSX | `text/html; charset=UTF-8` |
| `c.redirect(location, status = 302)` | none; sets `Location` | none |
| `c.newResponse(data, ...)` | same as `body`, untyped | none |
| `c.notFound()` | the app's not-found response | from that handler |

Sources: [src/context.ts:641-733](repo://src/context.ts#L641-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

Every helper accepts either `(data, status, headers)` or `(data, init)`, where `init` is a `ResponseInit`-like object or another `Response` to copy status and headers from. Header records may give an array to emit a header several times.

Sources: [src/context.ts:110-141](repo://src/context.ts#L110-L141), [src/context.ts:264-277](repo://src/context.ts#L264-L277)

### How headers and status are combined

`#newResponse` starts from a copy of the current response's headers if one exists, otherwise from the prepared headers. It then applies `init.headers` (appending `Set-Cookie`, setting everything else), then the header record (a string value replaces, an array deletes and appends each item). The status is the numeric argument, else `init.status`, else the one stored by `c.status()`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`c.text()` has a shortcut: with no prepared headers, no stored status, no extra arguments and no finalized response it returns `new Response(text)` without building a header set. `c.html()` given a promise resolves its HTML callbacks (the hooks [[Server-Side JSX Rendering]] uses for async components and CSS) before building the response, and therefore returns a promise.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

`c.redirect()` sets `Location` through `c.header()`, URI-encoding the location only when it contains characters outside Latin-1, and the status type is limited to redirect codes.

Sources: [src/context.ts:750-762](repo://src/context.ts#L750-L762)

The return types of these helpers carry the body, status and format as a `TypedResponse`, which is what lets [[Typed Routes and Schemas]] and the [[RPC Client]] know each route's output.

Sources: [src/context.ts:143-208](repo://src/context.ts#L143-L208)

## Headers and status before the response

`c.header(name, value, { append })` writes to the current response's headers if one exists, else to a prepared `Headers` object that the next response helper starts from. Passing `undefined` as the value deletes the header. If the context is already finalized, `c.header()` first re-creates the response from its body and init so the headers are mutable.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` only records the code for the next helper call; it does not change a response that already exists.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531)

## Reading and replacing c.res

Reading `c.res` before any response exists creates an empty `Response` whose headers are the prepared header set, so middleware may call `c.res.headers.set()` before the handler runs.

Sources: [src/context.ts:403-407](repo://src/context.ts#L403-L407)

Assigning `c.res` marks the context finalized. When a response already existed, the new one is re-created and every old header except `Content-Type` is copied onto it; `Set-Cookie` values from the old response replace any on the new one, appended one by one. Middleware that run after `next()` and replace the response (compression, ETag, pretty JSON in [[Response Middleware]]) rely on this to keep headers set earlier.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

## Variables

`c.set(key, value)` stores a value in a per-request `Map` created on first use, and `c.get(key)` reads it (or `undefined`). `c.var` returns a fresh read-only object built from the map with `Object.fromEntries` on each access. Middleware use this channel to hand data to handlers, such as `jwtPayload` from the JWT middleware or `requestId`.

Sources: [src/context.ts:533-602](repo://src/context.ts#L533-L602), [src/middleware/jwt/jwt.ts:154-156](repo://src/middleware/jwt/jwt.ts#L154-L156), [src/middleware/request-id/request-id.ts:46-58](repo://src/middleware/request-id/request-id.ts#L46-L58)

Keys and value types come from two places: the app's `Env['Variables']` type parameter, and the `ContextVariableMap` interface, which modules augment globally. When the context's environment type is `any`, both `set` and `get` accept any string key.

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/context.ts:90-108](repo://src/context.ts#L90-L108), [src/types.ts:26-33](repo://src/types.ts#L26-L33)

## Rendering with layouts

`c.render(...args)` calls the renderer set by `c.setRenderer()`; without one it falls back to `c.html(content)`. `c.setLayout()` and `c.getLayout()` store a layout component on the context. Both exist for the `jsxRenderer` middleware, which installs a renderer that wraps content in the layout ([[Server-Side JSX Rendering]]). The `ContextRenderer` interface can be augmented to type `c.render`'s arguments.

Sources: [src/context.ts:59-88](repo://src/context.ts#L59-L88), [src/context.ts:436-497](repo://src/context.ts#L436-L497)

## Errors and not found

`c.error` holds the error caught by `compose` for the current chain, so middleware can check it after `await next()`. `c.notFound()` calls the not-found handler the app stored on the context; a `Context` built without one returns an empty `Response`.

Sources: [src/context.ts:318-333](repo://src/context.ts#L318-L333), [src/context.ts:776-779](repo://src/context.ts#L776-L779)
