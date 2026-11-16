---
type: architecture
title: Request Lifecycle and Layering
description: End-to-end trace of a request through Hono (adapter, fetch, dispatch, router match, Context, compose, response), including HEAD, 404 and error handling, plus the layering of core, routers, middleware, helpers and adapters.
tags: [lifecycle, dispatch, fetch, architecture, layering]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c72bb3bddcef3a3b371c5898
    resource: repo://src/adapter/aws-lambda/handler.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Request Lifecycle and Layering

Hono is built on Web Standard `Request`/`Response`. Everything runtime-specific is pushed to the edge (adapters) so the core can be a single `fetch(request, env?, executionCtx?)` function. This page follows one request end to end; details live in the linked pages.

## Layers

| Layer | Location | Role |
| --- | --- | --- |
| Adapters | `src/adapter/*` | Convert a platform event into a `Request`, call `app.fetch`, convert the `Response` back ([Runtime Adapters](../platform/adapters.md)) |
| App core | `src/hono-base.ts`, `src/hono.ts`, `src/preset/*` | Route registration and dispatch ([App Core](app-core.md)) |
| Routers | `src/router/*`, `src/router.ts` | Map `(method, path)` to ordered handlers ([Router Contract](../routing/router-contract-and-smart-router.md)) |
| Pipeline | `src/compose.ts`, `src/context.ts`, `src/request.ts` | Onion chain and per-request state ([Middleware Composition](middleware-composition.md), [Context and HonoRequest](context-and-request.md)) |
| Middleware/helpers | `src/middleware/*`, `src/helper/*`, `src/validator`, `src/client`, `src/jsx` | Optional features built purely on the public Context/Hono API ([Middleware Catalog](../features/middleware-catalog.md), [Helpers](../features/helpers.md)) |

`src/index.ts` is intentionally tiny: it exports `Hono`, the `Context` class and type-only re-exports. Almost every feature is a separate subpath export so bundles only include what is imported ([Build and Packaging](../operations/build-and-packaging.md)).

## Step by step

1. **Entry.** An adapter (or user code, e.g. `Bun.serve({ fetch: app.fetch })`) calls `app.fetch(request, env, executionCtx)`. `fetch` is an arrow-function property so it can be passed around unbound; it forwards to the private `#dispatch(request, executionCtx, env, request.method)`. Service-worker style hosts use `app.fire()`, which wraps the same dispatch in `event.respondWith`.
2. **HEAD handling.** For `HEAD`, `#dispatch` re-dispatches the request as `GET` and returns `new Response(null, thatResponse)`, so GET handlers serve HEAD with the body dropped and headers/status retained. There is no separate HEAD registration.
3. **Path extraction and match.** `this.getPath(request, { env })` produces the routing path (see strict mode in [App Core](app-core.md)), then `this.router.match(method, path)` returns `[[handler, routerRoute] ...]` (plus, for RegExp-based routers, a shared param array). With `SmartRouter` the very first match call also selects the concrete router and freezes the route table.
4. **Context creation.** A `Context` is built with the request, path, match result, `env`, execution context and the app's not-found handler. `c.req` is created lazily.
5. **Handler chain.**
   - *One matched handler:* called directly, with a `next` that records the 404 response; sync and async results are normalised, and an `undefined` result becomes either the finalized response or the not-found response.
   - *Several matched handlers:* `compose(...)` runs them as an onion; afterwards `#dispatch` returns `context.res`, or throws if the context was never finalized.
   - *No match:* the router returns an empty list; the not-found handler (default `404 Not Found`) answers.
6. **Errors.** Both paths catch thrown values: `Error` instances go to `errorHandler` (default: `HTTPException.getResponse()` or logged 500), anything else is rethrown out of `fetch` ([App Core](app-core.md)). Inside `compose`, the error is also stored on `c.error` so upstream middleware can observe it after `await next()`.
7. **Response.** The `Response` is returned to the adapter, which serialises it for the host (e.g. API Gateway result objects in the AWS Lambda adapter, native `Response` elsewhere).

## Design consequences

- **Lazy, one-shot router build.** Routers collect routes eagerly via `add` but compile on first `match`; adding a route afterwards raises `Can not add a route since the matcher is already built.` (`MESSAGE_MATCHER_IS_ALREADY_BUILT`). Register all routes before serving requests.
- **Sub-apps share state by reference.** `basePath()` clones share the router and `routes`; `route()` copies routes in at call time, so later additions to a sub-app are not seen by the parent.
- **Environment is explicit.** Handlers read platform bindings from `c.env`/`c.executionCtx`, which the adapter provides; `helper/adapter` provides `env()` and `getRuntimeKey()` for portable access.
- **Testing without a server.** `app.request(...)` builds a `Request` against `http://localhost` and calls `fetch`, so tests exercise the full dispatch path with no network ([Testing](../operations/testing.md)).
