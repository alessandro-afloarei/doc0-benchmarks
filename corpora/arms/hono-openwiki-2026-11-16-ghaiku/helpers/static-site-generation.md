---
type: workflow
title: Static Site Generation (SSG) Helper
description: How the ssg helper turns a Hono application into static files - route discovery for static GET routes, ssgParams expansion for dynamic routes, requests dispatched in an SSG context, the before-request, after-response and after-generate hook pipeline with the default and redirect plugins, bounded concurrency, and the file-system adapter contract with path containment.
tags: [ssg, static-generation, plugins, hooks, file-system, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Static Site Generation (SSG) Helper

<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The `ssg` helper (`src/helper/ssg/`) runs an application in-process, requests each static route, and writes the responses to a directory. It is the mechanism behind the `toSSG` exports of the Bun and Deno adapters (see [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md)). The core of the feature is `toSSG(app, fileSystemModule, options)` in `src/helper/ssg/ssg.ts`. Routing and dispatch behavior it relies on are described in [Request Lifecycle](/openwiki/architecture/request-lifecycle.md).

## Inputs and Outputs

`toSSG` takes three arguments:

- **`app`**, a `Hono` instance whose routes are inspected and then requested.
- **`fs`**, a `FileSystemModule` with two methods, `writeFile(path, data)` and `mkdir(path, { recursive })`. Adapters supply one (`bunFileSystemModule`, `denoFileSystemModule`); tests can supply an in-memory one.
- **`options`** (`ToSSGOptions`), with `dir` (default `./static`), `concurrency` (default 2), `extensionMap`, `plugins`, and the hook options described below.

It resolves to `{ success, files, error? }`. On success `files` lists every file written; on failure `error` is set and `files` is empty. Content is handed to the file-system module as each route's responses are produced, and the result is assembled after all writes settle; the first write error becomes the failure.

## Route Discovery

`filterStaticGenerateRoutes(app)` selects routes whose method is `GET` or `ALL` and whose handler is not middleware. The handler's identity is resolved through `findTargetHandler`, so middleware is excluded even when wrapped. Routes with `:param` or `*` segments are kept in the list but cannot be fetched directly, which is why they require `ssgParams` (below).

## Dynamic Routes and `ssgParams`

For a path containing a parameter or wildcard, `ssgParams(params)` is a middleware that stores the parameter list on the request and then returns `c.notFound()`, which stops the handler from running during generation. `params` may be an array of objects or a function receiving the context. During generation, each parameter object is substituted into the route path and the resulting URL is requested. When a dynamic route has no `ssgParams`, generation uses a single empty parameter object, so the request is made against the route pattern as written.

## Request Dispatch in an SSG Context

Each requested route is dispatched with the binding `HONO_SSG_CONTEXT: true` (exported as `SSG_CONTEXT`). Application code can detect the context with `isSSGContext(c)`, and two experimental middleware helpers use that flag:

- **`disableSSG()`** returns `404` in SSG runs and sets the `x-hono-disable-ssg` response header, which tells the generator to skip the route.
- **`onlySSG()`** returns `404` outside SSG runs, so a route can be generated without being served at runtime.

## Hook Pipeline and Plugins

Three hook kinds shape the pipeline. Each accepts a single function or an array:

- **`beforeRequestHook(req)`** may return a replacement request or `false` to skip the route. It runs only for the route request that discovers `ssgParams`; per-parameter requests are not passed through it.
- **`afterResponseHook(res)`** may return a replacement response or `false` to drop the response. It runs for every response: the route request and each parameterized request. Responses that carry the `x-hono-disable-ssg` header are skipped before the hook runs.
- **`afterGenerateHook`** runs once after the generation attempt, with the aggregated result, the file-system module, and the options.

Hooks from `options` run first, followed by hooks from each plugin in order. The top-level `beforeRequestHook` and `afterResponseHook` options are deprecated in favor of the same fields on plugins. The before and after response hooks are combined into a single function that threads the request or response through each hook in sequence and stops as soon as one returns `false`.

Two plugins ship with the helper:

- **`defaultPlugin()`** (used when no plugins are given) keeps only responses with status `200` and drops every other response, so redirects, errors, and not-found responses produce no file.
- **`redirectPlugin()`** converts `301`, `302`, `303`, `307`, and `308` responses that have a `Location` header into a `200 text/html` page with a meta refresh and canonical link to the target. Without a `Location` header the response is dropped.

Because `defaultPlugin` is used only when `plugins` is omitted, passing `plugins: [redirectPlugin()]` alone removes the status-200 filter. Include `defaultPlugin()` explicitly alongside other plugins when both behaviors are wanted.

## File Writing

`saveContentToFile` converts the route path to a file path:

- A path that already ends with the MIME-derived extension is used as written.
- `/` becomes `index.<ext>`, and a path ending in `/` becomes `<path>/index.<ext>`.
- Any other path becomes `<path>.<ext>`.

The extension comes from the response's `Content-Type` through `defaultExtensionMap` (overridable with `extensionMap`). `ensureWithinOutDir` joins the path against `/` and rejects results that escape the output directory, so route paths cannot write outside `dir`. Directories are created with `mkdir(..., { recursive: true })` once per directory.

Response bodies are read as text when the content type contains `text` or `json`, and as an `ArrayBuffer` otherwise.

## Concurrency

Route info requests and per-parameter requests share a pool created by `createPool({ concurrency })` from `src/utils/concurrent.ts`, so at most `concurrency` requests are in flight at a time. Writes are queued after each route's content is produced.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/helper/ssg/ssg.test.tsx`, `plugins.test.tsx`, and `utils.test.ts` cover the pipeline, the plugins, and the path helpers. Commands are listed in [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md).
