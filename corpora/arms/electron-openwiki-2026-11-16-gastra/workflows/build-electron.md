---
type: workflow
title: Build Electron from source
description: Full dependency checkout layout, GN and Ninja commands, process bundle embedding, generated declarations, and build-to-test artifact relationships.
tags: [build, gn, ninja, webpack, dependencies]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-7c03237a6b57ffb3e526a51b
    resource: repo://.nvmrc
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-f46d5bad520e315f61552c31
    resource: repo://build/args/all.gn
  - id: openwiki-source-8c67fa9ef643396b45de02ad
    resource: repo://build/args/release.gn
  - id: openwiki-source-c53eb66f6313d5072e2a9dad
    resource: repo://build/args/testing.gn
  - id: openwiki-source-5521173dd114c87305d5bc7d
    resource: repo://build/webpack/webpack.config.base.js
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Build Electron from source

Building this repository produces the Electron framework itself. It requires the surrounding Chromium/Node dependency checkout, platform toolchains, and generated resources. Installing the published electron npm package is a separate path for application development.

## Checkout layout and prerequisites

Use the repository's platform prerequisites for [Linux](../../docs/development/build-instructions-linux.md), [macOS](../../docs/development/build-instructions-macos.md), or [Windows](../../docs/development/build-instructions-windows.md), then follow the [GN build guide](../../docs/development/build-instructions-gn.md). The guide offers Electron build-tools or manual depot_tools setup.

The manual setup uses this layout:

```text
workspace/
  src/                         Chromium source root and GN working directory
    electron/                  This Git repository
    third_party/electron_node/ Vendored Node checkout
    out/Testing/               Build products
```

From a new workspace directory:

```sh
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

DEPS specifies the Chromium checkout at src and Node at src/third_party/electron_node, along with other pinned dependencies. Its hooks apply Electron patches and install repository JavaScript dependencies with a pinned Yarn and frozen lockfile. After changing revisions, synchronize dependencies according to DEPS; a Git pull in electron alone does not update the surrounding tree.

The repository's .nvmrc selects Node 20 for development tooling. That is distinct from the Node revision embedded in Electron, which DEPS controls. Read these files when choosing tool versions rather than assuming they match.

## Configure and compile

From the full checkout's src directory on Linux/macOS:

```sh
export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools"
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
ninja -C out/Testing electron
ninja -C out/Testing electron:node_headers
```

For a release configuration:

```sh
gn gen out/Release --args='import("//electron/build/args/release.gn")'
ninja -C out/Release electron
```

The Testing preset is not a conventional debug build: it sets is_debug=false, keeps DCHECKs enabled, is_official_build=false, and symbol_level=1. Release enables official-build behavior. Both import all.gn, which configures Electron's root dependency, Node ABI number, V8 settings and shared framework choices. Both explicitly use component FFmpeg while disabling the overall component build.

Use gn args out/Testing to modify an existing configuration and gn args out/Testing --list to inspect options. Cross-compilation depends on Chromium's supported host/target combinations; target_cpu and target_os alone do not supply a missing toolchain.

The executable is out/Testing/electron on Linux, electron.exe on Windows, or Electron.app/Contents/MacOS/Electron on macOS. Windows environment syntax and toolchain setup are documented separately in the linked build guide.

## How JavaScript enters the binary

The build graph has an important generated-code chain:

```mermaid
flowchart LR
  D[API documentation] --> T[Generated Electron declarations]
  T --> W[Process-specific webpack bundles]
  W --> J[js2c and electron_natives.cc]
  J --> N[electron_lib and native application]
  T --> A[Default app TypeScript]
  A --> S[resources/default_app.asar]
```

BUILD.gn generates declarations for both IDE use and compilation, then builds browser, renderer, sandboxed renderer, isolated renderer, worker, Node, utility and preload-realm bundles. electron_js2c passes those bundles to the Node js2c tool and produces electron_natives.cc. electron_lib depends on this generated source, buildflags, resources, Mojo interfaces and native components.

The webpack base configuration chooses lib/<target>/init.ts or init.js, maps Electron imports to the selected process export entry, and adapts globals depending on whether Node is present or its globals will later be deleted. This is why changing an Electron import or preload global can affect multiple bundles.

The default application is separately compiled and packaged as resources/default_app.asar. It is a build artifact, not the source location of core Electron API implementations.

## Adding files and diagnosing failures

Generated filenames lists supply bundle dependency inputs and API docs to GN. script/gen-filenames.ts obtains webpack dependency graphs; package hooks regenerate lists for relevant JS/TS and API-doc edits. Check those inputs when a newly added file is missing from an incremental build.

Classify failures before changing configuration:

- Missing Chromium/Node paths: verify the full gclient layout and synchronization.
- Patch import failures: use the [patch workflow](dependency-patches.md).
- Type or bundle errors: inspect generated API declarations and the specific process webpack config.
- Spec addon build failures: generate node_headers for the selected output and follow [validation](../testing/validation.md).
- Missing distributable resources: inspect the GN data dependencies and [distribution target](../operations/distribution.md).

These commands describe the repository workflow; a source-only checkout does not imply that its dependency tree or build products are already available.
