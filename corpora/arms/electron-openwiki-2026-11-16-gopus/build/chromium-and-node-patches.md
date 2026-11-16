---
type: workflow
title: Patching Chromium, Node and other dependencies
description: How Electron maintains patch series against Chromium, V8, Node.js and other upstream checkouts — patches/config.json, ordered .patches files, the gclient apply hook, git-import-patches / git-export-patches, the refs/patches/upstream-head marker, CI freshness checks, and patch justification rules.
tags: [build, patches, chromium, node, v8, workflow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
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
  - id: openwiki-source-2c163c69c4fa8bf6f3ae3a3d
    resource: repo://script/lib/git.py
  - id: openwiki-source-44a65a63d73c4493c309e083
    resource: repo://script/lib/patches.py
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Patching Chromium, Node and other dependencies

Electron consumes Chromium, Node.js and their dependencies mostly unmodified,
but some behavior can only be changed by patching upstream code. Those changes
live in `patches/` as **git patch series** that are replayed as commits on top
of each pinned upstream checkout. Prefer embedder hooks, subclassing, or the
`chromium_src` source list (see
[Repository layout and layering](../architecture/repository-layout.md)) over a
new patch — every patch is maintenance cost during Chromium/Node upgrades.

## Layout

- `patches/config.json` — array of `{ "patch_dir", "repo" }` targets, paths
  relative to the gclient root. For example `src/electron/patches/chromium`
  → `src`, `patches/v8` → `src/v8`, `patches/node` →
  `src/third_party/electron_node`, plus BoringSSL, DevTools frontend, FFmpeg,
  nan, Perfetto, Squirrel.Mac and its vendored Mantle/ReactiveObjC, WebRTC,
  reclient configs and SQLite.
- `patches/<target>/.patches` — the **apply order**, one filename per line.
  Order is kept in this file rather than numeric prefixes to avoid merge
  conflicts when two PRs append patches.
- `patches/<target>/*.patch` — `git format-patch` output. The commit message
  body must explain why the patch exists.

## Applying patches

`gclient sync` runs the `patch_chromium` hook from `DEPS`, which invokes
`script/apply_all_patches.py src/electron/patches/config.json`. For each
target whose repo exists (missing repos only warn), it:

1. Concatenates the patches listed in `.patches` (`patch_from_dir` in
   `script/lib/patches.py`), injecting `Patch-Dir:` and `Patch-Filename:`
   header lines into each message so a later export can write the patch back
   to the same file name.
2. Calls `git.import_patches`, which first sets
   **`refs/patches/upstream-head`** to the current `HEAD` and then runs
   `git am` with committer "Electron Scripts". Setting
   `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` enables `git am -3`.

A `pre_deps_hooks` entry and `script/patches-mtime-cache.py` optionally
preserve file mtimes of patched files across re-application so incremental
builds don't rebuild everything after a sync.

## Day-to-day workflow

From inside the target checkout (e.g. `src/third_party/electron_node`):

- **Add** — edit, `git commit` with a descriptive subject and justification,
  then `../../electron/script/git-export-patches -o ../../electron/patches/node`.
  Uncommitted changes are ignored.
- **Edit** — `git commit --fixup <sha>`, `git rebase --autosquash -i <sha>^`,
  re-export.
- **Remove** — delete the line from `.patches`, `git reset --hard
  refs/patches/upstream-head`, `git-import-patches`, re-export.
- **Resolve conflicts** after an upstream bump — `git am --abort` then
  `git-import-patches -3 …`; fix conflicts, `git add`, `git am --continue`,
  then re-export.

`script/export_all_patches.py <config.json>` re-exports every target at once.

### How export works

`git.export_patches` (`script/lib/git.py`):

- determines the range from `refs/patches/upstream-head..HEAD` (falling back
  to `git describe --tags` if the ref is missing);
- runs `git format-patch` with a repository-specific attributes file
  (`script/lib/electron.gitattributes`) for stable diffs;
- names each file from its `Patch-Filename:` header, or else derives a
  snake_case name from the commit subject;
- strips the injected location headers, **deletes all existing `*.patch`
  files** in the output directory and rewrites them plus `.patches`, so
  dropped commits disappear.

Re-exporting may change hashes in unrelated patches; committing those changes
is harmless.

## Keeping patches current

`export_all_patches.py --dry-run` re-formats every patch and exits non-zero
listing files whose content differs; `script/check-patch-diff.ts` wraps this
for CI so a PR cannot change an upstream checkout without updating the
exported patches. `script/patch-up.js` is an automation helper used with a
GitHub App credential to push regenerated patch files back to a branch.

## Justification rules

From `docs/development/patches.md`, each patch must be one of:

1. temporary and intended for upstream (link the upstream CL/PR or how to
   verify it is still needed);
2. required to compile in Electron's environment but Electron-specific (explain
   why it can't be done by subclassing or copying);
3. an Electron-specific functional change fundamentally incompatible with
   upstream.

## Related

- How patched checkouts are fetched and built:
  [GN build, DEPS and build configuration](gn-build-and-deps.md).
- Example consequence of a Node patch: builtin `electron/js2c/*` entry
  scripts, described in
  [JS bundles, module lists and native bindings](../architecture/js-bundles-and-native-bindings.md).
