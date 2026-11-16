---
title: "Context and Responses"
---
## Overview

`Context` (`src/context.ts`) is the object every handler receives as `c`. One is created per request by `#dispatch` (see [[Application and Request Dispatch]]); it holds the raw request, the Cloudflare-style `env`, the execution context, per-request variables, and the response being built. Its response helpers (`text`, `json`, `html`, `body`, `redirect`, `notFound`) all end in the standard `Response`.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## Inputs: request, env and execution context

The constructor stores the raw `Request` and, when options are given, the execution context, `env`, not-found handler, path and match result. `c.req` creates the `HonoRequest` lazily on first access from the raw request, the path and the match result, then caches it; its behaviour is in [[Request and Body Parsing]].

Sources: [src/context.ts:352-369](repo://src/context.ts#L352-L369)

`c.executionCtx` returns the execution context or throws `This context has no ExecutionContext`. `c.event` returns it only when it has `respondWith` (a service-worker `FetchEvent`), otherwise throws `This context has no FetchEvent`.

Sources: [src/context.ts:377-397](repo://src/context.ts#L377-L397)

## Variables

`c.set(key, value)` stores into a `Map` created on first use, `c.get(key)` reads from it (undefined when nothing was set), and `c.var` returns a read-only plain object built with `Object.fromEntries` (an empty object when nothing was set). Middleware use this to pass data to later handlers; the types come from the `Variables` entry of the `Env` type parameter or from `ContextVariableMap`.

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Building a response

All helpers funnel into `#newResponse(data, arg, headers)`. It starts from the headers of the current `c.res` if there is one, otherwise the prepared headers set through `c.header`. Headers given in `arg` are merged on top, with `set-cookie` appended rather than replaced; the `headers` argument is applied last, where a string value replaces and an array value deletes then appends each item. The status comes from a numeric `arg`, `arg.status`, or the status stored with `c.status()`.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

| Helper | Content-Type it sets | Notes |
| --- | --- | --- |
| `c.body(data, arg, headers)` | none | Raw body; set headers with `c.header` |
| `c.text(text, ...)` | `text/plain; charset=UTF-8` | Returns a bare `new Response(text)` when no headers, status or arg were set and the context is not finalized |
| `c.json(object, ...)` | `application/json` | `JSON.stringify`s the value |
| `c.html(html, ...)` | `text/html; charset=UTF-8` | Accepts a string or a promise from JSX; a promise is resolved with `resolveCallback` first |
| `c.redirect(location, status)` | none | Default 302; sets `Location`, percent-encoding it if it has non-Latin-1 characters |
| `c.notFound()` | by handler | Calls the not-found handler, or an empty `Response` when none was given |

Sources: [src/context.ts:664-779](repo://src/context.ts#L664-L779)

`setDefaultContentType` puts the Content-Type first and lets explicit `headers` override it.

Sources: [src/context.ts:279-286](repo://src/context.ts#L279-L286), [src/context.ts:664-779](repo://src/context.ts#L664-L779)

## The response slot and finalization

`c.res` is a getter that creates an empty `Response` with the prepared headers when none exists. Assigning to it sets `finalized` to true. When a response already existed, the setter copies the new one and then copies the old headers over it, skipping `content-type` and rebuilding `set-cookie` so every cookie survives. This is how middleware that runs after `await next()` can add headers to a response a handler produced.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

`c.header(name, value, { append })` mutates headers: after finalization it clones the current response first (so its headers are writable), then deletes the header when value is `undefined`, appends when `append` is set, and otherwise sets it. Before a response exists, headers go to a `Headers` object that `c.res` and the helpers later reuse. `c.status(code)` only remembers a status for the next response built.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

The dispatch code and `compose` check `finalized` to know whether a handler produced a response; a chain that ends without one throws (see [[Application and Request Dispatch]]). `c.error` holds the error that `compose` caught, so middleware running after `await next()` can inspect it.

Sources: [src/context.ts:317-333](repo://src/context.ts#L317-L333), [src/compose.ts:49-72](repo://src/compose.ts#L49-L72)

## Renderers and layouts

`c.render(...)` calls the renderer set by `c.setRenderer`; without one it falls back to `c.html(content)`. `c.setLayout` and `c.getLayout` store and read a layout component for the request. The JSX middleware that sets both is described in [[JSX Server Rendering]].

Sources: [src/context.ts:448-497](repo://src/context.ts#L448-L497)
