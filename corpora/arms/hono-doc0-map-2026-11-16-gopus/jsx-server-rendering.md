---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` lets an app write HTML as JSX and render it to a string on the server, without React. A JSX expression becomes a `JSXNode`, and rendering is simply calling its `toString()`, which writes the tag, the attributes and the children into a string buffer. A node is flagged `isEscaped`, so it can be passed straight to `c.html()` or interpolated into the `html` template ([[HTML and CSS Helpers]], [[Context and Responses]]).

Sources: [src/jsx/base.ts:140-252](repo://src/jsx/base.ts#L140-L252), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

```tsx
/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx'

const Layout: FC = ({ children }) => (
  <html>
    <body>{children}</body>
  </html>
)

app.get('/', (c) => c.html(<Layout><h1 class="title">Hello</h1></Layout>))
```

Sources: [src/jsx/base.ts:26-47](repo://src/jsx/base.ts#L26-L47), [src/jsx/jsx-runtime.ts:1-8](repo://src/jsx/jsx-runtime.ts#L1-L8)

The same components also run in the browser with `hono/jsx/dom` ([[Client-Side DOM Rendering]]); this page covers the string renderer. Async components and streaming are on [[Suspense and Streaming JSX]], and layouts through middleware on [[JSX Renderer Middleware]].

Sources: [src/jsx/base.ts:318-351](repo://src/jsx/base.ts#L318-L351)

## From JSX to nodes

TypeScript's automatic runtime imports `jsx` and `jsxs` from `hono/jsx/jsx-runtime`; both are `jsxDEV` from the dev runtime. `jsxDEV` normalises `props.children` into an array and calls `jsxFn`; the classic `jsx(tag, props, ...children)` export does the same and moves `key` out of the props.

Sources: [src/jsx/jsx-runtime.ts:1-8](repo://src/jsx/jsx-runtime.ts#L1-L8), [src/jsx/jsx-dev-runtime.ts:1-26](repo://src/jsx/jsx-dev-runtime.ts#L1-L26), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

`jsxFn` picks the node class:

Sources: [src/jsx/base.ts:318-351](repo://src/jsx/base.ts#L318-L351), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

| Tag | Node |
| --- | --- |
| A function component | `JSXFunctionNode`, which calls the function when rendered |
| `title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button` | `JSXFunctionNode` around the intrinsic component of that name |
| `svg` or `head` | `JSXNode` whose children are wrapped in a namespace context provider |
| Any other string | `JSXNode` |

Sources: [src/jsx/base.ts:318-351](repo://src/jsx/base.ts#L318-L351), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

A `JSXNode` constructor rejects a string tag that is not a valid tag name, for example one starting with `!` or `?` or containing quotes, `<`, `>` or control characters, so a tag name taken from input cannot inject markup.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154), [src/jsx/utils.ts:18-47](repo://src/jsx/utils.ts#L18-L47)

`hono/jsx/jsx-runtime` also exports `jsxTemplate`, `jsxAttr` and `jsxEscape`. These are the entry points of a precompiling JSX transform, which emits template literals instead of function calls: `jsxTemplate` is the `html` helper, and `jsxAttr` serialises one attribute with the same rules as below.

Sources: [src/jsx/jsx-runtime.ts:9-51](repo://src/jsx/jsx-runtime.ts#L9-L51)

## Rendering to a string

`toString()` creates a buffer and calls `toStringToBuffer`. When nothing asynchronous was met, the buffer holds one string, which is returned, after running its `Stringify` callbacks if there are any. When an async component or a Promise child was met, the buffer holds Promises too, and `toString()` returns a `Promise<string>` from `stringBufferToString`.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

`toStringToBuffer` writes `<tag`, then each attribute, then either `/>` for an empty void element (`br`, `img`, `input`, `meta`, …) or `>`, the children, and the closing tag. Children are written by `childrenToStringToBuffer`: strings are escaped, numbers and escaped strings are written as is, booleans and nullish values are skipped, nested arrays are flattened, nodes render themselves, and Promises are queued in the buffer.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251)

A function component is called with its props, with `children` set to the single child or the array. Its result may be a node, an escaped string (whose callbacks are carried into the buffer), a plain string (escaped), a number, a Promise (queued), or `null` or a boolean (nothing).

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

## Attributes

| Prop | Output |
| --- | --- |
| `className`, `htmlFor`, `httpEquiv`, … | Renamed to `class`, `for`, `http-equiv`, … |
| string | `key="escaped value"` |
| number or escaped string | `key="value"` |
| `null` or `undefined` | Omitted |
| `true` on a boolean attribute (`checked`, `disabled`, …) | `key=""`; `false` omits it |
| `style` object | Serialised to a CSS string |
| `dangerouslySetInnerHTML` | `__html` used as raw children; throws if there are also children |
| Promise | Awaited into the attribute value |
| function named `on…`, or `ref` | Ignored on the server |
| other function | Throws `Invalid prop` |

Sources: [src/jsx/base.ts:79-106](repo://src/jsx/base.ts#L79-L106), [src/jsx/base.ts:186-239](repo://src/jsx/base.ts#L186-L239), [src/jsx/utils.ts:1-12](repo://src/jsx/utils.ts#L1-L12)

Attribute names containing whitespace, quotes, `<`, `>`, `/`, `=` or control characters are dropped. Inside `<svg>`, camelCase presentation attributes such as `strokeWidth` are written in kebab case.

Sources: [src/jsx/utils.ts:14-81](repo://src/jsx/utils.ts#L14-L81), [src/jsx/base.ts:52-60](repo://src/jsx/base.ts#L52-L60), [src/jsx/base.ts:186-189](repo://src/jsx/base.ts#L186-L189)

`styleObjectForEach` converts a style object: camelCase keys become kebab case, CSS variables (`--x`) are kept, numbers get `px` except for unitless properties such as `opacity`, `z-index` or `flex`, and `null` values are skipped. A key with unsafe characters is dropped, and so is a string value that could end the declaration or open a block, such as an unbalanced bracket, a stray `;` or a `{`.

Sources: [src/jsx/utils.ts:83-202](repo://src/jsx/utils.ts#L83-L202)

## Fragment, memo and element helpers

`Fragment` renders its children without a wrapper; `StrictMode` is an alias. `memo(component, propsAreEqual = shallowEqual)` returns the last result while the props compare equal. `isValidElement`, `cloneElement` and `Children` mirror React's APIs, and `version` is `19.0.0-hono-jsx`. A node also has React-style `type` and `ref` getters, which a comment says are there for libraries that rely on React's internal structure.

Sources: [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302), [src/jsx/base.ts:353-444](repo://src/jsx/base.ts#L353-L444), [src/jsx/base.ts:156-164](repo://src/jsx/base.ts#L156-L164), [src/jsx/index.ts:6-73](repo://src/jsx/index.ts#L6-L73)

The default export of `hono/jsx` bundles the same functions and hooks, so `import React from 'hono/jsx'` style code works ([[JSX Hooks]]).

Sources: [src/jsx/index.ts:75-110](repo://src/jsx/index.ts#L75-L110)

## Context

`createContext(defaultValue)` returns a component that is also its own `Provider`. While it renders its children, it pushes `value` onto a stack for that context and pops it afterwards, including after an async subtree finishes. `useContext(context)` reads the top of the stack, or the default.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261)

Stacks are kept per rendering, in a `WeakMap` that `runWithRenderContext` creates for each top-level `toString()`, so two requests rendering at once do not see each other's values. That store travels across `await` through `AsyncLocalStorage`, loaded from `node:async_hooks` when the runtime provides it.

Sources: [src/jsx/context.ts:13-71](repo://src/jsx/context.ts#L13-L71), [src/jsx/context.ts:161-189](repo://src/jsx/context.ts#L161-L189)

Without `AsyncLocalStorage`, the store only exists synchronously. Hono then warns once that `useContext()` after an `await` in an async component falls back to the default value, and names the runtimes that have `AsyncLocalStorage`. Async components that return a Promise capture the context values before suspending and restore them when they resume, through `captureRenderContext`.

Sources: [src/jsx/context.ts:73-80](repo://src/jsx/context.ts#L73-L80), [src/jsx/context.ts:196-200](repo://src/jsx/context.ts#L196-L200), [src/jsx/base.ts:268-283](repo://src/jsx/base.ts#L268-L283)

## Document metadata hoisting

`title`, `meta`, `link`, `style` and `script` rendered anywhere in the page can be moved into `<head>`. Each renders its own tag and attaches an `insertIntoHead` callback. When the callback runs and the buffer contains `</head>`, it removes the collected tags from where they were and inserts them just before `</head>`.

Sources: [src/jsx/intrinsic-element/components.ts:17-119](repo://src/jsx/intrinsic-element/components.ts#L17-L119)

Tags are de-duplicated per rendering: `meta` by `name`, `httpEquiv`, `charset` or `itemProp`, `script` by `src`, `style` by `href`, and stylesheet `link`s with a `precedence` by `href`. Tags with a `precedence` are ordered by the order in which each precedence value first appeared.

Sources: [src/jsx/intrinsic-element/common.ts:1-23](repo://src/jsx/intrinsic-element/common.ts#L1-L23), [src/jsx/intrinsic-element/components.ts:36-84](repo://src/jsx/intrinsic-element/components.ts#L36-L84)

Not every tag is hoisted:

Sources: [src/jsx/intrinsic-element/components.ts:96-177](repo://src/jsx/intrinsic-element/components.ts#L96-L177)

| Element | Hoisted when |
| --- | --- |
| `title`, `meta` | Not inside `<head>` (for `title`, also not inside `<svg>`) and without `itemProp` |
| `script` | It has both `src` and `async`, outside `<head>` |
| `style` | It has both `href` and `precedence` |
| `link` | It has no `onLoad` or `onError`, and a stylesheet also has `precedence` and is not `disabled` |

Sources: [src/jsx/intrinsic-element/components.ts:96-177](repo://src/jsx/intrinsic-element/components.ts#L96-L177)

`form`, `input` and `button` accept a function as `action` or `formAction` for client-side forms. On the server such a function is replaced by its `PERMALINK` URL if it has one, and dropped otherwise ([[DOM Elements, Forms and CSS]]).

Sources: [src/jsx/intrinsic-element/components.ts:179-210](repo://src/jsx/intrinsic-element/components.ts#L179-L210)

## ErrorBoundary

`ErrorBoundary` renders its children and, when one throws, renders `fallback`, or `fallbackRender(error)`, instead, after calling `onError(error)`. A synchronous error is caught while resolving the children. When some children are Promises, the boundary instead emits a placeholder and replaces it once they settle, which is how errors in async components and inside `Suspense` are handled ([[Suspense and Streaming JSX]]).

Sources: [src/jsx/components.ts:47-126](repo://src/jsx/components.ts#L47-L126), [src/jsx/components.ts:128-164](repo://src/jsx/components.ts#L128-L164)
