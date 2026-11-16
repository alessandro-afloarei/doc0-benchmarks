---
title: "Client Code Generation"
---
## Overview

With `generate: 'client'`, phase 3 turns the `ComponentAnalysis` into an ESTree program that imports `* as $` from `svelte/internal/client` and exports the component as a function `Component($$anchor, $$props)`. The function clones a static HTML template, finds the nodes it must update, and wraps every dynamic part in an effect or block call from the runtime. `client_component` in `transform-client.js` drives this; the work per node is done by a visitor set under `client/visitors/`, and code is assembled with the AST builders in `utils/builders.js`. [[Compiler Pipeline]] prints the result with esrap.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:146-176](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L146-L176), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:528-554](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L528-L554)

This snapshot test shows the shape of the output for `<p>{text1()}{text2()}</p>`: a hoisted template, the cloned root, a text node located with `$.child`, and a `$.template_effect` whose dependencies are the memoised calls `$0` and `$1`.

Sources: [packages/svelte/tests/snapshot/samples/text-nodes-deriveds/index.svelte:1-14](repo://packages/svelte/tests/snapshot/samples/text-nodes-deriveds/index.svelte#L1-L14)

```js
var root = $.from_html(`<p> </p>`);

export default function Text_nodes_deriveds($$anchor) {
	let count1 = 0;
	let count2 = 0;

	function text1() {
		return count1;
	}

	function text2() {
		return count2;
	}

	var p = root();
	var text = $.child(p);

	$.reset(p);
	$.template_effect(($0, $1) => $.set_text(text, `${$0 ?? ''}${$1 ?? ''}`), [text1, text2]);
	$.append($$anchor, p);
}
```

Sources: [packages/svelte/tests/snapshot/samples/text-nodes-deriveds/_expected/client/index.svelte.js:4-24](repo://packages/svelte/tests/snapshot/samples/text-nodes-deriveds/_expected/client/index.svelte.js#L4-L24)

## Assembling the component

`client_component` creates one transform state and walks three ASTs with the same visitors: the module script, the instance script (with `is_instance: true`), and the template (with the template scopes). Each walk returns transformed code; the template walk's `Fragment` visitor also pushes template constants and helper functions to `state.hoisted`, which end up at module level.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:146-213](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L146-L213)

The component body is then built in a fixed order around the instance code and the template code:

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:357-367](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L357-L367)

| Part | When it is added |
| --- | --- |
| `$.push($$props, runes)` ... `$.pop($$exports)` | When the component needs a component context: dev mode, `analysis.needs_context`, legacy `$:` statements, or exports |
| `$.setup_stores()` and a getter per `$store` | When the component auto-subscribes to stores; `$$cleanup()` runs last |
| `$.mutable_source()` for each `$:`-declared name | Legacy mode |
| Sorted `$:` statements, then `$.legacy_pre_effect_reset()` | Legacy mode, in the order from [[Component Analysis]] |
| `$$exports` object with getters and setters | Component exports, accessors, and the `$set`/`$on` methods for `componentApi: 4` |
| `$.init()` | Legacy components that need a context |
| `$.append_styles($$anchor, $$css)` | Injected CSS ([[Scoped CSS]]) |
| `$$sanitized_props`, `$$restProps`, `$$slots` | When the component uses `$$props`, `$$restProps` or `$$slots` |
| `const id = $.props_id()` | `$props.id()`, as the first statement so hydration sees it first |

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:215-268](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L215-L268), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:280-367](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L280-L367), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:439-512](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L439-L512), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:610-613](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L610-L613)

When the instance script contains a top-level `await`, the instance and template code move into `$.async_body(async () => { ... })`, with an `if ($.aborted()) return;` between them so a component destroyed while waiting stops before building DOM ([[Error Boundaries and Async Rendering]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:369-385](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L369-L385)

Finally the module is assembled: imports first, then module-level snippets, then the module body and hoisted declarations, then the component. Extra statements follow it: `$.delegate([...])` listing the delegated event names, `App[$.FILENAME] = ...` in dev, the `import.meta.hot.accept` block when `hmr` is on ([[Dev Mode Tools]]), and `$.create_custom_element(...)`/`customElements.define` for custom elements ([[Custom Elements]]). The side-effect flag imports described in the [[Svelte Overview]] are prepended.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:514-569](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L514-L569), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:576-620](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L576-L620), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:621-698](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L621-L698)

## Rewriting reads and writes

### The transform map

Signals are objects, so every read of a reactive variable must become `$.get(x)` and every write `$.set(x, v)`. The transform does this with `state.transform`, a map from variable name to functions `read`, `assign`, `mutate` and `update`. The `Identifier` visitor calls `build_getter`, which applies `read` to any reference (not the declaration itself); the `AssignmentExpression` and `UpdateExpression` visitors call the other three.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Identifier.js:11-41](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Identifier.js#L11-L41), [packages/svelte/src/compiler/phases/3-transform/client/utils.js:31-47](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L31-L47)

The `Program` visitor fills the map for the bindings of each script:

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js:11-16](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js#L11-L16)

| Binding | `read` | `assign` / `update` |
| --- | --- | --- |
| `state`, `raw_state` that is a source, `derived`, `legacy_reactive` | `$.get(x)` (`$.safe_get` for `var`) | `$.set(x, v)`, `$.update(x)` / `$.update_pre(x)` |
| `prop`, `bindable_prop` backed by `$.prop` | `x()` | `x(v)`, `$.update_prop(x)` |
| Other props | `$$props.name` | |
| `store_sub` (`$count`) | `$count()` | `$.store_set(count, v)`, `$.update_store(...)` |
| Mutated instance import (legacy) | `$$_import_x()` via `$.reactive_import` | |

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js:43-136](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Program.js#L43-L136), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/declarations.js:14-53](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/declarations.js#L14-L53)

A `$state` binding is only a source when `is_state_source` says so: it must be reassigned, or the component must be in legacy (non-immutable) mode or compiled with accessors. A `$state` that is never reassigned keeps its plain value or its proxy, which is why `let count1 = $state(0)` compiles to `let count1 = 0` above. The catch-all visitor removes entries for `normal` bindings and such non-source state when it enters a scope that shadows them.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/utils.js:19-29](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L19-L29), [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:66-87](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L66-L87)

### Declarations

`VariableDeclaration` rewrites rune declarations. `$state(v)` becomes `$.state($.proxy(v))` when `v` is an object or array literal that should be deeply reactive and the variable is a source; `$.proxy(v)` alone when it is not a source; `$.state(v)` for primitives. `$state.raw` skips the proxy. `$derived(expr)` becomes `$.derived(() => expr)`, `$derived.by(fn)` becomes `$.derived(fn)`, and a derived that contains `await` becomes `(await $.save($.async_derived(async () => expr)))()`. Destructured declarations go through a temporary and per-path deriveds. In dev, sources and proxies are wrapped in `$.tag(..., 'name')` for tracing. In legacy mode, reactive `let` variables become `$.mutable_source(v)`.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:123-196](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L123-L196), [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:198-240](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L198-L240), [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:399-439](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L399-L439)

`$props()` destructuring becomes one `$.prop($$props, 'name', flags, fallback)` per prop (built by `get_prop_source`, with flags such as bindable, runes and lazy initial value) and `$.rest_props` for the rest, which is what [[Props and Component Context]] implements. Functions that only reference module-level or imported values are hoisted out of the component so they are created once.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js:30-121](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/VariableDeclaration.js#L30-L121), [packages/svelte/src/compiler/phases/3-transform/client/utils.js:200-229](repo://packages/svelte/src/compiler/phases/3-transform/client/utils.js#L200-L229)

## From markup to template and effects

### Fragments

Every `Fragment` (the component root, each block branch, each snippet body) becomes one block of statements. `Fragment` cleans whitespace with `clean_nodes`, then sets up a fresh state with four statement lists and two helpers:

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js:29-75](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js#L29-L75)

- `init`: statements that run once when the fragment is created, such as locating nodes and adding listeners.
- `update`: statements that must re-run when state changes; they end up inside one `$.template_effect`.
- `after_update`: statements that must run after the update effect is created, such as bindings and actions.
- `consts`: `{@const}` declarations.
- `template`: a `Template` object that records the static HTML as elements, text and comments.
- `memoizer`: expressions with calls or `await` that should be computed once per update and passed in as `$0`, `$1`, ...

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js:16-75](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js#L16-L75)

The shape of the fragment decides how it is created. A single element gets its own template, cloned into a variable named after the tag. A lone text node uses `$.text('...')`. Text mixed with expression tags uses an empty `$.text()` filled in by `set_text`. Several nodes become a document fragment template (flag `TEMPLATE_FRAGMENT`) reached with `$.first_child`; a fragment made only of a block uses the parent's anchor directly. The fragment ends with `$.append($$anchor, node)`, which inserts the nodes before the anchor (or claims them during hydration, see [[Mounting and Hydration]]).

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js:77-184](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/Fragment.js#L77-L184)

`transform_template` turns the recorded `Template` into the hoisted call. By default it is `$.from_html(html)` (or `$.from_svg`/`$.from_mathml`), an HTML string the runtime parses once and clones per instance. With `fragments: 'tree'` it is `$.from_tree(...)`, a nested array the runtime turns into nodes with DOM calls, which avoids `innerHTML` for environments with strict content-security policies. A template containing `<script>` is wrapped in `$.with_script` so the scripts run, and dev mode wraps it in `$.add_locations` with the source line and column of every element.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-template/index.js:33-68](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-template/index.js#L33-L68), [packages/svelte/src/compiler/phases/3-transform/client/transform-template/template.js:9-60](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-template/template.js#L9-L60)

### Walking children

`process_children` walks an element's or fragment's children and emits the shortest navigation to each node that needs code. It tracks the previous node and a `skipped` count: static elements and plain text are skipped and only counted, and the next node that needs code is reached with `$.sibling(prev, count)`. Consecutive text and expression tags collapse into one text node: in the template they are a single space, and in code a `$.set_text(text, value)` goes into `update` when the value has state, or a one-off `text.nodeValue = value` into `init` when it does not. Trailing skipped nodes produce a `$.next(n)` so hydration ends on the right node.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/fragment.js:19-123](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/fragment.js#L19-L123)

An element is static, and needs no variable at all, when its fragment is not dynamic and every attribute is a plain text or boolean attribute that can be written into the HTML. Event attributes, `dir`, `value`/`checked` on inputs, `value` on `<option>`, `loading` on `<img>` and anything on a custom element make it non-static.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/fragment.js:125-173](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/fragment.js#L125-L173)

### Elements

`RegularElement` pushes the element into the template and handles its attributes. Static attributes are written into the template HTML, with the scoping class appended to `class` when the element is scoped. Dynamic attributes, `class:` and `style:` directives and spreads become runtime calls (`$.set_attribute`, `$.set_class`, `$.set_style`, `$.attribute_effect` for spreads). Event attributes become delegated handlers stored on the node as `node.__click = handler` with the event name added to `state.events`, or listeners. Children are processed with `$.child(node)` as the starting point and followed by `$.reset(node)` when hydration needs to step back out. A `<video>` or custom element sets `needs_import_node`, so the template is instantiated with `importNode` instead of `cloneNode`.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js:32-60](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js#L32-L60), [packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js:198-240](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js#L198-L240), [packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js:330-404](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/RegularElement.js#L330-L404), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/events.js:28-62](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/events.js#L28-L62)

Blocks such as `{#if}`, `{#each}` and `{#await}` each have a visitor that emits a call like `$.if(node, ($$render) => ...)` with branches built by recursive `Fragment` visits; their runtime counterparts are described in [[Control Flow Blocks]] and [[Each Blocks]].

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:88-142](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L88-L142)

### Template effects and memoisation

When a fragment's `update` list is not empty, `build_render_statement` emits a single `$.template_effect((...ids) => { ...update }, sync, async)`. `build_template_chunk` decides what to memoise: an expression with a call or an `await` is registered in the `Memoizer` and replaced by an identifier, so `text1()` runs once per update and its result is passed in. Known constant values are inlined as string literals using `scope.evaluate` ([[Scopes and Bindings]]). The runtime side of template effects is in [[Effects and the Effect Tree]].

Sources: [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js:17-62](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js#L17-L62), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js:64-116](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js#L64-L116), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js:164-182](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/utils.js#L164-L182)

## AST builders

Code is never assembled as strings. `utils/builders.js` (imported as `#compiler/builders`, usually as `b`) exports small functions that return ESTree nodes: `b.id`, `b.literal`, `b.call(callee, ...args)` (which accepts a dotted string like `'$.get'`, drops falsy trailing arguments and turns falsy middle ones into `undefined`), `b.member`, `b.arrow`, `b.thunk(expr)` for `() => expr`, `b.var`/`b.let`/`b.const`, `b.if`, `b.block`, `b.stmt`, `b.get`/`b.set` for accessors, `b.import_all` and so on. Both transforms and the analyzer use them.

Sources: [packages/svelte/src/compiler/utils/builders.js:95-131](repo://packages/svelte/src/compiler/utils/builders.js#L95-L131), [packages/svelte/src/compiler/utils/builders.js:249-265](repo://packages/svelte/src/compiler/utils/builders.js#L249-L265), [packages/svelte/src/compiler/utils/builders.js:618-684](repo://packages/svelte/src/compiler/utils/builders.js#L618-L684)

## Modules

`client_module` handles `.svelte.js` files: it walks the module with the same visitors (so `$state`, `$derived` and `$effect` are rewritten the same way), prepends `import * as $ from 'svelte/internal/client'`, and adds the tracing flag import when `$inspect.trace` is used.

Sources: [packages/svelte/src/compiler/phases/3-transform/client/transform-client.js:700-734](repo://packages/svelte/src/compiler/phases/3-transform/client/transform-client.js#L700-L734)
