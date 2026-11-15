---
type: overview
title: Architecture Overview
description: Map of the Hono framework's layers — application object, routers, Context/HonoRequest, middleware composition, built-in middleware, helpers, runtime adapters, JSX, validator and RPC client — how a request flows through them, the published subpath exports, and the hono/tiny and hono/quick presets.
tags: [overview, architecture, exports, presets, request-flow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Architecture Overview

Hono is a small web framework built entirely on Web Standards (`Request`, `Response`, `Headers`, Web Streams, Web Crypto). The core has **no runtime dependencies**; anything runtime-specific is isolated in `src/adapter/*`. The same `app.fetch` function runs on Cloudflare Workers, Deno, Bun, Node.js (via the separate `@hono/node-server`), AWS Lambda, Vercel, Netlify, Fastly and Service Workers.

## Layers

| Layer | Source | Responsibility | Page |
| --- | --- | --- | --- |
| Application | `src/hono-base.ts`, `src/hono.ts` | Route registration, sub-apps (`route`, `basePath`, `mount`), dispatch via `fetch` | [Application Object and Request Dispatch](../core/application.md) |
| Composition | `src/compose.ts` | Onion-model execution of matched middleware/handlers, error capture | [Middleware Composition](../core/middleware-composition.md) |
| Routing | `src/router.ts`, `src/router/*` | Path matching; pluggable routers behind one interface | [Router Contract and SmartRouter](../routing/router-interface.md) |
| Request/Response | `src/context.ts`, `src/request.ts` | Per-request `Context` (`c`) and `HonoRequest` (`c.req`) | [Context](../core/context.md), [HonoRequest](../core/request.md) |
| Errors | `src/http-exception.ts` | `HTTPException`, `onError`/`notFound` | [Error Handling](../core/error-handling.md) |
| Types / RPC | `src/types.ts`, `src/client/*` | Type-level route schema; `hc` typed client | [Type System](../typing/type-system.md), [RPC Client](../typing/rpc-client.md) |
| Validation | `src/validator/*` | `validator()` middleware feeding typed input | [Validator](../validation/validator.md) |
| Middleware | `src/middleware/*` | Built-in middleware (auth, CORS, cache, etc.) | [Security](../middleware/security-and-auth.md), [Request/Response](../middleware/request-response-middleware.md) |
| Helpers | `src/helper/*` | Cookie, streaming, websocket, SSG, factory, proxy, ... | [Utility Helpers](../helpers/utility-helpers.md), [Streaming](../helpers/streaming-and-websocket.md), [SSG](../helpers/ssg.md) |
| JSX | `src/jsx/*` | Server string renderer and client DOM renderer | [Server Rendering](../jsx/server-rendering.md), [DOM Runtime](../jsx/dom-runtime.md) |
| Adapters | `src/adapter/*` | Runtime glue: event translation, static files, conninfo, websockets | [Runtime Adapters](../adapters/runtime-adapters.md) |
| Shared utilities | `src/utils/*` | URL/query parsing, body parsing, cookies, crypto, JWT, mime, encoding, streams | (referenced from feature pages) |

## Request flow

```
runtime / adapter ──► app.fetch(request, env, executionCtx)
                        │
                        ├─ getPath(request)            (src/utils/url.ts)
                        ├─ router.match(method, path)  → [handlers+params]
                        ├─ new Context(request, {...})
                        ├─ 1 handler?  call directly
                        │  else        compose(handlers, onError, notFound)(c)
                        │                 middleware → … → handler → … → middleware
                        └─ Response (or onError / notFound response)
```

Key design choices visible in the code:

- **Middleware and handlers are the same thing.** `app.use()` registers handlers under the pseudo-method `ALL`; the router returns everything that matches in registration order.
- **Routing is pluggable.** `HonoBase` has no router; `Hono` picks `SmartRouter(RegExpRouter, TrieRouter)` and presets choose others.
- **Laziness for speed.** `c.req` is created on first access, the single-handler case skips `compose`, `c.text()` has a bare-`Response` fast path, and query/path parsing avoids allocations on common paths.
- **Errors become responses inside the chain.** Thrown errors are converted by `onError` at the innermost compose level, so outer middleware always see a response.
- **Types carry the API contract.** Each route's input (validators) and output (`c.json` etc.) are accumulated into a `Schema` type parameter on the app, which the `hc` client consumes without code generation.

## Presets

All three entry classes extend `HonoBase` and differ only in router choice:

| Import | Router | Trade-off |
| --- | --- | --- |
| `hono` | `SmartRouter` over `RegExpRouter` + `TrieRouter` | Fastest matching; falls back to `TrieRouter` for patterns RegExpRouter can't compile. Honors `options.router`. |
| `hono/quick` | `SmartRouter` over `LinearRouter` + `TrieRouter` | Fast registration for environments that build the app on every request (e.g. some serverless cold paths). |
| `hono/tiny` | `PatternRouter` | Smallest bundle. |

## Published entry points

The package exports ~75 subpaths, kept identical between `package.json` (npm, built `dist/`) and `jsr.json` (JSR, raw `src/`) — see [Build, Exports, and Release](../operations/build-and-release.md). Groups:

- **Core:** `hono`, `hono/tiny`, `hono/quick`, `hono/hono-base`, `hono/request`, `hono/types`, `hono/http-exception`, `hono/router` and `hono/router/*` (each router), `hono/utils/*`.
- **Middleware:** `basic-auth`, `bearer-auth`, `body-limit`, `cache`, `combine`, `compress`, `context-storage`, `cors`, `csrf`, `etag`, `ip-restriction`, `jsx-renderer`, `jwk`, `jwt`, `language`, `logger`, `method-override`, `powered-by`, `pretty-json`, `request-id`, `secure-headers`, `serve-static`, `timeout`, `timing`, `trailing-slash`.
- **Helpers:** `accepts`, `adapter` (env/runtime detection), `conninfo`, `cookie`, `css`, `dev`, `factory`, `html`, `proxy`, `route`, `ssg`, `streaming`, `testing`, `ws` (WebSocket helper in `src/helper/websocket`).
- **Validation & RPC:** `validator`, `client`.
- **JSX:** `jsx`, `jsx/jsx-runtime`, `jsx/jsx-dev-runtime`, `jsx/streaming`, `jsx/dom`, `jsx/dom/client`, `jsx/dom/server`, `jsx/dom/css`, `jsx/dom/jsx-runtime`, `jsx/dom/jsx-dev-runtime`.
- **Adapters:** `aws-lambda`, `bun`, `cloudflare-pages`, `cloudflare-workers`, `deno`, `lambda-edge`, `netlify`, `service-worker`, `vercel`.

The root module (`src/index.ts`) exports only `Hono`, `Context`, and core types (`Env`, `Handler`, `MiddlewareHandler`, `Next`, `Schema`, `TypedResponse`, `InferRequestType`, `InferResponseType`, `ClientRequestOptions`, ...); everything else is imported from its subpath to keep bundles small.

## Repository layout

- `src/` — library source with co-located `*.test.ts(x)` files.
- `build/` — build script, export validation, private-field stripping.
- `runtime-tests/` — per-runtime integration tests (Deno, Bun, workerd, Fastly, Lambda, Lambda@Edge, Node).
- `benchmarks/`, `perf-measures/` — router/JSX/HTTP benchmarks and type-check/bundle-size measurements.
- `docs/` — contributing guide, code of conduct, migration notes (`MIGRATION.md`).

See [Testing, Runtime Tests, and Benchmarks](../testing/testing-strategy.md) for how these are exercised.
