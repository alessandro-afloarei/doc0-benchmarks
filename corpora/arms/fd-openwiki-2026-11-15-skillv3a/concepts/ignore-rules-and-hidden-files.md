---
type: concept
title: Ignore Rules and Hidden Files
description: How fd decides which entries are skipped before matching — hidden files, .gitignore/.ignore/.fdignore, the global fd ignore file, --ignore-file, --exclude overrides, the --no-ignore family, -u, --no-require-git, parent ignores and --ignore-contain — and how each maps onto the ignore crate's WalkBuilder.
tags: [ignore, gitignore, fdignore, hidden, exclude]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Ignore Rules and Hidden Files

fd's default "smart" filtering — skipping hidden entries and anything matched by ignore files — is not implemented by fd itself. fd translates its options into `Config` booleans in `construct_config` (`src/main.rs`) and then into settings on `ignore::WalkBuilder` in `WorkerState::build_walker` (`src/walk.rs`). Entries removed this way never reach fd's own pattern or [entry filters](entry-filters.md), and ignored directories are not descended into at all.

## Defaults

By default fd:

- skips hidden files and directories (names starting with `.`; on Windows, also entries with the hidden file attribute, as handled by the `ignore` crate);
- honors `.gitignore`, `.git/info/exclude` and the global git excludes file — but only inside a git repository;
- honors `.ignore` and `.fdignore` files;
- honors ignore files in parent directories of the search root;
- honors fd's global ignore file (`<config dir>/fd/ignore`, typically `~/.config/fd/ignore` on Linux/macOS and `%APPDATA%\fd\ignore` on Windows).

## Option → Config → WalkBuilder mapping

| Config field | Computed from (`construct_config`) | WalkBuilder call |
|--------------|-------------------------------------|------------------|
| `ignore_hidden` | `!(--hidden \|\| -u)` | `.hidden(ignore_hidden)` |
| `read_fdignore` | `!(--no-ignore \|\| -u)` | `.ignore(..)` (controls `.ignore` files) and `add_custom_ignore_filename(".fdignore")` |
| `read_vcsignore` | `!(--no-ignore \|\| -u \|\| --no-ignore-vcs)` | `.git_ignore(..)`, `.git_global(..)`, `.git_exclude(..)` |
| `require_git_to_read_vcsignore` | `!--no-require-git` | `.require_git(..)` |
| `read_parent_ignore` | `!--no-ignore-parent` | `.parents(read_parent_ignore && (read_fdignore \|\| read_vcsignore))` |
| `read_global_ignore` | `!(--no-ignore \|\| -u \|\| --no-global-ignore-file)` | `add_ignore(<config>/fd/ignore)` if the file exists |
| `ignore_files` | `--ignore-file <path>` (repeatable) | `add_ignore(path)` for each |
| `exclude_patterns` | `--exclude <glob>` prefixed with `!` | `.overrides(OverrideBuilder ...)` |

Notes:

- **`-u` / `--unrestricted`** is a counted flag; any count is equivalent to `--no-ignore --hidden` (the classic `-uu` still works). It overrides earlier `--ignore` / `--no-hidden`.
- **`--no-ignore`/`-I`** disables `.gitignore`, `.ignore`, `.fdignore` *and* the global fd ignore file, but not hidden-file filtering. `--no-ignore-vcs` disables only the git-related sources.
- **Precedence:** `.fdignore` is registered as a custom ignore filename, which the `ignore` crate ranks above `.gitignore`, so a `!foo` whitelist in `.fdignore` can re-include a file ignored by `.gitignore` (`test_custom_ignore_precedence`).
- **Parent ignores** are only enabled if at least one category of ignore files is still active.
- **Global ignore file location** comes from `etcetera::choose_base_strategy().config_dir()`. Malformed patterns there (or in `--ignore-file` files) print an error such as "Malformed pattern in global ignore file", but partial errors are tolerated and the search continues.
- **`--ignore-file`** files have low precedence (per the CLI help) and are always read, even with `--no-ignore`.
- **`--no-global-ignore-file`** is a hidden flag.

Each negating flag has a hidden opposite (`--ignore`, `--ignore-vcs`, `--require-git`, `--ignore-parent`, `--no-hidden`), so aliases can be undone per invocation — see [CLI Parsing and Configuration](../architecture/cli-and-configuration.md).

## `--exclude` overrides

`--exclude`/`-E` globs are turned into `ignore` *overrides*. Because the override builder treats plain globs as whitelists, fd prefixes each with `!`, turning them into ignore rules. Overrides take precedence over every other ignore source, so `--exclude` works even with `--no-ignore` or `-u`. The override builder is rooted at the first search path. A malformed glob fails with "Malformed exclude pattern".

## `--ignore-contain`

`--ignore-contain <name>` is handled by fd itself rather than the `ignore` crate: in the walker callback, any directory that contains an entry called `<name>` (for example `CACHEDIR.TAG`) returns `WalkState::Skip`, so neither it nor its contents are reported. This check happens before the depth checks.

## Hidden-pattern warning

Since hidden entries are skipped by default, a pattern that can only match dot-files would silently return nothing. On Unix, `ensure_use_hidden_option_for_leading_dot_pattern` (`src/main.rs`) inspects the regex AST (via `regex_helper::pattern_matches_strings_with_leading_dot`) and aborts with a hint to add `-H/--hidden` when hidden files are being ignored. See [Pattern Matching](pattern-matching.md).

## Following symlinks and file systems

Two related walker options are set in the same place:

- `--follow`/`-L` → `.follow_links(true)` (descend into symlinked directories).
- `--one-file-system` (aliases `--mount`, `--xdev`; Unix and Windows only) → `.same_file_system(true)`.

## Tests

`tests/tests.rs` contains many cases for `.gitignore`, `.fdignore`, `.ignore`, global ignore files, `--no-ignore*`, `--no-require-git`, `-u`, `--exclude` and `--ignore-contain`, built with the temporary directory harness described in [Testing](../testing/integration-tests.md).
