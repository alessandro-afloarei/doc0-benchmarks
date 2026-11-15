---
title: "Props and Component Context"
---
## Overview

A compiled Svelte component is a function `Component($$anchor, $$props)`. The parent passes `$$props` as an object of getters and setters, so reading a prop always calls back into the parent's current state and a `bind:` writes straight back to it. Inside the child, the compiler turns `$props()` into calls to the helpers in `reactivity/props.js`. Around the body, `$.push` and `$.pop` maintain a stack of component contexts in `context.js`, which is what `setContext`, `getContext`, `onMount` and the other lifecycle functions from `svelte` work with.

Sources: [packages/svelte/src/internal/client/reactivity/props.js:268-289](repo://packages/svelte/src/internal/client/reactivity/props.js#L268-L289), [packages/svelte/src/internal/client/context.js:142-190](repo://packages/svelte/src/internal/client/context.js#L142-L190)

## How a parent passes props

For `<TextInput bind:value />` the parent compiles to a call with an object literal whose properties are accessors. Plain props get only a getter; bound props also get a setter that writes the parent's state. Nothing is copied: every read in the child goes through the getter, so the child sees changes as soon as the parent's signal changes, and the read is tracked as a dependency of whatever effect in the child performed it.

Sources: [packages/svelte/tests/snapshot/samples/bind-component-snippet/index.svelte:1-13](repo://packages/svelte/tests/snapshot/samples/bind-component-snippet/index.svelte#L1-L13)

```js
TextInput(node, {
	get value() {
		return $.get(value);
	},

	set value($$value) {
		$.set(value, $$value, true);
	}
});
```

Sources: [packages/svelte/tests/snapshot/samples/bind-component-snippet/_expected/client/index.svelte.js:21-29](repo://packages/svelte/tests/snapshot/samples/bind-component-snippet/_expected/client/index.svelte.js#L21-L29)

Spreads (`<Child {...a} b={1} {...c} />`) use `spread_props(...)`, a proxy over a list of objects and thunks that looks a key up from the last source to the first, so later props win; `set`, `has` and `ownKeys` follow the same order.

Sources: [packages/svelte/src/internal/client/reactivity/props.js:183-266](repo://packages/svelte/src/internal/client/reactivity/props.js#L183-L266)

## Reading props in the child

### Unwrapped and rest props

What `$props()` compiles to depends on how the prop is used. A prop that is only read, with no default and no binding, is not wrapped at all: `props.a` compiles to `$$props.a`. Rest props become `$.rest_props($$props, [...excluded])`, a read-only proxy that hides the named props and the internal `$$slots`, `$$events` and `$$legacy` keys; writing to it throws `props_rest_readonly` in dev.

Sources: [packages/svelte/tests/snapshot/samples/props-identifier/_expected/client/index.svelte.js:4-17](repo://packages/svelte/tests/snapshot/samples/props-identifier/_expected/client/index.svelte.js#L4-L17), [packages/svelte/src/internal/client/reactivity/props.js:48-101](repo://packages/svelte/src/internal/client/reactivity/props.js#L48-L101)

Every other prop becomes `prop($$props, 'name', flags, fallback)`, which returns an accessor function: `name()` reads, `name(v)` writes, and `name(v, true)` signals a mutation of the current value. The flags come from the compiler:

Sources: [packages/svelte/src/internal/client/reactivity/props.js:268-296](repo://packages/svelte/src/internal/client/reactivity/props.js#L268-L296), [packages/svelte/src/compiler/phases/3-transform/client/utils.js:200-229](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L200-L229)

| Flag | Meaning |
| --- | --- |
| `PROPS_IS_RUNES` | Component is in runes mode |
| `PROPS_IS_BINDABLE` | Declared with `$bindable()` (or `export let` in legacy mode) |
| `PROPS_IS_UPDATED` | The child writes to the prop |
| `PROPS_IS_IMMUTABLE` | Use strict equality for the local derived |
| `PROPS_IS_LAZY_INITIAL` | `fallback` is a thunk to call only when needed |

Sources: [packages/svelte/src/internal/client/reactivity/props.js:268-296](repo://packages/svelte/src/internal/client/reactivity/props.js#L268-L296), [packages/svelte/src/compiler/phases/3-transform/client/utils.js:200-229](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L200-L229)

### Fallback values

When the parent passes `undefined` and a fallback exists, the getter returns the fallback, computing it once (untracked) for lazy fallbacks. In runes mode a prop that later becomes `undefined` again returns to the fallback. In legacy mode, as in Svelte 4, the fallback is dropped as soon as the prop has had a value. If the prop is bound and the parent's value is `undefined`, runes mode throws `props_invalid_value`, because a binding with a fallback would otherwise write the fallback back to the parent unexpectedly; legacy mode writes it back.

Sources: [packages/svelte/src/internal/client/reactivity/props.js:283-353](repo://packages/svelte/src/internal/client/reactivity/props.js#L283-L353)

### Writable props

`prop` returns one of three accessors:

Sources: [packages/svelte/src/internal/client/reactivity/props.js:355-430](repo://packages/svelte/src/internal/client/reactivity/props.js#L355-L430)

1. **Read-only.** In runes mode, a prop the child never writes gets the getter alone.
2. **Bound.** When the parent supplied a setter (a `bind:`), or the props object is itself a `$state` proxy or legacy props passed to `mount`, writes call the parent's setter. A mutation of an object prop in a runes child does not call the setter, since the parent's proxy already reports the change; a legacy parent, or a prop backed by a store, is notified anyway.
3. **Locally overridable.** Otherwise the prop is backed by a derived of the getter. Writing sets the derived, which overrides the parent's value until the parent's value changes again and the derived recomputes. Legacy components always take this path, which reproduces Svelte 4's behaviour of ignoring updates to the same primitive value.

Sources: [packages/svelte/src/internal/client/reactivity/props.js:355-430](repo://packages/svelte/src/internal/client/reactivity/props.js#L355-L430)

`update_prop` and `update_pre_prop` implement `count++` and `++count` on prop accessors.

Sources: [packages/svelte/src/internal/client/reactivity/props.js:26-46](repo://packages/svelte/src/internal/client/reactivity/props.js#L26-L46)

## The component context stack

A component that needs one (dev mode, legacy reactivity, exports, lifecycle functions or context) opens with `$.push($$props, runes)` and closes with `$.pop(exports)`. `push` creates a `ComponentContext` and makes it current:

Sources: [packages/svelte/src/internal/client/context.js:136-165](repo://packages/svelte/src/internal/client/context.js#L136-L165), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:451-464](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L451-L464)

| Field | Holds |
| --- | --- |
| `p` | Parent context |
| `c` | Context map for `setContext`/`getContext`, created on demand |
| `e` | Deferred top-level `$effect` callbacks |
| `s` | The props object |
| `x` | The component's exports, set by `pop` |
| `l` | Legacy-mode data: mutable sources, `beforeUpdate`/`afterUpdate`/`onMount` callbacks, `$:` tokens |

Sources: [packages/svelte/src/internal/client/context.js:136-165](repo://packages/svelte/src/internal/client/context.js#L136-L165), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:451-464](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L451-L464)

`pop` creates the deferred effects (so top-level `$effect`s run after the component's DOM is built, see [[Effects and the Effect Tree]]), stores the exports, and restores the parent context. Every reaction remembers the context it was created in (`ctx`) and `update_reaction` restores it, so code inside effects and deriveds can still call `getContext`. `is_runes()` reads the current context to decide whether runes semantics apply, which matters because legacy and runes components can be mixed in one tree.

Sources: [packages/svelte/src/internal/client/context.js:167-195](repo://packages/svelte/src/internal/client/context.js#L167-L195), [packages/svelte/src/internal/client/runtime.js:270-275](repo://packages/svelte/src/internal/client/runtime.js#L270-L275)

## Context API

`setContext(key, value)`, `getContext(key)`, `hasContext(key)` and `getAllContexts()` all go through `get_or_init_context_map`, which throws `lifecycle_outside_component` when no component is initialising. The first call in a component creates its map as a copy of the nearest ancestor's map, so a child sees every key its ancestors set, and its own `setContext` calls shadow them without affecting siblings or the parent.

Sources: [packages/svelte/src/internal/client/context.js:64-131](repo://packages/svelte/src/internal/client/context.js#L64-L131), [packages/svelte/src/internal/client/context.js:196-223](repo://packages/svelte/src/internal/client/context.js#L196-L223)

In async mode, `setContext` must run during the component's synchronous initialisation (in the branch effect's first run, outside any reaction), and throws `set_context_after_init` otherwise, because a context set after an `await` would not be seen by children that were already created. `mount` and `render` accept a `context` map that becomes the root context ([[Mounting and Hydration]], [[Server Rendering Runtime]]).

Sources: [packages/svelte/src/internal/client/context.js:91-105](repo://packages/svelte/src/internal/client/context.js#L91-L105), [packages/svelte/src/internal/client/render.js:220-225](repo://packages/svelte/src/internal/client/render.js#L220-L225)

## Lifecycle functions

The lifecycle functions exported from `svelte` in the browser build are thin wrappers over effects:

Sources: [packages/svelte/src/index-client.js:60-123](repo://packages/svelte/src/index-client.js#L60-L123), [packages/svelte/src/index-client.js:149-248](repo://packages/svelte/src/index-client.js#L149-L248)

| Function | Runes mode | Legacy mode |
| --- | --- | --- |
| `onMount(fn)` | A `user_effect` that runs `fn` untracked and uses a returned function as cleanup | Pushed to `l.u.m`, run by the legacy lifecycle code |
| `onDestroy(fn)` | `onMount(() => () => untrack(fn))`: a cleanup of a mount effect | Same |
| `beforeUpdate`, `afterUpdate` | Throw `lifecycle_legacy_only` | Pushed to `l.u.b` and `l.u.a` |
| `createEventDispatcher()` | Returns a function that calls the matching `$$events` handlers with a `CustomEvent` and reports whether `preventDefault` was called | Same |
| `getAbortSignal()` | Returns the `AbortController` signal of the active derived or effect, aborted with `STALE_REACTION` when it re-runs or is destroyed | Same |

Sources: [packages/svelte/src/index-client.js:60-123](repo://packages/svelte/src/index-client.js#L60-L123), [packages/svelte/src/index-client.js:149-248](repo://packages/svelte/src/index-client.js#L149-L248)

The legacy lifecycle callbacks are run by `init()` in `dom/legacy/lifecycle.js`, described in [[Legacy Component API]]. On the server, `onMount`, `beforeUpdate` and `afterUpdate` are no-ops and `onDestroy` callbacks run at the end of `render` ([[Server Rendering Runtime]]).

Sources: [packages/svelte/src/internal/client/dom/legacy/lifecycle.js:1-30](repo://packages/svelte/src/internal/client/dom/legacy/lifecycle.js#L1-L30), [packages/svelte/src/index-server.js:6-18](repo://packages/svelte/src/index-server.js#L6-L18)
