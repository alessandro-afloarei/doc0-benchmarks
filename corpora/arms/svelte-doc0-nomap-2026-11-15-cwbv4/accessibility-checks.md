---
title: "Accessibility Checks"
---
## Overview

The compiler lints markup for accessibility while it analyses a component. Every regular element and every `<svelte:element>` passes through `check_element` in `visitors/shared/a11y/index.js`, which reads the element's static attributes and event handlers and emits `a11y_*` warnings. The checks are compile-time only: they never change the generated code, and they only see what is written in the template, so a value coming from an expression or a spread is mostly treated as unknown.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:52-56](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L52-L56), [packages/svelte/src/compiler/phases/2-analyze/visitors/RegularElement.js:12-25](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/RegularElement.js#L12-L25), [packages/svelte/src/compiler/phases/2-analyze/visitors/SvelteElement.js:5-15](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/SvelteElement.js#L5-L15)

The rule set follows eslint-plugin-jsx-a11y: comments in the source name each rule (`aria-props`, `no-redundant-roles`, `click-events-have-key-events` and so on). Role and property data come from the `aria-query` and `axobject-query` packages. The warnings themselves are generated functions like every other compiler warning ([[Errors and Warnings]]), and the walk that calls `check_element` is described in [[Component Analysis]].

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:1-50](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L1-L50)

## Collecting attributes and handlers

`check_element` starts with one pass over the element's attributes. Event attributes (`onclick`) and `on:` directives add their event name to `handlers`; other attributes go into `attribute_map` by name. It also records whether there is a spread (`has_spread`), a `contenteditable` attribute, or a `bind:` to a contenteditable property. A spread disables most rules, since it could supply any missing attribute.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:56-101](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L56-L101)

Values are read with `get_static_value`, which only returns something for a text attribute or a boolean attribute. An attribute written as `role={r}` therefore exists in the map, but rules that need its value skip it.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:788-805](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L788-L805)

## Role and interactivity model

Several rules depend on whether an element is interactive. `element_interactivity` answers with `interactive`, `non-interactive` or `static` by matching the tag and its attributes against four schema lists precomputed in `constants.js`: element-to-role schemas from `aria-query` whose roles are all interactive or all non-interactive, then element-to-AX-object schemas from `axobject-query` whose objects are all widgets or all windows/structure. An element matching none of them is static.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:599-665](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L599-L665), [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js:281-319](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js#L281-L319)

Roles are split the same way. `abstract_roles` are the abstract ones in `aria-query`. `non_interactive_roles` are non-abstract roles that do not descend from `widget` or `window`, with `toolbar`, `tabpanel`, `generic` and `cell` moved out and `progressbar` moved in, as the comments explain. `interactive_roles` are the rest, minus `generic`. When an element has no `role` attribute, `get_implicit_role` derives one from the tag (and from `type` for `<input>` and `<menuitem>`).

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js:239-279](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js#L239-L279), [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:729-786](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L729-L786)

## Attribute rules

For each static attribute, `check_element` applies the rules keyed on its name.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:103-108](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L103-L108)

| Attribute | Warnings |
| --- | --- |
| `aria-*` | `a11y_aria_attributes` on `meta`, `html`, `script`, `style`; `a11y_unknown_aria_attribute` with a fuzzy-matched suggestion; `a11y_hidden` for `aria-hidden` on headings; `a11y_incorrect_aria_attribute_type*` when the value does not fit the property's type; `a11y_aria_activedescendant_has_tabindex` |
| `role` | `a11y_misplaced_role`, `a11y_no_abstract_role`, `a11y_unknown_role`, `a11y_no_redundant_roles`, `a11y_role_has_required_aria_props`, `a11y_interactive_supports_focus`, `a11y_no_interactive_element_to_noninteractive_role`, `a11y_no_noninteractive_element_to_interactive_role` |
| `accesskey` | `a11y_accesskey` |
| `autofocus` | `a11y_autofocus`, except on or inside `<dialog>` |
| `scope` | `a11y_misplaced_scope` outside `<th>` |
| `tabindex` | `a11y_positive_tabindex` for values above 0 |

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:103-200](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L103-L200), [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:200-279](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L200-L279)

A `role` value may list several roles separated by whitespace, and each is checked. Redundant roles have exceptions written into the rule: `<ul role="list">` (and `ol`, `li`) is allowed because `list-style: none` removes list semantics in some browsers, `<a role="link">` without `href` is allowed, and `<header>`/`<footer>` are only redundant with `banner`/`contentinfo` when not inside `<section>` or `<article>`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:152-184](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L152-L184)

ARIA value types are checked by `validate_aria_attribute_value` against the property schema from `aria-query`: `string` must be non-empty, `number` and `integer` numeric, `boolean` `true`/`false`, `token` and `tokenlist` one or more of the allowed values, `tristate` `true`/`false`/`mixed`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:867-946](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L867-L946)

## Interaction rules

These rules combine the handler set with the role model:

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:283-300](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L283-L300)

- `a11y_click_events_have_key_events`: a visible, non-interactive element with `click` but no `keydown`, `keyup` or `keypress`.
- `a11y_no_noninteractive_tabindex`: a non-negative `tabindex` on an element that is neither interactive nor given an interactive role.
- `a11y_role_supports_aria_props` (and `_implicit`): an `aria-*` attribute the element's explicit or implicit role does not support.
- `a11y_no_noninteractive_element_interactions`: handlers such as `click` or `keydown` on a non-interactive element.
- `a11y_no_static_element_interactions`: interactive handlers on a static element with no role, such as a `<div onclick>`.
- `a11y_mouse_events_have_key_events`: `mouseover` without `focus`, or `mouseout` without `blur`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:283-382](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L283-L382)

Elements hidden from screen readers (`aria-hidden="true"`, `<input type="hidden">`) and elements with a presentation role are exempt from the interaction rules.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:557-582](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L557-L582)

## Element rules

A `switch` on the tag name runs checks that only make sense for one element:

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:384-392](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L384-L392)

| Element | Check |
| --- | --- |
| `a`, `button` | `a11y_consider_explicit_label` when there is no text content and no `aria-label`/`aria-labelledby`; for `<a>`, `a11y_invalid_attribute` for an empty, `#` or `javascript:` `href`, and `a11y_missing_attribute` without `href` |
| `input` | `a11y_autocomplete_valid` for an invalid `autocomplete` token sequence |
| `img` | `a11y_img_redundant_alt` when `alt` contains "image", "photo" or "picture" |
| `label` | `a11y_label_has_associated_control` without `for` or a nested control |
| `video` | `a11y_media_has_caption` without a `<track kind="captions">` unless `muted` |
| `figcaption`, `figure` | `a11y_figcaption_parent` and `a11y_figcaption_index` |

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:384-480](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L384-L480), [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:480-525](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L480-L525)

After the switch come three generic checks. Elements listed in `a11y_required_attributes` must carry one of their attributes (`img` needs `alt`, `iframe` needs `title`, `html` needs `lang`, `area` and `object` need a text alternative), reported by `a11y_missing_attribute`. `<blink>` and `<marquee>` raise `a11y_distracting_elements`. Headings `h1` to `h6` without content or a label raise `a11y_missing_content`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js:527-552](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/index.js#L527-L552), [packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js:11-34](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/shared/a11y/constants.js#L11-L34)

## Silencing a warning

Each warning goes through the generated `w()` helper, which looks up the ignore stack recorded for the node and drops the warning when its code is ignored, then asks the `warningFilter` compile option. In the template, an HTML comment directly before the element silences it for that element and its children:

Sources: [packages/svelte/src/compiler/warnings.js:25-39](repo://packages/svelte/src/compiler/warnings.js#L25-L39)

```svelte
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div onclick={toggle}>...</div>
```

Sources: [packages/svelte/src/compiler/phases/2-analyze/index.js:93-131](repo://packages/svelte/src/compiler/phases/2-analyze/index.js#L93-L131)

In runes mode the codes must be separated by commas, and anything after the last code is prose. An unknown code raises `unknown_code` with a suggestion, and an old dashed code such as `a11y-click-events-have-key-events` raises `legacy_code` naming the underscore form. Legacy-mode components accept both forms silently.

Sources: [packages/svelte/src/compiler/utils/extract_svelte_ignore.js:28-82](repo://packages/svelte/src/compiler/utils/extract_svelte_ignore.js#L28-L82)

The explanation and examples for each `a11y_*` code live in `messages/compile-warnings/a11y.md`, from which the warning functions and the public documentation are generated.

Sources: [packages/svelte/messages/compile-warnings/a11y.md:1-20](repo://packages/svelte/messages/compile-warnings/a11y.md#L1-L20)
