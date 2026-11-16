---
type: guide
title: Quickstart
description: Entry point for the Electron source repository, covering what the repository contains, the layer map from Chromium through the C++ shell and lib/ TypeScript runtime to the build and test toolchain, the top-level directory layout, and routing to the detailed pages for building, testing, adding an API, patching upstream, debugging processes, and releasing.
tags: [electron, quickstart, overview, navigation, onboarding, repository-map]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-43c41f18d49c25a86be5e9ae
    resource: repo://.husky/pre-commit
  - id: openwiki-source-9235a60f74870443a2f8379b
    resource: repo://.husky/pre-push
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-cd0201cca1cac030ad487fa2
    resource: repo://docs/development/source-code-directory-structure.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-890aa2f7845d954a96cefaac
    resource: repo://script/start.js
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Quickstart

This repository is the source for Electron, the framework that runs Node.js and web content inside a Chromium-based desktop application. It is not a copy of Chromium or Node.js. It contains the Electron layer: the C++ shell, the TypeScript runtime, the public API docs, the patches applied to upstream projects, and the build and test system. The upstream versions are pinned in `DEPS`, currently Chromium `141.0.7361.0` and Node.js `v22.18.0`.

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Read the [Architecture Overview](/openwiki/architecture/overview.md) first if you need the full picture. This page gives the layer map, the directory layout, and the shortest route to the page for each common task.

## Layers

From the bottom up:

<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Upstream engines**, fetched by `gclient` and patched in place. The patch set lives in `patches/`, and `chromium_src/` holds the GN overlay for Chromium's `chrome/` sources. See [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md).
<!-- openwiki: broken internal link [/openwiki/architecture/native-shell.md] link "/openwiki/architecture/native-shell.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **C++ shell** in `shell/`. Its entry points are in `shell/app/`, the browser process is in `shell/browser/`, the renderer is in `shell/renderer/`, and shared code is in `shell/common/`. See [Native Shell (C++)](/openwiki/architecture/native-shell.md).
<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **TypeScript runtime** in `lib/`. It is bundled per process type by webpack and embedded into the binary. See [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md).
<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. **Public contract** in `docs/api/`, parsed into `electron.d.ts`. See [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md).
5. **Toolchain**: `BUILD.gn`, `build/`, `buildflags/`, `filenames.gni`, `script/`, `spec/`, and `.github/`.

## Directory layout

The top-level directories, as described in `docs/development/source-code-directory-structure.md`, are:

- `shell/`, the C++ implementation of the browser, renderer, and shared layers.
- `lib/`, the TypeScript and JavaScript runtime for each process type.
- `docs/`, the API reference (`docs/api/`), tutorials, and development guides.
- `patches/`, the patch files for Chromium, Node.js, V8, and other dependencies.
- `build/`, the GN helper templates, webpack configurations, fuse generator, and argument profiles under `build/args/`.
- `spec/`, the Electron test app and its fixtures, plus the type-smoke test under `spec/ts-smoke/`.
- `script/`, the developer and release tooling, including `spec-runner.js`, `lint.js`, and the release scripts under `script/release/`.
- `default_app/`, the app that runs when Electron starts without an application.
- `BUILD.gn` and the `filenames*.gni` files, which name every source file in each platform build.
- `.github/`, the CI workflows and composite actions.

## Common tasks

| Task | Start here |
| --- | --- |
<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Build Electron from source | [Building Electron](/openwiki/workflows/building.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/testing.md] link "/openwiki/workflows/testing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Run tests or a subset of them | [Testing](/openwiki/workflows/testing.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Lint, format, or prepare a pull request | [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/native-shell.md] link "/openwiki/architecture/native-shell.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Add or change a public API | [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md), then [Native Shell (C++)](/openwiki/architecture/native-shell.md) for the C++ binding |
<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Change a Chromium, Node.js, or V8 file | [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Trace a message between processes | [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Understand a security default or fuse | [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md) |
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Understand CI pipelines or a release | [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md) |

## Commands to know

- `npm run lint` runs the code lint gates and the docs lint chain.
- `npm test` runs the main-process spec suite against the built binary. `npm run test -- -g <pattern>` narrows it to matching test titles.
- `npm start` runs `script/start.js`, which launches the built Electron executable with the given arguments.
- `gn gen out/Testing --args='import("//electron/build/args/testing.gn")'` creates a testing build directory, and `ninja -C out/Testing electron` builds the binary.
- `npm run create-typescript-definitions` regenerates `electron-api.json` and `electron.d.ts`.

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
These commands assume the `gclient` checkout described in [Building Electron](/openwiki/workflows/building.md). The `src/electron` directory is the repository itself, so commands run from there.

## Where changes are checked

A change to this repository is checked in three places:

- Locally, the git hooks in `.husky/` run `lint-staged` before commit and `check-for-leaks` before push.
- In CI, the lint pipeline runs `yarn lint` and the script typechecker, and the build and test pipelines run the full suite on each supported platform.
- At release time, the release scripts validate draft assets before publishing.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) gives the layering and entry points in more depth.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md) explains how the processes communicate.
