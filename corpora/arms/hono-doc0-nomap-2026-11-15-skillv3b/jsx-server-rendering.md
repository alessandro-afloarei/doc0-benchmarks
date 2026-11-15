---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX implementation with no virtual DOM on the server: a JSX expression builds a `JSXNode`, and calling `toString()` on it writes HTML straight into a string buffer, escaping text as it goes. The result is an `HtmlEscapedString` that `c.html()` sends as a response. The same component code can run in the browser through `hono/jsx/dom`, covered on [[Client-side JSX (hono/jsx/dom)]]; async components and `Suspense` are on [[Streaming JSX and Suspense]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

To use it, a project sets `"jsx": "react-jsx"` and `"jsxImportSource": "hono/jsx"` in `tsconfig.json`. The compiler then calls `jsx` / `jsxs` from `hono/jsx/jsx-runtime`, which are `jsxDEV`: it takes the children from `props.children` and hands everything to `jsxFn`. The classic `jsx(tag, props, ...children)` factory from `hono/jsx` does the same for `@jsx` pragmas.

Sources: [src/jsx/jsx-runtime.ts:1-14](repo://src/jsx/jsx-runtime.ts#L1-L14), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

## Building nodes

`jsxFn(tag, props, children)` picks one of three node classes:

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351)

| Tag | Node | Rendering |
| --- | --- | --- |
| A function component | `JSXFunctionNode` | Calls the component with props (children merged in) and renders what it returns |
| `title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button` | `JSXFunctionNode` wrapping a built-in component | Special behaviour such as hoisting into `<head>` |
| `svg`, `head` | `JSXNode` with a namespace context provider inside | Children know they are inside SVG or `<head>` |
| Any other string | `JSXNode` | Writes the element and its attributes |

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

A tag name that is not a valid HTML tag throws `Invalid JSX tag name` when the node is created, so user input can never become an element name.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154)

## Rendering to a string

### The buffer

`toString()` renders into a `StringBufferWithCallbacks`, an array whose element 0 is the string being built. Text and attributes are appended to `buffer[0]`. When a child is a `Promise` (an async component or an async attribute value), it is `unshift`ed with an empty string ahead of it, so the buffer becomes a list of finished strings interleaved with pending promises. At the end, a buffer of length one is returned as a plain string; otherwise `stringBufferToString` awaits the promises in order and stitches the pieces, escaping any resolved value that is not already marked escaped.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:37-88](repo://src/utils/html.ts#L37-L88)

The upshot is that a tree with no async parts renders synchronously to a string, and a tree with async parts renders to a `Promise<string>`, which `c.html()` accepts.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

### Elements and attributes

`JSXNode.toStringToBuffer` writes `<tag`, then each prop. Attribute names are normalised (`className` to `class`, `htmlFor` to `for`) and invalid names skipped; inside SVG, camel-case presentation attributes such as `strokeWidth` become `stroke-width`.

Sources: [src/jsx/base.ts:179-194](repo://src/jsx/base.ts#L179-L194), [src/jsx/base.ts:52-60](repo://src/jsx/base.ts#L52-L60), [src/jsx/utils.ts:1-40](repo://src/jsx/utils.ts#L1-L40)

| Prop value | Output |
| --- | --- |
| string | `key="escaped value"` |
| object on `style` | `style="prop:value;..."`, keys converted to kebab case |
| number or already-escaped string | written as is |
| boolean on a boolean attribute (`disabled`, `checked`, ...) | `key=""` when true, nothing when false |
| `null` or `undefined` | nothing |
| `dangerouslySetInnerHTML` | `__html` becomes the raw children; combining it with children throws |
| function | ignored for `on*` handlers and `ref` (they only matter in the browser); any other function prop throws |
| `Promise` | resolved later in the buffer |

Sources: [src/jsx/base.ts:190-239](repo://src/jsx/base.ts#L190-L239), [src/jsx/base.ts:79-106](repo://src/jsx/base.ts#L79-L106)

Void elements (`br`, `img`, `input`, `meta`, ...) without children close as `<tag/>`; others get their children and a closing tag. Children that are strings are escaped, numbers and escaped strings written directly, booleans, `null` and `undefined` skipped, and arrays flattened.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

### Function components

`JSXFunctionNode` calls the component and dispatches on the result: `null` or a boolean renders nothing, a `JSXNode` renders into the same buffer, an escaped string is appended with its callbacks, a plain string is escaped, and a promise is pushed into the buffer. For an async component inside a context provider, the current context values are captured with `captureRenderContext` so the subtree renders with the right values when it resumes.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

`memo(component, propsAreEqual)` caches the last result while props stay shallow-equal, `Fragment` renders its children only, and `cloneElement` and `isValidElement` mirror React's API. The module reports `version` as `19.0.0-hono-jsx` so React-oriented libraries accept it.

Sources: [src/jsx/base.ts:353-444](repo://src/jsx/base.ts#L353-L444)

## Escaping

`escapeToBuffer` replaces `&`, `<`, `>`, `"` and `'` with entities, scanning once and appending unchanged runs in slices. Strings that have passed through it, or through `raw()`, are `String` objects with `isEscaped: true`, which is how later stages know not to escape them again. `raw(value)` is therefore the only way to insert HTML without escaping, and should only receive trusted input.

Sources: [src/utils/html.ts:6-46](repo://src/utils/html.ts#L6-L46), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

An `HtmlEscapedString` may also carry `callbacks`: functions run after rendering with the finished buffer, used for work that needs the whole document, such as moving `<title>` into `<head>` or replacing `Suspense` fallbacks. `resolveCallbackSync` runs them for synchronous output, and `resolveCallback` for async output in phases (`Stringify`, `BeforeStream`, `Stream`).

Sources: [src/utils/html.ts:6-21](repo://src/utils/html.ts#L6-L21), [src/utils/html.ts:129-182](repo://src/utils/html.ts#L129-L182)

## The html helper

`html` from `hono/html` is a tagged template with the same rules: literal parts are trusted, interpolated strings are escaped, numbers written, `null`, `undefined` and booleans dropped, arrays flattened, escaped strings and JSX kept, and promises awaited. It is useful for a document shell (`<!DOCTYPE html>` cannot be written in JSX) or for small pages without a JSX build step. The JSX precompile mode also uses it as `jsxTemplate`, with `jsxAttr` serialising attributes.

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57), [src/jsx/jsx-runtime.ts:14-51](repo://src/jsx/jsx-runtime.ts#L14-L51)

## Document metadata

`<title>`, `<meta>`, `<link>`, `<script>` and `<style>` written anywhere in the tree are hoisted into `<head>`: the component renders the tag and attaches an `insertIntoHead` callback. When the callback sees `</head>` in the buffer, it removes the tag from where it was rendered and inserts it before `</head>`. Tags inside `<head>` or `<svg>` and tags with `itemProp` are rendered in place. Stylesheet links with a `precedence` prop are ordered by precedence and de-duplicated by `href`, so several components can each declare the stylesheet they need.

Sources: [src/jsx/intrinsic-element/components.ts:17-135](repo://src/jsx/intrinsic-element/components.ts#L17-L135)

## Context on the server

`createContext(default)` returns a provider component: rendering `<Ctx.Provider value={v}>` pushes `v` onto a stack for the duration of its children's rendering and pops it afterwards (after the promise settles for async children). `useContext(Ctx)` reads the top of the stack.

Sources: [src/jsx/context.ts:200-260](repo://src/jsx/context.ts#L200-L260)

Stacks are kept per render, not globally, so concurrent requests never see each other's values. Each `toString()` runs inside `runWithRenderContext`, which stores a per-render `WeakMap` in `AsyncLocalStorage` when the runtime provides it (Node.js 20.16 and later, Deno, Bun, Workers with `nodejs_compat`), found through `process.getBuiltinModule` so bundlers do not pull in `node:async_hooks`. Without it, the store only lives during synchronous rendering, and `useContext` after an `await` in an async component returns the default value, with a one-time warning.

Sources: [src/jsx/context.ts:25-107](repo://src/jsx/context.ts#L25-L107), [src/jsx/context.ts:149-189](repo://src/jsx/context.ts#L149-L189)

## The jsxRenderer middleware

`jsxRenderer(Layout, options)` from `hono/jsx-renderer` sets a renderer on the context so handlers call `c.render(<Page />, props)`. The renderer wraps the content in the layout component (which receives `children`, the props and the parent `Layout`), wraps that in a `RequestContext` provider, prefixes `<!DOCTYPE html>` unless `docType` is `false` or a custom string, and returns `c.html(...)`. With `stream: true` it returns `c.body(renderToReadableStream(...))` with chunked headers instead.

Sources: [src/middleware/jsx-renderer/index.ts:15-80](repo://src/middleware/jsx-renderer/index.ts#L15-L80)

Renderers nest: each `jsxRenderer` reads the layout set by an outer one with `c.getLayout()` and passes it as `Layout`, so a section layout can render `<Layout>{children}</Layout>` to sit inside the site layout. Inside any component, `useRequestContext()` returns the Hono `Context`, giving access to `c.req` and variables without passing them as props. The `c.render`, `setRenderer` and `setLayout` methods are described on [[Context and Response Building]].

Sources: [src/middleware/jsx-renderer/index.ts:116-165](repo://src/middleware/jsx-renderer/index.ts#L116-L165), [src/context.ts:448-497](repo://src/context.ts#L448-L497)
