---
type: testing
title: "Testing: Integration Harness and Unit Tests"
description: How fd is tested - the TestEnv fixture that runs the real binary in a temporary directory tree, its assertion helpers and output normalization, the shared fixture layout, where unit tests live, and how to run them.
tags: [testing, integration-tests, testenv, cargo-test]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# Testing: Integration Harness and Unit Tests

<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-packaging.md] link "/openwiki/operations/build-release-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
fd has two layers of tests, both run by plain `cargo test` (CI uses `--locked`; see [build and CI](/openwiki/operations/build-release-and-packaging.md)).

## Unit tests (in `src/`)

Small `#[cfg(test)]` modules or `#[test]` functions sit next to the code they cover: smart-case and leading-dot detection (`src/regex_helper.rs`), size/time/owner parsing (`src/filter/*`), placeholder parsing and generation (`src/fmt/*`, `src/exec/mod.rs` command templates), `merge_exitcodes` (`src/exit_codes.rs`), `search_str_for_entry` (`src/walk.rs`), dash-prefixed path detection (`src/dir_entry.rs`), `strip_current_dir` (`src/filesystem.rs`) and terminal sanitization (`src/sanitize.rs`). Time-filter tests replace `now()` with a thread-local fake clock (the `TestTime` helper) so relative durations are deterministic.

## Integration tests (`tests/tests.rs`, `tests/testenv/mod.rs`)

About a hundred `#[test]` functions treat fd as a black box: they build a temp directory, spawn the compiled binary, and compare stdout/stderr. The binary path comes from `CARGO_BIN_EXE_fd`, which Cargo sets for integration tests, so tests always exercise the freshly built executable.

### The `TestEnv` fixture

`TestEnv::new(dirs, files)` creates a `tempfile::TempDir` (prefix `fd-tests`) and populates:

<!-- openwiki: broken internal link [/openwiki/concepts/ignore-and-visibility-rules.md] link "/openwiki/concepts/ignore-and-visibility-rules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- a fake **`.git`** directory, so `.gitignore` files are honored without a real repository (fd requires a git repo for that by default; see [ignore rules](/openwiki/concepts/ignore-and-visibility-rules.md)),
- the requested directories and empty files,
- a `symlink` entry pointing at `one/two`,
- `.fdignore` containing `fdignored.foo` and `.gitignore` containing `gitignored.foo`.

Most tests share `DEFAULT_DIRS`/`DEFAULT_FILES` (`one/two/three/...`, `a.foo`, `one/two/C.Foo2`, `.hidden.foo`, `e1 e2`, ...), which makes expected outputs easy to compare across tests. Builder-style helpers adjust the fixture: `normalize_line(true)` sorts words within each output line (for `ls`-style output), `global_ignore_file(content)` writes `fd/ignore` into a temporary config dir used as `XDG_CONFIG_HOME`, and `create_broken_symlink` adds a dangling link.

### How commands are run

`run_command` spawns fd with its working directory set to a subpath of the temp dir, always sets `LS_COLORS=""` for stable color behavior, and, unless a global-ignore file was configured, injects `--no-global-ignore-file` so the developer's real `~/.config/fd/ignore` cannot influence results. Stdout is not a TTY under `Command::output`, so tests run in non-interactive mode by default (no sanitization, no auto-color).

### Assertions

| Helper | Checks |
| --- | --- |
| `assert_output(args, expected)` / `assert_output_subdirectory` | success exit status and equal output after normalization |
| `assert_output_raw` (Unix, non-macOS) | exact bytes, for non-UTF-8 names |
| `assert_failure(args)` | non-zero exit status |
| `assert_failure_with_error(args, msg)` / `assert_error` | non-success *and* stderr starts with the expected text (leading whitespace trimmed per line) |
| `assert_success_and_get_output` | raw `Output` for custom checks |

`normalize_output` replaces `\0` with a `NULL` line, trims leading whitespace, rewrites `/` to the platform separator, optionally sorts words, and finally **sorts lines**; this is why parallel and unordered output can still be compared deterministically. Failures print a line diff via the `diff` crate.

## Coverage map

Tests are named by feature, so search `tests/tests.rs` by prefix:

<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- patterns: `test_simple`, `test_and_*`, `test_regex_searches`, `test_glob_searches`, `test_smart_case`, `test_fixed_strings`, `test_exact_*`, `test_full_path*`, and the forward-slash rejection tests ([pattern matching](/openwiki/concepts/pattern-matching.md));
- visibility and traversal: `test_hidden`, `test_no_ignore*`, `test_custom_ignore*`, `test_global_ignore`, `test_follow*`, `test_max_depth`/`min_depth`/`exact_depth`, `test_prune`, `test_excludes`, `test_ignore_contain_*`, `test_file_system_boundaries`;
<!-- openwiki: broken internal link [/openwiki/concepts/entry-filters.md] link "/openwiki/concepts/entry-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- filters: `test_type*`, `test_extension`, `test_size`, `test_modified_*`, `test_owner_*` ([entry filters](/openwiki/concepts/entry-filters.md));
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- command execution: `test_exec*`, `test_exec_batch*`, `test_list_details`, `test_single_and_multithreaded_execution` ([command execution](/openwiki/workflows/command-execution.md));
- output and process behavior: `test_print0`, `test_absolute_path`, `test_strip_cwd_prefix`, `test_custom_path_separator`, `test_hyperlink`, `test_quiet`, `test_max_results`, `test_invalid_utf8`, `test_base_directory`, `test_invalid_cwd`, `test_opposing`, `test_number_parsing_errors`.

Platform-conditional tests use `#[cfg(unix)]`/`#[cfg(windows)]` (symlink creation needs privileges on Windows; owner tests are Unix-only) and `test_case` for parameterized cases.

## Running

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`cargo test` runs everything; `cargo test --bin fd` only the unit tests (CI uses this for arm-type targets where the integration binary can't run); `cargo test test_exec` filters by name. For a new feature, add an assertion in `tests/tests.rs` using the shared fixture first, then unit tests for parsing logic. Return to the [quickstart](/openwiki/quickstart.md) for the overall map.
