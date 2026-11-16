---
type: concept
title: Ignore Rules and Hidden Files
description: How fd decides which directories and files the walker visits at all — hidden-entry skipping, .gitignore/.ignore/.fdignore, the global fd ignore file, custom ignore files, parent-directory and git-repository requirements, --exclude overrides, -u/--unrestricted, and --ignore-contain.
tags: [ignore, gitignore, hidden-files, traversal, exclude]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Ignore Rules and Hidden Files

By default fd skips hidden entries and anything ignored by VCS or fd ignore files.
fd does not implement ignore matching itself: it translates CLI flags into
`Config` booleans (`src/main.rs` `construct_config`) and passes them to
`ignore::WalkBuilder` in `WorkerState::build_walker` (`src/walk.rs`). Ignored
directories are therefore never descended into, which is a large part of fd's
speed.

## Flag → Config → walker mapping

| Config field | Disabled by | WalkBuilder effect |
| --- | --- | --- |
| `ignore_hidden` | `-H/--hidden`, `-u` | `.hidden(...)`: skip names starting with `.` |
| `read_fdignore` | `-I/--no-ignore`, `-u` | `.ignore(...)` for `.ignore` files, plus `.fdignore` registered as a custom ignore filename |
| `read_vcsignore` | `-I`, `-u`, `--no-ignore-vcs` | `.git_ignore`, `.git_global`, `.git_exclude` |
| `require_git_to_read_vcsignore` | `--no-require-git` | `.require_git(...)`: git rules apply only inside a git repository |
| `read_parent_ignore` | `--no-ignore-parent` | `.parents(...)`, only if fd or VCS ignores are enabled at all |
| `read_global_ignore` | `-I`, `-u`, `--no-global-ignore-file` (hidden) | adds `<config dir>/fd/ignore` |

Each negative flag has a hidden positive counterpart (`--no-hidden`, `--ignore`,
`--ignore-vcs`, `--require-git`, `--ignore-parent`) declared with
`overrides_with`, so the last flag on the command line wins — useful for
overriding shell aliases. `-u/--unrestricted` is a counted flag (accepting
`-uu` for ripgrep familiarity); any count is equivalent to `--no-ignore --hidden`.

## Ignore sources

- **`.gitignore`, `.git/info/exclude`, global git excludes** — honored when
  `read_vcsignore` is true and (by default) only when the search is inside a git
  repository.
- **`.ignore` and `.fdignore`** — tool-agnostic and fd-specific ignore files in
  gitignore syntax, independent of git. In the `ignore` crate, custom ignore
  filenames such as `.fdignore` take precedence over `.ignore` and `.gitignore`,
  so a `!pattern` in `.fdignore` can re-include something `.gitignore` excludes
  (covered by `test_custom_ignore_precedence`).
- **Global fd ignore file** — `etcetera::choose_base_strategy().config_dir()`
  joined with `fd/ignore` (typically `~/.config/fd/ignore` on Linux and macOS,
  `%APPDATA%\fd\ignore` on Windows). Added only if the file exists.
- **`--ignore-file <path>`** — extra gitignore-format files with low precedence.

Malformed patterns in the global or custom ignore files print an error but do not
abort the search; partial errors are silently accepted.

## `--exclude` overrides

Each `-E/--exclude <glob>` becomes an `!glob` override in an
`ignore::overrides::OverrideBuilder` rooted at the *first* search path. Overrides
take priority over every ignore file and also over `--no-ignore`/`-u`, so an
excluded path stays excluded. A malformed glob fails the run with
"Malformed exclude pattern".

## `--ignore-contain <name>`

This check lives in fd's sender closure rather than in the walker: when an entry
is a directory and `dir/<name>` exists for any configured name, the closure
returns `WalkState::Skip`, so neither the directory nor its contents are
reported. It runs before the root-entry and `--min-depth` checks, so it also
applies to the search root itself (e.g. `--ignore-contain=CACHEDIR.TAG` on a root
that contains `CACHEDIR.TAG` yields nothing). Typical use: skip build caches marked
with `CACHEDIR.TAG`.

## Hidden files and patterns

On Unix, hidden means "name starts with `.`". The `ignore` crate's hidden check
also covers Windows hidden attributes (see `test_hidden_file_attribute`). If
hidden entries are skipped and the pattern can only match dot-files (e.g.
`'^\.env'`), fd stops with an error suggesting `-H` rather than silently printing
nothing; see [Search Pipeline](../architecture/search-pipeline.md).

## Interaction with other features

- `--prune`, depth limits, and type filters operate only on entries that survive
  ignore rules ([Entry Filters](entry-filters.md)).
- Symlink following (`-L`) and `--one-file-system` are also walker options set in
  the same builder ([Parallel Walk](../architecture/parallel-walk-and-receiver.md)).

## Tests

The integration `TestEnv` creates a fake `.git` directory in every temp root so
that `.gitignore` is honored, writes `.gitignore` (`gitignored.foo`) and
`.fdignore` (`fdignored.foo`), and can provide a temporary global ignore config
directory. Relevant tests in `tests/tests.rs`: `test_no_ignore`,
`test_gitignore_and_fdignore`, `test_no_ignore_parent`,
`test_no_ignore_parent_inner_git`, `test_custom_ignore_precedence`,
`test_respect_ignore_files`, `test_no_ignore_vcs*`, `test_custom_ignore_files`,
`test_no_ignore_aliases`, `test_global_ignore`, `test_no_global_ignore`,
`test_excludes`, `test_gitignore_parent`, and `test_ignore_contain*`. See
[Test Suite](../testing/test-suite.md).
