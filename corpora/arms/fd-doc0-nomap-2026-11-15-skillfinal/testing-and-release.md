---
title: "Testing and Release"
---
## Overview

fd is tested at two levels. Unit tests sit in `#[cfg(test)]` modules next to the code they check: size and owner parsing, time filters, format templates, path helpers, sanitization, exit-code merging. Integration tests in `tests/tests.rs` run the compiled `fd` binary against a temporary directory tree through the `TestEnv` harness in `tests/testenv`. CI runs both on every pull request and on pushes to `master`, and a pushed version tag turns the same workflow into a release.

Sources: [src/filter/size.rs:77-96](repo://src/filter/size.rs#L77-L96), [tests/tests.rs:1-20](repo://tests/tests.rs#L1-L20), [.github/workflows/CICD.yml:1-18](repo://.github/workflows/CICD.yml#L1-L18)

Locally, `cargo test` runs both kinds, as on [[Quickstart]].

Sources: [README.md:734-747](repo://README.md#L734-L747)

## The integration test harness

### The test tree

`TestEnv::new(dirs, files)` creates a temporary directory prefixed `fd-tests` and fills it. It creates an empty `.git` directory so `.gitignore` rules apply (see [[Ignore Rules and Exclusions]]), then the given directories and empty files, a `symlink` pointing to `one/two`, a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`. The binary under test comes from `CARGO_BIN_EXE_fd`.

Sources: [tests/testenv/mod.rs:13-79](repo://tests/testenv/mod.rs#L13-L79), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

On Windows creating the symlink needs the `SeCreateSymbolicLinkPrivilege`, which by default only administrators have, as the harness comments note.

Sources: [tests/testenv/mod.rs:49-55](repo://tests/testenv/mod.rs#L49-L55)

### Running fd

`run_command` starts `fd` in the test root, or a subdirectory of it, with `LS_COLORS` set to empty for consistent output. Without a configured global ignore file it passes the hidden `--no-global-ignore-file`, so the developer's own `~/.config/fd/ignore` cannot change results. `global_ignore_file(content)` writes `fd/ignore` into a temporary config directory and points `XDG_CONFIG_HOME` at it.

Sources: [tests/testenv/mod.rs:300-315](repo://tests/testenv/mod.rs#L300-L315), [tests/testenv/mod.rs:63-72](repo://tests/testenv/mod.rs#L63-L72), [tests/testenv/mod.rs:168-175](repo://tests/testenv/mod.rs#L168-L175)

### Comparing output

`assert_output(args, expected)` runs fd, requires success, and compares normalized output. `normalize_output` replaces NUL bytes with `NULL` and a newline, converts `/` to the platform separator, optionally sorts the words of each line (`normalize_line(true)`), and sorts the lines. Tests therefore do not depend on the walker's order. A mismatch panics with a line diff.

Sources: [tests/testenv/mod.rs:91-134](repo://tests/testenv/mod.rs#L91-L134), [tests/testenv/mod.rs:247-276](repo://tests/testenv/mod.rs#L247-L276)

| Helper | Checks |
| --- | --- |
| `assert_output` | success and the sorted output |
| `assert_output_subdirectory` | the same, run from a subdirectory |
| `assert_output_raw` | exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_failure_with_error` | failure with the expected stderr |
| `assert_failure` | failure only |
| `assert_error` | the expected stderr, whatever the status |

Sources: [tests/testenv/mod.rs:247-298](repo://tests/testenv/mod.rs#L247-L298)

A typical test builds the default tree and lists what a pattern finds; directories appear with their trailing `/`:

Sources: [tests/tests.rs:62-80](repo://tests/tests.rs#L62-L80)

```rust
#[test]
fn test_simple() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);

    te.assert_output(&["a.foo"], "a.foo");
    te.assert_output(&["b.foo"], "one/b.foo");
    te.assert_output(&["d.foo"], "one/two/three/d.foo");
```

Sources: [tests/tests.rs:63-70](repo://tests/tests.rs#L63-L70)

## Continuous integration

### Checks

The `CICD` workflow first extracts the crate name, version and minimum Rust version. Separate jobs check that `cargo fmt` has been run, that `cargo clippy --all-targets --all-features` reports no warnings, and that clippy and the tests pass on the minimum supported Rust version with all features.

Sources: [.github/workflows/CICD.yml:20-84](repo://.github/workflows/CICD.yml#L20-L84)

### Build matrix

The `build` job builds release binaries for Linux (x86_64, i686, aarch64 and ARM, each with glibc and musl), macOS (Intel and Apple silicon) and Windows (MSVC for i686, x86_64 and aarch64, plus GNU for x86_64). Linux targets build with `cross`, the others with `cargo`. Tests run on every target, but ARM targets run only the binary's unit tests (`--bin=fd`).

Sources: [.github/workflows/CICD.yml:86-113](repo://.github/workflows/CICD.yml#L86-L113), [.github/workflows/CICD.yml:182-198](repo://.github/workflows/CICD.yml#L182-L198)

`Cross.toml` passes `JEMALLOC_SYS_WITH_LG_PAGE=16` into the aarch64 Linux builds, for 64 KiB pages. `.cargo/config.toml` links the C runtime statically on Windows MSVC so the executable does not need the vcruntime DLL.

Sources: [Cross.toml:1-6](repo://Cross.toml#L1-L6), [.cargo/config.toml:1-9](repo://.cargo/config.toml#L1-L9)

### Packages

Each build runs `make completions`, then packs the binary, README, licenses, changelog, man page and `autocomplete` directory into `fd-v<version>-<target>.tar.gz`, or `.zip` on Windows. Ubuntu runners also build a Debian package with `scripts/create-deb.sh`. Both are uploaded as workflow artifacts.

Sources: [.github/workflows/CICD.yml:200-272](repo://.github/workflows/CICD.yml#L200-L272)

### Publishing

When the ref is a tag matching `v<digit>...`, the build job attests the artifacts and attaches them to the GitHub release, and a `winget` job publishes the Windows MSVC zip to Winget as `sharkdp.fd`.

Sources: [.github/workflows/CICD.yml:274-309](repo://.github/workflows/CICD.yml#L274-L309)

## Release process

### Steps

`doc/release-checklist.md` lists the steps. `scripts/version-bump.sh <version>` performs the version bump: it creates a `release-<version>` branch, sets the version in `Cargo.toml`, updates the Rust version in the README, and renames the changelog's "Upcoming release" heading.

Sources: [doc/release-checklist.md:1-18](repo://doc/release-checklist.md#L1-L18), [scripts/version-bump.sh:1-21](repo://scripts/version-bump.sh#L1-L21)

Before tagging, the maintainer reviews `-h`, `--help` and the man page, copies `fd -h` into the README with `scripts/update-help.awk`, waits for CI and runs `cargo publish --dry-run`. The tag push starts the deployment above; after creating the GitHub release, `cargo publish` from a clean clone publishes to crates.io, and a new "Upcoming release" section is added to the changelog.

Sources: [doc/release-checklist.md:20-69](repo://doc/release-checklist.md#L20-L69)

### Contributions

`CONTRIBUTING.md` asks contributors to open an issue before a pull request, to make sure the code compiles and passes the tests, and to add an entry to the "Upcoming release" section of `CHANGELOG.md` for any change in behaviour, in the form `- Short description, see #123 (@user)`. It also asks contributors to say when an AI tool was used, and to write comments to maintainers themselves.

Sources: [CONTRIBUTING.md:1-47](repo://CONTRIBUTING.md#L1-L47)
