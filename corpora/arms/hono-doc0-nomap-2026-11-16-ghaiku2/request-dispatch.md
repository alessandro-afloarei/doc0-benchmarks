---
title: "Request Dispatch"
---
## Overview

`fetch()` and `request()` both end in the private `#dispatch` method, which matches the request, creates a `Context`, and runs the matched handlers and middleware. This page follows that path from the entry point to the `Response` it returns. The routes themselves are stored as described in [[App and Routing]], and the matching algorithms are in [[Routers]].

Sources: [src/hono-base.ts:406-419](repo://src/hono-base.ts#L406-L419)

## Entry points

`fetch` reads the method from the `Request`. Its second argument becomes the environment bindings and its third the execution context, which it passes to `#dispatch` in that order. `fire()` is the older form that registers a global `fetch` listener and is deprecated in favour of `hono/service-worker`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/hono-base.ts:536-542](repo://src/hono-base.ts#L536-L542)

`request()` accepts a `Request`, a URL or a path. A path is joined to `http://localhost` with `mergePath`, a `Request` is built from the given `RequestInit`, and the result is passed to `fetch`.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## HEAD requests

A `HEAD` request is dispatched as `GET`. The `GET` response is then copied into a new `Response` with a `null` body, so handlers never see `HEAD` and never write a body for it.

Sources: [src/hono-base.ts:413-416](repo://src/hono-base.ts#L413-L416)

## Matching and the context

`#dispatch` takes the path from `getPath`, then asks the router for the handlers that match the method and path. The result is stored on the `Context` together with the path, the bindings, the execution context and the not-found handler, so the chain reads everything from one object.

Sources: [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

## One handler: the direct call

When the match holds exactly one handler, `#dispatch` calls it directly and passes a `next` function that sets `c.res` to the not-found response. There is no compose step, and a `Promise` result is awaited and checked: if it resolves to nothing and the context was not finalized, the not-found handler runs.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

## Several handlers: compose

With two or more matched entries, `#dispatch` calls `compose` with the match list, the app's error handler and its not-found handler. The composed function is run once on the `Context`, and the response comes from `context.res` after the run.

Sources: [src/hono-base.ts:450-466](repo://src/hono-base.ts#L450-L466)

`compose` keeps an index. Each handler gets a `next` that calls `dispatch(i + 1)`. Calling `next` a second time for the same index throws `next() called multiple times`. `routeIndex` on the request is set to the current index before each handler, so `c.req.routeIndex` tells a handler where it sits in the chain.

Sources: [src/compose.ts:32-47](repo://src/compose.ts#L32-L47), [src/compose.ts:51-51](repo://src/compose.ts#L51-L51)

When the index passes the end of the list, `compose` calls the `next` it was given, if any. When there is none and the context is not finalized, it calls the not-found handler.

Sources: [src/compose.ts:46-47](repo://src/compose.ts#L46-L47), [src/compose.ts:61-65](repo://src/compose.ts#L61-L65)

A handler's return value is stored in `context.res` only when the context is not finalized yet, or when the value came from the error handler. A middleware that returns a `Response` after an inner handler has already set `c.res` therefore leaves the inner response in place.

Sources: [src/compose.ts:67-70](repo://src/compose.ts#L67-L70)

## Errors

An `Error` thrown by a handler is stored as `context.error`, passed to the app's error handler, and that handler's response is kept. Values that are not `Error` instances are rethrown. In `#dispatch`, `#handleError` applies the same rule to errors thrown outside the chain: an `Error` goes to the error handler and anything else is thrown to the caller.

Sources: [src/compose.ts:51-61](repo://src/compose.ts#L51-L61), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

The default error handler returns the response of an `HTTPException` when the error has a `getResponse` method, and a plain `500` otherwise, logging the error with `console.error`.

Sources: [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42)

## Not found

When no handler is matched the chain is empty, so `compose` calls the not-found handler. The default handler answers `404 Not Found` as text. `app.notFound()` replaces it, as described in [[App and Routing]].

Sources: [src/hono-base.ts:31-33](repo://src/hono-base.ts#L31-L33), [src/compose.ts:61-65](repo://src/compose.ts#L61-L65)

## Finalization check

After the composed run, `#dispatch` throws `Context is not finalized` when `context.finalized` is still false. This happens when a middleware neither returns a `Response` nor awaits `next()`. The error is passed to the error handler like any other.

Sources: [src/hono-base.ts:452-466](repo://src/hono-base.ts#L452-L466), [src/context.ts:317-317](repo://src/context.ts#L317-L317)

Setting `c.res` marks the context as finalized, which is why the chain stops replacing the response once a handler has set it.

Sources: [src/context.ts:414-434](repo://src/context.ts#L414-L434)
