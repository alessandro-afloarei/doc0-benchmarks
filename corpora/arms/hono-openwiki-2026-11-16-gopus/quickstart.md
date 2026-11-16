---
type: quickstart
title: Quickstart
description: Orientation for the Hono repository — what the framework is, the toolchain and everyday commands for installing, building, testing and linting, a map of the source tree, and a task-routing table pointing to the wiki page to read for each kind of change.
tags: [quickstart, onboarding, overview, commands, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-d6962701329196861d6a8f70
    resource: repo://.tool-versions
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Quickstart

Hono is a small, fast web framework built on Web Standards (`Request`, `Response`, `fetch`). The same app code runs on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, Netlify, AWS Lambda, Lambda@Edge and Node.js. The npm package `hono` has no runtime dependencies. The same source is also published to JSR as `@hono/hono`.

```ts
import { Hono } from 'hono'
const app = new Hono()
app.get('/', (c) => c.text('Hono!'))
export default app
```

## Toolchain and commands

`.tool-versions` pins Node 24.7.0, Bun 1.2.19 and Deno 2.4.5. The package manager is Bun (`packageManager: bun@1.2.20`).

| Task | Command |
| --- | --- |
| Install | `bun install --frozen-lockfile` |
| Unit tests and type tests | `bun run test` (runs `tsc -p tsconfig.spec.json`, then `vitest --run`) |
| A single runtime suite | `bun run test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge`, `test:deno`, `test:bun` |
| Everything | `bun run test:all` |
| Build `dist/` | `bun run build` (esbuild ESM and CJS, plus `tsc` declarations, then `publint`) |
| Lint and format | `bun run lint`, `bun run format` (append `:fix` to apply fixes) |

`bun run test` must pass before a PR is opened (`docs/CONTRIBUTING.md`). CI additionally runs format, lint, editorconfig, build, a JSR dry run, and every runtime suite.

## Source map

```text
src/
  index.ts, hono.ts, hono-base.ts   app classes; HonoBase holds registration and dispatch
  preset/tiny.ts, preset/quick.ts   router presets
  compose.ts                        middleware chaining
  context.ts, request.ts            per-request Context and HonoRequest
  router.ts, router/*               Router interface and five implementations
  types.ts                          type-level schema inference
  client/                           hc RPC client
  validator/                        validator() middleware
  middleware/*                      bundled middleware (one subpath export each)
  helper/*                          helpers: cookie, streaming, ssg, factory, ws, ...
  adapter/*                         per-runtime adapters
  jsx/                              JSX server renderer, streaming, DOM renderer, hooks
  utils/*                           URL, body, cookie, crypto, JWT, MIME, HTML escaping
build/            build script, export validation, .d.ts private-field stripping
runtime-tests/    per-runtime integration suites
benchmarks/, perf-measures/   speed, bundle-size and type-check guards
```

## Where to go for a task

| If you need to… | Read |
| --- | --- |
| Understand the overall structure, the subpath exports, or the presets | [Architecture overview](architecture/overview.md) |
| Change how requests are dispatched or how errors and 404s are handled, or work on `route()`, `basePath()` or `mount()` | [Request lifecycle and composition](architecture/request-lifecycle.md) |
| Fix routing, add path syntax, or choose a router | [Routers](architecture/routers.md) |
| Change response helpers, header merging, variables, params or body parsing | [Context and HonoRequest](concepts/context-and-request.md) |
| Touch `types.ts`, schema inference, or the `hc` client | [Type system and RPC client](concepts/types-and-rpc-client.md) |
| Work on request validation | [Validation](concepts/validation.md) |
| Add or modify general middleware (compress, etag, cache, logger, timeout, combine, …) | [Built-in middleware](middleware/built-in-middleware.md) |
| Work on auth, JWT/JWK, CORS, CSRF, secure headers or IP restriction | [Security and authentication middleware](middleware/security-middleware.md) |
| Work on cookies, streaming/SSE, proxy, SSG, factory, testing or dev helpers, or CSS | [Helpers](helpers/helpers.md) |
| Change JSX rendering, Suspense or streaming, or the DOM renderer and hooks | [JSX engine](jsx/jsx.md) |
| Support or fix a runtime (Workers, Deno, Bun, Lambda, …), or work on `serveStatic`, `getConnInfo` or WebSockets | [Runtime adapters](integrations/runtime-adapters.md) |
| Add a new subpath export, or change the build or the release | [Build and release](operations/build-and-release.md) |
| Add tests, run runtime suites, or check benchmarks | [Testing strategy](testing/test-strategy.md) |

## Key invariants to keep in mind

- `HonoBase` is router-agnostic. Each concrete class (`Hono`, `hono/tiny`, `hono/quick`) installs its own router.
- Handlers and middleware are all router entries, and they run in registration order through `compose()`. A chain that never produces a response triggers a "Context is not finalized" error.
- Middleware signals failure by throwing `HTTPException`, and the default error handler returns its response.
- Every new public module needs entries in **both** `package.json` and `jsr.json` exports. The build checks this.
- Type-level behavior is tested. `tsc -p tsconfig.spec.json` is part of `bun run test`.
