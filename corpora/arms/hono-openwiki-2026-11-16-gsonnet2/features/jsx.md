---
type: feature
title: "JSX: Server Rendering, Streaming and DOM Runtime"
description: How Hono's built-in JSX turns JSXNode trees into escaped HTML strings with async buffers and callbacks, isolates context per render with AsyncLocalStorage, streams Suspense boundaries, runs a client-side virtual DOM, and integrates with c.render via jsxRenderer.
tags: [jsx, ssr, streaming, suspense, dom, hooks, jsx-renderer]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-5d094fe4130aabd010a4c6c1
    resource: repo://src/jsx/utils.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# JSX

Hono ships its own JSX implementation (`src/jsx`) with no React dependency. The same `hono/jsx` entry is used for **server-side string rendering**; `hono/jsx/dom` is a small React-like **client runtime**; `hono/jsx/streaming` adds Suspense/streaming; and the `jsxRenderer` middleware connects it to `c.render()` ([Context](../architecture/context-and-request.md)). Tests run in separate Vitest projects so the same suites verify both runtimes ([Testing](../operations/testing.md)).

## Server rendering (`src/jsx/base.ts`)

- `jsx(tag, props, ...children)` creates a `JSXNode` (or `JSXFunctionNode` for components, `JSXFragmentNode` for fragments). The constructor validates tag names (`isValidTagName`) and throws `Invalid JSX tag name` otherwise; attribute names are validated at render time and invalid ones are dropped.
- `JSXNode.toString()` renders into a `StringBufferWithCallbacks`, where `buffer[0]` is the string being built. **Strings are escaped** with `escapeToBuffer` (`& < > ' "`) unless they are already marked escaped (`HtmlEscapedString`, created by `raw()` or by prior JSX rendering). This is the XSS boundary: `html` tagged templates and `raw()` bypass escaping by design.
- **Async handling.** If a child is a Promise (async component), the buffer is restructured by `unshift('', promise)`; when any promise is present `toString()` returns a `Promise<string>` resolved by `stringBufferToString`, which walks the buffer in reverse, awaits, escapes non-escaped values, and merges `callbacks` from nested results. Synchronous trees return plain strings.
- **Callbacks.** `HtmlEscapedString` can carry `callbacks` that run in phases (`Stringify`, `BeforeStream`, `Stream`, defined in `src/utils/html.ts`). They let components emit extra output later (Suspense replacement scripts, CSS-in-JS style tags) without extra traversals. `resolveCallbackSync/resolveCallback` apply them.
- Attributes: boolean attributes listed in `booleanAttributes` render bare, `style` objects are serialised, SVG camel-case names are converted, and void elements (`emptyTags`) self-close.

## Render-scoped context (`src/jsx/context.ts`)

`createContext(default)` returns a component with `Provider` and a `values` stack. During server rendering `Provider` pushes/pops values around its children. To keep concurrent async renders from leaking values into each other, `runWithRenderContext` binds a per-render `WeakMap` store through `AsyncLocalStorage`, discovered lazily via `process.getBuiltinModule('node:async_hooks')` (Node ≥ 20.16, Deno, Bun, Workers with `nodejs_compat`) or the main-module `require` on older Node. Without ALS a global fallback store is used and a one-time warning is logged: `useContext` after an `await` in an async component falls back to the default value. `captureRenderContext()` snapshots the values so deferred work (e.g. Suspense continuations) can resume with the same context. `src/jsx/context-isolation.test.ts` covers these guarantees.

## Streaming and Suspense (`src/jsx/streaming.ts`)

- `Suspense` renders its children; if any child throws a Promise or produces a pending render, it immediately outputs `<template id="H:n"></template>` plus the `fallback` and registers a callback. When the content resolves, the callback (in the `Stream` phase) emits `<template data-hono-target="H:n">…</template>` and an inline script that swaps it into place; in the `Stringify`/non-streamed path the placeholder is replaced inside the buffer. A `StreamingContext` can carry a script `nonce` for CSP.
- `renderToReadableStream(content, onError)` produces a `ReadableStream<Uint8Array>`: it first resolves the content to the initial HTML (`BeforeStream` phase) and enqueues it, then runs the `Stream` callbacks, recursively following new callbacks until all pending pieces are flushed, then closes. Errors from pending pieces are reported via `onError` and replaced by an empty string; `cancel()` stops further enqueues.
- The same `Suspense` carries a `DOM_RENDERER` so the DOM runtime substitutes its own implementation.

## DOM runtime (`src/jsx/dom`, `src/jsx/hooks`)

- `createRoot(element).render(node)` / `render(node, container)` build a node tree with `buildNode` and `build`, which turn `JSXNode`s into `NodeObject`s with a **stash** (`DOM_STASH`) holding hook state, effect lists, captured context values and error-handler references. The build step reuses previous children (`pC`) and keys, and honours `memo`.
- `update()` is the scheduler for state changes: updates are keyed by node in `updateMap`, only the **last** pending update for a node runs, and execution is deferred one microtask (`await Promise.resolve()`) unless inside `flushSync`, which collects nodes into a set and updates them synchronously. Effects are run through `requestAnimationFrame`-based scheduling for passive effects.
- `createPortal`, `ErrorBoundary`, `Suspense` and `use()` (promise unwrapping that throws the promise to suspend) are supported.
- **Hooks** (`src/jsx/hooks`) include `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useRef`, `useCallback`, `useMemo`, `useId`, `useSyncExternalStore`, `useImperativeHandle`, `useTransition`, `useDeferredValue`, `useViewTransition` and `use`. They read the current node through `buildDataStack`, so they only work while a component is being built. On the server the same hook names exist in `hono/jsx` with simplified semantics.
- `hono/jsx/dom/css` provides CSS-in-JS for the DOM runtime, and `helper/css` provides the server counterpart ([Helpers](helpers.md)).

## jsxRenderer middleware (`src/middleware/jsx-renderer`)

`jsxRenderer(component?, options?)` is a middleware that (1) wraps the existing layout (`c.getLayout()`) with the supplied component, (2) installs a renderer via `c.setRenderer`, then calls `next()`. Calling `c.render(<Page/>, props)` then wraps content in the layout, prepends `<!DOCTYPE html>` (configurable via `docType`) and provides `RequestContext` so components can call `useRequestContext()` (throws `RequestContext is not provided.` outside a render). With `stream: true` it sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8` and `Content-Encoding: Identity` and returns `renderToReadableStream`; an object form supplies custom headers. Nested `jsxRenderer` calls compose layouts.
