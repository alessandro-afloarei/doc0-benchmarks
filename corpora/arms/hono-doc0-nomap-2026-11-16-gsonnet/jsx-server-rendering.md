---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX runtime that turns a JSX tree into an HTML string on the server. A tag becomes a `JSXNode`; `toString()` walks the tree and writes escaped HTML into a buffer. Async components, `Suspense` and `ErrorBoundary` are supported by letting the buffer hold promises and by attaching callbacks to the resulting string that can emit more HTML later. The same package also holds a browser renderer (see [[JSX DOM Rendering and Hooks]]); this page covers the server path from `jsx()` to a `Response`.

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

## From JSX to nodes

The compiler calls `jsx` (classic) or `jsxDEV` (automatic runtime). `jsx(tag, props, ...children)` stores `children` on `props` (one child directly, several as an array), removes `key` and delegates to `jsxFn`. `jsxDEV(tag, props, key)` does the same from a `children` prop.

Sources: [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26)

`jsxFn` picks the node class:

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351)

| Tag | Node |
| --- | --- |
| a function (a component) | `JSXFunctionNode` |
| a built-in intrinsic component (the form and metadata elements in `intrinsic-element/components`) | `JSXFunctionNode` wrapping that component |
| `svg` or `head` | `JSXNode` whose children are wrapped in a namespace context holding the tag name |
| any other string | `JSXNode` |

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351)

`JSXNode`'s constructor rejects string tags that are not valid tag names (`Invalid JSX tag name`). `Fragment` creates a `JSXFragmentNode`, which writes only its children.

Sources: [src/jsx/base.ts:140-154](repo://src/jsx/base.ts#L140-L154), [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302), [src/jsx/base.ts:406-419](repo://src/jsx/base.ts#L406-L419)

## Writing HTML into a buffer

### Buffer and elements

`JSXNode.toString()` creates a buffer `['']` and calls `toStringToBuffer`. The buffer is an array where index 0 is the string being built; when a value is not yet known, a promise is pushed to the front together with an empty string, so the array reads as alternating pieces that `stringBufferToString` later joins in order once all promises settle. If the buffer never grew beyond one entry the string is returned directly.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:37-38](repo://src/utils/html.ts#L37-L38), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

For an element, `toStringToBuffer` writes `<tag`, then each prop:

Sources: [src/jsx/base.ts:179-190](repo://src/jsx/base.ts#L179-L190)

- Keys are normalised and skipped when they are not valid attribute names; inside `svg` camel-case presentation attributes become kebab-case.
- A `style` object is converted to `property:value` pairs and escaped.
- Strings are escaped with `escapeToBuffer`; numbers and already-escaped values are written as they are; `null` and `undefined` are dropped.
- Booleans are written as `key=""` for known boolean attributes (when true) and dropped otherwise.
- `dangerouslySetInnerHTML` uses its `__html` unescaped as the only child, and throws when `children` is also present.
- A promise value is awaited into the buffer; functions are ignored when the key starts with `on` or is `ref`, and throw otherwise.

Sources: [src/jsx/base.ts:190-239](repo://src/jsx/base.ts#L190-L239)

Void tags (`br`, `img`, `input` and so on) with no children end with `/>`; other elements write their children and a closing tag.

Sources: [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251), [src/jsx/base.ts:62-106](repo://src/jsx/base.ts#L62-L106)

Children are handled by `childrenToStringToBuffer`: strings are escaped, booleans and nullish values skipped, nodes write themselves, numbers and escaped values are appended raw, promises are pushed on the buffer, and arrays are flattened recursively.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129)

### Escaping

`escapeToBuffer` replaces `& < > ' "` with entities. A string that has been marked with `raw(value)` (an `HtmlEscapedString`, a `String` object with `isEscaped = true` and optional `callbacks`) is trusted and not escaped again. The `html` tagged template in `hono/html` follows the same rule: plain strings are escaped, escaped values are inserted as is.

Sources: [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127), [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

## Components and async

`JSXFunctionNode.toStringToBuffer` calls the component with `props` (children folded into `props.children`) and reacts to the return value: nothing renders for boolean or nullish; a `JSXNode` writes itself into the same buffer; an escaped string or number is appended, carrying any callbacks into the buffer; any other string is escaped. A promise return (an async component) is pushed onto the buffer, so the result is a promise-valued string.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

`memo(component, propsAreEqual)` caches the last result and recomputes it when the props are not shallow-equal (or not equal by your function). `Children` offers `map`, `forEach`, `count`, `only` and `toArray` over the children value.

Sources: [src/jsx/base.ts:353-404](repo://src/jsx/base.ts#L353-L404), [src/jsx/children.ts:1-20](repo://src/jsx/children.ts#L1-L20)

## Context

`createContext(default)` returns a component that is also its own `Provider`. When rendered, it pushes `props.value` onto the context's value stack, renders its children to a string, and pops the value (after the promise settles when the result is async). `useContext` reads the top of the stack.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261)

Values live in a `WeakMap` store that belongs to one render, kept in an `AsyncLocalStorage` when the runtime has it (found through `process.getBuiltinModule` or the main module's `require`), so different requests rendering at once do not see each other's values across `await`. `runWithRenderContext` opens a store, but not when already inside one. Without `AsyncLocalStorage` a module-level fallback store is used, and a one-time warning is logged if a context is read after an `await` in an async component. `captureRenderContext()` returns a function that restores the current values later, which suspended subtrees use to resume with the right context.

Sources: [src/jsx/context.ts:13-71](repo://src/jsx/context.ts#L13-L71), [src/jsx/context.ts:73-107](repo://src/jsx/context.ts#L73-L107), [src/jsx/context.ts:161-200](repo://src/jsx/context.ts#L161-L200)

## Suspense and streaming

Pieces of output that finish late are modelled as callbacks on an `HtmlEscapedString`. A callback receives a phase (`Stringify`, `BeforeStream` or `Stream`), the string buffer and a context object, and may return more HTML. `resolveCallback` runs the callbacks of a string for a given phase and splices their results in.

Sources: [src/utils/html.ts:6-21](repo://src/utils/html.ts#L6-L21), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

`Suspense({ children, fallback })` renders its children to strings. If any of them is still a promise, it returns the fallback wrapped between `<template id="H:n"></template>` and `<!--/$-->`, with a callback attached. In the `Stringify` phase (a plain `c.html`), the callback waits for the children and replaces the placeholder inside the buffer. In the `Stream` phase it emits a `<template data-hono-target="H:n">` holding the content and a small script that swaps it in place of the fallback, using the nonce from `StreamingContext` when present. If nothing is pending it just returns the joined children.

Sources: [src/jsx/streaming.ts:30-137](repo://src/jsx/streaming.ts#L30-L137)

`ErrorBoundary({ fallback, fallbackRender, onError, children })` renders children synchronously where it can and, on a synchronous throw, renders the fallback instead. When a child is asynchronous it returns a placeholder (`<template id="E:n">`) and a callback; if the awaited children reject, the callback renders the fallback and replaces the placeholder (in the buffer, or by streaming a script).

Sources: [src/jsx/components.ts:55-126](repo://src/jsx/components.ts#L55-L126), [src/jsx/components.ts:128-205](repo://src/jsx/components.ts#L128-L205)

`renderToReadableStream(content, onError)` produces the actual stream. It resolves the `BeforeStream` callbacks and enqueues the first chunk (the page with fallbacks), then runs the `Stream` callbacks; each one that returns a promise is queued, and its output is enqueued when it settles, with any callbacks inside it run in turn. Errors go to `onError` and the stream closes after all promises are done; `cancel()` stops further writes.

Sources: [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

## Rendering a Response

A handler returns JSX through `c.html(<Page />)`. `c.html` accepts the node's string or promise; for a promise it calls `resolveCallback` with the `Stringify` phase so late `Suspense` content is included, then builds a `text/html` response. For streamed output, pass `renderToReadableStream(<Page />)` to `c.body` and set the headers yourself, or use `jsxRenderer` with `stream: true`, which does both. See [[Context and Responses]] and [[Response, Observability and Utility Middleware]].

Sources: [src/context.ts:723-735](repo://src/context.ts#L723-L735), [src/middleware/jsx-renderer/index.ts:60-80](repo://src/middleware/jsx-renderer/index.ts#L60-L80)

## Package entry

`hono/jsx` re-exports a React-shaped API from `index.ts`: `jsx` as `createElement`, `Fragment`, `memo`, `isValidElement`, `cloneElement`, `ErrorBoundary`, `Suspense`, `Children`, context functions and the hooks (the hooks are described in [[JSX DOM Rendering and Hooks]]), plus a default export with the same names.

Sources: [src/jsx/index.ts:6-110](repo://src/jsx/index.ts#L6-L110)
