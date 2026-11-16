---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX implementation that renders to HTML strings on the server without React. Components are plain functions, may be `async`, and their output is escaped by default. The same element tree can also be streamed with `Suspense`, and `hono/jsx/dom` reuses the API to render in the browser ([[Client-Side JSX and Hooks]]). The `html` tagged template helper (`hono/html`) shares the escaping machinery, so JSX and templates can be mixed freely.

Sources: [src/jsx/base.ts:140-252](repo://src/jsx/base.ts#L140-L252), [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

```tsx
/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx'

const Layout: FC = ({ children }) => (
  <html>
    <body>{children}</body>
  </html>
)

const Posts = async () => {
  const posts = await fetchPosts()
  return <ul>{posts.map((p) => <li>{p.title}</li>)}</ul>
}

app.get('/', (c) => c.html(<Layout><Posts /></Layout>))
```

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

## From JSX to nodes

### Runtime entry points

With `jsxImportSource: "hono/jsx"`, TypeScript compiles JSX to calls to `jsx`/`jsxs` from `hono/jsx/jsx-runtime`, which forward to `jsxDEV`. It normalises `props.children` into an array and calls `jsxFn`. The classic `jsx(tag, props, ...children)` (exported as `createElement`) does the same for the pragma form. Deno's precompile mode uses `jsxTemplate` (the `html` helper), `jsxAttr` and `jsxEscape` from the same module.

Sources: [src/jsx/jsx-dev-runtime.ts:1-26](repo://src/jsx/jsx-dev-runtime.ts#L1-L26), [src/jsx/jsx-runtime.ts:1-51](repo://src/jsx/jsx-runtime.ts#L1-L51), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

### Node classes

`jsxFn` chooses the node class.

Sources: [src/jsx/base.ts:318-320](repo://src/jsx/base.ts#L318-L320)

| Tag | Node |
| --- | --- |
| A function component | `JSXFunctionNode`, which calls the function at render time |
| `title`, `meta`, `link`, `script`, `style` and other special intrinsics | `JSXFunctionNode` wrapping the built-in component that implements document-metadata behaviour |
| `svg` or `head` | `JSXNode` whose children are wrapped in a namespace context provider, so attribute names are converted (`strokeWidth` to `stroke-width`) |
| Any other string | `JSXNode` |

Sources: [src/jsx/base.ts:319-351](repo://src/jsx/base.ts#L319-L351), [src/jsx/intrinsic-element/components.ts:121-179](repo://src/jsx/intrinsic-element/components.ts#L121-L179)

Tag names are validated when the node is created, and an invalid one throws, so a tag built from user input cannot inject markup.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154)

## Rendering to a string

### The string buffer

`JSXNode.toString()` renders into a `StringBuffer`, an array whose element `0` is the string being appended to. When rendering meets a promise (an async component, or a promise child), it calls `buffer.unshift('', promise)`, moving the text so far down the array and starting a new segment. When the walk ends, a one-element buffer is the complete HTML and is returned synchronously; otherwise `stringBufferToString` awaits all promises and concatenates the segments in order. Synchronous trees therefore never allocate promises.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:37-88](repo://src/utils/html.ts#L37-L88)

### Elements and attributes

`toStringToBuffer` writes the opening tag and each prop.

Sources: [src/jsx/base.ts:184-190](repo://src/jsx/base.ts#L184-L190)

- `children` is skipped and `key` was removed earlier; names failing `isValidAttributeName` are dropped.
- Strings are escaped; numbers and already-escaped values are written as is; `null` and `undefined` omit the attribute.
- A `style` object becomes a CSS string with kebab-case properties.
- Boolean attributes from a fixed list (`checked`, `disabled`, ...) are written as `name=""` when true and omitted when false.
- `dangerouslySetInnerHTML={{ __html }}` replaces children with raw HTML and throws if children were also given.
- Function props are ignored when they are event handlers (`on*`) or `ref`, so components shared with the client render on the server; any other function throws.

Sources: [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239)

Void elements (`br`, `img`, `input`, ...) are written as `<tag/>` when they have no children.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

### Children and escaping

Strings are escaped with `escapeToBuffer`, which replaces `&`, `<`, `>`, `"` and `'` and skips work entirely when none is present. Booleans, `null` and `undefined` render nothing, arrays are flattened, and values with `isEscaped` set are trusted. `raw(str)` from `hono/html` creates such a trusted value: a `String` object with `isEscaped = true`.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/utils/html.ts:40-46](repo://src/utils/html.ts#L40-L46), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

### Function components

`JSXFunctionNode` calls the component with its props (children merged in) and handles the result: `null`, `undefined` and booleans render nothing, a node renders into the same buffer, an escaped string is appended along with its callbacks, and a promise is pushed into the buffer. When contexts are in use, the promise's result is tagged with the captured render context so that `useContext` inside the resolved subtree still sees the right providers.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

## The html helper

`html` is a tagged template that follows the same rules: interpolated strings are escaped, numbers written, `null`/`undefined`/booleans skipped, arrays flattened, escaped values (including JSX nodes) trusted, and promises deferred into the buffer. It returns an `HtmlEscapedString`, or a promise of one when something was async, so it can be passed straight to `c.html` ([[Context and Responses]]).

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

## Context

`createContext(default)` returns a provider component that pushes its `value` onto the context's stack while rendering its children and pops it afterwards, including after async children resolve. `useContext(ctx)` reads the top of that stack for the current render.

Sources: [src/jsx/context.ts:213-261](repo://src/jsx/context.ts#L213-L261)

Stacks are kept per render in a store found through `AsyncLocalStorage` when the runtime has one (probed via `process.getBuiltinModule('node:async_hooks')` so bundlers do not pull it in), which keeps concurrent requests from seeing each other's values across `await`. Without it, a module-level fallback store is used, and a context read after an `await` may degrade to the default value, which triggers a one-time warning.

Sources: [src/jsx/context.ts:13-60](repo://src/jsx/context.ts#L13-L60), [src/jsx/context.ts:161-194](repo://src/jsx/context.ts#L161-L194)

## Streaming with Suspense

### Suspense placeholders

`Suspense` renders its children; if any part is still a promise, it returns the `fallback` preceded by an empty `<template id="H:n">` marker and followed by a closing `/$` HTML comment, plus a callback. `renderToReadableStream(content, onError?)` (`hono/jsx/streaming`) sends the HTML with fallbacks first, then, as each callback's promise resolves, sends a `<template data-hono-target="H:n">` holding the real content and a small inline script that swaps it in place of the fallback. `StreamingContext` can provide a `scriptNonce` for those scripts so they pass a Content Security Policy ([[CORS, CSRF and Secure Headers]]).

Sources: [src/jsx/streaming.ts:30-137](repo://src/jsx/streaming.ts#L30-L137), [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

### Non-streaming resolution

When the same tree is rendered without streaming, for example by `c.html`, the callback receives the whole buffer and replaces the placeholder and fallback with the resolved content, so the output is the final HTML.

Sources: [src/jsx/streaming.ts:92-118](repo://src/jsx/streaming.ts#L92-L118), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

### Error boundaries

`ErrorBoundary` (marked experimental) catches errors thrown by its children, synchronously or in streamed async parts, and renders `fallback`, or `fallbackRender(error)`, calling `onError` if given. In streaming mode it uses the same template-and-script replacement as `Suspense`.

Sources: [src/jsx/components.ts:47-70](repo://src/jsx/components.ts#L47-L70)

The JSX renderer middleware wraps these pieces into `c.render` with layouts and an optional streaming mode ([[JSX Renderer Middleware and CSS Helper]]).

Sources: [src/jsx/index.ts:36-74](repo://src/jsx/index.ts#L36-L74)
