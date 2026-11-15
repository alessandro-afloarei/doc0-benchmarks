---
title: "Server-Side JSX Rendering"
---
## Overview

`hono/jsx` is a JSX implementation that renders to HTML strings on the server, with no virtual DOM. A JSX expression creates a `JSXNode`; calling its `toString()` walks the tree and appends escaped HTML to a string buffer. The result is an `HtmlEscapedString`: a `String` object flagged `isEscaped` so it is never escaped twice, optionally carrying callbacks that finish work the synchronous pass could not, such as async components and injected CSS. `c.html()` accepts the result directly ([[Context]]).

Sources: [src/jsx/base.ts:140-252](repo://src/jsx/base.ts#L140-L252), [src/utils/html.ts:6-46](repo://src/utils/html.ts#L6-L46), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

The same module exports React-compatible names (`createElement`, `Fragment`, `memo`, hooks, `Suspense`, `ErrorBoundary`) so components can be written in the familiar style; hooks only do real work in the browser renderer ([[Client-Side JSX Rendering]]), and streaming with `Suspense` is covered in [[Suspense and Streaming Rendering]].

Sources: [src/jsx/index.ts:6-114](repo://src/jsx/index.ts#L6-L114)

## Escaping and the html template

### HtmlEscapedString

`raw(value, callbacks)` wraps a value in a `String` object with `isEscaped = true` and an optional callback list. `escapeToBuffer(str, buffer)` appends a string to `buffer[0]`, replacing `&`, `<`, `>`, `"` and `'` with entities; the comment credits the algorithm to React DOM's escaping. Anything already escaped is appended as is.

Sources: [src/utils/html.ts:40-127](repo://src/utils/html.ts#L40-L127)

### The buffer

Rendering appends to a `StringBuffer`, an array whose first element is the string built so far. When something is not ready, such as a promise from an async component, it is pushed onto the front of the array with `buffer.unshift('', promise)`, and rendering continues in a fresh first element. `stringBufferToString` later awaits all elements, walks the array from the end, escapes resolved values that are not marked escaped, and collects their callbacks. So a tree with no async parts renders synchronously to a string, and one with async parts renders to a promise.

Sources: [src/utils/html.ts:37-88](repo://src/utils/html.ts#L37-L88)

### html``

The `html` tagged template from `hono/html` uses the same buffer: strings and other values are escaped, numbers appended, `null`, `undefined` and booleans dropped, arrays flattened, escaped strings kept, and promises deferred. It returns an `HtmlEscapedString`, or a promise of one when anything was deferred. Callbacks attached to a synchronous result are resolved immediately with `resolveCallbackSync`.

Sources: [src/helper/html/index.ts:1-57](repo://src/helper/html/index.ts#L1-L57), [src/utils/html.ts:129-140](repo://src/utils/html.ts#L129-L140)

## From JSX to HTML

### Creating nodes

`jsx(tag, props, ...children)` (also exported as `createElement`) moves `children` into `props`, removes `key`, and calls `jsxFn`. A function tag becomes a `JSXFunctionNode`; intrinsic tags with special handling (`title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button`) are routed to their component implementations; `svg` and `head` wrap their children in a namespace context; any other tag becomes a plain `JSXNode`. Invalid tag names throw. The automatic runtime (`hono/jsx/jsx-runtime`) points `jsx` and `jsxs` at the same machinery and adds `jsxTemplate` (the `html` template), `jsxAttr` and `jsxEscape`, helpers that write attributes and markup straight to escaped strings.

Sources: [src/jsx/base.ts:304-351](repo://src/jsx/base.ts#L304-L351), [src/jsx/jsx-runtime.ts:1-51](repo://src/jsx/jsx-runtime.ts#L1-L51), [src/jsx/intrinsic-element/components.ts:121-210](repo://src/jsx/intrinsic-element/components.ts#L121-L210)

### Elements and attributes

`JSXNode.toStringToBuffer` writes `<tag`, then each attribute by type:

Sources: [src/jsx/base.ts:179-251](repo://src/jsx/base.ts#L179-L251)

| Prop value | Output |
| --- | --- |
| string | escaped `key="value"` |
| `style` object | converted to `property:value` pairs and escaped |
| number or escaped string | `key="value"` unescaped |
| `true` / `false` on a boolean attribute (`checked`, `disabled`, ...) | `key=""` / omitted |
| `null` / `undefined` | omitted |
| `dangerouslySetInnerHTML` | `__html` inserted raw as the only child; throws if there are children |
| promise | deferred into the buffer |
| function | ignored for `on*` and `ref` (client-only handlers); otherwise throws |

Sources: [src/jsx/base.ts:79-106](repo://src/jsx/base.ts#L79-L106), [src/jsx/base.ts:190-239](repo://src/jsx/base.ts#L190-L239)

Attribute names are normalised (`className` to `class`, `htmlFor` to `for`), invalid names are skipped, and inside `svg` camelCase presentation attributes become kebab-case. Void elements such as `br`, `img` and `input` are self-closed when they have no children.

Sources: [src/jsx/utils.ts:1-12](repo://src/jsx/utils.ts#L1-L12), [src/jsx/base.ts:52-78](repo://src/jsx/base.ts#L52-L78), [src/jsx/base.ts:184-194](repo://src/jsx/base.ts#L184-L194), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

### Components and children

A `JSXFunctionNode` calls the component with its props and children. A return of `null`, `undefined` or a boolean renders nothing; a `JSXNode` renders in place; an escaped string is appended with its callbacks; a plain string is escaped. A promise, from an `async` component, is deferred into the buffer; when contexts are in use, the render context is captured first so the component's subtree resumes with the same provided values. Children are rendered by `childrenToStringToBuffer`, which handles strings, nested arrays, nodes, escaped strings and promises the same way.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129), [src/jsx/base.ts:254-302](repo://src/jsx/base.ts#L254-L302)

`memo(component, propsAreEqual)` caches the last output and reuses it while props compare equal (shallowly by default).

Sources: [src/jsx/base.ts:353-404](repo://src/jsx/base.ts#L353-L404)

## Context

### Providing and reading

`createContext(defaultValue)` returns a component that is also its own `Provider`. Rendering it pushes `value` onto the context's value stack, renders the children, and pops the value when the children finish, after the promise settles for async children. `useContext(context)` returns the top of the stack, or the default.

Sources: [src/jsx/context.ts:202-261](repo://src/jsx/context.ts#L202-L261)

### Isolation between requests

The stacks live in a per-render store rather than on the context object, so a value provided in one request is never seen by a concurrent one. `runWithRenderContext`, called by every top-level `toString()`, creates a store unless one is active. When `AsyncLocalStorage` is available, found through `process.getBuiltinModule('node:async_hooks')` or a CommonJS `require`, the store follows the render across `await`.

Sources: [src/jsx/context.ts:13-71](repo://src/jsx/context.ts#L13-L71), [src/jsx/context.ts:149-189](repo://src/jsx/context.ts#L149-L189), [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177)

Without it, the store is a module variable set only while the synchronous part of the render runs. Reading a context after an `await` in an async component then returns the default value, and Hono logs a one-time warning naming the runtimes that support `AsyncLocalStorage`. `captureRenderContext` snapshots the current values so deferred subtrees can be resumed with them.

Sources: [src/jsx/context.ts:25-32](repo://src/jsx/context.ts#L25-L32), [src/jsx/context.ts:73-80](repo://src/jsx/context.ts#L73-L80), [src/jsx/context.ts:191-200](repo://src/jsx/context.ts#L191-L200)

## The jsxRenderer middleware

`jsxRenderer(component, options)` from `hono/jsx-renderer` installs a renderer on the context so handlers call `c.render(<Page />, props)` instead of building the whole document. The doc comment's example wraps every `/page/*` response in a layout:

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

```ts
const app = new Hono()

app.get(
  '/page/*',
  jsxRenderer(({ children }) => {
    return (
      <html>
        <body>
          <header>Menu</header>
          <div>{children}</div>
        </body>
      </html>
    )
  })
)

app.get('/page/about', (c) => {
  return c.render(<h1>About me!</h1>)
})
```

Sources: [src/middleware/jsx-renderer/index.ts:93-114](repo://src/middleware/jsx-renderer/index.ts#L93-L114)

When the middleware runs, it reads any layout already set by an outer `jsxRenderer` (or uses `Fragment`), sets its own layout, and calls `c.setRenderer`. The component receives `Layout`, the outer layout, so nested renderers can wrap each other. The renderer prepends `<!DOCTYPE html>` (or a custom string, or nothing with `docType: false`), wraps the tree in `RequestContext.Provider` with the context `c`, and returns `c.html(body)`. With `stream: true` it sets chunked HTML headers and returns `c.body(renderToReadableStream(body))` instead; a record replaces those headers.

Sources: [src/middleware/jsx-renderer/index.ts:15-80](repo://src/middleware/jsx-renderer/index.ts#L15-L80), [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129)

Any component in the tree can call `useRequestContext()` to get `c` (to read params or variables); it throws `RequestContext is not provided.` outside a `jsxRenderer` render. The options may also be a function of the context, evaluated per render.

Sources: [src/middleware/jsx-renderer/index.ts:131-165](repo://src/middleware/jsx-renderer/index.ts#L131-L165), [src/middleware/jsx-renderer/index.ts:33-41](repo://src/middleware/jsx-renderer/index.ts#L33-L41)
