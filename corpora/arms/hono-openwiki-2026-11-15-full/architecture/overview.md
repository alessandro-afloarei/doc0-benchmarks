---
type: architecture
title: Architecture Overview
description: Map of the Hono framework's source tree, the HonoBase/Hono split, router presets (default, hono/tiny, hono/quick), the subpath export surface for npm and JSR, and how core, middleware, helpers, JSX, client and adapters relate.
tags: [architecture, overview, presets, exports, core]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-9c5c14f51fb29a586e1fab9c
    resource: repo://src/http-exception.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Architecture Overview

Hono is a small web framework built only on Web Standard APIs (`Request`, `Response`, `Headers`, `URL`, `ReadableStream`, Web Crypto). The same core runs on Cloudflare Workers, Deno, Bun, Node.js (via `@hono/node-server`), AWS Lambda, Fastly, Vercel, Netlify and Service Workers. The package has **no runtime dependencies**; everything in `src/` is first-party.

An application is a `Hono` instance whose `fetch(request, env?, executionCtx?)` method is the universal entry point that runtimes call.

## Source layout

| Path | Responsibility | Wiki page |
| --- | --- | --- |
| `src/hono-base.ts` | Routing API (`get/post/.../all/on/use`), `route`, `basePath`, `mount`, `onError`, `notFound`, and request dispatch (`fetch`, `request`, `fire`). | [Request Lifecycle](request-lifecycle.md) |
| `src/hono.ts` | Default `Hono` class: `HonoBase` plus a default router. | this page |
| `src/compose.ts` | Koa-style middleware composition. | [Request Lifecycle](request-lifecycle.md) |
| `src/context.ts`, `src/request.ts` | Per-request `Context` and `HonoRequest`. | [Context and HonoRequest](context-and-request.md) |
| `src/router.ts`, `src/router/*` | Router interface and five router implementations. | [Routers](../routing/routers.md) |
| `src/types.ts` | Type-level machinery: `Env`, handler interfaces, schema accumulation, path param inference. | [Type System](../concepts/type-system.md) |
| `src/validator/` | `validator()` middleware. | [Validator](../concepts/validation.md) |
| `src/client/` | `hc` type-safe RPC client. | [RPC Client](../integrations/rpc-client.md) |
| `src/middleware/*` | Built-in middleware, one directory each. | [Middleware](../middleware/overview.md), [Security](../middleware/security-and-auth.md) |
| `src/helper/*` | Helpers (cookie, streaming, websocket, factory, testing, ssg, ...). | [Helpers](../helpers/overview.md) |
| `src/jsx/` | Server JSX runtime and `hono/jsx/dom` client renderer. | [Server JSX](../jsx/server-jsx.md), [Client JSX](../jsx/client-dom.md) |
| `src/adapter/*` | Runtime-specific glue (Lambda, Workers, Bun, Deno, ...). | [Runtime Adapters](../integrations/runtime-adapters.md) |
| `src/utils/*` | Shared low-level utilities (URL parsing, cookies, crypto, JWT, MIME, HTML escaping, streams). | various |
| `src/http-exception.ts` | `HTTPException` for intentional HTTP errors. | [Request Lifecycle](request-lifecycle.md) |
| `build/` | Build script and export validation. | [Build and Packaging](../operations/build-and-packaging.md) |
| `runtime-tests/`, `benchmarks/`, `perf-measures/` | Cross-runtime tests and performance tooling. | [Testing Strategy](../testing/testing-strategy.md) |

## HonoBase vs Hono and presets

`HonoBase` (`src/hono-base.ts`) implements everything except router selection; its `router` field is declared but intentionally left unassigned ("like an abstract class"). Concrete classes set it in their constructor:

| Import | Router | Trade-off |
| --- | --- | --- |
| `hono` | `options.router` if given, else `SmartRouter([RegExpRouter, TrieRouter])` | Fastest matching for typical apps, falls back to TrieRouter for patterns RegExpRouter cannot express. |
| `hono/quick` | `SmartRouter([LinearRouter, TrieRouter])` | Cheap route registration; suited to environments where the app is rebuilt per request (cold starts). |
| `hono/tiny` | `PatternRouter` | Smallest bundle size. |

The presets always install their own router and ignore `options.router`; only the default `Hono` honors it. Router details are in [Routers](../routing/routers.md).

Constructor options (`HonoOptions`) are `strict` (default `true`; when `false` a trailing slash is ignored via `getPathNoStrict`), `router`, and `getPath` (custom path extraction, e.g. to route on the `Host` header). `strict: false` overrides any custom `getPath`.

## Public surface and entrypoints

`src/index.ts` exports `Hono`, `Context`, and types (`Env`, `Handler`, `MiddlewareHandler`, `Schema`, `TypedResponse`, `HonoRequest`, `InferRequestType`, `InferResponseType`, ...). Every other feature lives behind a **subpath export** so applications only bundle what they import:

- `package.json` `exports` maps ~75 subpaths (e.g. `hono/cors`, `hono/jwt`, `hono/jsx`, `hono/client`, `hono/cloudflare-workers`, `hono/router/reg-exp-router`, `hono/utils/*`) to ESM (`dist/`), CJS (`dist/cjs/`) and type (`dist/types/`) builds.
- `jsr.json` publishes the same subpaths as `@hono/hono` on JSR, pointing directly at `src/*.ts`.

The build verifies these two maps stay consistent (see [Build and Packaging](../operations/build-and-packaging.md)). Adding a new middleware or helper therefore means adding a directory under `src/`, an entry in both `package.json` and `jsr.json`, and (for `typesVersions` users) the matching typings path.

## How subsystems relate

```
runtime (Workers/Deno/Bun/Node/Lambda...) ──► adapter (optional) ──► app.fetch()
                                                                       │
                       HonoBase#dispatch ─► getPath ─► router.match ─► Context
                                                                       │
                                     compose(middleware..., handler) ◄─┘
                                       │          │            │
                                 middleware   validator   helpers/JSX
                                       └──────► c.res (Response)
```

- **Core** (`hono-base`, `compose`, `context`, `request`, `router`) has no knowledge of specific runtimes.
- **Middleware** are ordinary `MiddlewareHandler`s registered with `app.use()`; most are created with factory functions and some use `createMiddleware` from `hono/factory`.
- **Helpers** are functions that take a `Context` (e.g. `getCookie(c)`, `streamSSE(c, cb)`), sometimes with runtime-specific implementations supplied by adapters (`upgradeWebSocket`, `getConnInfo`, `serveStatic`, `toSSG`).
- **Types** flow from route definitions into `Schema`, which the `hc` client consumes to provide end-to-end type safety.

## Errors

`HTTPException(status = 500, { message, res, cause })` is the sanctioned way to abort with a specific HTTP response. `getResponse()` returns `res` (re-wrapped with the exception's status) or a plain-text response of `message`. The default app error handler checks for `getResponse` and uses it; any other `Error` is logged and turned into `500 Internal Server Error`. Built-in auth middleware throw `HTTPException`s.

## Tests

- `src/hono.test.ts` – the largest test suite; exercises routing API, sub-apps, mount, error handling across all routers.
- `src/preset/tiny.test.ts`, `src/preset/quick.test.ts` – verify preset router selection using `getRouterName` from `hono/dev`.
- `src/http-exception.test.ts` – `HTTPException` response behavior.
