---
title: "Context"
---
## Overview

Every handler and middleware receives one argument named `c` by convention: a `Context`. It is created once per request by the app's dispatch and carries everything about that request: the wrapped request (`c.req`), the runtime bindings (`c.env`), the execution context, per-request variables, and the response being built. Its helper methods (`c.text`, `c.json`, `c.html` and the rest) build `Response` objects that already include any headers and status set earlier in the chain.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

The context is generic as `Context<E, P, I>`: `E` describes `Bindings` and `Variables`, `P` is the route path (used to type `c.req.param()`), and `I` is the validated input (used by `c.req.valid()`). The way those generics flow from route definitions is covered in [[Type System]].

Sources: [src/context.ts:293-299](repo://src/context.ts#L293-L299), [src/types.ts:30-46](repo://src/types.ts#L30-L46)

## Construction

### ContextOptions

`HonoBase` builds the context with the raw `Request` and a `ContextOptions` object. The constructor only stores these values; nothing is parsed until it is read.

Sources: [src/context.ts:237-252](repo://src/context.ts#L237-L252), [src/context.ts:352-361](repo://src/context.ts#L352-L361)

| Field | Type | Description |
| --- | --- | --- |
| `env` | `E['Bindings']` | Runtime bindings, exposed as `c.env`. Defaults to `{}` when no options are given. |
| `executionCtx` | `FetchEventLike` or `ExecutionContext` | The Workers execution context or Service Worker event. |
| `notFoundHandler` | `NotFoundHandler<E>` | The app's not-found handler, used by `c.notFound()`. |
| `matchResult` | `Result<[H, RouterRoute]>` | The router's match, handed to `HonoRequest` for params. |
| `path` | `string` | The routing path computed by `getPath`. |

Sources: [src/context.ts:237-252](repo://src/context.ts#L237-L252), [src/context.ts:315](repo://src/context.ts#L315)

### Lazy request wrapper

`c.req` is a getter that creates the `HonoRequest` on first access with `??=` and caches it. A handler that never reads the request never pays for the wrapper. See [[HonoRequest]] for its methods.

Sources: [src/context.ts:366-369](repo://src/context.ts#L366-L369)

```ts
get req(): HonoRequest<P, I['out']> {
  this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult)
  return this.#req
}
```

Sources: [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Runtime access

### env, executionCtx and event

`c.env` is a plain public field holding the bindings passed as the second argument of `app.fetch`: KV namespaces, D1 databases and secrets on Cloudflare Workers, or whatever an adapter supplies.

Sources: [src/context.ts:302-315](repo://src/context.ts#L302-L315), [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

`c.executionCtx` returns the third `fetch` argument and `c.event` returns it only when it has `respondWith` (a Service Worker `FetchEvent`). Both getters throw when the value is missing (`This context has no ExecutionContext` or `This context has no FetchEvent`), so code that may run on Node.js or in tests should wrap the access in `try`, as `app.mount()` does.

Sources: [src/context.ts:377-397](repo://src/context.ts#L377-L397), [src/hono-base.ts:355-360](repo://src/hono-base.ts#L355-L360)

The `ExecutionContext` interface defines `waitUntil(promise)`, `passThroughOnException()`, and `props` and `exports` for Wrangler 4.x compatibility.

Sources: [src/context.ts:31-52](repo://src/context.ts#L31-L52)

```ts
app.get('/log', (c) => {
  c.executionCtx.waitUntil(sendAnalytics(c.req.url))
  return c.text('ok')
})
```

Sources: [src/context.ts:31-37](repo://src/context.ts#L31-L37), [src/context.ts:391-397](repo://src/context.ts#L391-L397)

## Variables

### set, get and var

`c.set(key, value)` stores a value in a private `Map` created on first use, and `c.get(key)` reads it back, returning `undefined` when nothing was set. `c.var` returns a fresh read-only object built with `Object.fromEntries`, or `{}` if no variable was ever set. Variables live only for the current request, which makes them the usual way for middleware to pass data (an authenticated user, a database client) to later handlers.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

```ts
set: Set<
  IsAny<E> extends true
    ? {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Variables: ContextVariableMap & Record<string, any>
      }
    : E
> = (key: string, value: unknown) => {
  this.#var ??= new Map()
  this.#var.set(key, value)
}
```

Sources: [src/context.ts:546-556](repo://src/context.ts#L546-L556)

### Typing variables

The `Get` and `Set` overloads accept keys of `E['Variables']` and of the global `ContextVariableMap` interface. Declare variables per app with the `Variables` type parameter, or for every app by augmenting `ContextVariableMap`. When `E` is `any`, any string key is accepted.

Sources: [src/context.ts:57](repo://src/context.ts#L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/context.ts:546-553](repo://src/context.ts#L546-L553)

```ts
type Env = { Variables: { user: { id: string } } }
const app = new Hono<Env>()

app.use(async (c, next) => {
  c.set('user', { id: '42' })
  await next()
})
app.get('/me', (c) => c.json(c.var.user))
```

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Response helpers

### Helper reference

All helpers return a `Response` and accept either `(data, status?, headers?)` or `(data, init?)`, where `init` is a `ResponseInit` or another `Response`. Each is typed so that [[RPC Client (hc)]] can infer the body, status and format from the handler's return value.

Sources: [src/context.ts:113-230](repo://src/context.ts#L113-L230), [src/context.ts:271-277](repo://src/context.ts#L271-L277)

| Helper | Content-Type set | Notes |
| --- | --- | --- |
| `c.body(data, ...)` | none | `data` is a string, `ArrayBuffer`, `ReadableStream`, `Uint8Array` or `null`. |
| `c.text(text, ...)` | `text/plain; charset=UTF-8` | Fast path returns `new Response(text)` when nothing else was set. |
| `c.json(object, ...)` | `application/json` | Body is `JSON.stringify(object)`. |
| `c.html(html, ...)` | `text/html; charset=UTF-8` | Accepts a `Promise<string>` (async JSX) and then returns a `Promise<Response>`. |
| `c.redirect(location, status?)` | none | Sets `Location`; status defaults to 302. |
| `c.notFound()` | depends on handler | Calls the app's not-found handler. |
| `c.newResponse(data, ...)` | none | Untyped base used by the others. |

Sources: [src/context.ts:26](repo://src/context.ts#L26), [src/context.ts:641-721](repo://src/context.ts#L641-L721), [src/context.ts:723-779](repo://src/context.ts#L723-L779)

### How a response is assembled

The private `#newResponse` merges headers in a fixed order. It starts from a copy of the current `c.res` headers if a response already exists, or from the headers prepared by `c.header()`. Headers from an `init` object are applied next (`Set-Cookie` is appended, others overwrite), then the `headers` record, where an array value replaces the header with every element. The status is the numeric argument, else `init.status`, else the one set by `c.status()`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

```ts
const status = typeof arg === 'number' ? arg : (arg?.status ?? this.#status)
return createResponseInstance(data, { status, headers: responseHeaders })
```

Sources: [src/context.ts:637-638](repo://src/context.ts#L637-L638)

`text`, `json` and `html` call `setDefaultContentType`, which puts their `Content-Type` first in the record so a caller-supplied `Content-Type` in `headers` still wins.

Sources: [src/context.ts:279-286](repo://src/context.ts#L279-L286), [src/context.ts:682-733](repo://src/context.ts#L682-L733)

### The text fast path

`c.text` skips header merging when there are no prepared headers, no status, no extra arguments and the context is not finalized. It returns `new Response(text)`, and the Fetch API itself sets `text/plain;charset=UTF-8`. This keeps the common `return c.text('Hello')` cheap.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694)

### html and redirect

`c.html` with a string calls `#newResponse` directly. With a `Promise` (an async JSX tree) it waits for `resolveCallback` in the `Stringify` phase, so every async component has been rendered before the response is built. Rendering is covered in [[JSX Server Rendering]].

Sources: [src/context.ts:723-733](repo://src/context.ts#L723-L733)

`c.redirect` converts the location to a string and sets the `Location` header through `c.header`, encoding it with `encodeURI` only when it contains characters above `\xFF`. It then returns `newResponse(null, status ?? 302)`.

Sources: [src/context.ts:750-762](repo://src/context.ts#L750-L762)

### notFound

`c.notFound()` calls the not-found handler given by the app, so `return c.notFound()` gives the same response as an unmatched route. A context built without options (in a unit test, for example) falls back to an empty `new Response()`, which has status 200.

Sources: [src/context.ts:776-779](repo://src/context.ts#L776-L779), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## Headers and status

### header()

`c.header(name, value, options?)` sets a header that every later helper includes. Before a response exists, headers go into a private `#preparedHeaders` object. Once `c.res` exists, they are written onto that response. `value === undefined` deletes the header and `{ append: true }` appends instead of replacing, which is needed for repeated headers such as `Set-Cookie`.

Sources: [src/context.ts:254-262](repo://src/context.ts#L254-L262), [src/context.ts:515-527](repo://src/context.ts#L515-L527)

When the context is already finalized, `c.header` first re-creates `#res` as a new `Response`. A response returned by `fetch()` has immutable headers, so a middleware that adds headers after `await next()` would otherwise throw.

Sources: [src/context.ts:515-518](repo://src/context.ts#L515-L518)

```ts
app.use(async (c, next) => {
  const start = Date.now()
  await next()
  c.header('X-Response-Time', `${Date.now() - start}ms`)
})
```

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

### status()

`c.status(code)` stores the status in a private field. It does not change an existing response: it is only read by the next helper call that receives no explicit status.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:637](repo://src/context.ts#L637)

## Response finalization

### c.res and finalized

`c.res` is the response that dispatch returns. Reading it before anything was set creates an empty response with the prepared headers. Assigning it sets `finalized = true`, the flag that compose and dispatch check to decide whether a handler answered (see [[Middleware Composition]]).

Sources: [src/context.ts:317](repo://src/context.ts#L317), [src/context.ts:403-434](repo://src/context.ts#L403-L434), [src/hono-base.ts:452-461](repo://src/hono-base.ts#L452-L461)

When a response replaces an existing one, the setter copies the new response into a mutable `Response` and then copies the old response's headers onto it, skipping `content-type`. `Set-Cookie` values are copied with `getSetCookie()` so multiple cookies are kept as separate headers. This is how headers set by middleware before `next()` survive a handler that returns a brand-new `Response`.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

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

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

> [!NOTE]
> Headers from the old response overwrite same-named headers on the new one, and its `Set-Cookie` list replaces the new response's cookies. Only `Content-Type` comes from the new response.

Sources: [src/context.ts:417-430](repo://src/context.ts#L417-L430)

### error

`c.error` holds the error caught by compose before it called the error handler. Middleware can inspect it after `await next()` to log or alter the error response.

Sources: [src/context.ts:318-333](repo://src/context.ts#L318-L333), [src/compose.ts:49-53](repo://src/compose.ts#L49-L53)

## Rendering and layouts

### render and setRenderer

`c.render(...)` calls the renderer set by `c.setRenderer`. With no renderer set, it falls back to `(content) => this.html(content)`. Middleware such as `jsxRenderer` (see [[JSX Renderer Middleware]]) calls `setRenderer` so route handlers can just `return c.render(<Page />)`.

Sources: [src/context.ts:448-451](repo://src/context.ts#L448-L451), [src/context.ts:495-497](repo://src/context.ts#L495-L497)

The renderer's signature comes from the `ContextRenderer` interface: augmenting it changes the parameters `c.render` accepts, and `PropsForRenderer` extracts the second parameter as the props type. Without augmentation the `DefaultRenderer` signature takes a string or `Promise<string>`.

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85)

```ts
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response | Promise<Response>
  }
}
```

Sources: [src/context.ts:62-78](repo://src/context.ts#L62-L78)

### setLayout and getLayout

`c.setLayout(layout)` stores a layout component and returns it; `c.getLayout()` reads it. They let nested renderers wrap content in the parent's layout.

Sources: [src/context.ts:459-472](repo://src/context.ts#L459-L472)
