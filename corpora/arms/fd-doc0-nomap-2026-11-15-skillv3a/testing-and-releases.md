---
title: "Testing and Releases"
---
## Overview

fd is tested at two levels. Unit tests sit in `#[cfg(test)]` modules next to the code they check: size and owner parsing, time filters with a frozen clock, template parsing, sanitization, path helpers. Integration tests in `tests/tests.rs` run the compiled `fd` binary against small directory trees built in temporary directories, through the `TestEnv` harness in `tests/testenv`. GitHub Actions runs both on every push and pull request across fourteen targets, and a tag push turns the same workflow into a release. Building and running fd locally is on [[Quickstart]].

Sources: [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26), [.github/workflows/CICD.yml:1-19](repo://.github/workflows/CICD.yml#L1-L19)

## The TestEnv harness

### The test tree

`TestEnv::new(dirs, files)` creates a temporary directory prefixed `fd-tests`, then fills it in a fixed way: a `.git` directory so `.gitignore` files are honoured (fd reads them only inside a repository by default), the given directories and empty files, a `symlink` pointing to `one/two`, a `.fdignore` containing `fdignored.foo`, and a `.gitignore` containing `gitignored.foo`. It also finds the binary under test through `CARGO_BIN_EXE_fd`, which Cargo sets for integration tests.

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:75-79](repo://tests/testenv/mod.rs#L75-L79), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

Most tests start from the shared `DEFAULT_DIRS` and `DEFAULT_FILES`, which cover nested directories, an uppercase name for smart case, ignored and hidden files, and a name with a space.

Sources: [tests/tests.rs:15-27](repo://tests/tests.rs#L15-L27)

### Running fd

`run_command` starts the binary in a subdirectory of the tree with the given arguments. It sets `LS_COLORS` to an empty value so colour output is stable, and passes `--no-global-ignore-file` so the developer's own `~/.config/fd/ignore` cannot change results. A test that needs a global ignore file calls `global_ignore_file(content)`, which writes `fd/ignore` into a temporary config directory and points `XDG_CONFIG_HOME` at it instead.

Sources: [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316), [tests/testenv/mod.rs:65-73](repo://tests/testenv/mod.rs#L65-L73), [tests/testenv/mod.rs:169-176](repo://tests/testenv/mod.rs#L169-L176)

`create_broken_symlink` creates a link to a file in a second temporary directory that is deleted at once, which exercises the broken-symlink path described on [[Parallel Directory Traversal]].

Sources: [tests/testenv/mod.rs:178-197](repo://tests/testenv/mod.rs#L178-L197)

### Assertions

| Method | Checks |
| --- | --- |
| `assert_output(args, expected)` | fd succeeds in the tree root and prints exactly the expected lines |
| `assert_output_subdirectory(path, args, expected)` | the same, run from a subdirectory |
| `assert_output_raw(args, bytes)` | exact stdout bytes, for non-UTF-8 names (Unix except macOS) |
| `assert_success_and_get_output(path, args)` | fd succeeds; returns the raw output |
| `assert_failure_with_error(args, expected)` | fd fails and stderr starts with the expected text |
| `assert_failure(args)` | fd fails |
| `assert_error(args, expected)` | stderr starts with the expected text; returns the status |

Sources: [tests/testenv/mod.rs:216-298](repo://tests/testenv/mod.rs#L216-L298)

Output comparison is made order-independent, since parallel walks may print in any order. `normalize_output` replaces each `\0` with `NULL` and a newline, converts `/` to the platform separator, optionally sorts the words of each line (`normalize_line(true)`, for `--exec-batch` output), and sorts the lines. Expected strings also have leading whitespace trimmed, so tests can indent them. A mismatch panics with a line diff.

Sources: [tests/testenv/mod.rs:91-134](repo://tests/testenv/mod.rs#L91-L134), [tests/testenv/mod.rs:262-276](repo://tests/testenv/mod.rs#L262-L276)

```rust
#[test]
fn test_simple() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);

    te.assert_output(&["a.foo"], "a.foo");
    te.assert_output(&["b.foo"], "one/b.foo");
    te.assert_output(&["d.foo"], "one/two/three/d.foo");
```

Sources: [tests/tests.rs:59-66](repo://tests/tests.rs#L59-L66)

## Continuous integration

### Checks

The `CICD` workflow runs on pull requests, on pushes to `master`, on every tag, and by hand. Before the build matrix it runs three checks: `cargo fmt -- --check`, `cargo clippy --all-targets --all-features -- -Dwarnings`, and clippy plus the tests on the minimum supported Rust version read from `Cargo.toml`, so a change cannot quietly raise the MSRV.

Sources: [.github/workflows/CICD.yml:1-84](repo://.github/workflows/CICD.yml#L1-L84)

### Build matrix

The `build` job builds release binaries for Linux (gnu and musl on x86_64, i686, aarch64 and ARMv7, through `cross`), macOS (Intel and Apple silicon) and Windows (MSVC on x86_64, i686 and aarch64; GNU on x86_64), then runs `cargo test` for each target. On ARM targets only the binary's unit tests run (`--bin=fd`), because the integration tests would execute the cross-compiled binary.

Sources: [.github/workflows/CICD.yml:86-198](repo://.github/workflows/CICD.yml#L86-L198)

### Packaging

Each build then generates completions with `make completions`, packs a tarball (a zip on Windows) with the binary, README, licences, changelog, man page and completions, and on Ubuntu builds a Debian package with `scripts/create-deb.sh`. The artifacts are uploaded for every run; for a tag they are also attested and published to the GitHub release, and a later job publishes to Winget.

Sources: [.github/workflows/CICD.yml:200-299](repo://.github/workflows/CICD.yml#L200-L299)

## Making a release

`doc/release-checklist.md` lists the steps; the version bump can be scripted with `scripts/version-bump.sh <version>`, which creates a `release-<version>` branch, sets the version in `Cargo.toml`, writes the current MSRV into the README, and renames the "Upcoming release" heading of `CHANGELOG.md` to the version.

Sources: [doc/release-checklist.md:1-21](repo://doc/release-checklist.md#L1-L21), [scripts/version-bump.sh:1-21](repo://scripts/version-bump.sh#L1-L21)

1. Bump the version, run `cargo build` to update `Cargo.lock`, and update the README and changelog.
2. Install the new build, review `-h`, `--help` and the man page, and copy `fd -h` into the README with `gawk -i inplace -f scripts/update-help.awk README.md`.
3. Push, wait for CI, and run `cargo publish --dry-run`.
4. Merge the release branch, then tag `vX.Y.Z` and push the tag, which triggers the release build.
5. Create the GitHub release from the tag with the changelog section as notes, and check that the archives and Debian packages appear.
6. Run `cargo publish` from a clean clone, and open a new "Upcoming release" section in the changelog.

Sources: [doc/release-checklist.md:22-69](repo://doc/release-checklist.md#L22-L69)

## Contributing

Open an issue before a pull request so the change can be discussed first. Pull requests should compile and pass the tests, and any behaviour change needs an entry in the "Upcoming release" section of `CHANGELOG.md` in the form `- Short description, see #123 (@user)`. Contributors must disclose use of AI tools, review and understand any generated code, and write their messages to maintainers themselves.

Sources: [CONTRIBUTING.md:1-50](repo://CONTRIBUTING.md#L1-L50)
