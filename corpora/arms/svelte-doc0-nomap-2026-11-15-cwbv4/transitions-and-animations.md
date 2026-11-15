---
title: "Transitions and Animations"
---
## Overview

`transition:`, `in:` and `out:` animate an element as a block adds or removes it; `animate:` animates an item of a keyed `{#each}` when it moves. A transition or animation function (from `svelte/transition`, `svelte/animate` or user code) only describes the motion: it returns a config with a `duration`, `delay`, `easing` and either a `css(t, u)` function producing a style string or a `tick(t, u)` callback. The runtime in `dom/elements/transitions.js` turns that description into Web Animations API keyframes, runs it at the right time, and makes intros and outros reversible. It hooks into effects: a transition manager is attached to its effect and is driven by `pause_effect` and `resume_effect` ([[Effects and the Effect Tree]]).

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:174-224](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L174-L224), [packages/svelte/src/internal/client/dom/elements/transitions.js:226-306](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L226-L306), [packages/svelte/src/internal/client/reactivity/effects.js:557-612](repo://packages/svelte/src/internal/client/reactivity/effects.js#L557-L612)

## Transition managers

### The manager object

`transition(flags, element, get_fn, get_params)` is what the compiler emits for each directive. The flags (`TRANSITION_IN`, `TRANSITION_OUT`, `TRANSITION_GLOBAL`) encode the direction and the `|global` modifier. It creates a manager with three methods and pushes it onto the current effect's `transitions`:

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:174-195](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L174-L195), [packages/svelte/src/constants.js:14-16](repo://packages/svelte/src/constants.js#L14-L16)

- `in()` restores the element's `inert` state, dispatches `introstart`, and runs the intro towards `t = 1`, dispatching `introend` when done. For an `out:`-only transition it just cancels a running outro.
- `out(fn)` makes the element `inert` (so it cannot be interacted with while leaving), dispatches `outrostart`, runs the outro towards `t = 0`, and calls `fn` (the pause callback) after `outroend`. An `in:`-only transition calls `fn` immediately.
- `stop()` aborts both, used when the effect is destroyed.

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:226-278](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L226-L278)

The transition function is called lazily by `get_options` and its result cached while a transition runs, so reversing mid-way reuses the same config (and duration) rather than jumping. It is called outside any reactive context, so a transition function that reads state does not subscribe anything.

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:213-224](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L213-L224)

### When intros play

An intro plays on creation only when `should_intro` is true: `mount` sets it from its `intro` option, `hydrate` defaults it to false, and `<svelte:element>` turns it off when the tag changes ([[Mounting and Hydration]]). Local transitions (the default) additionally require that the nearest enclosing block, skipping transparent ones such as snippets and `{:else if}`, has already run; that is, the element appears because that block's condition changed, not because an ancestor was created. Global transitions skip this check. The intro starts in an `effect`, after the element is in the document.

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:280-306](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L280-L306), [packages/svelte/src/internal/client/render.js:35-45](repo://packages/svelte/src/internal/client/render.js#L35-L45)

Outros are started by blocks. When a block calls `pause_effect` on a branch, `pause_children` collects the managers of that branch (all of them for the branch itself, only global ones below nested blocks) and calls `out()` on each, destroying the branch when all have finished; `resume_effect` calls `in()` with the same rules if the branch comes back first ([[Control Flow Blocks]]).

Sources: [packages/svelte/src/internal/client/reactivity/effects.js:557-660](repo://packages/svelte/src/internal/client/reactivity/effects.js#L557-L660)

## Running an animation

### Steps

`animate(element, options, counterpart, t2, on_finish)` performs one intro (`t2 = 1`) or outro (`t2 = 0`):

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:308-316](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L308-L316)

1. If `options` is a function (a deferred transition such as `crossfade`), it is called in a microtask, after the DOM has been updated, and a facade object is returned so callers stay synchronous.
2. The counterpart (the opposite transition still running on the element) is deactivated so its finish callback will not fire.
3. With no duration the animation finishes at once.
4. A first Web Animation lasting `delay` runs, holding the starting keyframe for a fresh intro (`css(0, 1)`) so the element does not flash in its final state. The comment notes it is kept even for a delay of `0`, so that CSS keyframes are only computed after the DOM updates.
5. When the delay ends, the start point `t1` is taken from the counterpart's current progress (or the opposite end), and the counterpart is aborted. The remaining duration is scaled by `|t2 - t1|`, so reversing halfway takes half the time.
6. For `css`, the function is sampled about every 16 ms (`n = ceil(duration / (1000 / 60))`) through the easing function, each sample converted into a keyframe with camel-cased property names, and the whole list passed to `element.animate`. For `tick`, a `loop` task calls `tick(t, 1 - t)` every frame while the animation runs.
7. On finish, `tick` gets the final value and `on_finish` runs.

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:316-390](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L316-L390), [packages/svelte/src/internal/client/dom/elements/transitions.js:390-470](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L390-L470), [packages/svelte/src/internal/client/dom/elements/transitions.js:30-73](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L30-L73)

Because the keyframes are precomputed and handed to the browser, CSS transitions run off the main thread once started. A style that contains `overflow: hidden` is also set inline during the animation to work around a Safari bug, and restored after the intro.

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:396-420](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L396-L420), [packages/svelte/src/internal/client/dom/elements/transitions.js:196-204](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L196-L204)

### The frame loop

`loop(callback)` registers a task in `raf.tasks` and returns `{ promise, abort }`. A single `requestAnimationFrame` callback runs all tasks with `raf.now()`, removing and resolving those whose callback returned false, and schedules itself again while tasks remain. `raf` in `timing.js` wraps `requestAnimationFrame` and `performance.now()` so that nothing touches them outside a browser and tests can replace them. The same loop drives `svelte/motion` ([[Motion]]).

Sources: [packages/svelte/src/internal/client/loop.js:1-48](repo://packages/svelte/src/internal/client/loop.js#L1-L48), [packages/svelte/src/internal/client/timing.js:1-16](repo://packages/svelte/src/internal/client/timing.js#L1-L16)

## animate: in keyed each blocks

`animation(element, get_fn, get_params)` creates an animation manager on the current `{#each}` item (`current_each_item`) with four methods that the each block's reconciliation calls ([[Each Blocks]]):

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:75-96](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L75-L96)

| Method | Called | Does |
| --- | --- | --- |
| `measure()` | Before the DOM is reordered | Stores the element's bounding box as `from` |
| `apply()` | In a microtask after reordering | Reads the new box `to`; if it moved, calls the animate function with `{ from, to }` and runs the result |
| `fix()` | On items being removed | Switches the element to `position: absolute` at its old place so remaining items can move into its space while it transitions out |
| `unfix()` | When a removed item comes back | Restores the original styles |

Sources: [packages/svelte/src/internal/client/dom/elements/transitions.js:97-172](repo://packages/svelte/src/internal/client/dom/elements/transitions.js#L97-L172)

## Built-in functions

`svelte/transition` exports `fade`, `blur`, `fly`, `slide`, `scale` and `draw`, each a function `(node, params) => TransitionConfig` with `delay`, `duration` and `easing` defaults; they read the element's computed style once (opacity, transform, size) and return a `css` function interpolating from there. `slide` animates one axis including padding, margin and border, and `draw` animates `stroke-dasharray` of an SVG path, with a `speed` option as an alternative to `duration`.

Sources: [packages/svelte/src/transition/index.js:1-110](repo://packages/svelte/src/transition/index.js#L1-L110), [packages/svelte/src/transition/index.js:108-217](repo://packages/svelte/src/transition/index.js#L108-L217)

`crossfade({ fallback, ...defaults })` returns a pair `[send, receive]` for moving an element between two lists. Each side records nodes by `key` and returns a deferred transition: by the time it runs, if the other side has a node with the same key, it animates from that node's position and size (fade, translate and scale); otherwise it uses `fallback`.

Sources: [packages/svelte/src/transition/index.js:219-300](repo://packages/svelte/src/transition/index.js#L219-L300)

`svelte/animate` exports `flip`, which computes the translation and scale between the `from` and `to` boxes, accounting for the transform origin, existing transforms and CSS zoom, and returns a `css` function for the move; its default duration grows with the square root of the distance.

Sources: [packages/svelte/src/animate/index.js:1-78](repo://packages/svelte/src/animate/index.js#L1-L78)

`svelte/easing` exports the standard easing curves as functions from `[0, 1]` to progress: `linear` and the `In`, `Out` and `InOut` variants of `back`, `bounce`, `circ`, `cubic`, `elastic`, `expo`, `quad`, `quart`, `quint` and `sine`.

Sources: [packages/svelte/src/easing/index.js:1-60](repo://packages/svelte/src/easing/index.js#L1-L60)
