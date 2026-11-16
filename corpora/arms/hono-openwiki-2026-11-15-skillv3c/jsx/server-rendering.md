---
type: architecture
title: JSX Server Rendering, html and css Helpers
description: How hono/jsx renders JSX to HTML strings on the server — JSXNode string buffers, HtmlEscapedString and escaping, async components and callback phases, streaming Suspense with renderToReadableStream, the jsx-renderer middleware and c.render, the html tagged template, and the css helper's hashed class names and Style injection.
tags: [jsx, ssr, html, css, streaming, suspense, jsx-renderer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-254f2a545e87cd5f0e0b69d9
    resource: repo://src/helper/css/common.ts
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# JSX Server Rendering, html and css Helpers

Hono ships its own JSX implementation in `src/jsx/` (no React dependency). On the server, a JSX tree renders to an **escaped string** that `c.html()` / `c.render()` can send. Client-side rendering with hooks is covered in [JSX DOM Runtime and Hooks](dom-runtime.md).

Configure TypeScript with `"jsx": "react-jsx", "jsxImportSource": "hono/jsx"` (runtime in `src/jsx/jsx-runtime.ts`, dev runtime in `jsx-dev-runtime.ts`), or use the classic `jsx` factory exported from `hono/jsx`.

## The escaped-string model (`src/utils/html.ts`)

Everything in the server pipeline is an `HtmlEscapedString` — a `String` object with `isEscaped: true` and optional `callbacks`. Key pieces:

- `raw(value, callbacks?)` marks a value as already escaped (no further escaping).
- `escapeToBuffer` escapes `& < > " '` (as `&amp; &lt; &gt; &quot; &#39;`) using a single scan, adapted from react-dom.
- A **string buffer** is an array whose element 0 is the string being appended to; promises (async children) are `unshift`ed in front, producing an interleaved array that `stringBufferToString` later resolves from the end, escaping any unescaped resolved values.
- **Callbacks** are deferred work attached to strings (used by Suspense and the css helper). `resolveCallback(str, phase, preserveCallbacks, context)` runs them in one of three phases — `Stringify` (produce the final full string), `BeforeStream` (initial chunk of a stream), and `Stream` (later chunks) — recursively resolving any strings they return. `context` is an object unique to one render tree, used as a WeakMap key by helpers.

`c.html()` accepts these objects/promises and resolves callbacks in the `Stringify` phase before building the response (see [Context](../core/context.md)).

## JSX nodes (`src/jsx/base.ts`)

`jsx(tag, props, ...children)` creates:

- `JSXNode` for intrinsic tags — `toStringToBuffer` writes `<tag attrs>children</tag>`. Attribute rules: `style` objects become CSS strings; boolean attributes from a known list (`checked`, `disabled`, ...) render as `name=""` when true and are omitted when false, while other booleans are stringified; `null`/`undefined` values and invalid attribute names are skipped; `dangerouslySetInnerHTML.__html` is inserted raw (combining it with children throws); promise attribute values are awaited in place; function props are allowed only for `on*` handlers and `ref` (ignored on the server) and **throw** otherwise; other values are escaped. Void elements (`br`, `img`, `input`, ...) are self-closed when childless. SVG attribute names are converted to their kebab-case forms where needed.
- `JSXFunctionNode` for components — calls the component with props; `null`/booleans render nothing, promises (async components) are pushed into the buffer, JSX results render recursively, escaped strings are inserted raw (merging their callbacks), and anything else is escaped. When a component returns a promise while JSX contexts are active, the current context state is captured so the subtree resolves with the right context values.
- `JSXFragmentNode` for `Fragment`.

`node.toString()` returns a string, or a `Promise<string>` when any async child exists. Additional React-compatible exports include `memo`, `isValidElement`, `cloneElement`, `Children`, and `reactAPICompatVersion = '19.0.0-hono-jsx'`.

Contexts (`createContext`/`useContext`, `src/jsx/context.ts`) work in server rendering via a global stack of context values pushed by providers during stringification.

## Async rendering, Suspense, and streaming

**Async components** simply return promises; the final string waits for all of them unless streamed.

**`Suspense`** (server version in `src/jsx/streaming.ts`) renders its children eagerly:

- If all children resolve synchronously, it returns their HTML directly.
- Otherwise it emits `<template id="H:n"></template>` + the rendered `fallback` + `<!--/$-->` and attaches a callback. In the `Stringify` phase (non-streaming), the callback replaces the placeholder region in the buffer with the resolved content. In the `Stream` phase it returns `<template data-hono-target="H:n">content</template><script>…</script>`; the inline script removes the fallback nodes up to the `/$` comment and swaps in the template content.
- Children that call `use(promise)` throw the promise; Suspense catches it, captures the render context, and re-renders after the promise settles.
- The script can receive a CSP nonce via `<StreamingContext.Provider value={{ scriptNonce }}>`.

**`renderToReadableStream(content, onError = console.trace)`** (experimental) enqueues the initial HTML (after `BeforeStream` callbacks), then enqueues each callback result in `Stream` phase as it settles (callbacks of callbacks are chained). Rejected callback promises are reported to `onError` and replaced with `''`; after cancellation nothing more is enqueued. `ErrorBoundary` (`src/jsx/components.ts`) catches errors from children — including in streamed parts — and renders `fallback`/`fallbackRender`.

## `jsxRenderer` middleware and `c.render`

`hono/jsx-renderer` (`src/middleware/jsx-renderer/index.ts`) installs a renderer on the context:

```tsx
app.use(jsxRenderer(({ children, Layout }) => <html><body>{children}</body></html>, { docType: true, stream: false }))
app.get('/', (c) => c.render(<h1>Hello</h1>, { title: 'Top' }))
```

- It captures the current layout (`c.getLayout()`, default `Fragment`) as `Layout` and sets a new layout, so **nested `jsxRenderer`s compose**: an inner renderer can wrap its output in `<Layout>`.
- `c.render(children, props)` wraps the content with the component, prefixes the doctype (`<!DOCTYPE html>` by default; `docType: false` removes it; a string replaces it), and wraps everything in `RequestContext.Provider` so components can call `useRequestContext()` (throws `RequestContext is not provided.` outside).
- `stream: true` sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8`, `Content-Encoding: Identity` and returns `c.body(renderToReadableStream(body))`; an object value sets those headers instead. Otherwise `c.html(body)` is used.
- Options may be a function of `c`. The `ContextRenderer` interface can be augmented to type the props.

## `html` tagged template (`hono/html`)

``html`...` `` builds an `HtmlEscapedString` without JSX: interpolated strings and other values are escaped; numbers are inserted as-is; `null`/`undefined`/booleans render nothing; arrays are flattened; already-escaped values (`raw()`, JSX output) are inserted unescaped; promises make the result a `Promise<HtmlEscapedString>`; callbacks are preserved. `raw` is re-exported. The SSG `redirectPlugin` uses it to build redirect pages.

## `css` helper (`hono/css`)

`src/helper/css/` provides CSS-in-JS for server JSX (a DOM variant lives in `hono/jsx/dom/css`):

- ``css`...` `` hashes the label + minified style string (goober-style hash) into a class name `css-<n>` and returns an escaped class-name string carrying a callback. When rendered, the callback appends the rule to the `<style id="hono-css">` element emitted by `<Style />` (tracked per render context so each rule is emitted once), or, during streaming, inserts a script/`<style>` for late rules.
- `cx(...)` combines class names (external names are validated against `<`, `{`, `}` to avoid breaking out of the style element); `keyframes` creates animations; `viewTransition` creates view-transition names; `:-hono-global` wraps global styles.
- `<Style nonce="..."/>` supports CSP nonces. `createCssContext({ id, classNameSlug? })` creates an isolated set of helpers with a custom style element id or class-name slug function (slugs are validated).

## Tests

`src/jsx/index.test.tsx`, `src/jsx/streaming.test.tsx`, `src/jsx/components.test.tsx`, `src/jsx/context-isolation.test.ts`, `src/helper/html/index.test.ts`, `src/helper/css/*.test.tsx`, `src/middleware/jsx-renderer/index.test.tsx`, and the Deno JSX runtime tests under `runtime-tests/deno-jsx`.

See also: [Streaming, SSE, and WebSocket Helpers](../helpers/streaming-and-websocket.md).
