---
title: "Quickstart"
---
## Overview

This page takes a fresh clone to a compiled component running in the browser and on the server. It uses only public entry points: `compile` from `svelte/compiler`, `mount` and `hydrate` from `svelte`, and `render` from `svelte/server`. The [[Svelte Overview]] explains how those pieces fit; the compiler and runtime pages explain what happens inside each call.

Sources: [packages/svelte/src/compiler/index.js:14-54](repo://packages/svelte/src/compiler/index.js#L14-L54), [packages/svelte/src/server/index.js:1-1](repo://packages/svelte/src/server/index.js#L1-L1)

## Set up the repository

The repository is a pnpm workspace (`pnpm@10.4.0`, `pnpm >= 9`), and `packages/svelte` needs Node 18 or later.

Sources: [package.json:8-11](repo://package.json#L8-L11), [packages/svelte/package.json:7-9](repo://packages/svelte/package.json#L7-L9)

1. Install dependencies with `pnpm install` at the root.
2. Run `pnpm build` inside `packages/svelte` only when you need the CommonJS bundle of `svelte/compiler` or regenerated types; the ES module source in `src/` is used directly otherwise. `pnpm dev` there regenerates messages and rebuilds on change.
3. For the browser tests, install Chromium once with `pnpm playwright install chromium`, then run `pnpm test`; [[Testing]] covers filters and snapshots.

Sources: [package.json:8-11](repo://package.json#L8-L11), [packages/svelte/package.json:7-9](repo://packages/svelte/package.json#L7-L9), [packages/svelte/package.json:140-150](repo://packages/svelte/package.json#L140-L150), [CONTRIBUTING.md:73-102](repo://CONTRIBUTING.md#L73-L102)

## Compile a component

`compile(source, options)` returns an object whose `js` has `code` and a source `map`, an optional `css`, and a list of `warnings`. `generate` picks the target: `'client'` emits code that imports `svelte/internal/client`, `'server'` emits code that imports `svelte/internal/server`. `compileModule` does the same for a `.svelte.js` file that uses runes, and `parse(source, { modern: true })` returns only the AST. The sandbox's `run.js` uses all three to dump output for every file in its `src` folder:

Sources: [packages/svelte/src/compiler/index.js:14-71](repo://packages/svelte/src/compiler/index.js#L14-L71), [playgrounds/sandbox/run.js:53-56](repo://playgrounds/sandbox/run.js#L53-L56)

```js
const compiled = compile(source, {
	dev: false,
	filename: input,
	generate,
	runes: argv.values.runes,
	experimental: {
		async: true
	}
});

for (const warning of compiled.warnings) {
	console.warn(warning.code);
	console.warn(warning.frame);
}

write(output_js, compiled.js.code + '\n//# sourceMappingURL=' + path.basename(output_map));
write(output_map, compiled.js.map.toString());
```

Sources: [playgrounds/sandbox/run.js:41-92](repo://playgrounds/sandbox/run.js#L41-L92)

The rest of `run.js` writes `compiled.css.code` when the component has styles and calls `compileModule` for every `.js` file. Run it from `playgrounds/sandbox` with `node run.js` (add `--runes` to force runes mode); results land in `output/client`, `output/server`, `output/ast` and `output/migrated`. [[Compiler Pipeline]] describes every field of the result.

Sources: [playgrounds/sandbox/run.js:112-135](repo://playgrounds/sandbox/run.js#L112-L135), [playgrounds/sandbox/run.js:53-73](repo://playgrounds/sandbox/run.js#L53-L73), [playgrounds/sandbox/run.js:8-8](repo://playgrounds/sandbox/run.js#L8-L8)

## Mount it in the browser

A compiled client component is a function. `mount(Component, { target, props })` renders it into `target` and returns its exports; `hydrate` takes the same options but adopts markup that the server already rendered into `target`, and `unmount` removes a mounted component. The sandbox page chooses between the two by looking for server-rendered content:

Sources: [packages/svelte/src/internal/client/render.js:63-100](repo://packages/svelte/src/internal/client/render.js#L63-L100)

```js
const root = document.getElementById('root');
const render = root.firstChild?.nextSibling ? hydrate : mount;

const component = render(App, {
	target: document.getElementById('root')
});
```

Sources: [playgrounds/sandbox/index.html:13-29](repo://playgrounds/sandbox/index.html#L13-L29), [packages/svelte/src/internal/client/render.js:63-75](repo://packages/svelte/src/internal/client/render.js#L63-L75), [packages/svelte/src/internal/client/render.js:296-316](repo://packages/svelte/src/internal/client/render.js#L296-L316)

`hydrate` defaults `intro` to `false`, so transitions do not play over markup the user already sees. [[Mounting and Hydration]] follows both paths.

Sources: [packages/svelte/src/internal/client/render.js:100-103](repo://packages/svelte/src/internal/client/render.js#L100-L103)

## Render it on the server

`render(Component, { props, context, idPrefix })` from `svelte/server` runs a component compiled with `generate: 'server'` and returns `{ head, body }` (`html` is an alias of `body`). `head` already contains the `<title>`, `<svelte:head>` content and a `<style>` tag per component whose CSS is injected. The sandbox's development server splices both strings into `index.html`:

Sources: [packages/svelte/src/internal/server/index.js:61-116](repo://packages/svelte/src/internal/server/index.js#L61-L116)

```js
const { default: App } = await vite.ssrLoadModule('/src/App.svelte');
const { head, body } = render(App);

const html = transformed_template
	.replace(`<!--ssr-head-->`, head)
	.replace(`<!--ssr-body-->`, body)
```

Sources: [playgrounds/sandbox/ssr-dev.js:21-31](repo://playgrounds/sandbox/ssr-dev.js#L21-L31)

[[Server Rendering Runtime]] explains the payload and the hydration markers that let `hydrate` pick up this markup.

Sources: [packages/svelte/src/internal/server/index.js:69-75](repo://packages/svelte/src/internal/server/index.js#L69-L75)

## Use the sandbox playground

`playgrounds/sandbox` is a Vite app that depends on the workspace copy of `svelte`, so edits to `packages/svelte/src` show up immediately. Its `src/` folder is git-ignored scratch space.

Sources: [playgrounds/sandbox/package.json:17-24](repo://playgrounds/sandbox/package.json#L17-L24), [playgrounds/sandbox/.gitignore:1-4](repo://playgrounds/sandbox/.gitignore#L1-L4)

| Script | What it does |
| --- | --- |
| `prepare` | Copies `scripts/main.template.svelte` to `src/main.svelte` if it does not exist |
| `dev` | Starts Vite; `index.html` mounts or hydrates `Wrapper.svelte` |
| `ssr` | Starts `ssr-dev.js`: Vite in middleware mode plus `render` for each request |
| `build` / `prod` | Builds client and server bundles and serves them with `ssr-prod.js` |
| `download`, `hash`, `create-test` | Helpers to pull a playground, share one, or turn it into a test sample |

Sources: [playgrounds/sandbox/package.json:6-24](repo://playgrounds/sandbox/package.json#L6-L24), [playgrounds/sandbox/scripts/create-app-svelte.js:1-13](repo://playgrounds/sandbox/scripts/create-app-svelte.js#L1-L13), [playgrounds/sandbox/.gitignore:1-4](repo://playgrounds/sandbox/.gitignore#L1-L4)

> [!NOTE]
> `Wrapper.svelte` and `ssr-dev.js` both import `src/App.svelte`, while the `prepare` script creates `src/main.svelte`. Create `src/App.svelte` yourself (it can render `main.svelte`) before running `dev` or `ssr`. The wrapper puts the app inside a `<svelte:boundary>` with an empty `pending` snippet, so components can use top-level `await` ([[Error Boundaries and Async Rendering]]).

Sources: [playgrounds/sandbox/Wrapper.svelte:1-9](repo://playgrounds/sandbox/Wrapper.svelte#L1-L9), [playgrounds/sandbox/ssr-dev.js:26-26](repo://playgrounds/sandbox/ssr-dev.js#L26-L26)
