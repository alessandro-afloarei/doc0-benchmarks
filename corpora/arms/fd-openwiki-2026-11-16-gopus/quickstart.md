---
type: quickstart
title: Quickstart
description: Orientation for working on fd — what it is, how to build, run, lint and test it, the contribution expectations, and a task-routing map to the right wiki page for each kind of change.
tags: [quickstart, onboarding, build, testing, navigation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:05:54.272Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-c38906bbfa9e9c69417b11b5
    resource: repo://src/cli.rs
generated: { by: "claude-code", at: "2026-11-16T06:05:54.272Z" }
---

# Quickstart

**fd** is a fast, user-friendly alternative to `find`, written in Rust and shipped
as a single binary named `fd` (crate `fd-find`). By default it matches a regex
against file names with smart case, skips hidden and gitignored entries, walks
directories in parallel, and colorizes output. See the
[System Overview](overview.md) for the module map.

## Build and run

Requires Rust ≥ 1.90 (the `rust-version` in `Cargo.toml`).

```bash
cargo build                         # debug build → target/debug/fd
cargo run -- netfl ~/Software       # search for 'netfl' under ~/Software
cargo run -- -e rs -x wc -l         # run a command for each .rs file
cargo build --release               # optimized (LTO, stripped)
cargo build --release --features use-jemalloc   # opt into jemalloc where supported
make && sudo make install           # binary, completions, man page under /usr/local
```

## Check and test

```bash
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -Dwarnings
cargo test                          # unit + integration tests
```

Integration tests run the real binary in temporary directory trees; see
[Test Suite](testing/test-suite.md).

## Contribution expectations

From `CONTRIBUTING.md`: open an issue before a pull request, make sure it builds
and passes tests, add an entry to the "Upcoming release" section of
`CHANGELOG.md` for behavior changes, and disclose any use of AI tools (PR
descriptions and maintainer communication should be written by humans).

## Where to go for a task

| I want to… | Read |
| --- | --- |
| Understand the overall design | [System Overview](overview.md) |
| Follow what happens from `argv` to the scan | [Search Pipeline](architecture/search-pipeline.md) |
| Change threading, batching, output ordering, `--max-results`, Ctrl-C | [Parallel Walk, Batching, and the Receiver](architecture/parallel-walk-and-receiver.md) |
| Change regex/glob/fixed-string matching or smart case | [Pattern Matching](concepts/pattern-matching.md) |
| Change which files are visited (`.gitignore`, hidden, `--exclude`) | [Ignore Rules and Hidden Files](concepts/ignore-rules-and-hidden-files.md) |
| Add or change `--type`, `--size`, time, owner, or depth filters | [Entry Filters](concepts/entry-filters.md) |
| Change printing, colors, `--format`, hyperlinks, escaping | [Output Formatting](features/output-formatting.md) |
| Change `--exec`, `--exec-batch`, `--list-details` | [Command Execution](features/command-execution.md) |
| Add a new command-line option | [CLI Options Reference](reference/cli-options.md) |
| Understand exit statuses and error messages | [Exit Codes and Errors](reference/exit-codes-and-errors.md) |
| Touch CI, packaging, completions, or cut a release | [Build, CI, Release, and Packaging](operations/build-release-and-packaging.md) |
| Write or debug tests | [Test Suite](testing/test-suite.md) |

## Key files

- `src/main.rs` — entry point and configuration assembly.
- `src/cli.rs` — every command-line option.
- `src/walk.rs` — the parallel search engine.
- `tests/tests.rs`, `tests/testenv/mod.rs` — integration tests and harness.
- `doc/fd.1`, `contrib/completion/` — hand-maintained man page and zsh
  completions; update them when you add options.
