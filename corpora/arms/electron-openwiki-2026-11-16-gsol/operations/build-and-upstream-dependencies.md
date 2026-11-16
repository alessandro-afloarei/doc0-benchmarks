---
type: operations
title: Building Electron and managing upstream dependencies
description: The gclient checkout layout, DEPS hooks, GN and webpack build graph, and ordered upstream patch workflow.
tags: [build, gn, dependencies, patches, chromium, node]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
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
  - id: openwiki-source-cfc1068e5c6e75790a881dac
    resource: repo://patches/config.json
  - id: openwiki-source-298a1003742dda5b1f8a35be
    resource: repo://script/apply_all_patches.py
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
  - id: openwiki-source-44a65a63d73c4493c309e083
    resource: repo://script/lib/patches.py
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Building Electron and managing upstream dependencies

Electron's framework build spans a Chromium checkout, an Electron checkout nested inside it, and upstream dependency repositories. Installing the repository's JavaScript dependencies alone does not produce the Electron executable.

## Checkout and working directories

The documented layout is `<workspace>/src` for Chromium, `<workspace>/src/electron` for this repository, and `src/third_party/electron_node` for Node. GN commands run from `src`; repository npm scripts run from `src/electron`.

After installing depot_tools and platform prerequisites, the [manual build guide](../../docs/development/build-instructions-gn.md) starts with:

```sh
mkdir electron-workspace
cd electron-workspace
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

Check [Linux](../../docs/development/build-instructions-linux.md), [macOS](../../docs/development/build-instructions-macos.md), or [Windows](../../docs/development/build-instructions-windows.md) prerequisites first. The guide also describes Electron Build Tools as an alternative that automates setup.

## Dependency synchronization is part of the build

`DEPS` pins Chromium, Node, and supporting projects and maps them into the workspace. Its hooks conditionally apply Electron patches, restore patched-file modification-time caches, install frozen Yarn dependencies, and provision platform resources such as sysroots.

When changing branches or dependency revisions, synchronize the surrounding checkout against DEPS before diagnosing compile failures. A source checkout with mismatched upstream revisions can fail even when Electron's own files are consistent. The `apply_patches`, checkout, and `process_deps` variables control which hooks execute; inspect them when a patch or dependency appears absent.

## Generate and compile

From `<workspace>/src` on Linux or macOS:

```sh
export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools"
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
ninja -C out/Testing electron
```

Testing is an optimized, non-component configuration with DCHECKs enabled and `symbol_level = 1`; it is not a conventional `is_debug=true` build. Release imports the common arguments and enables an official build. Use `gn args out/Testing` to change configuration and the platform guide for Windows shell syntax.

Outputs live under the Chromium `src/out/<configuration>` directory. `script/lib/utils.js` resolves this relative to Electron's parent directory, so repository scripts depend on the expected checkout layout. Select a custom configuration with `ELECTRON_OUT_DIR`.

## JavaScript inside the native build

BUILD.gn declares separate webpack targets for runtime environments and feeds their results into `electron_js2c`. Webpack chooses the appropriate `lib/<target>/init.ts` and Electron export module, aliases internal imports, and supplies build-flag definitions and environment-specific globals.

`script/gen-filenames.ts` measures each webpack dependency graph and regenerates `filenames.auto.gni`. Native source lists live in `filenames.gni`. A new API may need updates to both the native build inventory and generated JavaScript dependencies; see [extending APIs](../workflows/extending-electron-apis.md).

## Maintaining upstream patches

`patches/config.json` maps patch directories to upstream repositories. Within a patch directory, `.patches` defines application order. `apply_all_patches.py` imports these ordered series; missing target repositories emit a warning and are skipped. Setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` enables three-way import behavior.

The [patch workflow](../../docs/development/patches.md) explains editing upstream commits and exporting them through `git-export-patches`. Export ignores uncommitted changes. Each patch needs a reason to exist, because even a clean application and successful compilation do not establish that a patch still has its intended effect after an upstream roll.

For conflicts, follow the documented import/rebase recovery procedure and preserve unrelated upstream work. After a roll or patch edit, compile the affected target and run behavioral tests for the modified boundary, especially Node embedding, navigation, or network behavior.

## Next steps

Use [runtime and API testing](../testing/runtime-and-api-tests.md) to validate a local build. Create distributable archives with `ninja -C out/Release electron:electron_dist_zip`; [distribution and release](distribution-and-release.md) explains how these artifacts reach npm installations.
