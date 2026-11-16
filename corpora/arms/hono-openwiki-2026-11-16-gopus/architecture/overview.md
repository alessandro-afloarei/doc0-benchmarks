---
type: architecture
title: Architecture overview
description: How the Hono repository is laid out, which public entrypoints and subpath exports it ships, how HonoBase, Hono and the tiny/quick presets divide responsibility, and how the core subsystems relate.
tags: [architecture, entrypoints, exports, presets, overview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
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
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Architecture overview

Hono is a small web framework built on Web Standards (`Request`, `Response`, `fetch`). The `hono` package declares no runtime `dependencies` in `package.json`. All of its source is in `src/`. The same TypeScript is published two ways: compiled to `dist/` for npm (ESM, CJS and `.d.ts`), and as raw source to JSR as `@hono/hono` (see [Build and release](../operations/build-and-release.md)).

## Layered design

| Layer | Location | Responsibility |
| --- | --- | --- |
| Application core | `src/hono-base.ts` | Route registration (`get/post/.../all/on/use`), sub-app composition (`route`, `basePath`, `mount`), error and not-found handlers, and request dispatch (`fetch`, `request`, `fire`). |
| Router choice | `src/hono.ts`, `src/preset/*.ts` | Small subclasses of `HonoBase` that differ only in the router they install. |
| Middleware composition | `src/compose.ts` | A Koa-style `compose()` that runs matched handlers in order through `next()`. |
| Per-request state | `src/context.ts`, `src/request.ts` | `Context` (response building, variables, env) and `HonoRequest` (params, query, body). |
| Routing | `src/router.ts`, `src/router/*` | The `Router<T>` interface and five implementations. |
| Types | `src/types.ts`, `src/utils/types.ts` | Type-level route schema inference that feeds the RPC client. |
| Extensions | `src/middleware/*`, `src/helper/*`, `src/validator/*`, `src/jsx/*`, `src/client/*`, `src/adapter/*` | Optional modules, each published under its own subpath export. |
| Shared utilities | `src/utils/*` | URL/path parsing, body parsing, cookies, crypto, JWT, MIME, streams, HTML escaping. |

### HonoBase versus Hono versus presets

`HonoBase` is effectively abstract: it declares a `router` field but never assigns one, and a comment says subclasses must set it in their constructor. Each concrete class assigns one:

- `hono` (`src/hono.ts`) defaults to `SmartRouter` with `[RegExpRouter, TrieRouter]`, unless the caller passes `options.router`.
- `hono/tiny` (`src/preset/tiny.ts`) always uses `PatternRouter`, the smallest router, for minimal bundle size.
- `hono/quick` (`src/preset/quick.ts`) uses `SmartRouter` with `[LinearRouter, TrieRouter]`. LinearRouter has no build step, so this suits environments where the app is rebuilt for every request.

The presets ignore `options.router`. Only the default `Hono` lets the caller override the router. Both preset tests check the router through `getRouterName(app)` from `hono/dev`, which returns `'PatternRouter'` and `'SmartRouter + LinearRouter'`.

The `HonoBase` constructor copies every option except `strict` onto the instance (`Object.assign(this, optionsWithoutStrict)`). `strict: false` swaps in `getPathNoStrict`, which ignores trailing slashes. A custom `getPath` is used only while strict mode is on.

## Public surface

`src/index.ts` (the `.` export) exports only the `Hono` class, `Context`, and types (`Env`, `Handler`, `MiddlewareHandler`, `Schema`, `HonoRequest`, `InferRequestType`, `InferResponseType`, and others). Everything else lives under its own subpath, so applications bundle only what they import. `package.json` declares a subpath for each of these groups:

- core: `./hono-base`, `./request`, `./types`, `./http-exception`, `./router` and each `./router/<name>`, `./tiny`, `./quick`, and a wildcard `./utils/*`;
- each middleware: `./cors`, `./logger`, `./jwt`, `./basic-auth`, and so on;
- each helper: `./cookie`, `./factory`, `./streaming`, `./ssg`, `./ws`, `./testing`, `./proxy`, and so on;
- each adapter: `./cloudflare-workers`, `./deno`, `./bun`, `./aws-lambda`, `./lambda-edge`, `./vercel`, `./netlify`, `./service-worker`, `./cloudflare-pages`;
- JSX entrypoints: `./jsx`, `./jsx/jsx-runtime`, `./jsx/dom`, `./jsx/dom/client`, `./jsx/streaming`, and so on;
- `./client` (the `hc` RPC client) and `./validator`.

Each npm subpath maps `types` to `dist/types/...`, `import` to `dist/...js` and `require` to `dist/cjs/...js`. `typesVersions` repeats the type mapping for older TypeScript module resolution. `jsr.json` repeats the subpath map, pointing straight at `src/*.ts`.

## How the subsystems connect

```text
Runtime (Workers / Deno / Bun / Node / Lambda ...)
   │  Request (+ env bindings, execution context)
   ▼
app.fetch ──► HonoBase.#dispatch ──► router.match(method, path)
                     │                         │
                     ▼                         ▼
               new Context(req, {matchResult, env, executionCtx, notFoundHandler})
                     │
                     ▼
               compose(handlers, errorHandler, notFoundHandler)
                     │   middleware → next() → handler
                     ▼
               Context.res  ──► Response back to runtime
```

- Adapters in `src/adapter/*` convert platform events into `Request` objects, or wrap `app.fetch`. The core itself depends on no platform API. See [Runtime adapters](../integrations/runtime-adapters.md).
- Routers store `[handler, RouterRoute]` tuples. A match returns the ordered list of middleware and handlers whose paths match. See [Routers](routers.md).
- [Request lifecycle and composition](request-lifecycle.md) covers dispatch, composition and error handling.
- [Context and HonoRequest](../concepts/context-and-request.md) covers per-request APIs.
- Type inference across `app.get(...)` chains produces a `Schema`, which `hc<typeof app>()` uses. See [Type system and RPC client](../concepts/types-and-rpc-client.md).

## Repository layout beyond `src/`

| Directory | Role |
| --- | --- |
| `build/` | The esbuild-based build script, export validation, and private-field stripping for `.d.ts` output. |
| `runtime-tests/` | Per-runtime test suites (Deno, Bun, workerd, Fastly, Lambda, Lambda@Edge, Node). |
| `benchmarks/`, `perf-measures/` | Router and handler benchmarks, plus bundle-size and type-check performance measurements. |
| `docs/` | `CONTRIBUTING.md`, `MIGRATION.md`, and the code of conduct. |
