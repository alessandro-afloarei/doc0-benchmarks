---
title: "Elements, Attributes and Events"
---
## Overview

Once a template has been cloned ([[Mounting and Hydration]]), the compiled code keeps the dynamic parts of each element up to date with small runtime helpers from `internal/client/dom/elements/`: `set_attribute`, `set_class`, `set_style` and `set_attributes` for spreads, event delegation in `events.js`, and `action` and `attach` for `use:` and `{@attach}`. They share two goals: never touch the DOM when the value has not changed, and pick the correct way to apply a value (attribute, property, class list, style property) for each element.

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:162-198](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L162-L198), [packages/svelte/src/internal/client/dom/elements/events.js:134-150](repo://packages/svelte/src/internal/client/dom/elements/events.js#L134-L150)

The compiler decides which helper to use ([[Client Code Generation]]): static attributes are written into the template HTML and never touched again; dynamic ones are updated inside the fragment's `template_effect`; an element with a spread gets an `attribute_effect` that owns all its attributes.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js:198-240](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js#L198-L240)

## Attributes and properties

### Setting a single attribute

`set_attribute(element, name, value)` caches the last value per attribute in an `__attributes` object stored on the element (created by `get_attributes`, which also records whether the element is a custom element and whether it is in the HTML namespace). An unchanged value returns immediately. `null` or `undefined` removes the attribute. A non-string value whose name matches a property setter on the element (`get_setters` walks the prototype chain once per tag name and caches the list) is assigned as a property; everything else uses `setAttribute`.

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:162-198](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L162-L198), [packages/svelte/src/internal/client/dom/elements/attributes.js:530-574](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L530-L574)

During hydration the cache is filled from the server-rendered attribute. `src`, `srcset` and `<link href>` are never re-set while hydrating, because writing them would start another network request; in dev, `check_src_in_dev_hydration` resolves both URLs and warns with `hydration_attribute_changed` if they differ.

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:164-182](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L164-L182), [packages/svelte/src/internal/client/dom/elements/attributes.js:576-601](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L576-L601)

Form values have their own helpers. `set_value`, `set_checked` and `set_selected` set the properties, and `set_default_value`/`set_default_checked` the defaults. In server HTML, `value` and `checked` attributes are really the *default* values, so `remove_input_defaults` removes them after hydration (in an idle task, or immediately before a form reset) while keeping the current value, so that a form reset does not restore server values.

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:32-75](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L32-L75), [packages/svelte/src/internal/client/dom/elements/attributes.js:76-155](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L76-L155)

### Custom elements

`set_custom_element_data(node, prop, value)` decides between property and attribute for elements whose tag contains a hyphen. Once the element is registered (or its setters have been cached) a matching setter wins; before registration, objects are assigned as properties and everything else becomes a string attribute. It runs with no active reaction or effect, and with hydration turned off, so that the custom element's own lifecycle code does not get attached to Svelte's effects ([[Custom Elements]]).

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:209-263](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L209-L263)

## Classes and styles

`class={...}` accepts strings, arrays and objects. `clsx` normalises arrays and objects to a string, and `to_class(value, hash, directives)` appends the component's scoping hash ([[Scoped CSS]]) and applies `class:name={on}` directives, adding a name when on and removing every whitespace-delimited occurrence when off. An empty result returns `null`, which removes the attribute.

Sources: [packages/svelte/src/internal/shared/attributes.js:30-89](repo://packages/svelte/src/internal/shared/attributes.js#L30-L89)

`set_class(dom, is_html, value, hash, prev_classes, next_classes)` compares `value` with the last one stored in `__className`. If it changed (or during hydration) it writes the full class string, through `className` for HTML elements and `setAttribute` for SVG. If only the directives changed, it toggles just the affected names with `classList.toggle`.

Sources: [packages/svelte/src/internal/client/dom/elements/class.js:13-51](repo://packages/svelte/src/internal/client/dom/elements/class.js#L13-L51)

Styles work the same way. `set_style` writes `style.cssText` built by `to_style(value, styles)` when the `style` attribute itself changed, and otherwise calls `update_styles` to set or remove only the `style:` directive properties that changed, with a second map for `|important` directives.

Sources: [packages/svelte/src/internal/client/dom/elements/style.js:1-57](repo://packages/svelte/src/internal/client/dom/elements/style.js#L1-L57), [packages/svelte/src/internal/shared/attributes.js:91-160](repo://packages/svelte/src/internal/shared/attributes.js#L91-L160)

## Spread attributes

`attribute_effect(element, fn, sync, async, css_hash)` wraps an element with `{...props}`. A block effect evaluates `fn` to the full attribute object and calls `set_attributes(element, prev, next, css_hash)`. That function first sets every key present before but missing now to `null`, then for each key:

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:465-528](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L465-L528), [packages/svelte/src/internal/client/dom/elements/attributes.js:274-310](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L274-L310)

- `class` and `style` go through `set_class` and `set_style` (including the hash and directives stored under symbol keys).
- Unchanged values are skipped.
- Keys starting with `on` are event handlers: delegated events are stored as `element.__click` and registered with `delegate`; others get a listener whose handler always calls the current value, so swapping handlers never removes and re-adds the listener.
- `value`, `selected`, `autofocus`, `defaultValue` and `defaultChecked` use their special setters.
- Other keys are removed when `null`, assigned as properties when there is a setter and the value is not a string (or the element is a custom element), and set as attributes otherwise (lower-cased for HTML elements).

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:309-401](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L309-L401), [packages/svelte/src/internal/client/dom/elements/attributes.js:402-460](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L402-L460)

Symbol keys created with `createAttachmentKey()` carry attachments through spreads: `attribute_effect` creates a branch running `attach` for each such key and destroys it when the key disappears or its function changes. On a `<select>`, the selected option is synchronised after the attributes are applied.

Sources: [packages/svelte/src/internal/client/dom/elements/attributes.js:488-525](repo://packages/svelte/src/internal/client/dom/elements/attributes.js#L488-L525), [packages/svelte/src/attachments/index.js:1-40](repo://packages/svelte/src/attachments/index.js#L1-L40)

## Event delegation

### Delegated handlers

Most UI events are handled by delegation rather than one listener per element. For events in `DELEGATED_EVENTS` (`click`, `input`, `change`, `keydown`, `pointerdown` and others), the compiler stores the handler on the element as `node.__click = handler` (or `[handler, ...args]` for hoisted handlers) and emits `$.delegate(['click'])` at module level. `delegate` adds the names to `all_registered_events` and tells every mounted root, each of which listens once per event name on its target and on `document` ([[Mounting and Hydration]]).

Sources: [packages/svelte/src/utils.js:110-142](repo://packages/svelte/src/utils.js#L110-L142), [packages/svelte/src/internal/client/dom/elements/events.js:126-150](repo://packages/svelte/src/internal/client/dom/elements/events.js#L126-L150), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/events.js:28-62](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/events.js#L28-L62)

`handle_event_propagation` reproduces bubbling for delegated handlers. Starting at the event's original target (from `composedPath()`), it walks up through `assignedSlot`, `parentNode` and shadow `host` links to the element whose listener fired, calling each element's `__<event>` handler, skipping disabled elements, and stopping when `stopPropagation()` was called. `currentTarget` is redefined during the walk so handlers see the element they are attached to. An `__root` marker on the event prevents the document fallback listener and nested roots from handling the same event twice. Handlers run with no active reaction or effect; if several throw, the first is re-thrown and the others are thrown in later microtasks.

Sources: [packages/svelte/src/internal/client/dom/elements/events.js:152-230](repo://packages/svelte/src/internal/client/dom/elements/events.js#L152-L230), [packages/svelte/src/internal/client/dom/elements/events.js:230-298](repo://packages/svelte/src/internal/client/dom/elements/events.js#L230-L298)

### Direct listeners

Events that are not delegated, those with modifiers such as `capture`, and listeners on `window`, `document` and `body` go through `create_event`. Its wrapper first runs delegated handlers for bubble-phase events (so a direct listener on a parent does not fire before delegated handlers below it), then calls the handler outside any reactive context unless propagation was stopped. Pointer, touch and wheel listeners are added in a microtask, working around a Chrome issue with cloned, disconnected nodes. `event()` registers a teardown to remove listeners on `window`, `document`, `body` and media elements, which outlive the component's DOM. `on()`, exported from `svelte/events`, uses the same wrapper so imperatively added listeners keep the correct order relative to delegated ones.

Sources: [packages/svelte/src/internal/client/dom/elements/events.js:44-124](repo://packages/svelte/src/internal/client/dom/elements/events.js#L44-L124)

The server renders `onload="this.__e=event"` on `<img>`, `<script>` and similar elements that have load or error handlers; during hydration `replay_events` removes those attributes and re-dispatches the captured event in a microtask so the client handler still runs ([[Server Code Generation]]).

Sources: [packages/svelte/src/internal/client/dom/elements/events.js:21-42](repo://packages/svelte/src/internal/client/dom/elements/events.js#L21-L42)

## Actions and attachments

`use:action={value}` compiles to `action(dom, action, () => value)`. An effect calls the action once, untracked, after the element is in the document. If the action returned an `update` method, a render effect re-reads the value deeply (so mutations of `$state` objects count) and calls `update` when it changed by `safe_not_equal`; a returned `destroy` becomes the effect's teardown.

Sources: [packages/svelte/src/internal/client/dom/elements/actions.js:1-43](repo://packages/svelte/src/internal/client/dom/elements/actions.js#L1-L43)

`{@attach fn}` compiles to `attach(node, () => fn)`. A block effect watches the attachment function itself: when it changes, the old branch is destroyed and a new branch runs `fn(node)` inside an `effect`. Because that effect tracks what `fn` reads, an attachment re-runs (after cleaning up) when its own dependencies change, unlike an action, which is called only once.

Sources: [packages/svelte/src/internal/client/dom/elements/attachments.js:1-33](repo://packages/svelte/src/internal/client/dom/elements/attachments.js#L1-L33)

`svelte/attachments` exports `createAttachmentKey()`, a `Symbol` that lets attachments be passed through props and spreads, and `fromAction(action, fn)`, which adapts an existing action into an attachment by calling it untracked, running `update` from a render effect and registering `destroy` as a teardown.

Sources: [packages/svelte/src/attachments/index.js:1-113](repo://packages/svelte/src/attachments/index.js#L1-L113)
