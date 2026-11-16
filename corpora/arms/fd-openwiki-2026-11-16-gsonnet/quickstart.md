---
type: quickstart
title: fd Quickstart and Task Map
description: Orientation for the fd codebase (a fast, user-friendly Rust alternative to find) - what it does, repository layout, how to build and test it, and which wiki page to read for each kind of change.
tags: [quickstart, overview, onboarding, fd, rust]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:03:56.385Z
sources:
  - id: openwiki-source-dddf858b6f600d9339e1373d
    resource: repo://.github/workflows/CICD.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-b55a21a31ede1b56cd31a6a6
    resource: repo://src/main.rs
generated: { by: "claude-code", at: "2026-11-16T09:03:56.385Z" }
---

# fd Quickstart and Task Map

**fd** is a single-binary command-line tool (crate `fd-find`, binary `fd`) that finds entries in the filesystem by matching a regex or glob against file names (or full paths). Compared with `find` it defaults to smart-case matching, regex syntax, colored output, parallel traversal, and skipping hidden and VCS-ignored files. The entrypoint is `src/main.rs`; it is a flat Rust crate with no library target.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/main.rs`, `src/cli.rs`, `src/config.rs` | startup, clap options, the `Config` struct |
| `src/walk.rs`, `src/dir_entry.rs` | parallel traversal, filtering, batching, receiver/printing loop |
| `src/filetypes.rs`, `src/filter/`, `src/filesystem.rs`, `src/regex_helper.rs` | filters and matching helpers |
| `src/exec/`, `src/fmt/` | `--exec`, `--exec-batch`, placeholder templates, `--format` |
| `src/output.rs`, `src/sanitize.rs`, `src/hyperlink.rs`, `src/error.rs`, `src/exit_codes.rs` | rendering, safety, exit statuses |
| `tests/` | integration tests with a `TestEnv` fixture |
| `contrib/completion/`, `doc/fd.1`, `scripts/`, `Makefile`, `.github/workflows/CICD.yml` | completions, man page, release tooling, CI |

## Everyday commands

```sh
cargo build                 # debug build (target/debug/fd)
cargo run -- PATTERN [PATH] # run against a directory
cargo test                  # unit + integration tests
cargo clippy --all-targets --all-features -- -Dwarnings   # what CI enforces
cargo fmt -- --check
make                        # release build; `make completions`, `make install`
```

<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-packaging.md] link "/openwiki/operations/build-release-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Requirements: Rust 1.90 or newer (edition 2024). Features: `completions` (default), `use-jemalloc` (optional). Details in [build, CI and release](/openwiki/operations/build-release-and-packaging.md).

## Mental model in one paragraph

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`Opts` (clap) → validated into an immutable `Config` plus compiled byte regexes → `walk::scan` starts `ignore`'s parallel walker; each walker thread filters entries (name regex first, then extension, type, owner, size, time) and ships batches over a bounded channel → a receiver either prints (sorted if the search is fast, streamed otherwise) or feeds `--exec` workers → an `ExitCode` is returned. Read the [architecture overview](/openwiki/architecture/overview.md) for the diagram and module map.

## Task routing

| If you want to... | Read |
| --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| understand the whole flow or find which module owns something | [Architecture overview](/openwiki/architecture/overview.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/cli-and-configuration.md] link "/openwiki/architecture/cli-and-configuration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| add or change a command-line flag, default, or startup validation | [CLI and config construction](/openwiki/architecture/cli-and-configuration.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/parallel-walk-and-receiver.md] link "/openwiki/architecture/parallel-walk-and-receiver.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change traversal, filter order, channel/buffering, Ctrl-C, `--quiet`, `--max-results` | [Parallel walk and receiver](/openwiki/architecture/parallel-walk-and-receiver.md) |
<!-- openwiki: broken internal link [/openwiki/concepts/pattern-matching.md] link "/openwiki/concepts/pattern-matching.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change regex/glob/fixed/exact handling, smart case, `--full-path`, `--and` | [Pattern matching](/openwiki/concepts/pattern-matching.md) |
<!-- openwiki: broken internal link [/openwiki/concepts/ignore-and-visibility-rules.md] link "/openwiki/concepts/ignore-and-visibility-rules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change hidden/ignore-file behavior, `--exclude`, depth, symlinks, `--ignore-contain` | [Ignore and visibility rules](/openwiki/concepts/ignore-and-visibility-rules.md) |
<!-- openwiki: broken internal link [/openwiki/concepts/entry-filters.md] link "/openwiki/concepts/entry-filters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| add or alter `--type`, `-e`, `--size`, `--changed-*`, `--owner` | [Entry filters](/openwiki/concepts/entry-filters.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/command-execution.md] link "/openwiki/workflows/command-execution.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change `--exec`, `--exec-batch`, placeholders, `--format`, `--list-details` | [Command execution](/openwiki/workflows/command-execution.md) |
<!-- openwiki: broken internal link [/openwiki/concepts/output-and-terminal-safety.md] link "/openwiki/concepts/output-and-terminal-safety.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change colors, hyperlinks, path printing, or filename escaping | [Output and terminal safety](/openwiki/concepts/output-and-terminal-safety.md) |
<!-- openwiki: broken internal link [/openwiki/operations/exit-codes-and-error-handling.md] link "/openwiki/operations/exit-codes-and-error-handling.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| change exit statuses or error messages | [Exit codes and error handling](/openwiki/operations/exit-codes-and-error-handling.md) |
<!-- openwiki: broken internal link [/openwiki/operations/build-release-and-packaging.md] link "/openwiki/operations/build-release-and-packaging.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| cut a release, touch CI, packaging, features or MSRV | [Build, CI and release](/openwiki/operations/build-release-and-packaging.md) |
<!-- openwiki: broken internal link [/openwiki/testing/integration-test-harness.md] link "/openwiki/testing/integration-test-harness.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| write or debug tests | [Test harness](/openwiki/testing/integration-test-harness.md) |

## Conventions and gotchas

- Treat the source and `tests/tests.rs` as authoritative; user-visible help text lives in `src/cli.rs` and must stay consistent with `doc/fd.1`, the README options block and the shell completions in `contrib/completion/`.
- fd's output is nondeterministic once results are streamed; tests normalize by sorting lines.
- Many behaviors are platform-gated (`cfg(unix)` owner filter and device types, Windows path-separator handling, jemalloc target exclusions).
- Filenames are untrusted input for terminals: anything written to a TTY goes through `sanitize`; anything handed to `--exec` is passed as raw arguments, never through a shell.
- `AGENTS.md` contains the OpenWiki usage note for agents: retrieve wiki context only when needed and verify against source.
