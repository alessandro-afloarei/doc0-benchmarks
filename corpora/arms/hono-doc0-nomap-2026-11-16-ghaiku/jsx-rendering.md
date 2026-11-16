---
title: "JSX Rendering"
---
## Overview

On the server, JSX is a way to write HTML as function calls. `hono/jsx` turns each element into a `JSXNode` object, and the node turns itself into a string when it is converted with `toString`. Strings are escaped as they are written, so text from a user cannot add markup unless it is wrapped in `raw`. This page covers the node, its escaping, the `html` tagged template that uses the same escaping, streaming with `Suspense`, and the `jsxRenderer` middleware that wraps a page in a layout. The browser renderer is on [[JSX DOM Rendering]].

Sources: [src/jsx/base.ts:140-166](repo://src/jsx/base.ts#L140-L166), [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46)

## Elements

`jsx(tag, props, ...children)` is the factory the compiler calls. It moves `key` out of the props, and stores the children in `props.children`: a single child is stored as itself, and several children as an array. `jsxFn` does the work and creates the `JSXNode`.

Sources: [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

The `JSXNode` constructor checks the tag name when the tag is a string, and throws `Invalid JSX tag name` for a name that is not valid. A function tag is not checked here.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154)

`toString` renders the node into a buffer inside `runWithRenderContext`. A buffer with one entry becomes a plain string, and a buffer with callbacks or promises goes through `stringBufferToString`, which can return a promise.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177)

`toStringToBuffer` writes the tag name, then each attribute in turn. Attribute names are normalised for the element, and SVG elements use the SVG spelling. The `children` prop is skipped, because the children are written after the start tag. A `style` object is turned into a style string, and a boolean attribute is written only when it is true and is on the list of boolean attributes. A promise as an attribute value is streamed into the attribute.

Sources: [src/jsx/base.ts:179-238](repo://src/jsx/base.ts#L179-L238)

## Escaping

`escapeToBuffer` writes a string into the buffer, replacing `"`, `'`, `&`, `<` and `>` with their entities. A string with none of them is written as it is. The function is shared by the element writer and the `html` template, so the rules are the same for both.

Sources: [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

`raw(value)` wraps a value in a `String` object marked with `isEscaped`, so that a writer does not escape it again. The `callbacks` field of the wrapper holds the functions that run when the value is streamed. A value that has `isEscaped` is written as it is.

Sources: [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46), [src/jsx/base.ts:179-238](repo://src/jsx/base.ts#L179-L238)

## The html template

`html` is a tagged template that builds an escaped string. Each interpolated value is handled by its type. A string is escaped, a number is added as it is, a boolean, `null` and `undefined` write nothing, and an array is flattened first. An escaped value, which includes a `JSXNode`, is written as its string form. A promise is held in the buffer until it resolves.

Sources: [src/helper/html/index.ts:11-47](repo://src/helper/html/index.ts#L11-L47), [src/helper/html/index.ts:50-56](repo://src/helper/html/index.ts#L50-L56)

## Streaming with Suspense

`Suspense` is an async component. When its children are ready it returns them as they are. When any child is still pending, it returns the fallback inside a `<template>` placeholder, and the rendered children replace the placeholder when their promise resolves. The `StreamingContext` carries the script nonce that the stream uses for its inline scripts.

Sources: [src/jsx/streaming.ts:30-45](repo://src/jsx/streaming.ts#L30-L45), [src/jsx/streaming.ts:50-100](repo://src/jsx/streaming.ts#L50-L100)

`renderToReadableStream` writes the first part of the page as soon as it resolves. Each callback or promise that the page holds is then resolved in turn, and its output is enqueued as it arrives. An error from a promise is passed to `onError`, and the stream writes an empty string for it so that the rest of the page still arrives.

Sources: [src/jsx/streaming.ts:146-200](repo://src/jsx/streaming.ts#L146-L200)

## Layouts with jsxRenderer

`jsxRenderer(component, options)` is a middleware. It reads the layout the app has so far, and when a component is given it sets a new layout that renders that component with a `Layout` prop pointing to the previous layout. It then sets a renderer, and calls `next()`, so the handler's `c.render(content)` is wrapped by the layout.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

The layout and renderer stored on the context are the ones [[Context]] describes. `useRequestContext` returns the context that the renderer was created with, which lets a component read the request without receiving it as a prop.

Sources: [src/middleware/jsx-renderer/index.ts:155-160](repo://src/middleware/jsx-renderer/index.ts#L155-L160), [src/context.ts:448-497](repo://src/context.ts#L448-L497)
