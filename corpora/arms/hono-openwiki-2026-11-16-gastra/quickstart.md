---
type: guide
title: Start here
description: Repository orientation, contributor setup, an in-process Hono example, and a task map for the architecture and workflow documentation.
tags: [quickstart, orientation, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-7afaaad2556e19b8285f742f
    resource: repo://build/build.ts
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
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
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Start here

Hono is a TypeScript web framework built around Web Request and Response APIs. This wiki explains the implementation in this checkout: how requests flow through the framework, where runtime adapters take over, and how contributors test and package changes.

## Run a request without a server

The public [entrypoint](../src/index.ts) exports Hono and its main context and type surfaces. In an application with the package installed:

```ts
import { Hono } from 'hono'

const app = new Hono()
app.get('/hello/:name', (c) =>
  c.json({ message: 'Hello ' + c.req.param('name') })
)

const response = await app.request('/hello/Hono')
console.log(response.status) // 200
console.log(await response.json()) // { message: 'Hello Hono' }

export default app
```

`app.request()` creates a local Request and calls the same fetch entrypoint used by runtime adapters. It accepts a Request, URL, or path; relative paths use http://localhost. This example does not open a network listener. In a root-level script inside this checkout, import Hono from `./src/index.ts` to exercise source directly.

Register all routes before the first request. The default SmartRouter selects its engine at first match and then rejects further registration. Return a Response from a terminal handler; middleware should return or await next.

To expose an application on a runtime, select the [adapter boundary](integrations/runtime-adapters.md). Fetch-native hosts can use the fetch interface; event-shaped platforms need conversion. Server lifecycle, sockets, bindings, and background work are platform responsibilities.

## Prepare the contributor environment

The [contribution guide](../docs/CONTRIBUTING.md) uses Bun and the committed lockfile. [.tool-versions](../.tool-versions) records CI toolchain pins; [package.json](../package.json) defines the commands.

```bash
bun install --frozen-lockfile
bun run build
bun run test
```

The build creates ESM, CommonJS, and declaration artifacts under dist. The test command runs a TypeScript spec check before Vitest. For a focused first pass after setup:

```bash
bunx vitest --run --project main src/hono.test.ts src/compose.test.ts
```

Use [testing](workflows/testing.md) for runtime-specific commands and JSX projects, and [build and release](workflows/build-and-release.md) when changing public exports or declarations.

## Find the right page

| Task or question | Start with |
| --- | --- |
| Trace a request, middleware order, errors, or sub-app composition | [Request dispatch and middleware composition](architecture/request-lifecycle.md) |
| Understand route matching, router selection, or preset behavior | [Routing engines and registration lifecycle](architecture/routing.md) |
| Debug body reads, parameters, headers, context variables, or response finalization | [Request data and response state](concepts/request-and-context.md) |
| Add authentication, origin checks, body limits, timeouts, or cache policy | [Middleware policies and security boundaries](concepts/middleware-and-security.md) |
| Validate input and preserve route types for a client | [Validation and typed HTTP clients](workflows/validation-and-client.md) |
| Render HTML, use layouts, or change JSX/DOM behavior | [HTML and JSX rendering](concepts/jsx-and-html.md) |
| Work with SSE, producer failures, cancellation, or async JSX output | [Streaming responses and server-sent events](concepts/streaming.md) |
| Add a platform integration, investigate Lambda events, or upgrade WebSockets | [Runtime adapters and WebSocket integration](integrations/runtime-adapters.md) |
| Serve files or generate static pages | [Static assets and static site generation](workflows/static-content.md) |
| Select tests, reproduce CI, or investigate performance | [Testing and performance investigation](workflows/testing.md) |
| Change package exports, build artifacts, or release automation | [Package exports, builds and releases](workflows/build-and-release.md) |

## Source landmarks

[src/hono-base.ts](../src/hono-base.ts) owns application registration and dispatch. [src/compose.ts](../src/compose.ts) owns middleware traversal. [Context](../src/context.ts) and [HonoRequest](../src/request.ts) own request-local state; router implementations return matches consumed by dispatch.

Optional middleware, helper APIs, client construction, JSX rendering, and runtime adapters are exposed through package subpaths. The manifests are the authority for public import paths; a source file's existence alone does not establish a supported package entrypoint.

Tests are mostly colocated with implementations. Cross-runtime checks live under runtime-tests, package generation under build, and performance investigations under benchmarks and perf-measures. Follow the focused test pointers on each page before broadening the investigation.

Each factual page carries repository evidence managed by OpenWiki. Use current source and tests to resolve disagreements after code changes; this documentation describes repository behavior rather than independently verified guarantees about external hosting services.
