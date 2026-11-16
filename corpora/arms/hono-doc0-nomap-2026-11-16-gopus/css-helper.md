---
title: "CSS Helper"
---
## Overview

`hono/css` writes CSS next to JSX components. `css` is a tagged template that returns a generated class name; the rules behind each class are collected while the page renders and written into one `<style>` element that the `Style` component places, usually in the head. Class names are hashes of the rules, so equal styles share a class and a component's styles cannot collide with another's. The parsing and hashing code in `helper/css/common.ts` is shared by the server version in `helper/css/index.ts` and the browser version in `jsx/dom/css.ts`, which inserts rules into the live style sheet instead.

Sources: [src/helper/css/common.ts:1-11](repo://src/helper/css/common.ts#L1-L11), [src/helper/css/index.ts:72-86](repo://src/helper/css/index.ts#L72-L86), [src/jsx/dom/css.ts:77-143](repo://src/jsx/dom/css.ts#L77-L143)

```tsx
import { css, Style } from 'hono/css'

app.get('/', (c) => {
  const title = css`
    font-size: 2rem;
    color: tomato;
  `
  return c.html(
    <html>
      <head>
        <Style />
      </head>
      <body>
        <h1 class={title}>Hello</h1>
      </body>
    </html>
  )
})
```

Sources: [src/helper/css/index.ts:169-171](repo://src/helper/css/index.ts#L169-L171), [src/helper/css/index.ts:192-203](repo://src/helper/css/index.ts#L192-L203)

## The API

| Export | Returns | Use |
| --- | --- | --- |
| `css` | A class name (a promise on the server) | Scoped rules for one element |
| `cx(...names)` | A class name | Combine generated and plain class names |
| `keyframes` | An `@keyframes` rule | Interpolate into `animation` |
| `viewTransition` | A class name | Give an element a `view-transition-name` with its pseudo-element rules |
| `Style` | A `<style>` element | Where collected rules are written |
| `rawCssString(value)` | A marker object | Insert a string without escaping |
| `createCssContext({ id, classNameSlug, onInvalidSlug })` | All of the above | A separate style element and naming scheme |

Sources: [src/helper/css/index.ts:39-61](repo://src/helper/css/index.ts#L39-L61), [src/helper/css/index.ts:208-262](repo://src/helper/css/index.ts#L208-L262), [src/helper/css/common.ts:32-36](repo://src/helper/css/common.ts#L32-L36)

The default exports come from a context created with the id `hono-css`.

Sources: [src/helper/css/common.ts:4-4](repo://src/helper/css/common.ts#L4-L4), [src/helper/css/index.ts:225-227](repo://src/helper/css/index.ts#L225-L227)

## From template to class name

### Building the style string

`buildStyleString` joins the template's parts with its values. Booleans and nullish values are dropped, so `${isActive && 'color: red;'}` works. Strings are inserted with quotes, backslashes and the `/` of `</` escaped, so a value cannot close the style element. Numbers are inserted as they are. Another `css` class interpolated in property position inlines its rules; interpolated just before `{`, it becomes the selector `.css-...` for a nested rule. A `keyframes` value inserts its name. A comment at the start of the template, `/* label */`, becomes the class's label.

Sources: [src/helper/css/common.ts:139-199](repo://src/helper/css/common.ts#L139-L199)

The result is minified: comments and surrounding whitespace go, quoted strings are kept, whitespace around `{ } ; : ,` collapses, and the semicolon before `}` is dropped.

Sources: [src/helper/css/common.ts:79-106](repo://src/helper/css/common.ts#L79-L106)

### Naming

`toHash` turns the label plus the minified rules into `css-<number>` with a small multiplicative string hash. `classNameSlug(hash, label, styleString)` may return a custom name instead; a name that is not a valid CSS class name is rejected through `onInvalidSlug`, which logs a warning by default, and the hash is used. Keyframe names additionally may not be CSS-wide keywords such as `none` or `inherit`.

Sources: [src/helper/css/common.ts:43-77](repo://src/helper/css/common.ts#L43-L77), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238), [src/helper/css/common.ts:260-288](repo://src/helper/css/common.ts#L260-L288)

A template whose whole body is `:-hono-global { ... }` produces global rules rather than a class: the content is written without a selector wrapper.

Sources: [src/helper/css/common.ts:2-3](repo://src/helper/css/common.ts#L2-L3), [src/helper/css/common.ts:207-229](repo://src/helper/css/common.ts#L207-L229)

### cx and viewTransition

`cx` turns plain strings into class objects with no rules and passes everything to `css` with an empty template, so the result's class list holds the generated classes and the plain names. A plain name containing `<`, `{` or `}` is dropped, since the comment notes such characters could break out of a style element.

Sources: [src/helper/css/common.ts:58-60](repo://src/helper/css/common.ts#L58-L60), [src/helper/css/common.ts:240-258](repo://src/helper/css/common.ts#L240-L258), [src/helper/css/index.ts:173-178](repo://src/helper/css/index.ts#L173-L178)

`viewTransition` creates a class that sets `view-transition-name` to a generated name, and fills that name into any `::view-transition-*()` pseudo-elements in its template, which are emitted as global rules.

Sources: [src/helper/css/common.ts:301-333](repo://src/helper/css/common.ts#L301-L333)

## On the server

### Collecting rules during rendering

On the server, `css` returns a promise of an `HtmlEscapedString` carrying a callback, so it can be used directly as a `class` attribute. When the JSX tree is stringified, the callback records the class and the classes it depends on in a per-render map keyed by the render's context object, and schedules a second callback that writes them out once. The class name itself is HTML-escaped first, because plain names from `cx` are untrusted. The callback mechanism is described on [[JSX Server Rendering]].

Sources: [src/helper/css/index.ts:88-167](repo://src/helper/css/index.ts#L88-L167)

### Writing the rules

The writer looks in the rendered buffer for `<style id="hono-css">...</style>`, as produced by `Style`, and inserts the new rules before `</style>`. When the style element has already been streamed, it emits a `<script>` that appends the rules to the element's `textContent`, with the nonce given to `Style` so it passes a Content Security Policy. Each class is written once per render.

Sources: [src/helper/css/index.ts:86-122](repo://src/helper/css/index.ts#L86-L122), [src/helper/css/index.ts:192-203](repo://src/helper/css/index.ts#L192-L203)

`Style` also accepts a `css` value as children, whose rules are written into the element directly.

Sources: [src/helper/css/index.ts:192-197](repo://src/helper/css/index.ts#L192-L197)

## In the browser

`hono/jsx/dom/css` exports the same functions with synchronous results. Converting a class object to a string inserts its rules, and those of the classes it depends on, into the `CSSStyleSheet` of `style#hono-css` with `insertRule`, once per class. Global rules are split into separate top-level rules first. If the style element does not exist yet, insertion is retried after a microtask and throws `style sheet not found` if it is still missing. `Style` renders the `<style>` element the runtime looks for.

Sources: [src/jsx/dom/css.ts:27-66](repo://src/jsx/dom/css.ts#L27-L66), [src/jsx/dom/css.ts:77-143](repo://src/jsx/dom/css.ts#L77-L143)

The server `Style` registers the DOM version as its renderer for the browser runtime, so a component tree that uses `hono/css` renders in both places; the DOM runtime itself is on [[JSX DOM Runtime and Hooks]].

Sources: [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206)
