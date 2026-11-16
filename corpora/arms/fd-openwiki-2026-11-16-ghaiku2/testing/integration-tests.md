---
type: "Reference"
title: "Testing Strategy: Unit and Integration Tests"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---


# Testing Strategy: Unit and Integration Tests

`fd` has two layers of tests. Small pure functions are covered by unit tests
next to the code. User-visible behavior is covered by black-box integration
tests that create a real directory tree, run the compiled `fd` binary, and
compare its stdout. Almost all behavior-level coverage lives in the second
layer.

## Unit tests

Unit tests are `#[cfg(test)] mod tests` blocks in the source, for example:

- `src/walk.rs` tests `search_str_for_entry`, which chooses the string a
  pattern is matched against (file name, or absolute path under `--full-path`).
- `src/regex_helper.rs` tests the uppercase-literal detector used for smart
  case and the leading-dot detector used for the hidden-file check.
- `src/filter/time.rs` injects a fixed "now" through a thread-local, so
  relative durations such as `--changed-within 1d` are deterministic.
- `src/filter/size.rs` and `src/filter/owner.rs` test parsing and matching of
  size and owner arguments.
- `src/exit_codes.rs` tests `merge_exitcodes`.


## Integration harness: `tests/testenv/mod.rs`

`TestEnv` is the fixture object used by every scenario. Its responsibilities:

- **Fixture tree.** `TestEnv::new(directories, files)` creates a temporary
  directory with the prefix `fd-tests`. It creates the requested directories
  and empty files, plus a `.git` directory so that `.gitignore` files are
  honored as in a repository, a `.fdignore` file ignoring `fdignored.foo`, and
  a `.gitignore` file ignoring `gitignored.foo`. On Unix it also creates a
  symlink named `symlink` pointing at `one/two`; on Windows it creates a
  directory symlink and notes that privilege may be required.
- **Binary location.** `find_fd_exe` reads `CARGO_BIN_EXE_fd` at compile time
  (`env!`), so the tests always run the binary that Cargo just built.
- **Isolation.** `run_command` runs `fd` with the fixture directory as the
  current directory and always passes `--no-global-ignore-file`, unless a test
  supplies a config directory through `global_ignore_file`. In that case
  `XDG_CONFIG_HOME` points at it. `LS_COLORS` is cleared so colored output
  is deterministic.
- **Assertions.** `assert_output` and `assert_output_raw` compare stdout
  against an expected string after normalization. `normalize_output` sorts
  lines or words depending on `normalize_line` and trims leading whitespace
  when requested, so tests can ignore the non-deterministic order of parallel
  output. `assert_failure` and `assert_error` check exit status and stderr.
  `assert_output_subdirectory` runs from a subdirectory of the fixture.
- **Test-only symlinks and special entries.** `create_broken_symlink` creates
  dangling links for the broken-symlink scenarios.

Failure helpers (`format_exit_error`, `format_output_error`) print the full
command line, expected output and actual output, which makes CI logs useful
without rerunning.

## Scenario suite: `tests/tests.rs`

`tests/tests.rs` contains about 100 `#[test]` functions and about a dozen
parameterized `#[test_case]` cases. Names are grouped by feature. Examples
(not exhaustive):

| Area | Representative tests |
| --- | --- |
| Pattern modes | `test_regex_searches`, `test_glob_searches`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, `test_regex_overrides_glob` |
| Case handling | `test_smart_case`, `test_case_sensitive`, `test_case_insensitive`, `test_smart_case_glob_searches` |
| `--and` and paths | `test_and_basic`, `test_and_plus_full_path`, `test_pattern_with_forward_slash_is_rejected`, `test_and_pattern_starts_with_dash` |
| Ignore rules | `test_hidden`, `test_no_ignore`, `test_gitignore_and_fdignore`, `test_no_ignore_parent`, `test_custom_ignore_precedence`, `test_no_ignore_vcs_child_dir`, `test_global_ignore`, `test_no_ignore_aliases` |
| Traversal | `test_follow`, `test_file_system_boundaries`, `test_max_depth`, `test_min_depth`, `test_prune`, `test_follow_broken_symlink` |
| Entry types and metadata | `test_type`, `test_type_executable`, `test_type_empty`, `test_extension`, `test_size`, `test_modified_relative`, `test_owner_current_user`, `test_owner_root` |
| Execution | `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`, `test_exec_batch_with_limit`, `test_exec_invalid_utf8`, `test_single_and_multithreaded_execution` |
| Output | `test_print0`, `test_absolute_path`, `test_list_details`, `test_hyperlink`, `test_custom_path_separator`, `test_strip_cwd_prefix` |
| Control | `test_quiet`, `test_max_results`, `test_base_directory`, `test_ignore_contain`, `test_ignore_contain_precedence_over_depth_check` |

Platform gating uses `#[cfg(...)]` attributes. Examples: `test_owner_root` is
Linux-only, `test_hidden_file_attribute` runs only on Windows, and the
forward-slash `--full-path` scenario is excluded on Windows.

Output order matters for these tests. The parallel walker's output is
deterministic only for searches that finish inside the buffering window (see
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Parallel Traversal](/openwiki/architecture/parallel-traversal.md)). Most
scenarios compare output exactly. Where order is not guaranteed, a test can
call `normalize_line(true)`, which is used by one current test, or assert on
a set of lines instead.

## Running tests

- Full suite: `cargo test` (the README's Development section documents the
  same). CI runs `cargo test --locked` with all features on the MSRV toolchain
  and on every release target, except that ARM and AArch64 cross targets run
  only the binary's unit tests. See
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Build, Release, CI and Packaging](/openwiki/operations/build-release-and-ci.md).
- One integration scenario: pass the test name as a filter, for example
  `cargo test --test tests test_no_ignore_parent`.
- One module's unit tests: `cargo test walk::tests` or a similar path filter.
- Linting and formatting are separate CI gates (`cargo fmt -- --check` and
  clippy with warnings denied), so run them before pushing.

## Adding a test

1. Pick the closest existing scenario in `tests/tests.rs` and copy its shape:
   build a `TestEnv` with the directories and files needed, run `assert_output`
   or `assert_failure`, and keep the expected output as a plain string.
2. If the behavior depends on ignore files, add the files through the fixture
   or `global_ignore_file` rather than relying on the host configuration.
3. If the behavior depends on ordering or threads, normalize the output or
   force a single thread with `--threads 1`.
4. For a pure function, prefer a unit test next to the function.

## Related pages

<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Release, CI and Packaging](/openwiki/operations/build-release-and-ci.md)
