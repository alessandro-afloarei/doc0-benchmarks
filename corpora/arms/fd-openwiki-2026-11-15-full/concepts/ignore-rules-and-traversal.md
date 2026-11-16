---
type: concept
title: Ignore Rules and Traversal Controls
description: Which entries fd skips by default and how each ignore or traversal flag maps onto ignore::WalkBuilder. Covers hidden files, .gitignore, .ignore and .fdignore, the global fd/ignore file, --ignore-file, --exclude, --ignore-contain, depth limits, --prune, --follow, --one-file-system, --no-require-git and -u.
tags: [ignore, gitignore, fdignore, traversal, depth, symlinks, walker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:44:06.029Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T08:44:06.029Z" }
---

# Ignore Rules and Traversal Controls

fd hands directory traversal and ignore-file processing to the [`ignore`](https://docs.rs/ignore) crate, the same library ripgrep uses. fd's own job is to turn CLI flags into booleans in `Config` (`construct_config` in `src/main.rs`) and then into `WalkBuilder` calls (`WorkerState::build_walker` in `src/walk.rs`). A few controls are implemented by fd itself inside the per-entry closure.

## Defaults

With no flags, fd:

- skips **hidden** entries (names that start with `.`; on Windows, entries with the hidden attribute are skipped too, per `test_hidden_file_attribute`);
- respects `.gitignore`, `.git/info/exclude`, and the global git excludes file, **but only inside a git repository**;
- respects `.ignore` and `.fdignore` files everywhere;
- respects ignore files found in **parent directories** of the search root;
- respects the global fd ignore file at `<config dir>/fd/ignore`;
- does **not** follow symlinked directories;
- has no depth limit.

## Flag → Config → WalkBuilder mapping

| CLI | Config field | WalkBuilder call |
| --- | --- | --- |
| `-H/--hidden` (undo with `--no-hidden`) | `ignore_hidden = false` | `.hidden(false)` |
| `-I/--no-ignore` (undo with `--ignore`) | `read_fdignore`, `read_vcsignore`, `read_global_ignore` all false | `.ignore(false)`, `.git_*(false)`, no `.fdignore`, no global file |
| `--no-ignore-vcs` | `read_vcsignore = false` | `.git_ignore/.git_global/.git_exclude(false)` |
| `--no-require-git` | `require_git_to_read_vcsignore = false` | `.require_git(false)` |
| `--no-ignore-parent` | `read_parent_ignore = false` | `.parents(false)` |
| `--no-global-ignore-file` (hidden flag) | `read_global_ignore = false` | global file not added |
| `-u/--unrestricted` | same as `-I -H` (`rg_alias_ignore()`) | |
| `--ignore-file <path>` | `ignore_files` | `.add_ignore(path)` for each file |
| `-E/--exclude <glob>` | `exclude_patterns` (each prefixed with `!`) | `.overrides(...)` |
| `-L/--follow` | `follow_links` | `.follow_links(true)` |
| `--one-file-system` (`--mount`, `--xdev`) | `one_file_system` | `.same_file_system(true)` |
| `-d/--max-depth` | `max_depth` | `.max_depth(n)` |

Notes on the mapping:

- `.ignore(read_fdignore)` turns the crate's `.ignore` handling on or off. So `.ignore` and `.fdignore` are controlled together, and both are only disabled by `-I`/`-u`, never by `--no-ignore-vcs`.
- `.fdignore` is registered with `add_custom_ignore_filename(".fdignore")` only when `read_fdignore` is true.
- `.parents(...)` is enabled only if `read_parent_ignore` is true **and** at least one of fdignore or vcsignore reading is still enabled.

## Ignore sources and precedence

- **Global fd ignore file**: fd asks `etcetera::choose_base_strategy()` for the config directory (`~/.config` on Linux/macOS, `%APPDATA%` on Windows per the README) and adds `<config>/fd/ignore` if that file exists. A malformed pattern prints `Malformed pattern in global ignore file` and the search continues. Partial-parse errors are ignored silently.
- **`--ignore-file`**: added the same way, with the same error handling. The help text calls these "low precedence".
- **Per-directory files** are handled by the `ignore` crate's matcher stack. `.fdignore` can re-include something that `.gitignore` excludes with `!pattern`; see `test_custom_ignore_precedence`.
- **`--exclude` globs** become `ignore` overrides. Each glob is prefixed with `!`, which in override syntax means "ignore matching paths". Overrides take precedence over all other ignore logic, so excluded paths stay excluded even with `-u`. The override builder is rooted at the **first** search path. A bad glob fails with `Malformed exclude pattern`.

## fd-specific traversal controls

These are implemented in the `spawn_senders` closure rather than in `WalkBuilder`:

- **`--ignore-contain <name>`**: when a directory entry contains a child called `<name>` (checked with `Path::exists`), the closure returns `WalkState::Skip`. The directory and everything under it are hidden. This is meant for markers such as `CACHEDIR.TAG`. The check runs **before** the depth-0 root skip and before the min-depth check, so a search root that contains the marker yields no results at all (`test_ignore_contain_precedence_over_root_check`).
- **`--min-depth`**: entries shallower than the minimum are not reported, but traversal still descends into them. `--exact-depth N` sets both min and max depth to N (`Opts::min_depth/max_depth`).
- **`--prune`**: after a matching entry is sent, the closure returns `Skip`, so fd does not descend into matched directories. It conflicts with `--size` and `--exact-depth`.
- **Root entries**: depth-0 entries (the search paths themselves) are never printed.

## Symlinks

Without `--follow`, symlinks are reported as symlink entries and fd does not traverse into them. With `--follow`, the walker resolves them. A dangling link then produces a `NotFound` error, and fd turns that error back into a reportable broken-symlink `DirEntry` (see [Parallel Search Pipeline](../architecture/search-pipeline.md)). The integration tests cover a search root that is itself a symlink, and symlinks combined with `--absolute-path` / `--full-path`.

## Hidden-pattern safety net

If hidden files are excluded and a pattern can only match names that start with a literal dot (for example `^\.env`), fd exits with an error that suggests `-H`, instead of silently returning nothing. This check only runs on Unix. See [Pattern Matching](pattern-matching.md).

## Tests

`tests/tests.rs` has focused cases for each control: `test_hidden`, `test_no_ignore`, `test_gitignore_and_fdignore`, `test_no_ignore_parent`, `test_no_ignore_parent_inner_git`, `test_custom_ignore_precedence`, `test_respect_ignore_files` (no-require-git), `test_no_ignore_vcs`, `test_custom_ignore_files`, `test_global_ignore`, `test_no_global_ignore`, `test_follow`, `test_file_system_boundaries`, `test_follow_broken_symlink`, `test_max_depth`, `test_min_depth`, `test_exact_depth`, `test_prune`, `test_excludes`, `test_git_dir`, `test_gitignore_parent`, and the `test_ignore_contain*` family. The test harness creates a fake `.git` directory so that `.gitignore` rules apply (see [Testing Strategy](../testing/integration-tests.md)).
