---
title: "Scoped CSS"
---
## Overview

A component's `<style>` block applies only to the component's own markup. The compiler achieves this without a runtime: it gives every element a selector could match a class derived from the stylesheet's hash (`svelte-xyz123`), rewrites each scoped selector to require that class, and removes or comments out rules that match nothing in the template. The work is spread over three steps: the [[Template Parser]] reads the style into a CSS AST, `css-analyze.js` and `css-prune.js` in the analysis phase decide what is global and what is used, and `3-transform/css/index.js` writes the output.

Sources: [packages/svelte/src/compiler/phases/2-analyze/index.js:847-866](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L847-L866), [packages/svelte/src/compiler/phases/3-transform/css/index.js:23-71](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L23-L71)

```mermaid
flowchart LR
  style["read_style: CSS AST"] --> analyze["analyze_css: globals, nesting, keyframes"]
  analyze --> prune["prune(stylesheet, element)<br>for each element"]
  prune --> warn["warn_unused: css_unused_selector"]
  warn --> render["render_stylesheet: add hash, drop unused"]
  render --> ext["css: 'external'<br>CompileResult.css"]
  render --> inj["css: 'injected'<br>$.append_styles / payload.css"]
```

Sources: [packages/svelte/src/compiler/phases/2-analyze/index.js:847-866](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L847-L866), [packages/svelte/src/compiler/phases/3-transform/index.js:48-51](repo://packages/svelte/src/compiler/phases/3-transform/index.js#L48-L51), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:439-448](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L439-L448)

## The CSS AST and the hash

`read_style` returns a `StyleSheet` node whose `children` are `Rule` and `Atrule` nodes. A rule has a `prelude` (a `SelectorList` of `ComplexSelector`s, each a list of `RelativeSelector`s joined by combinators, each holding simple selectors such as `TypeSelector`, `ClassSelector` or `PseudoClassSelector`) and a `block` of declarations and nested rules. The node also keeps the raw `styles` text so the transform can edit it in place.

Sources: [packages/svelte/src/compiler/phases/1-parse/read/style.js:19-43](repo://packages/svelte/src/compiler/phases/1-parse/read/style.js#L19-L43)

The scoping class comes from the `cssHash` option, which defaults to `svelte-${hash(css)}`; `hash` is a djb2-style string hash over the style text. Two components with identical styles therefore share a class.

Sources: [packages/svelte/src/compiler/validate-options.js:73-75](repo://packages/svelte/src/compiler/validate-options.js#L73-L75), [packages/svelte/src/compiler/phases/2-analyze/index.js:505-518](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L505-L518), [packages/svelte/src/utils.js:7-14](repo://packages/svelte/src/utils.js#L7-L14)

## Finding global selectors

`analyze_css` walks the stylesheet once and fills `metadata` on rules and selectors.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:318-331](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L318-L331)

- A `RelativeSelector` is `is_global` when it is `:global(...)`, and `is_global_like` when it can never be scoped: `:host`, `:root` (unless combined with `:has`), and the `::view-transition-*` pseudo-elements. Selectors under such a selector are marked `used`, so `:root:not(.x)` is not reported.
- A `ComplexSelector` is global when all of its parts are, and a global selector is `used` by definition.
- A `Rule` whose selector starts with the bare `:global` (the block form, `:global { ... }` or `div :global { ... }`) is a global block: everything after `:global` and everything inside the block is unscoped.
- `@keyframes name` is recorded so animation names can be scoped later; `@keyframes -global-name` stays global.
- `analysis.css.has_global` becomes true when a rule with declarations is entirely global; it surfaces as `CompileResult.css.hasGlobal`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:50-63](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L50-L63), [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:118-196](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L118-L196), [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:197-286](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L197-L286)

The same walk rejects shapes that would produce wrong CSS once `:global` is removed: `:global(...)` in the middle of a selector, `:global(element)` not first in a compound selector, `:global(.a)div`, a `:global(...)` holding a list inside a longer selector, declarations directly in a lone `:global { }`, combinators other than a space after a block `:global`, a leading combinator outside a nested rule, and `&` outside a nested rule.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:64-116](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L64-L116), [packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js:287-315](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-analyze.js#L287-L315)

## Matching selectors against the template

After the visitor walk, [[Component Analysis]] calls `prune(stylesheet, element)` for every element in `analysis.elements`. For each complex selector, `prune` truncates the trailing global parts (`truncate`), adds an implicit `& ` in front of a nested selector without its own `&`, and calls `apply_selector` backwards: it tests the last relative selector against the element and then follows the combinators towards the start.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:86-123](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L86-L123), [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:125-193](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L125-L193)

`relative_selector_might_apply_to_node` is deliberately generous. A class selector matches if any possible value of the element's `class` attribute, or any `class:` directive, could contain it; an attribute whose value is an expression may contain anything; an element with a spread may have any attribute. `:has(...)` is handled by checking its arguments forward from the element, treating `.x:has(.y)` like `.x .y`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:348-420](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L348-L420), [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:534-556](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L534-L556), [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:626-700](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L626-L700)

`apply_combinator` resolves combinators over the template tree. For a descendant or child combinator it gathers possible ancestors (`get_ancestor_elements`); for `+` and `~` it gathers possible siblings, which are tracked as *probably* or *definitely* existing because an `{#if}` or `{#each}` between them may or may not render. A `{@render}`, `<slot>` or component next to the element could render anything, so `:global(.x) + p` matches there. When the remaining selectors are all global and no ancestor matched, the selector still counts as matching, because the ancestor may live outside the component.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:223-294](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L223-L294), [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:849-948](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L849-L948)

A successful match marks the complex selector `used`, marks each relative selector that took part as `scoped`, and sets `element.metadata.scoped`. The client and server transforms read that flag to append the hash to the element's `class` attribute, and the analyzer adds an empty `class` attribute to scoped elements that had none.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js:195-213](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-prune.js#L195-L213), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/element.js:180-199](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/element.js#L180-L199)

## Unused selector warnings

`warn_unused` walks the stylesheet and raises `css_unused_selector` with the selector's source text for each complex selector still not `used`. It skips `@keyframes`, looks inside `:is()` and `:where()` only when the outer selector was used, and only visits the prelude of global blocks. An HTML comment `<!-- svelte-ignore css_unused_selector -->` directly before the `<style>` tag silences the whole stylesheet.

Sources: [packages/svelte/src/compiler/phases/2-analyze/css/css-warn.js:1-47](repo://packages/svelte/src/compiler/phases/2-analyze/css/css-warn.js#L1-L47), [packages/svelte/src/compiler/phases/2-analyze/index.js:854-866](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L854-L866)

## Rendering the stylesheet

### Visitors

`render_stylesheet` edits the component source with MagicString, so the output keeps the author's formatting and gets an accurate source map. It removes everything outside the style content, walks the CSS AST with these visitors, generates a map (merged with any preprocessor map, see [[Preprocessing and Source Maps]]) and returns `{ code, map, hasGlobal }`.

Sources: [packages/svelte/src/compiler/phases/3-transform/css/index.js:23-71](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L23-L71)

| Visitor | What it writes |
| --- | --- |
| `ComplexSelector` | Removes `:global(...)` wrappers; appends `.svelte-hash` to the last simple selector of each scoped part, replacing `*` and placing it before a leading pseudo-class |
| `SelectorList` | Wraps unused selectors in `/* (unused) ... */`, keeping the commas valid |
| `Rule` | Comments out rules with no used selector as `/* (unused) */` and empty rules as `/* (empty) */` (kept in dev); strips the `:global { }` wrapper of a global block |
| `Atrule` | Prefixes component keyframe names with the hash; strips `-global-` |
| `Declaration` | Prefixes `animation` and `animation-name` values that name a component keyframe |

Sources: [packages/svelte/src/compiler/phases/3-transform/css/index.js:80-195](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L80-L195), [packages/svelte/src/compiler/phases/3-transform/css/index.js:223-342](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L223-L342)

### Specificity

Scoping changes specificity, so the transform keeps the bump predictable: the first scoped part of a selector gets `.svelte-hash` (adding one class to its specificity), and later parts get `:where(.svelte-hash)`, which adds none. A nested rule inside a parent that already has local selectors starts in the bumped state, so `div { p { } }` adds a single class in total.

Sources: [packages/svelte/src/compiler/phases/3-transform/css/index.js:262-337](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L262-L337)

### Minifying

When styles are injected into JavaScript and not in dev mode, `minify` is on: unused and empty rules are removed instead of commented, and whitespace before rules and declarations is dropped (except inside custom properties, because some browsers treat `--foo: ;` and `--foo:;` differently).

Sources: [packages/svelte/src/compiler/phases/3-transform/css/index.js:33-41](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L33-L41), [packages/svelte/src/compiler/phases/3-transform/css/index.js:117-171](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L117-L171)

## External versus injected styles

With the default `css: 'external'`, `transform_component` returns the stylesheet as `CompileResult.css` and a bundler plugin is expected to emit it as a CSS file.

Sources: [packages/svelte/src/compiler/phases/3-transform/index.js:48-51](repo://packages/svelte/src/compiler/phases/3-transform/index.js#L48-L51)

With `css: 'injected'` (or for a custom element), `analysis.inject_styles` is true and `CompileResult.css` is `null`. The client component instead hoists a `$$css` constant holding `{ hash, code }` and calls `$.append_styles($$anchor, $$css)` at the start of its body. In dev, the code also carries an inline source map comment.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:439-448](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L439-L448), [packages/svelte/src/compiler/phases/3-transform/css/index.js:67-70](repo://packages/svelte/src/compiler/phases/3-transform/css/index.js#L67-L70)

`append_styles` runs inside an effect so the anchor is already in the DOM. It finds the anchor's root node: a shadow root for components rendered inside one (which is how custom elements get their styles), otherwise the document head. If no element with the hash as its `id` exists there, it appends a `<style id="svelte-hash">`; the check makes each stylesheet appear once no matter how many instances mount. In dev the style is registered so hot reloading can remove it ([[Dev Mode Tools]]).

Sources: [packages/svelte/src/internal/client/dom/css.js:1-32](repo://packages/svelte/src/internal/client/dom/css.js#L1-L32)

On the server, an injected component calls `$$payload.css.add($$css)`, and `render` emits one `<style id="hash">` per entry into `head` ([[Server Rendering Runtime]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:295-301](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L295-L301), [packages/svelte/src/internal/server/index.js:104-108](repo://packages/svelte/src/internal/server/index.js#L104-L108)
