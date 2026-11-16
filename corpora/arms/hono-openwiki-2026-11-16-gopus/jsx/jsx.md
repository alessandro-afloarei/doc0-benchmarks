---
type: subsystem
title: JSX engine
description: How hono/jsx renders JSX to escaped HTML strings on the server (JSXNode, HtmlEscapedString buffers and callbacks), how async components, Suspense, ErrorBoundary and renderToReadableStream stream content, how JSX context is isolated per render, and how the hono/jsx/dom client renderer and React-compatible hooks work, plus the html/raw template helpers.
tags: [jsx, ssr, streaming, suspense, dom, hooks, html]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-cd0b8b53b9de5fc07f3cc003
    resource: repo://src/helper/css/index.ts
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-d860c877f7de8b98af4550ac
    resource: repo://src/jsx/components.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-a5a81210f9e7b4d9cf856445
    resource: repo://src/jsx/dom/server.ts
  - id: openwiki-source-15860ae9f46f1eef33005500
    resource: repo://src/jsx/jsx-runtime.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-5d094fe4130aabd010a4c6c1
    resource: repo://src/jsx/utils.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# JSX engine

Hono ships its own JSX implementation with no React dependency. It has two renderers that share one component model:

- **Server (string) renderer**: `src/jsx/*`, exported as `hono/jsx`, `hono/jsx/jsx-runtime` and `hono/jsx/streaming`. JSX becomes `JSXNode` objects, and calling `toString()` on a node produces HTML.
- **Client (DOM) renderer**: `src/jsx/dom/*`, exported as `hono/jsx/dom`, `hono/jsx/dom/client` and `hono/jsx/dom/server`. It renders into a virtual node tree, diffs against the real DOM, and supports hooks.

Shared symbols in `src/jsx/constants.ts` (`DOM_RENDERER`, `DOM_STASH`, `DOM_MEMO`, `DOM_INTERNAL_TAG`) let a single component carry both a server and a DOM implementation. For example, `Suspense[DOM_RENDERER] = SuspenseDomRenderer`.

## Escaped strings and callbacks (`src/utils/html.ts`)

The server renderer is built on **`HtmlEscapedString`**: a `String` object marked `isEscaped: true` that can carry `callbacks`.

- `raw(value, callbacks?)` creates such a string. The value is trusted, so it is never escaped again.
- `escapeToBuffer` escapes `& < > ' "`. Its algorithm is based on react-dom.
- Rendering writes into a `StringBuffer`: an array whose element `[0]` is the string accumulated so far, with pending Promises unshifted in front of it. `stringBufferToString` awaits those Promises and escapes any value that is not already marked escaped.
- **`HtmlEscapedCallback`s** are deferred work that runs in phases (`HtmlEscapedCallbackPhase.Stringify | BeforeStream | Stream`). `resolveCallback` and `resolveCallbackSync` run them, passing a `context` object unique to each JSX tree. The callbacks implement Suspense replacement, CSS injection (`hono/css`, see [Helpers](../helpers/helpers.md)), and similar features.

`c.html()` resolves callbacks before it builds the response (see [Context](../concepts/context-and-request.md)).

`hono/html` (`src/helper/html/index.ts`) provides the `html` tagged template:

- interpolated strings are escaped;
- numbers are inserted as-is;
- `null`, `undefined` and booleans are dropped;
- arrays are flattened;
- escaped strings and Promises are inserted without re-escaping.

The JSX precompile runtime uses this same function as `jsxTemplate`. That runtime (`jsx-runtime.ts`: `jsxTemplate`, `jsxAttr`, `jsxEscape`) supports Deno's `precompile` JSX mode, which is tested in `runtime-tests/deno-jsx`.

## Server rendering (`src/jsx/base.ts`)

- `jsx(tag, props, ...children)` and `jsxFn` create a `JSXNode` for an intrinsic tag, a `JSXFunctionNode` for a component, or a `JSXFragmentNode`. An invalid tag name throws.
- `JSXNode.toStringToBuffer` serializes attributes as follows:
  - Keys are normalized (`className` → `class`, `htmlFor` → `for`, and SVG attribute names inside `svg`). Invalid attribute names are skipped.
  - A `style` object becomes a CSS string.
  - Strings are escaped. Numbers and escaped values are inserted raw.
  - Boolean attributes in `booleanAttributes` render as `key=""`.
  - Promise attribute values are awaited later.
  - `dangerouslySetInnerHTML` becomes raw children. It cannot be combined with `children`.
  - Function props other than `on*` handlers or `ref` throw. Event handlers are ignored on the server.
  - Void tags (`emptyTags`) self-close.
- A **function component** is called with its children merged into `props`. A `null` or boolean result renders nothing. An escaped string is appended together with its callbacks. A returned Promise, i.e. an **async component**, is unshifted into the buffer, which makes `toString()` return a `Promise<string>`.
- `memo`, `Fragment`, `isValidElement`, `cloneElement`, `Children` and so on exist for React compatibility.

### Context isolation (`src/jsx/context.ts`)

`createContext(default)` and `useContext(ctx)` keep a stack of values for each render. `runWithRenderContext` isolates concurrent renders.

- When `AsyncLocalStorage` is available, it is used, so values propagate across `await`. It is obtained via `process.getBuiltinModule('node:async_hooks')` or `require`. Node ≥ 20.16, Deno, Bun, and Workers with `nodejs_compat` provide it.
- Without it, Hono falls back to a synchronous store and warns once. In that mode, `useContext()` called after an `await` in an async component returns the context's default value.
- When an async component suspends, `captureRenderContext()` snapshots the active context values and stores them on the resulting node as `suspendedContext`, so the subtree resumes with the same context.

## Streaming: Suspense, ErrorBoundary, renderToReadableStream

- **`Suspense`** (`src/jsx/streaming.ts`) renders its children. If any child is pending, either because it returned a Promise or because it threw one through `use()`, Suspense emits `<template id="H:n"></template>` followed by the fallback and `<!--/$-->`, and attaches a callback.
  - When the whole document is resolved as a string (the Stringify phase), the callback replaces the placeholder in the buffer.
  - When streaming (the Stream phase), it emits `<template data-hono-target="H:n">content</template>` followed by an inline `<script>` that swaps the content into place.
  - Script nonces come from `StreamingContext.Provider value={{ scriptNonce }}`.
- **`ErrorBoundary`** (`src/jsx/components.ts`) catches synchronous and asynchronous errors in its children. It renders `fallback` or `fallbackRender(error)` and calls `onError`. During streaming it uses the same template-and-script replacement as Suspense.
- **`renderToReadableStream(content, onError?)`** first enqueues the initial HTML (after the BeforeStream phase). It then runs every Stream-phase callback, enqueueing each resolved chunk, and repeats until no more callbacks are produced. Errors inside a callback are passed to `onError`, and that chunk becomes an empty string.

The `jsx-renderer` middleware (see [Built-in middleware](../middleware/built-in-middleware.md)) connects all of this to `c.render()`. It adds a doctype, provides `useRequestContext()`, and enables `stream: true` to respond with `renderToReadableStream`.

## Client DOM renderer (`src/jsx/dom/`)

- `render(jsx, container)`, and `createRoot(el).render()` / `hydrateRoot` in `client.ts`, call `buildNode`. That converts JSX into `NodeObject`s, after which `build` runs components and hooks and `apply` writes a `DocumentFragment` into the container.
- **Updates**: a state change calls `update(context, node)`. Updates are coalesced: only the last pending update for a node runs, after a microtask. `flushSync(cb)` runs updates synchronously. `startViewTransition` integrates with `document.startViewTransition`.
- **Hooks** (`src/jsx/hooks/index.ts`) are stored in each node's `DOM_STASH`:
  - `useState`, `useReducer`, `useEffect`, `useLayoutEffect` and `useInsertionEffect`;
  - `useMemo`, `useCallback`, `useRef`, `useId`, `useTransition` and `useDeferredValue`;
  - `useSyncExternalStore`, `use(promise)`, `forwardRef` and `useImperativeHandle`.

  The string renderer supports a subset of these. `use` throws its pending Promise, and Suspense catches it.
- `createPortal`, DOM `Suspense` and DOM `ErrorBoundary`, plus form and action intrinsic components (`intrinsic-element/`), round out the API.
- `hono/jsx/dom/server` provides React-style `renderToString`, which throws for async components, and `renderToReadableStream`.
- `hono/jsx/dom/css` is the client-side counterpart of `hono/css`.

## Tests

- Server: `src/jsx/index.test.tsx`, `streaming.test.tsx`, `components.test.tsx` and `context-isolation.test.ts`.
- DOM: `src/jsx/dom/*.test.tsx`, run under jsdom.
- Hooks: `src/jsx/hooks/dom.test.tsx` and `string.test.tsx`.
- Runtime variants: `runtime-tests/deno-jsx` covers the precompile and react-jsx modes, and `bun test --jsx-import-source` covers Bun.
