---
title: "Patching Chromium and Node.js"
---
## Overview

Electron builds against unmodified upstream checkouts of Chromium, Node.js, V8 and a few other projects, and then applies its own changes to them as patch series stored in this repository. The alternative, maintaining forks, would make every upstream update a merge; with patches, an update means re-applying a list of small, documented changes and fixing the ones that no longer apply. The `patches/` directory holds one series per project, `patches/config.json` says where each applies, and a handful of scripts move patches between the patch files and git commits in the dependency checkouts. When the dependencies are synced, the `patch_chromium` hook applies them automatically ([[Build System]]).

Sources: [docs/development/patches.md:1-19](repo://docs/development/patches.md#L1-L19), [patches/config.json:1-16](repo://patches/config.json#L1-L16), [DEPS:128-138](repo://DEPS#L128-L138)

## When a patch is acceptable

Every patch is a maintenance cost, because upstream changes can break it silently, so the patch count is kept low. A patch's commit message must say why it exists, and the reason must be one of three:

Sources: [docs/development/patches.md:5-7](repo://docs/development/patches.md#L5-L7)

1. It is temporary: it has been or will be upstreamed, or can be removed later, with a link to the upstream change or a way to check whether it is still needed.
2. It only makes the code compile in Electron's environment and cannot be upstreamed (for example, removing references to Chrome's `Profile`), with an explanation of why subclassing or copying would not work.
3. It changes behaviour in a way that is fundamentally incompatible with upstream.

Sources: [docs/development/patches.md:5-11](repo://docs/development/patches.md#L5-L11)

The guidance is to upstream changes whenever possible, including refactors that make code work for both projects, and to avoid indefinite-lifetime patches.

Sources: [docs/development/patches.md:13-13](repo://docs/development/patches.md#L13-L13)

## Layout

### Patch sets and targets

`patches/config.json` maps each patch directory to the repository it applies to, relative to the gclient root.

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

| Patch directory | Applies to |
| --- | --- |
| `patches/chromium` | `src` (Chromium) |
| `patches/v8` | `src/v8` |
| `patches/node` | `src/third_party/electron_node` |
| `patches/boringssl` | `src/third_party/boringssl/src` |
| `patches/devtools_frontend` | `src/third_party/devtools-frontend/src` |
| `patches/ffmpeg`, `patches/webrtc`, `patches/perfetto`, `patches/sqlite` | The matching `src/third_party` checkouts |
| `patches/nan` | `src/third_party/nan` |
| `patches/squirrel.mac`, `patches/Mantle`, `patches/ReactiveObjC` | Squirrel.Mac and its vendored dependencies |
| `patches/reclient-configs` | `src/third_party/engflow-reclient-configs` |

Sources: [patches/config.json:1-16](repo://patches/config.json#L1-L16)

### The .patches file

Each directory contains the patch files plus a `.patches` file listing their names in application order. Ordering lives in that file rather than in numeric filename prefixes, so two pull requests that each append a patch do not both claim the same number, and inserting or deleting a patch does not rename the rest.

Sources: [docs/development/patches.md:19-38](repo://docs/development/patches.md#L19-L38), [script/lib/patches.py:31-40](repo://script/lib/patches.py#L31-L40)

## Applying patches

`script/apply_all_patches.py` reads one or more config files and, for each entry whose repository exists, imports the directory's series with `git am`. Setting `ELECTRON_USE_THREE_WAY_MERGE_FOR_PATCHES` makes it use a three-way merge. Commits are made with the committer name `Electron Scripts` and email `scripts@electron`.

Sources: [script/apply_all_patches.py:11-45](repo://script/apply_all_patches.py#L11-L45)

`patch_from_dir` concatenates the patches in `.patches` order. While doing so, `read_patch` inserts two trailer lines into each commit message, `Patch-Dir:` and `Patch-Filename:`, just before the diff, so every resulting commit remembers which file it came from.

Sources: [script/lib/patches.py:1-40](repo://script/lib/patches.py#L1-L40)

`git.import_patches` first points `refs/patches/upstream-head` at the current `HEAD`, marking where upstream ends and Electron's patches begin, then runs `git am` with `--keep-cr` (some patches touch files with Windows line endings), optional `--3way`, the committer identity, and GPG signing disabled. A non-zero exit raises an error and stops the sync.

Sources: [script/lib/git.py:21-21](repo://script/lib/git.py#L21-L21), [script/lib/git.py:53-85](repo://script/lib/git.py#L53-L85)

## Exporting patches

`git.export_patches` turns the commits after `refs/patches/upstream-head` back into files. If that ref is missing it falls back to the most recent tag. It runs `git format-patch` with options chosen to keep patch files stable across machines and git versions: `--keep-subject`, `--no-stat`, `--no-signature`, `--zero-commit` (no parent hash) and `--full-index`, with Electron's own `.gitattributes`.

Sources: [script/lib/git.py:102-155](repo://script/lib/git.py#L102-L155), [script/lib/git.py:224-238](repo://script/lib/git.py#L224-L238)

Each patch is written to the file named by its `Patch-Filename:` trailer, or, for a new commit, to a name derived from the subject (lowercased, non-alphanumerics replaced by underscores). The trailers are stripped from the written file. Before writing, every existing `.patch` file in the directory is deleted, so a dropped commit shows up as a deleted file, and `.patches` is rewritten in commit order.

Sources: [script/lib/git.py:180-222](repo://script/lib/git.py#L180-L222), [script/lib/git.py:262-289](repo://script/lib/git.py#L262-L289)

With `--dry-run`, export compares each regenerated patch with the file on disk and fails if any differ, which is how a check can tell that patches are out of date.

Sources: [script/lib/git.py:247-261](repo://script/lib/git.py#L247-L261), [script/export_all_patches.py:11-40](repo://script/export_all_patches.py#L11-L40)

## Developer workflow

### The two tools

`script/git-import-patches <dir>` applies a patch directory to the repository in the current directory (with `-3` for three-way merges), and `script/git-export-patches -o <dir>` writes the commits since `refs/patches/upstream-head` back to it, optionally limited with `--grep` or an explicit range. `export_all_patches.py` exports every set in a config.

Sources: [script/git-import-patches:10-25](repo://script/git-import-patches#L10-L25), [script/git-export-patches:8-21](repo://script/git-export-patches#L8-L21), [script/export_all_patches.py:11-40](repo://script/export_all_patches.py#L11-L40)

### Common tasks

| Task | Steps |
| --- | --- |
| Add a patch | Edit in the dependency checkout, `git commit` with the justification in the message body, then `git-export-patches -o …/patches/<project>`. Uncommitted changes are ignored. |
| Edit a patch | `git commit --fixup <sha>`, `git rebase --autosquash -i <sha>^`, then export. |
| Remove a patch | Delete its line from `.patches`, `git reset --hard refs/patches/upstream-head`, re-import, then export. |
| Resolve conflicts after an upstream bump | `git am --abort`, re-import with `-3`, fix conflicts by hand, `git add`, `git am --continue`, then export. |

Sources: [docs/development/patches.md:40-96](repo://docs/development/patches.md#L40-L96)

Re-exporting can change hashes inside unrelated patches; the docs ask contributors to commit those changes too, so they stop appearing for others.

Sources: [docs/development/patches.md:51-56](repo://docs/development/patches.md#L51-L56)

### In CI

The checkout action syncs with three-way merging enabled and then, for non-release builds, re-exports all patches. If that changes any patch file, the job commits the regenerated patches as "chore: update patches" (pushing them to the branch when it can) and fails, so the patch files in the repository are kept matching what actually applies.

Sources: [.github/actions/checkout/action.yml:111-130](repo://.github/actions/checkout/action.yml#L111-L130)
