---
type: subsystem
title: JSX Runtime
description: How hono/jsx renders JSX to escaped HTML strings on the server (JSXNode, async components, context, Suspense/ErrorBoundary streaming), the jsx-runtime entrypoints, the jsxRenderer middleware, and the React-compatible client renderer and hooks in hono/jsx/dom.
tags: [jsx, ssr, streaming, suspense, dom, hooks]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-ece1edb56fe4ff9f55dee0e5
    resource: repo://src/jsx/dom/hooks/index.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# JSX Runtime

`src/jsx` is a JSX implementation with no dependencies. On the server it renders to strings, and in the browser (`hono/jsx/dom`) to the DOM. Both sides share one component model and a React-compatible hook API (`reactAPICompatVersion = '19.0.0-hono-jsx'`), so many React libraries work against it through aliasing.

## Entrypoints

| Import | Purpose |
| --- | --- |
| `hono/jsx` | `jsx`, `Fragment`, `memo`, `createContext`/`useContext`, `ErrorBoundary`, `Suspense`, hooks, `isValidElement`, `cloneElement` |
| `hono/jsx/jsx-runtime`, `hono/jsx/jsx-dev-runtime` | Automatic runtime (`jsxImportSource: "hono/jsx"`). Also exports `jsxTemplate`, `jsxAttr` and `jsxEscape`, used by Deno's *precompile* JSX transform |
| `hono/jsx/streaming` | `Suspense`, `renderToReadableStream`, `StreamingContext` (script nonce) |
| `hono/jsx/dom` (+ `/jsx-runtime`, `/client`, `/server`, `/css`) | Client-side renderer, `createRoot`/`hydrateRoot`-style client API, `renderToString`/`renderToReadableStream` re-exports, CSS helper for the DOM |
| `hono/jsx-renderer` | Middleware that installs a layout renderer on the Context |

## Server rendering model (`src/jsx/base.ts`)

`jsx(tag, props, ...children)` builds a tree of nodes:

- **`JSXNode`**: an intrinsic element. `toStringToBuffer` writes `<tag attrs>children</tag>`. String attribute values are HTML-escaped (`escapeToBuffer` from `src/utils/html.ts`). An object `style` is serialised to CSS text. Boolean attributes from the `booleanAttributes` list are emitted only when they are true. `dangerouslySetInnerHTML` injects raw HTML and cannot be combined with children. A function prop other than `on*` or `ref` throws. Event handlers are dropped silently on the server. Invalid tag names and attribute names are rejected or skipped, which protects against markup injection from dynamic tags. Void tags render as `<tag/>`.
- **`JSXFunctionNode`**: a component. It calls `tag(props)`. A `boolean`/`null`/`undefined` result renders nothing. An `HtmlEscaped` result (from a nested JSX node or the `html` template) is appended raw. A plain string is escaped. A **Promise** result (an async component) is pushed into the buffer as a pending entry.
- **`JSXFragmentNode`**: renders only its children.
- Some intrinsic tags (`title`, `script`, `style`, `link`, `meta`, `form`, `input`, … in `intrinsic-element/components.ts`) are mapped to components that support head hoisting and form actions. `svg` and `head` create a namespace context so that attribute names are converted correctly (for example `strokeWidth` → `stroke-width`).

`node.toString()` returns a `string` when everything is synchronous, and a `Promise<string>` when async components or callbacks are pending. That return value is an `HtmlEscapedString`. `c.html()` and `c.render()` accept both forms (see [Context and HonoRequest](../architecture/context-and-request.md)).

### Callbacks and phases

`HtmlEscapedString` values can carry `callbacks`. `resolveCallback` (`src/utils/html.ts`) runs them in phases: `Stringify` (1) for complete rendering, `BeforeStream` (2) and `Stream` (3) for streaming. `Suspense`, `ErrorBoundary` and the CSS helper (`hono/css`) use these callbacks to emit content late or to inject `<style>` and scripts.

### Context across async boundaries

`createContext`/`useContext` (`src/jsx/context.ts`) keep a render-scoped stack. Async components would lose that stack once rendering continues in a later microtask. `runWithRenderContext` and `captureRenderContext` save the context state, and suspended subtrees resume inside it (`suspendedContext`). Tests in `src/jsx/context-isolation.test.ts` check that concurrent renders do not leak context into each other.

## Streaming: `Suspense` and `ErrorBoundary`

`Suspense` (`src/jsx/streaming.ts`) first tries to render its children synchronously. If a child is async, or throws a promise (the `use()` hook), it emits `<template id="H:n"></template>` followed by the fallback and `<!--/$-->`, and registers a callback:

- In a **non-streaming** render (`BeforeStream`), the placeholder is later replaced inline with the resolved content.
- In **streaming** mode, the resolved content is sent at the end as `<template data-hono-target="H:n">…</template>` plus a small inline `<script>` that swaps it into place. `StreamingContext` provides a CSP nonce for these scripts.

`renderToReadableStream(content, onError)` turns a node or `HtmlEscapedString` into a `ReadableStream<Uint8Array>`. It first writes the shell, then flushes each Suspense resolution as it finishes. `ErrorBoundary` (`src/jsx/components.ts`) catches errors from synchronous and async children and renders `fallback` or `fallbackRender(error)`. In streaming mode it can replace content that has already streamed.

## `jsxRenderer` middleware

`jsxRenderer(Layout, { docType = true, stream })` (`src/middleware/jsx-renderer`) calls `c.setRenderer`. After that, `c.render(<Page/>, props)` wraps the content in the layout, prefixes `<!DOCTYPE html>` (unless disabled or replaced), and provides the Context through `RequestContext`, which components read with `useRequestContext()`. With `stream: true`, the response is produced with `renderToReadableStream` and `Transfer-Encoding: chunked` plus `text/html` headers. An object value sets custom headers instead. Nested `jsxRenderer` calls receive the parent layout as the `Layout` prop.

## Client renderer (`hono/jsx/dom`)

`src/jsx/dom/render.ts` (about 800 lines) is a small virtual-DOM reconciler. `render(node, container)` builds `NodeObject`s from the same `jsx` calls. When the automatic runtime is pointed at `hono/jsx/dom`, `jsxFn` installs DOM renderers for intrinsic components through a `DOM_RENDERER` symbol. The reconciler diffs by key, applies updates in batches (`update`, `flushSync`), runs effects, and supports `createPortal`.

Hooks (`src/jsx/hooks/index.ts`) include `useState`, `useReducer`, `useEffect`/`useLayoutEffect`/`useInsertionEffect`, `useMemo`, `useCallback`, `useRef`, `useId`, `use`, `useTransition`, `useDeferredValue`, `useViewTransition`, `forwardRef` and `useImperativeHandle`. On the server most hooks are inert: state never updates. The exceptions are `use`, which suspends through `Suspense`, and `useContext`. `src/jsx/dom/hooks` adds `useActionState`, `useFormStatus` and `useOptimistic`.

## Testing

The Vitest config runs JSX tests in three projects (see [Testing Strategy](../testing/testing-strategy.md)):

- the default `main` project, with `importSource: ./src/jsx`;
- `jsx-runtime-default` and `jsx-runtime-dom`, which run `src/jsx/dom/**` and `src/jsx/hooks/dom.test.tsx` against each runtime. The DOM tests use jsdom.

`runtime-tests/deno-jsx` covers Deno's precompile and react-jsx modes.
