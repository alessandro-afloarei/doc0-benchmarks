---
type: architecture
title: Architecture Overview
description: Layered map of the Hono codebase, from the HonoBase core and preset classes through routers, Context and HonoRequest, middleware, validator, RPC client, JSX, helpers, and runtime adapters, with the package export surface that exposes each layer.
tags: [hono, architecture, overview, presets, exports, web-standards]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-bff47649fad76ae9631516a7
    resource: repo://src/compose.ts
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-26f3dbc8c3bec492e1a3c1e9
    resource: repo://src/middleware/context-storage/index.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Architecture Overview

Hono is a web framework built only on Web Standard APIs: a handler receives a `Request` and returns a `Response`. The published package (`hono` on npm, `@hono/hono` on JSR) exposes around 75 subpath exports, but most of them are thin entry points over a small core. This page maps the layers so you can find the right source directory for a change. Entry points and exports are defined in `package.json` and mirrored in `jsr.json`.

## Layers

From the inside out:

1. **Core dispatcher: `HonoBase`** (`src/hono-base.ts`). The `HonoBase` class owns route registration (`get`, `post`, `use`, `on`, `route`, `basePath`, `mount`), the `fetch` entry point, error and not-found handler slots, and the private `#dispatch` method. It holds a `router` field but does not choose one; subclasses do.
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Compose and per-request state** (`src/compose.ts`, `src/context.ts`, `src/request.ts`). `compose` runs the matched handler chain with `next()`. `Context` (`c`) carries the request, response, variables, and environment. `HonoRequest` (`c.req`) reads params, query, headers, and bodies. See [Context and HonoRequest](/openwiki/architecture/context-and-request.md).
<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **Routers** (`src/router.ts`, `src/router/*`). Four concrete matchers (`LinearRouter`, `TrieRouter`, `RegExpRouter`, `PatternRouter`) plus `SmartRouter`, which chooses the first one that accepts every registered route. See [Routing and Router Implementations](/openwiki/architecture/routing.md).
4. **Presets** (`src/hono.ts`, `src/preset/tiny.ts`, `src/preset/quick.ts`). Each preset is a `Hono` subclass that only sets the router:
   - `hono` (default, `src/hono.ts`): `SmartRouter` with `RegExpRouter` then `TrieRouter`, unless a `router` option is passed.
   - `hono/quick` (`src/preset/quick.ts`): `SmartRouter` with `LinearRouter` then `TrieRouter`.
   - `hono/tiny` (`src/preset/tiny.ts`): a single `PatternRouter`.
   The presets exist so that bundles can drop routers they do not need.
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/helpers/helper-catalog.md] link "/openwiki/helpers/helper-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **Middleware and helpers** (`src/middleware/*`, `src/helper/*`). Middleware is ordinary handlers registered with `app.use`. Helpers such as `streaming`, `ssg`, `cookie`, `factory`, and `testing` are used by applications directly. See [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md) and [Helper Modules Catalog](/openwiki/helpers/helper-catalog.md).
<!-- openwiki: broken internal link [/openwiki/validation/validator.md] link "/openwiki/validation/validator.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
6. **Validation and typed clients** (`src/validator/*`, `src/client/*`). The `validator` middleware parses input and stores typed output on the request. `hc` builds a typed fetch client from an app's route types. See [Validator Middleware and Input Types](/openwiki/validation/validator.md) and [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md).
<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
7. **JSX** (`src/jsx/*`). A JSX runtime for server HTML (`hono/jsx`), a DOM runtime (`hono/jsx/dom`), and the `jsx-renderer` middleware. See [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md) and [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md).
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
8. **Runtime adapters** (`src/adapter/*`). Translate platform events (Lambda, Cloudflare, Deno, Bun, Vercel, Netlify, service workers) into `Request` and `Response` objects and back. See [Runtime Adapters](/openwiki/adapters/runtime-adapters.md).

## Package surface

`package.json` maps each public subpath to `dist/...` for ESM (`import`), CommonJS (`require` through `dist/cjs/...`), and types. `jsr.json` maps the same names to `src/*.ts` sources. Examples:

- `.` → `src/index.ts`, which re-exports `Hono`, `Context`, and the shared type surface.
- `./request`, `./types`, `./hono-base` → the request class, shared types, and the bare core, for custom presets.
- `./tiny`, `./quick` → the preset classes.
- `./jsx`, `./jsx/dom`, `./jsx-renderer` → JSX runtime and renderer entry points.
- `./router/*` → individual routers for direct use or custom `router` options.
- `./adapter/...` names such as `./aws-lambda`, `./cloudflare-workers`, and `./bun` → runtime adapters.
- `./utils/*` → low-level helpers such as `url`, `html`, and `jwt`.

<!-- openwiki: broken internal link [/openwiki/build-and-release/build-pipeline.md] link "/openwiki/build-and-release/build-pipeline.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The build step checks that the two export maps agree (see [Build, Exports, and Release Pipeline](/openwiki/build-and-release/build-pipeline.md)).

## Request path at a glance

```
platform event ──(adapter)──▶ Request ──▶ app.fetch ──▶ #dispatch
                                             │
                    getPath → router.match → Context(c)
                                             │
                     compose(handlers) ── middleware / route handlers
                                             │
                  Response (c.res) ◀── finalize / onError / notFound
```

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The detailed flow, including the single-handler fast path and HEAD handling, is in [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md).

## Design consequences

- **Web Standards only.** Core code uses `Request`, `Response`, `Headers`, `URL`, and `ReadableStream`. Platform specifics belong in adapters or helpers, which is why the core has no Node-specific imports.
- **Routers are swappable.** Route registration is decoupled from matching through the `Router<T>` interface, so the choice of router is a constructor option rather than a fork of the core.
- **Type-level inference is part of the design.** Route paths and handler return types flow through generics on `Hono`, which is what lets `hc` and `validator` infer types without code generation.
- **Subclassing is the extension point for presets.** A custom preset is a `HonoBase` subclass that sets `this.router`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/architecture/middleware-model.md] link "/openwiki/architecture/middleware-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Middleware Model and Composition](/openwiki/architecture/middleware-model.md)
