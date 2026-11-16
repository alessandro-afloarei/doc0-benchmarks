---
type: guide
title: Hono Quickstart and Task Map
description: Entry point to the Hono (v4.12.30) source wiki — what the project is, how the repository is laid out, the essential commands, and a task-to-page map for finding routing, request-handling, middleware, JSX, adapter, build and testing details.
tags: [quickstart, overview, task-map, hono]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Hono Quickstart and Task Map

Hono is a small, dependency-free web framework built only on Web Standard APIs (`Request`/`Response`), designed to run unchanged on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, Netlify, AWS Lambda / Lambda@Edge and Node.js (`README.md`). It is published to npm as `hono` and to JSR as `@hono/hono`.

```ts
import { Hono } from 'hono'
const app = new Hono()
app.get('/', (c) => c.text('Hono!'))
export default app          // runtime calls app.fetch(request, env, ctx)
```

## Mental model in five lines

1. `Hono` (`src/hono.ts`) = `HonoBase` + a default `SmartRouter([RegExpRouter, TrieRouter])`; `hono/quick` and `hono/tiny` swap the router. → [Architecture Overview](architecture/overview.md)
2. `app.get/post/use/on/route/basePath/mount` register `[handler, route]` pairs into the router. → [Request Lifecycle](architecture/request-lifecycle.md)
3. `app.fetch` extracts the path, asks the router for **all** matching handlers in registration order, builds a `Context`, and runs them through `compose()` (onion model). → [Request Lifecycle](architecture/request-lifecycle.md), [Router Implementations](routing/routers.md)
4. Handlers return a `Response` (usually via `c.text/json/html/...`) or `await next()`; thrown `HTTPException`s and errors go to `onError`. → [Context and HonoRequest](core/context-and-request.md)
5. Types accumulate on the app so `hc<typeof app>()` gives a typed client. → [Validator and Typed RPC Client](core/validation-and-client.md)

## Repository layout

| Path | Contents |
| --- | --- |
| `src/hono-base.ts`, `src/hono.ts`, `src/preset/` | App class, default and alternative presets |
| `src/context.ts`, `src/request.ts`, `src/compose.ts`, `src/types.ts`, `src/http-exception.ts` | Core request/response machinery and the type system |
| `src/router.ts`, `src/router/*` | Router interface and RegExp / Trie / Smart / Linear / Pattern routers |
| `src/middleware/*` | Built-in middleware (auth, cors, csrf, compress, jwt, serve-static, …) |
| `src/helper/*` | ssg, streaming/SSE, cookie, factory, testing, websocket, proxy, html, css, route, dev, adapter, conninfo, accepts |
| `src/jsx/*` | Built-in JSX: server, streaming, DOM runtime, hooks |
| `src/adapter/*` | Runtime glue (Cloudflare, Deno, Bun, Lambda, Vercel, Netlify, service worker) |
| `src/client`, `src/validator` | `hc` RPC client and `validator()` |
| `src/utils/*` | Primitives: url, cookie, jwt, html escaping, mime, ipaddr, body, buffer, … |
| `build/` | esbuild + tsc build scripts, export validation, d.ts private-field stripper |
| `runtime-tests/` | Per-runtime suites (Node, workerd, Fastly, Lambda, Deno, Bun) |
| `benchmarks/`, `perf-measures/` | Router/HTTP/JSX benchmarks; bundle-size and type-check measurement |
| `.github/workflows/` | CI, release, autofix, preview packages, OpenWiki updates |

## Commands (Bun is the package manager)

```bash
bun install --frozen-lockfile
bun run test            # tsc -p tsconfig.spec.json && vitest --run
bunx vitest --run --project node   # a single project (also: workerd, fastly, lambda, ...)
bun run test:deno | test:bun       # runtimes with their own runners
bun run lint && bun run format     # eslint / prettier --check
bun run build                      # dist/ (ESM, CJS, types) via build/build.ts
```

## Task map — where to look

| If you want to… | Read |
| --- | --- |
| Understand presets, exports, module layering, why `Hono` has no built-in router | [Architecture Overview](architecture/overview.md) |
| Trace a request, `next()`, error/404 handling, `route()`/`basePath()`/`mount()` | [Request Lifecycle](architecture/request-lifecycle.md) |
| Debug route ordering, wildcards, optional params, router fallback, router performance | [Router Implementations](routing/routers.md) |
| Change response helpers, headers, `c.set/c.get`, body parsing, `c.req.param/valid` | [Context and HonoRequest](core/context-and-request.md) |
| Work on `validator()`, `hc`, `testClient`-style typed requests, schema types | [Validator and Typed RPC Client](core/validation-and-client.md) |
| Add or modify a middleware, check auth/CORS/CSRF/compression/serve-static behaviour | [Built-in Middleware](middleware/middleware.md) |
| Work on JSX rendering, Suspense/streaming, hooks, `createRoot`, `jsxRenderer` | [Hono JSX](jsx/jsx-system.md) |
| Add or debug a platform adapter, Lambda events, WebSocket upgrade, `getConnInfo`, runtime detection | [Runtime Adapters](runtimes/adapters.md) |
| Use SSG, streaming/SSE, cookies, factory, proxy, websocket types, route/dev introspection | [Helpers](helpers/helpers.md) |
| Change the build, exports (`package.json` ↔ `jsr.json`), CI or release flow | [Build, Packaging and CI](operations/build-and-release.md) |
| Write/run tests, router conformance tests, runtime suites, benchmarks | [Testing Strategy](testing/testing.md) |

## Cross-cutting rules of thumb

- Keep core runtime-agnostic: only Web Standard APIs; runtime-specific code goes in `src/adapter/*`.
- Every new public module needs entries in both `package.json#exports` (plus `dist/types` path) and `jsr.json`, or the build fails.
- Middleware conventions (`c.set` + `ContextVariableMap`, `HTTPException`, validate options at construction) are described in [Built-in Middleware](middleware/middleware.md).
- Source and tests are authoritative; treat these pages as orientation and verify details against current code.
