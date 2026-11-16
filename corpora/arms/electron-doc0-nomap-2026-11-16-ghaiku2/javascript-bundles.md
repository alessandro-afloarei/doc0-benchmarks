---
title: "JavaScript Bundles"
---
## Overview

The TypeScript under `lib/` is not loaded from disk at run time. The build compiles each runtime entry point into one webpack bundle, and then `js2c.py` embeds the bundles in the native binary as strings. Node.js finds them by name, for example `electron/js2c/browser_init`. This page covers the entry points and their webpack targets, the `js2c` step that embeds them, and the TypeScript projects that type-check the sources. The native targets that drive all of this are in [[GN Build]].

Sources: [shell/common/node_bindings.cc:702-702](repo://shell/common/node_bindings.cc#L702-L702)

## Entry points and targets

`webpack.config.base.js` builds a bundle for one target. The entry is `lib/<target>/init.ts`, or `init.js` if no `.ts` file exists. The output name is `<target>.bundle.js` unless the GN action gives another.

Sources: [build/webpack/webpack.config.base.js:29-38](repo://build/webpack/webpack.config.base.js#L29-L38)

Each target is a small config that calls the base with its options. The browser target runs in Node and has no special globals. The renderer target runs with Node available and takes `Buffer`, `global` and `process` from the webpack provider, because the renderer init later deletes those globals from the page. Its entry is also wrapped in a try-catch, so a failure is logged instead of thrown.

Sources: [build/webpack/webpack.config.browser.js:1-4](repo://build/webpack/webpack.config.browser.js#L1-L4)

Sources: [build/webpack/webpack.config.renderer.js:1-7](repo://build/webpack/webpack.config.renderer.js#L1-L7)

The sandboxed renderer and the preload realm targets are built for a browser-like environment, with `alwaysHasNode` off, so `Buffer` and `process` come from polyfills or from the bundle's own parameters.

Sources: [build/webpack/webpack.config.sandboxed_renderer.js:1-6](repo://build/webpack/webpack.config.sandboxed_renderer.js#L1-L6)

Sources: [build/webpack/webpack.config.preload_realm.js:1-6](repo://build/webpack/webpack.config.preload_realm.js#L1-L6)

## Module aliases

The base config resolves `@electron/internal` to the `lib/` folder. It maps `electron` and each `electron/*` alias to the target's `api/exports/electron.ts`, so the same import works in every bundle. `timers` is forced to the `timers-browserify` package, because the default one uses `window.postMessage`.

Sources: [build/webpack/webpack.config.base.js:117-128](repo://build/webpack/webpack.config.base.js#L117-L128)

Sources: [build/webpack/webpack.config.base.js:34-34](repo://build/webpack/webpack.config.base.js#L34-L34)

The base config adds wrapper plugins for two debugging aids. One wraps the init in a function that can be delayed by `--profile-electron-init`, and the other wraps it in a try-catch that logs `Electron <name> script failed to run`.

Sources: [build/webpack/webpack.config.base.js:85-107](repo://build/webpack/webpack.config.base.js#L85-L107)

## GN targets

`build/webpack/webpack.gni` defines `webpack_build`, a template that runs the `webpack` npm script with a config file and an output file.

Sources: [build/webpack/webpack.gni:3-16](repo://build/webpack/webpack.gni#L3-L16)

`BUILD.gn` declares one `webpack_build` target per bundle: browser, renderer, worker, sandboxed renderer, isolated renderer, node, utility and preload realm. The browser target also depends on `build_electron_definitions`, which generates `electron.d.ts` from the API docs.

Sources: [BUILD.gn:157-173](repo://BUILD.gn#L157-L173)

Sources: [BUILD.gn:228-236](repo://BUILD.gn#L228-L236)

## Embedding with js2c

`electron_js2c` is the action that embeds the bundles. It depends on every bundle and on Node's own `node_js2c`, and it lists the files it takes as sources: `browser_init.js`, `renderer_init.js`, `worker_init.js`, `sandbox_bundle.js`, `isolated_bundle.js`, `node_init.js`, `utility_init.js` and `preload_realm_bundle.js`.

Sources: [BUILD.gn:237-257](repo://BUILD.gn#L237-L257)

`build/js2c.py` is a thin wrapper. It runs Node's `js2c` tool with `--only-js` and the repository root, and the output is the generated `electron_natives.cc`. This is what lets the native code call `CompileAndCall` with a bundle name.

Sources: [build/js2c.py:1-16](repo://build/js2c.py#L1-L16)

## TypeScript projects

`tsconfig.json` is the base project. It is strict, uses the CommonJS module format, and maps `@electron/internal/*` to `lib/*` and `@node/*` to Node's source tree, which is how the sources import each other.

Sources: [tsconfig.json:1-26](repo://tsconfig.json#L1-L26)

`tsconfig.electron.json` extends it for `lib/` and `typings/`, with `lib` as the root directory. The GN `typescript_build` template runs `tsc` with a given project, and lists the base config and the internal typings as its inputs.

Sources: [tsconfig.electron.json:1-10](repo://tsconfig.electron.json#L1-L10)

Sources: [build/tsc.gni:3-22](repo://build/tsc.gni#L3-L22)
