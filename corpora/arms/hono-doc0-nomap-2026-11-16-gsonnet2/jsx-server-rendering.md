---
title: "JSX Server Rendering and Streaming"
---
## Overview

`hono/jsx` renders JSX to HTML strings on the server with no virtual DOM. `jsx()` builds `JSXNode` objects; calling `toString()` on one walks the tree and writes escaped HTML into a string buffer. Components may be async, and the buffer can hold promises, so the same renderer supports `async` components, `Suspense` and streaming responses. Handlers return JSX through `c.html(...)` ([[Context and Responses]]), or through `c.render(...)` after the `jsxRenderer` middleware has installed a layout. The browser-side runtime sharing this API is on [[JSX DOM Runtime and Hooks]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

## From JSX to nodes

The JSX transform calls `jsx(tag, props, ...children)`. It copies `children` into `props.children`, removes `key` and stores it on the node, and passes everything to `jsxFn`. `jsxFn` picks the node class:

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351)

- a function tag becomes a `JSXFunctionNode` (a component);
- a tag that has a built-in component (the form and metadata elements in `jsx/intrinsic-element`) becomes a `JSXFunctionNode` for that component;
- `svg` and `head` wrap their children in a namespace context provider so nested elements know they are inside SVG;
- everything else is a plain `JSXNode`.

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351)

`JSXNode`'s constructor rejects invalid tag names with `Invalid JSX tag name`, and every node has `isEscaped: true`, which marks its output as safe to insert without escaping again. `Fragment` returns a `JSXFragmentNode`, which writes only its children.

Sources: [src/jsx/base.ts:140-154](repo://src/jsx/base.ts#L140-L154), [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302), [src/jsx/base.ts:406-419](repo://src/jsx/base.ts#L406-L419)

## Writing HTML into the buffer

`toString()` creates a `StringBufferWithCallbacks` (an array starting with `''`), calls `toStringToBuffer(buffer)`, and returns `buffer[0]` when no promise was pushed. If the buffer has grown past one element, `stringBufferToString` resolves it asynchronously, so the result is a `Promise<string>`. Rendering runs inside `runWithRenderContext` so context values stay per request (see below).

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:23-38](repo://src/utils/html.ts#L23-L38)

`JSXNode.toStringToBuffer` writes `<tag`, then each prop, then the children:

Sources: [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251)

- An attribute name that is not valid is skipped; `children` is skipped; inside SVG, camelCase presentation attributes are converted to kebab-case.
- A `style` object becomes `property:value` pairs joined by `;`.
- Strings are escaped with `escapeToBuffer`, which replaces `& < > ' "`; numbers and already-escaped values are written as is.
- A boolean is written only for a known boolean attribute such as `disabled` (as `disabled=""`) and only if true.
- `dangerouslySetInnerHTML` replaces the children (and throws if children are also given).
- A promise value is awaited and inserted between quotes; a function value is rejected with an error unless the name starts with `on` or is `ref`.

Sources: [src/jsx/base.ts:186-239](repo://src/jsx/base.ts#L186-L239), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

Void tags (`br`, `img`, `input`, …) with no children end with `/>`; others get a closing tag.

Sources: [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

Children are written by `childrenToStringToBuffer`: strings are escaped; `null`, `undefined` and booleans are skipped; `JSXNode`s recurse; numbers and `isEscaped` values are appended raw; a promise is pushed onto the buffer; arrays recurse.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129)

## Async components and the string buffer

A component is called with its props (children folded into `props.children`). If it returns a promise, the buffer takes a new `''` string and the promise, so the layout of the array is alternating pieces: the rendered string comes at index 0, followed by promises that will resolve later, then the text that comes before them. `stringBufferToString` joins it from the tail: it resolves all promises, appends the pieces back in order, escapes any plain (not `isEscaped`) result, and gathers callbacks.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296), [src/utils/html.ts:23-88](repo://src/utils/html.ts#L23-L88)

`raw(value, callbacks?)` makes a `String` object with `isEscaped = true` and an optional `callbacks` array; every escaped string produced by the renderer is one. Callbacks let a fragment run code in later phases — `Stringify`, `BeforeStream`, `Stream` — which is how `Suspense` and `ErrorBoundary` add scripts or rewrite the buffer. `resolveCallbackSync` and `resolveCallback` run them.

Sources: [src/utils/html.ts:6-46](repo://src/utils/html.ts#L6-L46), [src/utils/html.ts:129-182](repo://src/utils/html.ts#L129-L182)

## Context and request isolation

`createContext(defaultValue)` returns a component that, when rendered, pushes `props.value` onto its value stack, renders children, and pops (after the promise settles for async children). `useContext` reads the top value from the current store. The stack lives in a per-render store: `runWithRenderContext` uses `AsyncLocalStorage` (found through `process.getBuiltinModule` or the main module's `require`) when available, so values do not leak between concurrent requests even across `await`. Without it, the store exists only during synchronous work, a read after `await` returns the default value, and the library warns once.

Sources: [src/jsx/context.ts:13-60](repo://src/jsx/context.ts#L13-L60), [src/jsx/context.ts:150-261](repo://src/jsx/context.ts#L150-L261)

`captureRenderContext()` returns a function that restores the store and context values around a deferred continuation; async components and `Suspense` use it when they resume.

Sources: [src/jsx/context.ts:191-200](repo://src/jsx/context.ts#L191-L200), [src/jsx/base.ts:268-283](repo://src/jsx/base.ts#L268-L283)

## Suspense, ErrorBoundary and streaming

`Suspense` renders its children. If any child is still pending, it returns the fallback inside `<template id="H:n"></template>…<!--/$-->` markers plus a callback. In a buffered render the callback awaits the children and replaces the placeholder in the buffer with the final content; in the streaming phase it emits a `<template data-hono-target="H:n">` with the real content and an inline script that swaps it into the placeholder (the script takes an optional CSP nonce from `StreamingContext`). If nothing is pending, the content is returned directly.

Sources: [src/jsx/streaming.ts:18-137](repo://src/jsx/streaming.ts#L18-L137)

`ErrorBoundary` catches a synchronous error or a rejected promise from its children and renders `fallback` (or `fallbackRender(error)`), calling `onError`. When children are asynchronous it uses `<template id="E:n">` markers and a callback so a late failure can still replace the content in the stream.

Sources: [src/jsx/components.ts:55-140](repo://src/jsx/components.ts#L55-L140)

`renderToReadableStream(content, onError)` turns the node into a `ReadableStream<Uint8Array>`. It resolves the first chunk with the `BeforeStream` phase and enqueues it, then runs each callback in the `Stream` phase; every resolved chunk is enqueued as it arrives, and any callbacks it carries are run too. The stream closes when all callbacks have settled; a cancelled stream stops enqueueing, and errors go to `onError` (default `console.trace`).

Sources: [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

## The jsxRenderer middleware

`jsxRenderer(component?, options?)` is middleware that calls `c.setRenderer(...)` and, when a `component` is given, `c.setLayout(...)`, wrapping any layout already installed by an outer renderer so layouts nest. Afterwards `c.render(children, props)` builds the page: it prepends a `<!DOCTYPE html>` (configurable with `docType`), wraps the layout in a `RequestContext.Provider` so components can call `useRequestContext()` to get `c`, and returns `c.html(body)`. With `stream: true` it sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8` and `Content-Encoding: Identity`, and returns `c.body(renderToReadableStream(body))`; `stream` may also be an object of headers to set.

Sources: [src/middleware/jsx-renderer/index.ts:15-81](repo://src/middleware/jsx-renderer/index.ts#L15-L81), [src/middleware/jsx-renderer/index.ts:116-165](repo://src/middleware/jsx-renderer/index.ts#L116-L165), [src/context.ts:436-497](repo://src/context.ts#L436-L497)

## Automatic runtime

`hono/jsx/jsx-runtime` re-exports `jsxDEV` as both `jsx` and `jsxs`, plus `Fragment`. `jsxDEV(tag, props, key)` takes the children from `props.children`, wraps a single child in an array, calls `jsxFn` and sets the key on the node.

Sources: [src/jsx/jsx-runtime.ts:6-8](repo://src/jsx/jsx-runtime.ts#L6-L8), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26)

The same module also exports `jsxTemplate` (the `html` tag), `jsxAttr` and `jsxEscape`, which compilers that precompile JSX use to build strings directly. `jsxAttr` skips invalid attribute names and renders a `style` object the same way `JSXNode` does, so precompiled output follows the same escaping rules.

Sources: [src/jsx/jsx-runtime.ts:1-51](repo://src/jsx/jsx-runtime.ts#L1-L51)
