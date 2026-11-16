---
title: "Upstream Patches and Dependencies"
---
## Overview

Electron is built on Chromium and Node.js, plus V8, BoringSSL, WebRTC and others, and it does not keep forks of them. It checks out upstream at a pinned version and applies an ordered set of patches on top. Each patch directory under `patches/` belongs to one upstream repository, a config file says which, and a pair of scripts imports patches into a checkout as git commits and exports commits back to patch files. This page covers the pinned dependencies, the patch layout, the apply and export flow, and the rules for adding a patch. The build that follows is in [[JavaScript Bundles and the GN Build Pipeline]].

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16), [docs/development/patches.md:1-12](repo://docs/development/patches.md#L1-L12)

## Pinned dependencies

`DEPS` is a `gclient` file. Its `vars` pin Chromium and Node.js versions (and the git hashes of several smaller dependencies), and `deps` maps checkout paths to repositories at those pins: Chromium at `src`, Node.js at `src/third_party/electron_node`, plus `nan`, `squirrel.mac` and its vendored libraries, and others. Since Chromium recursively declares its own dependencies, `src` is listed in `recursedeps`.

Sources: [DEPS:3-28](repo://DEPS#L3-L28), [DEPS:77-98](repo://DEPS#L77-L98), [DEPS:211-213](repo://DEPS#L211-L213)

Two vars control patching. `apply_patches` (default true) says whether to patch after syncing, so a clean Chromium can still be built; `use_mtime_cache` (default true) keeps file modification times stable across re-patching to speed up builds.

Sources: [DEPS:36-40](repo://DEPS#L36-L40)

## Layout

All patches are in `patches/`. Each subdirectory holds `.patch` files and a `.patches` file listing their names in application order. The order is kept in a separate list, rather than as numeric file name prefixes, to avoid two concurrent changes that both add a patch at the end of the series taking the same number, and to reduce churn when a patch is added or removed in the middle.

Sources: [docs/development/patches.md:14-39](repo://docs/development/patches.md#L14-L39), [patches/chromium/.patches:1-5](repo://patches/chromium/.patches#L1-L5)

`patches/config.json` is a list of `{ patch_dir, repo }` pairs. Each maps a patch directory to the repository it modifies: Chromium patches apply at `src`, Node.js patches at `src/third_party/electron_node`, V8 patches at `src/v8`, and so on. Nested repositories are included: the `Mantle` and `ReactiveObjC` patch sets apply inside `squirrel.mac`'s vendor directory.

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

## Applying patches

During `gclient sync` a hook named `patch_chromium` runs `script/apply_all_patches.py` with that config; the hooks around it generate and apply the mtime cache.

Sources: [DEPS:112-150](repo://DEPS#L112-L150)

`apply_all_patches.py` loops over the config entries. For each, if the repo path is missing it only warns; otherwise it reads the patch directory and calls `git.import_patches` with a fixed committer identity (`Electron Scripts`). The `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` environment variable turns on 3-way merging.

Sources: [script/apply_all_patches.py:11-41](repo://script/apply_all_patches.py#L11-L41)

`patch_from_dir` reads `.patches`, then reads each patch in that order and concatenates them into a single stream for `git am`. While reading, it inserts two lines, `Patch-Dir:` and `Patch-Filename:`, in front of the first diff so the resulting commit remembers which file it came from; that is what lets the export step put each commit back into the same file.

Sources: [script/lib/patches.py:6-40](repo://script/lib/patches.py#L6-L40)

`import_patches` first records the current `HEAD` as the ref `refs/patches/upstream-head`, then runs `git am` with `--keep-cr` (some patches target files with Windows line endings), signing disabled and optional `--3way`. The ref divides commits in the repository into upstream ones and Electron patches.

Sources: [script/lib/git.py:21-21](repo://script/lib/git.py#L21-L21), [script/lib/git.py:53-91](repo://script/lib/git.py#L53-L91)

## Exporting patches

`script/export_all_patches.py` runs `git.export_patches` for each config entry, with a `--dry-run` mode that only checks whether the exported files would change. The command-line tools `script/git-import-patches` and `script/git-export-patches` do the same for a single repository from its directory.

Sources: [script/export_all_patches.py:11-47](repo://script/export_all_patches.py#L11-L47), [script/git-import-patches:1-20](repo://script/git-import-patches#L1-L20)

Typical workflows, as given in the development guide:

Sources: [docs/development/patches.md:41-43](repo://docs/development/patches.md#L41-L43)

- **Add a patch.** Edit the upstream checkout, `git commit`, and run `git-export-patches -o <patch dir>`. Uncommitted changes are ignored, the commit subject becomes the file name, and the body must explain why the patch exists.
- **Edit a patch.** Make a `git commit --fixup` against the patch's commit, `git rebase --autosquash`, then export.
- **Remove a patch.** Delete its line from `.patches`, reset the checkout to `refs/patches/upstream-head`, re-import and re-export.
- **Resolve conflicts.** When upstream moves, re-import with `-3` for a 3-way merge; unresolved conflicts pause for manual resolution and `git am --continue`.

Sources: [docs/development/patches.md:43-96](repo://docs/development/patches.md#L43-L96)

Re-exporting can change the hashes of unrelated patches. The guide says this is harmless and that the changes should be committed so they stop appearing for the next person.

Sources: [docs/development/patches.md:55-55](repo://docs/development/patches.md#L55-L55)

## Patch justification

The guide treats every patch as a maintenance burden, because upstream changes can break a patch with no conflict or compile error. Each patch must give its reason in the commit message, and the reason must be one of three: the patch is temporary and meant to be upstreamed or removed (with a link or a way to check); it lets the code compile in Electron's environment but cannot be upstreamed, being Electron-specific; or it makes an Electron-specific functional change fundamentally incompatible with upstream.

Sources: [docs/development/patches.md:5-12](repo://docs/development/patches.md#L5-L12)

A concrete example is a Node.js patch whose subject is "Pass all globals through require". Electron's renderer deletes `global` and `Buffer` from the page, so the patch stores them in locals at the top of Node's CJS loader and passes `process`, `localGlobal` and `localBuffer` as extra arguments when it calls the module wrapper. That is why the renderer's `Module.wrapper` override can still hand `process`, `global` and `Buffer` to preload scripts: see [[Renderer Initialization and Preload Scripts]].

Sources: [patches/node/pass_all_globals_through_require.patch:1-40](repo://patches/node/pass_all_globals_through_require.patch#L1-L40), [lib/renderer/init.ts:20-40](repo://lib/renderer/init.ts#L20-L40)
