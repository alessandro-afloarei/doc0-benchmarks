---
type: guide
title: Repository quickstart
description: Run Hono from this checkout, understand the framework's core flow, and find the right architecture, workflow, integration, or testing page.
tags: [quickstart, development, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Repository quickstart

This repository implements Hono, a TypeScript web framework built around Fetch Request and Response objects. It includes the request dispatcher, multiple routers, middleware, typed HTTP clients, JSX rendering, static generation, and runtime adapters. The package entrypoint exports Hono and shared context/types; optional features are exposed through package subpaths.

## Work with this checkout

Install Bun and the runtime tools needed for your target. The contributor guide uses a frozen dependency install:

```sh
bun install --frozen-lockfile
```

See [testing and build](operations/testing-and-build.md) for the distinction between packageManager and CI tool pins. The basic contributor commands are:

```sh
bun run test
bun run build
```

The test script typechecks before running Vitest. The build produces ESM, CommonJS, and declaration outputs and validates public export coverage. Runtime tests have additional platform requirements; use focused tests while developing a specific subsystem.

To exercise the local framework without starting a server, run this from the repository root:

```sh
bun -e 'import { Hono } from "./src/index.ts"; const app = new Hono(); app.get("/hello/:name", (c) => c.json({ message: `Hello, ${c.req.param("name")}!` })); const response = await app.request("/hello/Ada"); console.log(response.status, await response.json());'
```

The response has status 200 and JSON message "Hello, Ada!". The equivalent application source is:

```ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/hello/:name', (c) =>
  c.json({ message: `Hello, ${c.req.param('name')}!` })
)

export default app
```

For an installed package, import from hono; for inspecting unbuilt local code, the command above imports src directly. Hosting requires a runtime Fetch entrypoint or adapter. `app.request()` is an in-process request helper and does not start a listener.

## Understand one request

1. Route methods and use register handlers with the application's router.
2. app.fetch extracts the path, matches handlers, and creates a request context.
3. Middleware calls await next to reach downstream handlers and then unwind.
4. The endpoint returns a Response, often through c.text, c.json, or c.html.
5. The context/composer resolves response state, not-found behavior, and handler errors.

The default SmartRouter selects its implementation at the first match; finish route registration before issuing requests. Context state belongs to a request, while routes and selected router state belong to the application. Platform bindings, cache services, and filesystem operations enter through explicit integration seams.

## Find the page for your task

| Task or question | Start here |
| --- | --- |
| Follow a request, missing response, or error handler | [Request lifecycle](architecture/request-lifecycle.md) |
| Change path matching, router choice, prefixes, or mounted apps | [Routing and composition](architecture/routing.md) |
| Diagnose body consumption, variables, cookies, or header replacement | [Request and response context](concepts/request-context.md) |
| Configure or extend auth, CORS, CSRF, body limits, timeout, or cache | [Middleware policies](concepts/middleware-and-security.md) |
| Add validation or preserve typed client request/response inference | [Validation and clients](workflows/validation-and-client.md) |
| Render JSX, use layouts/Suspense, stream bytes, or update browser DOM | [Rendering and streaming](workflows/rendering-and-streaming.md) |
| Serve files or generate route responses into a static site | [Static assets and generation](workflows/static-assets-and-generation.md) |
| Translate runtime events, supply bindings, or upgrade WebSockets | [Runtime adapters](integrations/runtime-adapters.md) |
| Select tests, add exports, build packages, or understand release CI | [Testing and build](operations/testing-and-build.md) |

## Source landmarks

`src/hono-base.ts` owns registration and dispatch; `src/compose.ts` owns middleware execution. `src/context.ts` and `src/request.ts` own per-request state. Router implementations live under src/router, optional HTTP processing under src/middleware, and platform code under src/adapter.

Tests usually sit beside their implementations. Cross-runtime checks live under runtime-tests, package generation under build, and automation under .github/workflows. Existing contributor and migration material remains under docs. Follow the focused test references in each wiki page when changing behavior; compiler checks are essential for the typed route/client surface.
