---
type: concept
title: Ignore Files, Hidden Files and Traversal Limits
description: How fd's visibility flags (hidden, .fdignore, .gitignore, global ignore, --ignore-file, --exclude, --ignore-contain) and traversal limits (depth, prune, follow, one-file-system) map onto the ignore crate's WalkBuilder.
tags: [ignore, gitignore, fdignore, hidden, traversal, walker]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Ignore Files, Hidden Files and Traversal Limits

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
fd does not implement ignore-file semantics itself: `WorkerState::build_walker` in `src/walk.rs` translates `Config` booleans into `ignore::WalkBuilder` settings, and the `ignore` crate (the engine behind ripgrep) does the matching. Understanding the mapping explains why flags interact the way they do. The flags themselves are lowered in [config construction](/openwiki/architecture/cli-and-configuration.md).

## Flag → Config → WalkBuilder mapping

| CLI | `Config` field | Walker effect |
| --- | --- | --- |
| *(default)* / `-H` | `ignore_hidden` | `.hidden(ignore_hidden)`: dot-files skipped unless `--hidden` |
| `-I`/`--no-ignore` | `read_fdignore`, `read_vcsignore`, `read_global_ignore` = false | disables `.ignore`/`.fdignore`, git rules and the global file |
| `--no-ignore-vcs` | `read_vcsignore` = false | `.git_ignore`, `.git_global`, `.git_exclude` all off |
| `--no-require-git` | `require_git_to_read_vcsignore` = false | `.require_git(false)`: `.gitignore` is honored even outside a git repository |
| `--no-ignore-parent` | `read_parent_ignore` = false | `.parents(...)` off |
| `--no-global-ignore-file` | `read_global_ignore` = false | the user-level `fd/ignore` file is not added |
| `-u` | both hidden *and* ignore relaxed | treated as `--hidden --no-ignore` via `rg_alias_ignore()` |

Notable details:

- **`.fdignore`** is registered as a *custom ignore filename* (`add_custom_ignore_filename(".fdignore")`) only when `read_fdignore` is true; it has the same syntax as `.gitignore` and takes precedence over it in the `ignore` crate's ordering. `--no-ignore-vcs` leaves `.fdignore` active, while `--no-ignore` disables it.
- **Parent ignore files** are honored only if fdignore *or* VCS ignores are enabled: `parents(read_parent_ignore && (read_fdignore || read_vcsignore))`.
<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`require_git`** defaults to true (`!opts.no_require_git`), mirroring git: by default a `.gitignore` outside a repository has no effect. The test environment fakes a repo by creating an empty `.git` directory (see [harness](/openwiki/testing/integration-test-harness.md)).
- **Global ignore file**: resolved with `etcetera::choose_base_strategy()` as `<config_dir>/fd/ignore`; added if the file exists. Partial parse errors (`ignore::Error::Partial`) are silently tolerated; other errors print `Malformed pattern in global ignore file`.
- **`--ignore-file <path>`** (repeatable) uses `builder.add_ignore`, with the same error tolerance and message `Malformed pattern in custom ignore file`.
- **`--exclude <glob>`** is stored with a `!` prefix and compiled into an `ignore::overrides::Override` rooted at the *first* search path. Overrides outrank ignore files, which is why `--exclude` is applied even under `--no-ignore`. A malformed glob raises `Malformed exclude pattern`.
- **`--ignore-contain <name>`** is not part of the `ignore` crate: the sender callback checks directories for the named child and returns `WalkState::Skip`, so the whole subtree (and the directory entry itself) disappears from results. Tests cover its precedence over depth and root checks (`test_ignore_contain_*`).

## Traversal limits

- **Depth**: `--max-depth` maps to `WalkBuilder::max_depth` (inclusive of the root at 0). `--min-depth` is applied *after* traversal, in the callback, so shallow directories are still walked. `--exact-depth` sets both. Because the root entry (depth 0) is always skipped, results begin at depth 1.
- **`--prune`**: after a matched entry is sent, returns `WalkState::Skip`, so matched directories are not descended into.
- **Symlinks**: `--follow` maps to `follow_links`. Without it, symlinks appear as entries but aren't traversed. With it, broken links are still reported via `DirEntry::broken_symlink`.
- **`--one-file-system`** (aliases `--mount`, `--xdev`; Unix and Windows): `same_file_system(true)`.
- **Multiple roots**: the first path seeds `WalkBuilder::new`, others are added with `builder.add`. Overrides are rooted at the first path only.
- **Threads**: `builder.threads(config.threads)`; builds a `WalkParallel`.

## Hidden-file guard

<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Because hidden files are filtered by default, a pattern such as `^\.git` can never match. On Unix, `ensure_use_hidden_option_for_leading_dot_pattern` (using `regex_helper::pattern_matches_strings_with_leading_dot`) turns this silent empty result into an error advising `--hidden`. Detection is intentionally narrow: only a start anchor followed by a literal beginning with `.` (see [pattern matching](/openwiki/concepts/pattern-matching.md)).

## Where things are tested

<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`test_hidden`, `test_no_ignore`, `test_gitignore_and_fdignore`, `test_no_ignore_parent*`, `test_custom_ignore_*`, `test_global_ignore`, `test_no_global_ignore`, `test_excludes`, `test_follow*`, `test_file_system_boundaries`, `test_prune`, `test_max_depth`/`test_min_depth`/`test_exact_depth` and `test_git_dir` in `tests/tests.rs`. Related runtime behavior is described in [parallel walk](/openwiki/architecture/parallel-walk-and-receiver.md).
