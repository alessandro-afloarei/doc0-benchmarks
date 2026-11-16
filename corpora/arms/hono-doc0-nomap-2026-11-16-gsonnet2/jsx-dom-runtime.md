---
title: "JSX DOM Runtime and Hooks"
---
## Overview

`hono/jsx/dom` is a small React-compatible runtime that renders the same JSX into real DOM nodes in the browser. It keeps its own virtual tree of `NodeObject`s, re-runs a component when its state changes, and applies only the difference to the document. The hooks (`useState`, `useEffect`, …) are in `src/jsx/hooks` and attach their data to the node that is currently being built. The server-side counterpart, which produces strings, is on [[JSX Server Rendering and Streaming]].

Sources: [src/jsx/dom/render.ts:41-65](repo://src/jsx/dom/render.ts#L41-L65), [src/jsx/hooks/index.ts:1-12](repo://src/jsx/hooks/index.ts#L1-L12), [src/jsx/dom/index.ts:1-5](repo://src/jsx/dom/index.ts#L1-L5)

## Entry points

`createRoot(element)` in `hono/jsx/dom/client` returns a root with `render` and `unmount`. The first `render(jsxNode)` calls `renderNode` with a node whose tag is a component holding the JSX in a `useState`; later `render` calls just set that state, so replacing the tree is an ordinary state update. After `unmount()` further renders throw `Cannot update an unmounted root`. Options for `createRoot` are not supported and trigger a warning.

Sources: [src/jsx/dom/client.ts:12-60](repo://src/jsx/dom/client.ts#L12-L60)

`render(jsxNode, container)` in `render.ts` does the same one-shot, wrapping the node in an empty-tag parent. `flushSync(callback)` collects the nodes updated during `callback` and applies their pending updates immediately instead of waiting for a microtask. `createPortal(children, container, key)` makes a node whose `e` (rendered element) is the target container, so its children are inserted there.

Sources: [src/jsx/dom/render.ts:796-825](repo://src/jsx/dom/render.ts#L796-L825)

## The virtual tree

A `NodeObject` is a `JSXNode` plus bookkeeping with short property names: `vC` (virtual children), `pC` (previous children), `vR` (children to remove), `e` (the rendered DOM element), `c` (the container), `nN` (next sibling) and `pP` (previous props). Component nodes also have `DOM_STASH`: a tuple holding the current hook index, the hook storage arrays, the JSX context values saved for this subtree and the nearest error boundary. Text children are `NodeString`s with text `t` and a dirty flag `d`.

Sources: [src/jsx/dom/render.ts:41-80](repo://src/jsx/dom/render.ts#L41-L80)

`buildNode(child)` converts one JSX child: it drops `undefined`, `null` and booleans, turns strings and numbers into `NodeString`s, and for a function component initialises `DOM_STASH` to `[0, []]`. For `svg`/`math` tags it wraps the children in a namespace context carrying the element namespace URI.

Sources: [src/jsx/dom/render.ts:667-704](repo://src/jsx/dom/render.ts#L667-L704)

## Build and apply

Rendering is two passes. `build(context, node)` is the build pass: it gets the node's children — by `invokeTag` for a component, or from `props.children` for an element — flattens nested arrays, calls `buildNode` on each, and matches each new child to a previous one: by `key` plus tag when a key exists, otherwise by tag. Matched children are updated in place; unmatched old ones are queued for removal in `vR`.

Sources: [src/jsx/dom/render.ts:497-560](repo://src/jsx/dom/render.ts#L497-L560)

`invokeTag` resets the hook index to 0, pushes `[context, node]` on `buildDataStack`, calls the component (using its `DOM_RENDERER` override if it has one, with `defaultProps` merged in) and pops the stack. Hooks read `buildDataStack.at(-1)` to find which node they belong to; outside a build they fall back to returning their initial value.

Sources: [src/jsx/dom/render.ts:274-291](repo://src/jsx/dom/render.ts#L274-L291), [src/jsx/hooks/index.ts:182-195](repo://src/jsx/hooks/index.ts#L182-L195)

`apply(node, container, isNew)` is the DOM pass. `applyNodeObject` removes nodes in `remove`, finds the insertion point among the container's child nodes, and for each new child creates or reuses the element, updates text content and applies props, then runs layout and insertion effect callbacks collected on the way. Event props named `onX` are mapped to DOM event names (`onClick` to `click`, with a `Capture` suffix for capture listeners) and cached in `eventCache`.

Sources: [src/jsx/dom/render.ts:113-134](repo://src/jsx/dom/render.ts#L113-L134), [src/jsx/dom/render.ts:386-430](repo://src/jsx/dom/render.ts#L386-L430)

## Updates and scheduling

When state changes, `update(context, node)` is called. It keeps one entry per node in `updateMap`, so only the last call in a batch runs (earlier promises resolve with `undefined`). Unless inside a `flushSync`, it waits one microtask (`await Promise.resolve()`) so several `setState` calls in one tick cause one rebuild. `updateSync` then pushes the node's saved context values, calls `build`, pops them, and calls `apply` unless a global pending render or an error cancels it; an optional update hook in `context[2]` (used by view transitions) wraps this step.

Sources: [src/jsx/dom/render.ts:713-781](repo://src/jsx/dom/render.ts#L713-L781), [src/jsx/dom/render.ts:801-813](repo://src/jsx/dom/render.ts#L801-L813)

`renderNode` builds a fresh `Context` tuple (error-handler stack at index 5, top-level flag at index 4), runs `build`, applies the tree into a `DocumentFragment` and swaps it into the container with `replaceChildren`.

Sources: [src/jsx/dom/render.ts:783-794](repo://src/jsx/dom/render.ts#L783-L794)

## Hooks

Every hook that keeps data uses the same pattern: look up the current node on `buildDataStack`, take its slot array for that hook type (`STASH_SATE`, `STASH_EFFECT`, `STASH_CALLBACK`, `STASH_MEMO`, `STASH_REF`) and index into it with `node[DOM_STASH][0]++`. Because the index is the call order, hooks must be called in the same order each render.

Sources: [src/jsx/hooks/index.ts:8-12](repo://src/jsx/hooks/index.ts#L8-L12), [src/jsx/hooks/index.ts:182-195](repo://src/jsx/hooks/index.ts#L182-L195)

| Hook | Behaviour |
| --- | --- |
| `useState` | Stores `[value, setter]`; the setter applies functional updates, skips the update when `Object.is` says the value is unchanged, and otherwise calls `update`; during a transition it defers the follow-up update with `requestAnimationFrame` and `setTimeout` |
| `useReducer` | Built on `useState` and `useCallback` |
| `useEffect`, `useLayoutEffect`, `useInsertionEffect` | Share `useEffectCommon`: when `deps` changed (`isDepsChanged`), the previous cleanup runs and a new runner is stored in the slot for that effect kind, to be run by the apply pass |
| `useCallback`, `useMemo`, `useRef` | Cache by deps or by slot |
| `use(promise)` | Throws the promise until it resolves; the result is cached in a `WeakMap`; a rejection is rethrown |

Sources: [src/jsx/hooks/index.ts:182-258](repo://src/jsx/hooks/index.ts#L182-L258), [src/jsx/hooks/index.ts:260-346](repo://src/jsx/hooks/index.ts#L260-L346)

`startTransition`, `useTransition`, `useDeferredValue`, `startViewTransition` and `useViewTransition` build on `pendingStack` and the update hook so that updates inside a transition are marked pending, and view transitions call `document.startViewTransition` when it exists, running the callback directly otherwise.

Sources: [src/jsx/hooks/index.ts:36-155](repo://src/jsx/hooks/index.ts#L36-L155)

## Error boundaries and Suspense

On the DOM side, `ErrorBoundary` and `Suspense` return a fragment tagged with a `DOM_ERROR_HANDLER` function. `build` detects that marker on a node's first child and pushes `[context, handler, node]` onto the context's error-handler stack. An error or promise thrown inside the subtree is handled by the closest handler: `ErrorBoundary`'s handler rethrows a promise, otherwise calls `onError` and returns `fallbackRender(err)` or `fallback`; `Suspense`'s handler rethrows anything that is not a promise, and for a promise it schedules `retry` with `err.finally(retry)` and returns `fallback`. That is how `use(promise)` suspends in the browser.

Sources: [src/jsx/dom/components.ts:7-39](repo://src/jsx/dom/components.ts#L7-L39), [src/jsx/dom/render.ts:503-512](repo://src/jsx/dom/render.ts#L503-L512)

The server versions of these components set a `DOM_RENDERER` property pointing at the DOM versions (`Suspense` does this in `src/jsx/streaming.ts`), so the same imported component works on both sides: `invokeTag` prefers `node.tag[DOM_RENDERER]`.

Sources: [src/jsx/streaming.ts:138](repo://src/jsx/streaming.ts#L138), [src/jsx/dom/render.ts:274-277](repo://src/jsx/dom/render.ts#L274-L277)

## Compatibility surface

`src/jsx/dom/index.ts` exports a React-shaped API — `createElement`, `cloneElement`, `memo`, `Fragment`, the hooks above plus `useActionState`, `useFormStatus` and `useOptimistic`, `createPortal`, `flushSync`, `Suspense`, `ErrorBoundary`, `createContext` — so libraries written for React can be pointed at it.

Sources: [src/jsx/dom/index.ts:6-60](repo://src/jsx/dom/index.ts#L6-L60)
