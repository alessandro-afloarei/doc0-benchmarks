---
type: architecture
title: JSX DOM Runtime and Hooks
description: How hono/jsx/dom turns JSX into a tree of NodeObject records, builds and applies them to real DOM nodes, schedules hook-driven updates through update() and a microtask queue, and exposes createRoot, render, createPortal, hooks such as useState and useActionState, and the server renderers used alongside it.
tags: [hono, jsx, dom, hooks, rendering, virtual-dom, hydration, client-side]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-9ae1cecb0f243d7efb9be5b9
    resource: repo://src/jsx/dom/client.ts
  - id: openwiki-source-f725144320507455d4bff472
    resource: repo://src/jsx/dom/components.ts
  - id: openwiki-source-1f80b6e582dfb336dc3e484b
    resource: repo://src/jsx/dom/index.ts
  - id: openwiki-source-a53c9802c74278a1cc296eae
    resource: repo://src/jsx/dom/render.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# JSX DOM Runtime and Hooks

<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`hono/jsx/dom` is a client-side renderer for the same JSX that Hono renders to strings on the server (see [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md)). It is a small virtual-DOM implementation. Components are plain functions that return JSX, and state lives in hook slots attached to a node in the tree. Its code is under `src/jsx/dom/` (about 2,000 lines across `render.ts`, `client.ts`, `context.ts`, `components.ts`, `server.ts`, `css.ts`, and the `hooks/` and `intrinsic-element/` directories), and the shared hook implementations it uses live in `src/jsx/hooks/index.ts`.

## Entry points

- `hono/jsx/dom` (`src/jsx/dom/index.ts`) re-exports the public API: `render`, `createPortal`, `flushSync`, `Fragment`, `Suspense`, `ErrorBoundary`, `createContext`, the shared hooks from `src/jsx/hooks`, the DOM-only hooks `useActionState`, `useFormStatus`, and `useOptimistic`, and React-compatible helpers such as `createElement`, `cloneElement`, `memo`, and `forwardRef`.
- `hono/jsx/dom/client` (`src/jsx/dom/client.ts`) exports `createRoot(element, options)`, which is not part of the `hono/jsx/dom` index. The `options` argument is accepted but any keys produce a `console.warn`, because root options are not yet supported.
- `hono/jsx/dom/server` (`src/jsx/dom/server.ts`) exports `renderToString` and `renderToReadableStream`, used to render the same components on the server. `renderToString` calls `element.toString()` and throws if the result is asynchronous, so async components need the streaming renderer.
- `hono/jsx/dom/jsx-runtime` and `jsx-dev-runtime` are the compiler entry points.

## Root creation

`createRoot` returns `{ render, unmount }`. The first `render` call does not render the JSX directly. It builds a wrapper component whose body is `useState(jsxNode)`, then calls `renderNode` on that wrapper. Keeping the state setter in the root means that later `render` calls update the wrapper's state through `setJsxNode`, which triggers the normal update path rather than re-running a full render. `unmount` sets the state to `null` and marks the root as unmounted; a later `render` on an unmounted root throws `Cannot update an unmounted root`.

## Node model

`render.ts` describes the tree with two record shapes:

- **`NodeObject`** represents an element or component. It carries the JSX fields (`tag`, `props`, `key`), the previous and next props (`pP`, `nN`), virtual children (`vC`), children to remove (`vR`), the DOM container (`c`) and the rendered element (`e`), and a hook stash under `DOM_STASH`. The stash holds the current hook index, the array of hook slots, local context values, and the nearest error boundary or suspense record.
- **`NodeString`** represents a text node with its content (`t`) and a dirty flag (`d`), plus the `Text` node once applied.

`buildNode(child)` converts a JSX child into one of these records. `build(context, node, children)` runs the component function for `NodeObject`s and reconciles the children against the previous children. `apply(node, container, isNew)` then writes the result to the DOM. Splitting build from apply lets a render compute the full tree before touching the DOM, and lets `update` skip the DOM work when a component's output is unchanged.

Intrinsic elements are applied through `applyProps`, which handles event names (for example, `onChange` is aliased to the native `input` event through `eventAliasMap`), namespaces for `svg` and `math` elements, attribute name mapping, form values, and `select` values through `applySelectValue`. Attribute errors that the browser raises for read-only properties are ignored by `isIgnorableAttributeError`.

## Initial render

`renderNode(node, container)` creates a context array, sets the "top-level render" flag, calls `build`, then builds the DOM into a `DocumentFragment` with `apply(node, fragment, true)`. The fragment replaces the container's children in one `replaceChildren` call, so the container is updated once. `render(jsxNode, container)` is the convenience wrapper that calls `buildNode` first. `flushSync(callback)` runs a callback and applies pending updates before returning.

## Hooks and updates

Hook state lives in the node's stash. `useState`, `useReducer`, `useEffect`, `useMemo`, `useCallback`, and `useRef` (all defined in `src/jsx/hooks/index.ts`) index into the stash slot array by a per-node counter that resets at each build. This is why hooks must be called unconditionally and in the same order, as in other hook-based frameworks.

A state setter calls `update(context, node)`, which is asynchronous:

1. It stores a resolver for the node in a `WeakMap`. If an update for the same node is already queued, the earlier promise is resolved with `undefined`, so only the most recent update runs.
2. Inside a batch (`currentUpdateSets` is non-empty, as set by `startTransition` or `flushSync`), the node is added to the batch set and runs when the batch flushes.
3. Otherwise it waits for one `Promise.resolve()` microtask, then runs `updateSync`, which builds the node again with the stashed values pushed in and applies only if the context is not in a deferred state.

This means several synchronous `setState` calls in one event handler produce a single rebuild on the next microtask. Components that suspend (`use` with an unresolved promise, or a component returning a promise) are handled through the context's error handler and suspense records stored in the stash.

## Hooks specific to the DOM

`src/jsx/dom/hooks/index.ts` adds hooks that depend on forms and transitions:

- `useActionState(fn, initialState, permalink?)` wraps a form action. It tracks a `FormStatus` (`pending`, `data`, `method`, `action`) and the latest returned state, and uses a permalink (`PERMALINK` constant) so server-rendered forms can be matched to their client state during hydration.
- `useOptimistic(state, reducer)` returns an optimistic value that is shown until the real state update finishes.
- `useTransition`, `startTransition`, `useViewTransition`, and `startViewTransition` in the shared hooks mark updates as non-urgent or wrap them in the browser View Transitions API when available.
- `useDeferredValue` returns a stale value during a pending update, and `useSyncExternalStore` subscribes to an external store.
- `useId` returns a stable id with a module-level counter, which is the same across server and client only if both render in the same order.

## Context

`src/jsx/dom/context.ts` provides `createContext`. Providers push a value onto a per-node list (`context[2]`), and `useContext` reads the nearest provider. `isSameContext` in `render.ts` decides whether a child can reuse a provider's value during an update. Context values are local to the subtree, which is why a component rendered through `createPortal` still reads the context of its JSX parent rather than its DOM parent.

## Portals and error boundaries

`createPortal(children, container, key?)` returns a node whose children are applied into another DOM container. `ErrorBoundary` (in `src/jsx/dom/components.ts`) marks its child with the `DOM_ERROR_HANDLER` symbol. When `render.ts` builds a subtree it looks for that marker, and an `ErrorHandler` receives the error together with a `retry` callback that rebuilds the subtree.

## Invariants and consequences

- DOM work happens only in `apply`. Changing state never writes to the DOM directly, and an update is safe to cancel because build and apply are separate.
- Hook order matters across renders; changing the number or order of hook calls under a condition breaks the stash index.
- `update` is the only asynchronous path. Code that needs the DOM immediately after a state change should use `flushSync`.
- Root options are ignored, so there is no per-root configuration yet.

## Representative tests

<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `src/jsx/dom/*.test.tsx` covers rendering, components, context, CSS, and server output. These tests run in their own Vitest project, `jsx-runtime-dom` (see [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md)).
- `src/jsx/hooks/dom.test.tsx` covers the hook behaviour that depends on the DOM runtime and is included in the same project.

## Related pages

<!-- openwiki: broken internal link [/openwiki/jsx/server-jsx.md] link "/openwiki/jsx/server-jsx.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [JSX Runtime and Server Rendering](/openwiki/jsx/server-jsx.md)
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Test Strategy and Runtime Test Matrix](/openwiki/testing/test-strategy.md)
