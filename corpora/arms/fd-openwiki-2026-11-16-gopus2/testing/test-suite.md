---
type: testing
title: Test Suite
description: How fd is tested - the TestEnv integration harness that runs the real fd binary in a temporary fixture directory with order-insensitive output comparison, the coverage areas of tests/tests.rs, in-module unit tests, and the commands CI uses.
tags: [testing, integration-tests, unit-tests, testenv, ci, cargo-test]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:28:22.809Z
sources:
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-16T16:28:22.809Z" }
---

# Test Suite

fd has two kinds of tests:

- **Integration tests** in `tests/tests.rs` (≈ 2,900 lines) that execute the compiled `fd` binary as a subprocess, using the harness in `tests/testenv/mod.rs`.
- **Unit tests** in `#[cfg(test)]` modules next to the code they test.

Run everything with `cargo test` (CI uses `cargo test --locked`, with `--all-features` on the MSRV job). Dev-dependencies: `tempfile`, `diff`, `filetime`, `test-case`.

## The `TestEnv` harness

`TestEnv::new(dirs, files)` builds a fixture in a fresh temp directory (prefix `fd-tests`):

- creates an empty `.git/` directory so `.gitignore` rules apply (the walker requires a git repo by default);
- creates the given directories and empty files;
- creates a `symlink` → `one/two` (Unix symlink; on Windows `symlink_dir`, which needs symlink privileges);
- writes `.fdignore` containing `fdignored.foo` and `.gitignore` containing `gitignored.foo`.

Most tests use the shared fixture `DEFAULT_DIRS` (`one/two/three`, `one/two/three/directory_foo`) and `DEFAULT_FILES` (`a.foo`, `one/b.foo`, `one/two/c.foo`, `one/two/C.Foo2`, `one/two/three/d.foo`, `fdignored.foo`, `gitignored.foo`, `.hidden.foo`, `e1 e2`) defined at the top of `tests/tests.rs`.

### Running fd

`run_command` launches the binary located via `CARGO_BIN_EXE_fd` with:

- the working directory set to the fixture (or a subdirectory);
- `LS_COLORS=""` for deterministic color output;
- `--no-global-ignore-file` appended **unless** a global ignore file was configured with `.global_ignore_file(content)`, in which case `XDG_CONFIG_HOME` points at a temp config dir containing `fd/ignore`. This keeps the developer's own `~/.config/fd/ignore` from affecting results.

Because the binary is spawned, stdout is never a terminal in tests: colors are off by default, sanitization is off, and `strip_cwd_prefix=auto` applies as for piped use.

### Assertions

| Helper | Purpose |
|--------|---------|
| `assert_output(args, expected)` | Run in fixture root, require success, compare normalized stdout |
| `assert_output_subdirectory(path, args, expected)` | Same, from a subdirectory |
| `assert_output_raw(args, bytes)` | Byte-exact stdout (Unix except macOS; for invalid UTF-8) |
| `assert_success_and_get_output` / `..._normalized_output` | Return output for custom checks |
| `assert_failure_with_error(args, msg)` | Require non-zero exit and stderr starting with `msg` |
| `assert_failure(args)` | Require non-zero exit |
| `assert_error(args, msg)` | Check stderr prefix, return exit status |

Normalization (`normalize_output`) makes comparisons independent of traversal order and platform: `\0` becomes `NULL\n`, `/` is replaced by the platform separator, lines are left-trimmed (expected side), **lines are sorted**, and with `.normalize_line(true)` the whitespace-separated words of each line are sorted too (for `--exec-batch` output). On mismatch the panic message includes a line diff.

Other helpers: `create_broken_symlink`, `test_root`, `system_root`, `test_exe`, and in `tests.rs` `get_absolute_root_path`, `create_file_with_size`, `create_file_with_modified`, `change_file_modified`, plus `test_case` parametrization (`test_no_global_ignore`, `test_opposing`).

## Coverage map of `tests/tests.rs`

| Area | Representative tests |
|------|----------------------|
| Patterns & matching | `test_simple`, `test_regex_searches`, `test_smart_case`, `test_case_*`, `test_glob_searches*`, `test_fixed_strings`, `test_exact_literal_nonsubstring`, `test_and_*`, `test_full_path*` |
| Validation errors | `test_pattern_with_forward_slash_*`, `test_error_if_hidden_not_set_and_pattern_starts_with_dot`, `test_number_parsing_errors`, `test_invalid_cwd` |
| Ignore rules | `test_hidden*`, `test_no_ignore*`, `test_gitignore_and_fdignore`, `test_custom_ignore_*`, `test_global_ignore`, `test_git_dir`, `test_gitignore_parent`, `test_excludes`, `test_ignore_contain*` |
| Traversal | `test_follow*`, `test_file_system_boundaries`, `test_max_depth`, `test_min_depth`, `test_exact_depth`, `test_prune`, `test_symlink_*`, `test_multi_file*`, `test_base_directory` |
| Filters | `test_type*`, `test_extension`, `test_no_extension`, `test_size`, `test_modified_*`, `test_owner_*` |
| Output | `format`, `test_print0`, `test_absolute_path*`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_hyperlink`, `test_invalid_utf8`, `test_max_results`, `test_quiet` |
| Commands | `test_exec*`, `test_exec_batch*`, `test_list_details`, `test_single_and_multithreaded_execution` |
| Flag overrides | `test_opposing` (each flag and its `--no-*` counterpart) |

Many tests are gated with `#[cfg(unix)]`/`#[cfg(windows)]` or early-return on Windows where path semantics differ.

## Unit tests

| Module | What is covered |
|--------|-----------------|
| `src/regex_helper.rs` | Uppercase detection and leading-dot detection from regex HIR |
| `src/walk.rs` | `search_str_for_entry` for file-name and full-path modes |
| `src/dir_entry.rs` | `starts_with_dash` |
| `src/filesystem.rs` | `strip_current_dir` |
| `src/exit_codes.rs` | `merge_exitcodes` |
| `src/exec/mod.rs` | Command template tokenization, batch rules, path separator generation |
| `src/fmt/mod.rs`, `src/fmt/input.rs` | Template parsing and `basename`/`dirname`/`remove_extension` |
| `src/filter/size.rs`, `time.rs`, `owner.rs` | Parser tables; time tests pin "now" through a thread-local |
| `src/sanitize.rs`, `src/hyperlink.rs` | Escape sequences and URL encoding |

## CI

From `.github/workflows/CICD.yml` (details in [Build, Release and Packaging](../operations/build-release-packaging.md)):

- `cargo fmt -- --check`
- `cargo clippy --all-targets --all-features -- -Dwarnings`
- MSRV: `cargo clippy --locked --all-targets --all-features` and `cargo test --locked --all-features`
- Per target: `cargo|cross test --locked --target=<t>`; arm/aarch64 targets run only `--bin=fd` (unit tests).

To reproduce CI locally before a PR, run fmt, clippy with `-Dwarnings` and `cargo test --locked`.

Related: [Filtering and Ignore Rules](../concepts/filtering-and-ignore-rules.md) for the behavior most tests exercise.
