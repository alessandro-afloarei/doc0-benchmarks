---
title: "JSX Server Rendering"
---
## Overview

`hono/jsx` is a JSX implementation that renders to HTML strings, with no virtual DOM on the server. A JSX expression creates a `JSXNode`; calling `toString()` on it walks the tree once and writes escaped HTML into a buffer. Because a `JSXNode` is marked `isEscaped`, it can be passed directly to `c.html`, returned from a handler through `c.render`, or embedded in the `html` tagged template. This page covers that synchronous path, the runtime entry points, context and the `jsxRenderer` middleware. Async components and streaming are in [[JSX Streaming and Suspense]], the browser runtime in [[JSX DOM Runtime]], and the escaping primitives in [[html and css Helpers]].

Sources: [src/jsx/base.ts:140-177](repo://src/jsx/base.ts#L140-L177), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

The package entry exports a React-shaped API: `jsx` (also as `createElement`), `Fragment`, `memo`, `cloneElement`, `isValidElement`, `createContext`, `useContext`, the hooks, `Suspense` and `ErrorBoundary`. `version` reports `19.0.0-hono-jsx` for libraries that check React's version.

Sources: [src/jsx/index.ts:36-74](repo://src/jsx/index.ts#L36-L74), [src/jsx/base.ts:444-444](repo://src/jsx/base.ts#L444-L444)

## Creating nodes

### Runtime entry points

With `jsxImportSource: "hono/jsx"`, the compiler calls `jsx`/`jsxs` from `hono/jsx/jsx-runtime`, which are both `jsxDEV`. It takes the children from `props.children`, wraps a single child in an array, and calls `jsxFn`. The classic `jsx(tag, props, ...children)` from the main entry does the same from rest arguments and moves `key` out of the props.

Sources: [src/jsx/jsx-runtime.ts:1-8](repo://src/jsx/jsx-runtime.ts#L1-L8), [src/jsx/jsx-dev-runtime.ts:1-26](repo://src/jsx/jsx-dev-runtime.ts#L1-L26), [src/jsx/base.ts:304-316](repo://src/jsx/base.ts#L304-L316)

The runtime also exports `jsxTemplate` (the `html` tag), `jsxAttr` and `jsxEscape`, used by compilers that precompile JSX into template strings, such as Deno's `precompile` mode. `jsxAttr` renders one attribute with the same rules as the tree renderer.

Sources: [src/jsx/jsx-runtime.ts:9-51](repo://src/jsx/jsx-runtime.ts#L9-L51)

### jsxFn

`jsxFn(tag, props, children)` decides which node class to build:

Sources: [src/jsx/base.ts:318-351](repo://src/jsx/base.ts#L318-L351)

| Tag | Node |
| --- | --- |
| A function (component) | `JSXFunctionNode`, which calls the function at render time |
| A name with special handling (`title`, `script`, `style`, `link`, `meta`, `form`, `input`, `button`) | `JSXFunctionNode` around that element's component |
| `svg` or `head` | `JSXNode` whose children are wrapped in a namespace context provider |
| Any other string | `JSXNode` |

Sources: [src/jsx/base.ts:318-351](repo://src/jsx/base.ts#L318-L351)

A `JSXNode` constructor rejects a string tag containing whitespace, quotes, `<`, `>`, `/`, `=`, control characters, or starting with `!` or `?`, so a tag name taken from data cannot inject markup.

Sources: [src/jsx/base.ts:147-154](repo://src/jsx/base.ts#L147-L154), [src/jsx/utils.ts:14-47](repo://src/jsx/utils.ts#L14-L47)

## Rendering to a string

### Elements and attributes

`toStringToBuffer` writes `<tag`, then each prop as an attribute:

Sources: [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239), [src/jsx/utils.ts:1-12](repo://src/jsx/utils.ts#L1-L12), [src/jsx/base.ts:52-106](repo://src/jsx/base.ts#L52-L106)

- React-style names are normalised: `className` → `class`, `htmlFor` → `for`, `httpEquiv` → `http-equiv`, and so on; inside `svg`, camel-cased presentation attributes become kebab-case.
- Invalid attribute names are skipped. `children` and `null`/`undefined` values are skipped.
- A `style` object is serialised to `prop:value` pairs, then escaped.
- Strings are escaped; numbers and already-escaped values are written as they are.
- Booleans render as `name=""` or nothing, only for the HTML boolean attributes list.
- `dangerouslySetInnerHTML.__html` replaces the children unescaped, and throws if children were also given.
- A function is allowed only for `on*` handlers and `ref`, and is dropped on the server; any other function prop throws.

Sources: [src/jsx/base.ts:179-239](repo://src/jsx/base.ts#L179-L239), [src/jsx/utils.ts:1-12](repo://src/jsx/utils.ts#L1-L12), [src/jsx/base.ts:52-106](repo://src/jsx/base.ts#L52-L106)

Void elements such as `br`, `img`, `input`, `meta` close with `/>` when they have no children; every other element is written with its children and a closing tag.

Sources: [src/jsx/base.ts:62-78](repo://src/jsx/base.ts#L62-L78), [src/jsx/base.ts:241-251](repo://src/jsx/base.ts#L241-L251)

### Children

Strings are escaped into the buffer, numbers and escaped values appended, booleans, `null` and `undefined` skipped, nested arrays flattened, and child nodes rendered in place. A promise child is pushed to the front of the buffer array, which turns the render into an async one.

Sources: [src/jsx/base.ts:108-129](repo://src/jsx/base.ts#L108-L129)

### Components

`JSXFunctionNode` calls the component with its props, with `children` set to the single child or the array. A boolean or `null` result renders nothing, a node renders in place, an escaped string is appended together with its callbacks, and a plain string is escaped. A promise result (an async component) is queued in the buffer; when contexts exist, the current context values are captured and attached to the resolved node so it renders with the values that were active when it was called.

Sources: [src/jsx/base.ts:254-296](repo://src/jsx/base.ts#L254-L296)

### Finishing

`toString()` starts with a one-element buffer. When nothing async was queued, it returns `buffer[0]`, running any callbacks synchronously through `resolveCallbackSync`. Otherwise it returns the promise from `stringBufferToString`, which awaits every queued part and escapes those not marked as escaped. The whole render runs inside `runWithRenderContext` so context values stay per request.

Sources: [src/jsx/base.ts:166-177](repo://src/jsx/base.ts#L166-L177), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88)

## Document metadata

`title`, `meta`, `link`, `script` and `style` can be written anywhere in the tree and still end up in `<head>`. Their components render the tag and attach an `insertIntoHead` callback. When the callback runs over a buffer that already contains `</head>`, it removes the tag from where it was written and inserts it before `</head>`.

Sources: [src/jsx/intrinsic-element/components.ts:17-91](repo://src/jsx/intrinsic-element/components.ts#L17-L91), [src/jsx/intrinsic-element/components.ts:96-119](repo://src/jsx/intrinsic-element/components.ts#L96-L119)

Tags are collected per render in a `WeakMap` keyed by the render context and de-duplicated by key attributes, so two components declaring the same stylesheet produce one `link`. Stylesheet `link` and `style` tags with a `precedence` prop are ordered by precedence, in the order precedences first appear, and get a `data-precedence` attribute.

Sources: [src/jsx/intrinsic-element/components.ts:36-81](repo://src/jsx/intrinsic-element/components.ts#L36-L81)

The hoisting is skipped where it would be wrong: inside `<head>` or `<svg>` the tags render in place, as does an element with `itemProp`, a `script` without both `src` and `async`, a `style` without `href` and `precedence`, and a `link` with `onLoad`/`onError` or a stylesheet without `precedence`.

Sources: [src/jsx/intrinsic-element/components.ts:93-177](repo://src/jsx/intrinsic-element/components.ts#L93-L177)

`form`, `input` and `button` accept a function as `action` or `formAction`. On the server the function is replaced by its permalink when it has one, and dropped otherwise.

Sources: [src/jsx/intrinsic-element/components.ts:179-210](repo://src/jsx/intrinsic-element/components.ts#L179-L210)

## Fragment, memo and helpers

`Fragment` returns a `JSXFragmentNode` that renders only its children. `memo(component, propsAreEqual)` caches the last result and reuses it while the props compare equal, by default with `shallowEqual`; it also marks the wrapper so the DOM renderer can skip updates. `cloneElement` builds a new node with merged props and optionally new children, and `isValidElement` checks for `tag` and `props`.

Sources: [src/jsx/base.ts:298-302](repo://src/jsx/base.ts#L298-L302), [src/jsx/base.ts:353-442](repo://src/jsx/base.ts#L353-L442)

## Context

`createContext(defaultValue)` returns a component that doubles as its own `Provider`. Rendering it pushes `value` onto the context's value list, renders the children to a string, and pops the value afterwards, after the promise settles for an async subtree. `useContext(context)` returns the last pushed value, or the default.

Sources: [src/jsx/context.ts:202-261](repo://src/jsx/context.ts#L202-L261)

Values are not stored on the context object during server renders. `runWithRenderContext` gives each render a `WeakMap` store, and on runtimes that expose `AsyncLocalStorage` (probed through `process.getBuiltinModule('node:async_hooks')`), the store follows the render across `await`. Two concurrent requests therefore never see each other's provided values. Without `AsyncLocalStorage`, a `useContext` call after an `await` in an async component falls back to the default value, and a one-time warning names the runtimes that avoid it.

Sources: [src/jsx/context.ts:13-107](repo://src/jsx/context.ts#L13-L107), [src/jsx/context.ts:149-200](repo://src/jsx/context.ts#L149-L200)

## jsxRenderer middleware

`jsxRenderer(component, options)` from `hono/jsx-renderer` installs a renderer on the [[Context]], so handlers write `return c.render(<h1>Hi</h1>, { title: 'Home' })`. The component is the layout: it receives the content as `children`, the props passed to `c.render`, a `Layout` prop for the layout of an outer `jsxRenderer`, and the context `c`.

Sources: [src/middleware/jsx-renderer/index.ts:116-129](repo://src/middleware/jsx-renderer/index.ts#L116-L129), [src/context.ts:436-497](repo://src/context.ts#L436-L497)

When `c.render` is called, the renderer wraps the content in the layout, wraps that in a `RequestContext` provider holding `c`, and prefixes `<!DOCTYPE html>`. `docType: false` drops the doctype and a string replaces it. With `stream: true` the body goes through `renderToReadableStream` with chunked transfer headers (an object sets custom headers instead); otherwise it is returned through `c.html`.

Sources: [src/middleware/jsx-renderer/index.ts:18-80](repo://src/middleware/jsx-renderer/index.ts#L18-L80)

Nesting works through `c.setLayout`/`c.getLayout`: each `jsxRenderer` reads the layout set by the one before it and passes it as `Layout`, so a route-specific layout can wrap its content and then render `<Layout>` to reach the site-wide one. `useRequestContext()` returns the Hono context from inside any component under the renderer, and throws when no renderer provided it.

Sources: [src/middleware/jsx-renderer/index.ts:120-129](repo://src/middleware/jsx-renderer/index.ts#L120-L129), [src/middleware/jsx-renderer/index.ts:15-16](repo://src/middleware/jsx-renderer/index.ts#L15-L16), [src/middleware/jsx-renderer/index.ts:155-165](repo://src/middleware/jsx-renderer/index.ts#L155-L165)
