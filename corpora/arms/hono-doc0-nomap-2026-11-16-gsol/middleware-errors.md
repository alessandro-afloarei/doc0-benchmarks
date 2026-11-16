---
title: "Middleware and Errors"
---
## Overview

Middleware runs as part of the ordered handler list produced by routing. Each handler receives the same context and a `next` continuation. The continuation advances to the next match, and awaiting it lets the current handler inspect or alter the downstream response on return. [[Routing and Application Composition]] explains how middleware enters that list; [[Request and Context]] explains the shared response and request-local state used during execution.

Sources: [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/compose.ts:20-70](repo://src/compose.ts#L20-L70)

## Follow the continuation

`compose` starts with index -1 and dispatches position zero. Before each call it rejects an index that has already been visited with `next() called multiple times`. It sets `c.req.routeIndex` to the current match and awaits the handler, passing a continuation that dispatches the next index. A handler can stop the chain by producing a response without invoking that continuation. At the end, composition can call a supplied outer continuation or the not-found handler.

Sources: [src/compose.ts:20-65](repo://src/compose.ts#L20-L65)

```mermaid
sequenceDiagram
  participant Dispatch
  participant Middleware
  participant Handler
  participant Context
  Dispatch->>Middleware: handler(context, next)
  Middleware->>Handler: await next()
  Handler-->>Context: Return response; compose assigns res
  Context-->>Middleware: Downstream complete
  Middleware->>Context: Inspect or change response
  Middleware-->>Dispatch: Continuation complete
```

Sources: [src/compose.ts:32-70](repo://src/compose.ts#L32-L70), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

The logger demonstrates the before-and-after pattern: it logs the incoming method and path, records a start time, awaits `next`, and logs the final status and elapsed time. This ordering explains why response-transforming middleware needs to wrap the handler it observes. [[HTTP Middleware]] documents the built-in consumers of that pattern; [[Security Middleware]] covers middleware that can reject a request before it reaches the endpoint.

Sources: [src/middleware/logger/index.ts:81-95](repo://src/middleware/logger/index.ts#L81-L95)

## Finalize the response

When a handler returns a response, composition assigns it if the context is not yet finalized, or if the value came from error recovery. The context setter marks finalization and merges existing response headers. When a composed chain ends without finalization, dispatch throws the diagnostic asking whether the handler forgot to return a response or `await next()`. Returning a response and correctly awaiting continuation are therefore part of the execution contract.

Sources: [src/compose.ts:67-70](repo://src/compose.ts#L67-L70), [src/context.ts:414-434](repo://src/context.ts#L414-L434), [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465)

A single matched handler uses a direct dispatch branch. Its continuation installs the not-found response; a synchronous return is used directly or falls back to not-found. An asynchronous result uses the resolved response, then a finalized context response, then not-found. Exceptions and rejected promises enter the application's error handler. This branch deliberately avoids composition, so its implementation should be considered when investigating differences between a lone handler and a middleware chain.

Sources: [src/hono-base.ts:429-447](repo://src/hono-base.ts#L429-L447)

## Recover failures

Composition catches `Error` values when an error handler is available, stores the error on `c.error`, and awaits that handler's response. That response is eligible to replace an already-finalized response. Non-Error thrown values are rethrown. The application's outer error helper likewise handles only `Error` instances. Code after `await next()` can inspect `c.error` after composition has recovered a downstream error.

Sources: [src/compose.ts:49-70](repo://src/compose.ts#L49-L70), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404), [src/context.ts:319-333](repo://src/context.ts#L319-L333)

The default error handler calls `getResponse` when that property exists, then wraps the returned body and response through `c.newResponse`. Otherwise it logs the error and returns text with status 500. `app.onError` replaces this handler. An unmatched request uses the default 404 text response, replaceable through `app.notFound`. These are separate hooks: absence of a matching endpoint does not need an exception to produce a not-found response.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294)

`HTTPException` carries an HTTP status plus optional message, cause, and response. Its default status is 500. With a supplied response, `getResponse` preserves that response's body and headers but applies the exception's status; otherwise it constructs a response from the message and status. This is the concrete exception used by several admission middleware. A custom error handler can inspect the exception and decide how to represent the failure.

Sources: [src/http-exception.ts:46-77](repo://src/http-exception.ts#L46-L77)

## Combine policies

| Helper from `hono/combine` | Execution rule |
| --- | --- |
| `some` | Tries handlers until one succeeds; false conditions continue, true conditions advance downstream when unfinalized |
| `every` | Composes all entries; a false condition throws `Unmet condition` |
| `except` | Skips its middleware when a predicate or registered path condition matches |

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-165](repo://src/middleware/combine/index.ts#L141-L165)

`some` stops retrying after an error if its wrapped continuation has already been called. This prevents a downstream failure from being treated as another admission alternative. `every` preserves the outer route index for each inner handler, so parameter access continues to refer to the actual matched route. `except` builds a TrieRouter for string conditions and combines them with function predicates before delegating to `some` and `every`.

Sources: [src/middleware/combine/index.ts:38-67](repo://src/middleware/combine/index.ts#L38-L67), [src/middleware/combine/index.ts:99-115](repo://src/middleware/combine/index.ts#L99-L115), [src/middleware/combine/index.ts:145-163](repo://src/middleware/combine/index.ts#L145-L163)

## Reuse typed construction

`createMiddleware` returns the supplied middleware while preserving its generic environment, path, input, and response types. `createFactory` builds a factory with optional default application options and an `initApp` hook. Its `createApp` merges per-call options over defaults, constructs Hono, and invokes the hook. `createHandlers` returns the provided handler array after filtering undefined entries. These helpers organize reusable registration while leaving the continuation behavior unchanged.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## Access context through asynchronous storage

`contextStorage` runs the downstream continuation inside `AsyncLocalStorage` imported from `node:async_hooks`. `tryGetContext` returns the current store or undefined; `getContext` throws `Context is not available` when no context is active. This middleware supports helpers that need the current context without receiving it as an argument. Install it before such helpers execute, and account for the module's runtime import when choosing the integration in [[Runtime Adapters]].

Sources: [src/middleware/context-storage/index.ts:6-10](repo://src/middleware/context-storage/index.ts#L6-L10), [src/middleware/context-storage/index.ts:43-59](repo://src/middleware/context-storage/index.ts#L43-L59)
