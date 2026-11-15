---
title: "Testing"
---
## Overview

fd has two kinds of tests. Unit tests sit in `#[cfg(test)]` modules next to the code they check, for pure functions such as size parsing, owner parsing, placeholder parsing and terminal sanitization. Integration tests in `tests/tests.rs` run the real `fd` binary against a temporary directory tree and compare what it prints. Both run with `cargo test`.

Sources: [README.md:734-747](repo://README.md#L734-L747), [tests/tests.rs:1-15](repo://tests/tests.rs#L1-L15), [src/filter/owner.rs:105-140](repo://src/filter/owner.rs#L105-L140)

## Running the tests

```bash
cargo test                      # unit and integration tests
cargo test --test tests         # integration tests only
cargo test test_exec_batch      # tests whose name contains the filter
```

Sources: [README.md:742-743](repo://README.md#L742-L743), [tests/tests.rs:1919-1920](repo://tests/tests.rs#L1919-L1920)

The integration tests find the binary through `CARGO_BIN_EXE_fd`, which cargo sets when it builds the `fd` target for tests, so no separate build step is needed.

Sources: [tests/testenv/mod.rs:75-79](repo://tests/testenv/mod.rs#L75-L79)

## The test environment

### The fixture tree

`TestEnv::new(directories, files)` creates a temporary directory prefixed `fd-tests` and fills it. Besides the requested directories and empty files, it always adds a few fixtures.

Sources: [tests/testenv/mod.rs:33-47](repo://tests/testenv/mod.rs#L33-L47)

- a `.git` directory, so the tree counts as a git repository and `.gitignore` is respected;
- a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`;
- a `symlink` pointing at `one/two` (on Windows this needs the symlink privilege).

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

Most tests use the shared `DEFAULT_DIRS` and `DEFAULT_FILES`, which mix nested paths, a hidden file, ignored files, a mixed-case name and a name with a space.

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Running fd

`run_command` starts fd in a subdirectory of the tree with the given arguments. It sets `LS_COLORS` to empty for stable colors and, unless a global ignore file was requested, passes `--no-global-ignore-file` so the developer's own `~/.config/fd/ignore` cannot change results. `global_ignore_file(content)` instead writes `fd/ignore` into a temporary config directory and points `XDG_CONFIG_HOME` at it.

Sources: [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316), [tests/testenv/mod.rs:65-73](repo://tests/testenv/mod.rs#L65-L73), [tests/testenv/mod.rs:169-176](repo://tests/testenv/mod.rs#L169-L176)

### Builder options

`normalize_line(true)` sorts the words within each line before comparing, for output whose order inside a line is not fixed, such as `--exec-batch echo`. `create_broken_symlink` makes a link to a file in a second temporary directory that is deleted at once, leaving the link dangling.

Sources: [tests/testenv/mod.rs:160-197](repo://tests/testenv/mod.rs#L160-L197), [tests/tests.rs:1919-1932](repo://tests/tests.rs#L1919-L1932)

## Assertions

| Method | Checks |
| --- | --- |
| `assert_output(args, expected)` | fd succeeds in the root and prints `expected` |
| `assert_output_subdirectory(path, args, expected)` | the same, run from `path` |
| `assert_output_raw(args, bytes)` | exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_success_and_get_output(path, args)` | fd succeeds; returns the raw `Output` |
| `assert_failure_with_error(args, expected)` | fd fails and stderr starts with `expected` |
| `assert_failure(args)` | fd fails |
| `assert_error(args, expected)` | stderr starts with `expected`; returns the status |

Sources: [tests/testenv/mod.rs:216-298](repo://tests/testenv/mod.rs#L216-L298)

Output comparison does not depend on order. `normalize_output` turns each NUL into `NULL` plus a newline, converts `/` to the platform separator, trims leading whitespace from the expected text (so it can be indented in the test source), and sorts the lines of both sides. A mismatch panics with a line diff made by the `diff` crate.

Sources: [tests/testenv/mod.rs:91-134](repo://tests/testenv/mod.rs#L91-L134)

## Writing a test

A typical integration test builds an environment and asserts on a few invocations.

Sources: [tests/tests.rs:63-80](repo://tests/tests.rs#L63-L80)

```rust
/// Non-zero exit code (--quiet)
#[test]
fn test_quiet() {
    let dirs = &[];
    let files = &["a.foo", "b.foo"];
    let te = TestEnv::new(dirs, files);

    te.assert_output(&["-q"], "");
    te.assert_output(&["--quiet"], "");
    te.assert_output(&["--has-results"], "");
    te.assert_failure_with_error(&["--quiet", "c.foo"], "")
}
```

Sources: [tests/tests.rs:2180-2191](repo://tests/tests.rs#L2180-L2191)

Tests that need absolute paths use `get_test_env_with_abs_path`, which also returns the tree's normalized absolute root, and `create_file_with_size` writes files of a given size for `--size` tests. The `test-case` crate is available for parameterized tests, and `filetime` for setting modification times.

Sources: [tests/tests.rs:31-61](repo://tests/tests.rs#L31-L61), [Cargo.toml:73-77](repo://Cargo.toml#L73-L77)
