---
title: "Client-Side DOM Rendering"
---
## Overview

`hono/jsx/dom` renders the same JSX components in the browser and keeps them up to date as state changes. It is a small virtual-DOM renderer: each render builds a tree of node objects from the components, compares it with the previous tree, and applies only the differences to real DOM elements. State, effects and context come from the shared hooks ([[JSX Hooks]]), and the module exports a React-compatible API, so code and libraries written against React's API can often run on it.

Sources: [src/jsx/dom/render.ts:497-608](repo://src/jsx/dom/render.ts#L497-L608), [src/jsx/dom/index.ts:85-169](repo://src/jsx/dom/index.ts#L85-L169)

```tsx
/** @jsxImportSource hono/jsx/dom */
import { render, useState } from 'hono/jsx/dom'

const Counter = () => {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>Count: {count}</button>
}

render(<Counter />, document.getElementById('root')!)
```

Sources: [src/jsx/dom/render.ts:794-797](repo://src/jsx/dom/render.ts#L794-L797), [src/jsx/hooks/index.ts:182-243](repo://src/jsx/hooks/index.ts#L182-L243)

## Entry points

| Function | Import | Effect |
| --- | --- | --- |
| `render(element, container)` | `hono/jsx/dom` | Renders once, replacing the container's children |
| `createRoot(container)` | `hono/jsx/dom/client` | Returns `{ render, unmount }` for repeated renders into one container |
| `hydrateRoot(container, element)` | `hono/jsx/dom/client` | `createRoot(container).render(element)` |
| `createPortal(children, element, key?)` | `hono/jsx/dom` | Renders children into another element |
| `flushSync(callback)` | `hono/jsx/dom` | Applies state updates made in `callback` immediately |

Sources: [src/jsx/dom/render.ts:783-825](repo://src/jsx/dom/render.ts#L783-L825), [src/jsx/dom/client.ts:11-89](repo://src/jsx/dom/client.ts#L11-L89)

`renderNode` builds the whole tree, applies it into a `DocumentFragment`, and finally swaps it into the container with `replaceChildren`. `hydrateRoot` uses the same path, so server-rendered markup in the container is replaced by freshly created elements rather than reused.

Sources: [src/jsx/dom/render.ts:783-792](repo://src/jsx/dom/render.ts#L783-L792), [src/jsx/dom/client.ts:76-84](repo://src/jsx/dom/client.ts#L76-L84)

`createRoot` wraps the element in an internal component that holds it in `useState`. A second `root.render(element)` sets that state, so the new element is diffed against the old tree instead of re-created. `unmount()` renders `null`, and rendering after unmounting throws `Cannot update an unmounted root`. Passing options logs that they are not supported yet.

Sources: [src/jsx/dom/client.ts:23-66](repo://src/jsx/dom/client.ts#L23-L66)

## Nodes

The renderer works on two kinds of node. A text node is `{ t, d }`, the text and a dirty flag. An object node is the JSX node itself, extended with short fields: `vC`, the virtual children; `vR`, children to remove; `pP`, the previous props; `e`, the DOM element; `c`, the container; `nN`, the next node; `n`, the namespace; and flags for forced builds (`f`) and skipped builds (`s`).

Sources: [src/jsx/dom/render.ts:40-80](repo://src/jsx/dom/render.ts#L40-L80)

`buildNode` creates these from JSX children. Nullish and boolean children produce nothing, strings and numbers become text nodes, a function component gets an empty hook stash, and `svg` or `math` wraps its children in a namespace context so their elements are created with `createElementNS`.

Sources: [src/jsx/dom/render.ts:667-704](repo://src/jsx/dom/render.ts#L667-L704), [src/jsx/dom/render.ts:24-27](repo://src/jsx/dom/render.ts#L24-L27)

## Building and diffing

```mermaid
flowchart TD
  build["build(context, node)"] --> invoke{"function component?"}
  invoke -->|yes| call["invokeTag: push buildDataStack, call component"]
  invoke -->|no| props["children from props"]
  call --> each["for each child: buildNode"]
  props --> each
  each --> match["find old child by key and tag, or by tag"]
  match --> reuse{"found?"}
  reuse -->|yes| keep["reuse old node, new props; skip if memo or same element"]
  reuse -->|no| fresh["new node"]
  keep --> recurse["build(child) unless skipped"]
  fresh --> recurse
  recurse --> done["vC = new children, vR = unmatched old children"]
```

Sources: [src/jsx/dom/render.ts:276-291](repo://src/jsx/dom/render.ts#L276-L291), [src/jsx/dom/render.ts:497-608](repo://src/jsx/dom/render.ts#L497-L608)

`invokeTag` pushes `[context, node]` on `buildDataStack`, which is how hooks find their component, merges `defaultProps`, and calls the component's DOM renderer if it has one (`ErrorBoundary`, `Suspense` and context providers do), or the component itself.

Sources: [src/jsx/dom/render.ts:276-291](repo://src/jsx/dom/render.ts#L276-L291)

For each new child, `build` looks for an old child to reuse: with a `key`, one with the same key and tag; without one, the first old child with the same tag; for text, the first old text node. A reused component is marked as skipped when its element is the same object as before, or when its `memo` comparison says the props are equal, and the context values it sees have not changed. Otherwise it is built again recursively. Unmatched old children are left in `vR` for removal.

Sources: [src/jsx/dom/render.ts:539-608](repo://src/jsx/dom/render.ts#L539-L608), [src/jsx/dom/render.ts:484-492](repo://src/jsx/dom/render.ts#L484-L492)

The DOM `memo` only attaches the comparison; skipping is done by the renderer. That differs from the server `memo`, which caches the rendered output ([[JSX Server Rendering]]).

Sources: [src/jsx/dom/index.ts:76-83](repo://src/jsx/dom/index.ts#L76-L83), [src/jsx/base.ts:383-404](repo://src/jsx/base.ts#L383-L404)

## Applying to the DOM

`apply` and `applyNodeObject` walk the built tree. They flatten function components and fragments into the list of real elements under each container, remove the nodes in `vR` (running their effect cleanups and ref cleanups), and then, for each element in order, create it if needed, apply its props, recurse into it, and insert or move it to its position. When two adjacent elements are swapped, the code moves the extra one to the end instead of reinserting the rest, as a comment explains.

Sources: [src/jsx/dom/render.ts:293-332](repo://src/jsx/dom/render.ts#L293-L332), [src/jsx/dom/render.ts:340-362](repo://src/jsx/dom/render.ts#L340-L362), [src/jsx/dom/render.ts:385-462](repo://src/jsx/dom/render.ts#L385-L462)

Effects collected during the walk run at the end: insertion and layout effects synchronously, regular effects in the next animation frame.

Sources: [src/jsx/dom/render.ts:466-482](repo://src/jsx/dom/render.ts#L466-L482)

## Props, events and refs

`applyProps` compares each prop with its previous value and only touches changed ones:

Sources: [src/jsx/dom/render.ts:113-138](repo://src/jsx/dom/render.ts#L113-L138), [src/jsx/dom/render.ts:174-274](repo://src/jsx/dom/render.ts#L174-L274), [src/jsx/dom/render.ts:19-22](repo://src/jsx/dom/render.ts#L19-L22)

| Prop | DOM operation |
| --- | --- |
| `onClick`, `onChangeCapture`, … | `addEventListener` with the lower-cased event name; `Capture` sets capture mode; `onChange` maps to `input` and `onDoubleClick` to `dblclick` |
| `ref` | A callback is called with the element, or an object's `current` is set; cleanup runs on removal |
| `style` | A string sets `cssText`; an object is applied with `setProperty` |
| `dangerouslySetInnerHTML` | Sets `innerHTML` |
| `value` on `input`, `textarea`, `select` | Sets the property; `select` is set after its options are rendered |
| `checked`, `selected` | Sets the property as well as the attribute |
| other | `setAttribute`, or `removeAttribute` for `null`, `undefined` and `false`; `true` sets an empty attribute |

Sources: [src/jsx/dom/render.ts:113-138](repo://src/jsx/dom/render.ts#L113-L138), [src/jsx/dom/render.ts:174-274](repo://src/jsx/dom/render.ts#L174-L274), [src/jsx/dom/render.ts:19-22](repo://src/jsx/dom/render.ts#L19-L22)

Props removed since the last render are removed from the element, and their listeners detached. A comment notes that, unlike server rendering, the DOM renderer does not validate attribute names up front; it ignores the `InvalidCharacterError` the browser throws for a bad name.

Sources: [src/jsx/dom/render.ts:166-173](repo://src/jsx/dom/render.ts#L166-L173), [src/jsx/dom/render.ts:252-274](repo://src/jsx/dom/render.ts#L252-L274)

## Updates

A state change calls `update(context, node)` for the component that owns the state, which waits one microtask, keeps only the latest update per node, and then runs `updateSync`: it restores the context values the component saw, rebuilds it, and applies the result. Transition updates go through an update hook and, for low-priority updates, defer the DOM work ([[JSX Hooks]]).

Sources: [src/jsx/dom/render.ts:713-781](repo://src/jsx/dom/render.ts#L713-L781)

## Context, errors and Suspense

The DOM `createContext` returns a provider that renders its children between two internal components: the first pushes the value onto the context's stack and the second pops it. Each component records the context values in effect when it was built, so a later re-render of just that component restores them.

Sources: [src/jsx/dom/context.ts:1-52](repo://src/jsx/dom/context.ts#L1-L52), [src/jsx/dom/render.ts:535-541](repo://src/jsx/dom/render.ts#L535-L541), [src/jsx/dom/render.ts:713-716](repo://src/jsx/dom/render.ts#L713-L716)

`ErrorBoundary` and `Suspense` return a fragment carrying a `DOM_ERROR_HANDLER`. When a descendant throws during `build`, the closest handler is called: `ErrorBoundary` calls `onError` and returns `fallbackRender(error)` or `fallback`, and passes thrown Promises on; `Suspense` handles only Promises, returns its `fallback`, and retries when the Promise settles.

Sources: [src/jsx/dom/components.ts:1-39](repo://src/jsx/dom/components.ts#L1-L39), [src/jsx/dom/render.ts:609-664](repo://src/jsx/dom/render.ts#L609-L664)

## React-compatible exports

Besides the hooks, `hono/jsx/dom` exports `createElement` (as `jsx` too), `cloneElement`, `isValidElement`, `memo`, `Children`, `Fragment`, `StrictMode`, `createContext`, `useContext`, `Suspense`, `ErrorBoundary`, `flushSync`, `createPortal` and `version`, as named exports and on a default export. `hono/jsx/dom/jsx-runtime` is the automatic JSX runtime for client code. The DOM-specific intrinsic elements and form hooks are on [[DOM Elements, Forms and CSS]].

Sources: [src/jsx/dom/index.ts:41-124](repo://src/jsx/dom/index.ts#L41-L124), [src/jsx/dom/index.ts:126-169](repo://src/jsx/dom/index.ts#L126-L169), [src/jsx/dom/jsx-runtime.ts:1-8](repo://src/jsx/dom/jsx-runtime.ts#L1-L8)
