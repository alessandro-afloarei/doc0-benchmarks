---
title: "JSX DOM Runtime and Hooks"
---
## Overview

`hono/jsx/dom` renders the same JSX components in the browser. Where the server runtime on [[JSX Server Rendering]] turns a tree into a string once, the DOM runtime keeps a virtual tree of node objects, builds it by calling components, applies it to real DOM elements, and rebuilds only the components whose state changed. The hooks in `src/jsx/hooks` work in both runtimes: on the server they return their initial values, and in the browser they store state on the node being built. The public API copies React's names, so `hono/jsx/dom/client` mirrors `react-dom/client` and `hono/jsx/dom/server` mirrors `react-dom/server`.

Sources: [src/jsx/dom/render.ts:41-80](repo://src/jsx/dom/render.ts#L41-L80), [src/jsx/dom/client.ts:1-4](repo://src/jsx/dom/client.ts#L1-L4), [src/jsx/dom/server.ts:1-4](repo://src/jsx/dom/server.ts#L1-L4), [src/jsx/hooks/index.ts:182-193](repo://src/jsx/hooks/index.ts#L182-L193)

```tsx
/** @jsxImportSource hono/jsx/dom */
import { useState } from 'hono/jsx'
import { render } from 'hono/jsx/dom'

const Counter = () => {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{count}</button>
}

render(<Counter />, document.getElementById('root')!)
```

Sources: [src/jsx/dom/render.ts:796-799](repo://src/jsx/dom/render.ts#L796-L799), [src/jsx/hooks/index.ts:182-243](repo://src/jsx/hooks/index.ts#L182-L243)

## Entry points

| Function | Module | Does |
| --- | --- | --- |
| `render(jsx, container)` | `hono/jsx/dom` | Builds the tree and replaces the container's children. |
| `createRoot(element)` | `hono/jsx/dom/client` | Returns `{ render, unmount }`; later `render` calls update the same tree. |
| `hydrateRoot(element, jsx)` | `hono/jsx/dom/client` | Same as `createRoot` then `render`: the comment says hydrate is equivalent to render. |
| `flushSync(fn)` | `hono/jsx/dom` | Runs the updates `fn` schedules synchronously. |
| `createPortal(children, element)` | `hono/jsx/dom` | Renders children into another element. |
| `renderToString`, `renderToReadableStream` | `hono/jsx/dom/server` | Server rendering with React's signatures. |

Sources: [src/jsx/dom/render.ts:783-825](repo://src/jsx/dom/render.ts#L783-L825), [src/jsx/dom/client.ts:23-84](repo://src/jsx/dom/client.ts#L23-L84), [src/jsx/dom/server.ts:21-60](repo://src/jsx/dom/server.ts#L21-L60)

`createRoot` keeps the content in a `useState` inside a hidden root component, so `root.render(next)` is a state update, and `unmount` sets it to `null`; rendering after unmount throws. Options are not supported yet and only produce a warning. `renderToString` throws for async components.

Sources: [src/jsx/dom/client.ts:23-66](repo://src/jsx/dom/client.ts#L23-L66), [src/jsx/dom/server.ts:21-30](repo://src/jsx/dom/server.ts#L21-L30)

## Building and applying

### Node objects

Each virtual node is a `NodeObject` holding the JSX tag and props plus rendering state under short keys: `vC` for the virtual children, `vR` for children to remove, `e` for the DOM element, `pP` for the previous props, `nN` for the next sibling, and a `DOM_STASH` slot with the hook index, the hook storage, the context values captured for it and its closest error boundary. Text is a `NodeString` with `t` for the text and `d` when it changed.

Sources: [src/jsx/dom/render.ts:41-80](repo://src/jsx/dom/render.ts#L41-L80)

### build

`build(context, node)` computes a node's new children. For a function component, `invokeTag` pushes `[context, node]` onto `buildDataStack`, resets the hook index, and calls the component with `defaultProps` merged in; the stack is how hooks find the node they belong to. Arrays are flattened, and each child is matched against the old children by `key` and tag when it has a key, by tag otherwise.

Sources: [src/jsx/dom/render.ts:274-291](repo://src/jsx/dom/render.ts#L274-L291), [src/jsx/dom/render.ts:497-553](repo://src/jsx/dom/render.ts#L497-L553)

A matched old node is reused with the new props. A function component is marked to be skipped (`s`) when nothing forces it and either its element object is identical, which the comment ties to code from the React compiler, or a `memo` comparison says its props are equal, and the context values it read are unchanged. Every node not skipped is built recursively.

Sources: [src/jsx/dom/render.ts:555-605](repo://src/jsx/dom/render.ts#L555-L605)

### apply

`apply(node, container)` brings the DOM in line. `applyNodeObject` removes the nodes in `vR`, then walks the new children: text nodes are created or have their `textContent` updated, elements are created with `createElement`, or `createElementNS` inside `svg` and `math`, and get their props applied. Elements already in place stay; others are inserted before the next sibling's element, with a shortcut for two swapped elements.

Sources: [src/jsx/dom/render.ts:364-458](repo://src/jsx/dom/render.ts#L364-L458)

`applyProps` sets attributes from the difference between old and new props. `onClick` and other `on*` props become event listeners, with `Capture` suffixes for capture listeners and `onChange` mapped to the `input` event. `ref` accepts an object or a callback whose return value is the cleanup. `value`, `checked` and `selected` are set as properties on form elements, a `select`'s value after its options exist. Attribute names the browser rejects are ignored.

Sources: [src/jsx/dom/render.ts:115-133](repo://src/jsx/dom/render.ts#L115-L133), [src/jsx/dom/render.ts:144-249](repo://src/jsx/dom/render.ts#L144-L249)

The first render builds into a `DocumentFragment` and replaces the container's children with it in one operation.

Sources: [src/jsx/dom/render.ts:783-794](repo://src/jsx/dom/render.ts#L783-L794)

## Updates

A state setter calls `update(context, node)` for the component's node. Updates are batched per node: a later call for the same node cancels the earlier one, and the work runs after a microtask, `await Promise.resolve()`, so several `setState` calls in one event cause one render. Inside `flushSync`, the updates are collected and run before it returns.

Sources: [src/jsx/dom/render.ts:735-781](repo://src/jsx/dom/render.ts#L735-L781), [src/jsx/dom/render.ts:801-813](repo://src/jsx/dom/render.ts#L801-L813)

`updateSync` restores the context values the node saw at its last build, rebuilds the node and applies it to its container. When the context has an update hook, such as the view-transition hook, the hook wraps that work.

Sources: [src/jsx/dom/render.ts:713-733](repo://src/jsx/dom/render.ts#L713-L733)

Effects are collected while applying. `useInsertionEffect` callbacks run first, then `useLayoutEffect` callbacks synchronously after the DOM changes, and `useEffect` callbacks in the next `requestAnimationFrame`.

Sources: [src/jsx/dom/render.ts:461-481](repo://src/jsx/dom/render.ts#L461-L481), [src/jsx/hooks/index.ts:288-297](repo://src/jsx/hooks/index.ts#L288-L297)

## Hooks

### Storage

Every hook reads the top of `buildDataStack`. Outside a DOM build, which includes server rendering, there is no entry and the hook returns a static result: `useState` its initial value and a setter that does nothing, `useRef` a fresh ref, `useMemo` the factory's result. Inside a build, each hook kind has an array in the node's stash, indexed by the order of calls.

Sources: [src/jsx/hooks/index.ts:7-20](repo://src/jsx/hooks/index.ts#L7-L20), [src/jsx/hooks/index.ts:182-196](repo://src/jsx/hooks/index.ts#L182-L196), [src/jsx/hooks/index.ts:319-364](repo://src/jsx/hooks/index.ts#L319-L364)

### State and memoization

`useState` stores `[value, setter]`. The setter accepts a value or an updater function, ignores values that are `Object.is` equal to the current one, and schedules an update. `useReducer`, `useCallback`, `useMemo` and `useRef` build on the same storage; dependency lists are compared item by item, and a missing list always counts as changed. `useId` returns `:r<n>:` identifiers.

Sources: [src/jsx/hooks/index.ts:27-34](repo://src/jsx/hooks/index.ts#L27-L34), [src/jsx/hooks/index.ts:182-299](repo://src/jsx/hooks/index.ts#L182-L299), [src/jsx/hooks/index.ts:319-366](repo://src/jsx/hooks/index.ts#L319-L366)

### Transitions and promises

`startTransition` and the function returned by `useTransition` run a callback with a pending entry on a stack, so state set inside it is rendered at low priority; `useTransition` also reports whether the transition is still running. `startViewTransition` and `useViewTransition` run updates inside `document.startViewTransition` where the browser has it. `use(promise)` throws the promise until it settles, which a `Suspense` boundary catches, then returns the value or throws the error.

Sources: [src/jsx/hooks/index.ts:36-99](repo://src/jsx/hooks/index.ts#L36-L99), [src/jsx/hooks/index.ts:100-158](repo://src/jsx/hooks/index.ts#L100-L158), [src/jsx/hooks/index.ts:332-346](repo://src/jsx/hooks/index.ts#L332-L346)

## Error boundaries and Suspense

`ErrorBoundary` and `Suspense` have DOM renderers registered next to their server versions. During `build`, a component that throws is caught, and the closest boundary recorded in the node's stash renders its fallback; the retry function passed to it rebuilds the boundary later, which is how `Suspense` shows its content once a thrown promise settles.

Sources: [src/jsx/dom/render.ts:607-665](repo://src/jsx/dom/render.ts#L607-L665), [src/jsx/streaming.ts:138-138](repo://src/jsx/streaming.ts#L138-L138), [src/jsx/components.ts:262-262](repo://src/jsx/components.ts#L262-L262)

## Forms and document metadata

The DOM versions of `title`, `meta`, `link`, `script` and `style` render into `document.head` instead of in place, removing duplicates by the same keys the server uses.

Sources: [src/jsx/dom/intrinsic-element/components.ts:58-80](repo://src/jsx/dom/intrinsic-element/components.ts#L58-L80), [src/jsx/dom/intrinsic-element/components.ts:257-316](repo://src/jsx/dom/intrinsic-element/components.ts#L257-L316)

A `<form action={fn}>` whose action is a function listens for `submit`, prevents the default, and calls `fn(formData)`. While a returned promise is pending, the form provides `FormContext` with `pending: true` and the data, which `useFormStatus()` reads in components inside the form. `useActionState` and `useOptimistic` from the same hooks module build on this.

Sources: [src/jsx/dom/intrinsic-element/components.ts:319-386](repo://src/jsx/dom/intrinsic-element/components.ts#L319-L386), [src/jsx/dom/hooks/index.ts:24-91](repo://src/jsx/dom/hooks/index.ts#L24-L91)
