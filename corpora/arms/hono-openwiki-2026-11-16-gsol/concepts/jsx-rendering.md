---
type: concept
title: HTML, JSX, and rendering
description: Server HTML escaping, JSX layouts and request context, Suspense streaming, browser rendering, and their configuration and isolation boundaries.
tags: [jsx, html, rendering, streaming, context]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:16:56.556Z
sources:
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-a31ca3ecb049dd4f405ff8d1
    resource: repo://src/jsx/context-isolation.test.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-a5a81210f9e7b4d9cf856445
    resource: repo://src/jsx/dom/server.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
generated: { by: "codex", at: "2026-11-16T06:16:56.556Z" }
---

# HTML, JSX, and rendering

Hono supports HTML templates, server JSX serialization, streaming JSX, and a browser DOM renderer. They share component and escaping machinery, but have different response and lifecycle contracts. Start with [HTML helpers](../../src/helper/html/index.ts) for templates, [JSX nodes](../../src/jsx/base.ts) for serialization, and [jsxRenderer](../../src/middleware/jsx-renderer/index.ts) for HTTP layouts.

## Escaped content and response construction

The `html` tagged template escapes ordinary string substitutions, flattens substituted arrays, omits booleans and nullish values, and preserves values already marked escaped. Promises and callbacks are resolved through HTML buffer utilities. `raw()` marks trusted markup as already escaped; it bypasses the normal escaping step and belongs at deliberate markup boundaries.

JSX serialization escapes string children and attribute values, normalizes intrinsic attribute names, serializes style objects, and omits server event functions. `dangerouslySetInnerHTML` inserts raw markup and rejects simultaneous children. These mechanisms perform HTML encoding; applications still own the meaning of URLs and other supplied content.

`c.html()` constructs an HTML response and resolves supported asynchronous HTML values. `c.render()` calls a per-request renderer, defaulting to `c.html()` until middleware replaces it. A direct string passed to `c.html()` is response markup; it does not acquire the interpolation escaping provided by the `html` template helper.

## Request layouts

```tsx
import { Hono } from 'hono'
import { jsxRenderer } from 'hono/jsx-renderer'

const app = new Hono()
app.use('*', jsxRenderer(({ children }) => (
  <html><body><main>{children}</main></body></html>
)))
app.get('/', (c) => c.render(<h1>Hello</h1>))
```

Renderer middleware captures the preceding layout, optionally installs a new one, and sets the renderer before calling downstream middleware. Its component receives `Layout` for nesting and the current Hono context as a second argument. The generated body wraps content in `RequestContext.Provider`, allowing `useRequestContext()` inside components. Calling that hook without a provided context throws.

The default document type is `<!DOCTYPE html>`; `docType: false` suppresses it and a string replaces it. `stream: true` chooses JSX streaming and sets the middleware's default stream headers. A header record supplies custom stream headers instead. Rendering choices live on the request context rather than modifying the application globally.

## Context across asynchronous work

[JSX context](../../src/jsx/context.ts) owns a separate per-render store. It lazily probes for `AsyncLocalStorage` through available `process` capabilities. When storage is available, provider values propagate across awaits while concurrent renders remain isolated.

Without that storage, the fallback store is active during synchronous render work only. A context read after an await in an async component falls back to the context default and emits a one-time warning during in-flight fallback rendering. Read required context before awaiting, or use the supported suspension mechanism. The implementation captures and restores render context for deferred suspension continuations. The [context isolation tests](../../src/jsx/context-isolation.test.ts) deliberately disable storage and interleave requests to check that a render never receives another request's provided value.

This affects `useRequestContext()` too: its provider default is null, so a lost provider becomes an explicit error rather than a usable Hono context. Account for the target runtime's capabilities when writing asynchronous components.

## Suspense and streamed HTML

[Suspense](../../src/jsx/streaming.ts) emits fallback markup and a target template when children are pending. When children resolve, callbacks produce template content and a script that replaces the fallback. `StreamingContext` can supply a script nonce for generated scripts. Without pending children, Suspense serializes content directly.

`renderToReadableStream` emits the initial serialized body and then resolves nested streaming callbacks. It encodes chunks as bytes, handles cancellation by stopping enqueue operations, and reports rendering failures through its error callback. The streaming exports are marked experimental in source. For response-level stream error and abort behavior, see [streaming and WebSockets](../integrations/streaming-websockets.md).

## Browser renderer and compatibility limits

`hono/jsx/dom` renders components into a DOM container and supplies hooks, portals, and DOM components. `hono/jsx/dom/client` exposes `createRoot`, whose returned object renders, updates, and unmounts. Updating an unmounted root throws. `hydrateRoot` currently delegates to root rendering; do not infer a separate hydration algorithm from its name.

The `hono/jsx/dom/server` compatibility surface provides synchronous `renderToString` and a readable-stream wrapper. The string method rejects async components. The wrapper currently supports `onError` and warns for other supplied options, so a compatible signature is not a promise that every option is implemented.

Use the automatic JSX transform with `jsxImportSource: 'hono/jsx'` for server JSX, or the DOM import source for browser-oriented compilation. [tsconfig.spec.json](../../tsconfig.spec.json) shows the server configuration; [Vitest configuration](../../vitest.config.ts) deliberately exercises DOM suites with both import sources.

Representative verification lives in [JSX base tests](../../src/jsx/base.test.tsx), [streaming tests](../../src/jsx/streaming.test.tsx), [renderer tests](../../src/middleware/jsx-renderer/index.test.tsx), and [DOM client tests](../../src/jsx/dom/client.test.tsx). Continue to [request/response state](request-context-validation.md) or [static generation](../workflows/static-assets-and-generation.md).
