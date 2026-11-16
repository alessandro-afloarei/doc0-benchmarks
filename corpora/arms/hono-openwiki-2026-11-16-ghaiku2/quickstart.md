---
type: guide
title: Quickstart
description: Entry point for the Hono repository, covering what Hono is, how the source tree is organized, the commands to build and test it, and a task-routing map that points to the wiki page for each kind of change, from routing and middleware to JSX, adapters, the RPC client, and release automation.
tags: [hono, quickstart, overview, navigation, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Quickstart

Hono is a web framework built only on Web Standard APIs. A handler receives a `Request` and returns a `Response`, so the same app runs on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, AWS Lambda, Lambda@Edge, Netlify, service workers, and Node.js. This repository is the framework itself: the published packages `hono` on npm and `@hono/hono` on JSR are built from `src/`.

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Use this page to find the right part of the wiki. Start with [Architecture Overview](/openwiki/architecture/overview.md) if you have not read the code before.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | The framework source: the core dispatcher, routers, middleware, helpers, JSX, the validator, the RPC client, and runtime adapters. |
| `build/` | The build script, export validation, and the private-field remover used for declaration output. |
| `runtime-tests/` | Platform test suites for Node, workerd, Fastly, Lambda, Lambda@Edge, Bun, Deno, and Deno JSX. |
| `benchmarks/` | Separate projects that compare routers, JSX rendering, and HTTP throughput. |
| `perf-measures/` | Type-level and bundle-size checks for the public surface. |
| `docs/` | Contributor documentation, migration notes, and images. |
| `openwiki/` | This generated wiki. Do not edit these pages by hand. |
| `.github/workflows/` | CI, autofix, pkg.pr.new previews, release, stale-issue cleanup, and the scheduled OpenWiki update. |
| `package.json`, `jsr.json` | Export maps for npm and JSR. They must stay in sync. |

## Commands

Install dependencies with Bun, which the repository pins through `bun.lock`, then use the scripts in `package.json`:

<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `bun run build`: removes `dist/`, compiles ESM and CommonJS with esbuild, emits declarations, and strips `#private` fields from them. See [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md).
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `bun run test`: type-checks the spec configuration, then runs the main Vitest project. Runtime projects are run with `test:node`, `test:workerd`, `test:fastly`, `test:lambda`, `test:lambda-edge`, `test:bun`, and `test:deno`. See [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md).
- `bun run lint` and `bun run format`: ESLint and Prettier checks over `src`, `runtime-tests`, `build`, `benchmarks`, and `perf-measures`.

## How a request flows

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A platform adapter turns its event into a `Request` and calls `app.fetch`. `#dispatch` resolves the path, matches it through the router, builds a `Context`, and runs the handler chain with `compose`. Errors go to the error handler, and a missing response goes to the not-found handler. The full trace is in [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md).

## Task routing

Use this table to choose a page for the kind of change you are making.

| If you are working on | Read first | Then |
| --- | --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The overall structure, presets, or export map | [Architecture Overview](/openwiki/architecture/overview.md) | [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| How a request is dispatched, or how `fetch`, `request`, `route`, `mount`, or `basePath` behave | [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md) | [Middleware Model and Composition](/openwiki/architecture/middleware-model.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Route matching, router choice, or router performance | [Routing and Router Implementations](/openwiki/architecture/routing.md) | [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `c` (Context) or `c.req` (HonoRequest) | [Context and HonoRequest](/openwiki/architecture/context-and-request.md) | [Validator Middleware and Input Types](/openwiki/validation/validator.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `app.use`, `next()`, or error propagation | [Middleware Model and Composition](/openwiki/architecture/middleware-model.md) | [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md) |
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| A built-in middleware such as CORS, CSRF, JWT, compression, or logging | [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md) | [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md) |
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Input validation or `c.req.valid()` | [Validator Middleware and Input Types](/openwiki/validation/validator.md) | [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md) |
<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The typed `hc` client | [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md) | [Validator Middleware and Input Types](/openwiki/validation/validator.md) |
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Server-side JSX, HTML output, streaming, or `jsxRenderer` | [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md) | [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md) |
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Client-side JSX, hooks, or `createRoot` | [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md) | [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md) |
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| A runtime adapter such as Lambda, Cloudflare, Deno, Bun, Vercel, or Netlify | [Runtime Adapters](/openwiki/adapters/runtime-adapters.md) | [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md) |
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Helpers such as cookies, SSG, streaming, proxy, factory, or `testClient` | [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md) | [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md) |
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The build, declarations, or exports | [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md) | [Architecture Overview](/openwiki/architecture/overview.md) |
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-automation.md] link "/openwiki/operations/ci-and-automation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Tests, runtime suites, or benchmarks | [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md) | [CI, Automation, and OpenWiki Maintenance](/openwiki/operations/ci-and-automation.md) |
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-automation.md] link "/openwiki/operations/ci-and-automation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| CI, releases, or the wiki update workflow | [CI, Automation, and OpenWiki Maintenance](/openwiki/operations/ci-and-automation.md) | [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md) |

## Conventions to keep in mind

- Public subpaths are declared in both `package.json` and `jsr.json`. Adding one means changing both.
- Core code uses Web Standard globals. Node-only modules belong in middleware or adapters, not in `src/hono-base.ts`, `src/context.ts`, `src/request.ts`, or `src/compose.ts`.
- Tests sit next to the code they cover. Runtime-specific behaviour is tested in `runtime-tests/`.
- The wiki under `openwiki/` is generated. Update the source or the contributor docs, and let the scheduled OpenWiki update regenerate the pages.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Routing and Router Implementations](/openwiki/architecture/routing.md)
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Context and HonoRequest](/openwiki/architecture/context-and-request.md)
<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Validator Middleware and Input Types](/openwiki/validation/validator.md)
<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md)
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md)
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md)
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime Adapters](/openwiki/adapters/runtime-adapters.md)
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md)
<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md)
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-automation.md] link "/openwiki/operations/ci-and-automation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CI, Automation, and OpenWiki Maintenance](/openwiki/operations/ci-and-automation.md)
