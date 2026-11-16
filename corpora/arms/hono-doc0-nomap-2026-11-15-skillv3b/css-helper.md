---
title: "CSS Helper"
---
## Overview

`hono/css` writes CSS next to JSX components as tagged templates. `css\`...\`` returns a generated class name such as `css-1234567890`, and the rule behind it is emitted into a `<style id="hono-css">` element only when a rendered element actually uses the class. The same API exists for the browser as `hono/jsx/dom/css`, which inserts rules into the live style sheet. Both share their parsing and hashing in `helper/css/common.ts`. All exports are marked experimental.

Sources: [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262), [src/helper/css/common.ts:1-11](repo://src/helper/css/common.ts#L1-L11), [src/jsx/dom/css.ts:77-90](repo://src/jsx/dom/css.ts#L77-L90)

```tsx
import { css, cx, keyframes, Style } from 'hono/css'

const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`
const card = css`
  /* card */
  padding: 1rem;
  animation: ${fade} 0.3s;
  &:hover { background: #eee; }
`

app.get('/', (c) =>
  c.html(
    <html>
      <head><Style /></head>
      <body><div class={cx(card, 'shadow')}>Hello</div></body>
    </html>
  )
)
```

Sources: [src/helper/css/index.ts:169-215](repo://src/helper/css/index.ts#L169-L215)

## From template to class name

### Building the style string

`buildStyleString(strings, values)` concatenates the template with its interpolations. Strings are inserted with quotes, backslashes and `</` escaped so a value cannot close the string or the `<style>` element; numbers are inserted as is; `null`, `undefined` and booleans are skipped, which allows `${cond && 'color:red;'}`. A class from another `css` call is inserted in one of two ways: as a nested selector `.css-...` when the next template text starts with `{`, or as its whole style string (composition) otherwise. A `keyframes` value is inserted as its name and remembered so its rule is emitted too. `rawCssString(value)` inserts trusted text unescaped.

Sources: [src/helper/css/common.ts:139-199](repo://src/helper/css/common.ts#L139-L199), [src/helper/css/common.ts:32-36](repo://src/helper/css/common.ts#L32-L36)

The result is minified (comments, extra whitespace and the last semicolon in a block removed, quoted strings left untouched). A leading `/* label */` comment is kept apart as the label.

Sources: [src/helper/css/common.ts:79-106](repo://src/helper/css/common.ts#L79-L106), [src/helper/css/common.ts:146-146](repo://src/helper/css/common.ts#L146-L146)

### Naming

`cssCommon` hashes label plus style string into `css-<number>`, so identical styles always produce the same class and are emitted once. A `classNameSlug(hash, label, styleString)` function, passed to `createCssContext`, can return a readable name instead; a name that is not a valid CSS identifier is rejected through `onInvalidSlug` (by default a console warning) and the hash is used. The returned object carries the selector, the class name (including any external classes from `cx`), the style string, and the nested selectors it depends on, under symbol keys.

Sources: [src/helper/css/common.ts:38-77](repo://src/helper/css/common.ts#L38-L77), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238)

A template of the form `:-hono-global { ... }` produces global rules rather than a scoped class, which is how `Style` children and view transitions declare document-level CSS.

Sources: [src/helper/css/common.ts:2-4](repo://src/helper/css/common.ts#L2-L4), [src/helper/css/common.ts:207-229](repo://src/helper/css/common.ts#L207-L229)

## The API

| Export | Returns | Use |
| --- | --- | --- |
| `css\`...\`` | A class name | Scoped styles for an element |
| `cx(...classes)` | A class name combining generated and plain class names | Conditional class lists; falsy values are dropped, and plain names containing `<`, `{` or `}` are discarded |
| `keyframes\`...\`` | An `@keyframes` rule with a generated name | Interpolate into `animation` |
| `viewTransition(...)` | A class setting `view-transition-name` | Pair elements across `startViewTransition` updates; the template may use `::view-transition-old()` and similar pseudo-elements, filled with the generated name |
| `Style` | The `<style id="hono-css">` element | Place once in `<head>`; accepts `nonce` and global `children` |
| `createCssContext({ id, classNameSlug })` | A separate set of the above | Several independent style elements, or custom class names |

Sources: [src/helper/css/index.ts:169-223](repo://src/helper/css/index.ts#L169-L223), [src/helper/css/common.ts:240-333](repo://src/helper/css/common.ts#L240-L333)

## Emitting styles on the server

On the server, `css` returns a promise of an `HtmlEscapedString` that carries a callback (see [[JSX Server Rendering]] for callbacks). When the class is written into the HTML, the callback `addClassNameToContext` records its rule, and those of the selectors it depends on, in a per-render map, skipping rules already emitted. A second callback, `appendStyle`, then writes the pending rules:

Sources: [src/helper/css/index.ts:88-167](repo://src/helper/css/index.ts#L88-L167)

- If the document is still in the buffer and contains the `<style id="hono-css">` element, the rules are inserted into it, so a plain `c.html()` response gets one complete style element.
- Otherwise, as in a streamed chunk after the head was sent, the rules are emitted as a small script that appends them to the style element's `textContent`, carrying the `nonce` given to `Style` so it passes a Content Security Policy.

Sources: [src/helper/css/index.ts:89-122](repo://src/helper/css/index.ts#L89-L122), [src/helper/css/index.ts:192-203](repo://src/helper/css/index.ts#L192-L203)

Rules are therefore only sent for classes that appear in the rendered page, and each at most once per response, including classes used inside `Suspense` boundaries that stream in later (see [[Streaming JSX and Suspense]]).

Sources: [src/helper/css/index.ts:124-146](repo://src/helper/css/index.ts#L124-L146)

Class names from `cx` can contain user input, so the class string is HTML-escaped before it is marked as escaped.

Sources: [src/helper/css/index.ts:149-161](repo://src/helper/css/index.ts#L149-L161)

## Emitting styles in the browser

`hono/jsx/dom/css` returns plain class-name objects whose `toString()` inserts their rules on first use. When the DOM renderer (see [[Client-side JSX (hono/jsx/dom)]]) stringifies a `class` prop, `insertRule` finds `style#hono-css`, keeps a set of rules already added on the sheet, and calls `sheet.insertRule` for new ones; global rules are split into top-level rules first. If the style element is not in the document yet, insertion is retried after a microtask.

Sources: [src/jsx/dom/css.ts:77-127](repo://src/jsx/dom/css.ts#L77-L127), [src/jsx/dom/css.ts:27-66](repo://src/jsx/dom/css.ts#L27-L66)

Because both variants hash the same way, a page rendered on the server and then updated by client components shares one style element and never inserts a rule twice. The server `Style` component carries a `DOM_RENDERER` that renders the browser `Style`, so the same component tree works in both places.

Sources: [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206), [src/jsx/dom/css.ts:180-229](repo://src/jsx/dom/css.ts#L180-L229)
