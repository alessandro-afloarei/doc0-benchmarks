---
type: subsystem
title: Client-side JSX (hono/jsx/dom) and Hooks
description: How hono/jsx/dom renders JSX in the browser — the virtual node model, build/apply reconciliation, keyed child matching, batched update scheduling, effects timing, transitions, portals, createRoot — and how the shared hooks in src/jsx/hooks behave during server rendering versus DOM rendering.
tags: [jsx, dom, hooks, client, rendering, react-compat]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-4e756dbcbfc4dea180c33ae2
    resource: repo://src/jsx/dom/intrinsic-element/components.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-0800a8fe36fdb9334a98c38d
    resource: repo://src/jsx/hooks/index.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Client-side JSX (hono/jsx/dom) and Hooks

`hono/jsx/dom` is a small React-compatible renderer for the browser. It shares components, context and hooks with the [server JSX runtime](server-jsx.md) but renders to real DOM nodes instead of strings. Entry points:

| Import | Contents |
| --- | --- |
| `hono/jsx/dom` (`src/jsx/dom/index.ts`) | `render`, hooks, `Suspense`, `ErrorBoundary`, `createContext`, `memo`, `createElement`, `cloneElement`, `Children`, `Fragment`/`StrictMode`, `flushSync`, `createPortal`, `version` |
| `hono/jsx/dom/jsx-runtime` | automatic JSX runtime for client bundles (`jsxImportSource: 'hono/jsx/dom'`) |
| `hono/jsx/dom/client` | `createRoot`, `hydrateRoot` (React DOM client-like API) |
| `hono/jsx/dom/server` | `renderToString`, `renderToReadableStream` (React DOM server-like API backed by the string renderer) |
| `hono/jsx/dom/css` | client-side variant of the [css helper](server-jsx.md#css-helper) |

## Node model

`src/jsx/dom/render.ts` converts JSX nodes into internal `NodeObject`s (or `NodeString`s for text) with short field names to keep the bundle small: `vC` (virtual children), `pC` (previous children), `vR` (children to remove), `e` (rendered DOM element), `c` (container), `pP` (previous props), `nN` (next node), plus a `DOM_STASH` tuple per component holding the hook index, hook state arrays (`useState`, effects, callbacks, memos, refs), captured context values, and the nearest error boundary/Suspense handler.

## Rendering pipeline

1. **render / renderNode** – `render(jsx, container)` wraps the tree in a fragment node, `build`s it, `apply`s it into a `DocumentFragment`, rewires container references and calls `container.replaceChildren(fragment)`.
2. **build** – For a function component, `invokeTag` resets the hook index, pushes `[context, node]` onto `buildDataStack` (this is how hooks find "the current component"), merges `defaultProps`, and calls the component. Children are flattened; each child is matched with an old child by **key + tag** when a key exists, otherwise by tag (text with text). Matched nodes reuse their DOM and stash; unmatched old nodes go to `vR` for removal.
3. **apply** – Creates/updates elements, applies props (attributes, properties, event listeners, `style`, `ref`, namespaces for SVG/MathML), inserts nodes in order and removes stale ones. Then it runs effects: `useInsertionEffect` callbacks immediately, `useLayoutEffect` callbacks synchronously after DOM mutation, and `useEffect` callbacks in a `requestAnimationFrame`.
4. **Errors** – If a component throws, the nearest `ErrorBoundary`/`Suspense` registered in the stash renders its fallback; a thrown promise (from `use()` or lazy data) triggers Suspense and a re-render when it settles.

## Update scheduling

`update(context, node)` schedules a re-render for one component:

- Only the **last** pending update per node runs; earlier pending promises resolve with `undefined` (cancelled).
- Updates are deferred to a microtask (`await Promise.resolve()`), so multiple `setState` calls in one tick are batched.
- Inside `flushSync(cb)`, updates are collected into a set and executed synchronously when `cb` returns.
- `updateSync` re-pushes captured context values, rebuilds the node, and applies it unless the update was aborted.

## Hooks (src/jsx/hooks/index.ts)

Hooks store state in `node[DOM_STASH][1][kind][hookIndex]`, so — as in React — they must be called unconditionally and in the same order. Implemented hooks: `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useCallback`, `useMemo`, `useRef`, `useId`, `use`, `useTransition`/`startTransition`, `useDeferredValue`, `useViewTransition`/`startViewTransition`, `useSyncExternalStore`, `useImperativeHandle`, `forwardRef`, `createRef`, `useDebugValue` (no-op). Form hooks `useFormStatus`, `useActionState` and `useOptimistic` live in `src/jsx/dom/hooks/index.ts`.

Key behaviors:

- `useState` setters skip updates when `Object.is(newState, oldState)`. During a transition (`startTransition`), the update is tied to the pending promise and a follow-up render is scheduled via `requestAnimationFrame` + `setTimeout`, allowing `useTransition`'s `isPending` flag to flip.
- `useEffect` and friends compare dependency arrays; when they change, the previous cleanup runs and the new effect is queued for the next `apply`. Cleanups also run when a node is removed.
- `use(promise)` caches resolved values/errors in a `WeakMap` keyed by the promise and throws the promise until it resolves (Suspense protocol).
- `startViewTransition` wraps the update in `document.startViewTransition` when available.

### Server vs client behavior

The same hooks module is imported by server JSX. When no component is being built by the DOM renderer (`buildDataStack` is empty), hooks degrade gracefully: `useState` returns the initial state and a no-op setter, effects are ignored, and `useSyncExternalStore` uses `getServerSnapshot` (throwing if it is not provided). This lets components be shared between `c.html(<App />)` on the server and `render(<App />, el)` in the browser. Note that there is **no true hydration**: `hydrateRoot` is `createRoot(...).render(...)`, which replaces the container's existing content.

## Intrinsic elements

`src/jsx/dom/intrinsic-element/components.ts` overrides `title`, `meta`, `link`, `script`, `style`, `form`, `input` and `button`. Metadata elements are hoisted into `document.head` (with de-duplication for `link`/`script`/`style` by attributes such as `href`/`precedence`), and `form` supports function `action`s that integrate with `useFormStatus`/`useActionState`.

## createRoot and portals

`createRoot(el).render(jsx)` mounts a root component holding the JSX in `useState`, so later `render()` calls are state updates; `unmount()` renders `null` and further renders throw `Cannot update an unmounted root`. `createPortal(children, container, key?)` renders children into another DOM container while preserving context.

## Testing

- `src/jsx/dom/*.test.tsx` and `src/jsx/hooks/dom.test.tsx` run under JSDOM.
- Vitest runs the DOM suites twice: `jsx-runtime-default` (JSX import source `src/jsx`) and `jsx-runtime-dom` (import source `src/jsx/dom`) to ensure both runtimes behave the same (see `vitest.config.ts` and [Testing Strategy](../testing/testing-strategy.md)).
- `src/jsx/hooks/string.test.tsx` covers hook behavior during string rendering.
