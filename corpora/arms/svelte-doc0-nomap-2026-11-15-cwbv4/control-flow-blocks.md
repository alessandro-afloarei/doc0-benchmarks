---
title: "Control Flow Blocks"
---
## Overview

Every template construct whose structure can change at runtime (`{#if}`, `{#key}`, `{#await}`, `{@html}`, `{@render}`, `<svelte:element>`, `<svelte:component>` and dynamic components, `<svelte:head>`, `<slot>`) is implemented by a function in `internal/client/dom/blocks/`. They share one pattern: a **block effect** reads the expression that decides what to show, and owns one or more **branch effects**, each rendering one piece of content before a fixed anchor node. When the expression changes, the block creates a new branch, and pauses or destroys the old one. The effect machinery used here (`block`, `branch`, `pause_effect`, `resume_effect`) is described in [[Effects and the Effect Tree]].

Sources: [packages/svelte/src/internal/client/dom/blocks/if.js:20-50](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L20-L50), [packages/svelte/src/internal/client/dom/blocks/if.js:136-149](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L136-L149), [packages/svelte/src/internal/client/reactivity/effects.js:372-393](repo://packages/svelte/src/internal/client/reactivity/effects.js#L372-L393)

`{#each}` uses the same pieces with a reconciliation algorithm on top and has its own page, [[Each Blocks]]; `<svelte:boundary>` is in [[Error Boundaries and Async Rendering]].

Sources: [packages/svelte/src/internal/client/index.js:12-20](repo://packages/svelte/src/internal/client/index.js#L12-L20)

## The common shape

### Anchors and branches

Every block function takes the anchor `node` the compiled code located for it. During hydration it first steps past the opening `<!--[-->` marker, and at the end sets its anchor to the current `hydrate_node`, which by then is the closing marker ([[Mounting and Hydration]]). Branches always insert their DOM before the anchor, so the anchor fixes the block's position even when no branch is shown.

Sources: [packages/svelte/src/internal/client/dom/blocks/if.js:26-31](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L26-L31), [packages/svelte/src/internal/client/dom/blocks/if.js:136-149](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L136-L149)

### Deferred commits in async mode

In async mode a branch must not appear in the document before the batch that created it commits, or the user would see a half-updated page while other async work is still pending ([[Batches and Scheduling]]). `should_defer_append()` returns true in async mode once the block's effect has run before. Blocks then render the new branch into an offscreen `DocumentFragment`, mark the outgoing branch as skipped in the batch, and register a `commit` callback with `batch.add_callback`; `commit` moves the fragment into place and pauses the old branch when the batch commits. Without deferral, `commit` runs immediately.

Sources: [packages/svelte/src/internal/client/dom/operations.js:212-222](repo://packages/svelte/src/internal/client/dom/operations.js#L212-L222), [packages/svelte/src/internal/client/dom/blocks/if.js:52-79](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L52-L79), [packages/svelte/src/internal/client/dom/blocks/if.js:103-130](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L103-L130)

## `{#if}`

The compiler emits `$.if(node, ($$render) => { if (cond) $$render(consequent); else $$render(alternate, false); })`. `if_block` runs that function inside a block effect; `set_branch` (passed as `$$render`) records which branch was chosen. A chain of `{:else if}` compiles to nested `if_block` calls with `elseif` set, which makes the inner block `EFFECT_TRANSPARENT` so transitions inside it count as local to the outer `{#if}`.

Sources: [packages/svelte/src/internal/client/dom/blocks/if.js:20-50](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L20-L50), [packages/svelte/src/internal/client/dom/blocks/if.js:136-144](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L136-L144), [packages/svelte/src/compiler/phases/3-transform/client/visitors/IfBlock.js:30-72](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/IfBlock.js#L30-L72)

`update_branch` returns early when the condition did not change. Otherwise it creates the branch for the new condition if it does not exist yet (`consequent_effect ??= branch(...)`), and `commit` resumes it and pauses the other one. Because a paused branch is kept until its outro transitions finish, toggling the condition back during an outro resumes the existing branch instead of creating a new one.

Sources: [packages/svelte/src/internal/client/dom/blocks/if.js:52-135](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L52-L135)

During hydration the block compares its condition with the marker the server left: `<!--[!-->` means the server rendered the else branch. On disagreement it removes the server's nodes and renders client-side, then resumes hydrating after the block.

Sources: [packages/svelte/src/internal/client/dom/blocks/if.js:87-101](repo://packages/svelte/src/internal/client/dom/blocks/if.js#L87-L101)

## `{#key}`

`key(node, get_key, render_fn)` re-creates its content whenever the key changes, comparing with `!==` in runes mode and with `safe_not_equal` in legacy mode (so object keys always count as changed there). Each change creates a fresh branch and pauses the previous one, so intro and outro transitions can play together.

Sources: [packages/svelte/src/internal/client/dom/blocks/key.js:18-79](repo://packages/svelte/src/internal/client/dom/blocks/key.js#L18-L79)

## `{#await}`

`await_block(node, get_input, pending_fn, then_fn, catch_fn)` has three possible branches and two sources: `input_source` for the resolved value and `error_source` for the error, which the `then` and `catch` snippets read. When the input changes:

Sources: [packages/svelte/src/internal/client/dom/blocks/await.js:36-80](repo://packages/svelte/src/internal/client/dom/blocks/await.js#L36-L80), [packages/svelte/src/internal/client/dom/blocks/await.js:140-204](repo://packages/svelte/src/internal/client/dom/blocks/await.js#L140-L204)

- A non-promise value is written to `input_source` and the `then` branch is shown at once.
- For a promise, the `then`/`catch` handlers write the result and switch branches, ignoring results from promises that are no longer the current input. The `pending` branch is shown only if the promise has not settled within a microtask, which avoids a flash of loading content for already-resolved promises.

Sources: [packages/svelte/src/internal/client/dom/blocks/await.js:36-80](repo://packages/svelte/src/internal/client/dom/blocks/await.js#L36-L80), [packages/svelte/src/internal/client/dom/blocks/await.js:140-204](repo://packages/svelte/src/internal/client/dom/blocks/await.js#L140-L204)

`update(state)` resumes or creates the wanted branch and pauses the others. Promise callbacks run outside any effect, so `update` restores the block's effect, reaction and component context before creating branches, then calls `flushSync` so the DOM updates in the same microtask. A rejected promise with no `{:catch}` re-throws the error.

Sources: [packages/svelte/src/internal/client/dom/blocks/await.js:82-138](repo://packages/svelte/src/internal/client/dom/blocks/await.js#L82-L138)

## `{@html}`

`html(node, get_value, svg, mathml)` is a template effect rather than a block with branches. When the string changes it removes the nodes it inserted last time and parses the new string with a `<template>` element, inserting the resulting nodes before the anchor. SVG and MathML content is parsed inside an `<svg>` or `<math>` wrapper to get the right namespace. Scripts in the HTML do not run, as with `innerHTML`.

Sources: [packages/svelte/src/internal/client/dom/blocks/html.js:36-119](repo://packages/svelte/src/internal/client/dom/blocks/html.js#L36-L119)

When hydrating, the block adopts the nodes between its opening comment and the next empty comment without comparing them. The server stores a hash of the HTML in the opening comment, and in dev `check_hash` compares it with the client value and warns with `hydration_html_changed` if they differ; mismatches are not repaired.

Sources: [packages/svelte/src/internal/client/dom/blocks/html.js:14-34](repo://packages/svelte/src/internal/client/dom/blocks/html.js#L14-L34), [packages/svelte/src/internal/client/dom/blocks/html.js:64-90](repo://packages/svelte/src/internal/client/dom/blocks/html.js#L64-L90)

## Snippets and `{@render}`

A `{#snippet name(a, b)}` compiles to a function `(anchor, a, b) => { ... }` whose parameters are getter functions, so the snippet reads its arguments lazily. `{@render name(x)}` with a static snippet calls it directly; with a dynamic expression it calls `snippet(node, get_snippet, ...args)`, a transparent block that destroys and recreates the branch whenever the snippet function itself changes. In dev, `wrap_snippet` sets the component function for ownership checks and prevents the snippet from being stringified.

Sources: [packages/svelte/src/internal/client/dom/blocks/snippet.js:22-77](repo://packages/svelte/src/internal/client/dom/blocks/snippet.js#L22-L77), [packages/svelte/tests/snapshot/samples/bind-component-snippet/_expected/client/index.svelte.js:5-11](repo://packages/svelte/tests/snapshot/samples/bind-component-snippet/_expected/client/index.svelte.js#L5-L11)

`createRawSnippet(fn)` (exported from `svelte`) builds a snippet from plain code: `fn` receives the getters and returns `render()`, which must produce HTML for a single element, and an optional `setup(element)` whose returned function becomes a teardown. During hydration the existing element is adopted instead of rendered.

Sources: [packages/svelte/src/internal/client/dom/blocks/snippet.js:79-119](repo://packages/svelte/src/internal/client/dom/blocks/snippet.js#L79-L119)

## Dynamic components and elements

`component(node, get_component, render_fn)` backs `<svelte:component this={C}>` and components referenced through reactive values. It is a transparent block that, when the constructor changes, creates a branch rendering the new component and pauses the old one; a falsy value renders nothing.

Sources: [packages/svelte/src/internal/client/dom/blocks/svelte-component.js:14-82](repo://packages/svelte/src/internal/client/dom/blocks/svelte-component.js#L14-L82)

`element(node, get_tag, is_svg, render_fn, get_namespace)` backs `<svelte:element this={tag}>`. A branch creates the element with `createElement` or `createElementNS` (SVG when the tag is `svg` or the parent is SVG), gives it a child anchor and calls `render_fn` for attributes and children. When the tag changes the old element is destroyed immediately and the new one rendered without intro transitions; when the tag becomes falsy the element is paused so its outro can play, and if the same tag comes back during the outro it is resumed. In dev, elements record their source location in `__svelte_meta`.

Sources: [packages/svelte/src/internal/client/dom/blocks/svelte-element.js:34-100](repo://packages/svelte/src/internal/client/dom/blocks/svelte-element.js#L34-L100), [packages/svelte/src/internal/client/dom/blocks/svelte-element.js:100-164](repo://packages/svelte/src/internal/client/dom/blocks/svelte-element.js#L100-L164)

## `<svelte:head>`

`head(render_fn)` renders into `document.head` instead of the component's position, using a `HEAD_EFFECT` block, which makes `destroy_effect` remove its nodes even when the parent's DOM removal would not reach them. During hydration it searches `document.head` for the next `<!--[-->` marker (several components may have head content, so a module-level `head_anchor` remembers where the last one ended), and skips hydration entirely if no marker exists. `mount` and `hydrate` reset that anchor when they finish.

Sources: [packages/svelte/src/internal/client/dom/blocks/svelte-head.js:10-68](repo://packages/svelte/src/internal/client/dom/blocks/svelte-head.js#L10-L68), [packages/svelte/src/internal/client/reactivity/effects.js:463-475](repo://packages/svelte/src/internal/client/reactivity/effects.js#L463-L475)

## Slots and CSS custom properties

`slot(anchor, $$props, name, slot_props, fallback_fn)` renders legacy `<slot>` content from `$$props.$$slots[name]`, or the fallback when nothing was passed. When a runes parent passed a snippet instead (`$$slots[name] === true`), it renders `$$props.children` or `$$props[name]` as a snippet with the slot props as its argument, which is how snippets and slots interoperate. `sanitize_slots` builds the `$$slots` object components see.

Sources: [packages/svelte/src/internal/client/dom/blocks/slot.js:1-44](repo://packages/svelte/src/internal/client/dom/blocks/slot.js#L1-L44)

`css_props(element, get_styles)` implements `<Child --color="red" />`: the compiler wraps the child in an element with `display: contents`, and a render effect sets or removes each custom property on its style.

Sources: [packages/svelte/src/internal/client/dom/blocks/css-props.js:1-29](repo://packages/svelte/src/internal/client/dom/blocks/css-props.js#L1-L29), [packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/component.js:476-482](repo://packages/svelte/src/compiler/phases/3-transform/client/visitors/shared/component.js#L476-L482)
