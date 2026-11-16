---
title: "HTML and JSX Rendering"
---
## Overview

Server rendering builds escaped HTML content and sends it through the context's HTML or body response helpers. Hono provides an `html` template tag, a JSX implementation, renderer middleware for layouts, and callback-driven streaming for suspended content. [[Request and Context]] explains the response interface; this page owns the content-producing side. [[JSX DOM]] covers browser updates, which have a separate rendering entry point and lifecycle.

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57), [src/jsx/base.ts:140-176](repo://src/jsx/base.ts#L140-L176), [src/middleware/jsx-renderer/index.ts:33-80](repo://src/middleware/jsx-renderer/index.ts#L33-L80), [src/jsx/dom/client.ts:23-65](repo://src/jsx/dom/client.ts#L23-L65)

## Escape template values

The `html` tag joins literal template segments and interpolated values into an escaped string or a promise of one. It flattens array values, escapes ordinary strings, writes numbers, omits booleans and nullish values, and preserves already-escaped values. Promises enter the string buffer for later resolution. Objects without the escaped marker are stringified and escaped. This preserves markup from explicitly marked content while treating ordinary interpolations as text.

Sources: [src/helper/html/index.ts:11-57](repo://src/helper/html/index.ts#L11-L57)

`raw` marks a value as already escaped and can attach rendering callbacks. It performs no escaping itself. Buffer resolution checks that marker before appending a value; otherwise it sends the value through `escapeToBuffer`. The escape routine targets ampersands, angle brackets, and quote characters. Only use the raw marker when the application intends the value to be markup, because it is the switch by which this rendering pipeline bypasses text escaping.

Sources: [src/utils/html.ts:40-51](repo://src/utils/html.ts#L40-L51), [src/utils/html.ts:53-90](repo://src/utils/html.ts#L53-L90)

## Render intrinsic and function components

JSX nodes carry a tag, props, children, and the escaped marker. Their string conversion creates a buffer inside a render context and can return either a string or promise. String children are escaped; numbers and marked strings are appended; nullish and boolean children disappear; nested nodes render recursively. Function nodes call the component with props and children, handle empty results, and defer promises. The rendering path can therefore represent both synchronous components and asynchronous component output.

Sources: [src/jsx/base.ts:108-176](repo://src/jsx/base.ts#L108-L176), [src/jsx/base.ts:254-285](repo://src/jsx/base.ts#L254-L285)

Intrinsic rendering validates tag and attribute names, normalizes attribute keys, converts style objects to escaped style text, and handles boolean and empty elements. `dangerouslySetInnerHTML` supplies marked raw content and rejects simultaneous children. Function props used for events or refs are ignored in server output, while other function props throw. An event callback in server JSX is consequently not a serialized browser event binding; [[JSX DOM]] explains where event behavior is installed.

Sources: [src/jsx/base.ts:147-150](repo://src/jsx/base.ts#L147-L150), [src/jsx/base.ts:179-250](repo://src/jsx/base.ts#L179-L250)

## Install a request renderer

`jsxRenderer` is middleware that captures the current layout or Fragment, optionally installs a new layout, installs a renderer, and continues. The renderer receives children and rendering props, combines them with the layout component and request context, and prefixes the doctype. The default doctype is HTML; options can disable it or replace its text. Endpoint handlers call `c.render`, so route handlers can supply content while middleware supplies the shared document structure.

Sources: [src/middleware/jsx-renderer/index.ts:33-64](repo://src/middleware/jsx-renderer/index.ts#L33-L64), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:448-472](repo://src/context.ts#L448-L472)

The source example installs a renderer for `/page/*` and then renders an about page. The layout's children occupy the content area, while the surrounding header and document tags are supplied by middleware. Register that middleware before the endpoint so it can replace the renderer before the endpoint invokes it, following the ordering rules in [[Middleware and Errors]].

Sources: [src/middleware/jsx-renderer/index.ts:95-113](repo://src/middleware/jsx-renderer/index.ts#L95-L113), [src/compose.ts:42-51](repo://src/compose.ts#L42-L51)

```tsx
app.get('/page/about', (c) => {
  return c.render(<h1>About me!</h1>)
})
```

Sources: [src/middleware/jsx-renderer/index.ts:111-113](repo://src/middleware/jsx-renderer/index.ts#L111-L113)

The installed renderer wraps output in `RequestContext.Provider`. `useRequestContext` reads it and throws `RequestContext is not provided.` when missing. This lets a component access the current Hono context, including URL and request-local variables, without receiving it through every prop. It depends on rendering under that provider; ordinary `c.html` does not install the renderer's provider by itself.

Sources: [src/middleware/jsx-renderer/index.ts:15-16](repo://src/middleware/jsx-renderer/index.ts#L15-L16), [src/middleware/jsx-renderer/index.ts:60-64](repo://src/middleware/jsx-renderer/index.ts#L60-L64), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

## Preserve context through asynchronous rendering

JSX context uses a per-render WeakMap store. Providers push their value while rendering children and remove it on success or failure. AsyncLocalStorage is discovered through runtime property probes, avoiding a static node module import; when available it propagates the store across awaits. A captured resumer restores provider values around deferred subtrees. This is separate from the request context storage middleware documented in [[Middleware and Errors]].

Sources: [src/jsx/context.ts:15-23](repo://src/jsx/context.ts#L15-L23), [src/jsx/context.ts:34-70](repo://src/jsx/context.ts#L34-L70), [src/jsx/context.ts:117-147](repo://src/jsx/context.ts#L117-L147), [src/jsx/context.ts:161-199](repo://src/jsx/context.ts#L161-L199), [src/jsx/context.ts:213-240](repo://src/jsx/context.ts#L213-L240)

Without AsyncLocalStorage, the fallback store exists during synchronous render work. Reading context after an await then falls back to the default value; the source explicitly avoids using another request's provided value. A one-time warning describes this degraded behavior. Synchronous components and suspension through `use` retain their supported behavior, as documented by the context implementation. Runtime choice therefore affects context continuity in async server components.

Sources: [src/jsx/context.ts:73-79](repo://src/jsx/context.ts#L73-L79), [src/jsx/context.ts:149-188](repo://src/jsx/context.ts#L149-L188), [src/jsx/context.ts:202-211](repo://src/jsx/context.ts#L202-L211)

## Stream suspended content

With renderer `stream: true`, the response gets chunked transfer, HTML content type, and Identity content encoding, then carries `renderToReadableStream(body)`. A record-valued stream option supplies custom headers instead. Without streaming the renderer delegates to `c.html`. [[Streaming Responses]] covers generic byte, text, and SSE producers; JSX streaming instead resolves the HTML callback phases attached to rendered content.

Sources: [src/middleware/jsx-renderer/index.ts:66-79](repo://src/middleware/jsx-renderer/index.ts#L66-L79), [src/jsx/streaming.ts:146-166](repo://src/jsx/streaming.ts#L146-L166)

Suspense renders fallback content when children are asynchronous, then produces deferred replacement markup and a script when they resolve. `StreamingContext` can supply a script nonce. The readable-stream producer emits initial resolved content, discovers further callbacks, and enqueues their results while not cancelled. Callback failures invoke the error callback, and the stream closes after pending work settles. Suspense and the stream renderer are marked experimental; ErrorBoundary likewise exposes fallback and error hooks for component rendering failures.

Sources: [src/jsx/streaming.ts:18-50](repo://src/jsx/streaming.ts#L18-L50), [src/jsx/streaming.ts:87-137](repo://src/jsx/streaming.ts#L87-L137), [src/jsx/streaming.ts:140-215](repo://src/jsx/streaming.ts#L140-L215), [src/jsx/components.ts:47-61](repo://src/jsx/components.ts#L47-L61)

## Collect component CSS

The CSS helper creates class-name values with rendering callbacks and tracks used styles by render context. `css` creates a class, `cx` combines inputs, `keyframes` creates animation definitions, and `Style` emits the style element with optional nonce. The callbacks append styles that have not yet been emitted, including a deferred script path for streamed additions. `createCssContext` customizes the style identifier and class-name generation; the default exports use the default context and are marked experimental.

Sources: [src/helper/css/index.ts:72-140](repo://src/helper/css/index.ts#L72-L140), [src/helper/css/index.ts:169-214](repo://src/helper/css/index.ts#L169-L214), [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262)
