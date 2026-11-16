---
title: "Context"
---
## Overview

The `Context` object, called `c` in handlers, carries one request through the app. It holds the raw `Request`, the match result and the bindings, and it builds the `Response` that dispatch returns. Most of the code in a handler goes through `c`: it creates responses with `c.json`, `c.text` and the other builders, sets headers and status, stores variables, and renders layouts. This page covers how `c` is made and how it builds and replaces its `Response`. The request reader `c.req` is on [[HonoRequest]].

Sources: [src/context.ts:293-299](repo://src/context.ts#L293-L299), [src/context.ts:315-317](repo://src/context.ts#L315-L317)

## Creating the context

`Context` is constructed by dispatch with the raw request and an options object. The options carry the bindings `env`, the execution context, the path, the match result and the not-found handler. Each is copied into a private field, and `env` is copied to the public field of the same name, which starts as an empty object.

Sources: [src/context.ts:352-361](repo://src/context.ts#L352-L361), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

`c.req` is created on first use. The getter passes the raw request, the path and the match result to `HonoRequest`, and caches the instance, so every later read of `c.req` returns the same object.

Sources: [src/context.ts:363-369](repo://src/context.ts#L363-L369)

## The response

`c.res` is the response the context will return. Reading it when none has been set creates an empty `Response` whose headers are the prepared headers, and stores it, so that later calls return the same object.

Sources: [src/context.ts:399-407](repo://src/context.ts#L399-L407)

Setting `c.res` is what finalizes a context. If a previous response exists, the new one is built from the new body and init, and the old response's headers are copied onto it, except `Content-Type`. Set-Cookie values are copied one by one with `append`, so cookies set earlier are kept. The setter then records the response and sets `finalized` to `true`.

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434)

## Headers and status

`c.header(name, value, options)` writes to the current response's headers when a response exists, and to the prepared headers otherwise. A `value` of `undefined` deletes the header, and an `append` option adds a second value instead of replacing the first. If the context is already finalized, the setter first rebuilds the response around the same body, so the new header appears on the response that will be returned.

Sources: [src/context.ts:515-527](repo://src/context.ts#L515-L527)

`c.status(code)` stores a status that the response builders use when they receive no status of their own. It does not change a response that already exists.

Sources: [src/context.ts:529-531](repo://src/context.ts#L529-L531), [src/context.ts:637-638](repo://src/context.ts#L637-L638)

## Response builders

`newResponse` is the common path for every builder. It starts from a copy of the current response's headers, or from the prepared headers when there is no response. It then applies the headers of an init object, where Set-Cookie values are appended, and the header record passed to the call, where a string replaces the value and an array replaces all values. The status comes from the call's number, or the init's status, or the stored status.

Sources: [src/context.ts:604-639](repo://src/context.ts#L604-L639)

`json` stringifies its argument and sets `application/json` as the default `Content-Type`. `html` does the same with `text/html; charset=UTF-8`, and when given a Promise it waits for the callback-resolved string before building the response.

Sources: [src/context.ts:708-721](repo://src/context.ts#L708-L721), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

`text` has a fast path. When nothing has been set (no prepared headers, no status, no arguments, not finalized), it returns `new Response(text)` directly. Otherwise it uses `newResponse` with `text/plain; charset=UTF-8`.

Sources: [src/context.ts:279-279](repo://src/context.ts#L279-L279), [src/context.ts:682-694](repo://src/context.ts#L682-L694)

`body` sends data with no content type set, and `redirect` sets the `Location` header and returns a response with status 302 unless another redirect code is given. A location that contains characters above `0xFF` is encoded with `encodeURI` first.

Sources: [src/context.ts:664-668](repo://src/context.ts#L664-L668), [src/context.ts:750-762](repo://src/context.ts#L750-L762)

`notFound` runs the not-found handler the app passed in the options. If the app passed none, it returns an empty `Response`.

Sources: [src/context.ts:776-779](repo://src/context.ts#L776-L779)

## Variables

`c.set(key, value)` and `c.get(key)` store values in a `Map` that is created on the first `set`. `c.var` returns the same entries as a read-only object, built with `Object.fromEntries`, so middleware can pass values to handlers with the types in [[Type System]].

Sources: [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Rendering and layouts

`c.render` calls the renderer that was set with `setRenderer`. When none was set, it falls back to `c.html`, so `c.render('text')` returns an HTML response. `setLayout` and `getLayout` store a layout function on the context; the JSX renderer middleware calls `getLayout` and then `setLayout` with a wrapper, as [[JSX Rendering]] describes.

Sources: [src/context.ts:448-497](repo://src/context.ts#L448-L497)

## Execution context and bindings

`c.env` holds the bindings for the request. `c.executionCtx` returns the execution context and throws when none was given, and `c.event` does the same for a FetchEvent.

Sources: [src/context.ts:377-397](repo://src/context.ts#L377-L397), [src/context.ts:315-317](repo://src/context.ts#L315-L317)
