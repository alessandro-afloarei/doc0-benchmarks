---
type: build
title: Upstream Patch System (Chromium, Node, V8, ...)
description: How Electron carries modifications to Chromium, Node.js, V8 and other upstream dependencies as ordered git-format patch series, how they are applied and exported with git am/format-patch tooling, the justification rules, the mtime cache, and related Chromium source copies in chromium_src.
tags: [patches, chromium, node, v8, gclient, git-am, build]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-af2b637fa5845c2e8812334b
    resource: repo://chromium_src/BUILD.gn
  - id: openwiki-source-1d1546e21f90bf80f08cc33d
    resource: repo://docs/development/patches.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-cfc1068e5c6e75790a881dac
    resource: repo://patches/config.json
  - id: openwiki-source-298a1003742dda5b1f8a35be
    resource: repo://script/apply_all_patches.py
  - id: openwiki-source-3da20c1ddf18f064fbe879c3
    resource: repo://script/check-patch-diff.ts
  - id: openwiki-source-12a83fd12739d2562fc65636
    resource: repo://script/git-export-patches
  - id: openwiki-source-2c163c69c4fa8bf6f3ae3a3d
    resource: repo://script/lib/git.py
  - id: openwiki-source-44a65a63d73c4493c309e083
    resource: repo://script/lib/patches.py
  - id: openwiki-source-f5b7ab22cde5622acebc0b71
    resource: repo://script/patches-mtime-cache.py
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Upstream Patch System (Chromium, Node, V8, ...)

Electron does not fork Chromium or Node.js. It stores its changes to them as **patch files in this repository** and re-applies them on top of the pinned upstream checkouts after every `gclient sync`. This keeps upstream pristine in history while letting Electron upgrade dependencies by rebasing patches. Everything lives under `patches/`.

## Layout

- `patches/config.json` is the routing table: a list of `{ patch_dir, repo }` objects mapping each patch directory to the git repository it applies to, for example `patches/chromium` to `src`, `patches/node` to `src/third_party/electron_node`, `patches/v8` to `src/v8`, plus `boringssl`, `devtools_frontend`, `ffmpeg`, `nan`, `perfetto`, `squirrel.mac` (with nested `Mantle` and `ReactiveObjC`), `webrtc`, `reclient-configs` and `sqlite`.
- Each patch directory contains `*.patch` files and a `.patches` file listing filenames **in application order**. The order lives in `.patches` rather than numeric filename prefixes so concurrent PRs don't collide on numbering and adding a patch in the middle causes less churn. `chromium` is by far the largest set (over a hundred patches) followed by `node` (around fifty).
- Each `.patch` is a `git format-patch` email (From/Date/Subject header, free-text body, diff). The subject becomes the exported filename and the body must explain why the patch exists.
- `patches/README.md` just points at `docs/development/patches.md`.

## Justification rules

`docs/development/patches.md` requires every patch's commit message to state one of three reasons: (1) it is temporary and intended for upstreaming, with a link or a procedure for checking whether it is still needed; (2) it is needed to compile in Electron's environment but can't be upstreamed (e.g. removing references to Chrome's `Profile`), with reasoning why a subclass or copy wouldn't do; or (3) it makes Electron-specific functional changes fundamentally incompatible with upstream. Upstreaming refactors that remove patches is encouraged, and the maintainers treat patch count as a maintenance cost.

## Applying patches

<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **During sync.** The DEPS hook `patch_chromium` runs `script/apply_all_patches.py src/electron/patches/config.json` ([build system](/openwiki/build/build-system.md)). For each config entry it skips repos that do not exist (with a warning), reads the directory via `lib.patches.patch_from_dir`, and calls `git.import_patches`.
- **Reading.** `patch_from_dir` concatenates every patch listed in `.patches` and inserts `Patch-Dir:` and `Patch-Filename:` trailer lines at the start of each diff, so the commit created by `git am` records which file it came from. That metadata is what makes re-export deterministic.
- **Import.** `import_patches` first sets the ref `refs/patches/upstream-head` to the current `HEAD` of the target repo (the boundary between upstream and Electron commits), then pipes the concatenated patches into `git am --keep-cr` using a fixed committer identity (`Electron Scripts`) and `commit.gpgsign=false`. `--keep-cr` preserves CRLF line endings for files that use them. Setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` enables `--3way`, which resolves many conflicts when upgrading a dependency.
- **mtime cache.** Patching rewrites files, which would make ninja recompile everything. `script/patches-mtime-cache.py` records `sha256`, `atime` and `mtime` of each file touched by patches (found from `+++` lines) before sync (`generate`) and, after patching (`apply`), restores the old timestamps on files whose content hash is unchanged. Both steps are gated by `use_mtime_cache` in DEPS.

## Editing patches

The workflow described in `docs/development/patches.md`:

1. Work in the upstream checkout (e.g. `src/third_party/electron_node`), edit files and **commit**. Uncommitted changes are ignored.
2. Export with `script/git-export-patches -o <electron/patches/dir>`. It calls `git.export_patches`, which (by default) takes all commits since `refs/patches/upstream-head`, runs `git format-patch`, splits and normalizes the output, deletes the old `*.patch` files in the destination and rewrites both the files and `.patches`. A `--grep` option exports only a subset.
3. To edit an existing patch, make a `git commit --fixup <sha>`, `git rebase --autosquash`, and re-export. Re-exporting can change SHAs in unrelated patches, which is harmless but should be committed.
4. To remove a patch, delete its line from `.patches`, reset the upstream repo to `refs/patches/upstream-head`, re-import and re-export.
5. After bumping an upstream version, run `script/git-import-patches -3 <dir>` (3-way) to re-apply; on conflict resolve and `git am --continue`.

`script/export_all_patches.py` runs the export for every config entry; `script/check-patch-diff.ts` re-exports with `--dry-run` and fails when committed patch files differ from what the checked-out repos would produce (`export_patches(dry_run=True)` collects mismatching filenames and exits 1). It is run from lint-staged on `*.patch`/`.patches` changes, so stale patch files are caught pre-commit and in CI. `script/patches-stats.mjs` computes patch counts and line counts for reporting.

## chromium_src

`chromium_src/BUILD.gn` builds a `static_library("chrome")` out of selected **unmodified Chromium `chrome/` and `ash/` sources** (for example devtools helpers and `browser_process`) that live outside the `content` layer, visible only to `//electron:electron_lib`. This is how Electron reuses Chrome-layer code without depending on all of `//chrome`. When Chromium moves or splits those files, this list is adjusted (or a patch is added) as part of the upgrade.

## Dependency upgrade workflow

<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Upgrades bump the pinned version in `DEPS` (`chromium_version`, `node_version`, ...), run `gclient sync` (hooks apply patches), fix conflicts by re-importing with `-3`, then re-export all patches so they apply cleanly to the new base. The Node integration code in [Node and Chromium integration](/openwiki/architecture/node-chromium-integration.md) and the `shell/` Chromium content-API usage frequently need follow-up edits, because patches can break semantically without producing textual conflicts.

## Gotchas

<!-- openwiki: broken internal link [/openwiki/testing/spec-suite.md] link "/openwiki/testing/spec-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- A patch that merely "applies" may still be wrong after an upstream refactor; build and run tests ([spec suite](/openwiki/testing/spec-suite.md)).
- Patches that touch Windows files with CRLF endings need `--keep-cr` handling, which the tooling already applies.
- Never hand-edit applied files without committing in the upstream repo, otherwise the next sync or export will lose the change.
