---
type: architecture
title: Architecture Overview
description: Package shape of Hono 4.x — HonoBase and its router-selecting presets, the many subpath exports, module layering (core, utils, helpers, middleware, adapters, JSX, client), and the Web-Standards-only design.
tags: [architecture, hono, presets, exports, layering]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
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
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Architecture Overview

Hono is a web framework built only on Web Standard APIs (`Request`, `Response`, `Headers`, `URL`, `crypto.subtle`, streams). The same code therefore runs on Cloudflare Workers, Deno, Bun, Node.js, AWS Lambda, Fastly, Vercel and Netlify. Runtime differences are isolated in `src/adapter/*` and `src/helper/adapter`; the core never imports a runtime-specific module. Package `hono` is at version 4.12.30 (`package.json`); `jsr.json` publishes the same source as `@hono/hono`.

## Core: HonoBase and presets

`HonoBase` (`src/hono-base.ts`, exported as `HonoBase`) holds all application behaviour but **has no router**. Its comment describes it as "like an abstract class": a subclass must assign `this.router` in its constructor. Three presets do that, and they are the only difference between them:

| Import | Class | Router assigned |
| --- | --- | --- |
| `hono` (`src/hono.ts`) | `Hono` | `options.router` if given, else `SmartRouter([RegExpRouter, TrieRouter])` |
| `hono/quick` (`src/preset/quick.ts`) | `Hono` | `SmartRouter([LinearRouter, TrieRouter])` (fast to build, for short-lived instances) |
| `hono/tiny` (`src/preset/tiny.ts`) | `Hono` | `PatternRouter` (smallest bundle) |

See [Router Implementations](../routing/routers.md) for why these combinations exist. `src/index.ts` re-exports `Hono`, `Context` and a set of types (`Env`, `Handler`, `MiddlewareHandler`, `ValidationTargets`, `TypedResponse`, `Schema`, `InferRequestType`, `InferResponseType`, …), and nothing else; everything else is reached through subpath exports.

`HonoBase` is parameterised by `Env` (Bindings and Variables), a route `Schema`, and the base/current path. These generics only exist for type inference: route handlers register input/output types into `Schema`, which the [typed RPC client](../core/validation-and-client.md) later consumes.

The constructor wires the method helpers (`get`, `post`, `put`, `delete`, `options`, `patch`, `all`), `on` and `use` as instance closures rather than prototype methods; each one funnels into a private `#addRoute`, which pushes to both `router.add` and the public `routes` array. See [Request Lifecycle](request-lifecycle.md) for dispatch.

## Layers and dependency direction

Imports flow strictly downward in this list; lower layers never import higher ones.

1. **`src/utils/*`** – dependency-free primitives: URL/path helpers (`url.ts`), cookie, body parsing, HTML escaping, JWT/JWS/JWA, mime, IP address parsing, crypto, encode, stream, accept-header parsing, `http-status`.
2. **`src/router.ts` + `src/router/*`** – the `Router` contract and five implementations.
3. **Core**: `context.ts`, `request.ts`, `compose.ts`, `http-exception.ts`, `types.ts`, `hono-base.ts`. See [Context and HonoRequest](../core/context-and-request.md).
4. **`src/helper/*`** – opt-in utilities built on core (cookie, ssg, streaming, factory, html, css, testing, websocket, conninfo, proxy, route, dev, accepts, adapter). See [Helpers](../helpers/helpers.md).
5. **`src/middleware/*`** – `MiddlewareHandler` factories. See [Built-in Middleware](../middleware/middleware.md).
6. **`src/jsx/*`** – a self-contained JSX runtime (server string rendering, streaming, DOM). See [Hono JSX](../jsx/jsx-system.md). `jsx-renderer` middleware and `helper/css` bridge it with the core.
7. **`src/adapter/*`** – runtime glue that turns platform events into `app.fetch` calls, plus per-runtime `serve-static`, websocket and conninfo. See [Runtime Adapters](../runtimes/adapters.md).
8. **`src/client`, `src/validator`** – type-driven request validation and the `hc` proxy client.

## Subpath exports are the public API

`package.json#exports` lists roughly 80 entries (e.g. `hono/cors`, `hono/jwt`, `hono/jsx/dom`, `hono/router/reg-exp-router`, `hono/aws-lambda`, `hono/ssg`). Each maps to `dist/*.js` (ESM), `dist/cjs/*.js` (CJS) and `dist/types/...` for types, and several public names differ from source paths (`hono/cors` → `src/middleware/cors`, `hono/ws` → `helper/websocket`, `hono/jsx-renderer` → `middleware/jsx-renderer`). `jsr.json` must contain the same export set; the build fails if the two diverge (see [Build, Packaging and CI](../operations/build-and-release.md)). Because every feature is its own entry point, bundlers can tree-shake, and `hono/tiny` stays small by only pulling `PatternRouter`.

## Invariants worth knowing

- A `Hono` instance without a router throws on first route registration because `#addRoute` calls `this.router.add`; always instantiate a preset (or subclass `HonoBase`).
- `HonoOptions.strict` (default `true`) chooses between `getPath` and `getPathNoStrict` (trailing-slash-insensitive); a custom `getPath` is only honoured when strict is on.
- Options other than `strict` are copied straight onto the instance with `Object.assign`, which is how `router` and `getPath` are injected.
- Only `Error` instances are routed to `onError`; non-Error throwables are rethrown out of `fetch`.
