---
title: "Context"
---
## Overview

Every handler and middleware receives a single argument `c`, an instance of `Context` from `src/context.ts`. It is the per-request object that carries the incoming request (`c.req`), the runtime bindings (`c.env`), the execution context, typed variables shared between middleware, and the response being built. `HonoBase#dispatch` creates one `Context` per request and hands the same instance to every handler in the chain.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

The class keeps most of its state in private fields and creates expensive objects only when a handler asks for them. The `HonoRequest` wrapper, the variables `Map`, the response `Headers` and the default `Response` are all created on first access. A handler that returns `c.text('ok')` with no other calls never allocates any of them.

Sources: [src/context.ts:300-344](repo://src/context.ts#L300-L344), [src/context.ts:363-369](repo://src/context.ts#L363-L369), [src/context.ts:682-694](repo://src/context.ts#L682-L694)

## Request, env and execution context

`ContextOptions` is what dispatch passes in: `env`, `executionCtx`, `notFoundHandler`, `matchResult` and `path`. The constructor stores them as given, so `c.env` is whatever the runtime passed to `app.fetch`, and `undefined` when nothing was passed.

Sources: [src/context.ts:237-252](repo://src/context.ts#L237-L252), [src/context.ts:352-361](repo://src/context.ts#L352-L361)

| Member | Kind | Behavior |
| --- | --- | --- |
| `c.req` | getter | Creates `new HonoRequest(rawRequest, path, matchResult)` on first access and caches it. See [[HonoRequest]]. |
| `c.env` | property | Bindings typed by `E['Bindings']`: environment variables, KV, D1, R2 on Cloudflare, or whatever the adapter passes. |
| `c.executionCtx` | getter | Returns the `ExecutionContext` (`waitUntil`, `passThroughOnException`, `props`, `exports`). Throws `This context has no ExecutionContext` when none was passed. |
| `c.event` | getter | Returns the `FetchEvent` only when the execution context has `respondWith` (Service Worker mode). Otherwise throws `This context has no FetchEvent`. |
| `c.error` | property | The `Error` caught by `compose`, readable by middleware after `await next()`. |
| `c.finalized` | property | `true` once a response has been assigned to `c.res`. |

Sources: [src/context.ts:31-52](repo://src/context.ts#L31-L52), [src/context.ts:302-334](repo://src/context.ts#L302-L334), [src/context.ts:363-397](repo://src/context.ts#L363-L397)

```ts
app.get('/count', async (c) => {
  const value = await c.env.KV.get('count')
  c.executionCtx.waitUntil(c.env.KV.put('count', String(Number(value) + 1)))
  return c.text(`count: ${value}`)
})
```

Sources: [src/context.ts:31-41](repo://src/context.ts#L31-L41), [src/context.ts:385-397](repo://src/context.ts#L385-L397)

## Variables

### set, get and var

`c.set(key, value)` stores a value in a private `Map` that is created on the first call. `c.get(key)` reads it back, or returns `undefined` when nothing was ever set. `c.var` returns `Object.fromEntries` of the map, so `c.var.user` reads like a property. The result is a fresh read-only snapshot on every access, and writing to it does not change the context.

Sources: [src/context.ts:533-602](repo://src/context.ts#L533-L602)

The keys and value types come from `E['Variables']` of the app's `Env`. When `E` is `any` (an untyped app), the accepted keys are `ContextVariableMap` plus any string.

Sources: [src/context.ts:90-108](repo://src/context.ts#L90-L108), [src/context.ts:546-580](repo://src/context.ts#L546-L580)

```ts
type Env = { Variables: { user: { id: string } } }
const app = new Hono<Env>()

app.use(async (c, next) => {
  c.set('user', { id: 'u1' })
  await next()
})

app.get('/me', (c) => c.json({ id: c.var.user.id, same: c.get('user').id }))
```

Sources: [src/context.ts:533-602](repo://src/context.ts#L533-L602)

### Typing variables globally

Middleware packages declare their variables by augmenting the exported `ContextVariableMap` interface. After that, `c.get('requestId')` is typed in every app without listing it in `Variables`. The `requestId`, `jwt`, `timing`, `language` and `secureHeaders` middleware all do this.

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/middleware/request-id/index.ts:1-7](repo://src/middleware/request-id/index.ts#L1-L7)

```ts
declare module 'hono' {
  interface ContextVariableMap {
    tenant: string
  }
}
```

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/index.ts:39-40](repo://src/index.ts#L39-L40)

## Headers and status

`c.header(name, value, options?)` writes to the response headers. Before a response exists, it writes to a private `Headers` object (`#preparedHeaders`) that the response helpers will start from. After a response exists, it writes to `c.res.headers`. If the context is already finalized, the current response is first re-created with `new Response(body, res)`, because a returned `Response` may have immutable headers. A `value` of `undefined` deletes the header, and `{ append: true }` appends instead of replacing, as needed for repeated headers such as `Set-Cookie`.

Sources: [src/context.ts:499-527](repo://src/context.ts#L499-L527)

`c.status(code)` only records a default status. The helpers use it when you pass no status of your own.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:637-638](repo://src/context.ts#L637-L638)

```ts
app.post('/posts', (c) => {
  c.status(201)
  c.header('X-Request-Id', crypto.randomUUID())
  c.header('Set-Cookie', 'a=1', { append: true })
  c.header('Set-Cookie', 'b=2', { append: true })
  return c.body('created')
})
```

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531), [src/context.ts:664-668](repo://src/context.ts#L664-L668)

## Response helpers

### How a response is assembled

`body`, `json`, `html`, `redirect` and the slow path of `text` all build their response with `#newResponse(data, arg, headers)`:

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

1. It starts from a copy of `c.res.headers` when a response already exists, and otherwise from `#preparedHeaders` (or an empty `Headers`).
2. If `arg` is an object with `headers` (a `ResponseInit` or another `Response`), those headers are merged in. `set-cookie` is appended and every other header replaces the existing value.
3. The `headers` record argument is applied last. A string value replaces the header, and an array value deletes the header and appends each element.
4. The status is `arg` when it is a number, otherwise `arg.status`, otherwise the value from `c.status()`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

`statusText` in an init object is not passed on.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

`c.newResponse(data, statusOrInit?, headers?)` exposes that same function. The other helpers wrap it and add a default `Content-Type`. `setDefaultContentType` puts the default first and spreads the caller's `headers` record after it, so a `Content-Type` in that record wins. A `Content-Type` set earlier with `c.header()` is overwritten by `text`, `json` and `html`. Use `c.body()` to keep it.

Sources: [src/context.ts:279-291](repo://src/context.ts#L279-L291), [src/context.ts:641-641](repo://src/context.ts#L641-L641)

| Helper | Body | Default Content-Type | Notes |
| --- | --- | --- | --- |
| `c.body(data, status?, headers?)` | `string`, `ArrayBuffer`, `Uint8Array`, `ReadableStream` or `null` | none | Keeps any `Content-Type` set with `c.header()`. |
| `c.text(text, status?, headers?)` | string | `text/plain; charset=UTF-8` | Returns a bare `new Response(text)` when no headers, status, arguments or previous response exist. |
| `c.json(object, status?, headers?)` | `JSON.stringify(object)` | `application/json` | The return type carries the JSON shape for the [[RPC Client]]. |
| `c.html(html, status?, headers?)` | string or `Promise<string>` | `text/html; charset=UTF-8` | A promise or `HtmlEscapedString` is resolved with `resolveCallback` first, and the result is then a `Promise<Response>`. |
| `c.redirect(location, status = 302)` | `null` | none | Sets `Location`, encoding it with `encodeURI` when it contains characters above `\xFF`. |
| `c.notFound()` | from the app's not-found handler | depends on handler | Falls back to an empty `new Response()` when the context was built without a handler. |
| `c.render(...args)` | from the renderer | `text/html; charset=UTF-8` by default | Uses `c.setRenderer()` output, else `c.html(content)`. |

Sources: [src/context.ts:18-26](repo://src/context.ts#L18-L26), [src/context.ts:643-694](repo://src/context.ts#L643-L694), [src/context.ts:696-779](repo://src/context.ts#L696-L779)

```ts
app.get('/api', (c) => c.json({ ok: true }, 200, { 'Cache-Control': 'no-store' }))
app.get('/page', (c) => c.html('<h1>Hello</h1>'))
app.get('/old', (c) => c.redirect('/new', 301))
app.get('/bin', (c) => c.body(new Uint8Array([1, 2, 3]), 200, { 'Content-Type': 'application/octet-stream' }))
app.get('/missing', (c) => c.notFound())
```

Sources: [src/context.ts:664-779](repo://src/context.ts#L664-L779)

### The lazy c.res

`c.res` is both a getter and a setter. The getter returns the current response. If nothing has been assigned yet, it creates `new Response(null, { headers: preparedHeaders })`, so middleware can read `c.res.headers` at any point. The setter is what `compose` and dispatch call with a handler's return value, and what middleware calls to replace the response after `await next()`.

Sources: [src/context.ts:399-434](repo://src/context.ts#L399-L434), [src/compose.ts:67-69](repo://src/compose.ts#L67-L69)

When a response already exists and a new one is assigned, the setter re-creates the new one with `new Response(body, newRes)`. It then copies every header from the old response onto it, except `content-type`. A copied header replaces the one on the new response, and the old `Set-Cookie` values replace any on the new response. Headers that earlier middleware put on `c.res` survive a later `c.res = ...`. Every assignment sets `finalized = true`.

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434)

```ts
app.use(async (c, next) => {
  await next()
  c.res = new Response(c.res.body, c.res) // replace after next(); returning a value here would be ignored
  c.res.headers.set('X-Powered-By', 'Hono')
})
```

Sources: [src/context.ts:399-434](repo://src/context.ts#L399-L434), [src/compose.ts:43-73](repo://src/compose.ts#L43-L73)

## Renderer and layout

`c.render` calls the renderer installed with `c.setRenderer(fn)`. If none was set, it installs `(content) => c.html(content)` on first use. The renderer's signature comes from the `ContextRenderer` interface: when a module augments it with a function type, `Renderer` becomes that type, and otherwise it is `(content: string | Promise<string>) => Response | Promise<Response>`. `setLayout` and `getLayout` store a layout component for renderers that nest pages. The JSX renderer middleware uses both, as described in [[JSX Server Rendering]].

Sources: [src/context.ts:59-88](repo://src/context.ts#L59-L88), [src/context.ts:436-497](repo://src/context.ts#L436-L497)

```tsx
app.use(async (c, next) => {
  c.setRenderer((content) =>
    c.html(
      <html>
        <body>{content}</body>
      </html>
    )
  )
  await next()
})

app.get('/', (c) => c.render('Hello!'))
```

Sources: [src/context.ts:474-497](repo://src/context.ts#L474-L497)
