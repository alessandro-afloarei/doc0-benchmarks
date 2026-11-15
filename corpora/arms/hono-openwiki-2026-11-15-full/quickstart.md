---
type: guide
title: Quickstart
description: Orientation for working on the Hono repository — what the framework is, a minimal app, repository layout, everyday commands for building and testing, and a task-routing map pointing to the wiki page that explains each subsystem.
tags: [quickstart, overview, contributing, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Quickstart

Hono is a small web framework built on Web Standards (`Request`/`Response`/`fetch`) with **zero runtime dependencies**. The same app runs on Cloudflare Workers, Fastly Compute, Deno, Bun, AWS Lambda, Lambda@Edge, Vercel, Netlify and Node.js (via `@hono/node-server`). This repository is the `hono` npm package (also published as `@hono/hono` on JSR); user-facing docs live at hono.dev.

```ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hono!'))

export default app // runtimes call app.fetch(request, env, ctx)
```

`src/index.ts` exports `Hono`, `Context` and the core types; every other feature is a subpath export such as `hono/cors`, `hono/jwt`, `hono/jsx` or `hono/client`.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/hono-base.ts`, `src/hono.ts`, `src/compose.ts` | App class, routing API, dispatch, middleware composition |
| `src/context.ts`, `src/request.ts` | Per-request `Context` and `HonoRequest` |
| `src/router/` | RegExp, Trie, Smart, Linear and Pattern routers |
| `src/types.ts` | Type-level schema/inference machinery |
| `src/middleware/`, `src/helper/` | Built-in middleware and helpers |
| `src/jsx/` | Server JSX and the `hono/jsx/dom` client renderer |
| `src/client/` | `hc` RPC client |
| `src/validator/` | `validator()` middleware |
| `src/adapter/` | Runtime adapters |
| `src/utils/` | Shared utilities (URL, cookie, crypto, JWT, HTML, MIME, streams) |
| `build/` | Build script and export validation |
| `runtime-tests/` | Per-runtime integration tests |
| `benchmarks/`, `perf-measures/` | Performance tooling |
| `docs/` | `CONTRIBUTING.md`, `MIGRATION.md` |

## Everyday commands

Bun is the package manager and script runner.

```bash
bun install --frozen-lockfile   # install
bun run test                    # tsc type-check of src, then all Vitest projects
bun run test:watch              # Vitest watch mode
bun run lint && bun run format  # ESLint + Prettier check
bun run build                   # ESM + CJS + .d.ts into dist/, then publint
bun run test:deno | test:bun    # native Deno / Bun runtime tests
bun run test:node | test:workerd | test:lambda | test:lambda-edge | test:fastly
```

Pull requests are expected to pass `bun run test`. See [Testing Strategy](testing/testing-strategy.md) and [Build and Packaging](operations/build-and-packaging.md).

## Where to look for a task

| If you need to… | Read |
| --- | --- |
| Understand the big picture, presets and exports | [Architecture Overview](architecture/overview.md) |
| Follow a request from `fetch()` to `Response`, or change `route`/`basePath`/`mount`/error handling | [Request Lifecycle](architecture/request-lifecycle.md) |
| Change response helpers, headers, variables, body parsing or params | [Context and HonoRequest](architecture/context-and-request.md) |
| Fix a routing bug or tune matching performance | [Routers](routing/routers.md) |
| Change handler typings, schema inference or `TypedResponse` | [Type System](concepts/type-system.md) |
| Work on request validation | [Validator](concepts/validation.md) |
| Work on the typed client `hc` | [RPC Client](integrations/rpc-client.md) |
| Add or modify general middleware (cache, compress, etag, serve-static, ...) | [Built-in Middleware](middleware/overview.md) |
| Touch auth, JWT/JWK, CORS, CSRF, secure headers or IP restriction | [Security and Authentication Middleware](middleware/security-and-auth.md) |
| Work on cookies, streaming/SSE, WebSocket, proxy, SSG, factory, testing helpers | [Helpers](helpers/overview.md) |
| Work on server-side JSX, Suspense streaming, `html`/`css` helpers, `jsxRenderer` | [Server JSX](jsx/server-jsx.md) |
| Work on `hono/jsx/dom`, hooks or client rendering | [Client JSX and Hooks](jsx/client-dom.md) |
| Support a runtime or fix an adapter (Lambda, Workers, Bun, Deno, ...) | [Runtime Adapters](integrations/runtime-adapters.md) |
| Add a new public subpath export or change the build/release | [Build and Packaging](operations/build-and-packaging.md) |
| Decide which tests to add or run | [Testing Strategy](testing/testing-strategy.md) |

## Key invariants to keep in mind

- Handlers and middleware run in **registration order**; every handler for a path is a separate router entry.
- A request must end with a `Response` (returned or assigned to `c.res`), or dispatch reports "Context is not finalized".
- Core code must stay runtime-agnostic and dependency-free; runtime specifics belong in `src/adapter/*`.
- Every new public module needs matching entries in `package.json` (`exports`, `typesVersions`) and `jsr.json`; the build fails otherwise.
- Type behavior is part of the API: add `src/types.test.ts`/`expectTypeOf` coverage when changing types.
