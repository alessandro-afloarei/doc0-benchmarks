---
type: workflow
title: Static assets and static site generation
description: Runtime asset lookup, path validation, precompressed files, route-driven SSG, plugin ordering, and generated-file failure semantics.
tags: [static, assets, ssg, filesystem]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-b9a8387fef3591f80b327aa9
    resource: repo://src/adapter/bun/serve-static.ts
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
  - id: openwiki-source-02cf4bb36f551f1a17710d8d
    resource: repo://src/middleware/serve-static/index.ts
  - id: openwiki-source-4c2a5a65884403b99006adbf
    resource: repo://src/middleware/serve-static/path.ts
  - id: openwiki-source-b6e31ddca68e7ac800c3482e
    resource: repo://src/utils/handler.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Static assets and static site generation

Static serving reads existing content during a request. Static site generation executes application routes ahead of time and writes their responses. Both use runtime adapters to keep filesystem operations outside the core application.

## Serving existing assets

The [shared static middleware](../../src/middleware/serve-static/index.ts) accepts injected `getContent`, optional directory detection, and path joining. Runtime wrappers provide actual file access: [Bun](../../src/adapter/bun/serve-static.ts) uses Bun.file, filesystem stat, and node:path join. Cloudflare Pages instead delegates assets to its ASSETS binding.

The shared flow is:

1. Continue if a response is already finalized.
2. Use an explicit path or decode the request path. Request-derived paths containing dot segments, backslashes, or repeated separators are rejected and fall through.
3. Apply a request-path rewrite when configured, join with the root, and append index.html when directory detection succeeds.
4. Fetch content. A Response is wrapped immediately; ordinary content gets a MIME type and optional compressed variant.
5. Invoke onFound and return content, or invoke onNotFound and continue downstream.

A missing asset does not itself force a 404; later handlers can supply a fallback. Explicit paths and rewrite callbacks are application configuration and are not subject to the same initial request-path check. The built-in default join uses forward slashes and is not a Windows path implementation.

With `precompressed`, eligible content can select .br, .zst, or .gz variants in that order. Selection uses exact comma-separated Accept-Encoding tokens, not a full quality-value negotiation algorithm. A selected variant sets Content-Encoding and appends Vary: Accept-Encoding.

```ts
import { serveStatic } from 'hono/bun'

app.use('/assets/*', serveStatic({ root: './public' }))
```

Here /assets/logo.svg resolves under public/assets/logo.svg. Use rewriteRequestPath if the disk layout needs the /assets prefix removed.

## Generating route content

[toSSG](../../src/helper/ssg/ssg.ts) accepts an app, a filesystem interface with mkdir/writeFile, and options. Bun and Deno wrappers supply the filesystem argument. Defaults are ./static for output and two concurrent request tasks.

Candidate routes come from `app.routes`: GET or ALL entries whose unwrapped handler is not classified as middleware. Classification uses function arity greater than one, so a second handler parameter affects discovery even if it is unused.

Generation first requests each route pattern with the SSG environment marker to obtain parameter metadata. Dynamic routes without `ssgParams` are skipped; static routes use one empty parameter set. Each parameter set then produces a concrete in-process request, followed by response filtering and content extraction. Consequently a static endpoint can execute for both discovery and generation; keep generation-safe route effects in mind.

```ts
import { Hono } from 'hono'
import { ssgParams } from 'hono/ssg'
import { toSSG } from 'hono/bun'

const app = new Hono()
app.get('/posts/:id', ssgParams([{ id: 'welcome' }]), (c) =>
  c.html(`<h1>Post ${c.req.param('id')}</h1>`)
)
const result = await toSSG(app, { dir: './static' })
if (!result.success) throw result.error
```

The example's parameter is a trusted literal; use [escaped HTML/JSX](../concepts/jsx-and-html.md) for untrusted content. `ssgParams` attaches parameter sets to the pattern request and stops downstream execution during discovery. `disableSSG()` marks SSG responses to skip; `onlySSG()` excludes ordinary runtime requests.

## Hooks, output, and failures

Before-request and after-response hooks run in sequence and can replace their value or return false to skip. The default plugin accepts only status 200. Supplying a plugins array replaces that default list, including when the array is empty. Put redirectPlugin before defaultPlugin when converting redirect responses into generated HTML.

MIME type determines the output extension. Root and trailing-slash routes produce index files; other routes gain an extension unless they already have the selected extension. Output paths are checked against the normalized output directory before writes. Text/JSON responses are read as strings; other responses become byte content.

Writes go directly through the supplied filesystem. Generation failures return `{ success: false, files: [], error }`; already written files are not rolled back. After-generate hooks run after the result is assembled, outside that catch, so hook failures can reject the call. Treat generation as a build operation with possible partial output, not an atomic directory replacement.

[SSG tests](../../src/helper/ssg/ssg.test.tsx) cover hooks, dynamic parameters, disabled routes, write failures, and output traversal checks. [Static middleware tests](../../src/middleware/serve-static/index.test.ts) and [path tests](../../src/middleware/serve-static/path.test.ts) cover serving boundaries. See [adapters](../integrations/runtime-adapters.md) and [testing](testing.md) for runtime checks.
