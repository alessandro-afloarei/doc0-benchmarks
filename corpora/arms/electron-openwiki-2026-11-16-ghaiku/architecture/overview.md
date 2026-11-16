---
type: architecture
title: Architecture Overview
description: High-level map of Electron as Chromium plus embedded Node.js, with a JavaScript API layer in lib/ over native C++ in shell/. Shows how the entry point, process types, native bindings, bundled JavaScript, and the Chromium/Node/V8 patch and build pipeline fit together.
tags: [architecture, overview, chromium, node, electron-main, subsystems]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-a04c5f62f99a2b5c90857176
    resource: repo://lib/browser/ipc-dispatch.ts
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Architecture Overview

Electron combines three large codebases into one desktop runtime: Chromium (rendering, multi-process model, networking, GPU), Node.js (JavaScript runtime and module system), and Electron's own code. Electron's code is split into three layers:

1. **Native shell (`shell/`)**: C++ that starts Chromium and Node together, implements the browser and renderer processes, and exposes native objects to JavaScript.
2. **JavaScript API (`lib/`)**: TypeScript that implements the public modules (`app`, `BrowserWindow`, `ipcMain`, `net`, and others) on top of the native objects. It is bundled per process type and compiled into the binary.
3. **Build and patch pipeline (`build/`, `BUILD.gn`, `DEPS`, `patches/`, `chromium_src/`, `script/`)**: GN and webpack build configuration, the patch stack applied to Chromium, Node, and V8, and the scripts that maintain them.

## Start-up path

The binary has one `main` in `shell/app/electron_main_linux.cc` (and platform-specific equivalents for macOS and Windows). It does the following:

- It initializes the command line and `ElectronCommandLine`.
- If the `run_as_node` fuse is enabled and the `ELECTRON_RUN_AS_NODE` environment variable is set, it calls `electron::NodeMain()` from `shell/app/node_main.cc` and runs as plain Node.js.
- Otherwise it creates an `ElectronMainDelegate` (`shell/app/electron_main_delegate.{h,cc}`) and calls `content::ContentMain`. The delegate is Chromium's hook for process start-up. It creates the browser client (`CreateContentBrowserClient`), the utility client (`CreateContentUtilityClient`), and the renderer client (`CreateContentRendererClient`, which chooses a sandboxed or ordinary renderer client based on the sandbox setting). `RunProcess` routes the relauncher process type.

From there, the browser process runs `ElectronBrowserMainParts`, which starts the embedded Node environment and runs the bundled `browser_init` script. Each renderer, utility, and worker process runs its own bundled init. See [Process Model and Startup](process-model.md) for the full sequence.

## Subsystem map

| Subsystem | Location | What it owns |
| --- | --- | --- |
| Process model | `shell/app/`, `shell/browser/electron_browser_main_parts.cc`, `shell/renderer/`, `shell/utility/` | Startup, per-process hooks, and lifecycle. |
| Browser (main) process | `shell/browser/` | Windows, sessions, menus, tray, networking, and the main-process APIs. See [Browser Main Process](browser-main-process.md). |
| Renderer | `shell/renderer/` | Renderer-side APIs (`ipcRenderer`, `webFrame`, context bridge) and preload handling. |
| Native bindings | `shell/common/gin_helper/`, `shell/common/gin_converters/`, `shell/common/api/` | The C++-to-V8 bridge and shared APIs. See [Native Bindings](native-bindings.md). |
| JavaScript API | `lib/` | Public modules bundled per process type. See [JavaScript API Layer](js-api-layer.md). |
| IPC | `shell/common/api/api.mojom`, `lib/browser/ipc-dispatch.ts`, `lib/renderer/` | Messaging across processes. See [IPC Between Main, Renderer, and Utility Processes](ipc.md). |
| ASAR and module loading | `shell/common/asar/`, `lib/node/` | Reading app code from archives. See [ASAR Archives and Module Loading](asar-and-module-loading.md). |
| Fuses | `build/fuses/` | Compile-time feature switches read at runtime. See [Fuses and ASAR Integrity](../concepts/fuses-and-integrity.md). |
| Chromium/Node/V8 integration | `DEPS`, `patches/`, `chromium_src/`, `script/*patch*` | Pinned upstream revisions and the patch stack. See [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md). |
| Build | `BUILD.gn`, `build/`, `filenames*.gni`, `buildflags/` | GN targets, webpack bundles, and generated files. See [Building Electron with GN and Ninja](../workflows/build-and-gn.md). |

## How the layers connect

- A call such as `new BrowserWindow()` runs `lib/browser/api/browser-window.ts`, which calls a native class from `shell/browser/api/`. The native class creates a `NativeWindow` (see [Browser Main Process](browser-main-process.md)).
- Native objects reach JavaScript through `process._linkedBinding('<name>')`, and `lib/` modules keep the public surface stable while the implementation changes.
- Messages between processes use the Mojo `ElectronApiIPC` and `ElectronRenderer` interfaces, and they are dispatched as `-ipc-*` events that `lib/browser/ipc-dispatch.ts` fans out to the public `ipcMain` and internal emitters.
- Chromium and Node behavior that Electron changes is kept in the patch stack, not in the Electron tree. Electron-specific Chromium hooks are in `chromium_src/` overrides and in `shell/` subclasses such as `ElectronBrowserClient`.

## Invariants that cut across layers

- The `lib/` bundles and the native binary are built together. A change to the JavaScript API requires a rebuild, and bundles are embedded as C++ source.
- Process-type checks decide which bundle runs and which binding names are visible. Code that depends on a process type must be placed in the matching `lib/<process>/` directory.
- Fuses are compile-time defaults. Some are checked at process start, before JavaScript runs.
- Node.js is a separate third-party tree (`../third_party/electron_node` in the GN build) and is versioned through `DEPS`. Electron's `shell/` code calls into Node's embedding API.

## Where to look next

- For behavior of a specific API, start with the matching `docs/api/` page and `lib/*/api/` module, then follow the native binding.
- For the build, start with [Building Electron with GN and Ninja](../workflows/build-and-gn.md).
- For contributing to Chromium or Node patches, start with [Chromium Upgrade and Patch Maintenance Workflow](../workflows/chromium-upgrade-and-patch-workflow.md).

## Related pages

- [Process Model and Startup](process-model.md)
- [JavaScript API Layer](js-api-layer.md)
- [Native Bindings](native-bindings.md)
- [Chromium, Node, and V8 Patch Stack](../integrations/chromium-node-v8-patches.md)
