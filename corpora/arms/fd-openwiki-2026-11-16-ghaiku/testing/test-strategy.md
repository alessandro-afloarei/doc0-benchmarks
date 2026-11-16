---
type: testing
title: Testing Strategy
description: How fd is tested, covering the black-box integration suite that runs the built binary against temporary directory trees, the unit tests colocated with individual modules, the test groups that cover ignore rules, symlinks, exec, size, and owner behavior, and the commands a contributor runs before submitting a change.
tags: [testing, integration-tests, unit-tests, fixtures, ci, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-7df4594ee7cc47b29a31112b
    resource: repo://src/exit_codes.rs
  - id: openwiki-source-3e3f290cbcdeceaf20313401
    resource: repo://src/regex_helper.rs
  - id: openwiki-source-79eae85c594ec34f3869e2b5
    resource: repo://src/walk.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Testing Strategy

`fd` is tested in two complementary ways. Most behavior is checked by an integration suite in
`tests/tests.rs` that runs the compiled `fd` binary against a temporary directory tree.
Smaller pure functions, such as regex analysis, size parsing, and exit-code merging, have unit
tests next to the code they cover. CI runs both on every target. This page explains the
harness, the groups of tests, and the local checks. The CI matrix itself is described in
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Build, Release, and CI](/openwiki/operations/build-release-and-ci.md).

## Integration harness

`tests/testenv/mod.rs` provides `TestEnv`, which does the following for each test:

- Creates a temporary directory, prefixed `fd-tests`, and populates it with the directories
  and files given to `TestEnv::new`. It also creates an empty `.git` directory, so that
  `.gitignore` files are honored without a real repository.
- Writes a `.fdignore` and a `.gitignore` that exclude `fdignored.foo` and `gitignored.foo`,
  and on Unix creates a symbolic link `symlink` pointing at `one/two`. On Windows it creates a
  directory symlink instead.
- Runs the binary found by `find_fd_exe` with the working directory set inside the temporary
  tree. It unsets `LS_COLORS` so that output is uncolored. Unless `global_ignore_file` was set,
  the run also passes `--no-global-ignore-file`, so the developer's own config cannot leak into
  the results.
- Compares output after normalization. Lines are trimmed when requested, `/` is converted to the
  native separator, NUL characters become line breaks, and with `normalize_line` the words in each
  line are sorted. The last option is used where traversal order is not deterministic.

Assertion helpers cover the common cases: `assert_output` for exact stdout,
`assert_output_raw` for byte-exact output, `assert_success_and_get_output` for further checks,
`assert_failure` and `assert_failure_with_error` for error exits, `assert_output_subdirectory`
for running from a subdirectory, and `create_broken_symlink` for symlink edge cases.

## Test groups

`tests/tests.rs` contains about one hundred `#[test]` functions and parameterized `test_case`
cases. They fall into these groups, which are useful entry points when a related area changes:

- **Basic matching.** `test_simple`, `test_empty_pattern`, `test_multi_file`, and the smart case,
  case-sensitive, glob, and full-path tests (`test_smart_case`, `test_glob_searches`,
  `test_full_path`).
- **`--and` conjunctions.** `test_and_basic`, `test_and_plus_glob`,
  `test_and_plus_fixed_strings`, and the path-separator rejection tests.
- **Ignore rules.** `test_gitignore_and_fdignore`, `test_no_ignore_parent`,
  `test_custom_ignore_files`, `test_no_ignore_vcs`, `test_global_ignore`, and the alias tests for
  `-u` and `--no-ignore`.
- **Symlinks.** `test_follow_broken_symlink`, `test_symlink_as_root`, and the absolute-path and
  full-path variants.
- **Pruning and depth.** `test_prune`, `test_exact_depth`.
- **Types and metadata.** `test_type_executable`, `test_size`, and owner tests guarded for Unix.
- **Execution.** `test_exec`, `test_exec_multi`, `test_exec_nulls`, `test_exec_batch`,
  `test_exec_batch_with_limit`, and `test_exec_with_separator`.

Some areas have their own behavior tests that stay close to the feature. The full list is in the
source file, and `grep -n "fn test_" tests/tests.rs` is the quickest way to find a case.

## Unit tests

Pure logic is tested in place with `#[cfg(test)]` modules:

- `src/regex_helper.rs`: uppercase detection and leading-dot detection, which drive smart case
  and the hidden-file diagnostic.
- `src/walk.rs`: `search_str_for_entry`, which chooses between file name and full path.
- `src/exit_codes.rs`: `merge_exitcodes` for every combination of codes.
- `src/sanitize.rs`: escaping of control and bidi characters.
- `src/filter/size.rs` and `src/filter/time.rs`: size and time parsing and boundaries.
- `src/filesystem.rs`: `strip_current_dir`, and `src/exec/mod.rs` for placeholder expansion.

The binary target runs unit tests too, so `cargo test` covers both.

## Local checks before submitting

`CONTRIBUTING.md` asks contributors to make sure the code compiles and the tests pass, and to add
a changelog entry for behavior changes. For the repository's own checks:

```bash
cargo test                       # unit and integration tests
cargo fmt -- --check             # formatting, enforced in CI
cargo clippy --all-targets --all-features -- -Dwarnings   # lints, warnings are errors
```

Run the narrowest test first when debugging, for example `cargo test test_prune`. Filter names
match substrings, so one command can run a whole group. Keep the full failing output when
reporting a problem, because the harness prints the command, expected output, and actual
output for each mismatch.

## Writing a new test

- Put the new case in `tests/tests.rs` next to the group it belongs to, and build the directory
  tree with `TestEnv::new` rather than the real file system.
- Use `normalize_line` when the output order is not guaranteed, for example with parallel
  traversal and multiple results.
- Remember that the harness sets `--no-global-ignore-file` by default. A test of the global ignore
  file must use `global_ignore_file`.
- Gate platform-specific cases with `#[cfg(unix)]` or `#[cfg(windows)]`, and mirror the
  behavior on the other platform where it matters. See
<!-- openwiki: broken internal link [/openwiki/concepts/platform-support.md] link "/openwiki/concepts/platform-support.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Platform-Specific Behavior](/openwiki/concepts/platform-support.md).

## Related pages

<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Build, Release, and CI](/openwiki/operations/build-release-and-ci.md)
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Filtering Entries](/openwiki/workflows/filtering-entries.md)
<!-- openwiki: broken internal link [/openwiki/quickstart.md] link "/openwiki/quickstart.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Quickstart](/openwiki/quickstart.md)
