---
title: "Patches to Chromium and Node"
---
## Overview

Electron keeps its changes to Chromium, Node.js and the other vendored dependencies as patch files in `patches/`. Each dependency has a directory of patches, and `patches/config.json` maps each directory to the checkout path it applies to. Scripts apply the patches as commits on that checkout, and export them back from it.

Sources: [patches/config.json:2-15](repo://patches/config.json#L2-L15), [docs/development/patches.md:15-19](repo://docs/development/patches.md#L15-L19)

## The config file

`patches/config.json` lists one object per target, each with a `patch_dir` and a `repo`. The first entry maps the `chromium` patch directory to the `src` checkout, and the Node entry maps `node` to `src/third_party/electron_node`. The other entries cover V8, FFmpeg, BoringSSL, DevTools, WebRTC, Perfetto, Sqlite and the macOS squirrel vendor libraries.

Sources: [patches/config.json:2-15](repo://patches/config.json#L2-L15)

## The patch list

Each patch directory has a `.patches` file that names its patch files in the order they are applied. `patch_from_dir` reads that list and joins the files in order into one mailbox-format stream for `git am`.

Sources: [script/lib/patches.py:31-40](repo://script/lib/patches.py#L31-L40)

`read_patch` adds two headers to each file's commit message, `Patch-Dir` and `Patch-Filename`, before the first `diff -` or `---` line. A commit made from a patch therefore records where the patch came from.

Sources: [script/lib/patches.py:6-8](repo://script/lib/patches.py#L6-L8), [script/lib/patches.py:14-28](repo://script/lib/patches.py#L14-L28)

## Applying the patches

`apply_all_patches.py` takes each target from the config. It skips a target whose repo does not exist, with a warning. Otherwise it imports the patch stream into the repo as commits, committed by `Electron Scripts`. Three-way merging is used only when `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` is set.

Sources: [script/apply_all_patches.py:8-25](repo://script/apply_all_patches.py#L8-L25), [script/apply_all_patches.py:11](repo://script/apply_all_patches.py#L11)

`git.import_patches` first saves the current `HEAD` of the checkout as `UPSTREAM_HEAD`, and then runs `am`. Keeping that ref is what lets an export later find the patches that Electron added on top of upstream.

Sources: [script/lib/git.py:81-85](repo://script/lib/git.py#L81-L85)

`export_all_patches.py` does the reverse for each target. It exports the commits in the checkout back into the target's `patch_dir`, with an optional grep filter.

Sources: [script/export_all_patches.py:11-21](repo://script/export_all_patches.py#L11-L21)

The lint step checks each target before anything is applied. The patch directory must exist, and it must have a `.patches` file.

Sources: [script/lint.js:216-226](repo://script/lint.js#L216-L226)

## Patch justification

Every patch has to state why it exists, and the project accepts three reasons. The patch is temporary and will be upstreamed or removed, the patch makes the code compile in Electron but cannot be upstreamed because it is Electron-specific, or the patch makes Electron-specific changes that cannot fit upstream. The reason goes in the commit message.

Sources: [docs/development/patches.md:5-11](repo://docs/development/patches.md#L5-L11)

## Adding and editing patches

The docs describe adding a patch as a commit in the checkout, followed by an export. The export ignores uncommitted files, so a change must be committed before it can become a patch. The commit subject sets the patch's file name.

Sources: [docs/development/patches.md:41-56](repo://docs/development/patches.md#L41-L56)

## Patch statistics and upkeep

`patches-stats.mjs` reads `config.json`, counts the patches listed in each target's `.patches` file, and uploads the totals when given `--upload-stats`.

Sources: [script/patches-stats.mjs:8-20](repo://script/patches-stats.mjs#L8-L20)

`patch-up.js` is a CI helper for pull requests. It requires `PATCH_UP_APP_CREDS` and `GITHUB_HEAD_REF`, reads every `.patch` file, `README.md` and `config.json` under `patches/`, and commits them to the PR branch as `chore: update patches`.

Sources: [script/patch-up.js:8](repo://script/patch-up.js#L8), [script/patch-up.js:47-56](repo://script/patch-up.js#L47-L56), [script/patch-up.js:13-37](repo://script/patch-up.js#L13-L37), [script/patch-up.js:103](repo://script/patch-up.js#L103)
