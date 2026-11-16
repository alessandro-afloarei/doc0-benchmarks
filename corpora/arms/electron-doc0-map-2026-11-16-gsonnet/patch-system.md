---
title: "Patch System"
---
## Overview

Electron changes Chromium, Node.js, V8 and several smaller dependencies, but it does not keep forks of them in this repository. The changes live as `git format-patch` files under `patches/`, one directory per upstream project, and scripts turn those files into real commits on top of the upstream checkout and back again. The design goal in `docs/development/patches.md` is a minimal patch count: every patch must justify itself, and upstreaming is preferred. This page covers the layout, the scripts that apply and export patches, the build-time file-time cache, and the day-to-day workflow. How the patches fit into checkout and build is in [[Build System]].

Sources: [docs/development/patches.md:1-13](repo://docs/development/patches.md#L1-L13), [patches/config.json:1-16](repo://patches/config.json#L1-L16)

## Layout and configuration

Each subdirectory of `patches/` holds `.patch` files plus a `.patches` file listing them in application order. The doc explains the reason for a list over numeric prefixes: two PRs adding a patch at the end of a series would otherwise both claim the same number, and inserting or deleting in the middle would rename files.

Sources: [docs/development/patches.md:15-39](repo://docs/development/patches.md#L15-L39)

`patches/config.json` is the map from patch directories to the git repositories they apply to. Entries pair a `patch_dir` with a `repo`: `patches/chromium` applies to `src`, `patches/node` to `src/third_party/electron_node`, `patches/v8` to `src/v8`, and further entries cover BoringSSL, devtools-frontend, ffmpeg, nan, perfetto, squirrel.mac with its vendored Mantle and ReactiveObjC, webrtc, the reclient configs and sqlite. Every script below takes this file as its input.

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

Each patch is a normal `git am` email: author, date, a subject line that becomes the file name, and a body that must state why the patch exists. A representative Chromium patch, `accelerator.patch`, starts with "fix: improve shortcut text of Accelerator" and explains each change in its message before the diff.

Sources: [patches/chromium/accelerator.patch:1-11](repo://patches/chromium/accelerator.patch#L1-L11), [docs/development/patches.md:5-13](repo://docs/development/patches.md#L5-L13)

## Applying patches

`apply_all_patches.py` reads one or more config files. For each target it warns and skips if the repo directory does not exist, then calls `git.import_patches` with a fixed committer (`Electron Scripts`, `scripts@electron`), the patch text built by `patch_from_dir`, and a 3-way merge flag taken from the `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` environment variable. This is what the gclient hook runs after checkout (see [[Build System]]).

Sources: [script/apply_all_patches.py:11-45](repo://script/apply_all_patches.py#L11-L45), [DEPS:129-140](repo://DEPS#L129-L140)

`patch_from_dir` reads `.patches` and concatenates the listed files. For each file, `read_patch` inserts two metadata lines, `Patch-Dir:` and `Patch-Filename:`, just before the first line that starts the diff (`diff -` or `---`), so the commit message that `git am` creates records which file it came from. That is how export later restores the original names.

Sources: [script/lib/patches.py:6-40](repo://script/lib/patches.py#L6-L40)

`git.import_patches` first points the ref `refs/patches/upstream-head` at the current `HEAD`, then runs `git am` with the patch data on stdin (adding `--3way` when requested, and always `--keep-cr` so patches that touch CRLF files apply, with `commit.gpgsign=false`). The ref marks the boundary: commits after it are Electron's patches, commits before it are upstream.

Sources: [script/lib/git.py:21](repo://script/lib/git.py#L21-L21), [script/lib/git.py:53-91](repo://script/lib/git.py#L53-L91)

`script/git-import-patches` is the same operation for a single repository: it runs from inside the repo, takes a patch directory, and accepts `-3`/`--3way`.

Sources: [script/git-import-patches:10-27](repo://script/git-import-patches#L10-L27)

## Exporting patches

`git-export-patches -o <dir>` turns commits back into files. With no range it guesses the base commit: the commits since `refs/patches/upstream-head`, or if that ref is missing, the nearest tag from `git describe`. It runs `git format-patch` with options chosen to keep output stable: `--keep-subject`, `--no-stat`, `--no-signature`, `--zero-commit` (the parent commit hash is not useful and causes churn) and `--full-index` (so different git versions print identical `index` lines), plus a custom attributes file.

Sources: [script/git-export-patches:10-25](repo://script/git-export-patches#L10-L25), [script/lib/git.py:102-154](repo://script/lib/git.py#L102-L154)

The exporter splits the concatenated output into individual patches, optionally filters them by a `--grep` keyword, picks each file name from its `Patch-Filename:` header (or derives it from the subject), strips the `Patch-*` metadata lines out of the message, and in a normal run deletes the old `.patch` files from the directory and rewrites them together with a fresh `.patches` list. Deleting first means a commit that was removed disappears as a removed file.

Sources: [script/lib/git.py:157-221](repo://script/lib/git.py#L157-L221), [script/lib/git.py:224-289](repo://script/lib/git.py#L224-L289)

`export_all_patches.py` runs that for every target of a config. With `--dry-run` it compares what would be written against the files on disk and, if any differ, prints how many patches are out of date and exits with status 1 without writing anything.

Sources: [script/export_all_patches.py:11-48](repo://script/export_all_patches.py#L11-L48), [script/lib/git.py:248-267](repo://script/lib/git.py#L248-L267)

`script/check-patch-diff.ts` is the CI wrapper for that dry run: it spawns `export_all_patches.py` with the repository's `config.json` and `--dry-run` and exits non-zero (printing stderr) if the status is 1. A PR that edits an upstream repo without re-exporting the patch therefore fails.

Sources: [script/check-patch-diff.ts:1-17](repo://script/check-patch-diff.ts#L1-L17)

## The mtime cache

`DEPS` describes the mtime cache as a way "to speed up builds", because re-applying patches rewrites files and changes their modification times. `patches-mtime-cache.py` implements it. Its `generate` operation walks the `+++` lines of every patch to learn the touched files (the same path may be patched many times, so each is processed once), and records each file's SHA-256, `atime` and `mtime` into a JSON cache file; it reuses an existing non-empty cache from an aborted sync. After patches are re-applied, `apply` hashes each file again and restores its original times only if the content is identical, then deletes the cache unless `--preserve-cache` is given. Every failure path returns success so a broken cache never fails a sync. A third operation, `set`, forces one mtime onto all patched files and requires typing `yes` because it "could mess up your build".

Sources: [DEPS:39-40](repo://DEPS#L39-L40), [script/patches-mtime-cache.py:14-81](repo://script/patches-mtime-cache.py#L14-L81), [script/patches-mtime-cache.py:131-182](repo://script/patches-mtime-cache.py#L131-L182)

`DEPS` wires this into checkout: a `pre_deps_hooks` entry generates the cache, and a hook that runs after the `patch_chromium` hook applies it, both conditioned on `use_mtime_cache`.

Sources: [DEPS:112-150](repo://DEPS#L112-L150)

## Working with patches

To add a patch, commit the change inside the upstream repo and run `git-export-patches -o` toward the matching `patches/<name>` directory. Uncommitted work is ignored, and the commit subject becomes the file name while the body must give the reason for the patch. To edit one, make a fixup commit against the original, autosquash, and re-export. To remove one, delete its line from `.patches`, reset the repo to `refs/patches/upstream-head`, re-import, and re-export.

Sources: [docs/development/patches.md:41-82](repo://docs/development/patches.md#L41-L82)

When an upstream update makes patches fail to apply, retry with `git-import-patches -3` so git can resolve by 3-way merge; if a real conflict remains, `git am` pauses for manual resolution and `git am --continue` finishes the series. Re-exporting may change blob hashes in unrelated patches, which the doc says to commit anyway so they stop appearing for others.

Sources: [docs/development/patches.md:55](repo://docs/development/patches.md#L55-L55), [docs/development/patches.md:84-96](repo://docs/development/patches.md#L84-L96)

Some patches are the reason other pages work the way they do: the Node patch that exposes `electron` through the ESM loader ([[Module Loading and Linked Bindings]]) and the Node patches around the `electron/js2c` entry points ([[Process Types and JavaScript Bootstraps]]).

Sources: [patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch:4-17](repo://patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch#L4-L17), [patches/node/fix_do_not_resolve_electron_entrypoints.patch:1-12](repo://patches/node/fix_do_not_resolve_electron_entrypoints.patch#L1-L12)
