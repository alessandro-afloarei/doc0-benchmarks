---
type: operations
title: Testing Strategy
description: How fd is tested - black-box integration tests driven by the TestEnv harness against a temporary fixture tree, plus in-module unit tests - including fixture layout, output normalization, how to run them, and what each area covers.
tags: [testing, integration-tests, testenv, cargo-test, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:38:21.850Z
sources:
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-3a6ff89030cacfe8ee730edf
    resource: repo://src/sanitize.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T17:38:21.850Z" }
---

# Testing Strategy

fd has two complementary layers: **unit tests** colocated with the code, and **black-box integration tests** that run the real `fd` binary against a temporary directory tree.

## Running tests

- `cargo test` runs both layers. CI uses `cargo test --locked` (see [[operations/build-release]]); the MSRV job additionally passes `--all-features`.
- A single test: `cargo test test_smart_case`. Unit tests only: `cargo test --bin fd`. For arm/aarch64 cross targets CI runs only `--bin=fd`.
- Dev-dependencies: `tempfile` (fixtures), `diff` (readable failure diffs), `filetime` (set modification times), `test-case` (parameterized tests).

## Unit tests

In-module `#[cfg(test)]` blocks cover self-contained logic: exit code merging (`exit_codes.rs`), terminal sanitization (`sanitize.rs`), the `-`-prefix guard (`dir_entry.rs`), size/time/owner parsing (`filter/`), placeholder parsing and path helpers (`fmt/`, `exec/mod.rs`), hyperlink percent-encoding (`hyperlink.rs`), `strip_current_dir` (`filesystem.rs`), regex-HIR helpers (`regex_helper.rs`) and `search_str_for_entry` (`walk.rs`). `time.rs` replaces `now()` with a thread-local override under `cfg(test)` so relative durations are deterministic.

## Integration harness (`tests/testenv/mod.rs`)

`TestEnv::new(dirs, files)` builds a throwaway tree with `tempfile`:

- creates the given directories and empty files;
- creates an empty `.git` directory so `.gitignore` is honoured (see [[concepts/ignore-rules-and-hidden-files]]);
- adds a `symlink` pointing to `one/two`, plus `.fdignore` (containing `fdignored.foo`) and `.gitignore` (`gitignored.foo`).

The `fd` binary path comes from `CARGO_BIN_EXE_fd`. `run_command` runs it with the temp dir (or a subdirectory) as working directory, sets `LS_COLORS=""` for stable colors, and adds `--no-global-ignore-file` unless the test installed a global ignore file through `global_ignore_file(...)`, which points `XDG_CONFIG_HOME` at a temporary config dir. This isolates tests from the developer's real configuration.

Assertion helpers: `assert_output` / `assert_output_subdirectory` (compare normalized stdout), `assert_output_raw` (byte-exact, for non-UTF-8 names; Unix non-macOS), `assert_failure`, `assert_failure_with_error`, `assert_error`, and `create_broken_symlink`. `normalize_output` converts `/` to the platform separator, replaces NUL with `NULL\n`, and **sorts lines**, so tests are insensitive to the nondeterministic order of unsorted/streamed output (see [[architecture/parallel-walk-pipeline]]). `normalize_line(true)` additionally sorts words within each line, useful for `--exec-batch` argument order. Mismatches print a line diff.

## What `tests/tests.rs` covers

The ~100 tests are grouped around fd's features. The default fixture (`DEFAULT_DIRS`, `DEFAULT_FILES`) contains `a.foo`, nested `one/two/three` directories, `C.Foo2`, hidden, ignored and whitespace-named files.

- **Pattern semantics**: `test_simple`, `test_regex_searches`, `test_smart_case`, `test_case_sensitive`, glob tests, `test_full_path*`, `test_and_*`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, and rejection of path-like patterns (see [[architecture/pattern-matching]]).
- **Traversal and ignore rules**: `test_hidden`, `test_no_ignore*`, `test_gitignore_and_fdignore`, `test_custom_ignore_*`, `test_global_ignore`, `test_follow*`, `test_file_system_boundaries`, `test_max_depth`/`min_depth`/`exact_depth`, `test_prune`, `test_excludes`, `test_ignore_contain*`.
- **Filters**: `test_type*`, `test_extension`, `test_size`, `test_modified_*`, `test_owner_*` (see [[concepts/entry-filters]]).
- **Output**: `test_print0`, `test_absolute_path`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_hyperlink`, `test_invalid_utf8`.
- **Execution**: `test_exec*`, `test_exec_batch*`, `test_list_details`, `test_single_and_multithreaded_execution`, `test_exec_invalid_utf8` (see [[architecture/command-execution]]).
- **Control and errors**: `test_quiet`, `test_max_results`, `test_base_directory`, `test_invalid_cwd`, `test_number_parsing_errors`, `test_opposing` (flag override pairs), `test_error_if_hidden_not_set_and_pattern_starts_with_dot`.

Platform-specific tests are gated with `#[cfg(unix)]`/`#[cfg(windows)]` (for example owner tests and `test_hidden_file_attribute`).

## Adding a test

Choose or build a fixture with `TestEnv::new`, write any extra files under `te.test_root()`, and assert with `assert_output(&["args"], "expected\nlines")`. Prefer adding unit tests when the logic is a pure function (parsers, sanitizers), and integration tests for flag interactions.
