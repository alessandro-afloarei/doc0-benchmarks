---
title: "JSX Renderer Middleware and CSS Helper"
---
## Overview

Building full pages with JSX needs two things beyond rendering elements: a shared document layout around every page, and styles scoped to components. The `jsxRenderer` middleware (`hono/jsx-renderer`) provides the first by installing a renderer behind `c.render(content, props)` that wraps content in a layout, adds a doctype, and optionally streams. The CSS helper (`hono/css`) provides the second: `css` template literals produce hashed class names whose rules are collected while the page renders and written into one `<style>` element. Both build on the string renderer described in [[JSX Server Rendering]].

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/helper/css/index.ts:72-167](repo://src/helper/css/index.ts#L72-L167)

```tsx
import { jsxRenderer, useRequestContext } from 'hono/jsx-renderer'
import { css, Style } from 'hono/css'

app.use(
  jsxRenderer(({ children, title }) => (
    <html>
      <head>
        <Style />
        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  ))
)

const headingClass = css`
  color: tomato;
  font-size: 2rem;
`

app.get('/', (c) => c.render(<h1 class={headingClass}>Hello</h1>, { title: 'Home' }))
```

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/helper/css/index.ts:169-203](repo://src/helper/css/index.ts#L169-L203)

## jsxRenderer

### Installing a renderer

`jsxRenderer(component?, options?)` is a middleware that does its work before `next()`. It reads the current layout from `c.getLayout()` (a `Fragment` if none), registers `component` as the new layout through `c.setLayout`, and installs a renderer with `c.setRenderer`. Handlers then call `c.render(children, props)`, which `Context` routes to that renderer ([[Context and Responses]]).

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:448-497](repo://src/context.ts#L448-L497)

### What c.render produces

The renderer created by `createRenderer` works in five steps.

Sources: [src/middleware/jsx-renderer/index.ts:33-41](repo://src/middleware/jsx-renderer/index.ts#L33-L41)

1. Resolves `options` (an object, or a function of `c`, so a route can switch streaming per request).
2. Chooses the doctype: `<!DOCTYPE html>` by default, a custom string, or none with `docType: false`.
3. Calls `component({ ...props, Layout, children }, c)`. `Layout` is the layout that was active before this middleware, which is how nested renderers compose.
4. Wraps the result in the `RequestContext` provider with `c` as its value and prepends the doctype with the `html` helper.
5. Returns `c.html(body)`, or with `stream` enabled returns `c.body(renderToReadableStream(body))` with streaming headers (`Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8`, `Content-Encoding: Identity`), or with a custom header map when `stream` is an object.

Sources: [src/middleware/jsx-renderer/index.ts:33-80](repo://src/middleware/jsx-renderer/index.ts#L33-L80)

`Content-Encoding: Identity` is set in streaming mode so that intermediaries such as Cloudflare do not buffer the response to compress it, which would delay `Suspense` content ([[JSX Server Rendering]]).

Sources: [src/middleware/jsx-renderer/index.ts:66-71](repo://src/middleware/jsx-renderer/index.ts#L66-L71)

### Nested layouts

Registering `jsxRenderer` at `*` and again at `/admin/*` gives admin pages both layouts: the inner component receives the outer one as `Layout` and can render `<Layout>{children}</Layout>` to nest inside it. Without that, the inner renderer replaces the outer.

Sources: [src/middleware/jsx-renderer/index.ts:120-127](repo://src/middleware/jsx-renderer/index.ts#L120-L127)

### Typing props

The `props` argument of `c.render` is typed by `ContextRenderer`, an interface applications augment so `c.render(<Page />, { title })` checks `title`.

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85)

```ts
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response | Promise<Response>
  }
}
```

Sources: [src/context.ts:62-78](repo://src/context.ts#L62-L78)

### useRequestContext

Any component rendered through `c.render` can call `useRequestContext()` to get the `Context`, for example to read `c.req.query()` deep in the tree. It reads the `RequestContext` JSX context and throws `RequestContext is not provided.` outside a `jsxRenderer` render.

Sources: [src/middleware/jsx-renderer/index.ts:15-16](repo://src/middleware/jsx-renderer/index.ts#L15-L16), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165)

## CSS helper

### Class names from styles

`` css`...` `` builds a style string from the template (interpolating other `css` results, `keyframes`, strings and numbers, nested selectors), then hashes the label and style string with a small multiplicative hash into a class name such as `css-1234567890`. The same styles always give the same class, on the server and in the browser, so hydrated markup matches. A `classNameSlug(hash, label, style)` option to `createCssContext` can choose readable names; names that are not valid CSS identifiers are rejected through `onInvalidSlug`.

Sources: [src/helper/css/common.ts:43-60](repo://src/helper/css/common.ts#L43-L60), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238)

### Collecting rules during rendering

`css` returns a promise of an escaped class-name string carrying a render callback. When the class name is rendered, `addClassNameToContext` records its rules for this render, keyed by the render context, unless they were already emitted. A second callback, `appendStyle`, then places them.

Sources: [src/helper/css/index.ts:89-92](repo://src/helper/css/index.ts#L89-L92)

- When the whole document is in the buffer (`c.html`), it inserts the rules into the existing `<style id="hono-css">` element rendered by `<Style />`.
- When streaming and the style element was already sent, it emits a small `<script>` that appends the rules to that element's `textContent`, with the nonce given to `<Style nonce>`.

Sources: [src/helper/css/index.ts:83-167](repo://src/helper/css/index.ts#L83-L167)

Each rule set is emitted once per response, no matter how many elements use the class, and only for classes that were actually rendered.

Sources: [src/helper/css/index.ts:124-147](repo://src/helper/css/index.ts#L124-L147)

### Other exports

| Export | Purpose |
| --- | --- |
| `cx(...classes)` | Combines `css` results and plain class names; falsy values are dropped and external names are escaped |
| `keyframes` | Defines `@keyframes` with a hashed name usable in `animation` |
| `viewTransition` | Generates a `view-transition-name` class for the View Transitions API |
| `Style` | Renders `<style id="hono-css">`, optionally with a nonce and global styles as children |
| `createCssContext({ id })` | Independent set of the above with its own style element id |
| `rawCssString` | Marks a string as safe to embed without CSS escaping |

Sources: [src/helper/css/index.ts:169-262](repo://src/helper/css/index.ts#L169-L262), [src/helper/css/common.ts:32-41](repo://src/helper/css/common.ts#L32-L41)

A `css` block that starts with `:-hono-global` defines global rules instead of a class, which is how page-wide resets are written.

Sources: [src/helper/css/common.ts:2-4](repo://src/helper/css/common.ts#L2-L4), [src/helper/css/common.ts:208-211](repo://src/helper/css/common.ts#L208-L211)

### In the browser

The same functions work with `hono/jsx/dom`: `createCssJsxDomObjects` gives each class name a `toString` and the `Style` component a DOM renderer that insert rules into the document's style element at run time ([[Client-Side JSX and Hooks]]).

Sources: [src/helper/css/index.ts:81-81](repo://src/helper/css/index.ts#L81-L81), [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206), [src/jsx/dom/css.ts:77-120](repo://src/jsx/dom/css.ts#L77-L120)
