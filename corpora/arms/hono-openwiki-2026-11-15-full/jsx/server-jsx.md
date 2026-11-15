---
type: subsystem
title: Server-side JSX
description: How hono/jsx renders JSX to escaped HTML strings on the server — JSXNode stringification, escaping rules, async components and the string-buffer/callback protocol, context isolation via AsyncLocalStorage, Suspense streaming with renderToReadableStream, ErrorBoundary, the jsx-renderer middleware, the html tagged template and the css helper.
tags: [jsx, ssr, streaming, html, css, templating]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
sources:
  - id: openwiki-source-cd0b8b53b9de5fc07f3cc003
    resource: repo://src/helper/css/index.ts
  - id: openwiki-source-26c093c128a05fdff4678a9d
    resource: repo://src/helper/html/index.ts
  - id: openwiki-source-91405d824d54438c9afb6c95
    resource: repo://src/jsx/base.ts
  - id: openwiki-source-d860c877f7de8b98af4550ac
    resource: repo://src/jsx/components.ts
  - id: openwiki-source-ea535afbc8224bd998af25d6
    resource: repo://src/jsx/context.ts
  - id: openwiki-source-f799226869d755116de1137c
    resource: repo://src/jsx/streaming.ts
  - id: openwiki-source-447039b5e954ca86640d9d31
    resource: repo://src/middleware/jsx-renderer/index.ts
  - id: openwiki-source-c6b730a33294e46231354d6d
    resource: repo://src/utils/html.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Server-side JSX

`hono/jsx` (`src/jsx/`) is a JSX runtime that renders to HTML strings without a virtual DOM. It can be used with the automatic runtime (`"jsxImportSource": "hono/jsx"`) or classic `jsx()` calls, and returned from handlers with `c.html(<Page />)` (see [Context](../architecture/context-and-request.md#building-responses)). The browser-side renderer that shares the same components and hooks is described in [Client JSX](client-dom.md).

## JSXNode and stringification

`jsx(tag, props, ...children)` creates a `JSXNode` (`src/jsx/base.ts`): a `JSXFunctionNode` for components, `JSXFragmentNode` for fragments, and the base class for intrinsic elements. Tag names are validated; invalid ones throw `Invalid JSX tag name`. Nodes implement `HtmlEscaped` (`isEscaped: true`), so the output of one JSX tree can be embedded in another without double-escaping.

`node.toString()` renders into a **string buffer** (`StringBufferWithCallbacks`, `src/utils/html.ts`): index 0 is the string being appended, and promises from async content are `unshift`ed in front. If the buffer stays at a single string, `toString()` returns synchronously; otherwise it returns a `Promise<string>` built by `stringBufferToString`. This is why `c.html()` may return a promise.

### Attribute and child rules (intrinsic elements)

- String values and style objects are HTML-escaped (`&`, `<`, `>`, `'`, `"`); `style={{ ... }}` objects are converted to `prop:value;...` with camelCase normalized.
- `null`/`undefined` attributes are omitted; numbers and already-escaped values are emitted raw.
- Boolean attributes in the `booleanAttributes` list (e.g. `checked`, `disabled`) render as `attr=""` when true and are omitted when false.
- Function props are allowed only for `on*` handlers and `ref` (ignored on the server); any other function prop throws.
- Promise attribute values are awaited in place.
- `dangerouslySetInnerHTML={{ __html }}` inserts raw HTML and cannot be combined with children.
- Void elements (`br`, `img`, `input`, ...) self-close when they have no children.
- SVG attribute names are converted from camelCase to their kebab/colon forms inside `<svg>`.

### Function components

A component is called with `props` (children merged in). Return values: `null`/`undefined`/booleans render nothing; a `JSXNode` renders recursively; an escaped string is inserted raw (its callbacks are carried along); other values are escaped. Returning a `Promise` makes the component **async**: the promise is placed into the buffer and awaited when the tree is stringified.

## Escaped callbacks protocol

`HtmlEscapedString` values can carry `callbacks` invoked in phases (`HtmlEscapedCallbackPhase.Stringify`, `BeforeStream`, `Stream`). `resolveCallback` runs them against a shared `buffer` and a per-render `context` object (used as a `WeakMap` key). Suspense, ErrorBoundary and the css helper all use this mechanism to patch the final output or emit extra chunks once deferred content is ready.

## Context and request isolation

`createContext(default)` / `useContext(ctx)` (`src/jsx/context.ts`) keep a value stack per context. To keep concurrent requests from seeing each other's context values across `await`, rendering runs inside `runWithRenderContext`, which uses `AsyncLocalStorage` when it can be obtained via `process.getBuiltinModule('node:async_hooks')` (Node ≥ 20.16, Deno, Bun, Workers with nodejs_compat) or `process.mainModule.require` (older Node CJS). Otherwise a module-level fallback store is used, which only isolates synchronous rendering and warns once if a context is read after an `await`. Async components resume with captured context values via `captureRenderContext()`.

## Suspense and streaming

`Suspense` (`src/jsx/streaming.ts`) renders its children; if any are pending (async components, or `use()` throwing a promise), it emits:

```html
<template id="H:n"></template>{fallback}<!--/$-->
```

and registers a callback. When the output is fully stringified (non-streaming), the callback replaces the placeholder in the buffer with the resolved content. When streamed, the callback emits a later chunk containing `<template data-hono-target="H:n">content</template>` plus an inline script that swaps it in place of the fallback. The script gets a `nonce` from `StreamingContext` if provided (for CSP).

`renderToReadableStream(content, onError = console.trace)` resolves the initial HTML (`BeforeStream` phase), enqueues it, then follows `Stream`-phase callbacks recursively, enqueuing each resolved chunk until all are done. Errors in deferred chunks go to `onError` and produce an empty chunk; cancellation stops enqueueing.

## ErrorBoundary

`ErrorBoundary({ fallback, fallbackRender, onError })` (`src/jsx/components.ts`) catches synchronous and asynchronous errors thrown by children and renders `fallback` or `fallbackRender(error)`, calling `onError`. It cooperates with Suspense, including in streaming mode, where an error in a deferred subtree replaces that subtree's content with the fallback.

## jsx-renderer middleware

`jsxRenderer(Layout?, { docType, stream })` (`src/middleware/jsx-renderer/index.ts`) sets `c.setRenderer(...)` so handlers can call `c.render(<Content />, props)`:

- The content is wrapped in the layout component (which receives `Layout` – the parent layout – enabling nested renderers on sub-routes) and in `RequestContext.Provider` so components can call `useRequestContext()` to access `c`.
- `docType` defaults to `<!DOCTYPE html>`; a string overrides it, `false` disables it.
- `stream: true` sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8` and `Content-Encoding: Identity`, and returns `c.body(renderToReadableStream(body))`; an object sets custom headers instead. Otherwise `c.html(body)`.
- Options can be a function of `c`.

Typing of `c.render()` props is done by augmenting `ContextRenderer` in user code.

## html tagged template

`html\`...\`` (`src/helper/html/index.ts`, `hono/html`) builds an `HtmlEscapedString`: interpolated strings are escaped, numbers inserted, `null`/`undefined`/booleans skipped, arrays flattened, already-escaped values (JSX nodes, `raw()`) inserted as-is, and promises deferred, returning a `Promise` when needed. `raw(str)` marks a string as trusted HTML — never pass user input to it.

## css helper

`hono/css` exports `css`, `cx`, `keyframes`, `viewTransition`, `Style` and `createCssContext`:

- `css\`...\`` produces a class name derived from a hash of the style (custom slugs via `classNameSlug`, validated by `onInvalidSlug`). Nesting, `:-hono-global` selectors and composing other `css` results are supported.
- Each class name carries a callback that, during rendering, collects the styles used in that render context. They are inserted into the `<style id="hono-css">` element emitted by `<Style />`; if that element was already flushed (streaming), a small script appends the styles to it. `nonce` on `<Style>` is reused for those scripts.
- External class names given to `cx()` are HTML-escaped before output.
- `hono/jsx/dom/css` provides the same API for the client renderer.

## Tests

- `src/jsx/index.test.tsx`, `src/jsx/base.test.tsx` – escaping, attributes, components, fragments, `memo`, `cloneElement`.
- `src/jsx/streaming.test.tsx` – Suspense in string and stream mode, nonces, nested Suspense, errors.
- `src/jsx/components.test.tsx` – ErrorBoundary.
- `src/jsx/context-isolation.test.ts` – concurrent render context isolation.
- `src/middleware/jsx-renderer/index.test.tsx`, `src/helper/html/index.test.ts`, `src/helper/css/*.test.tsx`.
- `runtime-tests/deno-jsx` checks the precompile and react-jsx modes under Deno.
