---
title: "Client-Side JSX Rendering"
---
## Overview

`hono/jsx/dom` renders the same JSX components in the browser and keeps them updated as state changes. Unlike the server renderer, which produces strings ([[Server-Side JSX Rendering]]), it keeps a tree of node objects, compares the new children of a component with the old ones when it re-renders, and applies the differences to real DOM nodes. The hooks exported by `hono/jsx` (`useState`, `useEffect` and the rest) store their state on those node objects, which is why they only act here.

Sources: [src/jsx/dom/render.ts:41-106](repo://src/jsx/dom/render.ts#L41-L106), [src/jsx/hooks/index.ts:182-243](repo://src/jsx/hooks/index.ts#L182-L243)

Components written for the server can declare a browser implementation: when a component function carries a `DOM_RENDERER` property, the DOM renderer calls that instead. `Suspense`, `ErrorBoundary`, context providers, `memo` and the CSS helper's `Style` use this to behave differently in each environment.

Sources: [src/jsx/dom/render.ts:274-291](repo://src/jsx/dom/render.ts#L274-L291), [src/jsx/streaming.ts:138](repo://src/jsx/streaming.ts#L138-L138), [src/jsx/base.ts:397-403](repo://src/jsx/base.ts#L397-L403)

## Entry points

| Function | Behavior |
| --- | --- |
| `render(jsx, container)` | builds the tree under a fragment root and replaces the container's children |
| `createRoot(element)` | returns `{ render, unmount }`; the first `render` mounts a root component holding the JSX in `useState`, later calls update that state, `unmount` sets it to `null` |
| `hydrateRoot(element, jsx)` | `createRoot(element).render(jsx)`; existing markup is replaced, not reused |
| `flushSync(callback)` | runs the updates scheduled inside `callback` synchronously |
| `createPortal(children, container, key)` | renders children into another DOM element |

Sources: [src/jsx/dom/render.ts:783-825](repo://src/jsx/dom/render.ts#L783-L825), [src/jsx/dom/client.ts:11-89](repo://src/jsx/dom/client.ts#L11-L89)

`createRoot` warns that options are not supported yet, and calling `render` after `unmount` throws `Cannot update an unmounted root`.

Sources: [src/jsx/dom/client.ts:33-60](repo://src/jsx/dom/client.ts#L33-L60)

## The node tree

`buildNode` converts JSX into nodes. Strings and numbers become text nodes (`{ t, d }`, the text and a dirty flag); `null`, `undefined` and booleans are dropped; element and component nodes become `NodeObject`s. A `NodeObject` keeps short-named fields for its virtual children (`vC`), children to remove (`vR`), previous props (`pP`), its container (`c`) and DOM element (`e`), the next sibling for insertion (`nN`), and, for components, a stash with the hook index, hook state, captured context values and the nearest error handler. `svg` and `math` children are wrapped in a namespace context so their elements are created with `createElementNS`.

Sources: [src/jsx/dom/render.ts:17-80](repo://src/jsx/dom/render.ts#L17-L80), [src/jsx/dom/render.ts:667-704](repo://src/jsx/dom/render.ts#L667-L704)

## Building and diffing

### build()

`build(context, node)` computes a node's children: for a component it calls `invokeTag`, which resets the hook index, pushes the node on `buildDataStack` (where hooks find it), merges `defaultProps`, and calls the function; for an element it takes `props.children`. Nested arrays are flattened.

Sources: [src/jsx/dom/render.ts:274-291](repo://src/jsx/dom/render.ts#L274-L291), [src/jsx/dom/render.ts:497-526](repo://src/jsx/dom/render.ts#L497-L526)

Each new child is matched with an old one: text with text, otherwise by `key` and tag when a key is set, else by tag alone. A matched element or component keeps its DOM element and hook state and receives the new props, with the old props saved in `pP`. A matched component is skipped (`s = true`) when it is not forced and either the node object is the same one the previous render produced (as code from the React compiler memoizes), or its `memo` comparison says the props are equal, provided the context values it saw are unchanged. Children that were not matched go to `vR` for removal. Every built child is then built recursively.

Sources: [src/jsx/dom/render.ts:540-609](repo://src/jsx/dom/render.ts#L540-L609)

### apply()

`apply(node, container)` writes the result to the DOM. Removed nodes are detached; then each child gets its existing element, a new text node, or a new element, and is inserted or moved only when it is not already in place.

Sources: [src/jsx/dom/render.ts:364-450](repo://src/jsx/dom/render.ts#L364-L450)

Props are applied by difference with the previous props, and props that disappeared are removed:

Sources: [src/jsx/dom/render.ts:164-272](repo://src/jsx/dom/render.ts#L164-L272)

| Prop | DOM effect |
| --- | --- |
| `onX`, `onXCapture` | event listener for `x` (capture phase with the suffix); `onChange` listens to `input` and `onDoubleClick` to `dblclick`; a non-function throws |
| `ref` | a callback receives the element (its return value or a `null` call is the cleanup), or an object's `current` is set |
| `dangerouslySetInnerHTML` | `innerHTML` |
| `style` | a string sets `cssText`, an object is applied with `setProperty` |
| `value` | set as a property on `input` and `textarea`; for `select`, applied after its options are rendered |
| `checked` on `input`, `selected` on `option` | set as properties |
| anything else | attribute: `null`, `undefined` or `false` removes it, `true` sets it empty |

Sources: [src/jsx/dom/render.ts:19-22](repo://src/jsx/dom/render.ts#L19-L22), [src/jsx/dom/render.ts:115-133](repo://src/jsx/dom/render.ts#L115-L133), [src/jsx/dom/render.ts:164-272](repo://src/jsx/dom/render.ts#L164-L272)

After a node's children are applied, its effect callbacks run in a fixed order: `useInsertionEffect` callbacks first, then `useLayoutEffect` callbacks synchronously, then `useEffect` callbacks in the next `requestAnimationFrame`.

Sources: [src/jsx/dom/render.ts:454-480](repo://src/jsx/dom/render.ts#L454-L480)

## Hooks and updates

### Where state lives

Each hook reads the node on top of `buildDataStack` and takes the next slot of the node's stash, so hooks must be called in the same order on every render, as in React. Outside a DOM render (on the server) `useState` simply returns the initial value and a no-op setter, and the effect hooks do nothing.

Sources: [src/jsx/hooks/index.ts:182-197](repo://src/jsx/hooks/index.ts#L182-L197), [src/jsx/hooks/index.ts:260-297](repo://src/jsx/hooks/index.ts#L260-L297)

`useEffect`, `useLayoutEffect` and `useInsertionEffect` compare dependencies; when they changed, the previous cleanup runs and the effect is scheduled for the next apply. `use(promise)` throws the promise until it settles and caches the result per promise, which `Suspense` catches.

Sources: [src/jsx/hooks/index.ts:260-297](repo://src/jsx/hooks/index.ts#L260-L297), [src/jsx/hooks/index.ts:332-346](repo://src/jsx/hooks/index.ts#L332-L346)

### Scheduling

A state setter ignores values equal by `Object.is`. Otherwise it calls `update(context, node)`. `update` keeps only the latest pending update per node and waits one microtask before running it, so several `setState` calls in the same tick re-render the component once. Inside `flushSync`, updates are collected and run before `flushSync` returns.

Sources: [src/jsx/hooks/index.ts:197-243](repo://src/jsx/hooks/index.ts#L197-L243), [src/jsx/dom/render.ts:734-813](repo://src/jsx/dom/render.ts#L734-L813)

The update re-builds the component with its captured context values pushed back on the context stacks, then applies the changes to the component's container. An update hook installed by transitions or view transitions can wrap this work.

Sources: [src/jsx/dom/render.ts:713-781](repo://src/jsx/dom/render.ts#L713-L781)

### Transitions

`startTransition(callback)` and the setter from `useTransition()` mark updates made inside them as low priority. Such an update waits until the transition's promise settles and then is queued with `requestAnimationFrame`; it is dropped if the component re-rendered in the meantime. `useTransition` returns `isPending` while its own transition render runs, and re-throws an error from an async callback during the next render. `useDeferredValue` returns the previous value at first and schedules a low-priority update to the new one.

Sources: [src/jsx/hooks/index.ts:100-176](repo://src/jsx/hooks/index.ts#L100-L176), [src/jsx/hooks/index.ts:206-236](repo://src/jsx/hooks/index.ts#L206-L236)

## Errors

When building a component throws, `build` looks up the nearest error handler recorded by an enclosing `ErrorBoundary` or `Suspense`. The handler receives the error and a retry function and returns a fallback; the boundary node is rebuilt with the fallback as its children and, when the boundary is already mounted, applied immediately. Without a handler the error propagates. During a low-priority render the fallback is not built; the render is marked as failed instead.

Sources: [src/jsx/dom/render.ts:610-665](repo://src/jsx/dom/render.ts#L610-L665)
