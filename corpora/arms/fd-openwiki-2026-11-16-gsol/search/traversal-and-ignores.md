---
type: traversal-policy
title: Traversal boundaries and ignore rules
description: Diagnose missing fd results through hidden and ignore policies, explicit exclusions, depth, links, filesystem boundaries, pruning, and marker-directory exclusion.
tags: [search, traversal, ignore, configuration, troubleshooting]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:51.346Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T06:05:51.346Z" }
---

# Traversal boundaries and ignore rules

`WorkerState::build_walker` configures the `ignore` crate's parallel walker. It delegates discovery-time ignore semantics to that dependency, then adds fd-specific checks in each worker callback. These policies determine whether entries can reach [pattern matching](patterns-and-paths.md) and [metadata filtering](metadata-filters.md) at all.

## Default visibility and escape hatches

By default, hidden entries are excluded, `.ignore` and `.fdignore` rules are enabled, Git ignore sources are enabled when Git repository detection applies, and parent ignore files are read. The fd global ignore file is enabled independently of the Git global ignore source.

| Option | Effect in fd configuration |
| --- | --- |
| `-H`, `--hidden` | Include hidden entries while retaining ignore-file rules |
| `-I`, `--no-ignore` | Disable automatic generic/fd, VCS, and fd global ignore sources while retaining hidden exclusion |
| `-u`, `--unrestricted` | Combine hidden inclusion with the automatic ignore-source disabling above |
| `--no-ignore-vcs` | Disable Git ignore, global Git ignore, and repository exclude sources; keep generic/fd rules |
| `--no-require-git` | Apply enabled Git ignore sources even without Git repository detection |
| `--no-ignore-parent` | Disable inherited parent-directory ignore rules |
| `--no-global-ignore-file` | Disable fd's global ignore file; it is not the VCS-ignore switch |

Opposing switches such as `--no-hidden`, `--ignore`, `--ignore-vcs`, and `--require-git` exist for overriding earlier arguments. Repeating `-u` does not progressively enable new search classes: the derived policy tests whether its count is greater than zero.

Unrestricted mode does not cancel explicit `--exclude`, explicitly supplied `--ignore-file`, marker checks, depth limits, type filters, or other search restrictions. It changes the automatic visibility/ignore policies only.

Git administration directories are not categorically forbidden. `test_git_dir` verifies that `--hidden` can reveal matching files inside `.git` when no other rule excludes them. To include hidden project files while excluding Git internals, use `fd -H -E .git`.

## Ignore sources and exclusions

When generic/fd ignore reading is enabled, fd enables `.ignore` reading and registers `.fdignore` as a custom ignore filename. Git ignore, global Git ignore, and Git exclude sources share the VCS policy switch. Parent reading is enabled only when requested and at least one generic/fd or VCS source is active.

The fd global path is computed by `etcetera::choose_base_strategy()` as `config_dir()/fd/ignore`. The README describes typical locations as `~/.config/fd/ignore` on Linux/macOS and `%APPDATA%\fd\ignore` on Windows. If no base strategy is available or the file is absent, the walker proceeds without that source. Treat this as fd configuration, separate from Git's own global ignore configuration.

Each explicit `--ignore-file` is added unconditionally after the optional global file, even when automatic sources are disabled. For both kinds of added file, `ignore::Error::Partial` receives no extra diagnostic here; other returned errors print a malformed-pattern message and do not abort walker construction.

`-E`/`--exclude` accepts glob patterns. Configuration prefixes each with `!` for the `ignore::overrides` API and builds overrides relative to the first search root. These overrides are passed into the walker and take precedence over ordinary ignore logic. Invalid override syntax fails scan setup instead of being silently ignored.

Precedence is not a simple union of all ignore files: `test_custom_ignore_precedence` demonstrates a parent `.fdignore` rule `!foo` admitting `inner/foo` despite an inner `.gitignore` exclusion. Consult the focused tests when changing dependency versions or configuration; do not implement a separate approximate matcher in fd.

## Depth, markers, and pruning

Search roots have depth zero and are not emitted. A maximum depth is applied to `WalkBuilder` and limits descent; minimum depth is checked in the callback and suppresses results without stopping descent. `--exact-depth N` sets both bounds and conflicts with individually supplied min/max bounds.

`--ignore-contain NAME` checks directories for an existing joined entry of that name. If any supplied marker exists, the worker returns `Skip` before root suppression, minimum-depth filtering, name matching, or metadata predicates. The directory itself is omitted as well as its subtree. The marker's contents are not inspected. A marker in a search root can suppress that whole root:

```sh
fd --ignore-contain CACHEDIR.TAG
```

`--prune` is different: it skips descent only after a candidate passes all active result criteria and has been sent downstream. A matched directory is still reported; a nonmatching directory remains traversable. For example, `fd --prune foo` reports matching `foo` directories without searching beneath them. The CLI makes pruning conflict with size constraints and exact depth.

## Links and filesystem boundaries

By default, fd does not descend into symlinked directories; `-L`/`--follow` enables following. A symlink supplied as a search root has separate dependency behavior covered by `test_symlink_as_root` and related absolute/full-path cases. Avoid inferring root handling solely from descendant link policy.

Following links can change the entry type observed by filters. `test_follow_broken_symlink` verifies that with `--follow -t l`, the broken symlink remains a symlink result while the valid followed link is no longer returned by that selection.

The callback recovers a path-bearing NotFound traversal error as a broken-link entry when `symlink_metadata` confirms a symlink. Other traversal errors are sent to consumers. Recovered broken links have no known depth, so an active minimum-depth check rejects them. `--one-file-system` delegates same-filesystem traversal enforcement to the walker.

## Diagnosing missing results

Start with a broader visibility check such as `fd -u pattern root`, then check the matching target (`-p` for absolute full-path matching), pattern case/mode, explicit exclusions and ignore files, marker/depth/prune restrictions, link following, and metadata filters. Add `--show-errors` to reveal traversal errors such as permission problems. Reported traversal errors do not themselves change the normal success status; setup errors do. [Search pipeline](../architecture/search-pipeline.md) explains termination and quiet-mode status.

Regression anchors include `test_gitignore_and_fdignore`, `test_respect_ignore_files`, `test_custom_ignore_precedence`, `test_no_ignore_vcs_child_dir`, `test_global_ignore`, `test_custom_ignore_files`, `test_excludes`, `test_*_depth`, `test_prune`, `test_follow_broken_symlink`, and all three `test_ignore_contain*` cases. The marker tests specifically pin precedence over minimum depth and root suppression.
