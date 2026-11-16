---
title: "Context and Responses"
---
## Overview

Every handler and middleware receives one `Context`, conventionally named `c`. Dispatch creates it once per request from the raw `Request`, the routing path, the router's match result, the runtime bindings and the execution context. It is the request's shared state: the parsed request (`c.req`), the bindings (`c.env`), per-request variables (`c.set`/`c.get`), and the response being built (`c.res`). Its response helpers (`c.text`, `c.json`, `c.html`, `c.body`, `c.redirect`) are how handlers usually answer.

Sources: [src/context.ts:293-364](repo://src/context.ts#L293-L364), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

The Context does as little as it can up front. The `HonoRequest` wrapper is created on first access to `c.req`, the variables `Map` on the first `c.set`, and the headers object on the first `c.header`. A handler that returns `c.text('ok')` without touching anything else allocates only the `Response`. Reading the request is covered on [[Reading Requests]]; how responses flow through middleware is on [[Middleware Composition and Error Handling]].

Sources: [src/context.ts:366-369](repo://src/context.ts#L366-L369), [src/context.ts:553-556](repo://src/context.ts#L553-L556), [src/context.ts:682-694](repo://src/context.ts#L682-L694)

## Runtime handles

| Property | Holds | When missing |
| --- | --- | --- |
| `c.env` | The second argument of `app.fetch`: Cloudflare bindings, the Bun server, Lambda event data | `{}` |
| `c.executionCtx` | The `ExecutionContext` (`waitUntil`, `passThroughOnException`, `props`) | Throws `This context has no ExecutionContext` |
| `c.event` | The `FetchEvent`, only when the app was run by a Service Worker `fetch` listener | Throws `This context has no FetchEvent` |
| `c.req` | The `HonoRequest` for this request | Always present |

Sources: [src/context.ts:31-53](repo://src/context.ts#L31-L53), [src/context.ts:352-399](repo://src/context.ts#L352-L399)

Because `executionCtx` throws when absent, code that may run on runtimes without one (Bun, Node.js, tests through `app.request`) should wrap the access in `try`. `mount` does exactly this before forwarding `[env, executionCtx]` to a foreign app (see [[Hono Application]]).

Sources: [src/context.ts:391-399](repo://src/context.ts#L391-L399), [src/hono-base.ts:355-361](repo://src/hono-base.ts#L355-L361)

## Variables

`c.set(key, value)` stores a value for the rest of the request; `c.get(key)` reads it, and `c.var` returns all of them as a read-only object built with `Object.fromEntries`. Variables live in a `Map` that is created on the first `set`, so `get` on a context with no variables returns `undefined` without allocating.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Keys and value types come from two places. The app's `Env['Variables']` types them per app, which is how a middleware built with `createMiddleware<{ Variables: { user: User } }>` makes `c.get('user')` typed downstream. The empty `ContextVariableMap` interface can be augmented with `declare module 'hono'` to type a key globally, which is how built-in middleware like `requestId` and `jwt` declare the variables they set.

Sources: [src/context.ts:57-57](repo://src/context.ts#L57-L57), [src/context.ts:95-111](repo://src/context.ts#L95-L111), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

## Building a response

### Helpers

| Method | Body | Default `Content-Type` |
| --- | --- | --- |
| `c.body(data, status?, headers?)` | `string`, `ArrayBuffer`, `ReadableStream`, `Uint8Array` or `null` | none |
| `c.text(text, ...)` | string | `text/plain; charset=UTF-8` |
| `c.json(object, ...)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, ...)` | string or promise of string | `text/html; charset=UTF-8` |
| `c.redirect(location, status = 302)` | none; sets `Location` | none |
| `c.newResponse(...)` | Same as `c.body` | none |
| `c.notFound()` | The app's not-found handler | from that handler |

Sources: [src/context.ts:664-733](repo://src/context.ts#L664-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

Every helper accepts either `(data, status, headers)` or `(data, init)`, where `init` is a `ResponseInit`-like object or an existing `Response` whose status and headers are reused. The status types come from `utils/http-status`: `c.json` and `c.text` only accept `ContentfulStatusCode`, which excludes 101, 204, 205 and 304, so a handler cannot declare a body with a status that forbids one.

Sources: [src/context.ts:113-149](repo://src/context.ts#L113-L149), [src/utils/http-status.ts:63-72](repo://src/utils/http-status.ts#L63-L72)

### How headers and status merge

All helpers go through the private `#newResponse`, which builds the final headers in a fixed order:

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

1. Start from the current `c.res` headers if a response already exists, otherwise from the headers prepared by earlier `c.header` calls.
2. Apply the headers of the `init` argument; `Set-Cookie` is appended, everything else replaces.
3. Apply the `headers` record argument; an array value replaces the header with all its entries.
4. Take the status from a numeric argument, then `init.status`, then the value set by `c.status()`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`c.text` takes a shortcut: when no header, status, argument or earlier response exists, it returns `new Response(text)` directly, relying on the platform's default `text/plain;charset=UTF-8`. The helpers set their content type through `setDefaultContentType`, which places it before the caller's headers so a caller-supplied `Content-Type` wins.

Sources: [src/context.ts:279-286](repo://src/context.ts#L279-L286), [src/context.ts:682-694](repo://src/context.ts#L682-L694)

`c.redirect` encodes the location with `encodeURI` only when it contains characters above `0xFF`, since header values must be byte strings. `c.html` accepts a promise (such as a JSX element with async children) and resolves its HTML callbacks before building the response; see [[JSX Server Rendering]].

Sources: [src/context.ts:723-762](repo://src/context.ts#L723-L762)

### c.header and c.status

`c.header(name, value, { append })` sets, appends or (with no value) deletes a header. Before any response exists it writes into a prepared `Headers` object that the next helper starts from. After the response is finalized, it first clones the response so that headers stay mutable, then writes into it; this is what lets middleware add headers after `await next()`.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` records a status that later helpers use when they are not given one.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531)

## The response object

`c.res` is lazy: reading it before any handler answered creates an empty `Response` with the prepared headers. Assigning it marks the context `finalized`. When a response already exists, the setter clones the new one and copies the old headers onto it, skipping `Content-Type` and appending each `Set-Cookie`, so headers added by outer middleware before `next()` survive a replacement.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

`c.finalized` is what the middleware chain checks to decide whether a returned value becomes the response, and `c.error` holds the error the error handler received. Both are described on [[Middleware Composition and Error Handling]].

Sources: [src/context.ts:317-333](repo://src/context.ts#L317-L333)

## Rendering with a layout

`c.render(...args)` calls the renderer set by `c.setRenderer`, or, by default, `c.html(content)`. A middleware sets the renderer once (for example the page shell) and handlers call `c.render(<Page />)`. `setLayout` and `getLayout` hold a layout component that the JSX renderer middleware uses to nest layouts.

Sources: [src/context.ts:448-497](repo://src/context.ts#L448-L497)

The renderer's arguments are typed by augmenting the `ContextRenderer` interface; when it is not augmented, `Renderer` falls back to `(content) => Response | Promise<Response>`. `jsxRenderer` (see [[JSX Server Rendering]]) is the built-in middleware that sets it.

Sources: [src/context.ts:62-88](repo://src/context.ts#L62-L88)

## Reaching the context from anywhere

The `contextStorage()` middleware from `hono/context-storage` runs the rest of the chain inside `AsyncLocalStorage.run(c, next)`. Code called from a handler, such as a data-access module, can then call `getContext()` instead of receiving `c` as an argument. `getContext` throws `Context is not available` outside a request, and `tryGetContext` returns `undefined` there instead.

Sources: [src/middleware/context-storage/index.ts:6-59](repo://src/middleware/context-storage/index.ts#L6-L59)

> [!NOTE]
> The middleware imports `node:async_hooks`, so it needs a runtime that provides `AsyncLocalStorage`: Node.js, Bun, Deno, or Cloudflare Workers with the Node.js compatibility flag.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10)
