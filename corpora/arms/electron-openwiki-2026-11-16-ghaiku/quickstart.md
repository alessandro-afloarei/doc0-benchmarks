---
type: guide
title: Quickstart
description: Entry point for the Electron repository. Explains what the repository contains, how its directories map to the runtime layers (native shell, JavaScript API, build and patch pipeline, tests, and docs), and which wiki page to read for each common task such as changing an API, debugging startup, building, testing, upgrading Chromium, or preparing a release.
tags: [quickstart, overview, navigation, electron, repository-layout, task-routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-948a7a9d83defa7e291d47d4
    resource: repo://build/fuses/fuses.json5
  - id: openwiki-source-7ca9d05ab2240d0c837898d6
    resource: repo://default_app/main.ts
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-239321880d72bdb70fefc892
    resource: repo://lib/browser/api/module-list.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Quickstart

This repository is the source of Electron: the framework that packages Chromium and Node.js into a desktop runtime, and exposes them to apps through a JavaScript API. Application developers consume prebuilt binaries through npm. The code here builds those binaries.

## Repository layout

| Path | What it contains | Read first |
| --- | --- | --- |
| `shell/` | C++ for the browser (main) process, renderer, utility process, and shared bindings. | [Architecture Overview](architecture/overview.md), [Browser Main Process](architecture/browser-main-process.md) |
| `lib/` | TypeScript for the public JavaScript API, grouped by process type (`browser/`, `renderer/`, `common/`, `node/`, `utility/`, `worker/`, and others). | [JavaScript API Layer](architecture/js-api-layer.md) |
| `build/`, `BUILD.gn`, `filenames*.gni`, `buildflags/` | GN and webpack build rules, fuse generation, and build flags. | [Building Electron with GN and Ninja](workflows/build-and-gn.md) |
| `patches/`, `chromium_src/`, `DEPS` | Pinned upstream revisions and the patch stack applied to Chromium, Node.js, V8, and other trees. | [Chromium, Node, and V8 Patch Stack](integrations/chromium-node-v8-patches.md) |
| `spec/` | Electron's own test app (Mocha) and fixtures. | [Test Suite (spec/) and Test Runners](workflows/testing-spec-suite.md) |
| `script/` | Build, lint, patch, test, and release scripts. `script/release/` holds the release tooling. | [Linting and Formatting](workflows/linting.md), [CI Pipelines and Release Automation](workflows/ci-pipelines.md) |
| `docs/` | Public API documentation (`docs/api/`), tutorials, and contributor guides (`docs/development/`). | [API Documentation, Typings, and API History](workflows/api-docs-and-typings.md) |
| `default_app/` | The fallback app that runs when no app is found in the search path. | [ASAR Archives and Module Loading](architecture/asar-and-module-loading.md) |
| `.github/` | GitHub Actions workflows and composite actions for CI, publishing, and release. | [CI Pipelines and Release Automation](workflows/ci-pipelines.md) |
| `openwiki/` | This generated wiki. | Start here. |

## How the runtime fits together

1. A process starts from the Electron executable and runs as one of several roles: browser (main), renderer, utility, worker, or a plain Node.js child. See [Process Model and Startup](architecture/process-model.md).
2. Each role runs a bundled init script built from `lib/`, which sets up Node.js and exposes the public modules.
3. Those modules call native objects in `shell/` through `process._linkedBinding`. See [Native Bindings](architecture/native-bindings.md).
4. Processes exchange messages through the IPC layer. See [IPC Between Main, Renderer, and Utility Processes](architecture/ipc.md).
5. App code is read from `.asar` archives, and compile-time fuses decide which runtime features are available. See [ASAR Archives and Module Loading](architecture/asar-and-module-loading.md) and [Fuses and ASAR Integrity](concepts/fuses-and-integrity.md).

## Common tasks

- **Understand the architecture.** Read [Architecture Overview](architecture/overview.md), then the page for the layer you need.
- **Change or add a public API.** Update the Markdown in `docs/api/`, then the `lib/` module, then the native binding in `shell/`. Follow [API Documentation, Typings, and API History](workflows/api-docs-and-typings.md), [JavaScript API Layer](architecture/js-api-layer.md), and [Native Bindings](architecture/native-bindings.md).
- **Work on window or session behavior.** See [Browser Main Process](architecture/browser-main-process.md).
- **Work on messaging between processes.** See [IPC Between Main, Renderer, and Utility Processes](architecture/ipc.md).
- **Debug startup or process roles.** See [Process Model and Startup](architecture/process-model.md).
- **Change how app code is loaded or verified.** See [ASAR Archives and Module Loading](architecture/asar-and-module-loading.md) and [Fuses and ASAR Integrity](concepts/fuses-and-integrity.md).
- **Build Electron from source.** See [Building Electron with GN and Ninja](workflows/build-and-gn.md).
- **Run tests.** See [Test Suite (spec/) and Test Runners](workflows/testing-spec-suite.md).
- **Lint or format a change.** See [Linting and Formatting](workflows/linting.md).
- **Modify a Chromium, Node.js, or V8 patch.** See [Chromium, Node, and V8 Patch Stack](integrations/chromium-node-v8-patches.md) and [Chromium Upgrade and Patch Maintenance Workflow](workflows/chromium-upgrade-and-patch-workflow.md).
- **Upgrade Chromium or Node.js.** See [Chromium Upgrade and Patch Maintenance Workflow](workflows/chromium-upgrade-and-patch-workflow.md).
- **Package, sign, or check release artifacts.** See [Code Signing, Packaging, and Distribution Artifacts](concepts/code-signing-and-packaging.md).
- **Change CI or the release process.** See [CI Pipelines and Release Automation](workflows/ci-pipelines.md).

## Ground rules for changes

- Keep the three layers consistent. A native change that alters a binding usually needs a matching `lib/` change and a documentation change.
- Patches to upstream trees need a stated reason in the commit message, and they are checked by lint and by CI (see [Chromium, Node, and V8 Patch Stack](integrations/chromium-node-v8-patches.md)).
- New C++ files must be listed in the `filenames*.gni` lists, and new TypeScript modules must be reachable from a bundle entry. Otherwise they are not compiled or bundled.
- Fuse values are compile-time defaults. Changing a fuse's meaning breaks packaged apps, so fuses are only appended, never repurposed.

## Related pages

- [Architecture Overview](architecture/overview.md)
- [Process Model and Startup](architecture/process-model.md)
- [JavaScript API Layer](architecture/js-api-layer.md)
- [Building Electron with GN and Ninja](workflows/build-and-gn.md)
- [Test Suite (spec/) and Test Runners](workflows/testing-spec-suite.md)
