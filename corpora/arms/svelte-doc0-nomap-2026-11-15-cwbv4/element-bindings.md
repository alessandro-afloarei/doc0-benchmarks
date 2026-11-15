---
title: "Element Bindings"
---
## Overview

A `bind:` directive keeps a piece of state and a DOM property in sync in both directions. The compiler validates the binding against the table in `phases/bindings.js` ([[Scopes and Bindings]]) and emits a call such as `$.bind_value(input, () => $.get(text), ($$value) => $.set(text, $$value))`: a getter that reads the bound expression and a setter that writes it. Each runtime helper in `dom/elements/bindings/` follows the same shape: listen to the DOM event that signals a change and call `set`, and run a render effect that reads `get` and writes the DOM when the state changes.

Sources: [packages/svelte/tests/snapshot/samples/state-proxy-literal/_expected/client/index.svelte.js:28-31](repo://packages/svelte/tests/snapshot/samples/state-proxy-literal/_expected/client/index.svelte.js#L28-L31), [packages/svelte/src/compiler/phases/bindings.js:1-40](repo://packages/svelte/src/compiler/phases/bindings.js#L1-L40)

| Binding | Helper | Listens to |
| --- | --- | --- |
| `bind:value` on input/textarea | `bind_value` | `input` |
| `bind:checked` | `bind_checked` | `change` |
| `bind:group` | `bind_group` | `change` |
| `bind:files` | `bind_files` | `change` |
| `bind:value` on select | `bind_select_value` | `change`, plus a `MutationObserver` |
| `bind:innerHTML`, `textContent`, `innerText` | `bind_content_editable` | `input` |
| `bind:clientWidth` and similar | `bind_element_size` | shared `ResizeObserver` |
| `bind:contentRect`, `borderBoxSize` and similar | `bind_resize_observer` | shared `ResizeObserver` |
| Media bindings (`currentTime`, `paused`, `volume`, ...) | `bind_current_time`, `bind_paused`, ... | media events and `requestAnimationFrame` |
| `bind:scrollX`/`scrollY`, `innerWidth`, ... on `<svelte:window>` | `bind_window_scroll`, `bind_window_size` | `scroll`, `resize` |
| `bind:activeElement` on `<svelte:document>`, `bind:online` | `bind_active_element`, `bind_online` | `focusin`/`focusout`, `online`/`offline` |
| `bind:focused` | `bind_focused` | `focus`, `blur` |
| `bind:this` | `bind_this` | none |

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:9-118](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L9-L118), [packages/svelte/src/internal/client/dom/elements/bindings/universal.js:11-75](repo://packages/svelte/src/internal/client/dom/elements/bindings/universal.js#L11-L75), [packages/svelte/src/internal/client/dom/elements/bindings/size.js:83-108](repo://packages/svelte/src/internal/client/dom/elements/bindings/size.js#L83-L108), [packages/svelte/src/internal/client/dom/elements/bindings/window.js:10-66](repo://packages/svelte/src/internal/client/dom/elements/bindings/window.js#L10-L66)

## Shared plumbing

`listen(target, events, handler)` calls the handler once immediately (unless told not to), adds it for each event, and registers a teardown that removes it. `without_reactive_context(fn)` runs `fn` with no active reaction or effect, so a handler that fires synchronously during an effect (a `blur` caused by removing a node, say) does not write state from inside that effect.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/shared.js:9-49](repo://packages/svelte/src/internal/client/dom/elements/bindings/shared.js#L9-L49)

Form controls also react to form resets. `listen_to_event_and_reset_event` adds the event listener and stores an `__on_r` callback on the element; `add_form_reset_listener` installs one capturing `reset` listener on `document`, which a microtask after the reset (when the browser has restored default values) calls `__on_r` on every element of the form, so bound state picks up the reset values. A checkbox with both `bind:group` and `bind:checked` chains both callbacks.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/shared.js:51-76](repo://packages/svelte/src/internal/client/dom/elements/bindings/shared.js#L51-L76), [packages/svelte/src/internal/client/dom/elements/misc.js:35-58](repo://packages/svelte/src/internal/client/dom/elements/misc.js#L35-L58)

## Text inputs

`bind_value(input, get, set)` writes `input.value` to state on every `input` event, converting to a number (or `null` for an empty string) for `type="number"` and `type="range"`. After setting, it waits a tick and, if the bound value differs from what it set (a setter that validates or transforms the value), writes the corrected value back to the input while preserving the selection range.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:19-55](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L19-L55)

On creation, if the input already differs from its default (the user typed before hydration finished) or the bound value is `null` while the input has a value, the input's value wins and is written to state. The render effect then writes state to the input, with several guards:

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:57-113](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L57-L113)

- It never rewrites a focused input during a batch that the input itself caused, which matters in async mode when the rest of the update waits for async work.
- `0` and `00` are treated as equal for number inputs.
- A cleared, invalid date input is not overwritten while the user is typing.
- It writes only if the value differs, so `minlength` validation keeps working.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:57-113](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L57-L113)

`bind:value` on a checkbox throws `bind_invalid_checkbox_value` in dev; `bind:checked` is the right binding there.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:57-113](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L57-L113)

## Checkboxes, radios and files

`bind_checked` syncs `input.checked` with a boolean, taking the DOM value at creation when hydration found it changed or when the bound value is `null`.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:214-240](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L214-L240)

`bind_group(inputs, group_index, input, get, set)` binds a set of radios or checkboxes to one value. The compiler allocates a binding group array per bound expression (and per `{#each}` index path, using `group_index`), and every input adds itself to it. On `change` a radio sets its own `__value`; a checkbox sets an array built from all checked inputs in the group. The render effect checks each input whose `__value` is included in the array (checkboxes) or equal to the value (radios). The group array is re-sorted into document order in a microtask, so the resulting array follows the order of the inputs on the page, and inputs remove themselves on teardown.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:120-212](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L120-L212), [packages/svelte/src/internal/client/dom/elements/bindings/input.js:243-265](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L243-L265)

`bind_files` writes `input.files` to state on `change` and assigns state back to `input.files`.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/input.js:272-304](repo://packages/svelte/src/internal/client/dom/elements/bindings/input.js#L272-L304)

## Select elements

`bind_select_value` reads the selected option's value on `change` (an array of values for `multiple`), using each `<option>`'s `__value` when it was given a non-string value. It writes state to the element in an `effect` rather than a render effect, so that options created by an `{#each}` inside the `<select>` exist before the selection is applied. On mount, an `undefined` bound value is replaced with the option the DOM already selected.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/select.js:79-138](repo://packages/svelte/src/internal/client/dom/elements/bindings/select.js#L79-L138)

`select_option` applies a value: for a multiple select it requires an array (warning with `select_multiple_invalid_value` otherwise) and selects every option whose value it contains; for a single select it selects the first match and clears the selection when nothing matches. `init_select` installs a `MutationObserver` on the select's options and their `value` attributes and re-applies the current value when they change, without writing to the bound state.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/select.js:7-77](repo://packages/svelte/src/internal/client/dom/elements/bindings/select.js#L7-L77)

## Element dimensions

Size bindings use `ResizeObserverSingleton`: one `ResizeObserver` per box option (`content-box`, `border-box`, `device-pixel-content-box`) shared by all elements, which dispatches each entry to the listeners registered for its target and unobserves an element when its last listener goes. `bind_resize_observer` passes the requested entry property (`contentRect`, `borderBoxSize`, ...) to `set`. `bind_element_size` reads `clientWidth`, `offsetHeight` and so on from the element on every border-box resize and once after mount. All of these are read-only: there is no effect writing state back.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/size.js:9-108](repo://packages/svelte/src/internal/client/dom/elements/bindings/size.js#L9-L108)

## Media elements

Media bindings in `media.js` mix read-only and two-way properties. `bind_current_time` polls `currentTime` with `requestAnimationFrame` while the media plays (the `timeupdate` event alone fires too rarely) and also listens to `timeupdate` for scrubbing while paused; its render effect seeks when state changes. `bind_paused`, `bind_volume`, `bind_muted` and `bind_playback_rate` are two-way; `bind_buffered`, `bind_seekable`, `bind_played` (converted from `TimeRanges` to arrays), `bind_seeking`, `bind_ended` and `bind_ready_state` only read.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/media.js:1-61](repo://packages/svelte/src/internal/client/dom/elements/bindings/media.js#L1-L61), [packages/svelte/src/internal/client/dom/elements/bindings/media.js:62-130](repo://packages/svelte/src/internal/client/dom/elements/bindings/media.js#L62-L130), [packages/svelte/src/internal/client/dom/elements/bindings/media.js:131-232](repo://packages/svelte/src/internal/client/dom/elements/bindings/media.js#L131-L232)

## Window, document and generic properties

`bind_window_scroll` writes `scrollX`/`scrollY` on passive `scroll` events and scrolls the window when state changes, except for the initial value (deliberately, for accessibility) and while a scroll is in progress (a 100 ms timer marks scrolling). `bind_window_size` reads `innerWidth` and the like on `resize`.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/window.js:10-66](repo://packages/svelte/src/internal/client/dom/elements/bindings/window.js#L10-L66)

`bind_property(property, event_name, element, set, get)` is the generic two-way helper for simple properties such as `bind:open` on `<details>`. `bind_content_editable` syncs `innerHTML`, `textContent` or `innerText` of a `contenteditable` element; when state is `null` it adopts the element's current content instead of clearing it. `bind_focused` reports whether the element is `document.activeElement`.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/universal.js:11-75](repo://packages/svelte/src/internal/client/dom/elements/bindings/universal.js#L11-L75)

## bind:this

`bind_this(element_or_component, update, get_value, get_parts)` assigns the element (or a component's exports) to the bound expression once it is created and clears it on destroy. Inside an `{#each}`, `get_parts` returns the item values the expression uses (as in `bind:this={refs[item.id]}`); when they change, the element is assigned at the new location and the old location is cleared if it still points at this element. Clearing happens in a microtask after teardown, and only if no other element has taken the slot, so swapping elements does not leave `null` behind. `is_bound_this` compares through `STATE_SYMBOL`, so a proxied array of refs still matches.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/this.js:1-61](repo://packages/svelte/src/internal/client/dom/elements/bindings/this.js#L1-L61)

## Binding to components

`bind:prop` on a component needs no helper: the parent passes a getter/setter pair in the props object and the child's `$bindable` prop calls the setter ([[Props and Component Context]]). For legacy components that `export` a `const` or function, `bind_prop` writes the value into the parent's props object when it has a setter, and resets it to `null` on teardown.

Sources: [packages/svelte/src/internal/client/dom/elements/bindings/props.js:1-22](repo://packages/svelte/src/internal/client/dom/elements/bindings/props.js#L1-L22), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:423-437](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L423-L437)
