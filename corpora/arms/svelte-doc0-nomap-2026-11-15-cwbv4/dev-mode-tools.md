---
title: "Dev Mode Tools"
---
## Overview

Svelte has two notions of "dev". The compiler's `dev` option makes the generated code call extra helpers (`$.inspect`, `$.trace`, `$.add_locations`, ownership checks). The runtime additionally branches on `DEV` from `esm-env`, which bundlers resolve to `true` under the `development` export condition and `false` in production builds, so dev-only branches and their warning messages are removed from production bundles ([[Errors and Warnings]]). The helpers live in `internal/client/dev/`.

Sources: [packages/svelte/src/internal/client/index.js:1-13](repo://packages/svelte/src/internal/client/index.js#L1-L13), [packages/svelte/src/compiler/phases/3-transform/utils.js:459-481](repo://packages/svelte/src/compiler/phases/3-transform/utils.js#L459-L481)

## $inspect

`$inspect(a, b)` compiles to `$.inspect(() => [a, b])` in dev and to nothing in production; `$inspect(...).with(fn)` passes `fn` as the inspector. `inspect` creates an *inspect effect*, which differs from normal effects in that it runs synchronously when a dependency is written: `mark_reactions` collects inspect effects and `internal_set` flushes them immediately, so the logged stack trace points at the code that changed the value ([[Signals and Dependency Tracking]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/utils.js:459-481](repo://packages/svelte/src/compiler/phases/3-transform/utils.js#L459-L481), [packages/svelte/src/internal/client/dev/inspect.js:6-35](repo://packages/svelte/src/internal/client/dev/inspect.js#L6-L35), [packages/svelte/src/internal/client/reactivity/sources.js:226-262](repo://packages/svelte/src/internal/client/reactivity/sources.js#L226-L262)

Each run snapshots the values deeply (so the log shows the state at that moment, and nested mutations are tracked) and calls the inspector with `'init'` or `'update'` followed by the values. Because the effect runs before blocks update, reading a value can throw (as in `$inspect(obj.prop)` inside an `{#if obj}` that is about to be removed); the error is stored, and a companion render effect logs it only if it runs too, meaning the `$inspect` was not destroyed.

Sources: [packages/svelte/src/internal/client/dev/inspect.js:17-55](repo://packages/svelte/src/internal/client/dev/inspect.js#L17-L55)

## $inspect.trace

`$inspect.trace(label?)` must be the first statement of a function. The analyzer records a label (the given one, or the function's name and source location) on the function's scope and sets `analysis.tracing`, which makes the module import `svelte/internal/flags/tracing`. The client `BlockStatement` visitor then wraps the function body: `return $.trace(() => label, () => { ...body })`.

Sources: [packages/svelte/src/compiler/phases/2-analyze/visitors/CallExpression.js:188-224](repo://packages/svelte/src/compiler/phases/2-analyze/visitors/CallExpression.js#L188-L224), [packages/svelte/src/compiler/phases/3-transform/client/visitors/BlockStatement.js:10-32](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/BlockStatement.js#L10-L32)

`trace(label, fn)` runs `fn` with a `tracing_expressions` map active and times it. Every `get` performed by the reaction under trace records the signal and a stack trace in that map ([[Signals and Dependency Tracking]]). Afterwards it logs a console group listing each signal read, typed as `$state`, `$derived` or `store`, highlighted in blue when it changed since the reaction last ran, with its value (snapshotted for proxies), the stack where it was created, the stacks where it was updated, and the stacks where it was read. Deriveds expand to their own dependencies. When called outside an effect, or with no reactive reads, it says so instead.

Sources: [packages/svelte/src/internal/client/dev/tracing.js:15-130](repo://packages/svelte/src/internal/client/dev/tracing.js#L15-L130), [packages/svelte/src/internal/client/runtime.js:607-640](repo://packages/svelte/src/internal/client/runtime.js#L607-L640)

That information exists because, with the tracing flag on, `source()` stores a `CreatedAt` stack on every signal and `internal_set` an `UpdatedAt` stack per distinct call site. `get_stack` builds these by creating an `Error` and removing frames from `svelte/src/internal`, naming the error after its label so devtools render it as a stack. Names come from `tag(source, label)`, which the compiler emits in dev as `$.tag($.state(0), 'count')`; `tag_proxy` passes the label to a proxy so its properties are named by path (`todos[0].done`).

Sources: [packages/svelte/src/internal/client/dev/tracing.js:132-205](repo://packages/svelte/src/internal/client/dev/tracing.js#L132-L205), [packages/svelte/src/internal/client/reactivity/sources.js:59-84](repo://packages/svelte/src/internal/client/reactivity/sources.js#L59-L84), [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:140-150](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L140-L150)

## Hot module replacement

With the `hmr` option, the compiler wraps the component: `App = $.hmr(App, () => App[$.HMR].source)`, and adds an `import.meta.hot.accept` handler. `hmr(original, get_source)` returns a wrapper component that renders whatever component the source currently holds, inside a transparent block. The wrapper stores `{ original, source }` under the `HMR` symbol.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:534-564](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L534-L564), [packages/svelte/src/internal/client/dev/hmr.js:10-78](repo://packages/svelte/src/internal/client/dev/hmr.js#L10-L78)

When a module update is accepted, the new module's wrapper adopts the old wrapper's source, and the handler sets that source to the new module's original component. Every mounted instance re-renders: the block destroys its branch and creates a new one with the new component, with intro transitions suppressed, and copies the new instance's property descriptors onto the same exports object so references held by parents stay valid. If the component has scoped CSS, `cleanup_styles(hash)` removes the old `<style>` elements first; `register_style` records every injected style element per hash for that purpose.

Sources: [packages/svelte/src/internal/client/dev/hmr.js:15-63](repo://packages/svelte/src/internal/client/dev/hmr.js#L15-L63), [packages/svelte/src/internal/client/dev/css.js:1-31](repo://packages/svelte/src/internal/client/dev/css.js#L1-L31)

## Ownership warnings

In runes mode, a child should not mutate state that a parent passed down without `bind:`. When the analyzer finds a mutation of a prop's property, the component gets `$$ownership_validator = $.create_ownership_validator($$props)`. Its `mutation(prop, path, result, line, column)` check passes when the prop is bound (its descriptor has a setter), when it was not passed at all, or when there is no parent component; otherwise it follows the path and, if every object along it is a `$state` proxy, warns with `ownership_invalid_mutation`, naming both files. `binding(key, child, value)` warns with `ownership_invalid_binding` when a component binds a child to state it received from its own parent without binding it.

Sources: [packages/svelte/src/internal/client/dev/ownership.js:10-81](repo://packages/svelte/src/internal/client/dev/ownership.js#L10-L81), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:406-410](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L406-L410)

## Other dev checks

| Helper | What it catches |
| --- | --- |
| `log_if_contains_state` | `console.log(...)` and similar calls with arguments the compiler cannot evaluate are rewritten to pass through it; if any argument is a `$state` proxy it warns with `console_log_state` and logs a `[snapshot]` of the values, since a proxy shows up in the console as an opaque `Proxy` |
| `strict_equals`, `equals` | `===`, `==` and their negations, warning when comparing a proxy with a raw value would give a different result (`state_proxy_equality_mismatch`) |
| `init_array_prototype_warnings` | Patches `indexOf`, `lastIndexOf` and `includes` to warn when the search fails only because the array holds proxies of the searched object |
| `assign`, `assign_and`, `assign_or`, `assign_nullish` | Wrap assignments in expressions such as `(obj.list = []).push(x)` and warn with `assignment_value_stale` when the assigned value is not what reading the property returns (because the proxy stored a copy) |
| `add_locations` | Stores `{ file, line, column }` on every element created from a template as `__svelte_meta`, used by error messages and devtools |
| `check_target`, `legacy_api` | Error on `new Component(...)` and on calling Svelte 4 methods (`$set`, `$on`, `$destroy`) on a Svelte 5 component |
| `validate_snippet_args` | Rejects snippets called with the wrong argument shape |

Sources: [packages/svelte/src/internal/client/dev/console-log.js:1-35](repo://packages/svelte/src/internal/client/dev/console-log.js#L1-L35), [packages/svelte/src/compiler/phases/3-transform/client/visitors/CallExpression.js:74-100](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/CallExpression.js#L74-L100), [packages/svelte/src/internal/client/dev/equality.js:1-101](repo://packages/svelte/src/internal/client/dev/equality.js#L1-L101), [packages/svelte/src/internal/client/dev/assign.js:1-40](repo://packages/svelte/src/internal/client/dev/assign.js#L1-L40), [packages/svelte/src/internal/client/dev/elements.js:7-30](repo://packages/svelte/src/internal/client/dev/elements.js#L7-L30), [packages/svelte/src/internal/client/dev/legacy.js:1-25](repo://packages/svelte/src/internal/client/dev/legacy.js#L1-L25), [packages/svelte/src/internal/client/dev/validation.js:1-16](repo://packages/svelte/src/internal/client/dev/validation.js#L1-L16)

`init_operations` installs the array patches once, in dev, when the first component mounts; a cleanup function stored on `Array` lets repeated installs (as in an online REPL) remove the previous patches first.

Sources: [packages/svelte/src/internal/client/dom/operations.js:68-76](repo://packages/svelte/src/internal/client/dom/operations.js#L68-L76), [packages/svelte/src/internal/client/dev/equality.js:4-70](repo://packages/svelte/src/internal/client/dev/equality.js#L4-L70)

`dev/debug.js` contains `log_effect_tree(effect)`, an internal debugging aid that prints the effect tree with each effect's flags and dependencies; nothing in the runtime calls it.

Sources: [packages/svelte/src/internal/client/dev/debug.js:15-119](repo://packages/svelte/src/internal/client/dev/debug.js#L15-L119)
