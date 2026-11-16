---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX runtime that renders to HTML strings rather than to a virtual DOM. A JSX expression creates a `JSXNode`; calling `toString()` on it walks the tree and writes escaped HTML into a buffer. A component that returns a promise makes the whole result a promise. Handlers return the result with `c.html(...)` or, through a layout, `c.render(...)`. The same components also run in the browser with `hono/jsx/dom` (see [[JSX DOM and Hooks]]); streaming with `Suspense` is on [[Streaming and Suspense]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

```tsx
/** @jsxImportSource hono/jsx */
const Layout = (props: { children: any }) => (
  <html>
    <body>{props.children}</body>
  </html>
)

app.get('/', (c) => c.html(<Layout><h1>Hello {c.req.query('name')}</h1></Layout>))
```

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351)

## Escaping model

### HtmlEscapedString

Everything rendered is a string, and escaping is tracked on the string itself. `raw(value, callbacks)` wraps a value in a `String` object marked `isEscaped: true`, optionally carrying callbacks. An `HtmlEscapedString` is inserted as is; a plain string is escaped. `JSXNode` is also marked `isEscaped`, so a rendered component can be nested inside the `html` template without double escaping.

Sources: [src/utils/html.ts:17-46](repo://src/utils/html.ts#L17-L46), [src/jsx/base.ts:140-146](repo://src/jsx/base.ts#L140-L146)

`escapeToBuffer` replaces `&`, `<`, `>`, `"` and `'` with entities. It searches for the first special character once and copies untouched runs in bulk, so text without special characters is appended in a single step.

Sources: [src/utils/html.ts:51-127](repo://src/utils/html.ts#L51-L127)

> [!CAUTION]
> `raw()` and `dangerouslySetInnerHTML` bypass escaping. Never pass user input to them.

Sources: [src/jsx/base.ts:220-225](repo://src/jsx/base.ts#L220-L225)

### The string buffer

Rendering appends to a `StringBuffer`, an array whose first element is the string being built. When a child is a promise, the renderer does not wait: it `unshift`s the promise and a fresh empty string onto the front, then keeps writing. A buffer of length 1 means the render was synchronous. Otherwise `stringBufferToString` awaits all the promises and stitches the pieces together from the end of the array, escaping any resolved value not marked as escaped and collecting callbacks.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/utils/html.ts:37-38](repo://src/utils/html.ts#L37-L38), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

### Callbacks

An `HtmlEscapedString` can carry `callbacks`, functions run after the whole document is a string, in one of three phases (`Stringify`, `BeforeStream`, `Stream`). They let a component deep in the tree change other parts of the output, which is how `<title>` moves into `<head>` and how Suspense fills in streamed content. `resolveCallbackSync` runs them for a synchronous render, and `resolveCallback` runs them asynchronously, recursing into strings they return. `c.html()` calls `resolveCallback` in the `Stringify` phase before building the response.

Sources: [src/utils/html.ts:6-16](repo://src/utils/html.ts#L6-L16), [src/utils/html.ts:129-182](repo://src/utils/html.ts#L129-L182), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

## From JSX to HTML

### Creating nodes

The compiler turns `<div class="a">x</div>` into a call to `jsx` (classic) or the automatic runtime's `jsx`/`jsxs`. Both store `children` on the props, pull out `key`, and call `jsxFn`, which picks a node class:

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351), [src/jsx/jsx-runtime.ts:6-8](repo://src/jsx/jsx-runtime.ts#L6-L8)

| Tag | Node |
| --- | --- |
| A function component | `JSXFunctionNode` |
| `title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button` | `JSXFunctionNode` around the special component of the same name |
| `svg` or `head` | `JSXNode` whose child is a namespace context provider |
| Any other string | `JSXNode`; invalid tag names throw |

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351), [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154)

### Rendering elements

`JSXNode.toStringToBuffer` writes `<tag`, then each attribute:

Sources: [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251)

- Keys are normalized (`className` to `class`, `htmlFor` to `for`); inside `<svg>`, presentation attributes such as `strokeWidth` become kebab case.
- Invalid attribute names are skipped.
- A `style` object becomes a `prop:value;...` string.
- Strings are escaped, numbers and escaped strings are written as is, and `null`/`undefined` are dropped.
- Booleans render only for known boolean attributes (`checked`, `disabled`, ...), as `name=""` when true.
- A promise value is written later through the buffer.
- Functions are allowed only for `on*` handlers and `ref`, and ignored on the server; any other function prop throws.
- Other objects are stringified and escaped.

Sources: [src/jsx/base.ts:52-106](repo://src/jsx/base.ts#L52-L106), [src/jsx/base.ts:186-239](repo://src/jsx/base.ts#L186-L239)

Void elements (`br`, `img`, `input`, ...) without children close with `/>`. Otherwise the children are written: strings escaped, `null`, `undefined` and booleans skipped, nested arrays flattened.

Sources: [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251), [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129)

### Rendering components

`JSXFunctionNode` calls the component with its props, `children` folded in. A returned node is rendered in place, an escaped string or number is appended with its callbacks merged into the buffer, a plain string is escaped, and a promise goes into the buffer. When contexts exist, the current context values are captured with the promise so the subtree resumes with the same values after it resolves.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

`Fragment` renders only its children. `memo(component, propsAreEqual)` caches the last result for equal props, compared shallowly by default. `cloneElement` and `isValidElement` follow React's API for library compatibility.

Sources: [src/jsx/base.ts:353-444](repo://src/jsx/base.ts#L353-L444)

## Document metadata

`<title>`, `<meta>`, `<link>`, `<script async src>` and `<style href precedence>` may appear anywhere in the tree and still end up in `<head>`. Each is rendered normally, but its string carries an `insertIntoHead` callback. When the callback runs on the finished document and finds `</head>`, it removes the tag from where it was rendered and inserts it before `</head>`.

Sources: [src/jsx/intrinsic-element/components.ts:17-91](repo://src/jsx/intrinsic-element/components.ts#L17-L91), [src/jsx/intrinsic-element/components.ts:96-119](repo://src/jsx/intrinsic-element/components.ts#L96-L119)

Tags are tracked per document in a `WeakMap` keyed by the render's context object. Repeated tags are de-duplicated by key attributes, so a page and its layout can both declare `<meta name="description">` and only one survives. Stylesheet `<link>` and `<style>` with `precedence` are ordered by precedence group, then by order of appearance. Tags written directly inside `<head>`, inside `<svg>`, with `itemProp`, or, for scripts, without both `src` and `async` are left where they are.

Sources: [src/jsx/intrinsic-element/components.ts:36-90](repo://src/jsx/intrinsic-element/components.ts#L36-L90), [src/jsx/intrinsic-element/components.ts:121-177](repo://src/jsx/intrinsic-element/components.ts#L121-L177)

`<form action>`, `<input formAction>` and `<button formAction>` accept a function on the server only if it has a permalink, which is then used as the URL; otherwise the attribute is dropped.

Sources: [src/jsx/intrinsic-element/components.ts:179-210](repo://src/jsx/intrinsic-element/components.ts#L179-L210)

## Context

`createContext(defaultValue)` returns a provider component (also reachable as `.Provider`) and registers it globally. Rendering the provider pushes its `value`, renders the children, and pops the value when they finish, including after a promise settles. `useContext(context)` returns the innermost value.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261)

Concurrent requests must not see each other's values across `await`s inside async components. Each render therefore runs with a per-render store (`runWithRenderContext`) held in `AsyncLocalStorage`, loaded at run time through `process.getBuiltinModule` (or `mainModule.require`) so bundlers do not resolve `node:async_hooks`. Where it is unavailable, a synchronous fallback store is used, and `useContext` after an `await` falls back to the default value with a one-time warning.

Sources: [src/jsx/context.ts:25-107](repo://src/jsx/context.ts#L25-L107), [src/jsx/context.ts:161-189](repo://src/jsx/context.ts#L161-L189)

## The html template

`html` from `hono/html` is a tagged template that follows the same rules without JSX. Interpolated strings are escaped, arrays are flattened, `null`/`undefined`/booleans vanish, escaped strings (including rendered JSX) are inserted as is, and promises make the result a promise. `raw` is re-exported from the same module.

Sources: [src/helper/html/index.ts:9-57](repo://src/helper/html/index.ts#L9-L57)

```ts
import { html, raw } from 'hono/html'

app.get('/', (c) =>
  c.html(html`<!doctype html><h1>Hello ${c.req.query('name')}</h1>${raw('<hr>')}`)
)
```

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

The automatic runtime exports `jsxTemplate`, `jsxAttr` and `jsxEscape` for Deno's precompiled JSX transform, which compiles static markup into template strings and only calls back for dynamic parts.

Sources: [src/jsx/jsx-runtime.ts:9-51](repo://src/jsx/jsx-runtime.ts#L9-L51)

## jsxRenderer

### Layouts

`jsxRenderer(Layout, options)` from `hono/jsx-renderer` sets the context's renderer (see [[Context and Responses]]) so handlers write `c.render(<Page />, props)` and get the page inside the layout. The layout receives `children`, any props passed to `c.render`, and `Layout`, the renderer of an outer `jsxRenderer`, so nested routes can wrap their parent's layout.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/middleware/jsx-renderer/index.ts:33-58](repo://src/middleware/jsx-renderer/index.ts#L33-L58)

```tsx
import { jsxRenderer } from 'hono/jsx-renderer'

app.use('*', jsxRenderer(({ children }) => <html><body>{children}</body></html>))
app.get('/about', (c) => c.render(<h1>About</h1>))
```

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

### Output

The renderer prefixes `<!DOCTYPE html>`, or the `docType` string, or nothing with `docType: false`. It wraps the tree in `RequestContext.Provider`, so any component can call `useRequestContext()` to reach the Hono context. With `stream: true` it sets chunked transfer headers and returns `renderToReadableStream(body)`; a record of headers replaces the defaults. Otherwise it returns `c.html(body)`. `options` may be a function of the context.

Sources: [src/middleware/jsx-renderer/index.ts:15-21](repo://src/middleware/jsx-renderer/index.ts#L15-L21), [src/middleware/jsx-renderer/index.ts:40-80](repo://src/middleware/jsx-renderer/index.ts#L40-L80), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165)
