---
title: "Stores"
---
## Overview

`svelte/store` is Svelte's original reactivity primitive, kept in Svelte 5 for shared state outside components and for interop. A store is any object with a `subscribe(run)` method that calls `run` with the current value and returns an unsubscribe function; writable stores add `set` and `update`. The package provides `writable`, `readable`, `derived`, `readonly` and `get` (shared by both builds) plus `toStore` and `fromStore`, which bridge stores and runes and have separate client and server versions. Inside components, `$name` auto-subscribes to a store; the compiler and `reactivity/store.js` turn those subscriptions into signals.

Sources: [packages/svelte/src/store/shared/index.js:20-95](repo://packages/svelte/src/store/shared/index.js#L20-L95), [packages/svelte/src/store/index-client.js:16-16](repo://packages/svelte/src/store/index-client.js#L16-L16), [packages/svelte/package.json:98-103](repo://packages/svelte/package.json#L98-L103)

## writable and readable

`writable(value, start)` keeps a `Set` of subscribers, each a `[run, invalidate]` pair. The first subscriber calls `start(set, update)`, whose return value is the `stop` function called when the last subscriber leaves, so a store can open and close a resource (a timer, a socket) on demand. Every new subscriber is called immediately with the current value. `readable(value, start)` is a writable that only exposes `subscribe`.

Sources: [packages/svelte/src/store/shared/index.js:13-95](repo://packages/svelte/src/store/shared/index.js#L13-L95)

`set(new_value)` does nothing unless `safe_not_equal` reports a change (objects and functions always count as changed, `NaN` equals `NaN`). It then calls every subscriber's `invalidate` first and queues `run` calls in a module-level `subscriber_queue`. Only the outermost `set` drains the queue, so a subscriber that sets another store during notification does not interleave notifications: all stores settle in order, and derived stores that depend on several of them see consistent values.

Sources: [packages/svelte/src/store/shared/index.js:7-63](repo://packages/svelte/src/store/shared/index.js#L7-L63), [packages/svelte/src/internal/client/reactivity/equality.js:8-17](repo://packages/svelte/src/internal/client/reactivity/equality.js#L8-L17)

## derived

`derived(stores, fn, initial_value)` accepts one store or an array and returns a readable whose `start` subscribes to all inputs. Each input's `invalidate` sets a bit in a `pending` mask and its `run` clears it, and `sync()` only calls `fn` when no input is pending, which avoids recomputing with half-updated inputs. When `fn` declares fewer than two parameters it is "auto": its return value is set. Otherwise it receives `set` and `update` to set values asynchronously, and may return a cleanup that runs before the next call. `derived` throws on a falsy input store.

Sources: [packages/svelte/src/store/shared/index.js:97-181](repo://packages/svelte/src/store/shared/index.js#L97-L181)

`readonly(store)` exposes only `subscribe`. `get(store)` subscribes, captures the value and unsubscribes immediately, which is cheap for most stores but runs `start`/`stop` each time for a store with no other subscribers.

Sources: [packages/svelte/src/store/shared/index.js:183-209](repo://packages/svelte/src/store/shared/index.js#L183-L209)

`subscribe_to_store` is the one place the runtime calls `subscribe`. It treats a `null` store as holding `undefined`, calls `subscribe` inside `untrack` (a store's `start` may write state, which must not count as a dependency or an unsafe mutation), and also accepts RxJS-style observables whose subscribe returns an object with `unsubscribe()`.

Sources: [packages/svelte/src/store/utils.js:1-36](repo://packages/svelte/src/store/utils.js#L1-L36)

## Auto-subscriptions in components

For every `$name` reference, the analyzer declares a synthetic `store_sub` binding ([[Component Analysis]]), and the client transform:

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:215-256](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L215-L256), [packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js:43-101](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js#L43-L101)

1. Emits `const [$$stores, $$cleanup] = $.setup_stores()` at the top of the component and `$$cleanup()` at the end.
2. Declares `const $count = () => $.store_get(count, '$count', $$stores)` (in dev with `$.validate_store` first).
3. Rewrites reads of `$count` to `$count()`, assignments to `$.store_set(count, v)`, mutations such as `$obj.x = 1` to `$.store_mutate(...)`, and `$count++` to `$.update_store(...)`.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:215-256](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L215-L256), [packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js:43-101](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js#L43-L101)

`store_get(store, '$name', stores)` keeps one entry per name in the component's `$$stores` object: the store currently subscribed to, a `mutable_source` holding its latest value, and the unsubscribe function. On each read it checks whether the store variable now points at a different store (the variable was reassigned); if so it unsubscribes from the old one and subscribes to the new one. Store callbacks write into the source with `set`, so everything that read `$name` re-runs through the normal signal graph ([[Signals and Dependency Tracking]]). The synchronous first callback writes the source's value directly instead, because it may happen inside a derived where `set` would raise `state_unsafe_mutation`.

Sources: [packages/svelte/src/internal/client/reactivity/store.js:20-74](repo://packages/svelte/src/internal/client/reactivity/store.js#L20-L74)

`setup_stores` returns the `stores` object and a `cleanup` function that registers a teardown on the component's effect: it unsubscribes every entry and marks the object `IS_UNMOUNTED`. Reads after unmount (from callbacks or `bind:this` cleanup) then fall back to `get(store)` instead of creating new subscriptions that would leak.

Sources: [packages/svelte/src/internal/client/reactivity/store.js:119-142](repo://packages/svelte/src/internal/client/reactivity/store.js#L119-L142), [packages/svelte/src/internal/client/reactivity/store.js:66-71](repo://packages/svelte/src/internal/client/reactivity/store.js#L66-L71)

Writes are thin: `store_set` calls `store.set(value)`, `store_mutate` applies the mutation to the untracked current value and then calls `set` with it, and `update_store`/`update_pre_store` implement `$count++`/`++$count`. When a variable that is also subscribed to (`let count = writable(0)` with `$count` in use) is reassigned to another store, `store_unsub` unsubscribes from the old store so the next `store_get` resubscribes. `capture_store_binding` lets `prop()` detect that a bound prop is backed by a store, so mutations notify the store too ([[Props and Component Context]]).

Sources: [packages/svelte/src/internal/client/reactivity/store.js:76-177](repo://packages/svelte/src/internal/client/reactivity/store.js#L76-L177), [packages/svelte/src/internal/client/reactivity/store.js:178-203](repo://packages/svelte/src/internal/client/reactivity/store.js#L178-L203), [packages/svelte/src/internal/client/reactivity/props.js:312-318](repo://packages/svelte/src/internal/client/reactivity/props.js#L312-L318)

On the server, `$name` compiles to `$.store_get($$store_subs ??= {}, '$name', name)`, which subscribes once per render, and the component calls `$.unsubscribe_stores` at the end ([[Server Rendering Runtime]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js:240-259](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js#L240-L259), [packages/svelte/src/internal/server/index.js:267-358](repo://packages/svelte/src/internal/server/index.js#L267-L358)

## Bridging stores and runes

`toStore(get, set?)` turns reactive state into a store. On the client, the store's `start` creates an `effect_root` with a render effect that reads `get()` and forwards changes to subscribers. The root is created with the effect and reaction that were active when `toStore` was called, so it reads state in the right context; if the value changed between `toStore` and the first subscription, the first run counts as a change. With a `set` argument the store is writable, and `update` is derived from `get` and `set`.

Sources: [packages/svelte/src/store/index-client.js:18-93](repo://packages/svelte/src/store/index-client.js#L18-L93)

`fromStore(store)` goes the other way, returning an object with a `current` property (settable for writable stores). Inside an effect, reading `current` subscribes through `createSubscriber`, so the store is subscribed exactly while some effect reads it and the effect re-runs on store updates ([[Reactive Built-ins]]). Outside a tracking context, `current` falls back to `get(store)`.

Sources: [packages/svelte/src/store/index-client.js:95-169](repo://packages/svelte/src/store/index-client.js#L95-L169)

The server versions skip reactivity: `toStore` creates a writable holding `get()` once, and `fromStore`'s `current` always calls `get(store)`.

Sources: [packages/svelte/src/store/index-server.js:1-101](repo://packages/svelte/src/store/index-server.js#L1-L101)
