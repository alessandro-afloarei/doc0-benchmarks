---
type: concept
title: Architecture Overview
description: Layered architecture of the Hono framework package - the HonoBase core, the per-preset Hono classes and their routers, the Context and HonoRequest objects, middleware composition, the validator, the typed client, JSX, helpers, and runtime adapters - and how these layers depend on one another.
tags: [architecture, core, routing, middleware, hono-base, presets, overview]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Architecture Overview

This repository is the `hono` npm and JSR package (version 4.12.30, see `package.json`). It is a single library, not a monorepo of services: every public feature is a module under `src/` that is compiled into its own entry point. The framework is built on Web Standards, so the central contract is a function from `Request` to `Response` that works unchanged on Cloudflare Workers, Deno, Bun, Node.js, AWS Lambda, and other runtimes.

## Layers

The source tree is best understood as five layers. The core modules (`hono-base.ts`, `compose.ts`, `context.ts`, `request.ts`, `router.ts`) do not import presets, middleware, helpers, or adapters.

1. **Core dispatch (`src/hono-base.ts`, `src/compose.ts`, `src/router.ts`).** `HonoBase` holds the route table, the `router` instance, the `getPath` strategy, the error and not-found handlers, and the public `fetch`, `request`, and `fire` entrypoints. `compose` implements the `next()` chain. `router.ts` defines the `Router` interface and the matching result shape.
<!-- openwiki: broken internal link [/openwiki/routing/router-selection.md] link "/openwiki/routing/router-selection.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Presets (`src/hono.ts`, `src/preset/tiny.ts`, `src/preset/quick.ts`).** Each preset extends `HonoBase` and installs a concrete router. The default export `Hono` uses a `SmartRouter` over `RegExpRouter` and `TrieRouter`; `quick` uses `LinearRouter` and `TrieRouter`; `tiny` uses only `PatternRouter`. Routing internals are covered in [Router Selection and Matching](/openwiki/routing/router-selection.md).
<!-- openwiki: broken internal link [/openwiki/core/context-and-request.md] link "/openwiki/core/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **Per-request objects (`src/context.ts`, `src/request.ts`).** `Context` is created for every dispatch and exposes response builders, headers, status, variables, and rendering. `HonoRequest` wraps the native `Request` with cached parameter, query, header, and body access. Both are described in [Context and HonoRequest](/openwiki/core/context-and-request.md).
4. **Cross-cutting features.** `src/middleware/*` (first-party middleware), `src/validator/*` (schema-driven input validation), `src/client/*` (typed RPC client), and `src/helper/*` (helpers such as `factory`, `testing`, `streaming`, `ssg`, `websocket`) build on layers 1 through 3 through the public types in `src/types.ts`.
5. **Rendering and platform (`src/jsx/*`, `src/adapter/*`).** JSX produces HTML strings or DOM trees and is independent of routing. Adapters translate platform events into `Request` objects and call `app.fetch`.

`src/index.ts` is the root entry: it re-exports `Hono` and selected types for `import { Hono } from 'hono'`. Every other public module is reached through its own subpath export, listed in `package.json` and mirrored in `jsr.json`.

## Central Mechanisms

- **Route table and router.** Calling `get`, `post`, `use`, and the other registration methods writes each route into both `this.routes` and `this.router` through a single private `#addRoute` path, which merges the base path first. The router is not consulted until dispatch.
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Matching then composition.** On each request, `#dispatch` resolves the path, asks `this.router.match(method, path)` for handlers, and creates a `Context`. If exactly one handler matched, it is invoked directly; otherwise the handlers are run through `compose`. Details are in [Request Lifecycle](/openwiki/architecture/request-lifecycle.md).
- **Errors and not-found.** Errors thrown by handlers are routed to `onError`, and missing responses fall through to `notFound`. `HTTPException` responses are converted by the default error handler.
- **Typed surface.** Much of the framework's value is in TypeScript generics. Route paths, schemas, and environment bindings are threaded through `Hono<E, S, BasePath>` so that the validator, the RPC client, and JSX typing can infer request and response shapes. The shared type definitions live in `src/types.ts`, which is large because it encodes these relationships.

## Dependency Direction

- `hono-base.ts` depends on `compose`, `context`, `router`, `utils/url`, and `utils/constants`. It does not depend on any preset, adapter, middleware, or helper.
- Presets depend on `hono-base.ts` and concrete routers. Routers depend only on `router.ts` and small utilities.
- Most middleware and helpers depend only on `Context`, `HonoRequest`, and the types in `types.ts`, so they work with any preset or with `HonoBase` directly (see the `hono/hono-base` export). A few are exceptions: `helper/factory` imports the `Hono` class as a value, while `middleware/method-override` and `helper/dev` import it as a type, and `middleware/jwt` and `middleware/ip-restriction` import types from the package root.
- Adapters depend on the `Hono` class type and the `app.fetch` contract. They do not touch routing internals.

## Why The Layering Matters For Changes

<!-- openwiki: broken internal link [/openwiki/operations/build-and-packaging.md] link "/openwiki/operations/build-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A change to routing semantics belongs in `hono-base.ts` or the router implementations and affects every preset. A change to request parsing belongs in `request.ts`. A new runtime belongs under `src/adapter/` and does not require core edits. A new middleware is a self-contained directory under `src/middleware/` plus a subpath export. See [Build and Packaging](/openwiki/operations/build-and-packaging.md) for how each module becomes a published entry point.
