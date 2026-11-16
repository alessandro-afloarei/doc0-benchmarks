---
type: concept
title: HTML and JSX rendering
description: HTML escaping, asynchronous JSX, request-aware layouts, and the boundaries between server and DOM rendering.
tags: [jsx, html, rendering, escaping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-a5a81210f9e7b4d9cf856445
    resource: repo://src/jsx/dom/server.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# HTML and JSX rendering

Hono supports both server HTML generation and a browser DOM renderer. The shared JSX APIs do not make every rendering target interchangeable: streaming, DOM updates, and synchronous string conversion have different lifecycles.

## Escaping and asynchronous output

The [html template helper](../../src/helper/html/index.ts) escapes ordinary interpolated strings, flattens nested arrays, skips booleans and nullish values, and preserves values already marked as escaped. Promises are collected into the output buffer, so the result can be asynchronous.

```ts
import { html } from 'hono/html'

app.get('/', (c) => c.html(html`<h1>Hello ${c.req.query('name') ?? 'visitor'}</h1>`))
```

`raw()` marks content as already escaped; it does not sanitize it. Use it only for HTML whose trust and escaping have already been established. Likewise, `c.html()` is a response helper, not a sanitizer.

[Server JSX](../../src/jsx/base.ts) escapes string children and string attributes, serializes style objects, omits server-side event functions, and supports asynchronous function components. `dangerouslySetInnerHTML` inserts raw HTML and throws when children are also supplied. Keep untrusted values in ordinary children or attributes instead of bypassing escaping.

## Request-aware layouts

[jsxRenderer](../../src/middleware/jsx-renderer/index.ts) installs a renderer on the request context. It captures the preceding layout, optionally sets a new layout, and gives the component a `Layout` prop for nesting. It wraps output in `RequestContext.Provider`, allowing `useRequestContext()` to access the Hono context inside rendering. That hook throws outside a provider.

```tsx
import { jsxRenderer } from 'hono/jsx-renderer'

app.use('*', jsxRenderer(({ children }) => (
  <html><body>{children}</body></html>
)))
app.get('/hello', (c) => c.render(<h1>Hello</h1>))
```

The default doctype is `<!DOCTYPE html>`; options can disable or replace it. Without streaming, the renderer returns `c.html(body)`. With streaming enabled it returns a body from `renderToReadableStream`; `stream: true` sets the default HTML streaming headers, while a header object supplies explicit headers. Renderer registration order determines the layout chain.

## Server output versus browser state

The [JSX entrypoint](../../src/jsx/index.ts) exports element creation, context, hooks, Suspense, and ErrorBoundary. [DOM rendering](../../src/jsx/dom/render.ts) maintains node, hook, and effect state for browser updates rather than serializing each update into a new HTTP response.

The `hono/jsx/dom/client` entry exposes `createRoot()` and `hydrateRoot()`. A root can render repeatedly until unmounted; rendering after unmount throws. In this implementation `hydrateRoot()` creates a root and renders it, so do not assume reconciliation behavior from another library's identically named API. Root options currently emit a warning when supplied.

The `hono/jsx/dom/server` compatibility wrapper has a stricter synchronous `renderToString()`: it throws when conversion produces an asynchronous result. Its readable-stream wrapper supports `onError`, while other options warn as unsupported. For asynchronous server content, use the streaming path described in [streaming responses](streaming.md).

## Tests and extension seams

Use [HTML helper tests](../../src/helper/html/index.test.ts) for escaping and promised values, [JSX renderer tests](../../src/middleware/jsx-renderer/index.test.tsx) for layouts, doctypes, and headers, and [DOM client tests](../../src/jsx/dom/client.test.tsx) for repeated render and unmount behavior.

Vitest runs DOM cases with both the ordinary JSX import source and the DOM-specific import source. When changing shared nodes, hooks, or element semantics, run both `jsx-runtime-default` and `jsx-runtime-dom` projects; see [testing](../workflows/testing.md). Generated HTML can also flow through [static site generation](../workflows/static-content.md).
