---
title: "Testing and CI"
---
## Overview

fd has two layers of tests. Unit tests sit in `#[cfg(test)]` modules next to the code they test (size and owner parsing, time filters, templates, exit codes, sanitization, path helpers). Integration tests in `tests/tests.rs` run the real `fd` binary against a temporary directory tree through the `TestEnv` harness in `tests/testenv/mod.rs`. `cargo test` runs both ([[Quickstart]]).

Sources: [tests/tests.rs:1-15](repo://tests/tests.rs#L1-L15), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26), [src/exit_codes.rs:53-94](repo://src/exit_codes.rs#L53-L94)

A GitHub Actions workflow checks formatting and lints, tests on the minimum supported Rust version, and builds, tests and packages fd for fourteen targets, publishing the packages when a version tag is pushed.

Sources: [.github/workflows/CICD.yml:1-19](repo://.github/workflows/CICD.yml#L1-L19), [.github/workflows/CICD.yml:94-111](repo://.github/workflows/CICD.yml#L94-L111)

## The TestEnv harness

### The test tree

`TestEnv::new(directories, files)` creates a temporary directory with the prefix `fd-tests`, then fills it with the given directories and empty files. It also adds a `.git` directory so that `.gitignore` rules apply (see the `require_git` setting on [[Parallel Directory Walk]]), a `symlink` pointing to `one/two`, a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`.

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

Most tests use the shared `DEFAULT_DIRS` and `DEFAULT_FILES`, which include a hidden file, the two ignored files, a mixed-case `C.Foo2` and a name with a space, so one tree exercises hidden-file, ignore and smart-case behavior.

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Builder options

| Method | Effect |
| --- | --- |
| `normalize_line(true)` | sort the words within each output line before comparing, for output such as `-l` whose column order varies |
| `global_ignore_file(content)` | create a config directory holding `fd/ignore` and point `XDG_CONFIG_HOME` at it |
| `create_broken_symlink(path)` | create a symlink whose target is deleted when the call returns |
| `test_root()`, `system_root()`, `test_exe()` | paths for building arguments and expected output |

Sources: [tests/testenv/mod.rs:160-214](repo://tests/testenv/mod.rs#L160-L214), [tests/testenv/mod.rs:65-73](repo://tests/testenv/mod.rs#L65-L73)

### Running fd

`run_command` starts the binary found through `CARGO_BIN_EXE_fd` in the given subdirectory of the tree. Without a global ignore file it passes `--no-global-ignore-file`, so the developer's own `~/.config/fd/ignore` cannot change results, and it always sets `LS_COLORS` to the empty string for consistent color output.

Sources: [tests/testenv/mod.rs:75-79](repo://tests/testenv/mod.rs#L75-L79), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

## Assertions

### Output assertions

`assert_output(args, expected)` runs fd in the tree root, fails with the full stdout and stderr if it exits unsuccessfully, and compares the normalized output with the normalized expectation. `assert_output_subdirectory` does the same from a subdirectory.

Sources: [tests/testenv/mod.rs:216-276](repo://tests/testenv/mod.rs#L216-L276)

`normalize_output` makes comparisons independent of thread timing and platform: it turns each NUL into `NULL` plus a newline, trims leading whitespace from the expected text (so expectations can be indented in the test source), replaces `/` with the platform separator, and sorts the lines. On a mismatch, `format_output_error` prints a line diff of expected against actual.

Sources: [tests/testenv/mod.rs:91-134](repo://tests/testenv/mod.rs#L91-L134)

`assert_output_raw` compares stdout byte for byte, without normalization, for tests of file names that are not valid UTF-8; it exists only on Unix other than macOS.

Sources: [tests/testenv/mod.rs:252-258](repo://tests/testenv/mod.rs#L252-L258)

### Error assertions

`assert_failure_with_error` requires a non-zero exit and a stderr that starts with the expected text, after trimming leading whitespace on every line. `assert_failure` checks only the exit status, and `assert_error` checks the message and returns the status so the test can inspect it.

Sources: [tests/testenv/mod.rs:278-298](repo://tests/testenv/mod.rs#L278-L298), [tests/testenv/mod.rs:318-343](repo://tests/testenv/mod.rs#L318-L343)

## Writing an integration test

A test builds a `TestEnv` and lists the arguments with the lines it expects, in any order. Directories appear with a trailing separator, as the printer writes them ([[Printing Results]]).

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

## CI workflow

### Jobs

The `CICD` workflow runs on pull requests, on pushes to `master` and on tags, and can be started by hand. It has these jobs:

Sources: [.github/workflows/CICD.yml:7-19](repo://.github/workflows/CICD.yml#L7-L19)

| Job | What it does |
| --- | --- |
| `crate_metadata` | reads the name, version, maintainer, homepage and MSRV from `cargo metadata` for later jobs |
| `ensure_cargo_fmt` | `cargo fmt -- --check` |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings` |
| `min_version` | clippy and `cargo test --locked --all-features` on the `rust-version` from `Cargo.toml` |
| `build` | build, test and package for each target in the matrix |
| `winget` | on `v*` tags, publish the MSVC zip packages to Winget |

Sources: [.github/workflows/CICD.yml:20-84](repo://.github/workflows/CICD.yml#L20-L84), [.github/workflows/CICD.yml:299-309](repo://.github/workflows/CICD.yml#L299-L309)

### The build matrix

Linux targets (GNU and musl on x86_64, i686, aarch64 and ARM) build with `cross`; Windows (MSVC, GNU, ARM64) and macOS (Intel and Apple silicon) build with `cargo`. Tests run on every target, but ARM and AArch64 targets run only the binary's unit tests (`--bin=fd`), not the integration tests.

Sources: [.github/workflows/CICD.yml:86-198](repo://.github/workflows/CICD.yml#L86-L198)

### Packaging and release

Each build runs `make completions`, then packs the binary, README, licenses, changelog, man page and `autocomplete/` folder into a `.tar.gz` (a `.zip` on Windows) named `fd-v<version>-<target>`. Ubuntu runners also build a Debian package with `scripts/create-deb.sh`. Both are uploaded as artifacts; when the ref is a `v<digit>` tag, they are attested and attached to the GitHub release.

Sources: [.github/workflows/CICD.yml:200-297](repo://.github/workflows/CICD.yml#L200-L297)

`doc/release-checklist.md` lists the manual steps around that: bump the version (with `scripts/version-bump.sh`), update the README and `CHANGELOG.md`, refresh the help text in the README with `scripts/update-help.awk`, wait for CI, push the tag, create the GitHub release and run `cargo publish` from a clean clone.

Sources: [doc/release-checklist.md:1-51](repo://doc/release-checklist.md#L1-L51)

## Contributing

Contributors are asked to open an issue before a pull request, to make sure the code compiles and passes the tests, and to add an entry to the *Upcoming release* section of `CHANGELOG.md` for any change in behavior. Code produced with an AI tool must be reviewed and understood by the contributor and the tool's use disclosed, and communication with the maintainers must come from the contributor, not from an AI.

Sources: [CONTRIBUTING.md:10-46](repo://CONTRIBUTING.md#L10-L46)
