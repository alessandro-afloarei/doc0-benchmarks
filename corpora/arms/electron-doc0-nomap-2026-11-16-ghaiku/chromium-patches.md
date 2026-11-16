---
title: "Chromium Patches"
---
## Overview

Electron builds on Chromium, Node.js, V8 and several other vendored trees, and some of its changes have to be made inside those trees. Each change is kept as a patch file under `patches/`, in a folder per upstream project, and the build applies the folders to their checkouts before compiling. A second directory, `chromium_src`, builds some Chromium sources into Electron's own static library. The GN build that compiles the result is on [[Build System]].

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16), [chromium_src/BUILD.gn:12-14](repo://chromium_src/BUILD.gn#L12-L14)

## Patch layout

Each folder under `patches/` holds patch files and a `.patches` file that lists them in the order to apply. The order is kept in that list, not in the file names, so two pull requests that add a patch at the end do not pick the same number.

Sources: [docs/development/patches.md:19](repo://docs/development/patches.md#L19), [docs/development/patches.md:39](repo://docs/development/patches.md#L39)

`patches/config.json` maps each patch folder to the checkout that receives it. Chromium's folder goes to `src`, and the BoringSSL, DevTools frontend, FFmpeg, V8, Node.js, NaN, Perfetto, squirrel.mac, Mantle, ReactiveObjC, WebRTC, reclient and SQLite folders each go to their own subpath of `src`.

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

`patches/README.md` only points to the development guide, so the rules for writing patches are kept in one place.

Sources: [patches/README.md:1](repo://patches/README.md#L1)

## Applying patches

`apply_patches` skips a target whose repository folder does not exist and warns about it. Otherwise it reads the patch folder with `patch_from_dir` and imports the patches into the repository through `git.import_patches`, with threeway merging on when `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` is set.

Sources: [script/apply_all_patches.py:13-25](repo://script/apply_all_patches.py#L13-L25), [script/apply_all_patches.py:11](repo://script/apply_all_patches.py#L11)

`apply_config` runs `apply_patches` for each entry of a config file, and `main` runs that for each config path given on the command line. A config is therefore one list, and the build can pass several lists.

Sources: [script/apply_all_patches.py:27-30](repo://script/apply_all_patches.py#L27-L30), [script/apply_all_patches.py:40-45](repo://script/apply_all_patches.py#L40-L45)

`patch_from_dir` builds one text stream from the `.patches` list. `read_patch` adds two header lines before the first `diff -` or `---` line of each file, with the patch folder and the file name. The headers let an import keep the origin of each patch in its commit.

Sources: [script/lib/patches.py:11-12](repo://script/lib/patches.py#L11-L12), [script/lib/patches.py:14-28](repo://script/lib/patches.py#L14-L28), [script/lib/patches.py:31-40](repo://script/lib/patches.py#L31-L40)

## Exporting patches

Patches are written in a checkout as commits, and `export_patches` turns the commits in a repository back into files. It passes each target's `grep` filter and output folder to `git.export_patches`, and it skips a missing repository with a warning, as the import does.

Sources: [script/export_all_patches.py:11-21](repo://script/export_all_patches.py#L11-L21), [script/export_all_patches.py:24-26](repo://script/export_all_patches.py#L24-L26)

A `--dry-run` flag checks whether the exported files would change, so a pull request can be checked for stale patch files without rewriting them.

Sources: [script/export_all_patches.py:34-37](repo://script/export_all_patches.py#L34-L37)

The workflow for a new patch is to commit in the upstream checkout and run `git-export-patches` against the folder in `patches/`. The subject line of the commit becomes the file name, and the body must give the reason for the patch.

Sources: [docs/development/patches.md:43-53](repo://docs/development/patches.md#L43-L53)

## Reasons for a patch

The development guide accepts three reasons for a patch: it is temporary and should be upstreamed or removed, it lets the code compile in Electron but cannot be upstreamed because it is specific to Electron, or it makes a change that cannot fit upstream at all. A patch that matches none of these is not accepted.

Sources: [docs/development/patches.md:7-11](repo://docs/development/patches.md#L7-L11)

`chromium_src` is different from the patch folders. Its `chrome` static library builds the Chromium source files that Electron depends on, as its comment says, and only `electron_lib` may depend on it.

Sources: [chromium_src/BUILD.gn:12-14](repo://chromium_src/BUILD.gn#L12-L14), [chromium_src/BUILD.gn:15-22](repo://chromium_src/BUILD.gn#L15-L22)
