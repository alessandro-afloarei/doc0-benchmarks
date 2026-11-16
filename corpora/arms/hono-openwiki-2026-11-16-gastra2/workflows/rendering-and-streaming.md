---
type: workflow
title: JSX rendering and streaming responses
description: Server HTML escaping, JSX layouts, Suspense streaming, browser DOM roots, and generic stream/SSE lifecycles.
tags: [jsx, html, streaming, rendering]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
sources:
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# JSX rendering and streaming responses

Hono contains both server-side HTML rendering and a browser DOM renderer. HTTP response construction stays in [Context](../concepts/request-context.md); rendering helpers supply strings or streams that the context turns into responses.

## Escaping and server JSX

The `hono/html` template helper escapes interpolated strings, flattens array values, skips booleans/null/undefined, and preserves explicitly escaped values. Promises and rendering callbacks remain part of an asynchronous buffer until resolved. `raw()` marks content as already escaped, so callers must own the trust decision for anything they pass through it.

Server JSX serializes nodes into that HTML representation. It normalizes attribute names, rejects invalid attribute names, escapes string attributes, supports style objects, and treats known boolean attributes specially. Event-handler functions and refs are ignored for server output; other function-valued attributes raise an error. `dangerouslySetInnerHTML` inserts raw HTML and cannot coexist with children.

## Layout middleware and request context

`jsxRenderer(component?, options?)` installs the context renderer before calling downstream middleware. It captures the previous layout (or Fragment), exposes that as the component's Layout prop, and installs a new layout when a component is supplied. Nested renderer middleware therefore builds layout relationships through context state.

An endpoint calls `c.render(children, props)`. The installed renderer evaluates request-dependent options, applies the layout, prefixes the default HTML doctype unless disabled/replaced, and wraps content in RequestContext.Provider. `useRequestContext()` reads this provider and throws if it is absent.

Without stream mode, output goes through `c.html()`. With stream mode, output goes through `renderToReadableStream()` and `c.body()`. Boolean stream mode supplies HTML/chunked/Identity headers; an object supplies explicit headers. This choice changes when asynchronous content is delivered, while status and other prepared response state remain owned by Context.

## Suspense and stream completion

Suspense inspects child output. Pending output produces a fallback enclosed by marker/template nodes; when it resolves, callbacks replace the buffered placeholder or emit template content and a small replacement script for the browser. StreamingContext can supply a script nonce. Fully resolved children are emitted directly.

`renderToReadableStream` first resolves callbacks for the BeforeStream phase, emits initial bytes, then processes Stream callbacks including newly discovered nested callbacks. It closes only after the callback collection is resolved, unless cancelled. Streaming errors go through its onError callback. Since a response stream can fail after HTTP response construction, this is a different failure boundary from a synchronous endpoint exception.

## Generic streams and SSE

`stream(c, callback, onError?)` creates a TransformStream and StreamingApi, starts the callback asynchronously, and immediately returns a response over the readable side. The callback's Error instances go to the supplied error handler, other failures are logged, and the writer is closed in finally. A WeakMap keeps the context reachable for the stream lifetime; older Bun versions receive an explicit request-abort bridge.

`streamSSE` uses the same broad pattern with event-stream headers and an SSEStreamingApi. `writeSSE()` splits multiline data into separate data fields, rejects line breaks in event/id/retry metadata, and ends each event with a blank line. Its callback error path can invoke onError and emit an error event before closing.

## Browser rendering and compatibility limits

`hono/jsx/dom/client` exposes createRoot, root.render, root.unmount, and hydrateRoot. A root's first render builds the node tree; later renders update state. Updating an unmounted root throws. In this implementation hydrateRoot calls createRoot and render: its documented behavior is equivalent to rendering, not a separate hydration algorithm. Nonempty root options currently warn as unsupported.

The DOM server compatibility entrypoint's renderToString rejects async component output. Its readable-stream API delegates to Hono's streaming renderer and currently supports only the onError option. These explicit limits matter when porting code from similarly named React APIs.

## Verification

Renderer middleware tests cover nested layouts, request context, doctype options, streaming headers, and preservation of status. JSX/HTML tests cover escaping and serialization, streaming tests cover asynchronous delivery, and DOM tests exercise browser updates. The [test configuration](../operations/testing-and-build.md) runs DOM behavior under both JSX import sources. For rendering routes to disk, continue to [static generation](static-assets-and-generation.md).
