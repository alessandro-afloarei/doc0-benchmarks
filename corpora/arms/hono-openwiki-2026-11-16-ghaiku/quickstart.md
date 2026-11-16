---
type: guide
title: Quickstart
description: Task-routing map for the Hono repository - what the package is, the source layout and entry points, and which wiki page to read for a given kind of change or question, such as routing, middleware, validation, the RPC client, JSX, runtime adapters, helpers, or the build and test pipeline.
tags: [quickstart, overview, navigation, hono, repository-map]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-ee4abdb060687ffe0c7744f7
    resource: repo://jsr.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Quickstart

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
This repository is the source of the `hono` package: a web framework built on Web Standards that runs on Cloudflare Workers, Deno, Bun, Node.js, AWS Lambda, Lambda@Edge, Vercel, Netlify, Fastly Compute, and service workers. The published package is `hono` on npm and `@hono/hono` on JSR. Its public surface is the set of subpath modules listed in `package.json`, and every one of them is built from a file under `src/`. Start with [Architecture Overview](/openwiki/architecture/overview.md) for the layering, then use the routing table below.

## Repository Layout

- `src/hono-base.ts`, `src/compose.ts`, `src/router.ts`: the core dispatch, middleware chain, and router contract.
- `src/hono.ts`, `src/preset/`: the default `Hono` class and the `tiny` and `quick` presets, which choose routers.
- `src/router/`: the five router implementations.
- `src/context.ts`, `src/request.ts`: the per-request `Context` and `HonoRequest`.
- `src/middleware/`: first-party middleware, one directory per feature.
- `src/helper/`: helpers such as `factory`, `testing`, `streaming`, `ssg`, `websocket`, `cookie`, and `proxy`.
- `src/validator/`, `src/client/`: input validation and the typed RPC client (`hc`).
- `src/jsx/`: server JSX (`src/jsx/*`) and the client DOM runtime (`src/jsx/dom/`).
- `src/adapter/`: runtime adapters.
- `src/utils/`: shared utilities, including JWT, cookies, body parsing, and encodings.
- `build/`: the build script, export validation, and private-field stripping.
- `runtime-tests/`, `benchmarks/`, `perf-measures/`: the platform test matrix, benchmarks, and performance checks.
- `docs/`: contributing guide and migration notes.

## Where To Go For A Change

| If you are changing... | Read first | Then look at |
| --- | --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| How requests are dispatched, the not-found path, or error flow | [Request Lifecycle](/openwiki/architecture/request-lifecycle.md) | [Middleware Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md) |
<!-- openwiki: broken internal link [/openwiki/routing/route-registration.md] link "/openwiki/routing/route-registration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Route registration, `route()`, `basePath()`, `mount()`, or strict mode | [Route Registration, Grouping and Mounting](/openwiki/routing/route-registration.md) | [Router Selection and Matching](/openwiki/routing/router-selection.md) |
<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| A router implementation or preset router chain | [Router Selection and Matching](/openwiki/routing/router-selection.md) | [Architecture Overview](/openwiki/architecture/overview.md) |
<!-- openwiki: broken internal link [/openwiki/core/context-and-request.md] link "/openwiki/core/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/utils/crypto-jwt-and-encoding.md] link "/openwiki/utils/crypto-jwt-and-encoding.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `c.json`, `c.text`, `c.header`, `c.req.param`, body parsing, or variables | [Context and HonoRequest](/openwiki/core/context-and-request.md) | [Crypto, JWT and Encoding Utilities](/openwiki/utils/crypto-jwt-and-encoding.md) |
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/client/typed-rpc-client.md] link "/openwiki/client/typed-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Input validation, `c.req.valid`, or typed responses | [Validator and Typed Inputs](/openwiki/validation/validator.md) | [Typed RPC Client (hc)](/openwiki/client/typed-rpc-client.md) |
<!-- openwiki: broken internal link [/openwiki/client/typed-rpc-client.md] link "/openwiki/client/typed-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The typed client (`hono/client`) | [Typed RPC Client (hc)](/openwiki/client/typed-rpc-client.md) | [Validator and Typed Inputs](/openwiki/validation/validator.md) |
<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/composition-and-error-handling.md] link "/openwiki/middleware/composition-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| An existing middleware or a new one | [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md) | [Composition and Error Handling](/openwiki/middleware/composition-and-error-handling.md) |
<!-- openwiki: broken internal link [/openwiki/utils/crypto-jwt-and-encoding.md] link "/openwiki/utils/crypto-jwt-and-encoding.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/middleware/built-in-middleware.md] link "/openwiki/middleware/built-in-middleware.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| JWT, JWK, signed cookies, or timing-safe comparison | [Crypto, JWT and Encoding Utilities](/openwiki/utils/crypto-jwt-and-encoding.md) | [Built-in Middleware Catalog](/openwiki/middleware/built-in-middleware.md) |
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Server-side JSX, layouts, or streaming HTML | [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md) | [Helper Modules](/openwiki/helpers/helper-modules.md) |
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The client-side DOM renderer (`hono/jsx/dom`) | [Client-side JSX DOM Runtime](/openwiki/jsx/dom-runtime.md) | [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md) |
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| A runtime adapter or a new platform | [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md) | [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md) |
<!-- openwiki: broken internal link [/openwiki/helpers/static-site-generation.md] link "/openwiki/helpers/static-site-generation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Static site generation | [Static Site Generation (SSG) Helper](/openwiki/helpers/static-site-generation.md) | [Runtime Adapters and Platform Entrypoints](/openwiki/adapters/runtime-adapters.md) |
<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Other helpers (streaming, WebSocket, proxy, cookies, `testClient`, `css`/`html`) | [Helper Modules](/openwiki/helpers/helper-modules.md) | - |
<!-- openwiki: broken internal link [/openwiki/operations/build-and-packaging.md] link "/openwiki/operations/build-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| The package exports, the build, or publishing | [Build and Packaging](/openwiki/operations/build-and-packaging.md) | [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md) |
<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/operations/build-and-packaging.md] link "/openwiki/operations/build-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Tests, CI, lint, or benchmarks | [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md) | [Build and Packaging](/openwiki/operations/build-and-packaging.md) |

## Working Conventions

- Install dependencies with Bun, using `bun install --frozen-lockfile`. The contributing guide asks for `bun run test` to pass before a pull request.
- Every feature module has colocated `*.test.ts` or `*.test.tsx` files beside it. Start a change by finding the nearest existing test.
- A new public module needs a subpath export in both `package.json` and `jsr.json`. The build validates that the two maps agree.
- Third-party middleware is not part of this repository. The contributing guide directs it to the separate `honojs/middleware` project.
- The repository's `openwiki/` directory is generated from source. Prefer editing source code or documentation and letting the wiki regenerate, rather than editing wiki pages by hand.

## Common Commands

- `bun run test`: type-check the test sources, then run Vitest on the main and JSX projects.
- `bun run build`: produce `dist/` (ESM, CommonJS, and declarations) and validate the export maps.
- `bun run lint`, `bun run format`: run ESLint and Prettier over the source, runtime, build, performance, and benchmark directories.
- `bun run test:all`: run the main tests and the Deno and Bun runtime suites. Other platforms are run with the matching `test:*` script after `bun run build`.
