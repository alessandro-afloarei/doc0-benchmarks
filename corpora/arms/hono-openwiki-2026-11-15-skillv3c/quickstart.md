---
type: guide
title: Quickstart
description: Entry point to the Hono repository wiki — what Hono is, how the source tree is organized, how to install, build, test and lint, and a task-oriented map pointing to the page that explains each subsystem.
tags: [quickstart, overview, onboarding, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Quickstart

**Hono** is a small, fast web framework built only on Web Standards (`Request`/`Response`, Web Streams, Web Crypto). One app object exposes `app.fetch(request, env, executionCtx)`, which runs unchanged on Cloudflare Workers, Deno, Bun, Fastly, AWS Lambda, Lambda@Edge, Vercel, Netlify, Service Workers and Node.js (via the separate `@hono/node-server`).

```ts
import { Hono } from 'hono'
const app = new Hono()
app.get('/', (c) => c.text('Hono!'))
export default app
```

The repository is the framework library itself (npm `hono`, JSR `@hono/hono`), version 4.x. The root module exports only `Hono`, `Context` and core types; every middleware, helper, adapter and JSX runtime is a separate subpath import (`hono/cors`, `hono/jsx`, `hono/aws-lambda`, …).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/hono-base.ts`, `src/hono.ts`, `src/compose.ts`, `src/context.ts`, `src/request.ts`, `src/types.ts` | Core: app, middleware chain, context, request, type system |
| `src/router/` | Pluggable routers (RegExp, Trie, Smart, Linear, Pattern) |
| `src/middleware/` | Built-in middleware (one directory each) |
| `src/helper/` | Helpers (cookie, streaming, websocket, ssg, factory, proxy, …) |
| `src/adapter/` | Runtime adapters |
| `src/jsx/` | JSX: server string renderer and client DOM renderer |
| `src/client/`, `src/validator/` | RPC client and validator |
| `src/utils/` | Shared low-level utilities (URL, body, cookie, crypto, JWT, mime, …) |
| `build/` | Build script and export validation |
| `runtime-tests/`, `benchmarks/`, `perf-measures/` | Per-runtime integration tests, benchmarks, CI performance measures |
| `docs/` | `CONTRIBUTING.md`, `MIGRATION.md`, code of conduct |

Tests are co-located with sources as `*.test.ts(x)`.

## Developer workflow

Bun is the package manager and task runner.

```bash
bun install --frozen-lockfile
bun run test          # tsc type-check of src + tests, then all Vitest projects
bun run lint          # ESLint
bun run format        # Prettier check (format:fix to write)
bun run build         # dist/ (ESM, CJS, .d.ts) + publint
bun run test:deno     # Deno runtime tests (needs Deno)
bun run test:bun      # Bun runtime tests
```

Contribution expectations: PRs must pass `bun run test`; third-party middleware that depends on external libraries belongs in the separate `honojs/middleware` repository, not in core (`docs/CONTRIBUTING.md`).

When adding a public module, register its subpath in **both** `package.json` and `jsr.json`, or the build fails — see [Build, Exports, and Release](operations/build-and-release.md).

## Where to look

Start with the [Architecture Overview](overview/architecture.md) for the layer map and request flow. Then, by task:

| If you need to… | Read |
| --- | --- |
| Understand route registration, `basePath`, `route()`, `mount()`, `fetch`/`request`, HEAD handling | [Application Object and Request Dispatch](core/application.md) |
| Understand `next()`, middleware ordering, why returning a response after `next()` is ignored | [Middleware Composition](core/middleware-composition.md) |
| Work with `c.json/c.text/c.html`, headers, status, `c.set/c.get`, `c.render` | [Context](core/context.md) |
| Read params, query, headers, body (and body caching), `parseBody` | [HonoRequest](core/request.md) |
| Handle errors, `HTTPException`, `onError`/`notFound`, sub-app error handlers | [Error Handling and HTTPException](core/error-handling.md) |
| Choose or debug a router, path syntax, `UnsupportedPathError` | [Router Contract and SmartRouter](routing/router-interface.md) |
| Dig into RegExpRouter compilation or PreparedRegExpRouter | [RegExpRouter and PreparedRegExpRouter](routing/reg-exp-router.md) |
| Understand TrieRouter / LinearRouter / PatternRouter (`hono/quick`, `hono/tiny`) | [TrieRouter, LinearRouter, and PatternRouter](routing/trie-linear-pattern-routers.md) |
| Fix type inference, Env/Variables typing, schema accumulation | [Type System and Route Schema](typing/type-system.md) |
| Use or change the `hc` RPC client | [RPC Client (hc)](typing/rpc-client.md) |
| Validate input and type `c.req.valid()` | [Validator](validation/validator.md) |
| Use auth/security middleware (basic, bearer, JWT, JWK, CSRF, CORS, secure headers, IP restriction) | [Security and Authentication Middleware](middleware/security-and-auth.md) |
| Use cache, compress, etag, logger, timing, timeout, body limit, request id, etc. | [Request/Response Middleware](middleware/request-response-middleware.md) |
| Render JSX on the server, stream with Suspense, use `html`/`css` helpers, `jsxRenderer` | [JSX Server Rendering, html and css Helpers](jsx/server-rendering.md) |
| Build client-side UI with `hono/jsx/dom` and hooks | [JSX DOM Runtime and Hooks](jsx/dom-runtime.md) |
| Stream responses, Server-Sent Events, WebSockets | [Streaming, SSE, and WebSocket Helpers](helpers/streaming-and-websocket.md) |
| Cookies, content negotiation, runtime env, factory, proxy, route introspection, test client | [Utility Helpers](helpers/utility-helpers.md) |
| Generate a static site from an app | [Static Site Generation (SSG)](helpers/ssg.md) |
| Deploy to a specific runtime, serve static files, get the client IP | [Runtime Adapters](adapters/runtime-adapters.md) |
| Build, publish, or add a new export | [Build, Exports, and Release](operations/build-and-release.md) |
| Run or write tests, runtime tests, benchmarks, perf checks | [Testing, Runtime Tests, and Benchmarks](testing/testing-strategy.md) |

## Five facts that save debugging time

1. **Register every route before the first request.** The default `SmartRouter`/`RegExpRouter` compile on first match; later `add()` calls throw.
2. **Middleware and handlers run in registration order**, and errors are turned into responses at the innermost level — outer middleware see `c.res` and `c.error`, not an exception.
3. **To change the response after `await next()`, assign `c.res`**; returning a new `Response` from an outer middleware is ignored once the context is finalized.
4. **Read bodies via `c.req.*`, not `c.req.raw.*`,** so validators, middleware and handlers can share the cached body.
5. **RPC types only flow through chained route definitions** (`new Hono().get(...).post(...)`); export `typeof app` from the chained expression.
