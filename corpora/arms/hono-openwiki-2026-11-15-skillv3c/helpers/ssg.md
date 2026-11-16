---
type: workflow
title: Static Site Generation (SSG)
description: How hono/ssg's toSSG renders a Hono app to static files — route enumeration from app.routes, ssgParams for dynamic routes, disableSSG/onlySSG, the request/response/generate hook pipeline and plugins, file path generation with traversal protection, concurrency, and the Bun/Deno wrappers.
tags: [helper, ssg, static-site, plugins, bun, deno]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
  - id: openwiki-source-b6e31ddca68e7ac800c3482e
    resource: repo://src/utils/handler.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Static Site Generation (SSG)

`hono/ssg` (`src/helper/ssg/`) turns an existing Hono app into files by issuing synthetic requests against it with `app.fetch`/`app.request` and writing the responses through a pluggable file system module. It is marked experimental in the runtime wrappers.

## Entry points

- `toSSG(app, fsModule, options?)` — the runtime-agnostic core in `ssg.ts`. `fsModule` implements `FileSystemModule` (`writeFile(path, string | Uint8Array)`, `mkdir(path, { recursive })`); for Node you pass something like `fs/promises`.
- `toSSG(app, options?)` from `hono/bun` — uses `bunFileSystemModule` (`Bun.write`; `mkdir` is a no-op because `Bun.write` creates directories).
- `toSSG(app, options?)` from `hono/deno` — uses `denoFileSystemModule` (Deno file APIs).

The result is `{ success, files, error? }`; failures are **returned, not thrown**.

## Pipeline

1. **Route selection** (`filterStaticGenerateRoutes`): every entry in `app.routes` with method `GET` or `ALL` whose (unwrapped) handler is not middleware. Middleware detection uses `isMiddleware` from `src/utils/handler.ts` (a handler with arity > 1, i.e. it takes `next`); `findTargetHandler` unwraps handlers wrapped by `route()` via `COMPOSED_HANDLER`.
2. **Parameter discovery:** for each route, a request to `http://localhost<route.path>` is run through the combined `beforeRequestHook` and then `app.fetch(req, { HONO_SSG_CONTEXT: true })`. The `ssgParams(params | (c) => params)` middleware, when hit on a dynamic path, attaches the parameter list to the raw request object and short-circuits with `c.notFound()`. Afterwards:
   - no `ssgParams` and the route is dynamic (a segment starting with `:` or containing `*`) → the route is skipped;
   - no `ssgParams` and static → one render with `{}`.
3. **Rendering:** for each param set, the path is filled with `replaceUrlParam` (shared with the [RPC client](../typing/rpc-client.md)) and requested with `app.request(path, { method, headers }, { HONO_SSG_CONTEXT: true })`. Responses carrying `x-hono-disable-ssg` are dropped. The combined `afterResponseHook` may replace the response or return `false` to skip it.
4. **Content and filename:** text/JSON content types are read as text, others as `ArrayBuffer`. The MIME type (default `text/plain`, matching the bare `c.text` fast path that omits a Content-Type) maps to an extension via `extensionMap` (default maps `text/html`→`html`, XML/RSS/Atom→`xml`, `application/yaml`→`yaml`) or `getExtension`, falling back to `html`. `/` becomes `index.<ext>`, paths ending in `/` become `<path>/index.<ext>`, paths already ending in `.<ext>` are kept, others get `.<ext>` appended.
5. **Writing:** `ensureWithinOutDir` normalizes both paths and throws `Path traversal detected` if the file would land outside the output dir (default `./static`). Directories are created once — tracked in a **module-level** `createdDirs` set that persists across `toSSG` calls in the same process.
6. **After generate:** `afterGenerateHook(result, fsModule, options)` hooks run with the final result, even on failure.

Discovery and rendering requests share one concurrency pool (`createPool`, default concurrency 2, option `concurrency`).

## Controlling generation from the app

`src/helper/ssg/middleware.ts`:

- `ssgParams(...)` — supplies the param sets for a dynamic route (only acts when the request path itself still looks dynamic, i.e. during discovery).
- `isSSGContext(c)` — `true` when `c.env.HONO_SSG_CONTEXT` is set.
- `disableSSG()` — during SSG, sets `x-hono-disable-ssg: true` and returns not-found, so the route is skipped; at normal runtime it passes through.
- `onlySSG()` — returns not-found outside SSG, so a route exists only in the generated output.

## Hooks and plugins

Hooks may be given as single functions or arrays; arrays are chained in order, and any hook returning `false` stops processing for that request/response. Option-level hooks run before plugin hooks.

`plugins` default to `[defaultPlugin()]`, whose `afterResponseHook` drops every non-200 response. **Passing `plugins` replaces the default**, so include `defaultPlugin()` explicitly if you still want that filtering. `redirectPlugin()` converts 301/302/303/307/308 responses with a `Location` header into a 200 HTML page with a meta refresh and canonical link (redirects without `Location` are dropped); it must run before `defaultPlugin` in the list to have an effect.

## Tests

`src/helper/ssg/ssg.test.tsx` (hooks, params, extension mapping, traversal, concurrency), `plugins.test.tsx`, and `utils.test.ts` (`joinPaths`, `isDynamicRoute`, route filtering).

See also: [Runtime Adapters](../adapters/runtime-adapters.md) and [Utility Helpers](utility-helpers.md).
