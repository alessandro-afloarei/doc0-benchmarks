---
type: architecture
title: JSX Runtime and Server Rendering
description: How Hono's server-side JSX (src/jsx) creates JSX nodes, escapes and serializes them to HTML strings, streams them through renderToReadableStream with experimental Suspense, and wraps pages with the jsxRenderer middleware and its layout model.
tags: [hono, jsx, ssr, html, streaming, suspense, jsx-renderer, layout, escaping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# JSX Runtime and Server Rendering

<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's JSX support lets handlers return HTML written as JSX. On the server, a JSX tree is not a virtual DOM: it is a `JSXNode` object whose `toString()` produces an HTML string, escaping text and attribute values as it goes. The same JSX can be rendered to a stream or to a string, and a middleware (`jsxRenderer`) can wrap every page in a shared layout. The client-side renderer in `src/jsx/dom` is separate (see [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md)).

## Entry points and the compiler contract

The JSX compiler is configured to call `hono/jsx`'s `jsx` and `Fragment` exports. `src/jsx/jsx-runtime.ts` re-exports `jsxDEV as jsx` and `jsxDEV as jsxs`, plus `Fragment` and the `JSX` namespace types, so the automatic runtime (`jsx-runtime`) and the development runtime (`jsx-dev-runtime`) share one implementation. `src/jsx/index.ts` exposes the public server-side API: components, context helpers, and the children utilities.

The runtime is wired in the `vitest.config.ts` projects through `oxc.jsx` with `importSource: './src/jsx'`, which is how the test suite compiles JSX against this implementation.

## JSX node creation

`jsx(tag, props, ...children)` in `src/jsx/base.ts` creates a `JSXNode`. Function components are invoked when the tree is serialized rather than at node creation, so a component reads context values during rendering. `Fragment` produces a `JSXFragmentNode` (defined in `base.ts`) that concatenates its children.

`JSXNode` implements the `HtmlEscaped` interface. Its `toString()` writes into a string buffer through `toStringToBuffer(buffer)`, then flattens the buffer. Asynchronous children (promises) make the result a `Promise<string>`. Callbacks registered on the buffer (`resolveCallbackSync`) let raw output be inserted after async work completes.

## Escaping and attribute rules

All text children are passed through `escapeToBuffer` in `src/utils/html.ts`, which replaces the characters `&`, `<`, `>`, `"`, and `'` with HTML entities, based on code from `react-dom`. Values that are already HTML are wrapped with `raw(...)` from `src/helper/html`, which marks a string as pre-escaped so it is written unchanged. Attribute names are checked with `isValidAttributeName` (in `src/jsx/utils.ts`); an invalid name produces an empty string rather than broken markup. `style` accepts an object, which `styleObjectForEach` converts into a CSS declaration string.

The same escaping rule means string interpolation via `html` (`src/helper/html`) and JSX produce identical output for the same text, so mixing both in one page is safe.

## Context on the server

`createContext(defaultValue)` in `src/jsx/context.ts` returns a `Context<T>` with a `Provider` component and a `values` stack. A provider pushes its `value` for the duration of its children and pops it afterwards, so the value is visible to any component rendered inside that subtree during `toString()`. `useContext` reads the top of the stack. Because the stack is pushed and popped synchronously during tree traversal, context values are scoped to the subtree being rendered; asynchronous children that resume later must capture the context explicitly, which `Suspense` does.

## Rendering a string

`c.html(jsx)` (through `Context.html`) renders a `JSXNode` to a `Response` with `Content-Type: text/html; charset=UTF-8`. Calling `.toString()` directly gives the string. If any part of the tree is asynchronous, the result is a promise, and the `c.html` call returns a promise for the response.

## Streaming

`renderToReadableStream(content, onError)` in `src/jsx/streaming.ts` returns a `ReadableStream<Uint8Array>`. It calls `toString()` on the root node (if it is a `JSXNode`), resolves callbacks scheduled for the `BeforeStream` phase, and enqueues the bytes. Later chunks are enqueued as async parts resolve, so the browser receives the shell first. The `cancelled` flag stops enqueueing after the consumer cancels the stream. Errors thrown during rendering are passed to `onError`, whose default is `console.trace`.

`Suspense` (experimental, marked as such in the source) tries to render its `children` synchronously. When a child throws a promise, `Suspense` captures the render context so rendering can resume later, and the `fallback` is used in its place until the promise settles. A `StreamingContext` supplies a `scriptNonce` so that the inline scripts used to swap content in can satisfy a Content Security Policy. The client counterpart of `Suspense` (`SuspenseDomRenderer` in `src/jsx/dom/components.ts`) is imported by the streaming module so that the two stay in step.

`ErrorBoundary` uses the same `scriptNonce` mechanism when it emits error-swap scripts.

## jsx-renderer middleware and layouts

`jsxRenderer(component?, options?)` in `src/middleware/jsx-renderer/index.ts` is middleware that installs a renderer for the request:

1. It reads the current layout (`c.getLayout()`), defaulting to `Fragment`, as the `Layout` component.
2. If a `component` was supplied, it sets that component as the layout, passing the previous `Layout` in props so layouts can nest.
3. It calls `c.setRenderer(createRenderer(...))`, so later `c.render(content, props)` calls use it.
4. It calls `next()`.

The renderer built by `createRenderer` produces `<!DOCTYPE html>` by default, with `options.docType` able to replace it or set it to `false`. It wraps the page content in a `RequestContext.Provider` with the context object, so components can read the current request through `useRequestContext()`, and then assembles the document from the layout and the children.

Layouts compose because `jsxRenderer` can be applied in several route groups. An inner middleware's `component` receives the outer `Layout` as a prop, so a page layout can render the site layout around it.

## Invariants and consequences

- Escaping is applied in `toStringToBuffer`, so forgetting `raw` produces escaped output rather than injected markup; the reverse requires explicit `raw`.
- Components are invoked at `toString()` time, so side effects in component bodies happen in render order, and the same JSX object rendered twice runs its components twice.
- Streaming output is only as early as the shell: content outside a `Suspense` boundary is still produced before anything is flushed.
- Each `jsxRenderer` call replaces the request's renderer, and its `component` receives the previously set `Layout` as a prop, so nesting works through props rather than through a renderer stack.

## Representative tests

- `src/jsx/base.test.tsx`, `src/jsx/children.test.ts`, and `src/jsx/utils.test.ts` cover node creation, children handling, and attribute rules.
- `src/jsx/streaming.test.tsx` covers `renderToReadableStream` and `Suspense`.

## Related pages

<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JSX DOM Runtime and Hooks](/openwiki/jsx/dom-runtime.md)
<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)
