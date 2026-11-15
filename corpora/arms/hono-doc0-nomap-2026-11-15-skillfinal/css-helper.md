---
title: "CSS Helper"
---
## Overview

The CSS helper (`hono/css`) lets JSX components declare styles next to their markup. `` css`color: red;` `` returns a class name derived from a hash of the style; using that class name in a rendered component registers its rule, and a `<Style />` element in the page receives every rule the render used, once. It works through the same `HtmlEscapedString` callbacks as async components, so it also works when the page is streamed ([[Server-Side JSX Rendering]], [[Suspense and Streaming Rendering]]).

Sources: [src/helper/css/index.ts:72-122](repo://src/helper/css/index.ts#L72-L122), [src/helper/css/index.ts:169-262](repo://src/helper/css/index.ts#L169-L262)

| Export | Returns |
| --- | --- |
| `` css`...` `` | a promise-like class name with the style attached |
| `cx(...names)` | a class name combining `css` results and plain strings; falsy values are skipped |
| `` keyframes`...` `` | an animation name whose `@keyframes` rule is emitted where it is used |
| `` viewTransition`...` `` | a class that sets a generated `view-transition-name`, with optional `::view-transition-*` rules |
| `<Style nonce? />` | the `<style id="hono-css">` element that collects the rules |
| `createCssContext({ id, classNameSlug, onInvalidSlug })` | an independent set of the above, with its own style element id |
| `rawCssString(value)` | a value inserted into a template without escaping |

Sources: [src/helper/css/index.ts:39-61](repo://src/helper/css/index.ts#L39-L61), [src/helper/css/index.ts:169-262](repo://src/helper/css/index.ts#L169-L262), [src/helper/css/common.ts:27-36](repo://src/helper/css/common.ts#L27-L36)

## Building a class name

### The style string

`buildStyleString` concatenates the template. A leading `/* comment */` becomes the label. Interpolated strings have quotes, backslashes and a `/` that follows `<` escaped with a backslash; numbers are inserted as is; `null`, `undefined` and booleans are dropped; arrays are flattened. An interpolated class name followed by `{` is used as a nested selector (`${child} { ... }`); otherwise its style is inlined, which is how one `css` result can extend another. A `keyframes` result inserts its animation name and is recorded so its rule is emitted too. The result is minified: comments, extra whitespace and trailing semicolons are removed outside quoted strings.

Sources: [src/helper/css/common.ts:79-106](repo://src/helper/css/common.ts#L79-L106), [src/helper/css/common.ts:139-199](repo://src/helper/css/common.ts#L139-L199)

### The hash

`cssCommon` hashes the label plus the style with a small multiplicative string hash (adapted from goober, per the comment) into `css-<number>`, so the same style always produces the same class name. With `classNameSlug(hash, label, style)` a custom name can be used instead; an invalid identifier is rejected with `onInvalidSlug` (by default a console warning) and the hash is kept. A style wrapped in `:-hono-global { ... }` is emitted as global rules rather than under a class.

Sources: [src/helper/css/common.ts:38-77](repo://src/helper/css/common.ts#L38-L77), [src/helper/css/common.ts:201-238](repo://src/helper/css/common.ts#L201-L238)

`cx` turns plain strings into external class names that are appended to the output but never emitted as rules; strings containing `<`, `{` or `}` are dropped, because the comment notes they could break out of a `<style>` element or inject a rule. `keyframes` names are also checked against CSS-wide keywords such as `none` and `inherit`.

Sources: [src/helper/css/common.ts:56-73](repo://src/helper/css/common.ts#L56-L73), [src/helper/css/common.ts:240-288](repo://src/helper/css/common.ts#L240-L288)

## Emitting styles during a render

### The class name object

`newCssClassNameObject` wraps the class name (HTML-escaped when it contains special characters, since `cx` names come from outside) in an `HtmlEscapedString` carrying one callback, `addClassNameToContext`, and returns it inside a resolved promise. Placing it in a `class` attribute therefore runs the callback during rendering.

Sources: [src/helper/css/index.ts:88-167](repo://src/helper/css/index.ts#L88-L167)

### Tracking per render

`createCssContext` keeps a `WeakMap` keyed by the render's callback `context` object, holding the rules still to add and the class names already added. `addClassNameToContext` records the class and any nested selectors that were not added yet and, if anything is new, returns a callback `appendStyle` to run.

Sources: [src/helper/css/index.ts:83-147](repo://src/helper/css/index.ts#L83-L147)

### Writing the rules

`appendStyle` formats the pending rules (`.class{...}`, `@keyframes` blocks, global rules) and marks them added. If the rendered buffer already contains the `<style id="...">` element, the rules are spliced into it, which is the normal case for a non-streamed page. Otherwise, as in a later streamed chunk, it emits a `<script>` that appends the rules to the style element's `textContent`, with the nonce given to `<Style nonce>` when one was set.

Sources: [src/helper/css/index.ts:86-122](repo://src/helper/css/index.ts#L86-L122)

`<Style />` renders the empty style element (or the style of a `css` value passed as its child) and registers a callback that records its nonce for the render. In the browser the class name's `toString` and the `Style` component are replaced by DOM implementations from `hono/jsx/dom/css` ([[Client-Side JSX Rendering]]).

Sources: [src/helper/css/index.ts:192-206](repo://src/helper/css/index.ts#L192-L206), [src/helper/css/index.ts:162-166](repo://src/helper/css/index.ts#L162-L166)

## View transitions

`viewTransition` generates a class whose rule is `view-transition-name:<name>`, where the name is the hash of the given style (or of an automatic label when called with no arguments). Any `::view-transition-old()`-style pseudo-elements with empty parentheses in the style get that name inserted, and the style is emitted as a global rule.

Sources: [src/helper/css/common.ts:290-333](repo://src/helper/css/common.ts#L290-L333)
