---
type: architecture
title: Chromium, Node, and Upstream Patches
description: How Electron layers its own changes onto Chromium, Node.js, V8, and other vendored dependencies, covering the patches/ directory and its .patches ordering, the apply and export tooling, the chromium_src GN overlay, and the rules for justifying a patch.
tags: [electron, patches, chromium, node, v8, gclient, git-am, chromium-src, dependencies]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-6f6acd7aaa4692944c47e9f8
    resource: repo://.github/actions/checkout/action.yml
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
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
  - id: openwiki-source-2c163c69c4fa8bf6f3ae3a3d
    resource: repo://script/lib/git.py
  - id: openwiki-source-44a65a63d73c4493c309e083
    resource: repo://script/lib/patches.py
  - id: openwiki-source-79f55cc6eb17cd7636a74106
    resource: repo://script/patch-up.js
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Chromium, Node, and Upstream Patches

Electron is a layer on top of Chromium, Node.js, V8, and a handful of other upstream projects. Where Electron needs behavior that upstream does not offer, it changes the upstream source. Those changes are kept as patch files in this repository, not as edits to upstream checkouts, and a tool applies them whenever `gclient` materializes the dependency tree. This page explains how the patch set is stored, applied, and exported, and how the `chromium_src` GN overlay fits alongside it.

## Where the patches live

`patches/` has one subdirectory per upstream project. Each subdirectory contains `.patch` files plus a `.patches` file that lists the order in which they apply. The file `patches/config.json` maps each patch directory to the checkout path it targets. Its entries include:

- `patches/chromium` targeting `src`, the Chromium tree. It is by far the largest set, with about 141 `.patch` files.
- `patches/node` targeting `src/third_party/electron_node`, the Node.js fork, with about 50 files.
- `patches/v8` targeting `src/v8`, plus `patches/boringssl`, `patches/ffmpeg`, `patches/webrtc`, `patches/sqlite`, `patches/perfetto`, `patches/nan`, `patches/reclient-configs`, and the Squirrel-related trees `patches/squirrel.mac`, `patches/Mantle`, and `patches/ReactiveObjC`.

The `.patches` ordering file is deliberate. The project's documentation notes that a numeric prefix on each file name causes merge conflicts when two pull requests both append to the end of the series, so order is kept in a separate list. Adding or removing a patch in the middle of a series changes only one line of that list.

## How patches are applied

Application happens during the Chromium checkout, not at build time.

1. `DEPS` defines a `patch_chromium` hook, gated on `checkout_chromium and apply_patches`, that runs `src/electron/script/apply_all_patches.py` against `src/electron/patches/config.json`. A separate hook restores or saves an mtime cache for patched files (`script/patches-mtime-cache.py`, cache file `patches/mtime-cache.json`) when `use_mtime_cache` is set, which speeds up rebuilds.
2. `apply_all_patches.py` reads `config.json` and, for each target whose repository exists on disk, calls `patch_from_dir` and then `git.import_patches`. A missing repository only produces a warning, so a partial checkout does not abort.
3. `script/lib/patches.py` concatenates every patch listed in `.patches` into one stream. For each patch it inserts `Patch-Dir:` and `Patch-Filename:` lines into the commit header, so the originating file can be traced from the resulting commit.
4. `script/lib/git.py` runs `git am` in the target repository, with `--keep-cr` so patches touching CRLF files survive. It sets a fixed committer identity (`scripts@electron`) and disables GPG signing. `import_patches` first runs `git update-ref refs/patches/upstream-head HEAD`, so the upstream base is always recorded.

The `-3` option (or the `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` environment variable, which `.github/actions/checkout/action.yml` sets during CI sync) asks `git am` to use a three-way merge when a patch does not apply cleanly. A failed `git am` raises `RuntimeError`, which stops the sync. Conflicts that need a human are resolved by hand, then `git am --continue`.

Because application produces real commits, the applied tree is a branch of upstream history with Electron's changes stacked after `refs/patches/upstream-head`. That is what makes export possible.

## Exporting patches back to files

Exporting is the reverse operation and is how edits made inside an upstream checkout get saved into this repository.

- `script/git-import-patches` is a standalone wrapper that applies one patch directory to the current repository (`-3` for three-way).
- `script/git-export-patches` and `script/export_all_patches.py` call `git.export_patches`. That function runs `git format-patch` over the commits after `refs/patches/upstream-head`. In a normal run it deletes the existing `.patch` files in the output directory, writes one `.patch` per commit, and regenerates `.patches` in the same order. Uncommitted changes are ignored, so each change must be a commit. The commit subject determines the file name, and the body carries the patch's justification.
- `export_patches` with `dry_run` writes nothing. It compares each regenerated patch with the stored file and exits with status 1 listing the stale ones. `export_all_patches.py` accepts `--dry-run`, and `script/check-patch-diff.ts` uses it to detect differences.

CI checks that the stored patches match the applied state. In `.github/actions/checkout/action.yml`, after `gclient sync` on non-release builds, the workflow re-exports all patches and checks for a diff to the git index. If there is one, it runs `script/patch-up.js`. That script uses GitHub App credentials (`PATCH_UP_APP_CREDS`) and the GitHub API to push the changed patch files to the pull request's head branch, so it only works in pull-request workflows, which it requires through `GITHUB_HEAD_REF`. A new CI run then starts. On release builds this re-export step is skipped. The result is that the `.patch` files in the repository are always the authoritative description of the Electron-specific delta.

## The patch justification rule

`docs/development/patches.md` requires that every patch state its reason for existing in its commit message. Only three reasons are accepted:

1. The patch is temporary and is intended to be upstreamed or removed later. It should link an upstream change or describe a procedure for checking whether it is still needed.
2. The patch lets the code compile in Electron's environment but cannot be upstreamed because it is Electron-specific, for example removing references to Chrome's `Profile`. The message must explain why subclassing or copying the code would not work.
3. The patch makes Electron-specific changes that are fundamentally incompatible with upstream behavior.

The documentation also asks maintainers to upstream changes where they can and to avoid patches with an indefinite lifetime. The purpose of the rule is to keep the patch count low, because each patch is a maintenance cost that can silently break when upstream code moves.

## The chromium_src overlay

`chromium_src/` is described in `docs/development/source-code-directory-structure.md` as source copied from Chromium. In this tree it contains only `chromium_src/BUILD.gn` and `chromium_src/LICENSE.chromium`. The GN file defines a `static_library("chrome")` target whose `sources` list names Chromium's own files by GN label, such as `//chrome/browser/browser_process.cc` and `//chrome/browser/devtools/...`. The target's visibility is restricted to `//electron:electron_lib`. The root `BUILD.gn` pulls it in as `chromium_src:chrome` and `chromium_src:chrome_spellchecker`, around line 441.

So `chromium_src` is a build-level bridge rather than a copy. It compiles selected pieces of the Chromium `chrome/` layer that Electron needs but that Chromium's content layer does not expose, without linking the whole browser product. Changes to those Chromium files are still made through patches, not by editing `chromium_src`.

## Invariants and failure modes

- Patch order is defined only by `.patches`. A patch file that is not listed is ignored by `patch_from_dir`, and a listed file that is missing causes the read to fail.
- Each target repository must be a valid git checkout at the path in `config.json`, because `git am` runs inside it. A missing repository is skipped with a warning, so a broken sync can look successful until the build fails.
- A patch that no longer applies stops the Chromium sync. The fix is either a three-way merge or regenerating the patch against the new upstream commit, followed by an export so the stored files match.
- Exported patch files depend on the upstream base recorded in `refs/patches/upstream-head`. If that ref is missing, `guess_base_commit` in `script/lib/git.py` falls back to `git describe --tags` to pick a base, which can produce a different set of exported patches.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) places patched upstream code within the overall layering.
<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Building Electron](/openwiki/workflows/building.md) covers the `gclient` sync and GN steps that run these hooks.
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md) describes the pull-request expectations for patch changes.
