---
title: "JSX Rendering"
---
## Overview

`hono/jsx` lets a handler return markup written as JSX. On the server, JSX is not rendered by React: each JSX element becomes a `JSXNode`, which turns itself into an HTML string when it is converted. `hono/jsx/dom` is a separate renderer that mounts the same components into a browser DOM. The JSX layout middleware that wraps a page in a template is in [[Response Middleware]]; this page covers the element tree, the string and stream rendering, and the client renderer.

Sources: [src/jsx/index.ts:36-112](repo://src/jsx/index.ts#L36-L112), [src/jsx/base.ts:140-166](repo://src/jsx/base.ts#L140-L166)

## Elements

The `jsx` function is what the compiler calls for each element. It moves `key` out of the props, stores the children in `props.children` (a single child is stored as is and several as an array), and builds a node with `jsxFn`. The `jsx-runtime` module exports `jsxDEV` under the names `jsx` and `jsxs`.

Sources: [src/jsx/base.ts:304-317](repo://src/jsx/base.ts#L304-L317), [src/jsx/jsx-runtime.ts:1-10](repo://src/jsx/jsx-runtime.ts#L1-L10)

A `JSXNode` holds a `tag`, its `props` and its `children`. A string tag is an HTML element and a function tag is a component: a component is called with its props when the node is rendered, so its result is what gets converted. `Fragment` returns its children without a wrapper element.

Sources: [src/jsx/base.ts:140-152](repo://src/jsx/base.ts#L140-L152), [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302)

## String rendering

`toString()` converts the node to a string, and returns a promise when any child is asynchronous. It writes into a buffer through `toStringToBuffer`, so one pass builds the whole document. Attribute names are normalised for the element, with SVG names passed through `toSVGAttributeName` inside an `svg` tag, and attributes whose names are not valid are skipped.

Sources: [src/jsx/base.ts:166-178](repo://src/jsx/base.ts#L166-L178), [src/jsx/base.ts:179-200](repo://src/jsx/base.ts#L179-L200)

Text children are escaped with `escapeToBuffer`, so a string containing `<` is written as text, not markup. A value marked with `raw()` is written as is, which is how a node already converted to a string gets into the output.

Sources: [src/jsx/base.ts:230-240](repo://src/jsx/base.ts#L230-L240), [src/utils/html.ts:40-44](repo://src/utils/html.ts#L40-L44), [src/utils/html.ts:90-92](repo://src/utils/html.ts#L90-L92)

`c.html(<Page />)` passes the node through the same conversion. Because `Context.html` resolves an object argument with the stringify phase, the response body is the finished markup.

Sources: [src/context.ts:723-735](repo://src/context.ts#L723-L735)

## Streaming with Suspense

`renderToReadableStream(content)` returns a `ReadableStream` of the rendered markup. A `JSXNode` is converted with `toString()` first, and then the stream is filled as the content resolves, so a page can start sending before a slow part is ready.

Sources: [src/jsx/streaming.ts:146-165](repo://src/jsx/streaming.ts#L146-L165)

`Suspense` renders its `fallback` first and then the children, and it reads the optional `scriptNonce` from `StreamingContext` so the inline script that swaps the fallback can carry a Content Security Policy nonce.

Sources: [src/jsx/streaming.ts:30-41](repo://src/jsx/streaming.ts#L30-L41), [src/jsx/streaming.ts:42-58](repo://src/jsx/streaming.ts#L42-L58)

## Hooks

The hooks in `src/jsx/hooks`, such as `useState`, `useEffect`, `useRef` and `useMemo`, keep their data on the component's node. Each hook call takes the next index in that node's stash, so hooks must run in the same order on every render, as they do in React.

Sources: [src/jsx/hooks/index.ts:182-200](repo://src/jsx/hooks/index.ts#L182-L200), [src/jsx/hooks/index.ts:271-292](repo://src/jsx/hooks/index.ts#L271-L292)

## The DOM renderer

`hono/jsx/dom` exports `render(jsxNode, container)`. It builds the node tree, applies it to a document fragment, and then replaces the container's children with that fragment.

Sources: [src/jsx/dom/render.ts:783-800](repo://src/jsx/dom/render.ts#L783-L800), [src/jsx/dom/index.ts:39-39](repo://src/jsx/dom/index.ts#L39-L39)
