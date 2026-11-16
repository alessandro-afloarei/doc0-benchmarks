---
title: "Patching Upstream Projects"
---
## Overview

Electron runs on Chromium, Node.js, V8 and about a dozen other dependencies, and a few of them need changes that cannot wait for upstream. Those changes live in `patches/` as ordinary patch files, one folder per dependency, and the build applies them to a fresh checkout of each dependency. This page covers the layout the patches use, the order file that sets their sequence, and the two scripts that move patches between files and git commits. The GN build that consumes the patched trees is in [[GN Build]].

Sources: [docs/development/patches.md:12-38](repo://docs/development/patches.md#L12-L38)

## Layout

`patches/config.json` is the table of dependencies. Each entry gives a `patch_dir` that holds the patch files, and a `repo` path, relative to the Chromium `src` checkout, where the patches are applied. Chromium's entry uses `src` itself, while Node.js uses `third_party/electron_node`, and the macOS helper libraries use paths inside `squirrel.mac`.

Sources: [patches/config.json:1-15](repo://patches/config.json#L1-L15)

Each patch folder has a `.patches` file listing the patch filenames in the order they apply. The order is kept in that file rather than in numbered filenames, so two pull requests that add a patch at the end do not collide on the same prefix.

Sources: [docs/development/patches.md:33-38](repo://docs/development/patches.md#L33-L38)

## Applying patches

`apply_all_patches.py` loops over `config.json`. For each entry that exists on disk, it builds the patch data and imports it into the target repository. A missing repository is skipped with a warning.

Sources: [script/apply_all_patches.py:9-29](repo://script/apply_all_patches.py#L9-L29)

`patch_from_dir` reads the `.patches` file and concatenates the patches in that order. `read_patch` inserts two metadata lines, `Patch-Dir` and `Patch-Filename`, into each patch's header, so that a later export can recover which file each commit came from.

Sources: [script/lib/patches.py:9-40](repo://script/lib/patches.py#L9-L40)

The import is a `git am` in the target repository, with `--keep-cr` so patches that touch CRLF files still apply. A 3-way merge is used only when `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` is set. `import_patches` also saves the upstream head as a ref, so later exports know where the Electron commits begin.

Sources: [script/lib/git.py:53-86](repo://script/lib/git.py#L53-L86)

## Exporting patches

Editing a patched dependency means committing in its repository. `export_patches` in `script/lib/git.py` runs `git format-patch` from the saved upstream ref, using the attributes file that Electron ships, and splits the output into one patch per commit. An optional `grep` filter selects a subset by commit subject.

Sources: [script/lib/git.py:119-135](repo://script/lib/git.py#L119-L135)

Sources: [script/lib/git.py:224-246](repo://script/lib/git.py#L224-L246)

`export_all_patches.py` runs that export for every entry in `config.json`. Its `dry_run` mode compares each freshly exported file with the file already in the folder, and reports any that differ, which catches an edit that was not exported.

Sources: [script/export_all_patches.py:9-30](repo://script/export_all_patches.py#L9-L30)

## Justification rule

Each patch's commit message must give a reason it exists. The reasons the project accepts are that the patch is temporary and will be upstreamed or removed, that it makes the code compile in Electron where upstream cannot change, or that it makes an Electron-only behaviour change that cannot be upstreamed. Patches that are none of these are not accepted.

Sources: [docs/development/patches.md:5-10](repo://docs/development/patches.md#L5-L10)
