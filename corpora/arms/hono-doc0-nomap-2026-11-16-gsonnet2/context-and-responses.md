---
title: "Context and Responses"
---
## Overview

`Context` (`src/context.ts`) is the object every handler receives as `c`. `#dispatch` creates one per request, around the raw `Request`, the router's match result, the runtime `env` and the execution context ([[Application and Request Lifecycle]]). It gives handlers three things: access to the request (`c.req`), a per-request variable store (`c.set` / `c.get` / `c.var`), and helpers that build a `Response`.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

## Request, environment and execution context

`c.req` is created lazily: the getter builds a `HonoRequest` from the raw request, the path and the match result the first time it is read, then reuses it. Handlers that never touch the request pay nothing for it. What `HonoRequest` offers is on [[HonoRequest and Body Parsing]].

Sources: [src/context.ts:363-369](repo://src/context.ts#L363-L369)

`c.env` is whatever the runtime passed as the second argument to `fetch` (Cloudflare bindings, for example) and defaults to `{}`. `c.executionCtx` returns the `ExecutionContext` (`waitUntil`, `passThroughOnException`) and `c.event` returns the `FetchEvent`; each throws if the runtime did not provide it, which is why `mount` reads `executionCtx` inside a `try/catch`.

Sources: [src/context.ts:28-52](repo://src/context.ts#L28-L52), [src/context.ts:352-397](repo://src/context.ts#L352-L397), [src/hono-base.ts:355-361](repo://src/hono-base.ts#L355-L361)

## Variables

`c.set(key, value)` writes to a lazily created `Map` and `c.get(key)` reads from it, returning `undefined` when no variable was ever set. Middleware use them to hand data to later handlers. `c.var` returns a read-only plain object built with `Object.fromEntries` from that map (an empty object when nothing was set), so `c.var.user` works as shorthand for `c.get('user')`.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

The key and value types come from `E['Variables']` of the app's `Env` type, or from the `ContextVariableMap` interface that other modules extend by declaration merging. When `E` is `any` the keys fall back to `string`.

Sources: [src/context.ts:54-57](repo://src/context.ts#L54-L57), [src/context.ts:90-108](repo://src/context.ts#L90-L108)

## Building a response

All response helpers go through the private `#newResponse(data, arg, headers)`. It starts from the headers already on the context — those of `#res` if one exists, otherwise the prepared headers, otherwise a new `Headers` — then applies headers from `arg` (appending `set-cookie`, setting the rest) and from the `headers` record (a string replaces, an array deletes and re-appends). The status is `arg` if it is a number, else `arg.status`, else the value stored by `c.status()`. It returns `new Response(data, { status, headers })`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`c.header(name, value, { append })` edits the headers that will be used: it writes into `#res.headers` if a response is already set (re-creating the response first when the context is finalized), or into the prepared `Headers` otherwise. A value of `undefined` deletes the header. `c.status(code)` just records the status for the next response.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

| Helper | Body | Content type | Notes |
| --- | --- | --- | --- |
| `c.body(data, status?, headers?)` | `Data` or `null` | none added | Direct `#newResponse` call |
| `c.text(text, ...)` | string | `text/plain; charset=UTF-8` | Fast path: plain `new Response(text)` when no headers, status or args are pending and the context is not finalized |
| `c.json(obj, ...)` | `JSON.stringify(obj)` | `application/json` | |
| `c.html(html, ...)` | string, or promise | `text/html; charset=UTF-8` | A non-string argument is resolved first with `resolveCallback` |
| `c.redirect(url, status = 302)` | `null` | n/a | Sets `Location`; a URL with non-Latin-1 characters is passed through `encodeURI` |
| `c.notFound()` | from handler | n/a | Calls the app's not-found handler; a bare empty `Response` if none |

Sources: [src/context.ts:664-694](repo://src/context.ts#L664-L694), [src/context.ts:708-733](repo://src/context.ts#L708-L733), [src/context.ts:750-779](repo://src/context.ts#L750-L779)

The default content type is applied through `setDefaultContentType`, which spreads the caller's headers after `Content-Type`, so a caller-supplied content type wins.

Sources: [src/context.ts:281-286](repo://src/context.ts#L281-L286)

```ts
const setDefaultContentType = (contentType: string, headers?: HeaderRecord): HeaderRecord => {
  return {
    'Content-Type': contentType,
    ...headers,
  }
}
```

Sources: [src/context.ts:281-286](repo://src/context.ts#L281-L286)

The many overloads on `c.json`, `c.text` and `c.body` (`TypedResponse<T, U, F>` return types) are not behaviour: they record the body type, status and format so the typed client can infer them ([[RPC Client (hc)]]). Status codes that may carry a body are `ContentfulStatusCode`; `c.body(null, ...)` accepts any status.

Sources: [src/context.ts:118-208](repo://src/context.ts#L118-L208)

## The response slot

`c.res` is the response that will be returned. Reading it when none was set creates an empty `Response` backed by the prepared headers, so middleware can always do `c.res.headers.set(...)` after `await next()`.

Sources: [src/context.ts:399-407](repo://src/context.ts#L399-L407)

Assigning to `c.res` does the work of merging. If a response already exists and a new one arrives, the new one is copied with `createResponseInstance(_res.body, _res)` and every header of the old response is carried over: `content-type` is skipped (the new one wins), `set-cookie` values are re-appended so none are lost, and everything else is set. The context is then marked `finalized`. This is why headers set by earlier middleware survive when a later handler returns a fresh `Response`, and why `compose` checks `finalized` before assigning ([[Middleware Composition and Error Handling]]).

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434)

## Rendering with layouts

`c.render(...)` calls the renderer installed with `c.setRenderer(fn)`; if none was set it falls back to `c.html(content)`. `c.setLayout` / `c.getLayout` store a layout function next to it. The `ContextRenderer` interface can be augmented to type `render`'s arguments. The `jsx-renderer` middleware uses this pair; see [[JSX Server Rendering and Streaming]].

Sources: [src/context.ts:59-88](repo://src/context.ts#L59-L88), [src/context.ts:436-497](repo://src/context.ts#L436-L497)

## Failure behaviour

`c.error` holds the error that `compose` caught from an inner handler, so middleware can inspect it after `await next()` ([[Middleware Composition and Error Handling]]).

Sources: [src/context.ts:318-333](repo://src/context.ts#L318-L333)
