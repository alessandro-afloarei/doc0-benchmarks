---
title: "Context"
---
## Overview

The `Context` object is the `c` every handler and middleware receives. It holds the raw `Request`, the bindings and execution context of the runtime, the variables that middleware share, and the `Response` the chain is building. Its helpers, such as `c.text()` and `c.json()`, return a `Response` and do not send anything themselves. Reading the request is covered in [[Request Object]], and the chain that owns the context is in [[Request Dispatch]].

Sources: [src/context.ts:293-363](repo://src/context.ts#L293-L363)

## Creation

`#dispatch` creates the context with the path, the match result, the bindings, the execution context and the not-found handler. The constructor stores the raw `Request` and copies those values, and the `req` getter creates the [[Request Object]] only on first use, from the stored raw request, path and match result.

Sources: [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427), [src/context.ts:352-363](repo://src/context.ts#L352-L363), [src/context.ts:366-369](repo://src/context.ts#L366-L369)

## Bindings and execution context

`env` holds the runtime bindings, such as Cloudflare bindings or environment variables, and starts as an empty object when no options are given. The `executionCtx` getter returns the execution context the runtime passed in and throws when there is none. `event` does the same for the fetch event that service-worker style runtimes pass.

Sources: [src/context.ts:315-315](repo://src/context.ts#L315-L315), [src/context.ts:391-397](repo://src/context.ts#L391-L397), [src/context.ts:377-383](repo://src/context.ts#L377-L383)

## Variables

`c.set(key, value)` creates a `Map` the first time it is called and stores the value there. `c.get(key)` reads from the same map and returns `undefined` when nothing was set. The `c.var` getter copies the map into a plain object, so handlers can read every variable at once without changing them.

Sources: [src/context.ts:546-556](repo://src/context.ts#L546-L556), [src/context.ts:572-580](repo://src/context.ts#L572-L580), [src/context.ts:593-602](repo://src/context.ts#L593-L602)

## Response helpers

Every body helper builds its `Response` through `#newResponse`. That method starts from the headers already prepared on the context, or from the headers of the response already set. It then applies headers from the argument, from the explicit header record, and finally the status: a number argument wins, then the `status` of an init object, then the status set with `c.status()`.

Sources: [src/context.ts:604-640](repo://src/context.ts#L604-L640)

`c.text()` and `c.json()` set `Content-Type` through `setDefaultContentType`, which the caller's headers can override. `c.text()` takes a shortcut when nothing was set: with no status, headers or options and no finalized response, it returns `new Response(text)` directly.

Sources: [src/context.ts:279-286](repo://src/context.ts#L279-L286), [src/context.ts:682-695](repo://src/context.ts#L682-L695), [src/context.ts:708-720](repo://src/context.ts#L708-L720)

```ts
app.get('/items', (c) => c.json({ ok: true }, 201, { 'X-Count': '1' }))
```

Sources: [src/context.ts:708-720](repo://src/context.ts#L708-L720), [src/context.ts:604-640](repo://src/context.ts#L604-L640)

`c.html()` accepts a string or an object such as a promise. An object argument is resolved with the JSX stringify phase before the response is built, and a plain string is wrapped at once. `c.body()` sends the data as is, with no content type set.

Sources: [src/context.ts:723-735](repo://src/context.ts#L723-L735), [src/context.ts:664-669](repo://src/context.ts#L664-L669)

## Headers and status

`c.header(name, value, options)` writes into the response that already exists, or into the prepared headers when none exists yet. If the context is already finalized, it first copies the response, so the headers are changed on a new `Response` object. A `value` of `undefined` deletes the header, and `{ append: true }` adds a value instead of replacing it.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` only stores the status. The body helpers read it when they build a response, so a status set before `c.text()` or `c.json()` is called applies to that response.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:637-638](repo://src/context.ts#L637-L638)

## Redirects and not found

`c.redirect(location, status)` sets the `Location` header and returns an empty response, with status `302` unless a status is given. A location that contains characters outside Latin-1 is percent-encoded first.

Sources: [src/context.ts:750-766](repo://src/context.ts#L750-L766)

`c.notFound()` calls the not-found handler stored in the context, creating a plain empty response the first time when none was set.

Sources: [src/context.ts:776-780](repo://src/context.ts#L776-L780)

## Rendering and layouts

`c.render()` calls a renderer. The default renderer is `c.html`, so `c.render('text')` returns an HTML response. `c.setRenderer()` replaces it, and `c.setLayout()` and `c.getLayout()` store the layout that the JSX renderer middleware reads. [[Response Middleware]] describes that middleware.

Sources: [src/context.ts:448-456](repo://src/context.ts#L448-L456), [src/context.ts:459-472](repo://src/context.ts#L459-L472), [src/context.ts:495-498](repo://src/context.ts#L495-L498)

## The response and finalization

`c.res` is the response the chain will return. Reading it creates an empty `200` response the first time. Assigning it copies the headers of the old response into the new one, except `Content-Type`, which the new response keeps, and sets `finalized` to `true`. Once the context is finalized, the chain no longer replaces `c.res` with a handler's return value, as [[Request Dispatch]] describes.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)
