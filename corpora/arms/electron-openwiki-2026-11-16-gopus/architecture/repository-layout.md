---
type: architecture
title: Repository layout and layering
description: Map of the Electron repository — how it lives at src/electron inside a Chromium checkout, and how lib/ (TypeScript API layer), shell/ (C++ content embedder plus Node integration), chromium_src, patches, build, typings, docs, spec, script and npm relate to each other.
tags: [architecture, layout, overview, chromium, gn]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-af2b637fa5845c2e8812334b
    resource: repo://chromium_src/BUILD.gn
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-6e7e12784707db2047a4c4d5
    resource: repo://filenames.auto.gni
  - id: openwiki-source-06306918f0e6a90a63126d92
    resource: repo://filenames.gni
  - id: openwiki-source-cfc1068e5c6e75790a881dac
    resource: repo://patches/config.json
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Repository layout and layering

This repository is **not built on its own**. It is checked out by `gclient`
as `src/electron` inside a full Chromium source tree. `DEPS` pins Chromium
(`src`), Node.js (`src/third_party/electron_node`), `nan`, Squirrel.Mac and
other dependencies, and its hooks apply Electron's patches to them after sync.
GN labels therefore look like `//electron:electron_lib` and refer to Chromium
paths such as `//chrome/browser/...` directly. See
[GN build, DEPS and build configuration](../build/gn-build-and-deps.md).

## Layers

```
 app code (user's main.js / preload / pages)
        │ require('electron')
 lib/   TypeScript API layer, one webpack bundle per process type
        │ process._linkedBinding('electron_…')
 shell/ C++: Chromium content-API embedder + Node.js embedding + gin bindings
        │
 Chromium content/, Blink, V8, //chrome bits (chromium_src), Node.js
        (with patches/ applied)
```

### `lib/` — the JavaScript surface

TypeScript compiled by webpack into bundles embedded in the binary
([JS bundles, module lists and native bindings](js-bundles-and-native-bindings.md)).
Subdirectories map to execution environments, not features:

| Directory | Runs in |
| --- | --- |
| `lib/browser/` (+ `api/`) | main process: `init.ts`, internal IPC (`ipc-main-*`, `rpc-server.ts`), `guest-view-manager.ts`, `guest-window-manager.ts`, public API wrappers |
| `lib/common/` (+ `api/`) | shared by all bundles: `init.ts` (electron module hook), `ipc-messages.ts`, deprecation helpers, `nativeImage`/`shell` |
| `lib/renderer/` (+ `api/`, `web-view/`) | Node-integrated renderers; also reused by sandboxed bundles |
| `lib/sandboxed_renderer/` | sandboxed preload environment |
| `lib/isolated_renderer/` | main-world bundle that sets up `<webview>` |
| `lib/preload_realm/` | service-worker preload ShadowRealm |
| `lib/worker/` | Node in dedicated web workers |
| `lib/utility/` | `utilityProcess` children |
| `lib/node/` | every Node environment (`asar-fs-wrapper.ts`, fork hook) |

### `shell/` — the C++ embedder

| Directory | Responsibility |
| --- | --- |
| `shell/app/` | process entrypoints (`electron_main_*.cc`), `ElectronMainDelegate`, `ElectronContentClient`, node mode (`node_main.cc`), crash reporter client |
| `shell/browser/` | browser process: `ElectronBrowserClient`, `ElectronBrowserMainParts`, `Browser` lifecycle, `NativeWindow*`, `ElectronBrowserContext`, permissions, downloads, protocol registry, DevTools, Chrome-extension support (`extensions/`), networking (`net/`), offscreen rendering (`osr/`), platform UI (`ui/`, `mac/`, `win/`, `linux/`) |
| `shell/browser/api/` | `electron_api_*.cc` — the C++ halves of main-process APIs (`app`, `BrowserWindow`/`BaseWindow`, `webContents`, `session`, `protocol`, `Menu`, `Tray`, `utilityProcess`, …) |
| `shell/renderer/` | renderer clients, frame observer, context bridge, renderer APIs (`ipcRenderer`, `webFrame`), preload realms |
| `shell/common/` | code for all processes: `NodeBindings`, `gin_helper/`, `gin_converters/`, ASAR reader (`asar/`), common APIs (`clipboard`, `nativeImage`, `shell`), mojom interfaces (`api/api.mojom`), command-line switch names (`options_switches.h`) |
| `shell/services/node/` | `NodeService` — the Node runtime inside utility processes |
| `shell/utility/` | `ElectronContentUtilityClient` |

The C++ sources are listed explicitly in `filenames.gni`
(`lib_sources`, `lib_sources_{mac,win,linux,posix,views,extensions}`, …) and
compiled by the `electron_lib` source set in `BUILD.gn`; adding a `.cc`
file requires editing that list. The JS bundle inputs and API doc list are
in the generated `filenames.auto.gni` instead.

### `chromium_src/`

Not copied source anymore: `chromium_src/BUILD.gn` defines a `chrome`
static library (visible only to `//electron:electron_lib`) that compiles a
curated list of files directly from Chromium's `//chrome/...` and other
non-content directories (DevTools helpers, browser process pieces, printing,
spellcheck, etc.) that Electron reuses without depending on the full Chrome
browser target.

### `patches/`

Patch series applied to Chromium, V8, Node, BoringSSL, FFmpeg, DevTools
frontend, Squirrel.Mac and others, mapped to target checkouts by
`patches/config.json`. See
[Patching Chromium, Node and other dependencies](../build/chromium-and-node-patches.md).

### Build and tooling

- `BUILD.gn`, `build/` (GN templates for webpack, tsc, npm, asar, js2c,
  fuses, mac packaging), `buildflags/` (feature flags) and `build/args/`
  (GN args presets). See
  [Fuses and build flags](../systems/fuses-and-build-flags.md).
- `script/` — lint, patch, spec runner, release and helper scripts
  (Node/TypeScript and Python).
- `typings/` — `internal-ambient.d.ts` and `internal-electron.d.ts`, internal
  typings for `lib/` (linked bindings, private methods). Public typings
  (`electron.d.ts`) are generated from `docs/api` by
  `npm run create-typescript-definitions`.

### Docs, tests, distribution

- `docs/` — public API reference (`docs/api/*.md`, the source of truth for the
  generated TypeScript definitions), tutorials, development guides
  (`docs/development/`), `breaking-changes.md`, and Fiddle snippets.
- `spec/` — the main Mocha test suite, itself an Electron app; see
  [Testing: spec runner and test suites](../testing/spec-runner.md).
- `npm/` — the `electron` npm package that downloads prebuilt binaries; see
  [Releases and npm distribution](../operations/release-and-npm-distribution.md).
- `default_app/` — the app shown when `electron` runs without an app; see
  [Process model and main-process startup](process-model-and-startup.md).

## Navigating a feature end-to-end

Most API features span the same stack. For example `BrowserWindow`:

1. Docs: `docs/api/browser-window.md` (typings + docs site).
2. JS wrapper: `lib/browser/api/browser-window.ts`, listed in
   `lib/browser/api/module-list.ts`.
3. Native binding: `shell/browser/api/electron_api_browser_window.cc`,
   registered as `electron_browser_window` in `shell/common/node_bindings.cc`.
4. Platform implementation: `shell/browser/native_window_views.cc` /
   `native_window_mac.mm`.
5. Tests: `spec/api-browser-window-spec.ts`.

The [adding-an-API workflow](../workflows/adding-an-api.md) lists every file
to touch.
