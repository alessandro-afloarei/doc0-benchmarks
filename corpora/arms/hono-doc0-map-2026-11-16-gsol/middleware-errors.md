---
title: "Middleware and Errors"
---
## Overview

A matching middleware and an endpoint participate in the same handler chain. Routing supplies their order, `compose` supplies the continuation, and the context carries their response and request state. [[Routing]] owns registration and matching; [[Request and Context]] owns the shared state. This page explains how control advances, when a response wins, and how errors reach the application's error handler.

Sources: [src/hono-base.ts:385-427](repo://src/hono-base.ts#L385-L427), [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465), [src/compose.ts:15-70](repo://src/compose.ts#L15-L70)

## Continuations and ordering

Composition starts with `dispatch(0)` and an index of -1. For each handler it updates `c.req.routeIndex`, then awaits the handler with a continuation that dispatches the next index. Code before `await next()` runs on entry; code after it resumes when downstream dispatch completes. Returning a response without calling `next` stops that chain at the current handler. This is the execution mechanism used by both [[Security Middleware]] and [[HTTP Middleware]].

Sources: [src/compose.ts:20-51](repo://src/compose.ts#L20-L51)

```mermaid
sequenceDiagram
  participant D as Dispatch
  participant M as Middleware
  participant H as Downstream handler
  participant C as Context
  D->>M: handler(context, next)
  M->>H: await next()
  H-->>C: Return response; assign context.res
  H-->>M: Downstream completes
  M->>C: Inspect or adjust response
  M-->>D: Complete middleware
```

Sources: [src/compose.ts:42-70](repo://src/compose.ts#L42-L70)

Dispatch rejects a continuation when its target index is less than or equal to the last dispatched index, producing `next() called multiple times`. At the end of the chain, the optional outer continuation is used. With no remaining handler and an unfinalized context, the configured not-found handler supplies a response. A normal returned response is assigned only while the context is unfinalized; an error handler's response may replace an already finalized result.

Sources: [src/compose.ts:32-69](repo://src/compose.ts#L32-L69)

## Dispatch and response guarantees

Hono avoids composition when only one handler matches. That handler receives a continuation that assigns the not-found response. The direct path catches thrown errors and rejected promises; its asynchronous resolution uses a returned response, an already finalized context, or the not-found handler. The multi-handler path awaits composition, verifies `context.finalized`, and throws an explanatory error if no response was finalized. These branches are why returning the response or awaiting the continuation is part of a handler's execution contract.

Sources: [src/hono-base.ts:429-465](repo://src/hono-base.ts#L429-L465)

`app.notFound` replaces the application's fallback and `app.onError` replaces its error handler. In composition, a caught `Error` is stored as `c.error` before `onError` is awaited. Non-`Error` values are rethrown instead. The outer dispatch error helper also only handles `Error` instances. Response processing after `await next()` can therefore inspect the recorded error even when downstream failure has become an HTTP response.

Sources: [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404), [src/compose.ts:49-59](repo://src/compose.ts#L49-L59), [src/context.ts:319-333](repo://src/context.ts#L319-L333)

## HTTP exceptions and failure output

`HTTPException` extends `Error` with a status, optional response, message and cause. Its default status is 500. `getResponse()` uses the exception's status even if an attached response has another status, preserving the attached response's body and headers. With no attached response it uses the exception message as the body. This provides the failure representation used by authentication, validation and timeout middleware.

Sources: [src/http-exception.ts:14-18](repo://src/http-exception.ts#L14-L18), [src/http-exception.ts:46-77](repo://src/http-exception.ts#L46-L77)

The default application error handler checks for `getResponse` and wraps that response through `c.newResponse`. Other errors are logged and receive `Internal Server Error` with status 500. Grouped routes with a custom child error handler receive a wrapper during `route` registration, so child error behavior can survive grouping without changing the parent handler globally.

Sources: [src/hono-base.ts:35-42](repo://src/hono-base.ts#L35-L42), [src/hono-base.ts:218-230](repo://src/hono-base.ts#L218-L230)

## Conditional middleware

| Combinator | Decision and failure behavior |
| --- | --- |
| `some` | Tries candidates until one succeeds; false conditions continue, exceptions can advance to another candidate, and the final error is rethrown |
| `every` | Composes every supplied handler; a false condition throws `Unmet condition` and each inner call restores the enclosing route index |
| `except` | Matches path patterns or context predicates; skips the composed middleware when any condition matches |

Sources: [src/middleware/combine/index.ts:38-68](repo://src/middleware/combine/index.ts#L38-L68), [src/middleware/combine/index.ts:99-116](repo://src/middleware/combine/index.ts#L99-L116), [src/middleware/combine/index.ts:141-164](repo://src/middleware/combine/index.ts#L141-L164)

`some` distinguishes failure before downstream execution from failure after it. Its wrapped continuation records that `next` was called; if a candidate then throws, iteration stops rather than trying another policy over a chain that already ran. A true condition explicitly advances when the context is not finalized. `except` implements its decision using `some` and `every`, with a TrieRouter for string path patterns.

Sources: [src/middleware/combine/index.ts:38-68](repo://src/middleware/combine/index.ts#L38-L68), [src/middleware/combine/index.ts:145-164](repo://src/middleware/combine/index.ts#L145-L164)

## Timeout, context storage and factories

`timeout(duration, exception)` races `next()` against a rejecting timer and clears the timer in `finally`. The default exception is a 504 `Gateway Timeout`; a custom exception can be an object or context-dependent function. The implementation does not cancel the downstream operation: the race settles the middleware's wait, while any cancellation of external work requires that work's own mechanism.

Sources: [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58)

Context storage runs `next` inside `AsyncLocalStorage` imported from `node:async_hooks`. `tryGetContext` returns the current store or `undefined`; `getContext` throws when unavailable. Factory helpers serve a different extension point: `createApp` merges default and per-app options and runs `initApp`, `createMiddleware` preserves the supplied function, and `createHandlers` returns supplied handlers with undefined entries removed. Their type signatures carry the environment and handler contracts while their runtime wrappers remain small.

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59), [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)
