---
title: "Server Rendering Runtime"
---
## Overview

Server-compiled components ([[Server Code Generation]]) are functions that append strings to a `Payload`. The server runtime in `internal/server/` supplies that payload, the helpers the generated code calls (escaping, attributes, blocks, stores, component context), and `render()`, the entry point exported from `svelte/server` that runs a component and returns its HTML. There are no effects or signals here: a render is a single synchronous pass, and the result is plain strings with hydration markers for [[Mounting and Hydration]] to pick up.

Sources: [packages/svelte/src/server/index.js:1-1](repo://packages/svelte/src/server/index.js#L1-L1), [packages/svelte/src/internal/server/index.js:61-116](repo://packages/svelte/src/internal/server/index.js#L61-L116)

## render()

`render(Component, { props, context, idPrefix })`:

Sources: [packages/svelte/src/internal/server/index.js:61-116](repo://packages/svelte/src/internal/server/index.js#L61-L116), [packages/svelte/src/internal/server/abort-signal.js:1-13](repo://packages/svelte/src/internal/server/abort-signal.js#L1-L13)

1. Creates a `Payload` whose id generator uses the `idPrefix`.
2. Pushes `<!--[-->`, the opening marker `hydrate` looks for.
3. In dev, resets the element-nesting tracker used for invalid-HTML warnings.
4. If a `context` map was given, pushes a root component context with it.
5. Calls `Component(payload, props, {}, {})`.
6. Pushes `<!--]-->`, runs every collected `onDestroy` callback, and builds the result: `head` is the head payload's output plus the `<title>` plus one `<style id="hash">` per injected stylesheet, and `body` (also returned as `html`) is the joined main output.
7. Finally, aborts the controller behind `getAbortSignal()`, whether rendering succeeded or threw.

Sources: [packages/svelte/src/internal/server/index.js:61-116](repo://packages/svelte/src/internal/server/index.js#L61-L116), [packages/svelte/src/internal/server/abort-signal.js:1-13](repo://packages/svelte/src/internal/server/abort-signal.js#L1-L13)

The sandbox's development server shows typical use: `const { head, body } = render(App)` spliced into an HTML template ([[Quickstart]]).

Sources: [playgrounds/sandbox/ssr-dev.js:21-31](repo://playgrounds/sandbox/ssr-dev.js#L21-L31)

## The payload

`Payload` holds `out`, an array of string chunks, `css`, a set of `{ hash, code }` stylesheets registered by components with injected CSS, `uid`, the id generator, `select_value`, the value of the `<select>` currently being rendered, and `head`, a `HeadPayload` with its own `out`, `css` and `title`. `head(payload, fn)` renders `<svelte:head>` content into the head payload between block markers, and `<title>` is stored separately so the last title rendered wins.

Sources: [packages/svelte/src/internal/server/payload.js:1-36](repo://packages/svelte/src/internal/server/payload.js#L1-L36), [packages/svelte/src/internal/server/index.js:121-132](repo://packages/svelte/src/internal/server/index.js#L121-L132), [packages/svelte/src/compiler/phases/3-transform/server/visitors/TitleElement.js:10-17](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/TitleElement.js#L10-L17)

`copy_payload` and `assign_payload` exist for legacy components with component bindings, whose template is rendered repeatedly into a copy until bound values stop changing ([[Server Code Generation]]).

Sources: [packages/svelte/src/internal/server/payload.js:38-70](repo://packages/svelte/src/internal/server/payload.js#L38-L70)

`props_id(payload)` implements `$props.id()`: it takes the next id from the generator (`s1`, `s2`, ... after the prefix), writes it into the output as `<!--#s1-->` so the client can read the same id during hydration, and returns it.

Sources: [packages/svelte/src/internal/server/payload.js:72-80](repo://packages/svelte/src/internal/server/payload.js#L72-L80), [packages/svelte/src/internal/server/index.js:491-499](repo://packages/svelte/src/internal/server/index.js#L491-L499)

## Escaping and attributes

### Escaping and attribute strings

All interpolated text goes through `escape_html` (exported as `$.escape`), which replaces `&` and `<` in content, and additionally `"` in attribute values, scanning with a regular expression and building the result in one pass.

Sources: [packages/svelte/src/escaping.js:1-26](repo://packages/svelte/src/escaping.js#L1-L26), [packages/svelte/src/internal/server/index.js:524-524](repo://packages/svelte/src/internal/server/index.js#L524-L524)

`attr(name, value, is_boolean)` (shared with the client's static rendering) returns the attribute string with a leading space, or `''` for `null`/`undefined` and for false boolean attributes; boolean attributes render without a value, and `translate={false}` becomes `translate="no"`. `attr_class` and `attr_style` build `class` and `style` from the value, the scoping hash and `class:`/`style:` directives using the same `to_class` and `to_style` as the client ([[Elements, Attributes and Events]]).

Sources: [packages/svelte/src/internal/shared/attributes.js:4-29](repo://packages/svelte/src/internal/shared/attributes.js#L4-L29), [packages/svelte/src/internal/server/index.js:248-266](repo://packages/svelte/src/internal/server/index.js#L248-L266)

`spread_attributes(attrs, css_hash, classes, styles, flags)` renders a spread: it merges classes and styles, skips functions (event handlers), internal `$$` props and names containing characters invalid in attribute names, lower-cases names on HTML elements, and concatenates `attr()` for the rest. `spread_props` merges several prop objects while preserving getters.

Sources: [packages/svelte/src/internal/server/index.js:164-233](repo://packages/svelte/src/internal/server/index.js#L164-L233), [packages/svelte/src/internal/server/index.js:24-26](repo://packages/svelte/src/internal/server/index.js#L24-L26)

### Selects and options

There is no DOM to ask which option is selected, so the server tracks it: rendering a `<select>` stores its value in `payload.select_value`, and `maybe_selected(payload, value)` returns `' selected'` for the matching `<option value>`. For an `<option>` without a value, `valueless_option` renders the children, compares their text to the select value, and patches `selected` into the already-emitted opening tag.

Sources: [packages/svelte/src/internal/server/index.js:548-576](repo://packages/svelte/src/internal/server/index.js#L548-L576)

## Blocks on the server

Most control flow compiles to plain JavaScript (`if`, `for`) with markers around it, so the runtime only needs a few block helpers:

Sources: [packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js:12-29](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/IfBlock.js#L12-L29)

| Helper | Behaviour |
| --- | --- |
| `element(payload, tag, attributes_fn, children_fn)` | `<svelte:element>`: renders the dynamic tag between empty comments, skipping children for void elements |
| `html(value)` | `{@html}`: wraps the raw string in comments; in dev the opening comment carries a hash of the content, which the client compares to warn about mismatches |
| `await` (`await_block`) | `{#await}`: for a promise, renders the `pending` branch (the server never waits); for a plain value, renders the `then` branch after `<!--[!-->` |
| `ensure_array_like` | `{#each}`: accepts arrays, array-likes and iterables |
| `slot`, `sanitize_slots` | Legacy slots, same interop rules as the client |
| `css_props` | `--custom-props`: wraps the component in `<svelte-css-wrapper style="display: contents; ...">` or an SVG `<g>` |
| `createRawSnippet` | Calls `render()` and pushes the trimmed HTML; `setup` is never called |

Sources: [packages/svelte/src/internal/server/index.js:28-53](repo://packages/svelte/src/internal/server/index.js#L28-L53), [packages/svelte/src/internal/server/blocks/html.js:1-11](repo://packages/svelte/src/internal/server/blocks/html.js#L1-L11), [packages/svelte/src/internal/server/index.js:435-466](repo://packages/svelte/src/internal/server/index.js#L435-L466), [packages/svelte/src/internal/server/index.js:134-162](repo://packages/svelte/src/internal/server/index.js#L134-L162), [packages/svelte/src/internal/server/blocks/snippet.js:1-24](repo://packages/svelte/src/internal/server/blocks/snippet.js#L1-L24)

`derived(fn)` backs class fields declared with `$derived`: it computes the value once on first read (`once`) and allows it to be overwritten, since nothing can change during a render. `inspect(args)` logs once with `'init'`.

Sources: [packages/svelte/src/internal/server/index.js:468-546](repo://packages/svelte/src/internal/server/index.js#L468-L546)

## Props, stores and context

`rest_props`, `sanitize_props` and `sanitize_slots` mirror their client counterparts. `bind_props(props_parent, props_now)` runs at the end of a component with bindable props: for each prop that the parent bound (it has a setter) and passed as `undefined`, it writes the child's value back, so a bound fallback value reaches the parent ([[Props and Component Context]]).

Sources: [packages/svelte/src/internal/server/index.js:375-433](repo://packages/svelte/src/internal/server/index.js#L375-L433)

`store_get(store_values, '$name', store)` subscribes to a store the first time a component reads it, records the latest value and the unsubscribe function in the component's `$$store_subs` object, and returns the value; switching to a different store unsubscribes from the old one. `unsubscribe_stores` releases them at the end of the component. `store_set`, `store_mutate`, `update_store` and `update_store_pre` implement writes ([[Stores]]).

Sources: [packages/svelte/src/internal/server/index.js:267-358](repo://packages/svelte/src/internal/server/index.js#L267-L358)

The server keeps its own component context stack in `internal/server/context.js`. `push` creates `{ p, c, d }` (parent, context map, destroy callbacks) and `pop` moves the component's `onDestroy` callbacks to the global list that `render` runs at the end. `getContext`, `setContext`, `hasContext` and `getAllContexts` work as on the client, copying the nearest parent's map on first use.

Sources: [packages/svelte/src/internal/server/context.js:1-96](repo://packages/svelte/src/internal/server/context.js#L1-L96)

## The svelte entry point on the server

`index-server.js` is what `import ... from 'svelte'` resolves to outside the browser. Lifecycle functions that only make sense in a browser are no-ops (`onMount`, `beforeUpdate`, `afterUpdate`, `flushSync`; `createEventDispatcher` returns a no-op), `untrack` just calls the function, and `tick` and `settled` resolve immediately. `onDestroy` registers its callback on the current server component. `mount`, `hydrate` and `unmount` throw `lifecycle_function_unavailable`.

Sources: [packages/svelte/src/index-server.js:1-44](repo://packages/svelte/src/index-server.js#L1-L44)

`getAbortSignal()` on the server returns the signal of one shared controller, created on demand and aborted with `STALE_REACTION` when `render` finishes, so fetches started during a render are cancelled afterwards.

Sources: [packages/svelte/src/internal/server/abort-signal.js:1-13](repo://packages/svelte/src/internal/server/abort-signal.js#L1-L13)

## Dev-time nesting checks

In dev, the compiler brackets each element with `push_element(payload, tag, line, column)` and `pop_element()`. The runtime keeps a stack of open elements across components and checks each new element against its parent and ancestors with the HTML nesting rules in `html-tree-validation.js` (a `<div>` inside a `<p>`, say). A violation is printed once with `console.error` as `node_invalid_placement_ssr`, and the same message is added as a `<script>console.error(...)</script>` to the head, because the browser would silently repair such HTML and break hydration. Snippets are checked to receive a payload as their first argument.

Sources: [packages/svelte/src/internal/server/dev.js:21-107](repo://packages/svelte/src/internal/server/dev.js#L21-L107), [packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js:58-70](repo://packages/svelte/src/compiler/phases/3-transform/server/visitors/RegularElement.js#L58-L70)
