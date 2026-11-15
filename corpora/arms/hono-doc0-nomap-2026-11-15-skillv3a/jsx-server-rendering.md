---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` renders JSX to HTML strings without React. A JSX expression becomes a `JSXNode`, and calling `toString()` on it writes escaped HTML into a string buffer, calling function components along the way. Async components, `Suspense` and `ErrorBoundary` make the result a promise or a stream, and a small callback protocol lets a part of the page finish later. Handlers return the result with `c.html()` (see [[Context]]) or through the `jsxRenderer` middleware. The browser-side renderer that shares the same components and hooks is described in [[JSX DOM Runtime and Hooks]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

```tsx
/** @jsxImportSource hono/jsx */
const Layout = (props: { children?: any }) => (
  <html>
    <body>{props.children}</body>
  </html>
)

app.get('/', (c) => c.html(<Layout><h1>Hello</h1></Layout>))
```

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351)

## Escaped strings

All rendering output is an `HtmlEscapedString`: a `String` object with `isEscaped: true` and an optional list of `callbacks`. `raw(value, callbacks)` creates one without escaping, which is how trusted HTML is inserted. Anything without the flag is escaped by `escapeToBuffer`, which replaces `&`, `<`, `>`, `"` and `'` and appends to the first slot of a buffer; strings with nothing to escape are appended in one step.

Sources: [src/utils/html.ts:17-46](repo://src/utils/html.ts#L17-L46), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

The `html` tagged template from `hono/html` uses the same rules: interpolated strings are escaped, numbers are appended, `null`, `undefined` and booleans vanish, arrays are flattened, escaped strings and JSX are inserted as is, and promises are kept for later. It is the way to write a document shell without JSX, and `jsxRenderer` uses it to prepend the doctype.

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

## From JSX to a string

### Creating nodes

`jsx(tag, props, ...children)` (also exported as `createElement`) moves `key` out of the props, puts children into `props.children` and calls `jsxFn`. Function tags become a `JSXFunctionNode`; a few intrinsic tags with special behaviour (such as `title`, `link`, `script`, `form`) are routed to built-in components; `svg` and `head` wrap their children in a namespace context so nested attribute names are rendered correctly; any other string tag becomes a plain `JSXNode`. Invalid tag names throw.

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351), [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154)

The automatic runtime (`jsxImportSource: "hono/jsx"`) re-exports `jsxDEV` as `jsx` and `jsxs`. For Deno's precompiled JSX it also exports `jsxTemplate` (the `html` helper), `jsxAttr`, which serializes one attribute with the same escaping and style-object rules, and `jsxEscape`.

Sources: [src/jsx/jsx-runtime.ts:6-51](repo://src/jsx/jsx-runtime.ts#L6-L51)

### Rendering a node

`JSXNode.toString()` creates a buffer `['']`, calls `toStringToBuffer`, and finishes within a render context (see below). `toStringToBuffer` writes `<tag`, then each attribute:

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177)

| Prop value | Output |
| --- | --- |
| `style` object | `style="a:b;c:d"`, with camelCase converted and `null` values skipped |
| string | Escaped value |
| number or escaped string | Value as is |
| `true`/`false` on a boolean attribute (`checked`, `disabled`, ...) | `key=""` or nothing |
| `dangerouslySetInnerHTML` | Replaces children with `raw(__html)`; throws if children were also given |
| promise | Placeholder resolved later |
| function | Ignored for `on*` and `ref` (client handlers); any other function prop throws |
| `null`, `undefined`, invalid names, `children` | Skipped |

Sources: [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239)

Void elements (`br`, `img`, `input`, ...) without children close with `/>`. Otherwise the children are written by `childrenToStringToBuffer`, which escapes strings, skips booleans and nullish values, recurses into nodes and arrays, and for a promise inserts it at the front of the buffer with `buffer.unshift('', promise)`.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

`JSXFunctionNode.toStringToBuffer` calls the component with its props. A node result is rendered in place, an escaped string is appended with its callbacks, a plain string is escaped, and a promise (an async component) is placed in the buffer like an async child.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

### Sync or async

When the buffer still has one slot, nothing was async and `toString()` returns a string synchronously. Otherwise `stringBufferToString` awaits every promise in the buffer, walks it from the end, escapes resolved values that are not already escaped, collects their callbacks, and returns a promise of the whole string. `c.html` accepts either.

Sources: [src/jsx/base.ts:166-176](repo://src/jsx/base.ts#L166-L176), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

## Context during rendering

`createContext(default)` returns a component that is also its own `Provider`; `useContext` reads the innermost provided value. A provider pushes its value on a per-render stack, renders its children, and pops the value when the (possibly async) render settles. Each `toString()` starts a render with its own store through `runWithRenderContext`, so concurrent requests do not see each other's values.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261), [src/jsx/context.ts:161-189](repo://src/jsx/context.ts#L161-L189)

The store follows async components across `await` by using `AsyncLocalStorage` when the runtime has it (Node.js 20.16 and later, Deno, Bun, Workers with `nodejs_compat`), found through `process.getBuiltinModule` so bundlers do not pull it in. Without it, values read after an `await` fall back to the default, and Hono logs a one-time warning. Suspended subtrees capture the current values with `captureRenderContext` and resume with them.

Sources: [src/jsx/context.ts:34-80](repo://src/jsx/context.ts#L34-L80), [src/jsx/context.ts:196-200](repo://src/jsx/context.ts#L196-L200)

## Callbacks, Suspense and streaming

### The callback phases

An escaped string's `callbacks` run in one of three phases: `Stringify` when the whole page is rendered to a string, `BeforeStream` just before the first chunk of a stream, and `Stream` for content sent later. `resolveCallback` runs the callbacks for a phase, lets each return more HTML (which may carry its own callbacks), and returns the final string. `c.html` resolves in the `Stringify` phase; the [[CSS Helper]] uses the same hooks to inject its styles.

Sources: [src/utils/html.ts:6-16](repo://src/utils/html.ts#L6-L16), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

### Suspense

`Suspense` renders its children. If any child is still a promise (an async component, or a `use()` call that threw a promise), it returns the fallback preceded by an empty `<template id="H:n">` marker and followed by a closing `/$` comment node, and attaches a callback. In the `Stringify` phase the callback waits for the children and replaces the placeholder in the buffer, so `c.html` sends the finished page. In the `Stream` phase it returns the content in a `<template data-hono-target="H:n">` followed by an inline script that swaps it in for the fallback, using the CSP nonce from `StreamingContext` when one is provided.

Sources: [src/jsx/streaming.ts:42-137](repo://src/jsx/streaming.ts#L42-L137)

### renderToReadableStream

`renderToReadableStream(content, onError)` returns a `ReadableStream` of bytes. It resolves the `BeforeStream` callbacks and enqueues the first chunk (the page with fallbacks), then runs every `Stream` callback, enqueueing each resolved piece and any further callbacks it produces until all have settled. A rejected piece is logged, passed to `onError` and replaced by an empty string; cancelling the stream stops further enqueues.

Sources: [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

```tsx
app.get('/', (c) =>
  c.body(
    renderToReadableStream(
      <Suspense fallback={<p>Loading...</p>}>
        <SlowList />
      </Suspense>
    ),
    { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }
  )
)
```

Sources: [src/jsx/streaming.ts:146-149](repo://src/jsx/streaming.ts#L146-L149)

### ErrorBoundary

`ErrorBoundary` renders its children and, if they throw or reject, renders `fallback` or `fallbackRender(error)` instead and calls `onError`. When the failure happens in a streamed part, it uses the same template-and-script mechanism as `Suspense` to replace the content.

Sources: [src/jsx/components.ts:47-85](repo://src/jsx/components.ts#L47-L85)

## The jsxRenderer middleware

`jsxRenderer(Component, options)` from `hono/jsx-renderer` installs a renderer on the context so handlers call `c.render(<Page />, props)`. The renderer wraps the content in the component (which receives `children`, the props and a `Layout` for the outer layout), puts it in a `RequestContext` provider, prefixes the doctype with `html`, and returns `c.html(body)`, or `c.body(renderToReadableStream(body))` when streaming.

Sources: [src/middleware/jsx-renderer/index.ts:33-80](repo://src/middleware/jsx-renderer/index.ts#L33-L80), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

| Option | Default | Effect |
| --- | --- | --- |
| `docType` | `true` | `true` adds `<!DOCTYPE html>`, `false` adds nothing, a string is used as is |
| `stream` | `false` | `true` streams with `Transfer-Encoding: chunked`, `Content-Type: text/html` and `Content-Encoding: Identity`; an object streams with those headers instead |

Sources: [src/middleware/jsx-renderer/index.ts:18-21](repo://src/middleware/jsx-renderer/index.ts#L18-L21), [src/middleware/jsx-renderer/index.ts:41-79](repo://src/middleware/jsx-renderer/index.ts#L41-L79)

Options may be a function of `c`. Registering `jsxRenderer` on nested paths composes layouts: the inner middleware reads the outer layout with `c.getLayout()` and passes it as `Layout`. Components anywhere in the tree can read the request's `Context` with `useRequestContext()`, which throws outside a renderer.

Sources: [src/middleware/jsx-renderer/index.ts:116-165](repo://src/middleware/jsx-renderer/index.ts#L116-L165)
