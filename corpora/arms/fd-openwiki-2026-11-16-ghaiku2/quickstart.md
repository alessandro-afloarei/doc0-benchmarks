---
type: guide
title: fd Repository Quickstart
description: Entry point for working on the fd repository - what the program is, how to build, test and lint it, the contribution rules that apply to behavior changes, and a task-routing map from kinds of change to the wiki page that explains the relevant code.
tags: [quickstart, guide, build, test, contributing, routing, rust, fd]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:10:54.611Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-a7a4c9acc1b5537a33c66a31
    resource: repo://tests/testenv/mod.rs
generated: { by: "claude-code", at: "2026-11-16T18:10:54.611Z" }
---

# fd Repository Quickstart

`fd` is a fast, user-friendly replacement for `find`, written in Rust. It
searches a directory tree in parallel for entries whose names match a regular
expression or glob, applies ignore rules and filters, and prints the matches or
runs a command on them. The crate is `fd-find` (binary `fd`), and it has no
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
library target. Read [System Overview](/openwiki/architecture/overview.md) for
the full architecture.

## Build, run and test

All commands run from the repository root.

- Debug build: `cargo build`. Release build as the Makefile does it:
  `make` (which runs `cargo build --profile release --locked`).
- Run from source: `cargo run -- <pattern> [path]`.
- Full test suite: `cargo test`. This runs the unit tests in `src/` and the
  integration tests in `tests/tests.rs`, which execute the built binary against
  temporary fixture trees.
- One integration scenario: `cargo test --test tests <test_name>`.
- Format and lint, as CI checks them: `cargo fmt -- --check` and
  `cargo clippy --all-targets --all-features -- -Dwarnings`.

CI also builds with the minimum supported Rust version (1.90.0) and runs the
tests on all release targets. Use `--locked` when building so that `Cargo.lock`
is respected. Details are in
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
[Build, Release, CI and Packaging](/openwiki/operations/build-release-and-ci.md).

## Contribution rules that affect code changes

`CONTRIBUTING.md` sets the rules that apply to every change:

- If a change alters `fd`'s behavior (as opposed to a typo fix in docs), add an
  entry under the "Upcoming release" section of `CHANGELOG.md`, using the
  documented `- Short description ..., see #123 (@user)` form.
- Changes should compile and pass the test suite before a pull request is
  opened.
- Contributors must disclose the use of AI tools in a pull request.

## Where to look for each kind of change

| If you are changing... | Read first | Then read |
| --- | --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| A command-line flag, its default, or a conflict between flags | [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md) | [System Overview](/openwiki/architecture/overview.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Which entries match: patterns, case handling, `--and`, `--full-path` | [CLI Parsing and Configuration](/openwiki/architecture/cli-and-configuration.md) | [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Ignore files, hidden files, `--exclude`, depth, pruning, symlinks | [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md) | [Parallel Traversal](/openwiki/architecture/parallel-traversal.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/search-filters.md] link "/openwiki/architecture/search-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Size, time, owner, extension or file-type filters | [Search Filters and Ignore Rules](/openwiki/architecture/search-filters.md) | `src/filter/` and `src/filetypes.rs` |
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Threading, batching, buffering, Ctrl-C, or ordering of results | [Parallel Traversal](/openwiki/architecture/parallel-traversal.md) | [System Overview](/openwiki/architecture/overview.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-traversal.md] link "/openwiki/architecture/parallel-traversal.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Output text, colors, `--format`, hyperlinks, `--print0`, terminal escaping | [Output Formatting](/openwiki/workflows/output-formatting.md) | [Parallel Traversal](/openwiki/architecture/parallel-traversal.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/output-formatting.md] link "/openwiki/workflows/output-formatting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| `--exec` or `--exec-batch`, placeholders, batch sizes | [Command Execution](/openwiki/workflows/command-execution.md) | [Output Formatting](/openwiki/workflows/output-formatting.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Exit codes and error messages | [System Overview](/openwiki/architecture/overview.md) | [Command Execution](/openwiki/workflows/command-execution.md) |
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-ci.md] link "/openwiki/operations/build-release-and-ci.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Cargo features, release profile, CI, packaging, completions, release process | [Build, Release, CI and Packaging](/openwiki/operations/build-release-and-ci.md) | [Testing Strategy](/openwiki/testing/integration-tests.md) |
<!-- openwiki: broken internal link [/openwiki/testing/integration-tests.md] link "/openwiki/testing/integration-tests.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Adding or fixing tests, or understanding a test failure | [Testing Strategy](/openwiki/testing/integration-tests.md) | the scenario in `tests/tests.rs` |

## Source map

- `src/main.rs`: entry point, pattern translation, `Config` construction.
- `src/cli.rs`: clap options and their defaults.
- `src/walk.rs`: the parallel walker and result receiver.
- `src/output.rs`, `src/fmt/`, `src/sanitize.rs`, `src/hyperlink.rs`: printing.
- `src/exec/`: `--exec` and `--exec-batch`.
- `src/filter/`, `src/filetypes.rs`, `src/dir_entry.rs`: entry predicates and metadata.
- `tests/tests.rs`, `tests/testenv/`: integration tests and their fixture harness.
- `doc/fd.1`, `README.md`, `contrib/completion/`: user documentation and shell
  completion scripts.

## Working rules for agents and maintainers

- Treat the source code and tests as the authority. Documentation, including
  this wiki, is a summary that may lag behind the code.
- Prefer the narrowest test that proves a change, such as one named integration
  scenario, before running the full suite.
- Keep output contracts intact. Scripts depend on the exact text, the NUL
  separator, the exit codes, and the raw-byte behavior for piped output.
