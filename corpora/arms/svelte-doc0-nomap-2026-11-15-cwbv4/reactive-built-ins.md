---
title: "Reactive Built-ins"
---
## Overview

`$state` proxies only plain objects and arrays ([[Deep State Proxies]]). `svelte/reactivity` fills the gap for built-in classes and browser APIs: `SvelteMap`, `SvelteSet`, `SvelteDate`, `SvelteURL` and `SvelteURLSearchParams` are subclasses that report reads and writes to the signal graph, `MediaQuery` and `svelte/reactivity/window` expose browser state as reactive `current` values, and `createSubscriber` is the building block for wrapping any event-based API. All of them are built from the same primitives as compiled components (`source`, `state`, `get`, `set`, `increment`), described in [[Signals and Dependency Tracking]].

Sources: [packages/svelte/src/reactivity/index-client.js:1-7](repo://packages/svelte/src/reactivity/index-client.js#L1-L7), [packages/svelte/package.json:84-93](repo://packages/svelte/package.json#L84-L93)

## Server versions

`svelte/reactivity` resolves to `index-server.js` outside the browser. There the classes are the plain globals (`SvelteMap` is `Map`, and so on), `MediaQuery` is a class whose `current` is the fallback passed to its constructor (`false` by default), and `createSubscriber` returns a function that does nothing, since nothing re-renders during server rendering.

Sources: [packages/svelte/src/reactivity/index-server.js:1-23](repo://packages/svelte/src/reactivity/index-server.js#L1-L23)

## Collections

### SvelteMap

`SvelteMap` extends `Map`, keeps the actual entries in the base class, and adds signals beside them: `#sources`, one source per key that has been read; `#version`, incremented when keys are added or removed; and `#size`. Reads are fine-grained:

Sources: [packages/svelte/src/reactivity/map.js:53-129](repo://packages/svelte/src/reactivity/map.js#L53-L129), [packages/svelte/src/reactivity/map.js:130-155](repo://packages/svelte/src/reactivity/map.js#L130-L155)

- `has(key)` and `get(key)` read that key's source, creating it lazily when the key exists. For a missing key they read `#version`, so the reader re-runs if the key is added later, without creating a source for every key ever asked about.
- `keys()`, `values()`, `entries()`, `forEach` and iteration read everything (`#read_all`), and `size` reads `#size`.

Sources: [packages/svelte/src/reactivity/map.js:53-129](repo://packages/svelte/src/reactivity/map.js#L53-L129), [packages/svelte/src/reactivity/map.js:130-155](repo://packages/svelte/src/reactivity/map.js#L130-L155)

`set(key, value)` stores the value, then either creates a source for a new key (updating `#size` and `#version`) or, for an existing key whose value changed, increments that key's source. In the latter case it also increments `#version` unless every reaction depending on the key also depends on the version, so readers of whole-map views see the change. `delete` and `clear` mark sources removed and update size and version the same way.

Sources: [packages/svelte/src/reactivity/map.js:156-240](repo://packages/svelte/src/reactivity/map.js#L156-L240)

Sources created inside the same reaction run that created the map use `state` (owned by that reaction, see [[Signals and Dependency Tracking]]); otherwise `source`. `#update_version` remembers which run that was.

Sources: [packages/svelte/src/reactivity/map.js:53-93](repo://packages/svelte/src/reactivity/map.js#L53-L93)

### SvelteSet

`SvelteSet` follows the same design with one boolean source per value: `has(value)` reads it (or `#version` when absent), `add` increments `#version` and updates `#size` when the value is new, and `delete`/`clear` set the per-value sources to `false`. Iteration methods read `#version`. The first instance patches the prototype so that `forEach`, `isDisjointFrom`, `isSubsetOf` and `isSupersetOf` read the version, and `difference`, `intersection`, `symmetricDifference` and `union` return new `SvelteSet`s; doing this lazily keeps the class tree-shakeable.

Sources: [packages/svelte/src/reactivity/set.js:1-8](repo://packages/svelte/src/reactivity/set.js#L1-L8), [packages/svelte/src/reactivity/set.js:48-143](repo://packages/svelte/src/reactivity/set.js#L48-L143), [packages/svelte/src/reactivity/set.js:144-213](repo://packages/svelte/src/reactivity/set.js#L144-L213)

## SvelteDate

`SvelteDate` stores the timestamp in a `#time` state. On first construction it patches every `Date.prototype` method onto its own prototype: getters (`get*`, `to*`, `valueOf`) called without arguments go through a lazily created derived per method that reads `#time`, so `date.getHours()` only notifies readers when the hour actually changes; with arguments they read `#time` directly. Setters (`set*`) call the native method and write the new time to `#time`. The deriveds are created with the reaction that was active when the date was constructed, so they belong to its owner.

Sources: [packages/svelte/src/reactivity/date.js:1-118](repo://packages/svelte/src/reactivity/date.js#L1-L118)

## SvelteURL and SvelteURLSearchParams

`SvelteURL` keeps a state per URL component (`protocol`, `username`, `password`, `hostname`, `port`, `pathname`, `hash`, `search`). Getters read the relevant states, composite properties such as `href`, `host` and `origin` read all they depend on, and setters write through the base class and then refresh the affected states. Its `searchParams` is a `SvelteURLSearchParams` linked back to the URL: a change to the params rewrites the URL's `search`, and a change to the URL's `search` replaces the params' contents through an internal `REPLACE` method, with a flag preventing the two from updating each other in a loop.

Sources: [packages/svelte/src/reactivity/url.js:42-130](repo://packages/svelte/src/reactivity/url.js#L42-L130), [packages/svelte/src/reactivity/url.js:130-205](repo://packages/svelte/src/reactivity/url.js#L130-L205), [packages/svelte/src/reactivity/url-search-params.js:1-80](repo://packages/svelte/src/reactivity/url-search-params.js#L1-L80)

## createSubscriber

`createSubscriber(start)` returns a `subscribe` function to call inside getters. When `subscribe` runs in a tracking context, it reads an internal `version` source (making the caller depend on it) and creates a render effect that counts subscribers: the first one calls `start(update)` untracked, where `update` increments `version` so all readers re-run. When an effect using it is destroyed, the count is decremented in a microtask; the delay prevents an effect that re-runs from dropping to zero and immediately re-subscribing, which would leak a subscription. At zero, the cleanup returned by `start` runs and `version` is incremented once more so that deriveds re-check when a subscription starts again.

Sources: [packages/svelte/src/reactivity/create-subscriber.js:8-95](repo://packages/svelte/src/reactivity/create-subscriber.js#L8-L95)

Called outside a tracking context, `subscribe` does nothing, so the getter simply returns the current value. `fromStore` and `$effect.pending()` use the same mechanism ([[Stores]], [[Error Boundaries and Async Rendering]]).

Sources: [packages/svelte/src/reactivity/create-subscriber.js:64-66](repo://packages/svelte/src/reactivity/create-subscriber.js#L64-L66), [packages/svelte/src/store/index-client.js:128-151](repo://packages/svelte/src/store/index-client.js#L128-L151)

`ReactiveValue(fn, onsubscribe)` is a small internal class built on it: its `current` getter subscribes and returns `fn()`.

Sources: [packages/svelte/src/reactivity/reactive-value.js:1-24](repo://packages/svelte/src/reactivity/reactive-value.js#L1-L24)

## MediaQuery

`new MediaQuery(query, fallback)` wraps `window.matchMedia` in a `ReactiveValue` whose `current` is `matches` and whose subscription listens to `change`. The query is wrapped in parentheses unless it already contains them or uses media type and logic keywords (`screen`, `print`, `and`, `not`, ...), so both `'min-width: 600px'` and `'screen'` work. The `fallback` is only used by the server version.

Sources: [packages/svelte/src/reactivity/media-query.js:1-55](repo://packages/svelte/src/reactivity/media-query.js#L1-L55), [packages/svelte/src/reactivity/index-server.js:7-16](repo://packages/svelte/src/reactivity/index-server.js#L7-L16)

`prefersReducedMotion` in `svelte/motion` is a `MediaQuery` instance ([[Motion]]).

Sources: [packages/svelte/src/motion/index.js:1-32](repo://packages/svelte/src/motion/index.js#L1-L32)

## svelte/reactivity/window

`svelte/reactivity/window` exports singleton `ReactiveValue`s for window state: `scrollX`/`scrollY` (on `scroll`), `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight` (on `resize`), `screenLeft`/`screenTop` (polled with `requestAnimationFrame` while subscribed, since there is no event for window movement) and `online` (on `online`/`offline`). Each returns `undefined` outside the browser. `devicePixelRatio` is a separate source updated by a `matchMedia('(resolution: ...dppx)')` listener that re-registers itself for the new ratio after each change.

Sources: [packages/svelte/src/reactivity/window/index.js:1-60](repo://packages/svelte/src/reactivity/window/index.js#L1-L60), [packages/svelte/src/reactivity/window/index.js:61-122](repo://packages/svelte/src/reactivity/window/index.js#L61-L122), [packages/svelte/src/reactivity/window/index.js:124-161](repo://packages/svelte/src/reactivity/window/index.js#L124-L161)
