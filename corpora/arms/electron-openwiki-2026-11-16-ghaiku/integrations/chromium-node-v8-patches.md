---
type: integration
title: Chromium, Node, and V8 Patch Stack
description: How Electron keeps its changes to upstream Chromium, Node.js, V8, and other third-party trees. Covers the DEPS-pinned revisions, the patches/ directory layout and config.json mapping, the .patches ordering files, the import and export scripts, chromium_src overrides, and the justification rules for adding a patch.
tags: [patches, chromium, node, v8, deps, chromium_src, gclient, third-party]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-af2b637fa5845c2e8812334b
    resource: repo://chromium_src/BUILD.gn
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-1d1546e21f90bf80f08cc33d
    resource: repo://docs/development/patches.md
  - id: openwiki-source-cfc1068e5c6e75790a881dac
    resource: repo://patches/config.json
  - id: openwiki-source-298a1003742dda5b1f8a35be
    resource: repo://script/apply_all_patches.py
  - id: openwiki-source-3da20c1ddf18f064fbe879c3
    resource: repo://script/check-patch-diff.ts
  - id: openwiki-source-9ae0c16573dc5628a4c5e52c
    resource: repo://script/export_all_patches.py
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Chromium, Node, and V8 Patch Stack

Electron is built on top of pinned upstream trees. The main ones are Chromium and Node.js (`third_party/electron_node`), plus V8, FFmpeg, BoringSSL, WebRTC, and several smaller dependencies. Most of Electron's source tree is its own, but some behavior has to change inside those upstream trees. Those changes are kept as patch files in `patches/` and re-applied whenever the upstream checkout is synced. Code that can live in a separate file is kept in `chromium_src/` instead, so it does not need a patch.

## Pinned revisions

The root `DEPS` file sets the versions Electron builds against. The `vars` block has `chromium_version` (currently `141.0.7361.0`) and `node_version` (currently `v22.18.0`), along with pins for nan, squirrel.mac, ReactiveObjC, and others. The `deps` entries map each checkout path to a repository and revision. For example, `src` is Chromium, `src/third_party/electron_node` is Node.js, and `src/third_party/squirrel.mac` is the macOS updater framework. Changing a pin in `DEPS` is the first step of any upstream update. See [Chromium Upgrade and Patch Maintenance Workflow](../workflows/chromium-upgrade-and-patch-workflow.md).

## patches/ layout

`patches/` has one subdirectory per upstream project: `chromium`, `node`, `v8`, `boringssl`, `ffmpeg`, `webrtc`, `devtools_frontend`, `perfetto`, `nan`, `sqlite`, `squirrel.mac`, `Mantle`, `ReactiveObjC`, and `reclient-configs`. Each directory contains:

- A set of `.patch` files, each named after the commit subject it was exported from.
- A `.patches` file that lists the order in which the patch files are applied. The file replaces numeric prefixes so that two pull requests adding patches at the end do not collide on the same number.

`patches/config.json` is the map from directory to checkout. Each entry gives a `patch_dir` (for example `src/electron/patches/node`) and a `repo` (for example `src/third_party/electron_node`). For instance, `chromium` maps to `src`, `v8` maps to `src/v8`, and `Mantle` maps to `src/third_party/squirrel.mac/vendor/Mantle`. The config is the single list that the other scripts read.

## How patches are applied

`DEPS` runs two hooks when Chromium is synced with `apply_patches` enabled:

1. `generate_mtime_cache` (a `pre_deps_hook`) runs `script/patches-mtime-cache.py generate` to write `patches/mtime-cache.json`, which records hashes of the patch files (it hashes each patch file once, even when a file is patched more than once).
2. `patch_chromium` runs `script/apply_all_patches.py patches/config.json`. That script loops over the config, and for each target it calls `git.import_patches` from `script/lib/git.py`, with the patch data read by `patch_from_dir` from `script/lib/patches.py`. The import commits each patch as a separate commit in the upstream repository, using the committer name `Electron Scripts`. Setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` switches it to a three-way merge.

A standalone importer exists as `script/git-import-patches`. It applies a directory of patches to the repository in the current working directory.

Consequence: patched upstream checkouts are meant to be reproducible from `patches/` and `DEPS`. Local commits in an upstream checkout that were not exported to `patches/` are at risk when patches are re-imported.

## Exporting patches

`script/git-export-patches` (and `script/export_all_patches.py` for the full config) does the reverse. It takes commits in an upstream checkout and writes them as `.patch` files, updating the `.patches` file. The export script reads `patches/config.json`, uses each target's `grep` option when given, and supports `--dry-run`.

Typical flow, from the contributor documentation:

1. Commit the change inside the upstream checkout. Uncommitted changes are ignored by the export.
2. Run the export into the matching `patches/<project>` directory.
3. The commit subject becomes the patch file name, and the commit body must state why the patch exists.

`script/check-patch-diff.ts` re-runs the export in dry-run mode and exits non-zero when that dry run itself fails (its exit status is 1). The file as written does not compare the exported output with the committed patches, so it does not by itself detect unexported edits. `script/patches-stats.mjs` counts patches and lines, and can upload those statistics when run with `--upload-stats`.

## Justification rules

The contributor documentation (`docs/development/patches.md`) sets three accepted reasons for a patch:

1. It is temporary and intended to be upstreamed or removed later, with a link to the upstream change or a way to check whether it is still needed.
2. It makes the code compile in the Electron environment but cannot be upstreamed because it is Electron-specific.
3. It makes Electron-specific changes that are fundamentally incompatible with upstream.

Each patch's commit message must give that reason. The documentation also asks maintainers to upstream changes where possible and to avoid patches with an indefinite lifetime.

## chromium_src overrides

`chromium_src/` holds files that stand in for upstream Chromium sources without patching them. Its `BUILD.gn` builds a `static_library("chrome")` that compiles selected `//chrome`, `//ash`, and `//components` sources that Electron depends on, and makes that library visible only to `//electron:electron_lib`. This route is preferred when an upstream file can be replaced or added to instead of edited.

## Failure behavior

- A patch that fails to apply stops `apply_all_patches.py`, which fails the gclient hook. `.github/problem-matchers/patch-conflict.json` exists to turn conflict output into CI annotations.
- A missing target repository makes the import and export scripts print a warning and skip that target, rather than failing.

## Related pages

- [Chromium Upgrade and Patch Maintenance Workflow](../workflows/chromium-upgrade-and-patch-workflow.md)
- [Building Electron with GN and Ninja](../workflows/build-and-gn.md)
- [Architecture Overview](../architecture/overview.md)
