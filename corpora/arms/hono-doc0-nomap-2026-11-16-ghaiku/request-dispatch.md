---
title: "Request Dispatch"
---
## Overview

Dispatch is the code that runs for one request, from the `fetch` call to the `Response` it returns. It is one private method, `#dispatch`, which `fetch` and `request` both call. This page follows that method in order: the HEAD case, the path and the match, the `Context`, the choice between one handler and a chain, and the check that a response was produced. The chain itself is on [[Middleware Composition]], and the error branch is on [[Error Handling]].

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

## Entry points

`fetch` is an arrow function property. It takes the request, then the bindings and the execution context, and passes the request's method on to `#dispatch`. The bindings are `rest[0]` and the execution context is `rest[1]`, so the call is `fetch(request, env, ctx)`.

Sources: [src/hono-base.ts:479-485](repo://src/hono-base.ts#L479-L485)

`request` is the test entry point. A string or `URL` input is turned into a `Request` against `http://localhost`, with the path merged onto `/`, and then goes through `fetch`. A `Request` input is passed through unchanged, except that `requestInit` is applied to it first when given.

Sources: [src/hono-base.ts:499-517](repo://src/hono-base.ts#L499-L517)

## HEAD requests

A `HEAD` request runs as a `GET`, and the body of the result is removed. The code builds a new `Response` with a `null` body and the status and headers of the `GET` result, so no route needs a separate `HEAD` handler.

Sources: [src/hono-base.ts:412-416](repo://src/hono-base.ts#L412-L416)

## Matching and the context

The path comes from `this.getPath`, which receives the bindings as well as the request, so a custom `getPath` can read them. The router then matches the method and the path, and returns a `Result`. Each matched entry pairs the stored `[handler, route]` tuple with the route's parameters.

Sources: [src/hono-base.ts:418-419](repo://src/hono-base.ts#L418-L419), [src/hono-base.ts:395-395](repo://src/hono-base.ts#L395-L395)

A new `Context` is then created with the request, the path, the match result, the bindings, the execution context and the not-found handler. The `Context` gets the match result so that `c.req` can read route parameters later.

Sources: [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## One handler or a chain

If the match has exactly one entry, the handler is called directly, with `next` set to a function that writes the not-found response into `c.res`. The code comment says `compose` is skipped for this case, so a route with no middleware is called without the composition step.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

For a synchronous handler the result is used as it is, and `undefined` falls back to the not-found handler. For an asynchronous one, the code waits, then returns the resolved value, or the context's `res` when the handler finalized the context, or the not-found response. A rejection goes to `#handleError`.

Sources: [src/hono-base.ts:440-447](repo://src/hono-base.ts#L440-L447)

Two or more entries go through `compose`, which is given the error handler and the not-found handler. The composed function runs the chain, and the result is the context, which dispatch reads after it has finished.

Sources: [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465), [src/compose.ts:15-24](repo://src/compose.ts#L15-L24)

## The finalized check

After a chain finishes, dispatch checks `context.finalized`. A context is finalized when a `Response` has been stored in `c.res`, which the `res` setter does. If it is not finalized, dispatch throws an error that asks whether a `Response` was returned or `next()` was awaited, and the error goes through `#handleError` like any other.

Sources: [src/hono-base.ts:452-465](repo://src/hono-base.ts#L452-L465), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

## Errors raised during dispatch

`#handleError` passes an `Error` to the app's error handler, with the context. A value that is not an `Error` is rethrown unchanged, so the runtime sees it as an uncaught throw. Errors are routed in two places: synchronous throws in the one-handler branch, and rejections in both branches. [[Error Handling]] lists the outcomes of the error handler.

Sources: [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404), [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)
