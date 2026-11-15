---
title: "Server Code Generation"
---
## Overview

With `generate: 'server'`, phase 3 emits a component that produces HTML instead of DOM. The output imports `* as $` from `svelte/internal/server` and exports `function Component($$payload, $$props)`, whose body pushes template-literal strings into `$$payload.out`. There are no signals, effects or event handlers: the code runs once per request, so reactive declarations collapse to plain values and anything that only matters after mount is dropped. What remains is HTML plus comment markers that let the client [[Mounting and Hydration]] code adopt the markup.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:91-110](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L91-L110), [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:303-315](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L303-L315)

For the same component as in [[Client Code Generation]], the server output is a single push with each expression escaped:

Sources: [packages/svelte/tests/snapshot/samples/text-nodes-deriveds/index.svelte:1-14](repo://packages/svelte/tests/snapshot/samples/text-nodes-deriveds/index.svelte#L1-L14)

```js
import * as $ from 'svelte/internal/server';

export default function Text_nodes_deriveds($$payload) {
	let count1 = 0;
	let count2 = 0;

	function text1() {
		return count1;
	}

	function text2() {
		return count2;
	}

	$$payload.out.push(`<p>${$.escape(text1())}${$.escape(text2())}</p>`);
}
```

Sources: [packages/svelte/tests/snapshot/samples/text-nodes-deriveds/_expected/server/index.svelte.js:1-16](repo://packages/svelte/tests/snapshot/samples/text-nodes-deriveds/_expected/server/index.svelte.js#L1-L16)

The runtime functions this code calls (`$.escape`, `$.attr`, `$.head`, `render` itself) are covered in [[Server Rendering Runtime]].

Sources: [packages/svelte/src/internal/server/index.js:61-116](repo://packages/svelte/src/internal/server/index.js#L61-L116)

## Assembling the component

### Walks and body

`server_component` uses two visitor sets. `global_visitors` handle JavaScript (assignments, calls, identifiers, `$:` statements, class bodies, variable declarations) and are used for every walk; `template_visitors` handle markup and are added for the template walk. The module script, the instance script and the template are walked in turn. Imports found in the instance script are moved into `state.hoisted` so they end up at module level, and `export` keywords are stripped from instance declarations.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:46-61](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L46-L61), [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:91-139](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L91-L139)

The component body is the instance code followed by the template code, with these additions:

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:265-270](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L265-L270)

- Legacy `$:` statements run once, in their sorted order, after a `let` for each name they declare.
- If the component uses store subscriptions, `var $$store_subs` is declared and `$.unsubscribe_stores($$store_subs)` runs at the end.
- `$.bind_props($$props, { ... })` writes bindable props and exports back to the parent's props object, so a parent that binds to a child sees the child's value.
- `$.push()`/`$.pop()` wrap the body in dev mode or when the component uses context.
- `$$sanitized_props`, `$$restProps` and `$$slots` are created when used, and `$props.id()` becomes `$.props_id($$payload)` as the first statement.
- With `css: 'injected'`, `$$payload.css.add($$css)` registers the stylesheet ([[Scoped CSS]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:141-171](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L141-L171), [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:204-301](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L204-L301)

### Settling legacy bindings

In legacy mode a child can change a bound prop during render, which may change what the parent renders. When the analysis saw component bindings (`uses_component_bindings`), the template is wrapped in a loop: it renders into a copy of the payload with `$.copy_payload`, repeats while `$$settled` is false (a binding update sets it back), and finally copies the result into the real payload with `$.assign_payload`. Snippet functions are kept outside the loop.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:173-202](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L173-L202)

### Exports and compatibility

With `compatibility.componentApi: 4` the module imports `render` from `svelte/server` and attaches a `Component.render(props, opts)` method, matching the Svelte 4 server API. In dev mode without that option, `Component.render` throws an error that points to the migration guide. Dev mode also sets `Component[$.FILENAME]`.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:317-381](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L317-L381)

## Runes on the server

Without reactivity, most runes reduce to their argument:

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js:84-105](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js#L84-L105)

| Source | Server output |
| --- | --- |
| `let x = $state(v)`, `$state.raw(v)` | `let x = v` |
| `let d = $derived(expr)` | `let d = expr` |
| `let d = $derived.by(fn)` | `let d = fn()` |
| `$derived(...)` elsewhere (class fields) | `$.derived(() => ...)` |
| `$effect(...)`, `$effect.pre(...)`, `$inspect.trace()` statements | removed |
| `$effect.root(fn)` | `() => {}` |
| `$effect.tracking()` | `false` |
| `$effect.pending()` | `0` |
| `$host()` | `void 0` |
| `$state.snapshot(v)` | `$.snapshot(v)` |
| `let { a = $bindable(1), ...rest } = $props()` | `let { a = 1, $$slots, $$events, ...rest } = $$props` |

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js:25-105](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js#L25-L105), [packages/svelte/src/compiler/phases/3-transform/server/visitors/CallExpression.js:12-54](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/CallExpression.js#L12-L54), [packages/svelte/src/compiler/phases/3-transform/server/visitors/ExpressionStatement.js:10-23](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/ExpressionStatement.js#L10-L23)

The `$props()` rewrite adds `$$slots` and `$$events` to an object pattern with a rest element, so internal props never leak into `...rest`. In legacy mode, `export let` declarations become reads from `$$props` with their defaults.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js:43-81](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js#L43-L81), [packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js:107-140](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/VariableDeclaration.js#L107-L140)

Store subscriptions are the one reactive read that survives: `build_getter` turns `$count` into `$.store_get($$store_subs ??= {}, '$count', count)`, which subscribes once, reads the current value and records the unsubscribe function ([[Stores]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js:240-259](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js#L240-L259)

## From markup to strings

### Building the template

Each `Fragment` visit creates a state with an `init` list for statements and a `template` list that mixes string literals, expressions and statements. `process_children` collects runs of text, comments and expression tags into one template literal: text is HTML-escaped at compile time, expressions become `$.escape(expr)`, and expressions that `scope.evaluate` resolves to a constant are escaped and inlined. Other nodes are visited and push their own parts.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/Fragment.js:11-46](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/Fragment.js#L11-L46), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js:30-86](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js#L30-L86)

`build_template` then merges the list: adjacent literals and template literals are concatenated into one template string, and every statement in between flushes the current string as a `$$payload.out.push(...)`. That is why a static subtree with dynamic text becomes a single push.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js:96-175](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js#L96-L175)

### Elements and attributes

`RegularElement` pushes `<name`, the attributes, `>` (or `/>` for void elements), the children and `</name>`. In dev mode it brackets the children with `$.push_element`/`$.pop_element` so the runtime can report invalid nesting with a source location. `build_element_attributes` decides per attribute:

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js:30-32](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js#L30-L32)

- Event handlers are dropped, except `onload` and `onerror` on elements that can fire them before hydration (`img`, `script`, `link`, `iframe` and the others in `LOAD_ERROR_ELEMENTS`): those get `onload="this.__e=event"` so the client can replay the event.
- `bind:` directives become attributes with the bound value, except bindings marked `omit_in_ssr` in the binding table; `bind:group` becomes a computed `checked`.
- Literal values are escaped at compile time and written directly, with the scoping class appended to `class`.
- Dynamic values become `$.attr(name, value, is_boolean)`; `class` with `class:` directives becomes a class helper call and `style` with `style:` directives a style helper call; spreads go through `$.spread_attributes`.
- `<option value>` adds `$.maybe_selected($$payload, value)` so the option matching the enclosing `<select>`'s value is rendered `selected`.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js:17-70](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js#L17-L70), [packages/svelte/src/utils.js:279-297](repo://packages/svelte/src/utils.js#L279-L297), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js:33-120](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js#L33-L120), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js:180-205](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js#L180-L205), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js:250-310](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/element.js#L250-L310)

## Hydration markers

The client needs to know where each block's content starts and ends in the server HTML. The server output brackets every block with comments built from the shared constants: `<!--[-->` opens a block, `<!--[!-->` opens the "else" branch of a block, `<!--]-->` closes it, and `<!---->` is an empty separator.

Sources: [packages/svelte/src/internal/server/hydration.js:1-6](repo://packages/svelte/src/internal/server/hydration.js#L1-L6), [packages/svelte/src/constants.js:23-27](repo://packages/svelte/src/constants.js#L23-L27), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js:16-22](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/utils.js#L16-L22)

`IfBlock` shows the pattern. Each branch pushes its own opening marker, so the client can tell from the HTML which branch the server took, and the block is followed by the closing marker:

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js:20-28](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js#L20-L28)

```js
consequent.body.unshift(
	b.stmt(b.call(b.member(b.id('$$payload.out'), b.id('push')), block_open))
);

alternate.body.unshift(
	b.stmt(b.call(b.member(b.id('$$payload.out'), b.id('push')), b.literal(BLOCK_OPEN_ELSE)))
);

context.state.template.push(b.if(test, consequent, alternate), block_close);
```

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js:12-29](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js#L12-L29)

`EachBlock` becomes a plain `for` loop over `$.ensure_array_like(collection)` between `<!--[-->` and `<!--]-->`, and with an `{:else}` it opens with `<!--[!-->` when the array is empty. Components are called as `Child($$payload, props)` followed by `<!---->` (and preceded by one when dynamic), unless the parent fragment is standalone; components with `--css-props` go through `$.css_props`, which adds the wrapper element.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/EachBlock.js:12-66](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/EachBlock.js#L12-L66), [packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/component.js:288-317](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/shared/component.js#L288-L317)

A fragment whose first node is text gets a leading `<!---->`, so the browser's parser does not merge that text with text from a preceding fragment into one node that the client could not split back.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/Fragment.js:38-41](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/Fragment.js#L38-L41)

## Modules

`server_module` walks a `.svelte.js` module with the global visitors only, so `$state` and `$derived` collapse as above and `$effect` statements disappear, and prepends the `svelte/internal/server` import.

Sources: [packages/svelte/src/compiler/phases/3-transform/server/transform-server.js:388-415](repo://packages/svelte/src/compiler/phases/3-transform/server/transform-server.js#L388-L415)
