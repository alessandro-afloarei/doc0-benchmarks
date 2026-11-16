---
type: architecture
title: Architecture Overview
description: System-level map of Electron, showing how Chromium, Node.js, V8, the C++ shell, the TypeScript runtime in lib/, the upstream patch set, and the docs and test toolchain fit together, and which process or layer owns each responsibility.
tags: [electron, architecture, chromium, node, v8, overview, processes, layering]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-b63cd99a26c5ff7b460c305e
    resource: repo://build/webpack/webpack.gni
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-0ef63a79bc3c177e23fdd1f4
    resource: repo://shell/app/electron_library_main.h
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-d9f1d2383a518360722e4aba
    resource: repo://shell/app/electron_main_linux.cc
  - id: openwiki-source-25061abd2b5a1b1967512015
    resource: repo://shell/app/electron_main_win.cc
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Architecture Overview

Electron is a framework that runs Node.js and JavaScript inside a Chromium browser process. This repository is the Electron layer itself: the C++ shell, the TypeScript runtime, the build and test system, and the patches that make upstream Chromium and Node.js fit Electron's use. It does not contain Chromium or Node.js source. Those are fetched at a pinned version by `DEPS` (currently Chromium `141.0.7361.0` and Node.js `v22.18.0`) and patched in place.

This page gives the layering and the ownership boundaries. The detailed mechanisms are on the linked pages.

## Layers

Electron stacks several layers, from the bottom up.

<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Upstream engines.** Chromium supplies the rendering, network, sandbox, and process model. Node.js and V8 supply JavaScript and the module system. Both are checked out by `gclient` according to `DEPS` and changed only through `patches/`. See [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md).
<!-- openwiki: broken internal link [/openwiki/architecture/native-shell.md] link "/openwiki/architecture/native-shell.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Electron C++ shell.** The `shell/` tree embeds Chromium's content layer through `ElectronMainDelegate` and provides the browser and renderer objects that implement windows, sessions, menus, and native modules. It also decides how Node.js is started in each process. See [Native Shell (C++)](/openwiki/architecture/native-shell.md).
<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **TypeScript runtime.** The `lib/` tree is compiled by webpack into one init bundle per process type, embedded in the binary, and run on Node's bootstrap. It defines what `require('electron')` returns in each process and wires the IPC layer. See [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md).
<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. **Public contract.** The Markdown in `docs/api/` describes the public API. It is parsed into `electron.d.ts` and checked by tests. See [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md).
<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **Toolchain.** `BUILD.gn`, `build/`, and `script/` build the binary, package it, run tests, and publish releases. See [Building Electron](/openwiki/workflows/building.md), [Testing](/openwiki/workflows/testing.md), and [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md).

## Entry points

The executable starts in platform-specific C++ entry points under `shell/app/`:

- On Linux, `electron_main_linux.cc` `main` initializes the command line. If the run-as-node fuse is enabled and the run-as-node environment variable is set, it runs `NodeMain` and exits. Otherwise it creates an `ElectronMainDelegate` and calls `content::ContentMain`.
- On macOS, `electron_main_mac.cc` provides `main`. On Windows, `electron_main_win.cc` provides `wWinMain`, which builds `content::ContentMainParams` around the same delegate.
- `electron_library_main.h` declares an `ElectronMain` symbol with default visibility, the library-style entry point for embedding Electron rather than launching it as an app.

`ElectronMainDelegate` implements Chromium's content hooks for each process type. Its `RunProcess` override returns control to Chromium, except for the relauncher process used on some platforms.

## Process types

Chromium starts several kinds of process, and Electron gives each one a JavaScript environment.

- The **browser (main) process** owns application lifetime, windows, `app`, `session`, `ipcMain`, and the native APIs that need the operating system. Its init is `lib/browser/init.ts`.
- **Renderer processes** host web pages and their preload scripts. Their init is `lib/renderer/init.ts`. A sandboxed renderer uses its own bundle from `lib/sandboxed_renderer/`, and `lib/isolated_renderer/` handles isolated renderer processes.
- **Utility processes** host Node.js code started through `utilityProcess` (`lib/utility/`), and **worker** processes host Node.js inside web workers (`lib/worker/`).
- The **preload realm** (`lib/preload_realm/`, `shell/renderer/preload_realm_context.cc`) is a separate JavaScript context for preload code.

<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
These processes exchange messages over Chromium's IPC and Mojo, and Electron wraps those messages in its own IPC API. See [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md).

## What lives where

| Responsibility | Location |
| --- | --- |
| Process entry and Chromium hooks | `shell/app/` |
| Browser-side native behavior | `shell/browser/` |
| Renderer-side native behavior | `shell/renderer/` |
| Native code shared by processes, gin bridge | `shell/common/` |
| Per-process JavaScript runtime | `lib/` |
| Public API documentation | `docs/api/` |
| Upstream patches | `patches/` |
| GN build rules and bundle generation | `BUILD.gn`, `build/`, `filenames.gni` |
| Fuses and build-time feature flags | `build/fuses/`, `buildflags/` |
| Tests | `spec/`, `script/spec-runner.js` |

## Cross-cutting mechanisms

<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Fuses.** Build-time switches recorded in the binary, for example run-as-node, `NODE_OPTIONS` handling, and ASAR-only loading. They are defined in `build/fuses/fuses.json5` and applied by `build/fuses/build.py`. Runtime code checks them through the `electron::fuses` accessors. See [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md).
- **Build flags.** `buildflags/buildflags.gni` generates `buildflags.h`, which both C++ and the webpack bundles read, so a feature can be compiled in or out consistently across the two languages.
- **Bindings.** Native modules are registered as Node linked bindings and named in `shell/common/node_bindings.cc`. The JavaScript side reaches them through `process._linkedBinding`.

## Where to start in the code

For a request that starts in JavaScript, begin at the public module in `lib/browser/api/` or `lib/renderer/api/`, follow its `_linkedBinding` call to the matching `shell/browser/api/` or `shell/renderer/api/` file, and read the `NODE_LINKED_BINDING_CONTEXT_AWARE` registration to see how the native object is exposed.

For a question about how Chromium is changed, start at `patches/` and `DEPS`. For a question about what ships, start at `BUILD.gn`, which defines the `electron` group and the `electron_lib` source set.

## Related pages

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md) routes common tasks to the detailed pages.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md) explains the messages between the processes described above.
