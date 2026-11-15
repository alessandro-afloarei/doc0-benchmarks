---
type: architecture
title: JSX DOM Runtime and Hooks
description: How hono/jsx/dom renders JSX in the browser — the virtual node model and keyed reconciliation in render.ts, microtask-batched updates and flushSync, hook storage shared with server rendering, effect scheduling, ErrorBoundary/Suspense via error-handler fragments, portals, head-element hoisting, form actions, and the React-compatible API surface.
tags: [jsx, dom, client, hooks, reconciliation, react-compat]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-f725144320507455d4bff472
    resource: repo://src/jsx/dom/components.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-0800a8fe36fdb9334a98c38d
    resource: repo://src/jsx/hooks/index.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# JSX DOM Runtime and Hooks

`hono/jsx` is primarily a server-side string renderer (see [JSX Server Rendering](server-rendering.md)). `hono/jsx/dom` (`src/jsx/dom/`) adds a small client-side renderer with a React-like API so the same components can run in the browser. It does **not** hydrate server markup: `hydrateRoot` is documented as equivalent to `render`, replacing the container's children.

## Entry points

| Module | Purpose |
| --- | --- |
| `hono/jsx/dom` (`dom/index.ts`) | `render`, hooks, `createContext`, `memo`, `ErrorBoundary`, `Suspense`, `createPortal`, `flushSync`, `useFormStatus`/`useActionState`/`useOptimistic`, `Children`, `isValidElement`, and a default export shaped like `React`. |
| `hono/jsx/dom/client` (`dom/client.ts`) | `createRoot(container)` → `{ render, unmount }` (rendering after unmount throws `Cannot update an unmounted root`) and `hydrateRoot`. |
| `hono/jsx/dom/server` (`dom/server.ts`) | `renderToString` / `renderToReadableStream` compatibility wrappers over the string renderer. |
| `hono/jsx/dom/css` (`dom/css.ts`) | Client variant of the css helper that injects `<style>` rules into the document. |
| `hono/jsx/dom/jsx-runtime`, `jsx-dev-runtime` | Automatic JSX runtime for `jsxImportSource: "hono/jsx/dom"`. |

Hooks live in `src/jsx/hooks/index.ts` and are shared with the server renderer: during string rendering there is no active build frame, so `useState` returns the initial value with a no-op setter and effects never run.

Components that need different behavior per environment carry a `DOM_RENDERER` property: the DOM build calls `tag[DOM_RENDERER] || tag`. This is how `Suspense`, `ErrorBoundary`, context providers, intrinsic head elements, and `memo`/wrapped components swap in their DOM implementations.

## Virtual node model (`dom/render.ts`)

JSX nodes are converted (`buildNode`) into mutable node objects with short field names to minimize bundle size:

- `vC` current virtual children, `pC` previous children, `vR` children to remove, `nN` next sibling node (for insert-before), `e` the real DOM element/text, `c` its container, `pP` previous props, `n` namespace (SVG/MathML), `f` force-build, `s` skip (memoized), `p` preserve-on-unmount (portals).
- `[DOM_STASH]` holds `[hookIndex, hookStorage, contextSnapshot, nearestErrorHandler]` for function components.
- Text nodes are `{ t, d }` (text, dirty).

Global state per render is a compact tuple `Context = [pendingType, gotError, updateHook, inViewTransition, isTopLevel, errorHandlerStack]`.

### Build (reconcile)

`build(context, node, children?)`:

1. Calls the component (`invokeTag`), pushing `[context, node]` on `buildDataStack` so hooks know which node they belong to and resetting the hook index to 0. `defaultProps` are merged.
2. Flattens array children and, for each child, finds a matching old child: **text with text; keyed nodes by `key` + `tag`; unkeyed nodes by the first old child with the same `tag`**. Matched nodes are reused (props swapped, `pP` kept); unmatched old children end up in `vR` for removal.
3. A reused function component is **skipped** (`s = true`) when it isn't force-built, its context snapshot is unchanged, and either the React Compiler memo condition holds (`o` original node identity) or `memo()`'s comparator (`DOM_MEMO`, default `shallowEqual`) says props are equal.
4. Recurses into non-skipped children and links `nN` pointers so `apply` can insert in order.

### Apply

`apply` / `applyNodeObject` walks the computed children, removing nodes in `vR` (running effect cleanups and ref cleanups), creating or moving elements with `insertBefore`, and patching props (`applyProps`: event listeners with capture suffix detection, attribute-name mapping, `style` strings or objects, `ref` callbacks with cleanup, controlled `value`/`checked`, `select` value handling, `dangerouslySetInnerHTML`). Afterwards collected effects run: `useInsertionEffect` callbacks, then `useLayoutEffect` synchronously, then `useEffect` in `requestAnimationFrame`.

The first render (`renderNode`) builds into a `DocumentFragment` and then `container.replaceChildren(fragment)`.

## Updates and scheduling

A state setter calls `update(context, node)`:

- Updates are coalesced per node via a `WeakMap`: a newer `update()` for the same node cancels the previous pending one.
- Normally the update runs after `await Promise.resolve()` (a microtask), so several `setState` calls in one tick produce one re-render of that subtree.
- Inside `flushSync(cb)`, updates are collected in a set and executed synchronously when `cb` returns.
- `startTransition` / `useTransition` mark updates as pending (type 1 global / 2 hook); `useState` setters then wait for the transition's promise and re-run the update with `setTimeout` after `requestAnimationFrame`. `useViewTransition`/`startViewTransition` wrap updates in `document.startViewTransition` when available.
- `updateSync` re-establishes the node's captured context values before rebuilding, then applies only that subtree.

Setters skip updates when `Object.is(newState, oldState)`.

## Hooks (`src/jsx/hooks/index.ts`)

Each component's stash stores hook data by kind (`STASH_SATE`, `STASH_EFFECT`, `STASH_CALLBACK`, `STASH_MEMO`, `STASH_REF`) indexed by call order, so hooks must be called unconditionally, as in React. Implemented: `useState`, `useReducer`, `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useCallback`, `useMemo`, `useRef`, `useId`, `useDebugValue` (no-op), `useImperativeHandle`, `useSyncExternalStore`, `useTransition`, `useDeferredValue`, `useViewTransition`, `use`, `createRef`, `forwardRef`, plus `useContext` from `src/jsx/context.ts`.

`use(promise)` caches settled values per promise in a map and otherwise **throws the promise** — the Suspense contract.

Form hooks in `dom/hooks/index.ts` (`useFormStatus`, `useActionState`, `useOptimistic`) are backed by the DOM `form` intrinsic component, which supports function `action`s and registers pending actions.

## Error boundaries and Suspense

In the DOM runtime both are Fragments tagged with a `DOM_ERROR_HANDLER` function:

- `ErrorBoundary` re-throws promises, otherwise calls `onError` and renders `fallbackRender(err)` or `fallback`.
- `Suspense` re-throws non-promises, otherwise schedules `retry` when the promise settles and renders `fallback`.

When `build` catches an error, it looks up the nearest handler captured in the node's stash, builds the fallback in place of the boundary's children, and aborts the rest of the build with an internal `cancelBuild` sentinel. The retry function re-runs `update` on the boundary node.

## Portals and head elements

- `createPortal(children, container, key?)` creates a node with a fixed element (`e: container`) and preserve flag so children render into another DOM element.
- `dom/intrinsic-element/components.ts` overrides `title`, `meta`, `link`, `script`, `style`, `form`, `input`, `button`. Head-ish elements are hoisted into `document.head`, de-duplicated (by key such as `href`/`src`), ordered by `precedence` for stylesheets, and `blocking="render"` resources suspend rendering until they load (via a promise map).

## Tests

`src/jsx/dom/index.test.tsx` (rendering and reconciliation), `src/jsx/dom/hooks/index.test.tsx`, `src/jsx/hooks/dom.test.tsx`, `src/jsx/dom/components.test.tsx` (ErrorBoundary/Suspense), `src/jsx/dom/intrinsic-element/components.test.tsx`, and `src/jsx/dom/client.test.tsx`. Deno-specific JSX runtime tests live in `runtime-tests/deno-jsx`.
