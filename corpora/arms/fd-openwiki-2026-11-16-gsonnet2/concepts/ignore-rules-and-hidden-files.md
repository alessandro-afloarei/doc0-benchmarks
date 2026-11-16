---
type: concept
title: Ignore Rules, Hidden Files and Traversal Control
description: How fd's visibility and traversal flags - hidden files, .gitignore/.fdignore/global/custom ignore files, --exclude, --ignore-contain, --prune, depth limits, symlink following and one-file-system - map onto the ignore crate's WalkBuilder and its precedence rules.
tags: [ignore, gitignore, fdignore, hidden, traversal, walkbuilder]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Ignore Rules, Hidden Files and Traversal Control

fd does not implement ignore-file parsing itself. It delegates to the `ignore` crate's `WalkBuilder` and translates its own flags into builder settings in `WorkerState::build_walker` (`src/walk.rs`); a few rules (`--ignore-contain`, `--prune`, depth) are enforced in the per-entry closure. The flags are parsed in `src/cli.rs` and resolved into booleans in `main.rs::construct_config` (see [[architecture/cli-and-config]]).

## Flag-to-setting map

| User intent | Config field | WalkBuilder effect |
| --- | --- | --- |
| default: skip dotfiles | `ignore_hidden = !(--hidden \|\| -u)` | `.hidden(true)` |
| `.fdignore` files | `read_fdignore = !(--no-ignore \|\| -u)` | `.ignore(..)` plus `add_custom_ignore_filename(".fdignore")` |
| `.gitignore`, global git ignore, `.git/info/exclude` | `read_vcsignore = !(--no-ignore \|\| -u \|\| --no-ignore-vcs)` | `.git_ignore`, `.git_global`, `.git_exclude` |
| work outside git repos | `require_git_to_read_vcsignore = !--no-require-git` | `.require_git(..)` |
| ignore files in parent dirs | `read_parent_ignore = !--no-ignore-parent` | `.parents(read_parent_ignore && (read_fdignore \|\| read_vcsignore))` |
| global fd ignore | `read_global_ignore = !(--no-ignore \|\| -u \|\| --no-global-ignore-file)` | `add_ignore(<config_dir>/fd/ignore)` |
| extra ignore files | `ignore_files` from `--ignore-file` | `add_ignore(file)` each |
| follow symlinks | `follow_links` (`-L`) | `.follow_links(..)` |
| stay on one device | `one_file_system` | `.same_file_system(..)` |
| depth bounds | `max_depth` / `min_depth` (`--exact-depth` sets both) | `.max_depth(..)`; min depth enforced in the closure |

`-I` (`--no-ignore`) turns off `.fdignore`, VCS and global ignores together, while `--no-ignore-vcs` only affects VCS files. `-u` additionally shows hidden files. The visible/hidden flag pairs (for example `--hidden`/`--no-hidden`) mean the last one on the command line wins.

## Precedence

The underlying crate applies the usual gitignore semantics where more specific/later rules win, and fd documents these relationships in the flag help:

- `--exclude` globs are the strongest: they are installed as an `Override` on the walker, each pattern prefixed with `!` so it excludes matching paths, and "override any other ignore logic". Invalid globs fail with "Malformed exclude pattern".
- Custom `--ignore-file` files have **low** precedence compared with `.gitignore`/`.fdignore` in the tree.
- A `.fdignore` whitelist (`!foo`) overrides a `.gitignore` exclusion of the same file, because `.fdignore` is registered as a custom ignore filename that outranks `.gitignore` (`test_custom_ignore_precedence`).
- The global ignore file is looked up with `etcetera::choose_base_strategy()` at `<config_dir>/fd/ignore`; it is only used if the file exists. Malformed patterns print an error but do not abort.

`.gitignore` is respected only inside a git repository by default (a `.git` directory is required). This is why the integration test fixture creates an empty `.git` directory (see [[operations/testing]]).

## Rules enforced by fd itself

- **`--ignore-contain <name>`**: in the sender closure, any directory that directly contains an entry with that name is skipped with `WalkState::Skip`, before the root-entry and depth checks, so it takes precedence over them (covered by `test_ignore_contain_precedence_over_*`). This supports markers like `CACHEDIR.TAG`.
- **`--prune`**: after a matching entry is sent, the walker returns `Skip`, so the matched directory's children are not visited.
- **`--min-depth`**: entries shallower than the minimum are not reported but are still traversed.
- **Search roots**: depth-0 root entries are never reported. See [[architecture/parallel-walk-pipeline]] for the order of checks.

## Hidden files and patterns

Hidden means "name starts with `.`" on Unix (the `ignore` crate also honours the Windows hidden attribute, covered by `test_hidden_file_attribute`). Because a leading-dot pattern can never succeed while hidden files are filtered, fd rejects it up front on Unix (see [[architecture/pattern-matching]]).

## Related tests

`test_hidden`, `test_no_ignore`, `test_gitignore_and_fdignore`, `test_no_ignore_parent`, `test_custom_ignore_precedence`, `test_no_ignore_vcs`, `test_global_ignore`, `test_follow`, `test_file_system_boundaries`, `test_prune`, `test_excludes`, `test_ignore_contain*` in `tests/tests.rs`.
