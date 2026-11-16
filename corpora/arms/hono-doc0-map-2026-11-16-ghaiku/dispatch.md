---
title: "Request Dispatch"
---
## Overview

Dispatch is the path one request takes from `fetch` to a `Response`. It finds the handlers for the request, wraps the request in a `Context`, and runs the handlers in order. The code that starts it is `fetch`, which passes the request method to the private `#dispatch` method. Route entries come from [[Registering Routes]], the matching is done by the router in [[Router Selection]], and the object handed to every handler is described in [[Context]].

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485), [src/hono-base.ts:406-411](repo://src/hono-base.ts#L406-L411)

## HEAD requests

A `HEAD` request is dispatched as a `GET`. The method is replaced and the body of the `GET` response is dropped, so the handlers run once and only the headers and status reach the client.

Sources: [src/hono-base.ts:413-416](repo://src/hono-base.ts#L413-L416)

## Matching the path

`#dispatch` computes the path with `getPath(request, { env })`, which by default reads the pathname. It then asks the router for the handlers with `router.match(method, path)`. The result is a list of handler and parameter pairs, and it is kept in the `Context` so that `c.req.param()` can read the parameters later.

Sources: [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427)

The path comes from `getPath`, which the constructor sets to the strict or non-strict version depending on the `strict` option.

Sources: [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172)

## One handler or a chain

When the match has exactly one handler, the handler is called directly, with a `next` that sets the not-found response. This skips `compose` for the most common case. If the handler returns a promise, dispatch adds `then` and `catch` so that a missing response becomes the not-found response and a thrown error goes to the error path.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

Every other match goes through `compose`. The composed function is called with the `Context`, and dispatch checks that the context is finalized before it returns `context.res`. A chain that ends without a response throws a clear error, so a handler that forgot to return one fails visibly.

Sources: [src/hono-base.ts:450-466](repo://src/hono-base.ts#L450-L466)

## The compose loop

`compose` turns the handler list into one function that walks the list by index. Each handler receives the context and a `next` that calls `dispatch(i + 1)`. Calling `next` twice throws `next() called multiple times`, because the index may only move forward. Before each handler runs, `context.req.routeIndex` is set to its position, which is how `c.req.param()` knows which route's parameters to read.

Sources: [src/compose.ts:15-51](repo://src/compose.ts#L15-L51), [src/compose.ts:32-46](repo://src/compose.ts#L32-L46)

The loop saves the handler's return value as `context.res` only when the context is not yet finalized, or when an error handler ran. Once the last handler is reached, the not-found handler runs if the context is still not finalized.

Sources: [src/compose.ts:61-69](repo://src/compose.ts#L61-L69)

## Errors and not-found

Errors thrown in a handler reach the error handler set by `onError`. `compose` calls it only for `Error` instances and stores the error on `context.error`. Anything else is rethrown. The `#handleError` method in `#dispatch` also rethrows non-`Error` values.

Sources: [src/compose.ts:52-60](repo://src/compose.ts#L52-L60), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)

The default error handler returns the `HTTPException` response when the error has `getResponse`, and a plain text 500 otherwise. The default not-found handler returns a plain text 404. Both defaults can be replaced with `onError` and `notFound`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

## Pages

- [[Registering Routes]] explains how the entries that dispatch matches are stored.
- [[Context]] explains how the response is built and finalized.
- [[Built-in Middleware]] lists the middleware that runs inside this chain.

Sources: [src/hono-base.ts:124-141](repo://src/hono-base.ts#L124-L141)
