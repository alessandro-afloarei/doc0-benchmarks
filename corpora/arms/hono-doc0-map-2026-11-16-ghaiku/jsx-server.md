---
title: "JSX Server Rendering"
---
## Overview

On the server a JSX expression becomes an HTML string. `jsx` builds a `JSXNode` for each element, and that node renders itself when it is converted to a string. The `jsx-renderer` middleware and `c.render` hand the result to the response, and `renderToReadableStream` sends it as a stream when a component suspends. The client-side renderer is a separate path, covered in [[JSX DOM Rendering]].

Sources: [src/jsx/base.ts:140-152](repo://src/jsx/base.ts#L140-L152), [src/jsx/base.ts:304-318](repo://src/jsx/base.ts#L304-L318)

## Building nodes

`jsx(tag, props, ...children)` returns a `JSXNode` whose tag is a string or a function. A string tag must pass `isValidTagName`, and an invalid one throws `Invalid JSX tag name` when the node is created. A function tag becomes a function node, which calls the function when it renders. `Fragment` is a function that returns its children without a wrapping element.

Sources: [src/jsx/base.ts:140-152](repo://src/jsx/base.ts#L140-L152), [src/jsx/base.ts:254-262](repo://src/jsx/base.ts#L254-L262), [src/jsx/base.ts:406-420](repo://src/jsx/base.ts#L406-L420)

## Converting to a string

`toString` creates a buffer, asks the node to append itself to it with `toStringToBuffer`, and returns the joined string. If a callback was registered while rendering, the result is passed through the callback resolver, which is how a promise inside the tree is awaited. When the node has a suspended context, the render runs inside that context.

Sources: [src/jsx/base.ts:166-178](repo://src/jsx/base.ts#L166-L178)

`toStringToBuffer` writes the opening tag, then each attribute. Keys go through `normalizeIntrinsicElementKey`, and SVG tags use SVG attribute names. An attribute whose name fails `isValidAttributeName` is skipped. A `style` object is converted to a style string, and `children` is skipped because the children are rendered separately. Void elements close without an end tag.

Sources: [src/jsx/base.ts:179-206](repo://src/jsx/base.ts#L179-L206), [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78)

Text children are escaped as they are appended. A value marked as already escaped, such as the result of `raw`, is appended without escaping, so a component that returns HTML from a trusted source uses `raw` and nothing else.

Sources: [src/jsx/base.ts:108-130](repo://src/jsx/base.ts#L108-L130), [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46), [src/utils/html.ts:90-95](repo://src/utils/html.ts#L90-L95)

## Suspense and streaming

`Suspense` renders its children now and collects their output. When a child throws a promise, the component renders its `fallback` in its place and resumes the child later, so the output can arrive out of order. The render context is captured before the deferral, so values from `useContext` still resolve after the wait.

Sources: [src/jsx/streaming.ts:42-70](repo://src/jsx/streaming.ts#L42-L70)

`renderToReadableStream` converts a `JSXNode` with `toString`, awaits the content in the `BeforeStream` phase, and enqueues it as the first chunk. Each pending promise adds a later chunk when it resolves, so the stream sends the ready output first and each suspended part when its promise settles. An error during a chunk is passed to the `onError` function, which defaults to `console.trace`.

Sources: [src/jsx/streaming.ts:146-175](repo://src/jsx/streaming.ts#L146-L175)

`ErrorBoundary` is the matching component for errors. It renders its children, and when they fail it renders `fallback` or the result of `fallbackRender`, and calls `onError` with the error. Without children it returns an empty string.

Sources: [src/jsx/components.ts:55-75](repo://src/jsx/components.ts#L55-L75)

## The jsx-renderer middleware

`jsxRenderer` takes an optional layout component and options. For each request it stores the layout and a renderer on the context: `c.setLayout` and `c.setRenderer`. The renderer wraps the content in the layout, prepends a DOCTYPE unless the `docType` option turns it off, and provides the context through `RequestContext`. [[Context]] explains `c.render` and the layout store.

Sources: [src/middleware/jsx-renderer/index.ts:116-127](repo://src/middleware/jsx-renderer/index.ts#L116-L127), [src/middleware/jsx-renderer/index.ts:33-62](repo://src/middleware/jsx-renderer/index.ts#L33-L62)

When the `stream` option is set, the renderer sends the body with `renderToReadableStream` and sets the headers the option gives, or the chunked defaults when `stream` is `true`. Otherwise it passes the string to `c.html`.

Sources: [src/middleware/jsx-renderer/index.ts:62-82](repo://src/middleware/jsx-renderer/index.ts#L62-L82)

## Pages

- [[Built-in Middleware]] lists `jsxRenderer` with the other middleware.
- [[Helper Catalogue]] lists the `html` tagged template, which builds the same escaped strings.

Sources: [src/helper/html/index.ts:11-27](repo://src/helper/html/index.ts#L11-L27)
