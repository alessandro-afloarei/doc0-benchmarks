---
type: architecture
title: Architecture Overview
description: Module map of the Hono web framework — core application classes and presets, routers, Context/HonoRequest, the type system and RPC client, validator, middleware, helpers, JSX and runtime adapters — and how they ship as package subpath exports.
tags: [architecture, overview, exports, presets]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
  - id: openwiki-source-7a06072801a3639bbb757eb0
    resource: repo://build/remove-private-fields.ts
  - id: openwiki-source-9da6b2729ff1e4995454efe6
    resource: repo://build/validate-exports.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
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
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Architecture Overview

Hono is a small web framework built on Web Standards (`Request`, `Response`, `Headers`, `fetch`). One application object exposes `fetch(request, env, executionCtx)`, so the same app runs on Cloudflare Workers, Deno, Bun, Node.js (through `@hono/node-server`), AWS Lambda, Vercel, Netlify, Fastly and service workers. Runtime-specific behaviour lives in adapters. `package.json` declares no runtime `dependencies`.

## Layers

```
            app.fetch / app.request / app.fire
                         │
 ┌───────────────────────▼────────────────────────┐
 │ HonoBase (src/hono-base.ts)                    │  route registration, dispatch,
 │   router.match → Context → compose(handlers)   │  error / not-found handling
 └──────┬─────────────┬──────────────┬────────────┘
        │             │              │
  Router impls    Context +      compose (src/compose.ts)
  (src/router/*)  HonoRequest    onion-model middleware
                  (context.ts,
                   request.ts)
        ▲
        │ users plug in
  middleware/* · helper/* · validator/* · jsx/* · adapter/* · client/*
```

| Area | Location | Wiki page |
| --- | --- | --- |
| Application core | `src/hono-base.ts`, `src/hono.ts`, `src/preset/*`, `src/compose.ts`, `src/http-exception.ts` | [Request Lifecycle](./request-lifecycle.md) |
| Per-request objects | `src/context.ts`, `src/request.ts` | [Context and HonoRequest](./context-and-request.md) |
| Routing | `src/router.ts`, `src/router/*` | [Routers](../routing/routers.md) |
| Type-level schema & RPC | `src/types.ts`, `src/client/*` | [Type System and RPC Client](../concepts/types-and-rpc-client.md) |
| Validation | `src/validator/*` | [Validation](../concepts/validation.md) |
| Middleware | `src/middleware/*` (25 modules) | [Built-in Middleware](../middleware/built-in-middleware.md), [Security Middleware](../middleware/security-middleware.md) |
| Helpers | `src/helper/*` | [Helpers](../helpers/helpers.md) |
| JSX | `src/jsx/*` | [JSX Runtime](../jsx/jsx-runtime.md) |
| Runtime adapters | `src/adapter/*` | [Runtime Adapters](../integrations/runtime-adapters.md) |
| Shared utilities | `src/utils/*` (URL, cookie, crypto, JWT, MIME, html, body, …) | used throughout |

## HonoBase, Hono and presets

`HonoBase` holds all application behaviour: the HTTP-method registration functions, `use`, `on`, `route`, `basePath`, `mount`, `onError`, `notFound`, `fetch`, `request` and `fire`. Its source calls it "like an abstract class" because it has **no router**. A subclass assigns `this.router` in its constructor. Constructor options other than `strict` are copied onto the instance with `Object.assign`. `strict: false` swaps in `getPathNoStrict`, which ignores trailing slashes.

There are three concrete classes, all named `Hono`. They differ only in their router:

| Import | Router | Trade-off |
| --- | --- | --- |
| `hono` (`src/hono.ts`) | `SmartRouter` over `[RegExpRouter, TrieRouter]`, unless `options.router` is given | Fastest matching for typical apps; default |
| `hono/quick` (`src/preset/quick.ts`) | `SmartRouter` over `[LinearRouter, TrieRouter]` | Cheap registration, for environments that re-create the app on each request |
| `hono/tiny` (`src/preset/tiny.ts`) | `PatternRouter` | Smallest bundle |

The router choice is the only difference between them, which keeps every feature available whichever preset you import.

## Public surface and packaging

`src/index.ts` exports `Hono` and `Context`, plus core types (`Env`, `Handler`, `MiddlewareHandler`, `Schema`, `TypedResponse`, `InferRequestType`, …). Every other feature is a separate subpath export, so a bundle only includes what it imports:

- `package.json` `exports` maps each subpath (`./cors`, `./jwt`, `./jsx/dom`, `./cloudflare-workers`, `./utils/*`, …) to ESM (`dist/*.js`), CJS (`dist/cjs/*.js`) and types (`dist/types/*.d.ts`). `typesVersions` mirrors these for older TypeScript resolution.
- `jsr.json` publishes the same subpaths as `@hono/hono` on JSR. They point straight at the `src/*.ts` files.
- `build/validate-exports.ts` checks that the two export maps agree. See [Build, Packaging and Release](../operations/build-and-release.md).

To add a new middleware or helper you create `src/<area>/<name>/index.ts` and register it in **both** `package.json` (`exports` and `typesVersions`) and `jsr.json`.

## Cross-cutting conventions

- **Web Standards first.** Middleware and helpers work on `Request`/`Response`/`Headers` and on Web Crypto (`src/utils/crypto.ts`, `src/utils/jwt`). Runtime APIs are used only inside `src/adapter/*` or behind `getRuntimeKey()` checks (`src/helper/adapter`).
- **Types carry the API contract.** Route registration methods return a `Hono` whose `Schema` generic has grown by the new route. The `hc` client reads that schema. Changes to `src/types.ts` are checked by large type-level test suites (`src/types.test.ts`, `src/hono.test.ts`).
- **Private state.** Class internals use `#private` fields wherever possible. A few fields (`_basePath`, `errorHandler`) stay TypeScript-`private` because sibling instances must reach them at runtime, for example `route()` reads a sub-app's `errorHandler`. After declaration emit, `build/remove-private-fields.ts` strips the `#private` field declarations from the generated `.d.ts` files.
