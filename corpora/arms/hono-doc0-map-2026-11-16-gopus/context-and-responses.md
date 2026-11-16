---
title: "Context and Responses"
---
## Overview

Each request gets one `Context`, the `c` argument of every handler and middleware. It carries what the runtime passed in (the request, the bindings, the execution context), a per-request store of variables, and the response being built. Its methods `text`, `json`, `html`, `body`, `redirect` and `newResponse` build `Response` objects that start from the headers and status set earlier in the chain.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361)

`#dispatch` creates the Context with the request, the path, the router's match result, the bindings, the execution context and the not-found handler, as described on [[Request Dispatch and Middleware]]. Reading the request through `c.req` is covered on [[HonoRequest]].

Sources: [src/context.ts:237-252](repo://src/context.ts#L237-L252), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## What the runtime passed in

| Member | What it is |
| --- | --- |
| `c.req` | A `HonoRequest` over the raw `Request`, created on first access from the request, path and match result |
| `c.env` | The bindings passed to `fetch` as its second argument, typed by the app's `Bindings` |
| `c.executionCtx` | The execution context passed as the third argument; throws `This context has no ExecutionContext` when there is none |
| `c.event` | The `FetchEvent`, available only when the execution context has `respondWith` (Service Worker style); throws otherwise |
| `c.error` | The error a later handler threw, set by `compose` so middleware can inspect it after `next()` |

Sources: [src/context.ts:300-397](repo://src/context.ts#L300-L397)

`ExecutionContext` is Hono's own interface with `waitUntil`, `passThroughOnException`, `props` and an optional `exports`, the shape the Cloudflare Workers runtime passes.

Sources: [src/context.ts:31-52](repo://src/context.ts#L31-L52)

## Variables

`c.set(key, value)` and `c.get(key)` store values for the rest of the request in a `Map` created on the first `set`. `c.var` returns the same values as a read-only object built with `Object.fromEntries`, so `c.var.user` reads what an earlier middleware set.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

Keys and value types come from two places: the `Variables` field of the app's `Env`, and the global `ContextVariableMap` interface, which a middleware module can extend with declaration merging so that its variable is typed in every app. When the app's `Env` is `any`, any string key is accepted.

Sources: [src/context.ts:57-57](repo://src/context.ts#L57-L57), [src/context.ts:95-108](repo://src/context.ts#L95-L108), [src/context.ts:546-580](repo://src/context.ts#L546-L580)

```ts
type Variables = { user: { id: string } }

const app = new Hono<{ Variables: Variables }>()

app.use(async (c, next) => {
  c.set('user', { id: '42' })
  await next()
})

app.get('/me', (c) => c.json(c.var.user))
```

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Headers and status

`c.header(name, value, { append })` sets, appends or, with no value, deletes a response header. Before any response exists, it writes to a `Headers` object prepared on the Context; once a response exists, it writes to that response's headers. If the context is already finalized, it first re-creates the response with `new Response(body, res)` so headers can be changed even when a handler returned an immutable response.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` records the status for the next response the Context builds. The header names offered by type completion come from the `ResponseHeader` and `RequestHeader` lists in `utils/headers`, and `Content-Type` values from `BaseMime`; any other string is still accepted.

Sources: [src/context.ts:254-262](repo://src/context.ts#L254-L262), [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/utils/headers.ts:1-12](repo://src/utils/headers.ts#L1-L12)

## Building responses

Every builder goes through the private `#newResponse(data, arg, headers)`. It starts from a copy of the current response's headers if there is one, or the prepared headers otherwise. It then applies the `headers` of a `ResponseInit` (or a `Response`) passed as `arg`, appending `Set-Cookie` rather than replacing it, and then the `headers` record, where an array value writes one header per element. The status is `arg` when it is a number, else `arg.status`, else the status set with `c.status()`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

| Method | Body | Default `Content-Type` |
| --- | --- | --- |
| `c.body(data, status?, headers?)` | `string`, `ArrayBuffer`, `ReadableStream`, `Uint8Array` or `null` | none |
| `c.text(text, …)` | the string | `text/plain; charset=UTF-8` |
| `c.json(object, …)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, …)` | a string or a Promise of one | `text/html; charset=UTF-8` |
| `c.newResponse(data, …)` | like `body`, without the typed return | none |

Sources: [src/context.ts:26-26](repo://src/context.ts#L26-L26), [src/context.ts:279-286](repo://src/context.ts#L279-L286), [src/context.ts:641-733](repo://src/context.ts#L641-L733)

Each method accepts either `(data, status, headers)` or `(data, init)`, where `init` is a `ResponseInit` or an existing `Response`. A `headers` argument overrides the default content type because the default is spread first.

Sources: [src/context.ts:113-230](repo://src/context.ts#L113-L230), [src/context.ts:281-286](repo://src/context.ts#L281-L286)

`c.text` has a shortcut: when nothing was prepared (no headers, no status, no extra arguments) and the context is not finalized, it returns `new Response(text)`, whose content type the runtime sets to `text/plain;charset=UTF-8`.

Sources: [src/context.ts:682-694](repo://src/context.ts#L682-L694)

`c.html` accepts the result of JSX or the `html` helper. When it receives an object, such as a Promise or an `HtmlEscapedString`, it awaits `resolveCallback` in the `Stringify` phase, which runs the callbacks attached to the string before building the response; it then returns a `Promise<Response>`. Those callbacks are described on [[HTML and CSS Helpers]].

Sources: [src/context.ts:723-733](repo://src/context.ts#L723-L733), [src/utils/html.ts:142-170](repo://src/utils/html.ts#L142-L170)

`c.redirect(location, status = 302)` sets `Location` and answers an empty body. A location holding characters outside Latin-1 is passed through `encodeURI` first. `c.notFound()` calls the app's not-found handler, or answers an empty response when the Context was built without one.

Sources: [src/context.ts:750-779](repo://src/context.ts#L750-L779)

## Typed responses

The builders return `Response & TypedResponse<T, U, F>`, where `T` is the body type, `U` the status and `F` the format (`'body'`, `'text'`, `'json'` or `'redirect'`). Statuses that cannot carry a body (101, 204, 205, 304) are excluded from `text` and `json` by the `ContentfulStatusCode` type. These types become the output side of the route's schema, which the [[RPC Client]] reads; the type machinery is on [[Route Types and Schema]].

Sources: [src/context.ts:121-208](repo://src/context.ts#L121-L208), [src/utils/http-status.ts:63-72](repo://src/utils/http-status.ts#L63-L72)

`c.json` maps its argument through `JSONParsed<T>`, so the typed body is what `JSON.stringify` and `JSON.parse` would give back, not the original type.

Sources: [src/context.ts:205-208](repo://src/context.ts#L205-L208)

## c.res and finalization

`c.res` reads the current response. Before a handler has produced one, the getter creates an empty `Response` around the prepared headers, so middleware can read headers safely.

Sources: [src/context.ts:403-407](repo://src/context.ts#L403-L407)

Assigning `c.res` replaces the response and sets `finalized` to `true`. When a response already existed, the setter copies the new one into a fresh `Response` and carries over every old header except `content-type`; `set-cookie` headers are rewritten from `getSetCookie()` so that none are lost. This is how middleware wraps or replaces a handler's response after `await next()`.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)

`finalized` is what `compose` and `#dispatch` read to decide whether a handler has answered. It becomes `true` only through the `res` setter, which `compose` calls with each handler's return value.

Sources: [src/context.ts:317-317](repo://src/context.ts#L317-L317), [src/compose.ts:67-69](repo://src/compose.ts#L67-L69)

## Renderer and layout

`c.render(...args)` calls the renderer set with `c.setRenderer(fn)`. With none set, it falls back to `c.html(content)`. A middleware sets a renderer that wraps content in a page, and handlers then call `c.render('Hello!')`.

Sources: [src/context.ts:436-497](repo://src/context.ts#L436-L497)

The renderer's type comes from the `ContextRenderer` interface: when an app augments it with a function signature, `c.render` takes that signature, and `PropsForRenderer` is its second parameter. Without augmentation the renderer is `(content: string | Promise<string>) => Response | Promise<Response>`.

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85)

`c.setLayout(layout)` and `c.getLayout()` store a layout component next to the renderer. The [[JSX Renderer Middleware]] uses the renderer and the layout together to nest layouts.

Sources: [src/context.ts:459-472](repo://src/context.ts#L459-L472)
