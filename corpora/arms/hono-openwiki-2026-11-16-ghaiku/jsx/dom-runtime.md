---
type: concept
title: Client-side JSX DOM Runtime
description: How hono/jsx/dom renders JSX into live browser DOM - the root API (createRoot, hydrateRoot), the build-apply render pipeline over NodeObject trees, batched state updates and flushSync, portals, error boundaries and suspense, form and action hooks, and the server-side string and stream renderers that share the DOM component model.
tags: [jsx, dom, rendering, hooks, reconciliation, client, react-compatible]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-f725144320507455d4bff472
    resource: repo://src/jsx/dom/components.ts
  - id: openwiki-source-ece1edb56fe4ff9f55dee0e5
    resource: repo://src/jsx/dom/hooks/index.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
  - id: openwiki-source-0800a8fe36fdb9334a98c38d
    resource: repo://src/jsx/hooks/index.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Client-side JSX DOM Runtime

<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx-and-renderer.md] link "/openwiki/jsx/server-jsx-and-renderer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`hono/jsx/dom` is a second JSX renderer, separate from the string renderer used on the server (see [Server JSX and Streaming Rendering](/openwiki/jsx/server-jsx-and-renderer.md)). It turns the same JSX syntax into live DOM nodes, keeps component state between renders, and applies only the changes produced by each update. Its public surface is intentionally close to `react-dom/client`: `createRoot`, `hydrateRoot`, and hooks such as `useState` and `useEffect` have the same names and roughly the same behavior, and `reactAPICompatVersion` reports the compatible version string `19.0.0-hono-jsx`. The sources are in `src/jsx/dom/` (render, client, components, context, server, css) and `src/jsx/hooks/` (the hook implementations shared with the string renderer).

## Public Entry Points

- **`createRoot(element, options?)`** returns a `Root` with `render(children)` and `unmount()`. The first `render` call builds the tree and inserts it into `element`; later calls set the state of an internal wrapper component, which triggers an update rather than a second full render. Options are accepted for API compatibility, but a warning is logged because none are supported yet.
- **`hydrateRoot(element, node, options?)`** is a thin wrapper: it creates a root and calls `render`. The documentation comment says so explicitly: in `hono/jsx/dom` hydration is equivalent to rendering, so server-rendered markup is replaced rather than adopted.
- **`render(jsxNode, container)`** is the low-level function that the root uses. It wraps the node in a root object and calls `renderNode`.
- **`hono/jsx/dom/server`** exports `renderToString` and `renderToReadableStream` for producing HTML from DOM components on the server. `renderToReadableStream` warns about every option except `onError`.
<!-- openwiki: broken internal link [/openwiki/helpers/helper-modules.md] link "/openwiki/helpers/helper-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`hono/jsx/dom/css`** enables CSS-in-JS support (`css`, `cx`, `Style`) for DOM components; the server-side `css` helper is covered in [Helper Modules](/openwiki/helpers/helper-modules.md).

## Render Pipeline

Rendering has three phases, all operating on `NodeObject` trees rather than on DOM nodes:

1. **`buildNode`** converts a JSX child into a `NodeObject` (`tag`, `props`, `children`, and a `DOM_STASH` slot that stores per-component state). Strings and numbers become text nodes.
2. **`build(context, node, children?)`** invokes function components (`invokeTag`), normalizes their children through `getNextChildren`, and recurses. The build phase is pure with respect to the DOM: it decides the next tree but touches no elements.
3. **`apply(node, container, isNew)`** converts the built tree into real elements. `applyProps` maps JSX props to DOM attributes and event listeners. `eventAliasMap` renames a few React-style event names (`Change` to `Input`, `DoubleClick` to `DblClick`), and `nameSpaceMap` gives `svg` and `math` elements their XML namespaces. Form values and `select` selection are handled specially, and `findInsertBefore` places new nodes in the correct sibling position.

`renderNode` runs build and apply into a `DocumentFragment` and then replaces the container's children in one operation, so the initial paint of a tree is a single DOM mutation.

## Updates, Batching, and Cancellation

State changes do not render synchronously. A `setState` call from `useState` stores the new value in the node's stash and calls `update(context, node)`:

- `update` cancels a pending update for the same node if one exists. Only the most recent call runs, so several synchronous state changes produce one render.
- Outside a `flushSync` scope, the update awaits a microtask (`await Promise.resolve()`) before running, which lets multiple state changes in the same event handler coalesce.
- Inside `flushSync(callback)`, updates are collected in a set and executed synchronously when the callback returns. The set is a stack, so nested `flushSync` calls are handled.
- `updateSync` runs `build` again for the node and then applies the result to the existing DOM with `isNew = false`, so only the changed parts are patched.

Transitions are exposed through `startTransition`, `useTransition`, and `useDeferredValue`, and view transitions through `startViewTransition` and `useViewTransition`. `useViewTransition` installs an update hook that wraps the synchronous update, which is how the browser's view-transition API can animate the change.

## Hook State and Effects

Hooks read the current node from `buildDataStack`, so they must be called during a build. `useState` stores each hook's value in the node's stash array at an index that increments with each call, which is why hooks must be called in the same order on every render, as in React. If the new value is the same under `Object.is`, no update is scheduled. Effects are stored per component node in the stash. The runtime collects them during rendering and, when a node is removed, runs their cleanup functions.

Hooks available in the DOM runtime are the shared set from `src/jsx/hooks/index.ts`, including `useReducer`, `useRef`, `useMemo`, `useCallback`, `useContext`, `useId`, `useSyncExternalStore`, and `useImperativeHandle`. The DOM build adds form and action hooks in `src/jsx/dom/hooks/index.ts`:

- **`useFormStatus`** reads the pending state of the nearest form through `FormContext`.
- **`useOptimistic`** exposes an optimistic value that is replaced when the surrounding action completes.
- **`useActionState(fn, initialState, permalink?)`** keeps the action's result in component state, starting from `initialState`, and returns it with a wrapped action function. The `registerAction` helper in the same module is the hook for reporting pending work to `useFormStatus`.

## Context

`createContext` in `src/jsx/dom/context.ts` provides a DOM-specific context whose providers integrate with the build stack, so that a consumer reads the value of the nearest provider in the rendered tree.

## Errors and Suspense

Error and loading boundaries are ordinary components that install a handler on the fragment they return, under the `DOM_ERROR_HANDLER` key. The build phase pushes such a handler onto an error-handler stack when it encounters the fragment, and a child that throws during build is handled by the nearest handler on that stack:

- **`ErrorBoundary`** rethrows promises (so that suspense can see them), calls `onError` with other errors, and renders `fallbackRender(err)` or `fallback`.
- **`Suspense`** handles promise throws: it renders `fallback` and calls `retry` when the promise settles, which re-runs the build for the subtree. Non-promise errors are rethrown to an outer boundary.

If no boundary handles an error, it propagates out of `render` or the update call.

## Portals and Refs

`createPortal(children, container, key?)` produces a special node (`HONO_PORTAL_ELEMENT`) whose children are applied to a different container element while retaining their place in the component tree. The DOM runtime keeps per-element ref cleanup functions in `refCleanupMap` and runs them when the element is removed.

## Invariants and Failure Behavior

- Build does not create DOM elements; only the apply phase does. An error thrown during build therefore leaves the existing DOM as it was.
- Only the latest pending update for a node is applied, which means intermediate states may be skipped. Code that depends on every intermediate state must use `flushSync` or read state within the update callback.
- Rendering into a container that already has children replaces them, because hydration is equivalent to rendering.
- `unmount` on a root sets its state to `null`, and a later `render` call throws `Cannot update an unmounted root`.

## Extension Seams

- New intrinsic element behaviors are added through `applyProps`, `eventAliasMap`, and `nameSpaceMap` in `render.ts`.
- New hooks follow the stash pattern in `src/jsx/hooks/index.ts`; DOM-only hooks live in `src/jsx/dom/hooks/index.ts`.
- Error and suspense behavior is extended by installing a `DOM_ERROR_HANDLER` on a component's result.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/jsx/dom/*.test.tsx` covers rendering, components, context, CSS, and server output, and `src/jsx/hooks/dom.test.tsx` covers hook behavior in the DOM runtime. These run in the `jsx-runtime-default` Vitest project described in [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md).
