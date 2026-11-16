---
type: testing
title: Testing
description: How fd is tested — black-box integration tests in tests/tests.rs that run the compiled fd binary against temporary directory trees via the TestEnv harness, order-insensitive output normalization, error assertions, inline unit tests in src modules, and how tests run locally and in CI.
tags: [testing, integration-tests, testenv, unit-tests, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:39:25.366Z
sources:
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
  - id: openwiki-source-e20aea47dc1e0ebbc48f5096
    resource: repo://tests/tests.rs
generated: { by: "claude-code", at: "2026-11-15T17:39:25.366Z" }
---

# Testing

fd has two layers of tests:

1. **Integration tests** (`tests/tests.rs`, ~2.9k lines, 100+ tests) that execute the real `fd` binary as a subprocess against a freshly created temporary directory tree.
2. **Unit tests** in `#[cfg(test)]` modules next to the code they test in `src/`.

Run everything with `cargo test`. CI additionally runs the suite on the MSRV toolchain with `--all-features` and on every release target (ARM targets only run `--bin=fd` tests) — see [Build, Release, and Packaging](../operations/build-release-and-packaging.md).

## The `TestEnv` harness (`tests/testenv/mod.rs`)

`TestEnv::new(dirs, files)` builds a sandbox:

- creates a temp directory prefixed `fd-tests`;
- creates an empty `.git` directory so that `.gitignore` rules are honored (fd only reads VCS ignores inside a git repo by default);
- creates the requested directories and empty files;
- creates a `symlink` → `one/two` (Unix symlink, or a directory symlink on Windows, which requires the symlink privilege);
- writes a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`.

The `fd` executable is located via `CARGO_BIN_EXE_fd` (set by Cargo for integration tests, overridable at runtime through the environment variable of the same name).

Each invocation (`run_command`):

- runs in `<temp>/<subdir>` as the working directory;
- passes `--no-global-ignore-file` unless the test configured one with `.global_ignore_file(content)`, in which case `XDG_CONFIG_HOME` points to a temp config dir containing `fd/ignore`;
- sets `LS_COLORS` to empty for deterministic coloring.

### Assertions

| Helper | Checks |
|--------|--------|
| `assert_output(args, expected)` | exit status success and normalized stdout equals normalized expected |
| `assert_output_subdirectory(dir, args, expected)` | same, run from a subdirectory |
| `assert_output_raw(args, bytes)` | exact raw stdout bytes (Unix except macOS; for non-UTF-8 names) |
| `assert_success_and_get_output` / `..._normalized_output` | returns output for custom checks |
| `assert_failure(args)` | non-zero exit |
| `assert_failure_with_error(args, expected)` | non-zero exit and stderr starts with `expected` (lines left-trimmed) |
| `assert_error(args, expected)` | stderr prefix check, returns the exit status |

**Output normalization** makes tests independent of fd's parallel, possibly unsorted output and of the platform: NUL bytes become `NULL\n`, `/` is replaced with the platform separator, leading whitespace in expected strings is trimmed (so multi-line literals can be indented), lines are **sorted**, and with `.normalize_line(true)` the words within each line are also sorted (useful for `--exec-batch` output whose argument order is non-deterministic). Mismatches print a line diff (via the `diff` crate).

Other helpers: `create_broken_symlink`, `test_root`, `system_root`, `test_exe`, and in `tests.rs` `get_absolute_root_path`, `get_test_env_with_abs_path`, and `create_file_with_size`.

### Fixtures and patterns

`tests.rs` defines shared fixtures such as `DEFAULT_DIRS`/`DEFAULT_FILES` (including `.hidden.foo`, `fdignored.foo`, `gitignored.foo`, `C.Foo2` for smart-case and `e1 e2` for spaces) and `AND_EXTRA_FILES`. Tests are grouped by feature (`test_and_*`, `test_smart_case`, `test_glob_*`, `test_full_path`, `test_hidden`, `test_no_ignore*`, `test_global_ignore`, `test_type*`, `test_size`, `test_owner_*`, `test_exec*`, `test_print0`, `test_custom_path_separator`, `test_strip_cwd_prefix`, `test_hyperlink`, `test_ignore_contain*`, …). Parameterized cases use the `test-case` crate (`#[test_case(...)]`), e.g. for `--no-global-ignore-file` variants and flag/negation-flag pairs. Platform-specific tests are gated with `#[cfg(unix)]` / `#[cfg(windows)]`; owner tests use `nix` to look up the current user/group; time tests use `filetime` to set modification times.

Because tests run the real binary, they exercise the full pipeline — CLI parsing, `construct_config`, the parallel walker and output — and validate user-visible error messages (including clap usage errors).

## Unit tests in `src/`

| Module | Focus |
|--------|-------|
| `exec/mod.rs` | command template parsing, placeholder tokens, brace escaping, batch restrictions, custom path separators (incl. Windows drive/UNC paths) |
| `sanitize.rs` | escaping of control/invisible characters; attack strings (OSC 52, OSC 8, CR forgery, bidi) |
| `filter/size.rs` | macro-generated table of size-string parses and `is_within` |
| `filter/time.rs` | duration/date/timestamp parsing with a thread-local fake "now" |
| `filter/owner.rs` | owner string parsing |
| `walk.rs` | `search_str_for_entry` (file name vs `--full-path`) |
| `fmt/` | template parsing; `basename`, `dirname`, `remove_extension` |
| `exit_codes.rs` | `merge_exitcodes` semantics |
| `regex_helper.rs` | uppercase and leading-dot detection |
| `dir_entry.rs`, `filesystem.rs`, `hyperlink.rs` | dash-prefix detection, `./` stripping, URL percent-encoding |

## Adding tests

- For behavior visible on the command line, add an integration test using `TestEnv` with the smallest directory tree needed; prefer `assert_output` (order-insensitive) and `assert_failure_with_error` for diagnostics.
- For pure parsing/formatting logic, add a unit test in the module.
- Gate platform-specific behavior with `cfg` attributes, as CI runs on Linux, macOS and Windows.
