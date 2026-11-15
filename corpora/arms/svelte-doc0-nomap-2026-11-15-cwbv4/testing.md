---
title: "Testing"
---
## Overview

The tests run with Vitest from the repository root (`pnpm test`). Almost all of them are data-driven: each folder under `packages/svelte/tests/` is a suite with a `test.ts` entry point and a `samples/` directory, and every sample is a small directory of input files plus an optional `_config.js` describing what to check. Adding a test usually means adding a sample folder, not writing test code. A few modules are also covered by unit tests next to the source (`*.test.ts` in `src/`).

Sources: [vitest.config.js:29-45](repo://vitest.config.js#L29-L45), [packages/svelte/tests/suite.ts:26-37](repo://packages/svelte/tests/suite.ts#L26-L37), [package.json:15-20](repo://package.json#L15-L20)

## Configuration

`vitest.config.js` includes `packages/svelte/**/*.test.ts`, every `packages/svelte/tests/*/test.ts`, and the SSR browser runner, and excludes everything inside `samples/` so sample files are not mistaken for tests. Coverage (`v8`) is collected for `packages/svelte/src/**`.

Sources: [vitest.config.js:29-45](repo://vitest.config.js#L29-L45)

A custom resolver maps every `svelte` and `svelte/...` import to the package's own source using its `exports` map, picking the `browser` entry, except for modules compiled into `_output/server`, which get the `default` (server) entry. Tests therefore exercise the exact files that are published, with the same client/server split as a bundler ([[Svelte Overview]]).

Sources: [vitest.config.js:5-28](repo://vitest.config.js#L5-L28)

## Suites

| Suite | What a sample contains | What is checked |
| --- | --- | --- |
| `runtime-runes`, `runtime-legacy` | `main.svelte` (and helpers), `_config.js` | Compiled and run in JSDOM in `dom`, `hydrate` and `ssr` variants |
| `runtime-browser` | Components and custom elements | Run in a real Chromium through Playwright |
| `hydration` | `main.svelte`, `_config.js` | Server render, then hydrate |
| `server-side-rendering` | `main.svelte`, `_expected.html` | `render()` output |
| `snapshot` | `index.svelte`, `_expected/client`, `_expected/server` | Compiled output text |
| `css` | `input.svelte`, `expected.css` | Scoped CSS output and warnings |
| `validator` | `input.svelte`, `warnings.json` or `errors.json` | Compiler diagnostics ([[Errors and Warnings]]) |
| `compiler-errors` | `main.svelte`, `_config.js` with the expected error | Compile errors |
| `parser-modern`, `parser-legacy` | `input.svelte`, `output.json` | AST shape ([[Template Parser]]) |
| `migrate` | `input.svelte`, `output.svelte` | [[Svelte 5 Migration Tool]] output |
| `preprocess`, `sourcemaps` | Inputs and preprocessors | [[Preprocessing and Source Maps]] |
| `signals` | (code only) | The reactivity runtime directly |
| `store`, `motion` | (code only) | `svelte/store` and `svelte/motion` |

Sources: [packages/svelte/tests/snapshot/test.ts:12-44](repo://packages/svelte/tests/snapshot/test.ts#L12-L44), [packages/svelte/tests/runtime-legacy/shared.ts:126-174](repo://packages/svelte/tests/runtime-legacy/shared.ts#L126-L174)

`signals/test.ts` imports runtime internals directly (`state`, `derived`, `effect`, `flushSync`, `proxy`) and runs each test inside a component context and an `effect_root`, in both runes and legacy mode, to test the graph from [[Signals and Dependency Tracking]] without compiling anything.

Sources: [packages/svelte/tests/signals/test.ts:1-40](repo://packages/svelte/tests/signals/test.ts#L1-L40)

## How samples become tests

`suite(fn)` returns `{ test, run }`. Each sample's `_config.js` default-exports `test({...})`, which only gives the config its type; `run(__dirname)` then walks `samples/`, imports each `_config.js` (or uses `{}`), and registers one Vitest test per directory, skipped for `skip: true` and focused for `solo: true`. Directories containing only leftover `_output` or `_actual.json` from another branch are ignored.

Sources: [packages/svelte/tests/suite.ts:26-104](repo://packages/svelte/tests/suite.ts#L26-L104)

`suite_with_variants(variants, should_skip_variant, common_setup, fn)` registers one test per sample per variant, named `sample (variant)`. `should_skip_variant` may return `true` (show as skipped) or `'no-test'` (omit entirely), and `common_setup` runs once per sample, lazily, before the first variant that runs.

Sources: [packages/svelte/tests/suite.ts:39-71](repo://packages/svelte/tests/suite.ts#L39-L71)

`compile_directory(cwd, generate, options)` in `helpers.js` is what most suites use to compile a sample. It compiles every `.svelte` file into `_output/client` or `_output/server` (with `.css`, `.css.json` and `.warnings.json` beside it), compiles `.svelte.js` files with `compileModule`, re-exports other `.js` files so `_config.js` can share state with the component, and replaces the version number with `VERSION` so outputs are stable. Files named `*.client.svelte` or `*.server.svelte` are compiled only for that target, to simulate code that differs between browser and server.

Sources: [packages/svelte/tests/helpers.js:63-165](repo://packages/svelte/tests/helpers.js#L63-L165)

## Runtime tests

`runtime_suite(runes)` from `runtime-legacy/shared.ts` drives both runtime suites; `runtime-runes/test.ts` is just `runtime_suite(true)`. Every sample is compiled for client and server once (with accessors on, the `fragments` mode from the environment, and async mode on for runes unless disabled), then run in up to three variants:

Sources: [packages/svelte/tests/runtime-runes/test.ts:1-8](repo://packages/svelte/tests/runtime-runes/test.ts#L1-L8), [packages/svelte/tests/runtime-legacy/shared.ts:126-205](repo://packages/svelte/tests/runtime-legacy/shared.ts#L126-L205)

- `dom`: mount the client build into a JSDOM target.
- `hydrate`: render with the server build, then hydrate the result with the client build.
- `ssr`: render with the server build and compare HTML; it only exists when the config gives `html`, `ssrHtml`, `error`, `runtime_error` or `test_ssr`, or asks for server mode.

Sources: [packages/svelte/tests/runtime-runes/test.ts:1-8](repo://packages/svelte/tests/runtime-runes/test.ts#L1-L8), [packages/svelte/tests/runtime-legacy/shared.ts:126-205](repo://packages/svelte/tests/runtime-legacy/shared.ts#L126-L205)

A runtime sample's `_config.js` can set:

Sources: [packages/svelte/tests/runtime-legacy/shared.ts:43-98](repo://packages/svelte/tests/runtime-legacy/shared.ts#L43-L98)

| Field | Purpose |
| --- | --- |
| `html`, `ssrHtml` | Expected HTML after mount, and for the server render if it differs |
| `props`, `server_props`, `id_prefix` | Inputs for mount and render |
| `test({ assert, target, component, instance, logs, warnings, errors, raf, window, variant, hydrate, ... })` | The interaction test |
| `test_ssr({ logs, assert })` | Checks for the server variant |
| `mode`, `skip_mode` | Restrict or temporarily skip `client`, `server` or `hydrate` |
| `skip_async`, `skip_no_async` | Skip depending on async mode |
| `compileOptions`, `accessors`, `immutable`, `intro`, `recover` | Compilation and mount options |
| `error`, `runtime_error`, `warnings`, `errors`, `expect_unhandled_rejections` | Expected failures and console output |
| `before_test`, `after_test`, `load_compiled` | Hooks, and reuse of hand-edited output when debugging |

Sources: [packages/svelte/tests/runtime-legacy/shared.ts:43-98](repo://packages/svelte/tests/runtime-legacy/shared.ts#L43-L98)

The runner only intercepts `console.log` when the `test` function's parameter list mentions `logs`, and `console.warn` when it mentions `warnings` (or `warnings` is configured); intercepted Svelte warnings have their styling and documentation link stripped for comparison. Tests can then assert on the exact messages.

Sources: [packages/svelte/tests/runtime-legacy/shared.ts:207-260](repo://packages/svelte/tests/runtime-legacy/shared.ts#L207-L260)

A typical sample, from `runtime-runes/samples/state-bind-group`, checks the initial HTML and the result of a click:

Sources: [packages/svelte/tests/runtime-runes/samples/state-bind-group/_config.js:1-4](repo://packages/svelte/tests/runtime-runes/samples/state-bind-group/_config.js#L1-L4)

```js
export default test({
	html: `<button>+</button><input type="checkbox" value="1"><input type="checkbox" value="2"><input type="checkbox" value="3">\n[]`,

	test({ assert, target }) {
		const btn = target.querySelector('button');

		btn?.click();
		flushSync();

		assert.equal(target.querySelectorAll('input')[1].checked, true);
	}
});
```

Sources: [packages/svelte/tests/runtime-runes/samples/state-bind-group/_config.js:4-19](repo://packages/svelte/tests/runtime-runes/samples/state-bind-group/_config.js#L4-L19)

## Running and filtering

| Command | Effect |
| --- | --- |
| `pnpm test` | All suites |
| `pnpm test <suite>` | One suite, such as `pnpm test validator` |
| `pnpm test <suite> -t <name>` | Vitest's name filter within a suite |
| `FILTER=<name> pnpm test <suite>` | Only register samples whose directory name matches exactly; `FILTER=/part/` matches a substring |
| `UPDATE_SNAPSHOTS=true pnpm test <suite>` | Rewrite expected output for snapshot, parser and migrate suites |
| `SHOULD_UPDATE_EXPECTED=true` | Rewrite expected HTML in the server-side rendering suite |
| `FRAGMENTS=tree`, `SVELTE_NO_ASYNC=true`, `HMR=1` | Rerun runtime suites with `fragments: 'tree'`, without async mode, or with HMR wrappers |

Sources: [CONTRIBUTING.md:97-120](repo://CONTRIBUTING.md#L97-L120), [packages/svelte/tests/suite.ts:9-21](repo://packages/svelte/tests/suite.ts#L9-L21), [packages/svelte/tests/snapshot/test.ts:16-20](repo://packages/svelte/tests/snapshot/test.ts#L16-L20), [packages/svelte/tests/helpers.js:167-198](repo://packages/svelte/tests/helpers.js#L167-L198), [packages/svelte/tests/runtime-legacy/shared.ts:176-195](repo://packages/svelte/tests/runtime-legacy/shared.ts#L176-L195)

`FILTER` removes non-matching samples instead of skipping them, which gives shorter output. The browser suite needs Chromium installed once with `pnpm playwright install chromium`. The sandbox's `create-test` script turns a playground into a new sample ([[Quickstart]]).

Sources: [CONTRIBUTING.md:97-115](repo://CONTRIBUTING.md#L97-L115), [playgrounds/sandbox/package.json:6-16](repo://playgrounds/sandbox/package.json#L6-L16)

`tests/README.md` is a historical note from when the suite was ported from Svelte 4; it records known behaviour differences (such as list insertion order and CSS no longer being minified) rather than current instructions.

Sources: [packages/svelte/tests/README.md:1-40](repo://packages/svelte/tests/README.md#L1-L40)
