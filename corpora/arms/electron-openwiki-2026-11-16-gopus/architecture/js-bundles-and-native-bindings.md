---
type: architecture
title: JS bundles, module lists and native bindings
description: How Electron's lib/ TypeScript is bundled per process type with webpack, embedded into the binary through js2c, exposed as the `electron` module via module lists, and connected to C++ APIs through Node linked bindings and gin/gin_helper wrappers.
tags: [architecture, webpack, js2c, bindings, gin, node]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-01574e95ef8bbb2973e5c060
    resource: repo://build/js2c.py
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-dfd047ad1d5b3aa1fd48fc4f
    resource: repo://build/webpack/webpack.config.worker.js
  - id: openwiki-source-b63cd99a26c5ff7b460c305e
    resource: repo://build/webpack/webpack.gni
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-ef7c44300e1cb294b01c7304
    resource: repo://lib/common/init.ts
  - id: openwiki-source-6b36f93c58625310ed9eaa48
    resource: repo://lib/common/webpack-provider.ts
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
  - id: openwiki-source-82d45d7514103fe8e9439cca
    resource: repo://shell/common/gin_helper/event_emitter.h
  - id: openwiki-source-07ba4544daa27140abee0b72
    resource: repo://shell/common/gin_helper/trackable_object.h
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-34742d0b3a54e98ae123f17d
    resource: repo://shell/common/node_util.cc
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# JS bundles, module lists and native bindings

Electron's public JavaScript API is a thin TypeScript layer (`lib/`) on top of
C++ objects implemented in `shell/`. Nothing in `lib/` is shipped as loose
files: each process type gets one webpack bundle, the bundles are compiled into
the binary with Node's `js2c` tool, and C++ startup code runs the right bundle
as the Node "main" script for that process.

## One bundle per process type

`build/webpack/webpack.config.base.js` is a factory; each
`webpack.config.<target>.js` calls it with flags describing the target's
environment. The entry is always `lib/<target>/init.ts`, and the `electron`
import inside the bundle is aliased to `lib/<target>/api/exports/electron.ts`
(or the target named by `loadElectronFromAlternateTarget`).

| Bundle (BUILD.gn target) | Entry | Node available? | Notes |
| --- | --- | --- | --- |
| `electron_browser_bundle` → `browser_init.js` | `lib/browser/init.ts` | yes | main process |
| `electron_renderer_bundle` → `renderer_init.js` | `lib/renderer/init.ts` | yes | `nodeIntegration` renderers; deletes Node globals, wrapped in try/catch |
| `electron_worker_bundle` → `worker_init.js` | `lib/worker/init.ts` | yes | Node in web workers; reuses the renderer `electron` exports |
| `electron_sandboxed_renderer_bundle` → `sandbox_bundle.js` | `lib/sandboxed_renderer/init.ts` | no (polyfilled `Buffer`/`process`) | sandboxed preloads |
| `electron_isolated_renderer_bundle` → `isolated_bundle.js` | `lib/isolated_renderer/init.ts` | no | context-isolation world |
| `electron_preload_realm_bundle` → `preload_realm_bundle.js` | `lib/preload_realm/init.ts` | no | service-worker preload realms |
| `electron_node_bundle` → `node_init.js` | `lib/node/init.ts` | yes | runs in every Node environment (ASAR fs patching, `child_process.fork` hook) |
| `electron_utility_bundle` → `utility_init.js` | `lib/utility/init.ts` | yes | `utilityProcess` children |

Key behaviors of the base config:

- **Build flags become JS constants.** The GN `webpack_build` template
  (`build/webpack/webpack.gni`) passes the generated `buildflags.h` to webpack,
  and the config turns every `#define BUILDFLAG_INTERNAL_X() (0|1)` into a
  `DefinePlugin` boolean, so `lib/` code can branch on features such as
  `BUILDFLAG(ENABLE_...)` exactly like C++. See
  [Fuses and build flags](../systems/fuses-and-build-flags.md).
- **Node globals that the page may delete are re-provided.** For targets with
  `targetDeletesNodeGlobals`, `Buffer`, `global` and `process` are injected
  from `lib/common/webpack-provider.ts`, which captures them from
  `globalThis.global` before user code can remove them. Targets without Node
  get the `buffer` and `process/browser` polyfills instead.
- **`Promise` is pinned** through `lib/common/webpack-globals-provider.ts` so
  page scripts overwriting `window.Promise` don't affect internals.
- **Init wrappers.** Renderer-like bundles are wrapped in `try { … } catch` so
  an init failure is logged rather than crashing; some are wrapped in a
  function that is deferred with `setTimeout` when `--profile-electron-init`
  is passed.
- Mode is `development` (unminified) unless `is_official_build`, in which case
  Terser minifies while keeping class and function names.

The source dependency lists of every bundle are not hand-maintained:
`script/gen-filenames.ts` runs each webpack config with `PRINT_WEBPACK_GRAPH`
(which installs `AccessDependenciesPlugin` to print module paths) and writes
them to `filenames.auto.gni` as `*_bundle_deps`, which BUILD.gn uses as the
`inputs` of each bundle target.

## Embedding with js2c and launching the bundle

The `electron_js2c` action in `BUILD.gn` depends on all eight bundles and runs
`build/js2c.py`, which invokes Node's `node_js2c` tool with `--only-js` so the
generated sources register each bundle as a Node builtin with an id such as
`electron/js2c/browser_init`.

Bundles are started in two ways:

1. **As the Node entry script.** `NodeBindings::CreateEnvironment`
   (`shell/common/node_bindings.cc`) maps the process kind (browser, renderer,
   worker, utility) to `electron/js2c/<type>_init` and inserts it as
   `argv[1]`. Electron's Node patches
   (`patches/node/chore_allow_the_node_entrypoint_to_be_a_builtin_module.patch`,
   `fix_do_not_resolve_electron_entrypoints.patch`) teach Node not to resolve
   `electron/js2c…` as a filesystem path.
2. **Directly via `util::CompileAndCall`.** `shell/common/node_util.cc` looks
   the id up in Node's `BuiltinLoader`, compiles it as a function with explicit
   parameters, and calls it. This path runs `node_init` from the Node preload
   hook `OnNodePreload` (with `process` and `require`), and the sandbox,
   isolated and preload-realm bundles from the renderer (see
   [Renderer processes, sandboxing and context isolation](renderer-processes-and-sandboxing.md)).
   Compile or evaluation failures are logged with `LOG(ERROR)` rather than
   thrown.

## How `require('electron')` resolves

Inside a bundle, `electron` is a webpack alias. For **user code**,
`lib/common/init.ts` inserts fake `Module` entries into Node's
`Module._cache` for `electron`, `electron/common` and the process-specific
alias (`electron/main`, `electron/renderer` or `electron/utility`), each with
an `exports` getter that returns the bundle's own `electron` export. It also
patches `Module._resolveFilename` so any of the five names resolves to
`electron`. The sub-path names are purely for TypeScript typing; at runtime
any of them returns the same object.

The export object is assembled from **module lists**:

- `lib/browser/api/module-list.ts` (`browserModuleList`),
  `lib/common/api/module-list.ts` (`commonModuleList`: `nativeImage`,
  `shell`), `lib/renderer/api/module-list.ts`, and per-target lists under
  `lib/sandboxed_renderer/api/`, `lib/utility/api/` and `lib/preload_realm/api/`.
- Each entry is `{ name, loader: () => require(...) }`.
  `lib/common/define-properties.ts` turns entries into enumerable **lazy
  getters**, unwrapping ES-module `default` exports. Modules are therefore not
  loaded until first accessed.

## Native bindings: `process._linkedBinding`

C++ API modules register themselves as Node *linked* bindings with
`NODE_LINKED_BINDING_CONTEXT_AWARE(name, Initialize)` (macro in
`shell/common/node_includes.h`). Registration is explicit rather than via
static constructors: `node_bindings.cc` declares the binding lists
`ELECTRON_BROWSER_BINDINGS`, `ELECTRON_COMMON_BINDINGS`,
`ELECTRON_RENDERER_BINDINGS`, `ELECTRON_UTILITY_BINDINGS` (plus
`ELECTRON_TESTING_BINDINGS` in DCHECK builds), and
`NodeBindings::RegisterBuiltinBindings()` registers only the lists appropriate
to the current process type. Consequently a browser-only binding such as
`electron_browser_app` simply does not exist in a renderer.

TypeScript wrappers fetch bindings with `process._linkedBinding('<name>')`
(typed overloads live in `typings/internal-ambient.d.ts`). A typical wrapper,
e.g. `lib/browser/api/app.ts`, grabs the native singleton, sets its prototype
to Node's `EventEmitter.prototype`, and adds JS-only properties and helpers.

## gin and gin_helper object model

`shell/common/gin_helper/` contains Electron's helpers on top of Chromium's
`gin` V8 binding library:

- **Wrappable** — binds a C++ object to a JS wrapper. Newer APIs (e.g. `App`,
  `Session`, `gin_helper::internal::Event`) use `gin::Wrappable<T>`;
  `gin_helper::DeprecatedWrappable` remains for older classes. `T::BuildPrototype`
  / `GetObjectTemplateBuilder` defines the JS methods and properties.
- **EventEmitter<T>** — `Emit(name, args…)` creates an `Event` object,
  calls the JS `emit`, and returns whether `preventDefault()` was called; this
  is how C++ observers surface events such as `will-navigate` that JS can
  cancel. `EmitWithoutEvent` skips the event object. Because JS handlers can
  destroy `this`, `Emit` captures what it needs before calling into JS.
- **TrackableObject<T>** — gives each instance a stable integer id stored in
  a per-class `KeyWeakMap` so objects can be looked up from C++ by id
  (`FromWeakMapID`) and enumerated (`GetAll`). `MarkDestroyed()` clears the
  wrapper's internal field so later JS calls see a destroyed object instead of
  dangling memory.
- **Converters** — `shell/common/gin_converters/` holds `gin::Converter`
  specializations for Chromium/Electron types (GURL, gfx geometry, accelerators,
  net types, file dialogs, images, `base::Value`, etc.), keeping argument
  marshalling out of API classes.
- Other helpers: `Promise` (resolving JS promises from C++), `Arguments` /
  `ErrorThrower`, `CleanedUpAtExit`, `SelfKeepAlive` and `Pinnable` for
  lifetime control.

## Extending

Adding an API touches every layer described here; follow
[Workflow: adding or changing an API](../workflows/adding-an-api.md). Startup
ordering around these bundles is described in
[Process model and main-process startup](process-model-and-startup.md), and
the surrounding directory structure in
[Repository layout and layering](repository-layout.md).
