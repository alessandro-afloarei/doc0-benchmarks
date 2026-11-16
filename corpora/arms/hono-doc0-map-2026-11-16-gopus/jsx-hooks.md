---
title: "JSX Hooks"
---
## Overview

`hono/jsx` exports React-style hooks so that the same components can be rendered to HTML on the server and kept interactive in the browser with `hono/jsx/dom`. The hooks live in `src/jsx/hooks`, and they work entirely through the DOM renderer's build stack: while the DOM renderer builds a function component, it pushes `[context, node]` onto `buildDataStack`, and each hook reads the top entry to find where to store its state. During server rendering that stack is empty, and every hook falls back to a stateless answer.

Sources: [src/jsx/hooks/index.ts:1-13](repo://src/jsx/hooks/index.ts#L1-L13), [src/jsx/dom/render.ts:82-106](repo://src/jsx/dom/render.ts#L82-L106), [src/jsx/index.ts:12-33](repo://src/jsx/index.ts#L12-L33)

This page describes the shared hooks. The form hooks `useActionState`, `useFormStatus` and `useOptimistic` are on [[DOM Elements, Forms and CSS]], and how the DOM renderer builds and patches nodes is on [[Client-Side DOM Rendering]].

Sources: [src/jsx/dom/hooks/index.ts:1-91](repo://src/jsx/dom/hooks/index.ts#L1-L91)

## Where hook state lives

Every function-component node carries a `DOM_STASH` of `[hookIndex, stash]`. The stash is an array of arrays, one per kind of hook: state, effects, callbacks, memos and refs. Each hook call takes the next index with `node[DOM_STASH][0]++` and keeps its data at that index of its kind's array, so, as in React, hooks must be called in the same order on every render.

Sources: [src/jsx/hooks/index.ts:8-20](repo://src/jsx/hooks/index.ts#L8-L20), [src/jsx/dom/render.ts:40-65](repo://src/jsx/dom/render.ts#L40-L65), [src/jsx/hooks/index.ts:188-197](repo://src/jsx/hooks/index.ts#L188-L197)

| Hook | Kept in the stash | Server behaviour |
| --- | --- | --- |
| `useState(initial)` | `[value, setter]` | Returns the initial value and a no-op setter |
| `useReducer(reducer, arg, init?)` | Built on `useState` and `useCallback` | Initial state, no-op dispatch |
| `useEffect`, `useLayoutEffect`, `useInsertionEffect` | `[deps, layout, cleanup, effect, insertion]` | Never run |
| `useCallback(fn, deps)` | `[fn, deps]` | Returns `fn` |
| `useMemo(factory, deps)` | `[value, deps]` | Calls `factory` each time |
| `useRef(initial)` | `{ current }` | A new object |
| `useId()` | A `useMemo` of `:r<n>:` | A new id per call |

Sources: [src/jsx/hooks/index.ts:178-258](repo://src/jsx/hooks/index.ts#L178-L258), [src/jsx/hooks/index.ts:260-366](repo://src/jsx/hooks/index.ts#L260-L366)

Dependencies are compared with `!==` element by element; missing deps on either side count as changed, so a hook without deps recomputes every render.

Sources: [src/jsx/hooks/index.ts:27-34](repo://src/jsx/hooks/index.ts#L27-L34)

## Updating state

The setter returned by `useState` accepts a value or an updater function. It does nothing when the new value is `Object.is` equal to the current one. Otherwise it stores the value and calls `update(context, node)` on the component's node.

Sources: [src/jsx/hooks/index.ts:197-243](repo://src/jsx/hooks/index.ts#L197-L243)

`update` batches: it records the latest update for each node and waits one microtask, so several `setState` calls in the same tick produce one re-render of that component, and an older pending update for the node is cancelled. `flushSync(callback)` skips the wait and applies the updates queued inside the callback at once.

Sources: [src/jsx/dom/render.ts:735-781](repo://src/jsx/dom/render.ts#L735-L781), [src/jsx/dom/render.ts:799-811](repo://src/jsx/dom/render.ts#L799-L811)

The re-render rebuilds the component, compares its new virtual children with the old ones and applies the differences to the DOM ([[Client-Side DOM Rendering]]).

Sources: [src/jsx/dom/render.ts:713-733](repo://src/jsx/dom/render.ts#L713-L733)

## Effects

`useEffect`, `useLayoutEffect` and `useInsertionEffect` share `useEffectCommon`, which differs only in the slot the effect is put in. When the deps changed, the previous cleanup runs right away and a runner is stored that will call the effect and keep its returned cleanup.

Sources: [src/jsx/hooks/index.ts:260-297](repo://src/jsx/hooks/index.ts#L260-L297)

After the DOM renderer applies a component's changes, it collects these runners and calls insertion effects first, then layout effects synchronously, then regular effects in a `requestAnimationFrame` callback. When a node is removed, every effect cleanup of that node runs.

Sources: [src/jsx/dom/render.ts:470-482](repo://src/jsx/dom/render.ts#L470-L482), [src/jsx/dom/render.ts:340-343](repo://src/jsx/dom/render.ts#L340-L343)

`useImperativeHandle(ref, create, deps)` is an effect that sets `ref.current = create()` and resets it to `null` on cleanup. `forwardRef(Component)` passes the `ref` prop to the component as its second argument. `createRef()` returns `{ current: null }`.

Sources: [src/jsx/hooks/index.ts:371-395](repo://src/jsx/hooks/index.ts#L371-L395)

## Transitions and deferred values

`startTransition(callback)` and the setter from `useTransition()` run the callback with an entry on `pendingStack`. A state update made inside it is rendered with a pending type: `1` (global) for `startTransition`, `2` (hook) for `useTransition`. The returned `isPending` is `true` while the component renders in that hook context. When the callback returns a Promise, the pending state lasts until it settles, and a rejection is rethrown during the next render so an error boundary can catch it.

Sources: [src/jsx/hooks/index.ts:101-155](repo://src/jsx/hooks/index.ts#L101-L155), [src/jsx/hooks/index.ts:206-236](repo://src/jsx/hooks/index.ts#L206-L236)

After a transition update, the setter schedules a follow-up render with `requestAnimationFrame` and `setTimeout`, skipped if the node was rendered again in the meantime, so the pending flag can turn off.

Sources: [src/jsx/hooks/index.ts:213-236](repo://src/jsx/hooks/index.ts#L213-L236)

`useDeferredValue(value, initialValue?)` keeps a pair of the shown and the latest value. When `value` changes, it returns the old value now and schedules a low-priority update through a temporary update hook that switches to the new value after rendering.

Sources: [src/jsx/hooks/index.ts:157-176](repo://src/jsx/hooks/index.ts#L157-L176)

`startViewTransition(callback)` makes the updates in the callback go through `document.startViewTransition` when the browser has it, and run directly otherwise. `useViewTransition()` returns `[isUpdating, startViewTransition]`, where `isUpdating` is `true` during the transition's render and a second render runs after it finishes.

Sources: [src/jsx/hooks/index.ts:36-99](repo://src/jsx/hooks/index.ts#L36-L99)

## use and external stores

`use(promise)` returns the value of a settled Promise, or throws its error. While the Promise is pending, `use` throws the Promise itself, and records the outcome in a `WeakMap` so the next call returns it. A thrown Promise is caught by `Suspense`, which waits for it and renders again, on the server ([[Suspense and Streaming JSX]]) as well as in the DOM.

Sources: [src/jsx/hooks/index.ts:22-25](repo://src/jsx/hooks/index.ts#L22-L25), [src/jsx/hooks/index.ts:332-346](repo://src/jsx/hooks/index.ts#L332-L346), [src/jsx/streaming.ts:60-85](repo://src/jsx/streaming.ts#L60-L85)

Because the outcome is keyed by the Promise object, the same Promise must be passed on the retry; a Promise created inside the component would be new on every render.

Sources: [src/jsx/hooks/index.ts:332-346](repo://src/jsx/hooks/index.ts#L332-L346)

`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)` keeps a snapshot in state and subscribes in an effect, updating the state on every notification. On the server it returns `getServerSnapshot()`, and throws `getServerSnapshot is required for server side rendering` without one. In the DOM, when the component is built during the top-level render that mounts a tree and `getServerSnapshot` is given, it starts from the server snapshot and switches to `getSnapshot()` in the effect.

Sources: [src/jsx/hooks/index.ts:397-425](repo://src/jsx/hooks/index.ts#L397-L425), [src/jsx/dom/render.ts:91-99](repo://src/jsx/dom/render.ts#L91-L99), [src/jsx/dom/render.ts:783-790](repo://src/jsx/dom/render.ts#L783-L790)

`useDebugValue` exists so that code written for React does not fail; a comment says it does nothing.

Sources: [src/jsx/hooks/index.ts:368-369](repo://src/jsx/hooks/index.ts#L368-L369)
