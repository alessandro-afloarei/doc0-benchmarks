---
title: "Middleware Composition"
---
## Overview

Composition is the step that runs every matched handler in order, so that a handler can call `next()` to run the handler after it. The function `compose` in `src/compose.ts` builds the runner once per request. It is used only when the match has two or more entries, as [[Request Dispatch]] describes. This page covers how `next()` moves from one entry to the next, the index guard, the error and not-found hooks, and how the `routeIndex` value that `c.req.routePath` reads is set.

Sources: [src/compose.ts:1-14](repo://src/compose.ts#L1-L14), [src/hono-base.ts:450-451](repo://src/hono-base.ts#L450-L451)

## The runner

`compose(middleware, onError, onNotFound)` returns a function of a context and an optional `next`. Calling that function starts `dispatch(0)` and returns its promise. The `index` variable starts at `-1` and records the most recent position that has run.

Sources: [src/compose.ts:15-24](repo://src/compose.ts#L15-L24)

`dispatch(i)` runs entry `i`. It first refuses a position at or below `index`, which means `next()` was called twice from the same handler. It then stores `i` in `index`, so a second call with the same value fails. This check is what raises the `next() called multiple times` error.

Sources: [src/compose.ts:32-36](repo://src/compose.ts#L32-L36)

## Choosing the handler

When `middleware[i]` exists, the handler is the first element of the stored tuple. The runner writes `i` to `context.req.routeIndex` before it calls the handler. `routePath` reads the same index to find the path of the current entry, so the value tracks which handler is running.

Sources: [src/compose.ts:42-47](repo://src/compose.ts#L42-L47), [src/request.ts:440-442](repo://src/request.ts#L440-L442)

Once `i` passes the end of the list, the handler is the `next` given to the composed function, if there is one. That is how the app's outer `next` runs after the last route handler. When there is neither, the handler is `undefined`.

Sources: [src/compose.ts:46-47](repo://src/compose.ts#L46-L47)

The handler is called with the context and a function that calls `dispatch(i + 1)`. That function is the `next` that a middleware awaits. The call is awaited, so a middleware that awaits `next()` waits for the rest of the chain before it returns.

Sources: [src/compose.ts:49-51](repo://src/compose.ts#L49-L51)

## Errors and not-found

A thrown `Error` is caught when an error handler was given. The runner stores the error in `context.error`, calls the error handler, and marks the result as an error so that its response replaces any earlier one. An error that is not an `Error` instance is rethrown, and `#dispatch` then handles it.

Sources: [src/compose.ts:49-60](repo://src/compose.ts#L49-L60), [src/hono-base.ts:452-464](repo://src/hono-base.ts#L452-L464)

When no handler is left and the context is not finalized, the runner calls the not-found handler. A response returned by a handler is stored in `context.res` only if the context is not finalized yet, or if the result came from the error handler. A handler that set `c.res` earlier keeps its response.

Sources: [src/compose.ts:61-69](repo://src/compose.ts#L61-L69)

## Routes that wrap sub-apps

A route copied from a sub-app with its own error handler is a wrapper function that takes `(c, next)`. It is marked with the `COMPOSED_HANDLER` key, which holds the original handler. `findTargetHandler` follows that key chain to reach the handler that was registered. `isMiddleware` decides by a function's `length`, and the wrapper's `length` is always 2.

Sources: [src/utils/handler.ts:6-15](repo://src/utils/handler.ts#L6-L15), [src/hono-base.ts:221-227](repo://src/hono-base.ts#L221-L227)

## Single-handler matches

A match with one entry does not reach `compose`. Dispatch calls that handler directly, and the code comment says `compose` is skipped for that case. The handler still receives a `next` that writes the not-found response, which is the same fallback the composed runner would use.

Sources: [src/hono-base.ts:429-435](repo://src/hono-base.ts#L429-L435)
