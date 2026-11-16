---
type: workflow
title: Static assets and site generation
description: Runtime-specific static content loading, safe request paths, precompressed responses, and SSG route discovery, parameter expansion, plugins, and filesystem output.
tags: [static, assets, ssg, filesystem, plugins]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
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
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# Static assets and site generation

Static serving maps a request to existing content. Static site generation evaluates application routes and saves their response bodies as files. Both reuse the normal Hono request/response model, with runtime adapters supplying storage access.

## Serve existing files

The shared [serveStatic middleware](../../src/middleware/serve-static/index.ts) owns request path handling, MIME headers, precompressed selection, and fallthrough. A wrapper supplies `getContent` and optionally path joining and directory detection. Import a runtime wrapper such as `serveStatic` from `hono/bun` or `hono/deno`; the common implementation explicitly expects those integration callbacks.

```ts
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'

const app = new Hono()
app.use('/assets/*', serveStatic({ root: './public' }))
```

This maps `/assets/logo.svg` to `./public/assets/logo.svg`. Use `rewriteRequestPath` when the URL prefix should be removed from the filesystem path.

The common handler continues immediately when context is already finalized. Otherwise, it uses an explicit configured `path`, or decodes the request path and rejects dot/dot-dot segments, repeated separators, and backslashes. A rejected request path invokes `onNotFound` and falls through. Rewriting occurs after that incoming path check, so application-provided rewrites and fixed paths must stay within the intended asset mapping.

After joining the root and selected path, an optional directory check selects `index.html`. Content returned as a Response is carried through `c.newResponse`; ordinary content gets a MIME type or application/octet-stream. Missing content calls `onNotFound` and continues downstream. `onFound` runs for successfully loaded ordinary content before the body response is returned.

With `precompressed: true`, eligible content can use an existing `.br`, `.zst`, or `.gz` sibling, in that preference order, when the request's accepted encoding tokens include the corresponding encoding. A selected variant adds Content-Encoding and Vary. This path loads precompressed content rather than compressing the file on demand.

[Bun's wrapper](../../src/adapter/bun/serve-static.ts) uses Bun.file, filesystem stat, and node:path joining. Cloudflare Pages' advanced-mode helper instead delegates to its ASSETS binding, as described in [runtime adapters](../integrations/runtime-adapters.md). Keep storage failures and permissions associated with the runtime loader.

## Generate files from routes

[SSG](../../src/helper/ssg/ssg.ts) takes a Hono application, a filesystem module implementing `writeFile` and `mkdir`, and options. Bun and Deno provide convenience wrappers; the shared `hono/ssg` export supports an explicit filesystem implementation. These generation APIs are marked experimental.

```ts
import { Hono } from 'hono'
import { toSSG } from 'hono/bun'
import { ssgParams } from 'hono/ssg'

const app = new Hono()
app.get('/posts/:id', ssgParams([{ id: 'one' }, { id: 'two' }]),
  (c) => c.html(`<h1>Post ${c.req.param('id')}</h1>`))
const result = await toSSG(app, { dir: './static' })
if (!result.success) throw result.error
```

The parameter values in this example are fixed trusted strings. For arbitrary data, use the [escaped HTML or JSX helpers](../concepts/jsx-rendering.md).

The generation flow is:

1. Select GET/all-method route records whose underlying handler is classified as an endpoint. Classification uses handler arity after unwrapping composed handlers, so this is not an independent route manifest or type-based analysis.
2. Make a discovery request to the literal route path with `HONO_SSG_CONTEXT` set in bindings. For dynamic paths, `ssgParams` attaches concrete parameter sets to the raw request and stops before the endpoint.
3. Skip dynamic routes without parameter sets. Static routes use one empty parameter set.
4. Substitute each parameter set and request the concrete URL through the application. Respect the disable-SSG response header and response hooks.
5. Parse body content, derive a filename from route and MIME type, create directories, and write files.

Generation executes middleware and endpoint code. A static endpoint can run both during discovery and during content fetching. Use `isSSGContext`, `disableSSG`, and `onlySSG` for code that needs different generation behavior. Generation supplies the SSG marker as bindings rather than provisioning ordinary deployment services; arrange any required application dependencies explicitly.

## Plugins, output, and failure semantics

The default output directory is `./static` and the default request concurrency is two. Plugin hooks can transform or skip discovery requests, transform or skip responses, and process the final result. Returning false from request/response hooks skips that item, and arrays of hooks execute in order.

Unless `plugins` is supplied, SSG installs [defaultPlugin](../../src/helper/ssg/plugins.ts), which skips non-200 responses. Providing a custom plugin array replaces that default list. To produce redirect HTML and retain status filtering, order `redirectPlugin()` before `defaultPlugin()` so it can transform supported redirects into HTML status 200 responses before filtering.

Filename generation uses MIME extensions: `/` becomes `index.ext`, a trailing-slash route becomes `path/index.ext`, and other extensionless routes become `path.ext`. Explicitly matching extensions are retained. The normalized output path is checked against the output directory before writing; escaping it throws a path-traversal error.

`toSSG` catches generation/save failures and returns `{ success: false, files: [], error }`; successful generation returns saved filenames. Files already written are not rolled back when a later operation fails. After-generation hooks run after that result is built and can themselves reject. Callers must check the result and own cleanup or deployment of generated artifacts.

Verify behavior with [static middleware tests](../../src/middleware/serve-static/index.test.ts), [SSG tests](../../src/helper/ssg/ssg.test.tsx), [path utility tests](../../src/helper/ssg/utils.test.ts), and [plugin tests](../../src/helper/ssg/plugins.test.tsx). Route discovery depends on [application registration](../architecture/routing.md); generated HTML depends on [rendering](../concepts/jsx-rendering.md).
