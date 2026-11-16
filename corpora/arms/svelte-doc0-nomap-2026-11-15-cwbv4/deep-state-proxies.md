---
title: "Deep State Proxies"
---
## Overview

`let todos = $state([{ done: false }])` makes the array and every object inside it reactive: `todos[0].done = true` and `todos.push(...)` update the UI without reassigning `todos`. This works because `$state` wraps plain objects and arrays in a JavaScript `Proxy` created by `proxy()` in `internal/client/proxy.js`. The proxy keeps one source signal per property it has seen, creates them lazily on first access, and turns reads and writes into `get` and `set` calls on those sources ([[Signals and Dependency Tracking]]).

Sources: [packages/svelte/src/internal/client/proxy.js:34-112](repo://packages/svelte/src/internal/client/proxy.js#L34-L112)

## When values are proxied

The compiler decides when to call `$.proxy`. `should_proxy` returns `false` for values that can never be objects (literals, template strings, functions, unary and binary expressions, `undefined`) and follows an identifier to its initial value when the variable is never reassigned. Everything else is passed through `$.proxy` at declaration, and assignments to `$state` variables pass `true` as the third argument of `$.set` so the assigned value is proxied too ([[Client Code Generation]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/client/utils.js:250-287](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L250-L287), [packages/svelte/src/compiler/phases/3-transform/client/visitors/AssignmentExpression.js:88-100](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/AssignmentExpression.js#L88-L100)

At runtime, `proxy(value)` returns the value unchanged unless it is a non-null object whose prototype is exactly `Object.prototype` or `Array.prototype`, and that is not already a proxy (the `STATE_SYMBOL` check). Class instances, `Map`, `Set`, `Date` and DOM nodes are left alone; reactive versions of the built-ins are provided separately by [[Reactive Built-ins]], and classes get reactivity through `$state` fields.

Sources: [packages/svelte/src/internal/client/proxy.js:39-49](repo://packages/svelte/src/internal/client/proxy.js#L39-L49)

`$state.raw(value)` skips all of this: the variable is a single source holding the value as-is, so only reassignment is reactive. `set(source, value, should_proxy)` is the same function in both cases; the flag is simply not passed for raw state.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:126-152](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L126-L152), [packages/svelte/src/internal/client/reactivity/sources.js:136-163](repo://packages/svelte/src/internal/client/reactivity/sources.js#L136-L163)

## Inside the proxy

### Per-property sources

Each proxy closes over:

Sources: [packages/svelte/src/internal/client/proxy.js:51-92](repo://packages/svelte/src/internal/client/proxy.js#L51-L92)

- `sources`, a `Map` from property key to its source signal.
- `version`, a source incremented whenever a key is added or deleted, which `ownKeys` reads so that `Object.keys(obj)` and `for...in` re-run when the set of keys changes.
- For arrays, a pre-created `length` source.

Sources: [packages/svelte/src/internal/client/proxy.js:51-92](repo://packages/svelte/src/internal/client/proxy.js#L51-L92)

The traps translate operations:

Sources: [packages/svelte/src/internal/client/proxy.js:112-198](repo://packages/svelte/src/internal/client/proxy.js#L112-L198), [packages/svelte/src/internal/client/proxy.js:200-257](repo://packages/svelte/src/internal/client/proxy.js#L200-L257), [packages/svelte/src/internal/client/proxy.js:259-353](repo://packages/svelte/src/internal/client/proxy.js#L259-L353)

| Trap | Behaviour |
| --- | --- |
| `get` | Returns the raw target for `STATE_SYMBOL`. Otherwise finds or creates the property's source, proxying the current value when creating it, and returns `get(source)`. Non-writable existing properties are read straight from the target. |
| `set` | Finds or creates the source and calls `set(source, proxy(value))`. A key that did not exist increments `version`, and for arrays an index at or past `length` extends the `length` source. Setting `length` on an array marks every source past the new length as removed. Property setters on the target are still invoked. |
| `has` | Reads the property's source when inside an effect, so `'key' in obj` is reactive, creating a source for a missing key so its later addition is noticed. |
| `deleteProperty` | Sets the source to the `UNINITIALIZED` sentinel and increments `version`. |
| `ownKeys` | Reads `version`, then returns the target's keys minus deleted ones plus keys that only exist as sources. |
| `getOwnPropertyDescriptor` | Fills `value` from the source, and fakes a descriptor for keys that only exist as sources. |
| `defineProperty` | Only plain writable, enumerable, configurable data descriptors are allowed (`state_descriptors_fixed` otherwise). |
| `setPrototypeOf` | Always throws `state_prototype_fixed`. |

Sources: [packages/svelte/src/internal/client/proxy.js:112-198](repo://packages/svelte/src/internal/client/proxy.js#L112-L198), [packages/svelte/src/internal/client/proxy.js:200-257](repo://packages/svelte/src/internal/client/proxy.js#L200-L257), [packages/svelte/src/internal/client/proxy.js:259-353](repo://packages/svelte/src/internal/client/proxy.js#L259-L353)

The target object itself is never written to; values live in the sources, and `UNINITIALIZED` marks keys that were deleted or have not been set. Nested objects are proxied lazily, on first read or on write, so a large structure costs nothing until it is used.

Sources: [packages/svelte/src/internal/client/proxy.js:173-197](repo://packages/svelte/src/internal/client/proxy.js#L173-L197), [packages/svelte/src/internal/client/proxy.js:286-303](repo://packages/svelte/src/internal/client/proxy.js#L286-L303)

### Creating sources in the right reaction

A proxy may be created inside a derived and read later somewhere else. Sources created while a reaction runs are normally treated as owned by it ([[Signals and Dependency Tracking]]), which would make later writes look like the reaction's own local state. `with_parent` avoids this: it remembers the `update_version` current when the proxy was made and, when a trap creates a source during a different reaction run, temporarily clears `active_reaction` and restores that version so the new source belongs to the proxy's original context.

Sources: [packages/svelte/src/internal/client/proxy.js:56-83](repo://packages/svelte/src/internal/client/proxy.js#L56-L83), [packages/svelte/src/internal/client/runtime.js:84-100](repo://packages/svelte/src/internal/client/runtime.js#L84-L100)

## Identity

A proxy is a different object from the value it wraps, so `proxied === original` is false. `get_proxied_value` unwraps a proxy through `STATE_SYMBOL`, and `is(a, b)` compares unwrapped values. In dev, the compiler rewrites `===`, `!==`, `==` and `!=` into `$.strict_equals` and `$.equals`, which compute the normal result but warn with `state_proxy_equality_mismatch` when comparing the unwrapped values would give a different answer, which usually means code compares a proxy with the object it was created from.

Sources: [packages/svelte/src/internal/client/proxy.js:365-392](repo://packages/svelte/src/internal/client/proxy.js#L365-L392), [packages/svelte/src/compiler/phases/3-transform/client/visitors/BinaryExpression.js:10-34](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/BinaryExpression.js#L10-L34), [packages/svelte/src/internal/client/dev/equality.js:77-101](repo://packages/svelte/src/internal/client/dev/equality.js#L77-L101)

## Dev-only behaviour

In dev, each proxy can report a path such as `todos[0].done`: `update_path` (reached through `PROXY_PATH_SYMBOL`) labels the version source and every property source, and `get_label` formats keys as `.name`, `[0]` or `['odd key']`. These labels appear in `$inspect.trace()` output ([[Dev Mode Tools]]).

Sources: [packages/svelte/src/internal/client/proxy.js:94-110](repo://packages/svelte/src/internal/client/proxy.js#L94-L110), [packages/svelte/src/internal/client/proxy.js:355-363](repo://packages/svelte/src/internal/client/proxy.js#L355-L363)

Arrays are additionally wrapped by `inspectable_array`, which intercepts mutating methods (`push`, `splice`, `sort`, ...) so that `$inspect` effects are deferred until the method finishes, and an array is never logged half-way through an operation.

Sources: [packages/svelte/src/internal/client/proxy.js:394-431](repo://packages/svelte/src/internal/client/proxy.js#L394-L431)

## Snapshots

`$state.snapshot(value)` compiles to `$.snapshot`, from `internal/shared/clone.js`, which returns a plain, non-reactive deep copy. Reading through the proxy during the copy also makes the caller depend on every property it copied.

Sources: [packages/svelte/src/internal/client/index.js:170-170](repo://packages/svelte/src/internal/client/index.js#L170-L170), [packages/svelte/src/internal/shared/clone.js:14-45](repo://packages/svelte/src/internal/shared/clone.js#L14-L45)

`clone` handles each kind of value:

Sources: [packages/svelte/src/internal/shared/clone.js:47-137](repo://packages/svelte/src/internal/shared/clone.js#L47-L137)

- Arrays and plain objects are copied recursively, with a `cloned` map so shared and circular references are preserved in the copy.
- `Map` and `Set` are copied shallowly, and `Date` through `structuredClone`.
- An object with `toJSON()` is replaced by the clone of its result (unless `no_tojson` is set).
- `EventTarget`s, such as DOM elements, are returned as they are.
- Anything else goes through `structuredClone`; if that throws, the original value is kept.

Sources: [packages/svelte/src/internal/shared/clone.js:47-137](repo://packages/svelte/src/internal/shared/clone.js#L47-L137)

In dev, `snapshot` collects the paths of values that could not be cloned and warns with `state_snapshot_uncloneable`, listing up to ten of them. A `svelte-ignore state_snapshot_uncloneable` comment makes the compiler pass `skip_warning` ([[Errors and Warnings]]).

Sources: [packages/svelte/src/internal/shared/clone.js:21-45](repo://packages/svelte/src/internal/shared/clone.js#L21-L45), [packages/svelte/src/compiler/phases/3-transform/client/visitors/CallExpression.js:54-60](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/CallExpression.js#L54-L60)
