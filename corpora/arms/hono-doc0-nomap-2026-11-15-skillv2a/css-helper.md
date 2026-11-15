---
title: "CSS Helper"
---
## Overview

`hono/css` writes CSS next to JSX components without a build step. `css` takes a template literal and returns a class name derived from a hash of the styles. When the page renders, only the rules for class names actually used are written into a single `<style>` element placed by the `<Style />` component. The same API exists for the browser in `hono/jsx/dom/css`, which inserts rules into that style sheet with `insertRule` as components render. Both share the parsing, hashing and minifying code in `helper/css/common.ts`.

Sources: [src/helper/css/index.ts:72-167](repo://src/helper/css/index.ts#L72-L167), [src/helper/css/index.ts:169-215](repo://src/helper/css/index.ts#L169-L215), [src/jsx/dom/css.ts:77-125](repo://src/jsx/dom/css.ts#L77-L125), [src/helper/css/common.ts:1-11](repo://src/helper/css/common.ts#L1-L11)

```tsx
import { css, cx, keyframes, Style } from 'hono/css'

const fadeIn = keyframes`from { opacity: 0 } to { opacity: 1 }`
const title = css`
  color: tomato;
  animation: ${fadeIn} 1s;
  &:hover { color: red; }
`

app.get('/', (c) =>
  c.html(
    <html>
      <head><Style /></head>
      <body><h1 class={cx(title, 'external')}>Hello</h1></body>
    </html>
  )
)
```

Sources: [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262)

## Building a class

### From template to style string

`buildStyleString` concatenates the template with its values and minifies the result. A value can be:

Sources: [src/helper/css/common.ts:139-199](repo://src/helper/css/common.ts#L139-L199)

| Value | Inserted as |
| --- | --- |
| String | Text, with `\`, quotes and `</` escaped so it cannot close a string or the `<style>` element |
| Number | Text |
| `rawCssString(s)` | `s` unchanged |
| A `keyframes` result | Its animation name; the keyframes rule is added as a dependency |
| A `css` result followed by `{` | `.className`, a nested selector; the class is added as a dependency |
| Any other `css` result | Its declarations inlined, so classes compose |
| Arrays | Each item; `null`, `undefined` and booleans are skipped |

Sources: [src/helper/css/common.ts:150-196](repo://src/helper/css/common.ts#L150-L196), [src/helper/css/common.ts:32-36](repo://src/helper/css/common.ts#L32-L36)

A leading comment such as `/* card */` becomes the label. `minify` strips comments and redundant whitespace and the last semicolon in a block while leaving quoted strings untouched.

Sources: [src/helper/css/common.ts:79-106](repo://src/helper/css/common.ts#L79-L106), [src/helper/css/common.ts:146-146](repo://src/helper/css/common.ts#L146-L146)

### Naming

`cssCommon` hashes label plus styles with a small multiplicative hash and names the class `css-<number>`. Equal styles therefore produce equal class names on the server and in the browser, which keeps hydrated markup consistent. A `classNameSlug(hash, label, styles)` option on `createCssContext` can return a readable name instead; a slug that is not a valid class name is rejected through `onInvalidSlug`, which warns by default, and the hash is used.

Sources: [src/helper/css/common.ts:43-56](repo://src/helper/css/common.ts#L43-L56), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238)

The result object carries the selector, the class name to emit, the style string, its dependency selectors and any external class names, under private symbols.

Sources: [src/helper/css/common.ts:6-19](repo://src/helper/css/common.ts#L6-L19)

### Global styles, keyframes and cx

A style written as `:-hono-global { ... }` is not scoped to a class; its contents are emitted as global rules, while classes it references still count as used.

Sources: [src/helper/css/common.ts:2-3](repo://src/helper/css/common.ts#L2-L3), [src/helper/css/common.ts:207-229](repo://src/helper/css/common.ts#L207-L229)

`keyframes` returns an object whose class name is `@keyframes css-<hash>`. Custom slugs for it also reject CSS-wide keywords such as `none` and `inherit`.

Sources: [src/helper/css/common.ts:62-73](repo://src/helper/css/common.ts#L62-L73), [src/helper/css/common.ts:260-288](repo://src/helper/css/common.ts#L260-L288)

`cx(...args)` combines `css` results and plain class-name strings into one class. Strings are kept as external class names, except those containing `<`, `{` or `}`, which are dropped because they could break out of a selector or the `<style>` element.

Sources: [src/helper/css/common.ts:58-60](repo://src/helper/css/common.ts#L58-L60), [src/helper/css/common.ts:240-258](repo://src/helper/css/common.ts#L240-L258), [src/helper/css/index.ts:173-178](repo://src/helper/css/index.ts#L173-L178)

## Server rendering

### Collecting used classes

On the server `css` returns a promise of an `HtmlEscapedString` carrying an `addClassNameToContext` callback, so it can be used directly as a `class` attribute. When the render's callbacks run (see [[JSX Server Rendering]]), each class records its rules, and those of its dependencies, in a per-render map keyed by the render context. Only classes not yet written are queued.

Sources: [src/helper/css/index.ts:88-167](repo://src/helper/css/index.ts#L88-L167)

The class name text is HTML-escaped before it is marked as escaped, since external names from `cx` are untrusted.

Sources: [src/helper/css/index.ts:149-161](repo://src/helper/css/index.ts#L149-L161)

### Writing the style sheet

`<Style />` renders `<style id="hono-css">` with an optional `nonce`. The queued rules are then appended by the `appendStyle` callback:

Sources: [src/helper/css/index.ts:192-203](repo://src/helper/css/index.ts#L192-L203), [src/helper/css/index.ts:89-122](repo://src/helper/css/index.ts#L89-L122)

- In a normal render the whole document is in the buffer, so the rules are inserted inside the `<style>` element.
- When the element is not in the buffer, as in later chunks of a streamed render ([[Streaming and Suspense]]), a small script appends the rules to the element's `textContent`. It carries the same nonce as `<Style nonce>`, which suits a CSP built with the secure headers `NONCE`.

Sources: [src/helper/css/index.ts:106-121](repo://src/helper/css/index.ts#L106-L121)

Passing a `css` result as the children of `<Style>` writes its declarations into the element up front, for global rules that every page needs.

Sources: [src/helper/css/index.ts:192-196](repo://src/helper/css/index.ts#L192-L196)

## Browser rendering

`hono/jsx/dom/css` exports the same functions, built by its own `createCssContext`. There, `css` returns the class object directly, with a `toString` that inserts the rules into the `style#hono-css` sheet with `CSSStyleSheet.insertRule` the first time the class is stringified, and remembers inserted selectors in a set on the sheet. Global rules are split into top-level rules before insertion. If the sheet does not exist yet, insertion is retried on the next microtask and throws `style sheet not found` if it still is missing.

Sources: [src/jsx/dom/css.ts:27-125](repo://src/jsx/dom/css.ts#L27-L125), [src/jsx/dom/css.ts:180-195](repo://src/jsx/dom/css.ts#L180-L195)

The server `Style` component has a `DOM_RENDERER` override pointing at the browser version, so a component tree that includes `<Style />` works with either runtime.

Sources: [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206), [src/jsx/dom/css.ts:127-140](repo://src/jsx/dom/css.ts#L127-L140)

## View transitions

`viewTransition` gives an element a unique `view-transition-name` and lets the template style its `::view-transition-*()` pseudo-elements. Empty parentheses in those selectors are filled in with the generated name. Called with no arguments it only generates the name. Used with `startViewTransition` from the DOM hooks (see [[JSX DOM and Hooks]]), elements animate between states.

Sources: [src/helper/css/common.ts:290-333](repo://src/helper/css/common.ts#L290-L333), [src/helper/css/index.ts:183-190](repo://src/helper/css/index.ts#L183-L190)

## Separate contexts

`createCssContext({ id, classNameSlug, onInvalidSlug })` returns a separate `css`, `cx`, `keyframes`, `viewTransition` and `Style` that write to `<style id={id}>`. The default exports come from a context with id `hono-css`. Separate contexts let independent widgets on one page keep their own style elements or naming schemes.

Sources: [src/helper/css/index.ts:72-87](repo://src/helper/css/index.ts#L72-L87), [src/helper/css/index.ts:217-262](repo://src/helper/css/index.ts#L217-L262)
