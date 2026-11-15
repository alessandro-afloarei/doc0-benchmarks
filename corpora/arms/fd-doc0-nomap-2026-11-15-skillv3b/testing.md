---
title: "Testing"
---
## Overview

fd has two layers of tests, and both run with `cargo test`. Unit tests sit next to the code in `#[cfg(test)]` modules and check pure functions: size and time parsing, owner parsing, template parsing, path helpers, sanitising, exit-code merging. Integration tests in `tests/tests.rs` run the compiled `fd` binary as a child process inside a freshly created directory tree and compare its stdout or stderr with the expected text. The harness for the second layer is `TestEnv` in `tests/testenv/mod.rs`.

Sources: [tests/tests.rs:1-16](repo://tests/tests.rs#L1-L16), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26), [src/filter/size.rs:77-96](repo://src/filter/size.rs#L77-L96)

## Unit tests

Unit tests use small macros to generate one `#[test]` per case from a data table. For example, `gen_size_filter_parse_test!` maps strings like `"+1Ki"` to the expected `SizeFilter`, and `owner_tests!` maps owner strings to `Ok`/`Err` patterns. Code that depends on the current time is made testable by a `#[cfg(test)]` replacement of `now()` in `filter/time.rs`, which reads a thread-local `TESTTIME` that the `TestTime` guard sets and clears.

Sources: [src/filter/size.rs:81-167](repo://src/filter/size.rs#L81-L167), [src/filter/owner.rs:105-140](repo://src/filter/owner.rs#L105-L140), [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26), [src/filter/time.rs:70-93](repo://src/filter/time.rs#L70-L93)

| Module | What the unit tests cover |
| --- | --- |
| `filter::size` | every unit and sign, upper and lower case, invalid strings, boundary comparisons |
| `filter::time` | durations, dates, RFC 3339 timestamps and `@seconds` against a fixed "now" |
| `filter::owner` | user/group, negation, empty and invalid strings |
| `fmt`, `fmt::input` | placeholder parsing, escapes, `basename`/`dirname`/`remove_extension` |
| `exec` | command template construction, batch validation, custom path separators |
| `sanitize`, `hyperlink` | escaping of control and bidi characters, URL percent-encoding |
| `exit_codes`, `regex_helper`, `walk`, `dir_entry`, `filesystem` | code merging, smart case and leading-dot detection, the search string, the dash guard, `./` stripping |

Sources: [src/filter/time.rs:95-201](repo://src/filter/time.rs#L95-L201), [src/fmt/mod.rs:213-281](repo://src/fmt/mod.rs#L213-L281), [src/exec/mod.rs:275-385](repo://src/exec/mod.rs#L275-L385), [src/sanitize.rs:57-168](repo://src/sanitize.rs#L57-L168), [src/exit_codes.rs:53-94](repo://src/exit_codes.rs#L53-L94), [src/regex_helper.rs:81-105](repo://src/regex_helper.rs#L81-L105), [src/walk.rs:689-744](repo://src/walk.rs#L689-L744)

## The TestEnv harness

### The test directory

`TestEnv::new(directories, files)` creates a temporary directory prefixed `fd-tests` and fills it. It always contains:

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63)

- an empty `.git` directory, so the walker treats the tree as a git repository and applies `.gitignore` (git rules are only read inside a repository by default; see [[Ignore Rules and Traversal]]);
- the requested directories and empty files;
- a `symlink` pointing at `one/two` (on Windows this needs the symlink privilege);
- a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`.

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63)

Most tests use the shared fixtures `DEFAULT_DIRS` and `DEFAULT_FILES`, which include a hidden file, a file with a space in its name, mixed-case names for smart-case tests, and the two ignored files.

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Running fd

`run_command` starts the binary from `CARGO_BIN_EXE_fd` (an environment override is accepted, which helps with cross-compiled runs) in the test directory or a subdirectory of it. It sets `LS_COLORS` to empty for repeatable colours, and passes `--no-global-ignore-file` unless the test configured a global ignore file. In that case it points `XDG_CONFIG_HOME` at a temporary directory containing `fd/ignore`, created by `global_ignore_file(content)`.

Sources: [tests/testenv/mod.rs:65-79](repo://tests/testenv/mod.rs#L65-L79), [tests/testenv/mod.rs:169-176](repo://tests/testenv/mod.rs#L169-L176), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

### Comparing output

Because results from the parallel walker can arrive in any order, `normalize_output` makes comparisons order-independent. It turns NUL bytes into the word `NULL` plus a newline, trims leading whitespace from expected lines so they can be indented in the test source, converts `/` to the platform separator, and sorts the lines. With `normalize_line(true)`, the words within each line are sorted as well, for output like `ls -l` or `--exec` where the order of arguments varies.

Sources: [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134), [tests/testenv/mod.rs:160-167](repo://tests/testenv/mod.rs#L160-L167)

When the output differs, `format_output_error` panics with a line diff produced by the `diff` crate; when fd exits unsuccessfully, `format_exit_error` shows the arguments, stdout and stderr.

Sources: [tests/testenv/mod.rs:81-112](repo://tests/testenv/mod.rs#L81-L112)

### Assertions

| Method | Checks |
| --- | --- |
| `assert_output(args, expected)` | success and normalised stdout, run from the test root |
| `assert_output_subdirectory(path, args, expected)` | the same, run from a subdirectory |
| `assert_output_raw(args, bytes)` | exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_success_and_get_output` / `..._normalized_output` | success, returning the output for custom checks |
| `assert_failure_with_error(args, expected)` | failure, and stderr starts with `expected` |
| `assert_failure(args)` | failure only |
| `assert_error(args, expected)` | stderr starts with `expected`, returning the exit status |

Sources: [tests/testenv/mod.rs:216-298](repo://tests/testenv/mod.rs#L216-L298), [tests/testenv/mod.rs:320-343](repo://tests/testenv/mod.rs#L320-L343)

Helpers such as `create_broken_symlink`, `test_root`, `system_root` and `test_exe`, plus `get_absolute_root_path` and `create_file_with_size` in `tests.rs`, support tests for broken links, absolute paths and size filters.

Sources: [tests/testenv/mod.rs:178-214](repo://tests/testenv/mod.rs#L178-L214), [tests/tests.rs:31-61](repo://tests/tests.rs#L31-L61)

## Writing an integration test

A typical test builds an environment and asserts on fd's output, listing the expected paths in any order. Directories appear with a trailing separator, as described on [[Output Formatting]].

Sources: [tests/tests.rs:62-80](repo://tests/tests.rs#L62-L80)

```rust
#[test]
fn test_simple() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);

    te.assert_output(&["a.foo"], "a.foo");
    te.assert_output(&["b.foo"], "one/b.foo");
    te.assert_output(&["d.foo"], "one/two/three/d.foo");

    te.assert_output(
        &["foo"],
        "a.foo
        one/b.foo
        one/two/c.foo
        one/two/C.Foo2
        one/two/three/d.foo
        one/two/three/directory_foo/",
    );
}
```

Sources: [tests/tests.rs:62-80](repo://tests/tests.rs#L62-L80)

Tests that should run the same check over several option values use the `test-case` crate's `#[test_case(...)]` attribute, for example to check each ignore option or each pair of overriding flags.

Sources: [tests/tests.rs:1026-1050](repo://tests/tests.rs#L1026-L1050), [tests/tests.rs:2674-2680](repo://tests/tests.rs#L2674-L2680)

## In CI

CI runs `cargo test --locked` on the minimum supported Rust version and on every release target. For ARM targets built with `cross`, only the binary's unit tests run (`--bin=fd`), since the integration tests would have to execute the cross-compiled binary. Formatting (`cargo fmt -- --check`) and `cargo clippy --all-targets --all-features -- -Dwarnings` are separate jobs. [[Building and Releasing]] describes the rest of the pipeline.

Sources: [.github/workflows/CICD.yml:42-84](repo://.github/workflows/CICD.yml#L42-L84), [.github/workflows/CICD.yml:182-198](repo://.github/workflows/CICD.yml#L182-L198)
