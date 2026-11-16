---
type: guide
title: Quickstart
description: Entry point for the fd repository. Explains what fd is, how the source tree is organized, how to build and test it, and which wiki page to read for each kind of change.
tags: [quickstart, overview, build, navigation, contributing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:13:27.224Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T10:13:27.224Z" }
---

# Quickstart

`fd` is a command-line file finder written in Rust. It walks one or more directory trees in
parallel, reports entries whose names match a pattern, and can run a command for each match.
It respects `.gitignore` and `.fdignore` rules and skips hidden entries by default. The crate
is published as `fd-find` and builds a binary named `fd`.

Read this page first. It tells you where to go next; the detail lives in the linked pages.

## Build and test

```bash
cargo build                          # debug build
cargo build --release --locked       # release build, as used by CI
cargo test                           # unit tests and the integration suite
cargo fmt -- --check                 # formatting check enforced in CI
cargo clippy --all-targets --all-features -- -Dwarnings
```

The minimum supported Rust version is declared in `Cargo.toml` as `rust-version`. Shell
completions and the man page are installed with `make install`; see
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Build, Release, and CI](/openwiki/operations/build-release-and-ci.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main.rs` | Entry point, startup validation, and construction of the configuration. |
| `src/cli.rs` | Command-line definition (clap `Opts`) and derived option helpers. |
| `src/config.rs` | `Config`, the resolved settings passed to the walker. |
| `src/walk.rs` | Parallel traversal, per-entry filtering, batching, and the result receiver. |
| `src/filter/`, `src/filetypes.rs` | Size, time, owner, and file-type predicates. |
| `src/output.rs`, `src/fmt/`, `src/hyperlink.rs`, `src/sanitize.rs` | Printing, `--format` templates, hyperlinks, and terminal escaping. |
| `src/exec/` | `--exec` and `--exec-batch` command execution. |
| `src/exit_codes.rs`, `src/error.rs` | Exit status values and error reporting. |
| `src/filesystem.rs`, `src/dir_entry.rs`, `src/regex_helper.rs` | Platform helpers, entry model, and regex analysis. |
| `tests/tests.rs`, `tests/testenv/` | Integration tests and the temporary-directory harness. |
| `doc/` | The man page (`fd.1`), logo, and release checklist. |
| `contrib/completion/` | Static completion files: zsh (`_fd`, `_fdfind`) and the `fdfind` bash and fish variants. |
| `.github/workflows/CICD.yml` | Continuous integration and release pipeline. |

## How the program works

A run parses arguments, builds one configuration value, compiles the patterns into regexes,
walks the search roots on a thread pool, filters each entry through a fixed chain of checks,
and sends survivors to a single receiver. The receiver prints them or hands them to the command
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
runner. The sequence is described in [Architecture Overview](/openwiki/architecture/overview.md).

## Where to go next

Choose the page that matches the change you are making:

<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Adding or changing a flag, or a default.** [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md)
- **Changing how patterns match** (regex, glob, smart case, `--and`, `--full-path`).
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Pattern Matching Modes](/openwiki/concepts/pattern-matching.md)
- **Changing which entries are reported** (ignore files, depth, types, size, time, owner).
<!-- openwiki: broken internal link [/openwiki/workflows/filtering-entries.md] link "/openwiki/workflows/filtering-entries.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Filtering Entries](/openwiki/workflows/filtering-entries.md)
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Changing traversal, ordering, or early exit.** [Parallel Traversal and Result Delivery](/openwiki/architecture/parallel-traversal.md)
- **Changing printed output** (colors, hyperlinks, `--format`, separators).
<!-- openwiki: broken internal link [/openwiki/workflows/output-and-formatting.md] link "/openwiki/workflows/output-and-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
  [Output and Formatting](/openwiki/workflows/output-and-formatting.md)
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Changing `--exec` or `--exec-batch` behavior.** [Command Execution](/openwiki/workflows/command-execution.md)
<!-- openwiki: broken internal link [/openwiki/concepts/exit-codes-and-errors.md] link "/openwiki/concepts/exit-codes-and-errors.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Changing exit codes or error messages.** [Exit Codes and Error Reporting](/openwiki/concepts/exit-codes-and-errors.md)
<!-- openwiki: broken internal link [/openwiki/concepts/platform-support.md] link "/openwiki/concepts/platform-support.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Working on Windows, macOS, or BSD behavior.** [Platform-Specific Behavior](/openwiki/concepts/platform-support.md)
<!-- openwiki: broken internal link [/openwiki/testing/test-strategy.md] link "/openwiki/testing/test-strategy.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Writing or running tests.** [Testing Strategy](/openwiki/testing/test-strategy.md)
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Releasing or touching CI.** [Build, Release, and CI](/openwiki/operations/build-release-and-ci.md)

## Contributing notes

`CONTRIBUTING.md` asks that changes compile and pass the tests, that behavior changes get a
`CHANGELOG.md` entry, and that AI-assisted contributions be disclosed. Keep changes small and
run the narrowest test that proves the behavior first; the testing page explains how to filter
the suite by name.
