---
title: "Development and Testing"
---
## Overview

The repository builds a single `fd` binary and tests behavior at two levels: unit tests beside implementation code and integration tests that invoke the executable against temporary directories. [[Quickstart]] covers a first build and search; this page follows feature selection, test isolation, CI validation and artifact generation for changes to that executable.

Sources: [Cargo.toml:29-31](repo://Cargo.toml#L29-L31), [src/regex_helper.rs:81-105](repo://src/regex_helper.rs#L81-L105), [tests/testenv/mod.rs:13-63](repo://tests/testenv/mod.rs#L13-L63), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

## Toolchain, features and profiles

The manifest declares Rust 1.90.0 as the minimum and edition 2024. Its default feature enables shell completions. `use-jemalloc` enables the optional allocator dependency, while `base` enables that allocator feature; neither is part of the default feature set. The allocator's declaration in `main` is gated by the feature and target conditions, which comments require to stay consistent with the manifest's dependency conditions.

Sources: [Cargo.toml:19-21](repo://Cargo.toml#L19-L21), [Cargo.toml:65-71](repo://Cargo.toml#L65-L71), [Cargo.toml:94-98](repo://Cargo.toml#L94-L98), [src/main.rs:38-54](repo://src/main.rs#L38-L54)

Development builds use line-table debug information for this package and disable debug information in dependencies. The `debugging` profile inherits development settings but enables full debug information. Release builds enable link-time optimization, strip symbols and use one code-generation unit. These are separate from feature selection: choosing a release profile does not itself enable jemalloc.

Sources: [Cargo.toml:79-98](repo://Cargo.toml#L79-L98)

## Local checks

The README's development workflow runs `cargo build`, `cargo test` and then a local installation. CI adds formatting and Clippy checks. The commands below are the ordinary test command and the exact formatting and lint commands configured in the workflow; they make the expected checks visible without requiring a release build or installation.

Sources: [README.md:734-746](repo://README.md#L734-L746), [.github/workflows/CICD.yml:42-64](repo://.github/workflows/CICD.yml#L42-L64)

```bash
cargo test
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
```

Sources: [README.md:742-743](repo://README.md#L742-L743), [.github/workflows/CICD.yml:52-64](repo://.github/workflows/CICD.yml#L52-L64)

The minimum-version CI job derives its toolchain from Cargo metadata rather than duplicating the version string in the workflow. It runs locked Clippy and tests using `MSRV_FEATURES`, configured as `--all-features`. This catches behavior and compatibility under the declared minimum in addition to the separate stable-toolchain lint job.

Sources: [.github/workflows/CICD.yml:3-5](repo://.github/workflows/CICD.yml#L3-L5), [.github/workflows/CICD.yml:27-40](repo://.github/workflows/CICD.yml#L27-L40), [.github/workflows/CICD.yml:54-84](repo://.github/workflows/CICD.yml#L54-L84)

## Integration-test isolation

`TestEnv::new` creates a temporary working tree from lists of directory and file names. The helper creates a `.git` directory so Git-ignore rules are active, then adds fixture `.fdignore` and `.gitignore` files. It also creates a directory symlink with platform-specific APIs; the Windows comment notes that creating symlinks requires the appropriate privilege. The executable comes from `CARGO_BIN_EXE_fd`, with an environment override before the compile-time value.

Sources: [tests/testenv/mod.rs:28-79](repo://tests/testenv/mod.rs#L28-L79), [tests/testenv/mod.rs:147-157](repo://tests/testenv/mod.rs#L147-L157)

Each invocation runs beneath the temporary root. If a test supplies a global-ignore fixture, the harness points `XDG_CONFIG_HOME` at its temporary configuration directory; otherwise it passes `--no-global-ignore-file`. It sets `LS_COLORS` to an empty value before launching the command. These measures reduce the influence of user configuration on results, especially ignore and color behavior.

Sources: [tests/testenv/mod.rs:65-72](repo://tests/testenv/mod.rs#L65-L72), [tests/testenv/mod.rs:169-175](repo://tests/testenv/mod.rs#L169-L175), [tests/testenv/mod.rs:300-316](repo://tests/testenv/mod.rs#L300-L316)

Normal output assertions convert stdout lossily to text, replace NUL delimiters with visible markers, normalize path separators and sort lines. An optional setting also sorts whitespace-separated words within each line. Consequently `assert_output` checks normalized contents, not original byte spelling or traversal order. For byte-sensitive behavior described in [[Output and Formatting]], the Unix/non-macOS raw helper compares the original stdout byte slice instead.

Sources: [tests/testenv/mod.rs:114-134](repo://tests/testenv/mod.rs#L114-L134), [tests/testenv/mod.rs:234-275](repo://tests/testenv/mod.rs#L234-L275)

Error assertions are also distinct. `assert_failure` requires an unsuccessful exit, while `assert_failure_with_error` additionally compares the start of normalized stderr. `assert_error` returns the exit status without requiring failure itself. Choosing the appropriate helper matters for diagnostics that may coexist with successful traversal of other roots or entries.

Sources: [tests/testenv/mod.rs:278-298](repo://tests/testenv/mod.rs#L278-L298), [tests/testenv/mod.rs:318-343](repo://tests/testenv/mod.rs#L318-L343), [src/cli.rs:707-720](repo://src/cli.rs#L707-L720)

## Testing behavior at the right level

Parser and formatting unit tests isolate decisions that do not need a whole directory traversal. Smart-case tests distinguish literal uppercase characters from regex syntax, format-input tests check basename and extension transformations, and time-filter tests inject a thread-local clock. These support the contracts in [[Search Patterns]] and [[Output and Formatting]] without depending on real wall-clock timing or a user's filesystem.

Sources: [src/regex_helper.rs:81-105](repo://src/regex_helper.rs#L81-L105), [src/fmt/input.rs:43-73](repo://src/fmt/input.rs#L43-L73), [src/filter/time.rs:17-26](repo://src/filter/time.rs#L17-L26), [src/filter/time.rs:70-93](repo://src/filter/time.rs#L70-L93)

Integration tests exercise combinations through the actual binary. The exact-match test creates similar filenames and checks literal punctuation, absence of substring matching and explicit case sensitivity. Other tests check additional `--and` expressions, malformed patterns, invalid numeric arguments and opposing option overrides. The invalid-UTF-8 filename test is Linux-gated, illustrating that platform-specific contracts are tested under explicit target conditions.

Sources: [tests/tests.rs:102-143](repo://tests/tests.rs#L102-L143), [tests/tests.rs:2229-2289](repo://tests/tests.rs#L2229-L2289), [tests/tests.rs:2654-2697](repo://tests/tests.rs#L2654-L2697)

## Completions and installed artifacts

Completion generation is a feature-gated early return in `run`. It creates a Clap command, derives the executable name from the invocation, and writes the requested shell's completion script to stdout. With a bare generation option, shell selection can come from the environment; failure to infer it is reported. This path returns before working-directory selection and searching.

Sources: [src/main.rs:75-84](repo://src/main.rs#L75-L84), [src/main.rs:114-128](repo://src/main.rs#L114-L128), [src/cli.rs:775-785](repo://src/cli.rs#L775-L785)

The Makefile's `completions` target generates Bash, Fish and PowerShell files with the binary and copies the supplied Zsh and `fdfind` completion files. Its binary rule builds the selected profile with `--locked`, defaulting to release. The `install` target installs the binary, completions and man page beneath configurable prefix/data directories with `DESTDIR` support. Cargo installation in [[Quickstart]] is therefore only one part of the repository's broader packaging workflow.

Sources: [Makefile:1-52](repo://Makefile#L1-L52), [README.md:734-746](repo://README.md#L734-L746)

## CI and release flow

The workflow runs for pull requests, pushes to `master`, tags and manual dispatch. Its build matrix covers Linux, macOS and Windows targets, selecting `cross` or Cargo per job. Builds use locked release dependencies, and tests use the configured target. ARM and AArch64 target names select binary-only tests, so those matrix entries do not run the same integration target set as every other job.

Sources: [.github/workflows/CICD.yml:7-14](repo://.github/workflows/CICD.yml#L7-L14), [.github/workflows/CICD.yml:94-114](repo://.github/workflows/CICD.yml#L94-L114), [.github/workflows/CICD.yml:160-198](repo://.github/workflows/CICD.yml#L160-L198)

Packaging copies the executable, README, licenses, changelog, man page and completion directory into target-specific archives. Windows uses ZIP and other targets use tar.gz; Ubuntu jobs also invoke the Debian-package script. Release-tag detection gates artifact attestation and GitHub release publication, and a separate tag-triggered job handles Winget. These are workflow behaviors, not steps performed by a local `cargo test`.

Sources: [.github/workflows/CICD.yml:200-255](repo://.github/workflows/CICD.yml#L200-L255), [.github/workflows/CICD.yml:274-309](repo://.github/workflows/CICD.yml#L274-L309)

The release checklist connects version changes to reviewing help and the man page, refreshing README help output, passing CI and running a dry-run package publication. It then describes tagging, release artifacts and publication from a clean checkout. For ordinary contributions, the contributor guide asks for an issue before a pull request and a changelog entry when behavior changes, so release preparation has a record of the externally visible differences.

Sources: [doc/release-checklist.md:6-50](repo://doc/release-checklist.md#L6-L50), [CONTRIBUTING.md:10-11](repo://CONTRIBUTING.md#L10-L11), [CONTRIBUTING.md:30-46](repo://CONTRIBUTING.md#L30-L46)
