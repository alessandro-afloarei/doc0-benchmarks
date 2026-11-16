---
title: "html and css Helpers"
---
## Overview

Two helpers produce markup and styles without a build step. `html` from `hono/html` is a tagged template that escapes interpolated values and returns an `HtmlEscapedString`, the same type the JSX renderer produces, so templates and JSX mix freely. `css` from `hono/css` is a CSS-in-JS helper: a tagged template that returns a hashed class name and arranges for its rules to reach a `<style>` element, on the server through render callbacks and in the browser through the CSSOM. Both build on the escaped-string and callback machinery described in [[JSX Streaming and Suspense]].

Sources: [src/helper/html/index.ts:1-57](repo://src/helper/html/index.ts#L1-L57), [src/helper/css/index.ts:72-167](repo://src/helper/css/index.ts#L72-L167)

## Escaped strings

### HtmlEscapedString and raw

An `HtmlEscapedString` is a `String` object with `isEscaped: true` and optional `callbacks`. Every renderer appends such a value as it is, while plain strings are escaped. `raw(value, callbacks)` marks any value as already escaped, which is how trusted HTML is inserted.

Sources: [src/utils/html.ts:17-46](repo://src/utils/html.ts#L17-L46)

### Escaping

`escapeToBuffer` replaces `&`, `<`, `>`, `"` and `'` with entities while appending to a buffer. It first searches for any of them and appends the string untouched when none is present; the comment credits the approach to React DOM's `escapeTextForBrowser`.

Sources: [src/utils/html.ts:48-51](repo://src/utils/html.ts#L48-L51), [src/utils/html.ts:90-127](repo://src/utils/html.ts#L90-L127)

## The html tagged template

`html` walks the template's static parts and appends each interpolated value to a string buffer:

Sources: [src/helper/html/index.ts:11-50](repo://src/helper/html/index.ts#L11-L50)

| Value | Result |
| --- | --- |
| string | Escaped |
| number | Appended |
| `true`, `false`, `null`, `undefined` | Nothing |
| escaped value without callbacks | Its `toString()`, queued if that is a promise |
| escaped value with callbacks | Queued so the callbacks survive |
| promise | Queued |
| array | Flattened, each element handled as above |
| anything else | `toString()`, escaped |

Sources: [src/helper/html/index.ts:11-50](repo://src/helper/html/index.ts#L11-L50)

The result is a synchronous `HtmlEscapedString` when nothing was queued, with any callbacks resolved in the `Stringify` phase; otherwise it is a promise from `stringBufferToString`, which awaits the queued parts in order. `c.html` accepts either.

Sources: [src/helper/html/index.ts:52-56](repo://src/helper/html/index.ts#L52-L56), [src/utils/html.ts:53-88](repo://src/utils/html.ts#L53-L88), [src/context.ts:723-733](repo://src/context.ts#L723-L733)

```ts
import { html, raw } from 'hono/html'

app.get('/:name', (c) => {
  const name = c.req.param('name')
  return c.html(html`<!doctype html>
    <h1>Hello! ${name}!</h1>
    ${raw('<p>trusted markup</p>')}`)
})
```

Sources: [src/helper/html/index.ts:9-57](repo://src/helper/html/index.ts#L9-L57)

The JSX runtime exports `html` as `jsxTemplate` for compilers that precompile JSX into templates, and the `jsxRenderer` middleware uses it to prepend the doctype, as [[JSX Server Rendering]] shows.

Sources: [src/jsx/jsx-runtime.ts:9-14](repo://src/jsx/jsx-runtime.ts#L9-L14), [src/middleware/jsx-renderer/index.ts:60-64](repo://src/middleware/jsx-renderer/index.ts#L60-L64)

## css: building a class

### Style string and hash

`css` is a tagged template too. `buildStyleString` concatenates the parts; strings are inserted with quotes, backslashes and `</` escaped so they cannot close the `<style>` element, `rawCssString(value)` is inserted untouched, and `true`, `false`, `null` and `undefined` are skipped. A comment at the very start (`/* label */`) becomes the class label. The result is minified: comments, surplus whitespace and trailing semicolons are removed.

Sources: [src/helper/css/common.ts:139-199](repo://src/helper/css/common.ts#L139-L199), [src/helper/css/common.ts:79-106](repo://src/helper/css/common.ts#L79-L106), [src/helper/css/common.ts:27-36](repo://src/helper/css/common.ts#L27-L36)

`cssCommon` hashes the label and style string into a name like `css-123456789`. A `classNameSlug(hash, label, styleString)` option can return a custom class name; one that is not a valid CSS class name is rejected and reported through `onInvalidSlug`, by default a console warning.

Sources: [src/helper/css/common.ts:38-56](repo://src/helper/css/common.ts#L38-L56), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238)

### Composition

Interpolating another `css` class inlines its declarations and remembers its selectors, so one class can extend another. Interpolating a class directly before `{` uses it as a selector instead, for nested rules such as `${child} { color: red }`. A `keyframes` value is replaced by its animation name and its rule is emitted with the class.

Sources: [src/helper/css/common.ts:169-195](repo://src/helper/css/common.ts#L169-L195)

### The other functions

| Function | Returns |
| --- | --- |
| `css` | A class name, as a promise that also carries the style data |
| `cx(...classes)` | One class combining `css` classes and plain class-name strings; strings holding `<`, `{` or `}` are dropped |
| `keyframes` | An `@keyframes` rule whose name can be interpolated into `animation` |
| `viewTransition` | A class that sets `view-transition-name`, with `::view-transition-*()` selectors in its body filled with that name |
| `Style` | The `<style id="hono-css">` element the rules are written into |
| `createCssContext({ id, classNameSlug })` | A separate set of the functions above writing into another `<style>` id |

Sources: [src/helper/css/index.ts:169-223](repo://src/helper/css/index.ts#L169-L223), [src/helper/css/common.ts:240-333](repo://src/helper/css/common.ts#L240-L333), [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262)

## css: server output

`newCssClassNameObject` returns the class name as an escaped string carrying an `addClassNameToContext` callback, wrapped in a resolved promise. External class names coming from `cx` are escaped first, since the result is marked as safe. When the JSX or `html` renderer resolves callbacks, `addClassNameToContext` records the class's rules in a per-render map, skipping those already emitted, and returns an `appendStyle` callback.

Sources: [src/helper/css/index.ts:88-167](repo://src/helper/css/index.ts#L88-L167)

`appendStyle` writes the pending rules. In a single-string render it inserts them into the `<style id="hono-css">` element already in the buffer, before `</style>`. When streaming, or when the style element is not in the buffer, it emits a `<script>` that appends the rules to that element's `textContent`, with the `nonce` given to `<Style nonce="...">`. `Style` must therefore be rendered, normally in `<head>`, for the rules to have somewhere to go.

Sources: [src/helper/css/index.ts:86-122](repo://src/helper/css/index.ts#L86-L122), [src/helper/css/index.ts:192-203](repo://src/helper/css/index.ts#L192-L203)

```tsx
import { css, Style } from 'hono/css'

app.get('/', (c) => {
  const headerClass = css`
    background-color: orange;
    color: white;
    padding: 1rem;
  `
  return c.html(
    <html>
      <head>
        <Style />
      </head>
      <body>
        <h1 class={headerClass}>Hello!</h1>
      </body>
    </html>
  )
})
```

Sources: [src/helper/css/index.ts:225-262](repo://src/helper/css/index.ts#L225-L262)

## css: browser output

In the [[JSX DOM Runtime]], `Style` renders a plain `<style>` element and the class object's `toString` inserts rules instead. On first use it finds `style#hono-css`, attaches a set of already-added class names to its `CSSStyleSheet`, and calls `sheet.insertRule` for the class and each selector it depends on. If the style element is not in the document yet, the insertion is retried after a microtask and throws `style sheet not found` if it is still missing.

Sources: [src/jsx/dom/css.ts:77-140](repo://src/jsx/dom/css.ts#L77-L140), [src/helper/css/index.ts:81-81](repo://src/helper/css/index.ts#L81-L81), [src/helper/css/index.ts:205-206](repo://src/helper/css/index.ts#L205-L206)
