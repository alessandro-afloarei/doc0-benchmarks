---
title: "JSX Server Rendering"
---
## Overview

Hono has its own JSX runtime under `src/jsx`, so `<div>...</div>` in a handler needs no React. On the server a JSX expression builds a tree of `JSXNode` objects, and calling `toString()` on the tree produces an HTML string with every text and attribute value escaped. Async components and `Suspense` let the page be streamed. The `jsxRenderer` middleware connects this to `c.render` and layouts. The browser-side renderer for the same JSX is in [[JSX DOM Rendering and Hooks]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

## From JSX to nodes

The compiler calls the runtime in `jsx-runtime.ts`, which re-exports `jsxDEV` as both `jsx` and `jsxs`. `jsxDEV(tag, props, key)` extracts `props.children` into an array, calls `jsxFn(tag, props, children)` and sets the node's `key`. The classic `jsx(tag, props, ...children)` in `base.ts` does the same for hand-written calls and removes `key` from the props.

Sources: [src/jsx/jsx-runtime.ts:6-8](repo://src/jsx/jsx-runtime.ts#L6-L8), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

`jsxFn` picks the node class by tag:

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351)

| Tag | Node created |
| --- | --- |
| A function (component) | `JSXFunctionNode` |
| An intrinsic with special behaviour (`title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button`) | `JSXFunctionNode` wrapping the matching function from `intrinsic-element/components` |
| `svg` or `head` | A `JSXNode` whose children are wrapped in a context provider carrying the tag name, so descendants know they are inside it |
| Any other string | `JSXNode` |

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351)

A `JSXNode` constructor rejects a string tag that is not a valid tag name. `Fragment` creates a `JSXFragmentNode`, which renders only its children.

Sources: [src/jsx/base.ts:140-154](repo://src/jsx/base.ts#L140-L154), [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302), [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351), [src/jsx/base.ts:406-419](repo://src/jsx/base.ts#L406-L419)

## Rendering to a string

`JSXNode.toString()` creates a string buffer (`['']`), calls `toStringToBuffer`, and joins the result. Escaped output is appended to `buffer[0]`. When something asynchronous is met, the buffer gains extra slots (via `unshift`) that `stringBufferToString` later resolves, so the final value is either a string or a promise of one.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177)

`toStringToBuffer` writes the opening tag, then each prop in turn:

Sources: [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239)

- Invalid attribute names are skipped, and `children` is not written as an attribute.
- A `style` object becomes `property:value` pairs joined with `;`, then escaped.
- Strings are escaped. Numbers and already-escaped values are written as they are. `null` and `undefined` are dropped.
- Boolean props only appear when the attribute is in the `booleanAttributes` list and true, rendered as `name=""`.
- `dangerouslySetInnerHTML` becomes raw child content and throws if real children also exist.
- A promise value is awaited later; a function value throws unless the key starts with `on` or is `ref`, where it is ignored on the server.

Sources: [src/jsx/base.ts:79-106](repo://src/jsx/base.ts#L79-L106), [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239)

Void tags (`br`, `img`, `input`, `meta`, and others in `emptyTags`) with no children close with `/>`; others get their children rendered by `childrenToStringToBuffer` and a closing tag. Strings are escaped, numbers and escaped objects appended, nested nodes recursed into and promises queued.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

`JSXFunctionNode` renders a component by calling it with `{ ...props, children }` (a single child unwrapped). A `null` or boolean result renders nothing, a returned `JSXNode` renders in place, escaped strings and their callbacks are appended, and anything else is escaped. A returned promise (an async component) is queued in the buffer; if a context provider is active the current render context is captured so the resumed subtree still sees it.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

## Context

`createContext(default)` returns a component that doubles as a provider: rendering it pushes `props.value` onto a values array, renders its children, and pops. `useContext` reads the last value. Because async components resume after an `await`, the values live in a per-render `WeakMap` held in an `AsyncLocalStorage` when the runtime offers one (probed via `process.getBuiltinModule` or the main module's `require`). Without it a module-level fallback store is used for synchronous parts, and the code warns once if a `useContext` after an `await` falls back to the default value. `runWithRenderContext` opens a store for a render, and `captureRenderContext` returns a function that re-enters the captured store and values later.

Sources: [src/jsx/context.ts:13-71](repo://src/jsx/context.ts#L13-L71), [src/jsx/context.ts:117-200](repo://src/jsx/context.ts#L117-L200), [src/jsx/context.ts:213-229](repo://src/jsx/context.ts#L213-L229)

## Streaming with Suspense and ErrorBoundary

`Suspense` renders its children with `toString()`. If any result is a promise it emits a placeholder immediately: `<template id="H:n"></template>`, the `fallback` markup and a `<!--/$-->` marker, together with a callback. Once the children resolve, the callback produces `<template data-hono-target="H:n">content</template>` plus a small inline script that replaces the placeholder range with the template's content. When the buffer is still available (non-streaming render) the content is substituted directly into the buffer instead. If nothing is pending it simply returns the joined children.

Sources: [src/jsx/streaming.ts:34-137](repo://src/jsx/streaming.ts#L34-L137)

`ErrorBoundary` works the same way for failures. Children that throw, or reject while pending, are replaced by `fallback` or `fallbackRender(error)`, and `onError` is called. The pending path uses an `E:n` placeholder, an extra callback chain, and a cleanup script that removes the placeholder range after streaming completes. The script `nonce` is read from `StreamingContext`.

Sources: [src/jsx/components.ts:55-126](repo://src/jsx/components.ts#L55-L126), [src/jsx/components.ts:130-248](repo://src/jsx/components.ts#L130-L248), [src/jsx/streaming.ts:30-32](repo://src/jsx/streaming.ts#L30-L32)

`renderToReadableStream(content, onError)` turns a node or promise into a `ReadableStream<Uint8Array>`. It resolves the first chunk (with `BeforeStream` callbacks applied), enqueues it, then runs each remaining callback in the `Stream` phase and enqueues results as they resolve, recursively handling callbacks produced by those results, and closes the stream when all are done. A cancelled stream stops enqueuing, and errors go to `onError`.

Sources: [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

## Hoisted head elements

`title`, `script` (with `src` and `async`), `style` (with `href` and `precedence`), `link` and `meta` are intrinsic functions that, when rendered outside `<head>`, move their markup into the document head. Each renders its normal tag text and attaches an `insertIntoHead` callback. When the buffer already contains `</head>`, the callback removes the tag from where it was and inserts it before `</head>`. Duplicates are detected by key (for example the same `href` for a stylesheet with precedence) and removed, and tags with a `precedence` are ordered by first appearance of that precedence. Inside `<head>` or `<svg>` (known from the namespace context) they render as ordinary elements.

Sources: [src/jsx/intrinsic-element/components.ts:17-135](repo://src/jsx/intrinsic-element/components.ts#L17-L135), [src/jsx/intrinsic-element/components.ts:136-177](repo://src/jsx/intrinsic-element/components.ts#L136-L177)

`form`, `input` and `button` accept a function for `action` or `formAction`; on the server it is replaced by the function's `PERMALINK` string if it has one, or dropped.

Sources: [src/jsx/intrinsic-element/components.ts:182-210](repo://src/jsx/intrinsic-element/components.ts#L182-L210)

## jsxRenderer

`jsxRenderer(component, options)` is middleware that wires `c.render` to JSX (see [[Context and Responses]] for `setRenderer`, `setLayout` and `getLayout`). It takes the layout already set by a parent (or `Fragment`), and if a `component` is given it becomes the new layout, receiving the previous one as `Layout`, which allows nested layouts. Then it installs a renderer and calls `next()`.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

When a handler calls `c.render(children, props)`, the renderer builds the layout around the children, prefixes a doctype (`<!DOCTYPE html>` by default, a custom string, or none for `docType: false`), and wraps everything in `RequestContext.Provider` with the `Context` as value, so any component can call `useRequestContext()` (it throws `RequestContext is not provided.` outside a render). Without `stream` the result is `c.html(body)`. With `stream: true` it sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8` and `Content-Encoding: Identity`, and returns `c.body(renderToReadableStream(body))`. A `stream` object supplies its own headers instead.

Sources: [src/middleware/jsx-renderer/index.ts:15-80](repo://src/middleware/jsx-renderer/index.ts#L15-L80), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165)
