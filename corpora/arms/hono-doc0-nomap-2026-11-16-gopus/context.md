---
title: "Context and Responses"
---
## Overview

Every handler and middleware receives one `Context`, conventionally named `c`. `#dispatch` creates it per request with the raw `Request`, the matched path and router result, the bindings, the execution context and the app's not-found handler, as [[Request Lifecycle and Error Handling]] traces. The Context carries what the runtime gave the request, values middleware shares with later handlers, the headers and status prepared for the response, and the helpers that build that response. Reading the request itself goes through `c.req`, covered on [[HonoRequest]].

Sources: [src/context.ts:237-252](repo://src/context.ts#L237-L252), [src/context.ts:352-369](repo://src/context.ts#L352-L369)

## Runtime values

| Member | What it holds |
| --- | --- |
| `c.req` | The `HonoRequest`, created on first access from the raw request, path and match result. |
| `c.env` | The bindings passed as the second argument of `fetch`, `{}` when none were. |
| `c.executionCtx` | The third argument of `fetch`; throws `This context has no ExecutionContext` when there was none. |
| `c.event` | The same value when it is a `FetchEvent` (it has `respondWith`); throws `This context has no FetchEvent` otherwise. |
| `c.error` | The error a later handler threw, set by `compose` before the error handler runs. |
| `c.finalized` | `true` once a response has been assigned to `c.res`. |

Sources: [src/context.ts:293-333](repo://src/context.ts#L293-L333), [src/context.ts:366-397](repo://src/context.ts#L366-L397)

`ExecutionContext` is the shape Cloudflare Workers pass: `waitUntil(promise)` to keep the worker alive until a promise settles, `passThroughOnException()`, and the `props` and `exports` fields the code marks as being for Wrangler 4.x compatibility.

Sources: [src/context.ts:27-52](repo://src/context.ts#L27-L52)

## Variables

`c.set(key, value)` stores a value in a `Map` created on first use, `c.get(key)` reads it back, and `c.var` returns all of them as a read-only object built with `Object.fromEntries`. The map lives on the Context, so a value set by a middleware is visible to every handler after it in the same request and to nothing else.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

The keys and their types come from two places. The app's `Variables` type in `new Hono<{ Variables: { ... } }>()` types its own keys, and the empty `ContextVariableMap` interface is the hook a module augments to add keys for every app. The jwt middleware does this, so `c.get('jwtPayload')` is typed wherever `hono/jwt` is imported:

Sources: [src/context.ts:53-57](repo://src/context.ts#L53-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

```ts
declare module '../..' {
  interface ContextVariableMap extends JwtVariables<unknown> {}
}
```

Sources: [src/context.ts:53-57](repo://src/context.ts#L53-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/middleware/jwt/index.ts:1-9](repo://src/middleware/jwt/index.ts#L1-L9)

## Headers and status

`c.header(name, value)` sets a header for the response being prepared. Before any response exists the headers go into a private `Headers` object; afterwards they go onto `c.res` directly. Passing `{ append: true }` appends instead of replacing, and omitting `value` deletes the header. When the context is already finalized, the response is first copied, so headers can be changed even on a response whose own headers are immutable.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` stores a status that the response helpers use when they are not given one.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:637-638](repo://src/context.ts#L637-L638)

## Building responses

### How a response is assembled

Every helper ends in the private `#newResponse(data, arg, headers)`. It starts from a copy of `c.res`'s headers when a response exists, otherwise from the prepared headers. It then applies the headers of `arg` when `arg` is a `ResponseInit` or a `Response`, appending `set-cookie` and replacing the rest, and finally the `headers` record, where an array value replaces the header with one entry per item. The status is `arg` when it is a number, else `arg.status`, else the status set with `c.status()`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

### The helpers

| Helper | Body | Content-Type |
| --- | --- | --- |
| `c.newResponse(data, status?, headers?)` | `data` as given | none added |
| `c.body(data, status?, headers?)` | `data` as given | none added |
| `c.text(text, status?, headers?)` | the string | `text/plain; charset=UTF-8` |
| `c.json(object, status?, headers?)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, status?, headers?)` | the string, or the awaited promise | `text/html; charset=UTF-8` |
| `c.redirect(location, status = 302)` | empty | none; sets `Location` |
| `c.notFound()` | the app's not-found response | from that handler |

Sources: [src/context.ts:641-733](repo://src/context.ts#L641-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

In each helper that adds a content type, the type is a default: a `Content-Type` in the `headers` argument wins because it is spread after the default.

Sources: [src/context.ts:279-286](repo://src/context.ts#L279-L286)

`c.text` has a shortcut. When no header, status or argument was given and nothing is finalized, it returns `new Response(text)` without building a `Headers` object at all.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694)

`c.html` accepts a `Promise<string>` as well as a string. Promises come from JSX components that render asynchronously; the helper resolves their escaped-string callbacks with `resolveCallback` before building the response, as [[JSX Server Rendering]] explains.

Sources: [src/context.ts:723-733](repo://src/context.ts#L723-L733)

`c.redirect` encodes the location with `encodeURI` only when it holds characters above `\xFF`, sets `Location` through `c.header`, and returns an empty body with status 302 unless another redirect status is given.

Sources: [src/context.ts:750-762](repo://src/context.ts#L750-L762)

### Typed responses

`c.body`, `c.text` and `c.json` return `Response & TypedResponse<...>`, recording the body, the status code and the format in the type. `c.json`'s body type is `JSONParsed<T>`, the type the value has after a JSON round trip. Only statuses that allow content are accepted when there is a body. The [[RPC Client]] reads these types; [[Typed Routes and Schemas]] shows how they enter the app's schema.

Sources: [src/context.ts:121-208](repo://src/context.ts#L121-L208)

## The response object

`c.res` returns the current response, creating an empty one with the prepared headers when none exists. Assigning `c.res` marks the context finalized; if a response was already there, the new one is copied and given every header of the old one except `content-type`, with each `set-cookie` value carried over. This is what lets a middleware call `await next()` and then replace or decorate the handler's response without losing headers set earlier.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

```ts
app.use(async (c, next) => {
  await next()
  c.res = new Response('Replaced', c.res)
})
```

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

## Rendering

`c.render(...args)` calls the renderer set for this request. Without one it falls back to `c.html(content)`. `c.setRenderer(fn)` installs a renderer, usually from a middleware, and `c.setLayout`/`c.getLayout` store a layout component for it to use. The jsx-renderer middleware on [[JSX Server Rendering]] is built on these.

Sources: [src/context.ts:448-497](repo://src/context.ts#L448-L497)

```tsx
app.use('*', async (c, next) => {
  c.setRenderer((content) => {
    return c.html(
      <html>
        <body>
          <p>{content}</p>
        </body>
      </html>
    )
  })
  await next()
})
```

Sources: [src/context.ts:474-494](repo://src/context.ts#L474-L494)

The renderer's arguments are typed through the `ContextRenderer` interface: while it is empty, `Renderer` is the default `(content) => Response | Promise<Response>`; once a module augments it with a function type, `c.render` takes that function's parameters, and `PropsForRenderer` is its second parameter.

Sources: [src/context.ts:59-85](repo://src/context.ts#L59-L85)
