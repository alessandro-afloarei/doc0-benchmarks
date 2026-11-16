---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX runtime that renders to HTML strings, with no virtual DOM on the server. A JSX expression builds a `JSXNode`; turning it into a string walks the tree once, escaping text as it goes. The result is an `HtmlEscapedString`, a `String` object flagged as already escaped, which `c.html()` sends as it is, as [[Context and Responses]] shows. Async components, `Suspense` and `ErrorBoundary` add promises and callbacks to that string, which `c.html` resolves before responding or `renderToReadableStream` streams as they settle. The same package also renders in the browser, covered on [[JSX DOM Runtime and Hooks]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/utils/html.ts:6-46](repo://src/utils/html.ts#L6-L46), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

```tsx
/** @jsxImportSource hono/jsx */
const Page: FC<{ name: string }> = ({ name }) => (
  <html>
    <body>
      <h1>Hello {name}</h1>
    </body>
  </html>
)

app.get('/', (c) => c.html(<Page name="<Hono>" />))
```

Sources: [src/jsx/base.ts:28-47](repo://src/jsx/base.ts#L28-L47), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26)

## Building nodes

The compiler calls `jsx`/`jsxs` from `hono/jsx/jsx-runtime` (both are `jsxDEV`), or `jsx(tag, props, ...children)` from `hono/jsx` with the classic transform. Both end in `jsxFn`:

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

| Tag | Node |
| --- | --- |
| A function component | `JSXFunctionNode`, which calls the function when stringified |
| `title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button` | `JSXFunctionNode` wrapping the built-in component for that tag |
| `svg`, `head` | `JSXNode` whose children are wrapped in a namespace context |
| Any other string | `JSXNode` |

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351), [src/jsx/jsx-dev-runtime.ts:12-26](repo://src/jsx/jsx-dev-runtime.ts#L12-L26), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

A string tag that is not a valid tag name throws `Invalid JSX tag name`. `key` is taken out of the props and kept on the node. `Fragment` renders only its children.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154), [src/jsx/base.ts:298-316](repo://src/jsx/base.ts#L298-L316), [src/jsx/base.ts:406-419](repo://src/jsx/base.ts#L406-L419)

## Rendering to a string

### Elements and attributes

`toString()` renders into a buffer whose first slot is the string so far. `toStringToBuffer` writes `<tag`, then each attribute, then the children and `</tag>`; the void elements such as `br`, `img` and `input` are closed with `/>` when they have no children.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251)

| Prop value | Output |
| --- | --- |
| String | `key="..."`, escaped |
| Number or escaped string | Written as it is |
| `true`/`false` on a boolean attribute such as `checked` or `disabled` | `key=""`, or nothing |
| `null`, `undefined` | Nothing |
| `style` object | Converted to `prop:value;...`, escaped |
| `dangerouslySetInnerHTML` | `__html` becomes the raw children; throws if there are children too |
| Function | Ignored when the name starts with `on` or is `ref`; any other throws |
| Promise | A placeholder resolved later |

Sources: [src/jsx/base.ts:79-106](repo://src/jsx/base.ts#L79-L106), [src/jsx/base.ts:190-239](repo://src/jsx/base.ts#L190-L239)

Attribute names that are not valid are dropped. Inside `svg`, camel-case presentation attributes such as `strokeWidth` become kebab-case.

Sources: [src/jsx/base.ts:52-60](repo://src/jsx/base.ts#L52-L60), [src/jsx/base.ts:186-194](repo://src/jsx/base.ts#L186-L194)

### Escaping

Children are written by `childrenToStringToBuffer`: strings are escaped by `escapeToBuffer`, which replaces `&`, `<`, `>`, `"` and `'` with entities and, as its comment says, follows `react-dom`'s implementation. Numbers and escaped strings are written raw, booleans and nullish values are skipped, and arrays are flattened. `raw(value)` from `hono/html` marks a string as escaped so it is inserted without change.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46), [src/utils/html.ts:48-127](repo://src/utils/html.ts#L48-L127)

### Function components and promises

A function component is called with its props, children included. A `JSXNode` result is rendered in place, an escaped string is appended with its callbacks, and a plain value is escaped. A promise, from an `async` component, is not awaited: it is pushed into the buffer, and `toString()` then returns a promise from `stringBufferToString`, which awaits every slot and escapes any result not already escaped.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296), [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

### Callbacks

An `HtmlEscapedString` can carry `callbacks`, functions run at three phases: `Stringify` when the whole string is resolved at once, `BeforeStream` before the first chunk is streamed, and `Stream` for chunks that follow. `resolveCallback` runs them with a shared `buffer` and a `context` object unique to the render; a callback may rewrite the buffer or return more HTML. `Suspense`, `ErrorBoundary`, the head-hoisting components below and the [[CSS Helper]] are all built on this.

Sources: [src/utils/html.ts:6-21](repo://src/utils/html.ts#L6-L21), [src/utils/html.ts:129-182](repo://src/utils/html.ts#L129-L182)

## The html helper

`html` from `hono/html` is a tagged template with the same escaping: interpolated strings are escaped, numbers kept, booleans and nullish values dropped, arrays flattened, escaped strings and JSX inserted raw, and promises resolved. It returns an `HtmlEscapedString`, or a promise of one when something was async.

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

```ts
app.get('/', (c) => c.html(html`<p>${userInput}</p>`))
```

Sources: [src/helper/html/index.ts:17-49](repo://src/helper/html/index.ts#L17-L49)

The runtime also exports `jsxTemplate`, `jsxAttr` and `jsxEscape` for compilers that precompile JSX into template strings.

Sources: [src/jsx/jsx-runtime.ts:9-51](repo://src/jsx/jsx-runtime.ts#L9-L51)

## Context

`createContext(default)` returns a component that is also its own `Provider`. Rendering it pushes `value` onto the context's stack, renders the children, and pops the value when the children's string, or its promise, settles. `useContext(context)` reads the top of the stack.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261)

The stacks live in a per-render store so concurrent requests do not see each other's values. Where `AsyncLocalStorage` can be found through `process.getBuiltinModule` or `process.mainModule.require`, the store follows `await` in async components. Without it, a context read after an `await` falls back to the default value and a one-time warning names runtimes that provide `AsyncLocalStorage`.

Sources: [src/jsx/context.ts:25-80](repo://src/jsx/context.ts#L25-L80), [src/jsx/context.ts:161-200](repo://src/jsx/context.ts#L161-L200)

## Document metadata

`title`, `meta`, `link`, `script` and `style` are rendered through built-in components that attach a callback. When the buffer holds `</head>`, the callback moves the tag into the head, removing duplicates by key: the same `title`, the same `meta` `name`, `httpEquiv`, `charset` or `itemProp`, the same `script` `src`. Stylesheet links with a `precedence` prop are ordered by precedence. A component deep in the page can therefore set the page title.

Sources: [src/jsx/intrinsic-element/common.ts:3-23](repo://src/jsx/intrinsic-element/common.ts#L3-L23), [src/jsx/intrinsic-element/components.ts:20-118](repo://src/jsx/intrinsic-element/components.ts#L20-L118)

## Suspense and streaming

### Suspense

`<Suspense fallback={...}>` renders its children. If any child is still a promise, it outputs `<template id="H:n"></template>`, the fallback and a closing `/$` comment marker, plus a callback that waits for the children. When the full string is resolved at once, the callback replaces the placeholder in the buffer with the content. When streaming, it instead emits a `<template data-hono-target="H:n">` holding the content and a small inline script that swaps it in; the script gets the nonce from `StreamingContext` when one is provided.

Sources: [src/jsx/streaming.ts:30-138](repo://src/jsx/streaming.ts#L30-L138)

### renderToReadableStream

`renderToReadableStream(content, onError)` returns a `ReadableStream` of UTF-8 bytes. It sends the content with `BeforeStream` callbacks resolved as the first chunk, then runs the `Stream` callbacks and enqueues each result as it settles, including callbacks those results carry, until none remain. A rejected callback is passed to `onError`, `console.trace` by default, and contributes an empty string. Cancelling the stream stops further writes.

Sources: [src/jsx/streaming.ts:140-220](repo://src/jsx/streaming.ts#L140-L220)

```tsx
app.get('/', (c) =>
  c.body(
    renderToReadableStream(
      <Suspense fallback={<p>Loading...</p>}>
        <AsyncComponent />
      </Suspense>
    ),
    { headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Transfer-Encoding': 'chunked' } }
  )
)
```

Sources: [src/jsx/streaming.ts:146-149](repo://src/jsx/streaming.ts#L146-L149), [src/middleware/jsx-renderer/index.ts:66-76](repo://src/middleware/jsx-renderer/index.ts#L66-L76)

### ErrorBoundary

`<ErrorBoundary fallback={...}>` or `fallbackRender={(error) => ...}` catches errors thrown while rendering its children, synchronously or from their promises, and renders the fallback instead; `onError` is called with the error. Around async children it works like `Suspense`, with `E:n` markers and an inline script that replaces the content with the fallback when an error arrives during streaming.

Sources: [src/jsx/components.ts:47-127](repo://src/jsx/components.ts#L47-L127), [src/jsx/components.ts:128-164](repo://src/jsx/components.ts#L128-L164)

## The jsx-renderer middleware

`jsxRenderer(Layout, options)` from `hono/jsx-renderer` sets a renderer and a layout on the Context, so handlers call `c.render(<Content />, props)`. The renderer wraps the content in the layout component, which receives the props, a `Layout` for nesting renderers, and the Context, and prepends `<!DOCTYPE html>` unless `docType` is `false` or another string.

Sources: [src/middleware/jsx-renderer/index.ts:33-65](repo://src/middleware/jsx-renderer/index.ts#L33-L65), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

With `stream: true`, the renderer sets `Transfer-Encoding: chunked`, an HTML `Content-Type` and `Content-Encoding: Identity`, and returns `c.body(renderToReadableStream(body))`; an object for `stream` sets those headers instead. Otherwise it returns `c.html(body)`. Options may be a function of the Context.

Sources: [src/middleware/jsx-renderer/index.ts:66-80](repo://src/middleware/jsx-renderer/index.ts#L66-L80)

The whole tree is rendered inside `RequestContext.Provider`, so any component can call `useRequestContext()` to obtain the Hono Context, which throws outside a `jsxRenderer`.

Sources: [src/middleware/jsx-renderer/index.ts:15-16](repo://src/middleware/jsx-renderer/index.ts#L15-L16), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165)
