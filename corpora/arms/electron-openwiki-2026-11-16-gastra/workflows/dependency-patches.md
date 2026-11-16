---
type: workflow
title: Dependency updates and patch maintenance
description: How DEPS revisions, ordered patch series, import/export tools, and focused regression checks preserve Electron's upstream integration.
tags: [dependencies, patches, upstream, maintenance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-1d1546e21f90bf80f08cc33d
    resource: repo://docs/development/patches.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-cfc1068e5c6e75790a881dac
    resource: repo://patches/config.json
  - id: openwiki-source-abfe3cee01dad9ac69ff6525
    resource: repo://patches/node/fix_lazyload_fs_in_esm_loaders_to_apply_asar_patches.patch
  - id: openwiki-source-298a1003742dda5b1f8a35be
    resource: repo://script/apply_all_patches.py
  - id: openwiki-source-9ae0c16573dc5628a4c5e52c
    resource: repo://script/export_all_patches.py
  - id: openwiki-source-38a9238a80b0add7202ce5b7
    resource: repo://script/git-import-patches
  - id: openwiki-source-2c163c69c4fa8bf6f3ae3a3d
    resource: repo://script/lib/git.py
  - id: openwiki-source-44a65a63d73c4493c309e083
    resource: repo://script/lib/patches.py
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Dependency updates and patch maintenance

Electron's dependency version is more than an upstream revision: DEPS selects checkouts, and ordered Electron patch series adapt them to the framework. A clean patch application and successful compilation do not establish that an upstream update preserves runtime behavior.

## What owns each layer

DEPS pins Chromium, Node and other repositories. Its patch hook invokes apply_all_patches.py with patches/config.json. That configuration maps patch directories to checkout locations, including Chromium at src, V8 at src/v8, Node at src/third_party/electron_node, and other dependencies.

Within each patch directory, .patches defines application order. patch_from_dir reads that list and concatenates patches in that order, adding source-location metadata. The import implementation records the current HEAD as refs/patches/upstream-head, then applies the series with git am. This ref identifies the upstream/patch boundary for later export.

The full configuration uses paths relative to the outer workspace containing src. Individual git-import-patches and git-export-patches commands instead operate on their current Git repository. Confusing these working directories can target the wrong tree.

## Adding or revising a patch

The repository's [patch guide](../../docs/development/patches.md) requires a reason in each patch commit message: temporary upstream work, an Electron-specific build adaptation, or an intentionally Electron-specific behavior change. Include upstream references or a way to determine when a temporary patch can be removed.

For a Node change, work in the vendored checkout, commit the intended change, then export from there:

```sh
# Current directory: workspace/src/third_party/electron_node
../../electron/script/git-export-patches -o ../../electron/patches/node
```

The export operates on commits, so uncommitted source edits are not included. To revise an existing patch, the documented workflow creates a fixup commit, autosquashes it into the original patch commit, then re-exports. Preserve unrelated dependency work before rewriting that history.

Export reconstructs the patch directory: its normal path removes old .patch files and rewrites the files and .patches order from the selected commit range. That makes the upstream boundary and selected repository consequential. Review the resulting Electron diff, including removed patches and order changes, rather than checking only the dependency checkout.

## Resolving an upstream roll

After updating a pin, synchronize the full checkout and inspect application failures in the affected dependency repository. The importer supports -3/--3way. The all-patches hook enables three-way merging when ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES is present in the environment.

If a prior import is still in progress, the guide documents git am --abort before retrying, or resolving the current conflict and continuing with git am --continue. Run those commands in the failing dependency repository after checking its state. Re-export the resolved series back into Electron and review whether upstream now makes any patch redundant.

apply_all_patches.py warns and skips a target whose repository is absent. A successful run on an incomplete checkout therefore does not prove that every configured patch series was applied.

## A concrete cross-system dependency

The Node patch [lazyload fs in ESM loaders](../../patches/node/fix_lazyload_fs_in_esm_loaders_to_apply_asar_patches.patch) changes early destructured filesystem functions into later fs property accesses. Its purpose is to let Electron's filesystem wrappers affect ESM loading. An upstream refactor that captures those functions early again can break packaged modules even when the patch still applies elsewhere.

Review this kind of change together with [ASAR and Node embedding](../concepts/node-and-asar.md), ESM fixtures, and Node smoke tests. Similar dependency changes can affect renderer scheduling, native API types, or Chromium lifecycle callbacks without an obvious error at the patch boundary.

## Verification

From the outer workspace in a complete checkout, the bulk exporter provides a comparison mode:

```sh
python3 src/electron/script/export_all_patches.py src/electron/patches/config.json --dry-run
```

It compares newly formatted patches with existing files and fails on detected mismatches. The root package hooks run patch lint and check-patch-diff.ts for patch changes; DEPS changes also trigger filename generators for selected vendored inputs. These checks establish formatting/export consistency, not semantic correctness.

Rebuild the affected [Electron configuration](build-electron.md), run the relevant focused Electron specs, and use Node smoke coverage when changing Node behavior. Follow the [validation guide](../testing/validation.md) to distinguish missing dependencies, export mismatches, compile errors, and runtime regressions.
