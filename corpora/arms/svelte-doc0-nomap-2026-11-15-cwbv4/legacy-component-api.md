---
title: "Legacy Component API"
---
## Overview

Svelte 5 components are functions, but Svelte 4 components were classes created with `new Component({ target, props })` and controlled through `$set`, `$on` and `$destroy`. Svelte 5 keeps code written against that API working in three layers: `svelte/legacy` provides `createClassComponent` and `asClassComponent` to wrap a component in the old class shape, plus helpers the [[Svelte 5 Migration Tool]] emits for `$:` statements and `on:` modifiers; the `compatibility.componentApi: 4` compile option makes components construct themselves that way; and the runtime keeps legacy-mode lifecycle and reactivity code for components that do not use runes. All of these are marked deprecated and are meant as a bridge.

Sources: [packages/svelte/src/legacy/legacy-client.js:16-60](repo://packages/svelte/src/legacy/legacy-client.js#L16-L60), [packages/svelte/src/compiler/validate-options.js:90-92](repo://packages/svelte/src/compiler/validate-options.js#L90-L92)

Like `svelte` itself, `svelte/legacy` has a browser build (`legacy-client.js`) and a server build (`legacy-server.js`) selected by export conditions.

Sources: [packages/svelte/package.json:74-79](repo://packages/svelte/package.json#L74-L79)

## Class components

### Svelte4Component

`createClassComponent({ component, target, anchor, props, context, intro, hydrate, recover })` returns a `Svelte4Component`; `asClassComponent(component)` returns a class whose constructor does the same, for code that calls `new`.

Sources: [packages/svelte/src/legacy/legacy-client.js:31-60](repo://packages/svelte/src/legacy/legacy-client.js#L31-L60)

The constructor reproduces Svelte 4's coarse-grained props. Instead of a `$state` proxy (which would make nested properties reactive), it wraps the props in a `Proxy` that keeps one `mutable_source` per key: reading a prop through the proxy reads its source, and setting it sets the source. The proxy also answers `true` to `LEGACY_PROPS in props`, which tells `prop()` that writes may go straight to the props object ([[Props and Component Context]]). It then calls `mount` (or `hydrate` when `hydrate: true`) with those props, intro transitions off by default, and calls `flushSync()` so the DOM exists when the constructor returns, as it did in Svelte 4, except in async mode, for custom elements, or with `sync: false`.

Sources: [packages/svelte/src/legacy/legacy-client.js:67-128](repo://packages/svelte/src/legacy/legacy-client.js#L67-L128), [packages/svelte/src/internal/client/reactivity/props.js:304-310](repo://packages/svelte/src/internal/client/reactivity/props.js#L304-L310)

The instance's exports are re-exposed as properties of the wrapper. `$set(props)` assigns into the props proxy, `$destroy()` calls `unmount`, and `$on(event, callback)` appends the callback to `props.$$events[event]` and returns a function that removes it. Those `$$events` are what `createEventDispatcher` dispatches to.

Sources: [packages/svelte/src/legacy/legacy-client.js:130-179](repo://packages/svelte/src/legacy/legacy-client.js#L130-L179), [packages/svelte/src/index-client.js:157-195](repo://packages/svelte/src/index-client.js#L157-L195)

[[Custom Elements]] use `createClassComponent` internally to create their component.

Sources: [packages/svelte/src/internal/client/dom/elements/custom-element.js:136-144](repo://packages/svelte/src/internal/client/dom/elements/custom-element.js#L136-L144)

### componentApi: 4

With `compatibility.componentApi: 4`, the compiled component imports `createClassComponent` and starts with `if (new.target) return createClassComponent({ component: App, ...$$anchor })`, so `new App(options)` works directly. Its exports object gains `$set` (`update_legacy_props`, which assigns known keys through the accessors) and `$on` (`add_legacy_event_listener`, which pushes onto `$$props.$$events`), and accessors are forced on. On the server, it attaches `App.render(props, { context })`, returning the Svelte 4 shape.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:592-607](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L592-L607), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:340-359](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L340-L359), [packages/svelte/src/internal/client/dom/legacy/misc.js:42-68](repo://packages/svelte/src/internal/client/dom/legacy/misc.js#L42-L68), [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:317-345](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L317-L345)

Without that option, dev builds instead add `$.check_target(new.target)`, which throws `component_api_invalid_new`, and `...$.legacy_api()` on the exports, whose `$set`, `$on` and `$destroy` throw `component_api_changed`, so old call sites fail with an explanation ([[Dev Mode Tools]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:357-359](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L357-L359), [packages/svelte/src/internal/client/dev/legacy.js:1-25](repo://packages/svelte/src/internal/client/dev/legacy.js#L1-L25)

## Migration helpers

`svelte/legacy` also exports the functions the migration tool inserts into migrated components:

Sources: [packages/svelte/src/legacy/legacy-client.js:181-279](repo://packages/svelte/src/legacy/legacy-client.js#L181-L279), [packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:1-60](repo://packages/svelte/src/internal/client/dom/legacy/event-modifiers.js#L1-L60), [packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:61-127](repo://packages/svelte/src/internal/client/dom/legacy/event-modifiers.js#L61-L127)

| Export | Replaces | Behaviour |
| --- | --- | --- |
| `run(fn)` | `$: { ... }` with side effects | A `user_pre_effect` running `fn`. If the effect invalidates itself while running, it warns with `legacy_recursive_reactive_block` and marks itself only maybe-dirty, emulating Svelte 4, which ran each reactive block once per tick |
| `handlers(...fns)` | Several `on:click` on one element | One handler calling each in turn, stopping after `stopImmediatePropagation()` and re-throwing errors asynchronously |
| `createBubbler()` | `on:click` without a handler (event forwarding) | Returns `bubble(type)`, producing a handler that calls the parent's `$$events[type]` callbacks |
| `preventDefault`, `stopPropagation`, `stopImmediatePropagation`, `self`, `trusted`, `once` | Event modifiers | Wrap a handler with the check or call |
| `passive`, `nonpassive` | `on:touchstart\|passive` and similar | Actions that add the listener with the given `passive` option |

Sources: [packages/svelte/src/legacy/legacy-client.js:181-279](repo://packages/svelte/src/legacy/legacy-client.js#L181-L279), [packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:1-60](repo://packages/svelte/src/internal/client/dom/legacy/event-modifiers.js#L1-L60), [packages/svelte/src/internal/client/dom/legacy/event-modifiers.js:61-127](repo://packages/svelte/src/internal/client/dom/legacy/event-modifiers.js#L61-L127)

On the server, `run` calls the function once and every event helper is a no-op. `asClassComponent` adds a static `render(props, { context })` that calls `render` and returns `{ html, head, css }` as Svelte 4 did; it lives in the server build so client bundles do not include the server runtime.

Sources: [packages/svelte/src/legacy/legacy-server.js:1-66](repo://packages/svelte/src/legacy/legacy-server.js#L1-L66)

## Legacy-mode runtime support

### The legacy flag

Components compiled without runes import `svelte/internal/flags/legacy`, which turns on `legacy_mode_flag` and enables the paths below ([[Svelte Overview]]).

Sources: [packages/svelte/src/internal/flags/legacy.js:1-3](repo://packages/svelte/src/internal/flags/legacy.js#L1-L3), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:580-582](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L580-L582)

### Lifecycle

In legacy mode `onMount`, `beforeUpdate` and `afterUpdate` push callbacks into the component context's `l.u` lists instead of creating effects, and the compiled component calls `$.init()` after its script runs. `init` creates, in order: a `user_pre_effect` that runs the `beforeUpdate` callbacks; a `user_effect` that runs the `onMount` callbacks untracked and calls their returned cleanups on destroy; and a `user_effect` for the `afterUpdate` callbacks. The two update effects call `observe_all`, which reads every mutable source registered on the context (`l.s`, filled by `mutable_source`) and every prop, so they re-run whenever any component state or prop changes, as Svelte 4's lifecycle did. With `immutable`, props only count as changed when their identity changes.

Sources: [packages/svelte/src/internal/client/dom/legacy/lifecycle.js:8-82](repo://packages/svelte/src/internal/client/dom/legacy/lifecycle.js#L8-L82), [packages/svelte/src/index-client.js:85-108](repo://packages/svelte/src/index-client.js#L85-L108), [packages/svelte/src/internal/client/reactivity/sources.js:103-119](repo://packages/svelte/src/internal/client/reactivity/sources.js#L103-L119)

### Reactivity helpers

| Helper | Purpose |
| --- | --- |
| `mutable_source` | `let` variables, with `safe_equals` so mutating an object and reassigning it counts as a change ([[Signals and Dependency Tracking]]) |
| `legacy_pre_effect`, `legacy_pre_effect_reset` | `$:` statements in topological order ([[Effects and the Effect Tree]]) |
| `reactive_import` | Imports that the instance mutates: reads go through a version source that writes bump |
| `invalidate_inner_signals` | Calls a function untracked, captures every signal it reads, and re-sets each one to its current value so their dependents update |
| `bubble_event` | `on:click` forwarding in legacy components: calls the parent's `$$events` handlers with the event |

Sources: [packages/svelte/src/internal/client/dom/legacy/misc.js:1-41](repo://packages/svelte/src/internal/client/dom/legacy/misc.js#L1-L41), [packages/svelte/src/internal/client/legacy.js:1-46](repo://packages/svelte/src/internal/client/legacy.js#L1-L46), [packages/svelte/src/internal/client/reactivity/effects.js:296-343](repo://packages/svelte/src/internal/client/reactivity/effects.js#L296-L343)
