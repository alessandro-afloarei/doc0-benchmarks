---
type: concept
title: Filtering and Ignore Rules
description: Which filesystem entries fd visits and reports - hidden-file handling, .gitignore/.fdignore/global/custom ignore files, exclude globs, --ignore-contain, and the ordered per-entry filter chain for depth, pattern, extension, type, owner, size and modification time.
tags: [filters, ignore, gitignore, fdignore, exclude, file-types, size, time, owner]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-f5ea23b51c582bb354c81514
    resource: repo://src/filesystem.rs
  - id: openwiki-source-8b3eaed746bb796650559c48
    resource: repo://src/filetypes.rs
  - id: openwiki-source-c7455adc83d664149895de1b
    resource: repo://src/filter/owner.rs
  - id: openwiki-source-a0933a10afe9624b44e21d5f
    resource: repo://src/filter/size.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Filtering and Ignore Rules

fd decides what to show in two layers:

1. **Traversal pruning** by the `ignore` crate's `WalkBuilder` — hidden entries, ignore files, `--exclude` overrides, `--max-depth`, symlink policy and file-system boundaries. Pruned directories are never descended.
2. **Per-entry filters** in fd's sender callback (`spawn_senders` in `src/walk.rs`) — patterns and metadata filters. A rejected entry is not reported, but (if it is a directory) its children are still visited.

The flags feeding both layers are resolved in [CLI Parsing and Config Construction](../architecture/cli-to-config.md).

## Layer 1: walker configuration (`WorkerState::build_walker`)

| Builder setting | Config source | Default |
|-----------------|---------------|---------|
| `hidden(...)` | `ignore_hidden` (`-H`, `-u`) | hidden entries skipped |
| `ignore(...)` + custom filename `.fdignore` | `read_fdignore` (`-I`, `-u`) | `.ignore` and `.fdignore` respected |
| `git_ignore`, `git_global`, `git_exclude` | `read_vcsignore` (`--no-ignore-vcs`, `-I`, `-u`) | `.gitignore`, global git excludes and `.git/info/exclude` respected |
| `require_git(...)` | `require_git_to_read_vcsignore` (`--no-require-git`) | gitignore rules only inside a git repository |
| `parents(...)` | `read_parent_ignore && (read_fdignore \|\| read_vcsignore)` | ignore files in parent directories of the search root respected |
| `overrides(...)` | `--exclude` globs, stored as `!glob` | none |
| `follow_links` | `-L/--follow` | symlinked directories not followed |
| `same_file_system` | `--one-file-system` (aliases `--mount`, `--xdev`) | off |
| `max_depth` | `--max-depth` / `--exact-depth` | unlimited |
| `threads` | `-j/--threads` | CPU count, max 64 |

Additional ignore sources added on top:

- **Global fd ignore file**: if `read_global_ignore`, `<config dir>/fd/ignore` from `etcetera::choose_base_strategy()` (e.g. `~/.config/fd/ignore` / `$XDG_CONFIG_HOME/fd/ignore`; `%APPDATA%\fd\ignore` on Windows per the README). Disabled by `--no-global-ignore-file`, `-I`, `-u`.
- **Custom ignore files**: every `--ignore-file <path>` in `.gitignore` syntax, added via `builder.add_ignore`. fd adds these unconditionally (no `read_*` flag guards the loop); whether the `ignore` crate then applies them under `--no-ignore` is governed by that crate.

Malformed patterns in the global or custom ignore files are reported via `print_error`; `ignore::Error::Partial` results are tolerated silently.

### Precedence and overrides

- The `ignore` crate gives `.fdignore`/`.ignore` higher precedence than `.gitignore`, so a `!foo` whitelist in `.fdignore` re-includes a file ignored by `.gitignore` (`test_custom_ignore_precedence`).
- `--exclude` globs are `ignore::overrides` rooted at the **first** search path. Since every override pattern is an exclusion (`!`), they only remove entries and cannot re-include ignored ones. A malformed glob fails the run (`Malformed exclude pattern`).
- Multiple search paths share one builder: the first is the builder root, others are `add`ed.

### `--ignore-contain <name>`

Checked in the sender callback, before anything else for directories: if `<dir>/<name>` exists, the callback returns `WalkState::Skip`, so neither the directory nor its contents are reported. This is designed for markers such as `CACHEDIR.TAG`. Because it runs before the depth-0 check, a search root containing the marker yields no results (`test_ignore_contain_precedence_over_root_check`), and it takes effect regardless of `--min-depth` (`test_ignore_contain_precedence_over_depth_check`).

## Layer 2: per-entry filter chain

Order matters for performance: cheap name checks come first, metadata-dependent checks last. For each entry the callback, in order:

1. **Root skip** — depth 0 entries are never reported.
2. **Min depth** — `--min-depth` / `--exact-depth`; broken symlinks (no depth) are rejected when a minimum is set.
3. **Patterns** — every compiled regex (positional pattern and each `--and`) must match the *search string*: the file name by default, or with `--full-path` the absolute path (`full_path_base` joined with the entry path stripped of `./`).
4. **Extension** — `-e/--extension` `RegexSet` (case-insensitive `.\.ext$`) must match the file name. Note the leading `.` in the regex: a file named exactly `.ext` does not match.
5. **File type** — `-t/--type` via `FileTypes::should_ignore`.
6. **Owner** (Unix) — `-o/--owner user:group`; entries without readable metadata are rejected.
7. **Size** — `-S/--size`; only regular files pass when any size constraint is given (directories are rejected); **all** constraints must hold.
8. **Modification time** — `--changed-within` / `--changed-before`; all constraints must hold; entries without an mtime are rejected.
9. After sending: **prune** — `--prune` returns `Skip` so a matching directory is not descended.

## File types (`src/filetypes.rs`)

`-t` values (`f`/`file`, `d`/`dir`/`directory`, `l`/`symlink`, `x`/`executable`, `e`/`empty`, `s`/`socket`, `p`/`pipe`, `c`/`char-device`, `b`/`block-device`) set flags in `FileTypes`. `should_ignore` rejects an entry whose type is not selected, plus:

- `executable` implies `file` and additionally requires `faccess` `executable()` on the path.
- `empty` alone implies files **and** directories; emptiness is a zero-length file or a directory whose `read_dir` yields nothing (`filesystem::is_empty`).
- Entries with unknown type, or of a type not covered by the list, are always rejected when `-t` is used.
- Block/char devices, sockets and pipes are always `false` on Windows.

The file type comes from the walker's `DirEntry::file_type()` (or, for broken symlinks, from `symlink_metadata`), so it reflects the walker's `-L/--follow` policy.

## Size filter (`src/filter/size.rs`)

Syntax: `[+|-]<number><unit>`, case-insensitive, regex `^([+-]?)(\d+)(b|[kmgt]i?b?)$`.

- `+` → minimum (`>=`), `-` → maximum (`<=`), no sign → exact size.
- Units: `b` bytes; `k`, `m`, `g`, `t` (optionally with `b`) are SI powers of 1000; `ki`, `mi`, `gi`, `ti` (optionally with `b`) are powers of 1024.
- Several `-S` flags combine with AND, e.g. `-S +1k -S -1M`.

## Time filter (`src/filter/time.rs`)

`TimeFilter::from_str` tries, in order:

1. a `jiff::Span` duration (e.g. `10h`, `1d`, `2weeks`) subtracted from now;
2. an RFC 3339 / ISO `jiff::Timestamp`;
3. a civil `DateTime` (e.g. `2018-10-27 10:00:00`), interpreted in the system time zone (`.later()` for ambiguous times);
4. `@<unix-seconds>`.

`--changed-within` (aliases `--change-newer-than`, `--newer`, `--changed-after`) yields `After(t)` (`mtime > t`); `--changed-before` (aliases `--change-older-than`, `--older`) yields `Before(t)` (`mtime < t`). Both bounds are strict. Tests override "now" through a thread-local `TESTTIME`.

## Owner filter (`src/filter/owner.rs`, Unix only)

Format `[!]user[:[!]group]`: each side is a numeric id or a name resolved via `nix::unistd::User/Group::from_name`; a leading `!` negates. Empty sides are ignored, and an all-ignore filter (`""`, `":"`) is dropped entirely by `OwnerFilter::filter_ignore`. More than one `:` is an error.

## Hidden files and leading-dot patterns

Hidden filtering is done by the walker, so a pattern like `^\.gitignore` would never match. fd detects the simplest form of this (start anchor followed by a literal `.`) and errors unless `-H` is given — see [CLI Parsing and Config Construction](../architecture/cli-to-config.md#early-validation-errors). On Windows, the `ignore` crate also treats the hidden file attribute as hidden (`test_hidden_file_attribute`).

## Tests

`tests/tests.rs` has dedicated tests for nearly every switch: `test_hidden`, `test_no_ignore`, `test_gitignore_and_fdignore`, `test_no_ignore_parent*`, `test_respect_ignore_files`, `test_no_ignore_vcs*`, `test_custom_ignore_files`, `test_global_ignore`, `test_no_global_ignore`, `test_excludes`, `test_type*`, `test_extension`, `test_size`, `test_modified_*`, `test_owner_*`, `test_min_depth`, `test_exact_depth`, `test_prune`, `test_follow*`, `test_file_system_boundaries`, `test_git_dir`, `test_gitignore_parent`, `test_ignore_contain*`. The default fixture creates a fake `.git` directory so gitignore rules apply (see [Test Suite](../testing/test-suite.md)). Parsing tables for size, time and owner filters are unit-tested inside their modules.

Related: [Parallel Walk Pipeline](../architecture/parallel-walk-pipeline.md) for how the callback fits into the concurrency model.
