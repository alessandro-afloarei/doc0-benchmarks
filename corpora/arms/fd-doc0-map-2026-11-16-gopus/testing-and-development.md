---
title: "Testing and Development"
---
## Overview

fd is tested at two levels: unit tests inside the modules for parsers and helpers, and integration tests in `tests/tests.rs` that run the real `fd` binary against a temporary directory tree built by `TestEnv` in `tests/testenv/mod.rs`. A GitHub Actions workflow runs formatting, lint, minimum-Rust-version and cross-platform build-and-test jobs, and publishes release artefacts for version tags. Building and installing locally is covered on [[Quickstart]].

Sources: [tests/tests.rs:1-29](repo://tests/tests.rs#L1-L29), [tests/testenv/mod.rs:13-26](repo://tests/testenv/mod.rs#L13-L26), [.github/workflows/CICD.yml:19-86](repo://.github/workflows/CICD.yml#L19-L86)

## Unit tests

Most modules carry a `#[cfg(test)]` block for the logic that can be checked without a filesystem walk.

Sources: [src/exec/mod.rs:275-280](repo://src/exec/mod.rs#L275-L280)

| Module | What the tests pin down |
| --- | --- |
| `src/fmt/mod.rs`, `src/fmt/input.rs` | template parsing, brace escapes, `basename`/`dirname`/`remove_extension` ([[Format Templates]]) |
| `src/exec/mod.rs` | command templates, batch restrictions, custom path separators on Unix and Windows ([[Command Execution]]) |
| `src/filter/size.rs`, `src/filter/time.rs`, `src/filter/owner.rs` | size units, time formats against a fixed clock, owner strings ([[Entry Filters]]) |
| `src/regex_helper.rs` | smart-case and leading-dot detection ([[Pattern Matching]]) |
| `src/sanitize.rs` | escape-injection payloads and preserved Unicode ([[Printing Results]]) |
| `src/walk.rs`, `src/dir_entry.rs`, `src/filesystem.rs` | `search_str_for_entry`, the dash guard, `strip_current_dir` |
| `src/exit_codes.rs` | `merge_exitcodes` ([[Result Buffering and Exit Codes]]) |

Sources: [src/fmt/mod.rs:213-281](repo://src/fmt/mod.rs#L213-L281), [src/fmt/input.rs:34-87](repo://src/fmt/input.rs#L34-L87), [src/exec/mod.rs:275-390](repo://src/exec/mod.rs#L275-L390), [src/exec/mod.rs:391-486](repo://src/exec/mod.rs#L391-L486), [src/filter/size.rs:77-110](repo://src/filter/size.rs#L77-L110), [src/filter/time.rs:65-180](repo://src/filter/time.rs#L65-L180), [src/filter/time.rs:181-202](repo://src/filter/time.rs#L181-L202), [src/filter/owner.rs:105-140](repo://src/filter/owner.rs#L105-L140), [src/regex_helper.rs:81-105](repo://src/regex_helper.rs#L81-L105), [src/sanitize.rs:57-168](repo://src/sanitize.rs#L57-L168), [src/walk.rs:689-744](repo://src/walk.rs#L689-L744), [src/dir_entry.rs:169-189](repo://src/dir_entry.rs#L169-L189), [src/filesystem.rs:138-156](repo://src/filesystem.rs#L138-L156), [src/exit_codes.rs:53-94](repo://src/exit_codes.rs#L53-L94)

The time filter's tests replace `now()` with a thread-local clock so that relative durations are checked against a fixed instant.

Sources: [src/filter/time.rs:12-26](repo://src/filter/time.rs#L12-L26)

## The integration test environment

### Building the tree

`TestEnv::new(directories, files)` creates a temporary directory with the prefix `fd-tests` and fills it. It always creates an empty `.git` directory, "in order for `.gitignore` files to be respected" (fd requires a git repository by default, see [[Ignore Rules and Hidden Files]]), a `symlink` pointing at `one/two`, a `.fdignore` containing `fdignored.foo` and a `.gitignore` containing `gitignored.foo`. Each listed directory and empty file is created under the root.

Sources: [tests/testenv/mod.rs:28-63](repo://tests/testenv/mod.rs#L28-L63), [tests/testenv/mod.rs:147-158](repo://tests/testenv/mod.rs#L147-L158)

Most tests use the shared `DEFAULT_DIRS` and `DEFAULT_FILES`, which include files with mixed case (`one/two/C.Foo2`), a hidden file, the two ignored files and a name with a space (`e1 e2`), so one tree exercises smart case, hidden and ignore rules, and quoting.

Sources: [tests/tests.rs:17-29](repo://tests/tests.rs#L17-L29)

### Builder options

| Method | Effect |
| --- | --- |
| `normalize_line(true)` | sort the whitespace-separated words of each output line before comparing |
| `global_ignore_file(content)` | write `fd/ignore` into a temporary config directory used as `XDG_CONFIG_HOME` |
| `create_broken_symlink(path)` | link to a file in a temporary directory that is deleted at once |
| `test_root()`, `system_root()`, `test_exe()` | paths for building expectations |

Sources: [tests/testenv/mod.rs:160-214](repo://tests/testenv/mod.rs#L160-L214)

### Running fd

`run_command` starts the binary named by `CARGO_BIN_EXE_fd` in a directory under the root. It sets `LS_COLORS` to an empty string for consistent colour output. Unless a global ignore file was configured, it passes `--no-global-ignore-file`, so a developer's own `~/.config/fd/ignore` cannot change test results.

Sources: [tests/testenv/mod.rs:75-79](repo://tests/testenv/mod.rs#L75-L79), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

### Assertions

`assert_output(args, expected)` and `assert_output_subdirectory` require a successful exit and compare normalized output. `normalize_output` replaces NUL with a `NULL` line, trims leading whitespace from the expected text (so expectations can be indented in the test source), converts `/` to the platform separator, and sorts the lines. Results are therefore compared as a set, independent of the walk order and of whether the receiver sorted them ([[Result Buffering and Exit Codes]]).

Sources: [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134), [tests/testenv/mod.rs:247-276](repo://tests/testenv/mod.rs#L247-L276)

On a mismatch the panic shows a line diff from the `diff` crate; on a failed exit it shows stdout and stderr. `assert_output_raw`, on Unix other than macOS, compares raw stdout bytes for tests with non-UTF-8 names. `assert_error`, `assert_failure_with_error` and `assert_failure` check that stderr starts with the expected message and, for the last two, that fd failed.

Sources: [tests/testenv/mod.rs:81-112](repo://tests/testenv/mod.rs#L81-L112), [tests/testenv/mod.rs:216-258](repo://tests/testenv/mod.rs#L216-L258), [tests/testenv/mod.rs:278-298](repo://tests/testenv/mod.rs#L278-L298), [tests/testenv/mod.rs:318-344](repo://tests/testenv/mod.rs#L318-L344)

## Writing an integration test

A test creates an environment and asserts the output of one or more invocations. Paths are written with `/` and in any order; a trailing `/` marks a directory, as fd prints one.

Sources: [tests/tests.rs:62-80](repo://tests/tests.rs#L62-L80)

```rust
#[test]
fn test_simple() {
    let te = TestEnv::new(DEFAULT_DIRS, DEFAULT_FILES);

    te.assert_output(&["a.foo"], "a.foo");
    te.assert_output(&["b.foo"], "one/b.foo");
    te.assert_output(&["d.foo"], "one/two/three/d.foo");
```

Sources: [tests/tests.rs:62-69](repo://tests/tests.rs#L62-L69)

The `test-case` crate runs one test body for several inputs. `test_no_global_ignore`, for example, builds a tree with a global ignore file containing `one` and checks the output of `--unrestricted`, `--no-ignore` and `--no-global-ignore-file` in turn. Platform-specific tests are gated with `#[cfg(unix)]` or `#[cfg(not(windows))]`.

Sources: [tests/tests.rs:1024-1050](repo://tests/tests.rs#L1024-L1050)

## Continuous integration

`.github/workflows/CICD.yml` runs on pull requests, pushes to `master`, tags and manual dispatch.

Sources: [.github/workflows/CICD.yml:1-17](repo://.github/workflows/CICD.yml#L1-L17)

| Job | What it checks or does |
| --- | --- |
| `crate_metadata` | reads name, version, maintainer, homepage and `rust-version` from `cargo metadata` |
| `ensure_cargo_fmt` | `cargo fmt -- --check` |
| `lint_check` | `cargo clippy --all-targets --all-features -- -Dwarnings` |
| `min_version` | clippy and `cargo test --locked --all-features` on the MSRV toolchain |
| `build` | release build and tests for 14 targets across Linux (via `cross`), macOS and Windows; on ARM targets only `--bin=fd` tests run |
| `winget` | publishes the Windows MSVC zip to Winget for `v*` tags |

Sources: [.github/workflows/CICD.yml:19-86](repo://.github/workflows/CICD.yml#L19-L86), [.github/workflows/CICD.yml:86-198](repo://.github/workflows/CICD.yml#L86-L198), [.github/workflows/CICD.yml:299-309](repo://.github/workflows/CICD.yml#L299-L309)

After testing, each `build` job runs `make completions`, packs the binary into a `.tar.gz` (`.zip` on Windows), builds a Debian package on Ubuntu runners with `scripts/create-deb.sh`, and uploads both. For a tag matching `v[0-9]*`, it also attests the artefacts and attaches them to the GitHub release.

Sources: [.github/workflows/CICD.yml:200-297](repo://.github/workflows/CICD.yml#L200-L297)

## Contributing and releasing

`CONTRIBUTING.md` asks contributors to open a ticket before a pull request, to make sure the code compiles and passes tests, to disclose any AI tool use, and to add an entry in the *Upcoming release* section of `CHANGELOG.md` for behaviour changes, in the form `- Short description, see #123 (@user)`.

Sources: [CONTRIBUTING.md:10-46](repo://CONTRIBUTING.md#L10-L46)

`doc/release-checklist.md` lists the release steps.

Sources: [doc/release-checklist.md:1-9](repo://doc/release-checklist.md#L1-L9)

1. Bump the version with `scripts/version-bump.sh`, which updates `Cargo.toml`, `Cargo.lock`, the README and the changelog heading.
2. Install the new build, review `-h`, `--help` and the man page, and refresh the README's option listing with `gawk -i inplace -f scripts/update-help.awk README.md`.
3. Wait for CI, run `cargo publish --dry-run`, merge, and push a `vX.Y.Z` tag, which triggers the deployment jobs.
4. Create the GitHub release from the changelog section, check that archives and Debian packages appear, and run `cargo publish` from a clean clone.
5. Start a new *Upcoming release* section in the changelog.

Sources: [doc/release-checklist.md:1-69](repo://doc/release-checklist.md#L1-L69)
