---
title: "Testing"
---
## Overview

fd is tested at two levels. Unit tests sit in `#[cfg(test)]` modules next to the code they cover (pattern analysis, size, time and owner parsing, templates, sanitization, exit-code merging). Integration tests in `tests/tests.rs` run the real `fd` binary against throwaway directory trees, through the `TestEnv` harness in `tests/testenv/mod.rs`, and compare its stdout or stderr with the expected text.

Sources: [tests/tests.rs:1-29](repo://tests/tests.rs#L1-L29), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26)

## Running the tests

`cargo test` builds the binary and runs both levels. CI also runs `cargo fmt -- --check` and `cargo clippy --all-targets --all-features -- -Dwarnings`, and repeats clippy and the tests with `--locked --all-features` on the minimum supported Rust version read from `Cargo.toml`.

Sources: [README.md:734-747](repo://README.md#L734-L747), [.github/workflows/CICD.yml:42-84](repo://.github/workflows/CICD.yml#L42-L84)

```bash
cargo test
cargo test --test tests test_simple   # one integration test
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
```

Sources: [.github/workflows/CICD.yml:52-64](repo://.github/workflows/CICD.yml#L52-L64)

## The TestEnv harness

### The test tree

`TestEnv::new(directories, files)` creates a temporary directory prefixed `fd-tests`, then fills it in a fixed way so every test starts from the same shape.

Sources: [tests/testenv/mod.rs:28-33](repo://tests/testenv/mod.rs#L28-L33)

- an empty `.git` directory, so that `.gitignore` rules apply (fd requires a git repository by default);
- the given directories and empty files;
- a `symlink` pointing to `one/two` (on Windows this needs the symlink privilege);
- a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`.

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

Most tests use `DEFAULT_DIRS` and `DEFAULT_FILES`, which include a hidden file, the two ignored files, mixed-case names and a name with a space, so one tree exercises hidden handling, both ignore files and smart case.

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Running fd

`run_command` runs the binary found through `CARGO_BIN_EXE_fd` in a subdirectory of the tree. It sets `LS_COLORS` to an empty string for stable output and passes `--no-global-ignore-file`, so a developer's own `~/.config/fd/ignore` cannot change results. A test that needs a global ignore file calls `global_ignore_file(content)`, which writes `fd/ignore` into a temporary config directory and points `XDG_CONFIG_HOME` at it instead.

Sources: [tests/testenv/mod.rs:65-79](repo://tests/testenv/mod.rs#L65-L79), [tests/testenv/mod.rs:169-176](repo://tests/testenv/mod.rs#L169-L176), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

`create_broken_symlink` makes a link to a file in a second temporary directory that is deleted at once, which leaves the link dangling.

Sources: [tests/testenv/mod.rs:178-197](repo://tests/testenv/mod.rs#L178-L197)

### Comparing output

`normalize_output` makes comparisons independent of thread scheduling and platform: it turns each NUL into `NULL` plus a newline, optionally trims leading whitespace (used for the expected text, so it can be indented in the test source), converts `/` to the platform separator, optionally sorts the words within each line (`normalize_line(true)`, for `--exec` output whose argument order is not fixed), and finally sorts the lines. A mismatch panics with a line diff built with the `diff` crate.

Sources: [tests/testenv/mod.rs:91-134](repo://tests/testenv/mod.rs#L91-L134), [tests/testenv/mod.rs:160-167](repo://tests/testenv/mod.rs#L160-L167)

## Assertions

| Method | Checks |
| --- | --- |
| `assert_output(args, expected)` | Success, and normalized stdout equals `expected` |
| `assert_output_subdirectory(path, args, expected)` | The same, run from a subdirectory |
| `assert_output_raw(args, bytes)` | Exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_success_and_get_output(path, args)` | Success; returns the raw `Output` |
| `assert_error(args, expected)` | stderr starts with `expected`; returns the exit status |
| `assert_failure_with_error(args, expected)` | As above, and the exit status is a failure |
| `assert_failure(args)` | The exit status is a failure |

Sources: [tests/testenv/mod.rs:216-298](repo://tests/testenv/mod.rs#L216-L298), [tests/testenv/mod.rs:318-343](repo://tests/testenv/mod.rs#L318-L343)

## Writing a test

A typical integration test builds an environment and lists the expected paths; directories in the expected output carry a trailing `/`, as fd prints them.

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

Error messages are asserted with their `[fd error]:` prefix, one line per message.

Sources: [tests/tests.rs:363-375](repo://tests/tests.rs#L363-L375)

```rust
te.assert_failure_with_error(
    &["", "fake1", "fake2"],
    "[fd error]: Search path 'fake1' is not a directory.
    [fd error]: Search path 'fake2' is not a directory.
    [fd error]: No valid search paths given.",
);
```

Sources: [tests/tests.rs:369-374](repo://tests/tests.rs#L369-L374)

Several variants of one scenario are written as a single function with `test_case` attributes, each giving the flag and the expected output, as `test_no_global_ignore` does for `--unrestricted`, `--no-ignore` and `--no-global-ignore-file`.

Sources: [tests/tests.rs:1025-1052](repo://tests/tests.rs#L1025-L1052)

## Unit tests

Unit tests use internal functions directly. Examples include `regex_helper` (uppercase and leading-dot detection), `filter::size` (a table of unit parses), `filter::time` (a thread-local override of `now()` so durations are deterministic), `filter::owner`, `fmt` (placeholder parsing and expansion), `sanitize` (escape-injection cases) and `exit_codes` (merging).

Sources: [src/regex_helper.rs:81-105](repo://src/regex_helper.rs#L81-L105), [src/filter/size.rs:77-120](repo://src/filter/size.rs#L77-L120), [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26), [src/sanitize.rs:57-80](repo://src/sanitize.rs#L57-L80), [src/exit_codes.rs:52-94](repo://src/exit_codes.rs#L52-L94)
