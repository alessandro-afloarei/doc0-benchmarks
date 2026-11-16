---
title: "JSX DOM Rendering and Hooks"
---
## Overview

`hono/jsx/dom` renders the same JSX nodes in the browser. Instead of building a string it builds a tree of virtual nodes, compares it with the previous tree, and updates real DOM elements. It exposes a React-shaped API: `render`, `createRoot`, `hydrateRoot`, the hooks, `Suspense`, `ErrorBoundary`, portals and a `css` helper. The server renderer is in [[JSX Server Rendering]]; the node factory `jsx()` is shared, and the hooks in `src/jsx/hooks/index.ts` work in both runtimes by reading a stack that only the DOM renderer fills.

Sources: [src/jsx/dom/index.ts:6-45](repo://src/jsx/dom/index.ts#L6-L45), [src/jsx/hooks/index.ts:1-10](repo://src/jsx/hooks/index.ts#L1-L10)

## Entry points

`render(jsxNode, container)` wraps the node in an empty-tag root node and calls `renderNode`. `createRoot(element)` returns `{ render, unmount }`: the first `render` builds a root component that keeps the JSX in a `useState`, and later `render` calls just set that state, so the tree is updated, not replaced. `unmount` sets the state to `null`; rendering after that throws `Cannot update an unmounted root`. `hydrateRoot` simply creates a root and renders into it. Options for `createRoot` are not supported and only trigger a warning.

Sources: [src/jsx/dom/render.ts:796-799](repo://src/jsx/dom/render.ts#L796-L799), [src/jsx/dom/client.ts:23-89](repo://src/jsx/dom/client.ts#L23-L89)

`flushSync(callback)` runs the callback and applies the state updates it queued immediately, and `createPortal(children, container)` produces a node with the special `_hp` tag whose element is the given container.

Sources: [src/jsx/dom/render.ts:801-825](repo://src/jsx/dom/render.ts#L801-L825)

## Build, then apply

Rendering has two passes over `NodeObject`s, objects that extend a `JSXNode` with short-named fields: `vC` (virtual children), `pC` (previous children), `vR` (children to remove), `e` (the real element), `c` (container), `pP` (previous props) and a hook stash under `DOM_STASH`.

Sources: [src/jsx/dom/render.ts:41-65](repo://src/jsx/dom/render.ts#L41-L65)

`renderNode(node, container)` creates a fresh `Context` (an array holding the pending type, error state, update hook and an error-handler stack), runs `build`, then `apply` into a `DocumentFragment`, and finally `container.replaceChildren(fragment)`.

Sources: [src/jsx/dom/render.ts:783-794](repo://src/jsx/dom/render.ts#L783-L794), [src/jsx/dom/render.ts:91-106](repo://src/jsx/dom/render.ts#L91-L106)

**Build.** `build(context, node)` gets the node's children: for a component, `invokeTag` resets the hook index, pushes `[context, node]` onto `buildDataStack`, calls the component (using the `DOM_RENDERER` variant if it has one, and merging `defaultProps`) and pops the stack; for an element it takes `props.children`. Each child goes through `buildNode`, which turns strings and numbers into text nodes, drops booleans and nullish values, and gives component nodes an empty hook stash. The child is matched with an old child of the same `tag` (and `key` when there is one); a match keeps the old node's state, and unmatched old children go to `vR`.

Sources: [src/jsx/dom/render.ts:274-291](repo://src/jsx/dom/render.ts#L274-L291), [src/jsx/dom/render.ts:497-560](repo://src/jsx/dom/render.ts#L497-L560), [src/jsx/dom/render.ts:667-704](repo://src/jsx/dom/render.ts#L667-L704)

**Apply.** `apply` walks the built tree and creates or updates elements: `applyProps` sets attributes, styles, event listeners (names like `onClick` become `click`, with `Capture` variants) and refs, and nodes in `vR` are removed. Elements named `svg` and `math` get their XML namespace through a namespace context.

Sources: [src/jsx/dom/render.ts:164-272](repo://src/jsx/dom/render.ts#L164-L272), [src/jsx/dom/render.ts:364-481](repo://src/jsx/dom/render.ts#L364-L481), [src/jsx/dom/render.ts:19-27](repo://src/jsx/dom/render.ts#L19-L27)

## Hooks and the stash

A hook finds its component through `buildDataStack.at(-1)`. Each hook kind keeps an array in the node's stash (state, effects, callbacks, memos, refs) and uses the running hook index, so hooks must be called in the same order on every render. Outside a render (the stack is empty) the hooks degrade: `useState` returns its initial value with a no-op setter, `useEffect` does nothing, and `useCallback` and `useRef` return plain values. That is what lets components using hooks render on the server.

Sources: [src/jsx/hooks/index.ts:182-243](repo://src/jsx/hooks/index.ts#L182-L243), [src/jsx/hooks/index.ts:260-330](repo://src/jsx/hooks/index.ts#L260-L330)

| Hook | Behaviour in the code |
| --- | --- |
| `useState` | State per hook index; the setter accepts a value or updater function and skips the update when `Object.is` says it is unchanged |
| `useReducer` | Built on `useState` and `useCallback` |
| `useEffect`, `useLayoutEffect`, `useInsertionEffect` | Stored with their dependencies; when the dependencies changed, the previous cleanup runs and a new runner is recorded in a different slot per kind, to be run after applying |
| `useCallback`, `useMemo`, `useRef`, `useId` | Dependency-checked caches; `useId` returns `:r<counter>:` from `useMemo` |
| `use` | Reads a promise; throws the promise itself until it has settled, which `Suspense` catches, and throws a rejection |
| `useTransition`, `startTransition`, `useDeferredValue` | Run updates with a pending state through a pending stack |
| `startViewTransition`, `useViewTransition` | Wrap updates in `document.startViewTransition` |

Sources: [src/jsx/hooks/index.ts:119-176](repo://src/jsx/hooks/index.ts#L119-L176), [src/jsx/hooks/index.ts:245-258](repo://src/jsx/hooks/index.ts#L245-L258), [src/jsx/hooks/index.ts:288-330](repo://src/jsx/hooks/index.ts#L288-L330), [src/jsx/hooks/index.ts:332-366](repo://src/jsx/hooks/index.ts#L332-L366), [src/jsx/hooks/index.ts:54-99](repo://src/jsx/hooks/index.ts#L54-L99)

`useActionState`, `useOptimistic` and `useFormStatus` live in `src/jsx/dom/hooks` and are re-exported by the DOM entry point, together with `use`, `memo` and `flushSync`.

Sources: [src/jsx/dom/index.ts:11-39](repo://src/jsx/dom/index.ts#L11-L39)

## Updates and batching

The setter from `useState` calls `update(context, node)`. `update` records the node in a map, replacing any earlier pending update for it so only the latest runs, and by default waits a microtask (`await Promise.resolve()`) before running `updateSync`, so several setter calls in one tick cause one re-render. Inside `flushSync`, nodes are collected in a set and updated when the callback returns. `updateSync` rebuilds the node with the context values it captured and calls `apply` on its container.

Sources: [src/jsx/dom/render.ts:713-781](repo://src/jsx/dom/render.ts#L713-L781), [src/jsx/dom/render.ts:801-813](repo://src/jsx/dom/render.ts#L801-L813)

When a setter runs while a transition callback is active, the update uses the pending type (`1` for `startTransition`, `2` for `useTransition`), and `useTransition` returns `true` while the context is in the second kind. For `useDeferredValue` the new value is applied first as a quick update and then again from a `requestAnimationFrame` callback.

Sources: [src/jsx/hooks/index.ts:197-241](repo://src/jsx/hooks/index.ts#L197-L241), [src/jsx/hooks/index.ts:126-176](repo://src/jsx/hooks/index.ts#L126-L176)

## Context, Suspense and error boundaries

The DOM `createContext` makes a provider that, instead of pushing and popping around a string render, inserts two tiny internal nodes before and after the children which push and pop the value while the tree is built. Component nodes remember the context values active when they were created, so a later re-render builds with the same values.

Sources: [src/jsx/dom/context.ts:7-52](repo://src/jsx/dom/context.ts#L7-L52), [src/jsx/dom/render.ts:533-538](repo://src/jsx/dom/render.ts#L533-L538), [src/jsx/dom/render.ts:713-732](repo://src/jsx/dom/render.ts#L713-L732)

The DOM `Suspense` and `ErrorBoundary` are Fragments tagged with a `DOM_ERROR_HANDLER` function. During `build`, a child that carries such a handler is pushed on the context's handler stack, and an error thrown while building a descendant is passed to the closest handler. For `Suspense` the handler re-throws anything that is not a promise, retries the build when the promise settles and returns `fallback` in the meantime; for `ErrorBoundary` it calls `onError` and returns `fallbackRender(error)` or `fallback`.

Sources: [src/jsx/dom/components.ts:7-38](repo://src/jsx/dom/components.ts#L7-L38), [src/jsx/dom/render.ts:503-512](repo://src/jsx/dom/render.ts#L503-L512)

The same component functions carry a `DOM_RENDERER` property pointing to these implementations (set on the server versions in `streaming.ts`), which is how `invokeTag` swaps in the DOM version in the browser.

Sources: [src/jsx/streaming.ts:138](repo://src/jsx/streaming.ts#L138-L138), [src/jsx/dom/render.ts:277](repo://src/jsx/dom/render.ts#L277-L277)

## CSS

`src/jsx/dom/css.ts` exposes `css`, `cx`, `keyframes`, `viewTransition` and a `Style` component from a default context created by `createCssContext({ id })`. The class-name and style-string generation is shared with the server `hono/css` helper (`cssCommon`, `cxCommon`, `keyframesCommon` and `viewTransitionCommon` from `helper/css/common`); this file wraps them so the generated class name object stringifies to the CSS rules `Style` emits. See [[Built-in Helpers Catalogue]].

Sources: [src/jsx/dom/css.ts:180-263](repo://src/jsx/dom/css.ts#L180-L263)
