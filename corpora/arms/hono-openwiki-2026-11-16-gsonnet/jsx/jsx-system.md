---
type: subsystem
title: Hono JSX (Server, Streaming, DOM)
description: Hono's built-in JSX implementation — JSXNode string rendering with escaping and async children, AsyncLocalStorage-based context isolation, Suspense and renderToReadableStream streaming, React-compatible hooks, the jsx/dom client runtime, and the jsx-renderer middleware.
tags: [jsx, ssr, streaming, suspense, dom, hooks, context]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-0800a8fe36fdb9334a98c38d
    resource: repo://src/jsx/hooks/index.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Hono JSX

`src/jsx` is a self-contained JSX runtime with **three personalities** that share one authoring model:

1. **Server string renderer** (`hono/jsx`) — JSX produces `JSXNode` objects that stringify to escaped HTML (`HtmlEscapedString`), usable directly as `c.html(<App />)`.
2. **Streaming SSR** (`hono/jsx/streaming`) — `Suspense` + `renderToReadableStream`.
3. **Client DOM renderer** (`hono/jsx/dom`) — React-like virtual-node runtime that builds real DOM and supports hooks; `hono/jsx/dom/client` exports `createRoot`/`hydrateRoot`, `hono/jsx/dom/server` exports React-compatible `renderToString`/`renderToReadableStream`.

Compile configuration is via `jsxImportSource`: `hono/jsx` for server (`jsx-runtime.ts`, `jsx-dev-runtime.ts`) or `hono/jsx/dom` for the client; the Vitest config runs DOM tests under both import sources (see [Testing Strategy](../testing/testing.md)).

## Server rendering (`base.ts`)

- `jsx(tag, props, ...children)` strips `key` from props and calls `jsxFn`, which picks the node class: function components and registered intrinsic components (`intrinsic-element/components.ts`, e.g. `title`, `link`, `meta`, `script`, `style`, `form`, `input`, `button` which have special hoisting/metadata behaviour) become `JSXFunctionNode`; `svg` and `head` get wrapped in a namespace context so nested attributes are normalised for SVG; everything else is a plain `JSXNode`. `JSXNode` constructor rejects invalid tag names (`isValidTagName`).
- `JSXNode.toString()` runs `toStringToBuffer` into a `StringBufferWithCallbacks` — an array whose first element is the string being built and whose further elements may be promises — inside `runWithRenderContext`. Sync trees return a string immediately; trees containing async components return a `Promise<string>` (`stringBufferToString` awaits the buffer pieces).
- Attributes: strings are HTML-escaped (`escapeToBuffer`, derived from react-dom), style objects are serialized, numbers and already-escaped values are inserted raw, `false`/`null`/`undefined` skipped, boolean attributes emit `name=""` when true, promises are inserted in place via the buffer, `dangerouslySetInnerHTML` bypasses escaping (and cannot be combined with children), function-valued props are rejected unless they start with `on` or are `ref` (ignored on the server). Invalid attribute names are silently skipped, which avoids attribute-name injection.
- Void elements (`area`, `br`, `img`, `input`, …) with no children self-close.
- `HtmlEscapedString` carries an optional `callbacks` array. Callbacks are how components inject work into the final output (e.g. `Suspense` streaming scripts, `jsx-renderer` content). `resolveCallback(str, phase, preserveCallbacks, context)` runs them in phases `Stringify`, `BeforeStream`, `Stream` (`utils/html.ts`). `c.html()` uses `Stringify`.

## Context and request isolation (`context.ts`)

`createContext(default)` returns a component that also acts as `Provider`; `useContext` reads the innermost value. Because server rendering can be async and concurrent, values are stored per render:

- `runWithRenderContext(cb)` establishes a `WeakMap<Context, value[]>` store. If `AsyncLocalStorage` is obtainable (probed lazily through `process.getBuiltinModule('node:async_hooks')` or `process.mainModule.require`, avoiding a static import so bundlers for edge runtimes don't choke), the store is propagated across `await`s, giving true per-request isolation (Node ≥ 20.16, Deno, Bun, Workers with `nodejs_compat`).
- Without ALS a synchronous *fallback store* is used; context reads after an `await` in an async component fall back to the default, and a one-time `console.warn` explains this.
- `captureRenderContext()` snapshots current provider values so a suspended async subtree can resume with the right values (`JSXNode.suspendedContext`, used by `JSXFunctionNode` when a component returns a promise and any contexts exist, and by `Suspense`).
- Provider component pushes the value, stringifies its children, then pops — in `.finally` for async children — operating on the same array it pushed to.
- Every created context is also registered in `globalContexts` and given a DOM renderer (`createContextProviderFunction`) so one `createContext` works on both server and client.

## Suspense and streaming (`streaming.ts`)

`Suspense` (server version) renders children; if rendering throws a promise (the `use()` hook protocol) or any child is async, it returns the fallback wrapped in `<template id="H:n"></template>…<!--/$-->` markers plus a callback. In the `Stream` phase the callback awaits the children and emits `<template data-hono-target="H:n">…</template>` followed by a tiny inline script (optionally with a CSP `nonce` from `StreamingContext`) that replaces the fallback in the browser; in non-streaming (`Stringify`) mode it instead substitutes content into the buffer so non-streamed output has no scripts.

`renderToReadableStream(content, onError)` builds a `ReadableStream<Uint8Array>`: it resolves `BeforeStream` callbacks, enqueues the initial HTML, then runs `Stream` callbacks, recursively chaining any callbacks they return, closing when all settle; errors in a chunk are passed to `onError` (default `console.trace`) and produce an empty chunk, and `cancel()` stops enqueuing.

## `jsx-renderer` middleware (`middleware/jsx-renderer`)

`jsxRenderer(Component?, options?)` is the bridge to the core `Context`: it composes any previous layout (`c.getLayout()`), calls `c.setLayout` with a layout that wraps the component, and `c.setRenderer(...)`, so `c.render(<Page/>)` returns `c.html(docType + <RequestContext.Provider value={c}>layout</…>)`. Options: `docType` (default `<!DOCTYPE html>`, string or `false`) and `stream` (`true` sets chunked/identity-encoding headers and returns `c.body(renderToReadableStream(...))`; an object supplies custom headers). `useRequestContext()` lets components read the current Hono `Context` (throws `RequestContext is not provided.` outside a renderer).

## Hooks (`hooks/index.ts`) and the DOM runtime (`dom/`)

`hono/jsx` re-exports React-compatible hooks: `useState`, `useReducer`, `useEffect`/`useLayoutEffect`/`useInsertionEffect`, `useCallback`, `useMemo`, `useRef`, `useId`, `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `use`, `startTransition`, `forwardRef`, `useViewTransition`, etc. The same hooks module serves both runtimes: it works against the DOM runtime's node stash (`buildDataStack`, `DOM_STASH`), and when no DOM build is in progress (i.e. during server rendering) `useState` just returns the initial state with a no-op setter.

`dom/render.ts` (≈800 lines) builds a tree of node objects from JSX (`build`, `buildNode`), applies them to a `DocumentFragment` (`apply`) and replaces the container's children. Updates are asynchronous and coalesced: `update(context, node)` cancels an earlier pending update of the same node, and runs on a microtask unless inside `flushSync`, which collects updates in a set and runs them synchronously. Error boundaries use a context-level error handler stack; `createPortal` emits a special portal element. `dom/client.ts` implements `createRoot(el).render(node)` by wrapping the node in a component with a `useState` so repeated `render()` calls update state; `unmount()` renders `null` and forbids further updates; `hydrateRoot` simply calls `createRoot().render` (no true hydration — it re-renders and replaces children). `createRoot` options are not supported (warns).

`dom/css.ts` and `helper/css` provide `css`, `cx`, `keyframes`, `viewTransition` and `Style` (scoped class names with injected style elements), see [Helpers](../helpers/helpers.md).

## Practical notes
- Components may be `async`; the string renderer handles them by returning a promise from `toString()`, so always `await`/return the result to `c.html`.
- Rendering is not tied to `Context` — `jsx` works outside Hono, but `RequestContext` and the renderer are Hono-specific.
- The `jsx-runtime` precompile entry (`jsxTemplate` and `jsxAttr` in `jsx/utils.ts`, `jsxEscape` in `jsx/jsx-runtime.ts`) supports Deno's precompiled JSX transform (tested via `runtime-tests/deno-jsx`).
