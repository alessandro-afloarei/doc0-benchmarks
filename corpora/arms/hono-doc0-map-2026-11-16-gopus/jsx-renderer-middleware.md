---
title: "JSX Renderer Middleware"
---
## Overview

Most pages of a site share a frame: the `<html>` element, the head, a header and a footer. `jsxRenderer` from `hono/jsx-renderer` lets that frame be declared once as middleware, so handlers only render their own content with `c.render(<Page />)`. It works through the renderer hook of the Context: the middleware installs a renderer with `c.setRenderer`, and `c.render` calls it ([[Context and Responses]]). It also puts the Context into a JSX context, so any component can reach the request with `useRequestContext()`.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:448-497](repo://src/context.ts#L448-L497)

```tsx
import { jsxRenderer } from 'hono/jsx-renderer'

app.get(
  '/page/*',
  jsxRenderer(({ children }) => (
    <html>
      <body>
        <header>Menu</header>
        <div>{children}</div>
      </body>
    </html>
  ))
)

app.get('/page/about', (c) => c.render(<h1>About me!</h1>))
```

Sources: [src/middleware/jsx-renderer/index.ts:93-115](repo://src/middleware/jsx-renderer/index.ts#L93-L115)

## What the middleware does

For each request, `jsxRenderer(component?, options?)`:

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:459-472](repo://src/context.ts#L459-L472)

1. Reads the current layout with `c.getLayout()`, falling back to `Fragment`. This is the layout set by an outer `jsxRenderer`, if any.
2. If a component was given, stores a new layout with `c.setLayout` that calls the component with the outer layout as its `Layout` prop.
3. Installs a renderer built by `createRenderer` with `c.setRenderer`, then calls `next()`.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:459-472](repo://src/context.ts#L459-L472)

Nothing is rendered until a handler calls `c.render(children, props?)`. The renderer then:

Sources: [src/middleware/jsx-renderer/index.ts:33-80](repo://src/middleware/jsx-renderer/index.ts#L33-L80)

1. Resolves `options`, which may be a function of the Context.
2. Wraps `children` in the component, passing `Layout` and the render props, so the component receives `{ children, Layout, ...props }` and the Context as its second argument.
3. Wraps that in `RequestContext.Provider` with the Context as value, and prefixes the doctype through the `html` template.
4. Returns `c.html(body)`, or a stream when `stream` is set.

Sources: [src/middleware/jsx-renderer/index.ts:33-80](repo://src/middleware/jsx-renderer/index.ts#L33-L80)

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `docType` | `true` | `true` writes `<!DOCTYPE html>`, `false` writes nothing, a string is written as is |
| `stream` | `false` | `true` streams with default headers; an object streams with those headers instead |

Sources: [src/middleware/jsx-renderer/index.ts:18-21](repo://src/middleware/jsx-renderer/index.ts#L18-L21), [src/middleware/jsx-renderer/index.ts:41-47](repo://src/middleware/jsx-renderer/index.ts#L41-L47), [src/middleware/jsx-renderer/index.ts:87-91](repo://src/middleware/jsx-renderer/index.ts#L87-L91)

With `stream: true`, the renderer sets `Transfer-Encoding: chunked`, `Content-Type: text/html; charset=UTF-8` and `Content-Encoding: Identity`, and answers `c.body(renderToReadableStream(body))`, so `Suspense` boundaries in the page stream in as their data arrives ([[Suspense and Streaming JSX]]). With an object, only the headers it lists are set.

Sources: [src/middleware/jsx-renderer/index.ts:66-79](repo://src/middleware/jsx-renderer/index.ts#L66-L79)

The `Transfer-Encoding` and `Content-Encoding` headers also make the `compress` middleware leave the stream alone, since it skips responses that already have either header ([[Response Middleware]]).

Sources: [src/middleware/compress/index.ts:92-102](repo://src/middleware/compress/index.ts#L92-L102)

## Nested layouts

Because each `jsxRenderer` reads the layout left by the previous one, renderers registered on narrower paths can wrap their content in the outer frame through the `Layout` prop:

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

```tsx
app.use('*', jsxRenderer(({ children }) => (
  <html>
    <body>{children}</body>
  </html>
)))

app.use('/blog/*', jsxRenderer(({ children, Layout }) => (
  <Layout>
    <nav>Blog menu</nav>
    <article>{children}</article>
  </Layout>
)))

app.get('/blog/post', (c) => c.render(<h1>Post</h1>))
```

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

The inner middleware's renderer replaces the outer one, since `setRenderer` keeps only the last. Its `Layout` prop is the outer component, so the page is built from the inside out. A component that ignores `Layout` replaces the outer frame entirely. The `options` of the innermost renderer apply, because that renderer is the one `c.render` calls.

Sources: [src/middleware/jsx-renderer/index.ts:120-128](repo://src/middleware/jsx-renderer/index.ts#L120-L128), [src/context.ts:495-497](repo://src/context.ts#L495-L497)

## Typing c.render

`c.render`'s signature comes from the `ContextRenderer` interface. Augmenting it declares the props a page can pass to the layout, such as a title, and those props reach the component through `PropsForRenderer`:

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85), [src/middleware/jsx-renderer/index.ts:23-31](repo://src/middleware/jsx-renderer/index.ts#L23-L31)

```tsx
declare module 'hono' {
  interface ContextRenderer {
    (content: string | Promise<string>, props: { title: string }): Response | Promise<Response>
  }
}

app.use(jsxRenderer(({ children, title }) => (
  <html>
    <head><title>{title}</title></head>
    <body>{children}</body>
  </html>
)))

app.get('/', (c) => c.render(<h1>Home</h1>, { title: 'Home' }))
```

Sources: [src/context.ts:62-85](repo://src/context.ts#L62-L85), [src/middleware/jsx-renderer/index.ts:23-31](repo://src/middleware/jsx-renderer/index.ts#L23-L31)

## useRequestContext

`useRequestContext<E, P, I>()` reads `RequestContext` with `useContext` and returns the Context, typed with the given parameters. It throws `RequestContext is not provided.` when called outside a tree rendered by `jsxRenderer`.

Sources: [src/middleware/jsx-renderer/index.ts:15-16](repo://src/middleware/jsx-renderer/index.ts#L15-L16), [src/middleware/jsx-renderer/index.ts:131-165](repo://src/middleware/jsx-renderer/index.ts#L131-L165)

```tsx
const RequestUrlBadge: FC = () => {
  const c = useRequestContext()
  return <b>{c.req.url}</b>
}
```

Sources: [src/middleware/jsx-renderer/index.ts:139-153](repo://src/middleware/jsx-renderer/index.ts#L139-L153)

The value is held in a JSX context, so it follows the rules on [[JSX Server Rendering]]: it is per rendering, and an async component reading it after an `await` needs a runtime with `AsyncLocalStorage`.

Sources: [src/jsx/context.ts:161-189](repo://src/jsx/context.ts#L161-L189), [src/jsx/context.ts:259-261](repo://src/jsx/context.ts#L259-L261)
