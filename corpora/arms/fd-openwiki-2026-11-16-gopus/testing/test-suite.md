---
type: testing
title: Test Suite and Testing Procedures
description: How fd is tested — colocated unit tests, the black-box integration suite in tests/tests.rs built on the TestEnv harness (temporary trees, fake git repo, symlinks, isolated global ignore config, order-insensitive output comparison), platform-specific tests, and how to run the suite locally and in CI.
tags: [testing, integration-tests, unit-tests, testenv, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-0d5ea0012fa8783c7eda55f2
    resource: repo://src/filter/time.rs
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Test Suite and Testing Procedures

fd has two layers of tests:

1. **Unit tests** in `#[cfg(test)]` modules next to the code they cover.
2. **Integration tests** in `tests/tests.rs` (~100 `test_*` functions) that run the
   compiled `fd` binary against temporary directory trees, using the harness in
   `tests/testenv/mod.rs`.

Dev-dependencies: `tempfile` (temp dirs), `diff` (readable mismatch output),
`filetime` (setting mtimes), and `test-case` (parameterized tests).

## Running tests

```bash
cargo test                    # unit + integration tests
cargo test --bin fd           # only unit tests inside the binary crate
cargo test test_exec          # filter by name
cargo test --all-features     # what the MSRV CI job runs
cargo clippy --all-targets --all-features -- -Dwarnings
cargo fmt -- --check
```

CI ([Build, CI, Release](../operations/build-release-and-packaging.md)) runs the
full suite on every target in the build matrix, except ARM targets, which run only
`--bin=fd` unit tests.

## Unit test locations

| Module | What is covered |
| --- | --- |
| `src/exec/mod.rs` | Placeholder token parsing, implicit `{}`, batch-mode restrictions, custom path separators (incl. Windows UNC). |
| `src/fmt/mod.rs`, `src/fmt/input.rs` | Template parsing (escapes, all placeholders) and `basename`/`dirname`/`remove_extension`. |
| `src/filter/size.rs` | Macro-generated parsing for every unit/sign, and `is_within`. |
| `src/filter/time.rs` | Durations, dates, timestamps and `@epoch`, using a thread-local fake "now" (`TESTTIME`). |
| `src/filter/owner.rs` | `owner_parsing` table (negation, colon edge cases). |
| `src/regex_helper.rs` | Smart-case uppercase detection and leading-dot detection. |
| `src/sanitize.rs` | Terminal escape stripping and preservation of safe Unicode. |
| `src/hyperlink.rs` | Percent-encoding. |
| `src/walk.rs` | `search_str_for_entry` with and without `--full-path`. |
| `src/exit_codes.rs` | `merge_exitcodes`. |
| `src/filesystem.rs` | `strip_current_dir`. |

## The `TestEnv` harness

`TestEnv::new(dirs, files)` creates a temp directory (prefix `fd-tests`) and:

- creates an empty `.git` directory so the tree counts as a git repository and
  `.gitignore` is honored;
- creates the requested directories and empty files;
- creates a `symlink` → `one/two` (on Windows a directory symlink, which needs
  the symlink privilege);
- writes `.fdignore` containing `fdignored.foo` and `.gitignore` containing
  `gitignored.foo`.

Most tests use `DEFAULT_DIRS` / `DEFAULT_FILES` from `tests/tests.rs` (`a.foo`,
`one/b.foo`, `one/two/c.foo`, `one/two/C.Foo2`, `one/two/three/d.foo`,
`one/two/three/directory_foo/`, the ignored files, `.hidden.foo`, `e1 e2`).

The binary is located through `CARGO_BIN_EXE_fd`. Each run (`run_command`):

- sets the working directory to the temp root (or a subdirectory);
- passes `--no-global-ignore-file` unless a test configured a global ignore via
  `.global_ignore_file(content)`, which instead points `XDG_CONFIG_HOME` at a
  temporary config dir containing `fd/ignore`;
- sets `LS_COLORS` to empty for deterministic colors.

Builder options: `.normalize_line(true)` sorts the words within each line (for
`--list-details`-style output), and `create_broken_symlink(path)` creates a link
to a target that is deleted immediately.

### Assertions

- `assert_output(args, expected)` / `assert_output_subdirectory(dir, ...)` — run
  fd, require success, and compare normalized output. Normalization replaces `\0`
  with `NULL\n`, trims leading whitespace in expected text (so expectations can be
  indented), converts `/` to the platform separator, and **sorts lines**, so
  tests are independent of fd's nondeterministic output order.
- `assert_output_raw` — byte-exact comparison for non-UTF-8 names (Unix, not
  macOS).
- `assert_success_and_get_output` / `..._normalized_output` — for custom checks.
- `assert_failure`, `assert_failure_with_error`, `assert_error` — check exit
  status and that stderr *starts with* the expected message.

Mismatch panics include a line diff of expected vs. actual output.

## Writing a new integration test

```rust
#[test]
fn test_my_feature() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);
    te.assert_output(
        &["--my-flag", "foo"],
        "a.foo
        one/b.foo",
    );
}
```

Use `#[cfg(unix)]` / `#[cfg(not(windows))]` for platform-specific behavior (about
30 `cfg` gates exist in `tests/tests.rs`, e.g. owner filters, invalid UTF-8, glob
full-path tests), `#[test_case(...)]` for flag variants, `filetime` for mtime
tests, and `create_file_with_size` for size tests. Remember to add a CHANGELOG
entry for behavior changes.

Related pages: [Ignore Rules](../concepts/ignore-rules-and-hidden-files.md),
[Exit Codes and Errors](../reference/exit-codes-and-errors.md).
