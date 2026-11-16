---
type: concept
title: Server JSX and Streaming Rendering
description: How Hono's server-side JSX runtime builds JSXNode trees and serializes them to escaped HTML strings or streams - tag validation, the jsx factory and its props and children handling, function and fragment nodes, async components and their context capture, streaming Suspense and ErrorBoundary, renderToReadableStream, memo, and the jsx-renderer middleware with layouts and the render function on the context.
tags: [jsx, server-rendering, streaming, suspense, layout, middleware, html, escaping]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-d860c877f7de8b98af4550ac
    resource: repo://src/jsx/components.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Server JSX and Streaming Rendering

<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Hono's server JSX runtime turns JSX expressions into `JSXNode` objects and serializes them to HTML. It is independent of the router: a handler returns `c.html(<Page />)`, a middleware installs a layout, or a stream is produced with `renderToReadableStream`. The code is in `src/jsx/` (`base.ts` for nodes and the factories, `components.ts`, `streaming.ts`, `context.ts`, `utils.ts`) and `src/middleware/jsx-renderer/index.ts`. The client-side counterpart is described in [Client-side JSX DOM Runtime](/openwiki/jsx/dom-runtime.md).

## Node Construction

`jsx(tag, props, ...children)` is the factory the TypeScript JSX transform calls (through `jsx-runtime` and `jsx-dev-runtime`). It moves a `key` prop to the node, sets `props.children` to a single child or to an array, and delegates to `jsxFn`. `jsxFn` returns a `JSXFunctionNode` when the tag is a function component, and a `JSXNode` otherwise. The first call to `jsxFn` also registers the DOM renderer hooks on intrinsic element definitions so the same element definitions work for both runtimes.

`JSXNode` validates its tag: a string tag must pass `isValidTagName`, and anything else throws `Invalid JSX tag name`. Every node carries `isEscaped: true`, which tells the string builder that its output is already HTML and must not be escaped again. Nodes expose `type`, `props`, `key`, and `children`, and a compatibility surface that libraries relying on React internals use.

Serialization is done by `toStringToBuffer(buffer)`, which appends to a string buffer that can also hold pending promises and callbacks. The buffer is turned into a string by `stringBufferToString`, and `toString()` returns either a string or a promise of one when an async component is involved.

Node types:

- **`JSXNode`** renders an element: attributes are escaped with `escapeToBuffer`, boolean attributes are rendered from `booleanAttributes`, `style` objects are converted by `styleObjectForEach`, and children are rendered recursively.
- **`JSXFunctionNode`** calls the component with its props (with `children` assembled from the child list) and then renders the result. A `null`, `undefined`, or boolean result renders nothing. A promise result is inserted as a pending buffer entry. A `JSXNode` result is rendered in turn, and a string or number is escaped unless it is already marked escaped.
- **`JSXFragmentNode`** renders its children without a wrapping element.

## Escaping

Text and attribute values pass through `escapeToBuffer`, which escapes HTML special characters. Values produced by `raw` or by the `html` tagged template carry `isEscaped` and are inserted as-is. This is the mechanism that keeps interpolated user input safe by default: only values with the escaped marker bypass the escaper.

## Async Components and Context Capture

A function component may return a promise. In the synchronous render path, a promise is pushed into the buffer and resolved later by the streaming or string function. When a promise is returned inside a render that has a context stack (for example, inside a context provider), `JSXFunctionNode` captures the render context with `captureRenderContext()` and attaches a restore function to the resolved node (`suspendedContext`). When the subtree resumes, `runWithRenderContext` restores the context values that were active at the suspension point, so `useContext` in the resumed subtree sees the right providers. `createContext` and `useContext` in `src/jsx/context.ts` implement this store.

`memo(component, propsAreEqual?)` caches the rendered result of a component and reuses it when `shallowEqual` (or the supplied comparator) says the props are unchanged. Only components using `memo` benefit; the string renderer otherwise re-renders on every call.

## Streaming Suspense and ErrorBoundary

Two server components handle asynchronous children:

- **`Suspense`** (in `src/jsx/streaming.ts`) renders its children inside a temporary build-data frame so that hooks such as `use` have a node to attach to. If a child throws a promise, the Suspense emits the `fallback` immediately and, when the promise settles, re-renders the child with the captured context. Each Suspense boundary therefore becomes a point where the stream can emit placeholder markup first and fill in the content later.
<!-- openwiki: broken internal link [/openwiki/jsx/dom-runtime.md] link "/openwiki/jsx/dom-runtime.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`ErrorBoundary`** (in `src/jsx/components.ts`) renders its children to strings. If rendering throws, `onError` is called and `fallbackRender` or `fallback` is rendered in its place. The same export also carries the DOM variant under `DOM_RENDERER`, so the boundary behaves consistently when it is rendered on the client (see [Client-side JSX DOM Runtime](/openwiki/jsx/dom-runtime.md)).

Both components read the optional `StreamingContext` and, when it supplies a `scriptNonce`, add that nonce to the inline `<script>` tags they emit.

## `renderToReadableStream`

`renderToReadableStream(content, onError = console.trace)` in `src/jsx/streaming.ts` returns a `ReadableStream<Uint8Array>`. It:

1. Converts a `JSXNode` to a string or promise with `toString()`.
2. Resolves the `BeforeStream` callback phase, enqueues the static part of the markup immediately, and records any pending promises.
3. Waits for each pending promise. When a promise resolves, its text is enqueued, after running `BeforeStream` callbacks on it and then `Stream` callbacks that may return further pending promises (which are queued in the same way).
4. Catches a rejected promise, logs it, passes the error to `onError`, and enqueues an empty string in its place, so one failing Suspense boundary does not abort the whole stream.
5. Stops enqueuing when the reader is cancelled, which is tracked by a `cancelled` flag.

Because chunks are enqueued in arrival order, a Suspense fallback appears before its resolved content. Each resolved Suspense result is sent as a `<template data-hono-target="H:<n>">` followed by an inline script that replaces the placeholder element with id `H:<n>` with the template's content and removes the fallback markers.

## The `jsx-renderer` Middleware

`jsxRenderer(component?, options?)` is a middleware that installs a renderer on the context. For each request:

- It reads the existing layout (`c.getLayout()`), falling back to `Fragment`.
- If a `component` is given, it sets a layout that calls the component with the page props, the `Layout` component, and the context.
- It calls `c.setRenderer(createRenderer(...))`, so that `c.render(children, props)` in a handler uses the layout.

The renderer builds the document as follows. `docType` defaults to `<!DOCTYPE html>`, can be replaced with a string, or disabled with `false`. The children are wrapped in the layout component and in a `RequestContext.Provider`, so `useRequestContext()` inside any component returns the current `Context`. When `options.stream` is set, the renderer sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8`, and `Content-Encoding: Identity` (or the headers you supply as an object) and returns `c.body(renderToReadableStream(body))`. Otherwise it returns `c.html(body)`.

`options` can also be a function of the context, so one middleware can choose streaming or doctype per request. `useRequestContext()` throws `RequestContext is not provided.` when called outside a rendered tree.

## Failure Behavior

- An exception thrown by a synchronous component propagates to the caller of `c.html` or `c.render`, unless it is inside a Suspense or ErrorBoundary.
- A rejected promise in a streamed Suspense is logged and replaced with an empty string; the rest of the stream continues.
- An unsupported tag name fails at node construction, before any output is produced.

## Extension Seams

- Components can be made streaming-aware by returning promises and wrapping them in `Suspense`.
- Custom layouts are added with `jsxRenderer(component)`; nested routes can override the layout through `c.setLayout`.
- `StreamingContext` supplies values, such as the script nonce, to every streaming component below a provider.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/jsx/index.test.tsx`, `src/jsx/streaming.test.tsx`, `src/jsx/components.test.tsx`, `src/jsx/context-isolation.test.ts`, and `src/middleware/jsx-renderer/index.test.tsx` cover serialization, streaming order, and context isolation (see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md)).
