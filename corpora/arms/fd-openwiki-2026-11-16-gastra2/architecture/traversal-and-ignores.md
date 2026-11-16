---
type: architecture
title: Parallel traversal and ignore rules
description: How fd configures ignore-aware traversal, prunes directories, handles symlinks and transfers results to consumers.
tags: [traversal, ignore, concurrency, filesystem]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:13:39.635Z
sources:
  - id: openwiki-source-b6bf99460c374536f95cd6f1
    resource: repo://src/dir_entry.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "codex", at: "2026-11-16T17:13:39.635Z" }
---

# Parallel traversal and ignore rules

`WorkerState::build_walker` configures the `ignore` crate's parallel walker. `spawn_senders` adds fd's per-entry matching and filtering. A path can disappear from results before pattern matching because its directory was hidden, ignored, beyond the depth limit, or explicitly pruned.

## Ignore inputs and controls

The default configuration skips hidden entries and enables `.ignore`, `.fdignore`, Git ignore sources, parent ignore files, and the global fd ignore file. Git-related rules normally require a Git repository. The global fd file is `fd/ignore` below the configuration directory selected by `etcetera`; on the Unix configuration path this supports `XDG_CONFIG_HOME`.

| Control | Effect |
| --- | --- |
| `-H`, `--hidden` | Include hidden entries; ignore-file rules still apply. |
| `-I`, `--no-ignore` | Disable automatic fd/general, Git and global fd ignore sources; hidden filtering remains independent. |
| `-u`, `--unrestricted` | Include both hidden and automatically ignored entries. |
| `--no-ignore-vcs` | Disable Git rules while leaving general/fd rules enabled. |
| `--no-require-git` | Apply Git ignore sources even outside a Git repository. |
| `--no-ignore-parent` | Stop loading ignore rules from parents. |
| `--no-global-ignore-file` | Disable the global fd ignore file. |
| `--ignore-file PATH` | Add an explicit ignore file; these are added independently of the automatic-ignore switches. |
| `-E GLOB` | Add an exclusion override independently of automatic-ignore switches. |

See [configuration resolution](../../src/main.rs#L310-L320) and [walker setup](../../src/walk.rs#L330-L403). Malformed exclusion overrides fail setup. Global and explicit ignore-file loading reports non-partial errors without aborting the scan; partial parse errors are ignored by this layer.

Ignore precedence is delegated to `ignore`. A concrete regression test establishes that a parent `.fdignore` inclusion (`!foo`) can override a child's `.gitignore` exclusion. Other tests distinguish `.fdignore` from Git rules and verify repository detection. See [test_custom_ignore_precedence](../../tests/tests.rs#L862-L884) and [test_respect_ignore_files](../../tests/tests.rs#L888-L940).

## Traversal versus result filtering

Maximum depth and `--one-file-system` constrain the walker itself. Minimum depth is a result filter: entries too close to the root are skipped as results while traversal continues. `--exact-depth` supplies both limits. Root entries at depth zero are not returned.

`--ignore-contain NAME` checks whether a directory contains any configured marker and skips that entire directory. This happens before root suppression and minimum-depth filtering, so a marker in a search root can suppress the whole search. `--prune` happens later: after an entry passes all predicates and is sent, the callback returns `Skip`, preventing descent into a matching directory. It is useful for returning a matching directory once without returning its descendants. See [callback ordering](../../src/walk.rs#L459-L512) and [post-match pruning](../../src/walk.rs#L600-L611).

`--follow` enables link traversal. If following produces a path-associated not-found error but `symlink_metadata` confirms a symlink, fd recovers it as a broken-symlink entry. That representation has no known depth, so a minimum-depth constraint rejects it. Other walk errors become `WorkerResult::Error`; consumers print them only with `--show-errors` and otherwise continue. See [error recovery](../../src/walk.rs#L485-L512) and [DirEntry](../../src/dir_entry.rs#L82-L103).

## Parallel transport and shutdown

Workers send shared batches through a channel whose capacity is `2 * threads`. A normal batch holds up to 256 results; the receiver can take it before it fills. Per-result command execution with multiple receivers uses batches of one to distribute work. The sender starts a new batch when its limit is reached or the receiver has already taken the previous batch. See [BatchSender](../../src/walk.rs#L47-L121) and [batch sizing](../../src/walk.rs#L449-L457).

Workers check an atomic quit flag and stop if the channel disconnects. The printing receiver sets the quit flag when it terminates, including quiet-mode success or a result limit. fd installs its custom Ctrl-C handler only for colored printing: the first interrupt sets quit and interrupt flags; a second exits immediately. The scan checks the interrupt flag again after joining the receiver. See [scan lifecycle](../../src/walk.rs#L616-L652).

## Diagnosing missing entries

Start with `fd -HI PATTERN ROOT` to separate hidden and automatic-ignore effects. Then check explicit exclusions and ignore files, marker pruning, depth limits, link following, and [matching predicates](../concepts/patterns-and-filters.md). Use `--show-errors` to expose walk failures. `-HI` does not remove independent filters or grant filesystem access.

Focused regression coverage includes `test_gitignore_and_fdignore`, `test_no_ignore_parent`, `test_follow_broken_symlink`, `test_prune`, and the three `test_ignore_contain` cases. The marker tests explicitly cover root and minimum-depth ordering. See [tests/tests.rs](../../tests/tests.rs#L2830-L2878).

Related: [search ownership](search-pipeline.md), [patterns and filters](../concepts/patterns-and-filters.md), [printing and ordering](../workflows/output-and-pipelines.md).
