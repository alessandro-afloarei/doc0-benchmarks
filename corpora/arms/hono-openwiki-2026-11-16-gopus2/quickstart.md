---
type: guide
title: Quickstart
description: Contributor orientation for the Hono repository — what the framework is, how the source tree is organised, the commands to install, build and test, contribution rules, and a task-routing map into the rest of this wiki.
tags: [quickstart, onboarding, overview, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Quickstart

**Hono** is a small, zero-dependency web framework built on Web Standards. One app object exposes `fetch(request, env, executionCtx)` and runs unchanged on Cloudflare Workers, Fastly Compute, Deno, Bun, AWS Lambda, Lambda@Edge, Vercel, Netlify and Node.js (through `@hono/node-server`). This repository is the core `hono` npm package (also published as `@hono/hono` on JSR). Third-party middleware lives in the separate `honojs/middleware` monorepo.

```ts
import { Hono } from 'hono'
const app = new Hono()
app.get('/', (c) => c.text('Hono!'))
export default app
```

## Repository layout

| Path | Contents |
| --- | --- |
| `src/hono-base.ts`, `src/hono.ts`, `src/preset/` | Application class and presets (`hono`, `hono/quick`, `hono/tiny`) |
| `src/compose.ts`, `src/context.ts`, `src/request.ts`, `src/http-exception.ts` | Middleware composition, per-request Context/HonoRequest, errors |
| `src/router.ts`, `src/router/` | Router interface and the five router implementations |
| `src/types.ts`, `src/client/` | Type-level route schema and the `hc` RPC client |
| `src/validator/` | `validator()` middleware |
| `src/middleware/` | Built-in middleware, one directory per `hono/<name>` export |
| `src/helper/` | Helpers (cookie, streaming, ssg, websocket, factory, testing, proxy, …) |
| `src/jsx/` | Server JSX renderer, streaming/Suspense, client DOM renderer and hooks |
| `src/adapter/` | Platform adapters (aws-lambda, cloudflare-*, bun, deno, vercel, netlify, …) |
| `src/utils/` | Shared utilities (URL parsing, cookies, crypto, JWT, MIME, html escaping, …) |
| `runtime-tests/` | Tests that run on each target runtime |
| `build/` | Build script, export-map validation, `.d.ts` private-field stripping |
| `perf-measures/`, `benchmarks/` | Bundle size and type-check measurement, router/JSX/HTTP benchmarks |
| `docs/` | `CONTRIBUTING.md`, `MIGRATION.md` |

## Everyday commands

The project uses **Bun** as its package manager:

```bash
bun install --frozen-lockfile   # install
bun run test                    # tsc type-check of src + all Vitest projects (required for PRs)
npx vitest --run src/context.test.ts   # focused test
bun run test:deno && bun run test:bun  # Deno / Bun runtime suites
bun run lint && bun run format         # eslint + prettier check (lint:fix / format:fix to fix)
bun run build                          # dist/ (ESM, CJS, types) + export validation
```

## Contribution rules worth knowing

- PRs must pass `bun run test`. CI additionally runs format, lint, editorconfig, the build, every runtime suite, and bundle-size and type-check performance comparisons.
- `docs/CONTRIBUTING.md` has an **AI usage policy**. AI-assisted contributions must not waste maintainers' time, and maintainers may close PRs that violate it.
- New public modules must be registered in **both** `package.json` (`exports` and `typesVersions`) and `jsr.json`. The build fails if the two export maps disagree.
- Keep runtime-specific APIs inside `src/adapter/*`. The rest of the code uses Web Standards only.

## Where to go next

| If you need to… | Read |
| --- | --- |
| Understand the module map and presets | [Architecture Overview](./architecture/overview.md) |
| Trace a request, middleware order, errors, `route`/`basePath`/`mount` | [Request Lifecycle and Composition](./architecture/request-lifecycle.md) |
| Work on `c.*` response helpers, variables, `c.req` body/params | [Context and HonoRequest](./architecture/context-and-request.md) |
| Change route matching or add a router | [Routers](./routing/routers.md) |
| Touch route type inference or the `hc` client | [Type System and RPC Client](./concepts/types-and-rpc-client.md) |
| Change request validation | [Validation](./concepts/validation.md) |
| Add or fix general middleware (compress, etag, cache, serve-static, …) | [Built-in Middleware](./middleware/built-in-middleware.md) |
| Work on auth, JWT/JWK, CSRF, CORS, secure headers, IP rules | [Authentication and Security Middleware](./middleware/security-middleware.md) |
| Use or change cookie, streaming, SSG, WebSocket, proxy, factory helpers | [Helpers](./helpers/helpers.md) |
| Work on JSX rendering, Suspense streaming, or `hono/jsx/dom` | [JSX Runtime](./jsx/jsx-runtime.md) |
| Support a platform or change an adapter | [Runtime Adapters](./integrations/runtime-adapters.md) |
| Build, package, CI, performance checks, releases | [Build, Packaging and Release](./operations/build-and-release.md) |
| Decide where and how to test a change | [Testing Strategy](./testing/testing-strategy.md) |
