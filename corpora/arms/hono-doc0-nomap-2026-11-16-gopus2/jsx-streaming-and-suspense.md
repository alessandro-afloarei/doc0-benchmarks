---
title: "JSX Streaming and Suspense"
---
## Overview

An async component makes a JSX render return a promise, as [[JSX Server Rendering]] shows. That is enough to await the whole page and send it at once. `Suspense`, `ErrorBoundary` and `renderToReadableStream` go further: the page is sent immediately with fallbacks where slow parts will go, and each slow part follows in the same response once it resolves, together with a small script that moves it into place. All three are marked experimental in their doc comments.

Sources: [src/jsx/streaming.ts:36-45](repo://src/jsx/streaming.ts#L36-L45), [src/jsx/streaming.ts:141-149](repo://src/jsx/streaming.ts#L141-L149), [src/jsx/components.ts:50-61](repo://src/jsx/components.ts#L50-L61)

```tsx
import { Suspense, renderToReadableStream } from 'hono/jsx/streaming'

const Slow = async () => {
  const data = await fetchData()
  return <p>{data}</p>
}

app.get('/', (c) => {
  const stream = renderToReadableStream(
    <html>
      <body>
        <Suspense fallback={<p>Loading...</p>}>
          <Slow />
        </Suspense>
      </body>
    </html>
  )
  return c.body(stream, {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'Transfer-Encoding': 'chunked' },
  })
})
```

Sources: [src/jsx/streaming.ts:42-137](repo://src/jsx/streaming.ts#L42-L137), [src/jsx/streaming.ts:146-220](repo://src/jsx/streaming.ts#L146-L220)

## Callbacks on escaped strings

### HtmlEscapedString

The mechanism behind all of this is the `HtmlEscapedString`: a `String` object marked `isEscaped` that can carry a list of `callbacks`. `raw(value, callbacks)` creates one. A callback receives the current phase, a one-element `buffer` holding the HTML produced so far (when the output is being built as one string), and a `context` object unique to the render, and it may return a promise of more HTML.

Sources: [src/utils/html.ts:6-46](repo://src/utils/html.ts#L6-L46)

### Phases

| Phase | When | Who runs it |
| --- | --- | --- |
| `Stringify` | The whole output becomes one string | `c.html`, `resolveCallbackSync` |
| `BeforeStream` | The first chunk of a stream is prepared | `renderToReadableStream` |
| `Stream` | Pieces are sent one by one | `renderToReadableStream` |

Sources: [src/utils/html.ts:6-16](repo://src/utils/html.ts#L6-L16), [src/context.ts:723-733](repo://src/context.ts#L723-L733), [src/utils/html.ts:129-140](repo://src/utils/html.ts#L129-L140)

`resolveCallback(str, phase, preserveCallbacks, context, buffer)` awaits the string, runs its callbacks with the buffer, recursively resolves whatever they return into the same buffer, and returns the buffer's final content. A callback can therefore rewrite HTML that was already produced: the document metadata hoisting and the `Suspense` replacement both work this way.

Sources: [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

## Suspense

### Rendering the children

`Suspense` is an async component with `children` and a `fallback`. It renders each child with `toString()`. A child may throw a promise, which is how the `use()` hook signals data that is not ready; `Suspense` catches it, captures the render context, and replaces the result with a promise that waits for the thrown one and renders the children again. Any other error is rethrown.

Sources: [src/jsx/streaming.ts:42-85](repo://src/jsx/streaming.ts#L42-L85), [src/jsx/components.ts:14-30](repo://src/jsx/components.ts#L14-L30)

If no child produced a promise, `Suspense` returns the joined HTML and behaves like a fragment.

Sources: [src/jsx/streaming.ts:134-136](repo://src/jsx/streaming.ts#L134-L136)

### Placeholder and replacement

Otherwise it takes the next number from a module counter and returns the fallback wrapped as `<template id="H:n"></template>` + fallback + `<!--/$-->`, with one callback attached. The callback ignores `BeforeStream` and, in the other phases, waits for all children:

Sources: [src/jsx/streaming.ts:87-133](repo://src/jsx/streaming.ts#L87-L133)

- With a buffer (the `Stringify` phase, everything sent at once), it replaces the template, the fallback and the end marker in the buffer with the content. The client never sees the fallback.
- Without a buffer (the `Stream` phase), it returns `<template data-hono-target="H:n">content</template>` followed by an inline script. The script finds the `H:n` template, removes the nodes after it up to the `/$` comment, and replaces the template with the new content.

Sources: [src/jsx/streaming.ts:87-133](repo://src/jsx/streaming.ts#L87-L133)

When the resolved children carry callbacks of their own, such as a nested `Suspense`, they are returned with the content so they resolve in turn, after resolving its `BeforeStream` phase first when streaming.

Sources: [src/jsx/streaming.ts:119-130](repo://src/jsx/streaming.ts#L119-L130)

### Script nonce

The inline scripts carry a `nonce` attribute when a `StreamingContext.Provider` supplies `scriptNonce`, so pages with a Content Security Policy can allow them. [[Security Middleware]] shows how `secureHeaders` generates nonces.

Sources: [src/jsx/streaming.ts:18-32](repo://src/jsx/streaming.ts#L18-L32), [src/jsx/streaming.ts:105-109](repo://src/jsx/streaming.ts#L105-L109)

## renderToReadableStream

`renderToReadableStream(content, onError)` returns a `ReadableStream` of UTF-8 bytes. In `start` it turns a `JSXNode` into its string or promise, resolves it in the `BeforeStream` phase, and enqueues the result as the first chunk: the page with every fallback in place.

Sources: [src/jsx/streaming.ts:146-167](repo://src/jsx/streaming.ts#L146-L167)

It then calls each callback of that result in the `Stream` phase. Every returned promise is tracked: when it resolves, its HTML is resolved in turn, its own callbacks are started the same way, and the chunk is enqueued. The loop waits until the number of resolved promises equals the number started, so nested suspended parts are not cut off. A rejected piece is logged, passed to `onError` (by default `console.trace`), and replaced with an empty string.

Sources: [src/jsx/streaming.ts:169-205](repo://src/jsx/streaming.ts#L169-L205)

If the stream is cancelled, for example because the client disconnected, a flag stops further enqueues, and the stream is closed once all work settles.

Sources: [src/jsx/streaming.ts:150-150](repo://src/jsx/streaming.ts#L150-L150), [src/jsx/streaming.ts:206-219](repo://src/jsx/streaming.ts#L206-L219)

The `jsxRenderer` middleware uses this function when its `stream` option is set, as described in [[JSX Server Rendering]].

Sources: [src/middleware/jsx-renderer/index.ts:66-76](repo://src/middleware/jsx-renderer/index.ts#L66-L76)

## ErrorBoundary

### Synchronous errors

`ErrorBoundary` catches errors thrown by its children and renders a fallback. It takes `fallback` (an element), `fallbackRender(error)` (a function), and `onError(error)`, called when the fallback is used. Children are rendered early with `resolveChildEarly`. A synchronous error renders the fallback in place; a thrown promise waits and retries the render, rendering the fallback if that fails.

Sources: [src/jsx/components.ts:32-126](repo://src/jsx/components.ts#L32-L126)

### Async errors

When some children are still pending, it emits `<template id="E:n"></template><!--E:n-->` and a callback. If the pending children reject, `catchCallback` renders the fallback once: in a buffer it replaces the marked region, and in a stream it sends a template and a script that remove everything between the markers and insert the fallback. If they succeed, the content is placed between the markers, and nested callbacks are wrapped so that a later failure still reaches the boundary and the markers are removed after the last one resolves.

Sources: [src/jsx/components.ts:128-164](repo://src/jsx/components.ts#L128-L164), [src/jsx/components.ts:165-257](repo://src/jsx/components.ts#L165-L257)

The same component works in the browser: both `Suspense` and `ErrorBoundary` set a `DOM_RENDERER` to their client implementations, which the [[JSX DOM Runtime]] uses instead.

Sources: [src/jsx/components.ts:262-262](repo://src/jsx/components.ts#L262-L262), [src/jsx/streaming.ts:138-138](repo://src/jsx/streaming.ts#L138-L138)
