---
type: quickstart
title: Hono Quickstart and Task Routing
description: Entry point to the Hono repository wiki - what the project is, how the source is laid out, the commands to build and test it, and a task-to-page map for finding the right documentation.
tags: [quickstart, overview, hono, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Hono Quickstart

Hono (package `hono`, version 4.12.30) is a small web framework built entirely on Web Standards (`Request`, `Response`, `fetch`). The same application code runs on Cloudflare Workers/Pages, Deno, Bun, Node.js, AWS Lambda, Vercel, Netlify, Fastly Compute and service workers. The repository is the library itself (not an application); it is published to npm and JSR from one `src/` tree.

A minimal app:

```ts
import { Hono } from 'hono'
const app = new Hono()
app.get('/hello/:name', (c) => c.json({ hello: c.req.param('name') }))
export default app            // Workers / Bun; or Deno.serve(app.fetch)
```

## Repository layout

| Path | Contents | Wiki |
| --- | --- | --- |
| `src/hono-base.ts`, `src/hono.ts`, `src/preset/` | App class, route registration, presets | [App Core](architecture/app-core.md) |
| `src/compose.ts`, `src/context.ts`, `src/request.ts` | Middleware pipeline, `c`, `c.req` | [Middleware Composition](architecture/middleware-composition.md), [Context and HonoRequest](architecture/context-and-request.md) |
| `src/router.ts`, `src/router/*` | Router contract and five router implementations | [Router Contract](routing/router-contract-and-smart-router.md), [RegExpRouter](routing/regexp-router.md), [Trie/Linear/Pattern](routing/trie-linear-pattern-routers.md) |
| `src/middleware/*` | Built-in middleware | [Middleware Catalog](features/middleware-catalog.md) |
| `src/helper/*` | Streaming, SSG, WebSocket, cookie, factory, ... | [Helpers](features/helpers.md) |
| `src/validator`, `src/client` | Validation and typed RPC client | [Validator and RPC client](features/validation-and-rpc-client.md) |
| `src/jsx/*` | Built-in JSX (server and DOM) | [JSX](features/jsx.md) |
| `src/adapter/*` | Per-platform glue | [Runtime Adapters](platform/adapters.md) |
| `build/`, `package.json`, `jsr.json` | Build and exports | [Build and Packaging](operations/build-and-packaging.md) |
| `runtime-tests/`, `vitest.config.ts` | Cross-runtime tests | [Testing](operations/testing.md) |
| `benchmarks/`, `perf-measures/` | Router/HTTP/JSX benchmarks, type and bundle-size checks | [Testing](operations/testing.md) |
| `docs/` | Contributing guide, code of conduct, migration notes | (source docs) |

## How a request flows (one paragraph)

An adapter (or the host runtime) calls `app.fetch(request, env, ctx)`. `HonoBase` extracts the path, asks its router for every matching handler, creates a `Context`, then runs the handlers through `compose` as an onion-style chain, falling back to the not-found handler, and routing thrown errors to the error handler. See [Request Lifecycle](architecture/request-lifecycle.md) for the full trace.

## Everyday commands

Tooling is Bun-based (`.tool-versions`: Node 24.7.0, Bun 1.2.19, Deno 2.4.5).

- Install: `bun install`
- Test (type-check + Vitest): `bun run test`; one runtime: `bun run test:node` / `test:workerd` / `test:fastly` / `test:lambda`; Deno and Bun: `bun run test:deno`, `bun run test:bun`
- Lint / format: `bun run lint`, `bun run format:fix`
- Build: `bun run build` (outputs `dist/` as ESM, CJS and `.d.ts`)

See [Testing](operations/testing.md) and [Build and Packaging](operations/build-and-packaging.md) for details and conventions.

## Which page should I read?

| I want to... | Read |
| --- | --- |
| Understand end to end what happens per request | [Request Lifecycle](architecture/request-lifecycle.md) |
| Change how routes, `use`, `route()`, `basePath()` or `mount()` behave | [App Core](architecture/app-core.md) |
| Debug `next()` misuse, "Context is not finalized", error/404 handling | [Middleware Composition](architecture/middleware-composition.md) |
| Change response/header/variable behaviour or param decoding | [Context and HonoRequest](architecture/context-and-request.md) |
| Fix a routing bug, add a path syntax, or write a custom router | [Router Contract](routing/router-contract-and-smart-router.md), then the specific router page |
| Understand why a route set falls back from RegExpRouter | [RegExpRouter](routing/regexp-router.md) |
| Add or modify a middleware (auth, CORS, body limit, ...) | [Middleware Catalog](features/middleware-catalog.md) |
| Work on streaming/SSE, SSG, WebSocket, cookies, `createFactory` | [Helpers](features/helpers.md) |
| Work on `validator()` or the `hc` client/typing | [Validator and RPC client](features/validation-and-rpc-client.md) |
| Work on JSX rendering, Suspense or the DOM runtime | [JSX](features/jsx.md) |
| Add or fix support for a platform | [Runtime Adapters](platform/adapters.md) |
| Add a new subpath export or change the build | [Build and Packaging](operations/build-and-packaging.md) |
| Add tests or run them on a specific runtime | [Testing](operations/testing.md) |

## Key design facts

- Zero-dependency core; features ship as separate subpath exports so bundles stay small.
- Presets (`hono`, `hono/quick`, `hono/tiny`) differ only in which router they install.
- Routes must be registered before the first request because routers build their matchers on first match.
- TypeScript types are a first-class feature: `Env`, `Input` and `Schema` generics flow from handlers and validators into the `hc` client.
- Source and tests are authoritative; the wiki is orientation, so verify details in code when changing behaviour.
