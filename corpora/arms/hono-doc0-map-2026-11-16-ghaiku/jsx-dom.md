---
title: "JSX DOM Rendering"
---
## Overview

`hono/jsx/dom` renders JSX into real DOM nodes in the browser. A root object owns one container, and rendering has two passes: a build pass turns the JSX tree into a tree of internal node objects and runs the components, and an apply pass writes those nodes into the DOM. A state change does not rebuild the tree from scratch. It re-runs the build for one node and applies only that subtree. The server path is in [[JSX Server Rendering]].

Sources: [src/jsx/dom/client.ts:23-45](repo://src/jsx/dom/client.ts#L23-L45), [src/jsx/dom/render.ts:783-794](repo://src/jsx/dom/render.ts#L783-L794)

## Creating a root

`createRoot` returns an object with `render` and `unmount`. The first `render` call builds a wrapper node whose tag is a function holding the JSX in a state value, and calls `renderNode` on it. Later `render` calls set that state, so the first call is the only one that creates DOM nodes. `unmount` sets the state to `null`, and a `render` after unmount throws.

Sources: [src/jsx/dom/client.ts:23-70](repo://src/jsx/dom/client.ts#L23-L70)

`hydrateRoot` creates a root and calls `render` once. The comment on it says hydration is the same as rendering in `hono/jsx/dom`, so it does not reuse the server's DOM.

Sources: [src/jsx/dom/client.ts:76-84](repo://src/jsx/dom/client.ts#L76-L84)

`renderNode` builds the node tree into a document fragment, applies it there, and then replaces the container's children with the fragment. Building into a fragment first means the container changes once, not once per element.

Sources: [src/jsx/dom/render.ts:783-794](repo://src/jsx/dom/render.ts#L783-L794)

## The build pass

`build` runs a node's function tag, or reads its `children` prop, to get the child list. Hooks find the node they belong to through `buildDataStack`, the stack that `useState` reads its node from. An element with an error handler child is recorded in the context's error stack so that a thrown error can reach that handler.

Sources: [src/jsx/dom/render.ts:497-512](repo://src/jsx/dom/render.ts#L497-L512), [src/jsx/dom/render.ts:667-690](repo://src/jsx/dom/render.ts#L667-L690)

`buildNode` converts a JSX element to the internal node. Strings and numbers become text nodes, and a function tag gets its own hook stash `[index, states]`. An intrinsic element takes its namespace from `nameSpaceMap` when its tag has an entry there.

Sources: [src/jsx/dom/render.ts:667-700](repo://src/jsx/dom/render.ts#L667-L700)

## The apply pass

`apply` and `applyNodeObject` write one node into its container, creating the element when the node is new and updating its props when it is not. `applyProps` sets attributes and event handlers, and it maps the `on...` names through the event alias map. Children are then matched to the old ones by key so that unchanged children stay in place.

Sources: [src/jsx/dom/render.ts:364-395](repo://src/jsx/dom/render.ts#L364-L395), [src/jsx/dom/render.ts:164-175](repo://src/jsx/dom/render.ts#L164-L175)

## State updates

`useState` stores its value in the node's hook stash, at the index the hook was called in. The setter ignores a new value that is `Object.is` to the old one. Otherwise it stores the value and calls `update` for that node. Calls to `useState` must therefore happen in the same order on every render, which is the rule the stash index depends on.

Sources: [src/jsx/hooks/index.ts:182-240](repo://src/jsx/hooks/index.ts#L182-L240)

`update` cancels any earlier pending update for the same node. Outside a batch it waits one microtask before running. If several state changes happen in the same tick, only the last `update` call runs, and the node is built and applied once.

Sources: [src/jsx/dom/render.ts:740-781](repo://src/jsx/dom/render.ts#L740-L781)

`updateSync` runs the build for the node again, then applies it to its container. If the build throws, it returns without applying.

Sources: [src/jsx/dom/render.ts:713-733](repo://src/jsx/dom/render.ts#L713-L733)

## Actions and optimistic values

`useOptimistic` keeps its value in `useState`. Calling the returned function applies `updateState` to the optimistic value, and when registered form actions are pending, the value is reset to the base state once they all finish. `useActionState` keeps the result of its action in `useState`, and its returned function stores the awaited result of the action. Both are in `hono/jsx/dom`, and both are built on `useState` and the same update path.

Sources: [src/jsx/dom/hooks/index.ts:52-78](repo://src/jsx/dom/hooks/index.ts#L52-L78), [src/jsx/dom/hooks/index.ts:79-91](repo://src/jsx/dom/hooks/index.ts#L79-L91)

`registerAction` keeps every running action in a set, so `useFormStatus` can report the pending state of a form while its action runs.

Sources: [src/jsx/dom/hooks/index.ts:31-50](repo://src/jsx/dom/hooks/index.ts#L31-L50)

## Pages

- [[JSX Server Rendering]] covers the string path that shares the component model.
- [[Helper Catalogue]] lists `html` and `css`, which produce HTML strings and are not DOM renderers.

Sources: [src/jsx/index.ts:1-60](repo://src/jsx/index.ts#L1-L60)
