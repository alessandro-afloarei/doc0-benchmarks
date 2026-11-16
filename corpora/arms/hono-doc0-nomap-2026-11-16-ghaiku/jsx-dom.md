---
title: "JSX DOM Rendering"
---
## Overview

`hono/jsx/dom` renders the same JSX in a browser, with real DOM nodes instead of a string. It keeps a tree of plain node objects, and on each update it compares the new tree with the old one and changes only the nodes that differ. The entry points are `render`, which draws a tree into a container, and `createRoot`, which keeps a root that can be re-rendered and unmounted. This page covers the node objects, the build and update steps, the hooks that store state on those nodes, and the `css` helper that writes styles into a sheet. Server rendering is on [[JSX Rendering]].

Sources: [src/jsx/dom/render.ts:1-40](repo://src/jsx/dom/render.ts#L1-L40), [src/jsx/dom/index.ts:39-39](repo://src/jsx/dom/index.ts#L39-L39)

## Entry points

`render(jsxNode, container)` wraps the node in an empty tag, builds it into the tree, and replaces the container's children with the result. It does not keep a handle, so a second call builds a new tree.

Sources: [src/jsx/dom/render.ts:783-799](repo://src/jsx/dom/render.ts#L783-L799)

`createRoot(element, options)` returns an object with `render` and `unmount`. The first `render` builds the tree inside a stateful wrapper that keeps the root node's value in `useState`. Later `render` calls set that state, which triggers an update. A root that has been unmounted refuses to render again. The `options` argument is accepted, but a warning says that it is not supported yet.

Sources: [src/jsx/dom/client.ts:23-66](repo://src/jsx/dom/client.ts#L23-L66)

`hydrateRoot` creates a root and renders the node into it, so in this implementation hydration is the same as a first render.

Sources: [src/jsx/dom/client.ts:76-84](repo://src/jsx/dom/client.ts#L76-L84)

## Building nodes

`buildNode` turns a child into a node object. `undefined`, `null` and booleans produce nothing, and strings and numbers become text nodes. A JSX element becomes an object that records its tag, props, key and the flags the reconciler uses.

Sources: [src/jsx/dom/render.ts:667-690](repo://src/jsx/dom/render.ts#L667-L690)

`build` runs a node. For a function tag it calls the function, and for a string tag it uses the props' children. It records an error handler when the first child is marked with one, pushing it onto the error stack of the context, and then builds the children and stores them in the node's child list.

Sources: [src/jsx/dom/render.ts:497-515](repo://src/jsx/dom/render.ts#L497-L515)

## Updates

`update(context, node)` schedules a rebuild of one node. If an update for the same node is already queued, the earlier one is cancelled, so only the last call runs. Updates requested during a batch are added to the batch set. Otherwise the code waits one microtask, so that several state changes in the same tick run as one update.

Sources: [src/jsx/dom/render.ts:740-781](repo://src/jsx/dom/render.ts#L740-L781)

`flushSync` runs a callback and applies the pending updates at once, and `createPortal` renders children into another container while keeping them in the same tree.

Sources: [src/jsx/dom/render.ts:801-825](repo://src/jsx/dom/render.ts#L801-L825)

## Hooks and state

The hooks keep their values on the node. Each hook takes the next index from the node's stash counter and uses an array slot for its state, so the order of hook calls in a component must not change between renders. `useState` reads its slot, creates it on the first call, and returns the value with a setter that schedules an update.

Sources: [src/jsx/hooks/index.ts:1-12](repo://src/jsx/hooks/index.ts#L1-L12), [src/jsx/hooks/index.ts:182-205](repo://src/jsx/hooks/index.ts#L182-L205)

`useEffect` records its dependencies in a slot and runs the effect when they change. `useRef`, `useCallback` and `useMemo` use their own slots in the same way. Each slot is numbered by a constant, so the stash can hold them all in one array.

Sources: [src/jsx/hooks/index.ts:271-290](repo://src/jsx/hooks/index.ts#L271-L290), [src/jsx/hooks/index.ts:306-362](repo://src/jsx/hooks/index.ts#L306-L362)

## The css helper

The `css` tagged template returns a class name, and `cx` joins class names. `createCssJsxDomObjects` finds a `<style>` element by its id and reads its sheet. A rule is inserted into the sheet only once for each class name, and the code keeps a set of the names it has added on the sheet object. If the sheet is not yet in the page, the insert is retried in a microtask and throws if it is still missing.

Sources: [src/jsx/dom/css.ts:77-111](repo://src/jsx/dom/css.ts#L77-L111)

`createCssContext` builds the `css`, `cx`, `keyframes` and `Style` functions for one style element id, and the module creates the default context with the id `DEFAULT_STYLE_ID`. Each exported function is the same object from that default context.

Sources: [src/jsx/dom/css.ts:180-198](repo://src/jsx/dom/css.ts#L180-L198), [src/jsx/dom/css.ts:228-263](repo://src/jsx/dom/css.ts#L228-L263)
